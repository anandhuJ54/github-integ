"""Contract reads shared by the harvest workers (disco-harvest-worker, disco-detail-api-worker).

Both TS workers read the same thing (the detail-api worker copied the harvest worker's read so
that file stayed unchanged): the latest `disco_site_contract` row of (domain, gcid), the
source's `exp_etl_sources.source_type`, and the contract's static routes plus the category's
generic taxonomy routes (Fix "generic taxonomy routes", 2026-10-12). Rows are cached for
10 minutes per worker process, as in the TS. Read-only (service role).
"""
from __future__ import annotations

import importlib
import logging
import threading
import time
from typing import Any

from _base.db.session import role_connection

log = logging.getLogger(__name__)

CACHE_TTL_MS = 10 * 60_000
_REGISTRY_COLS = ("node_slug, node_name, node_description, schema_type, schema_property, "
                  "entity_scope, owns_lane")


def sc() -> Any:
    """The shared site-contract library (resolved at call time)."""
    return importlib.import_module("_base.disco.site_contract")


def _now_ms() -> float:
    return time.time() * 1000


class TtlCache:
    def __init__(self) -> None:
        self._d: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> tuple[bool, Any]:
        with self._lock:
            hit = self._d.get(key)
        if hit and _now_ms() - hit[0] < CACHE_TTL_MS:
            return True, hit[1]
        return False, None

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._d[key] = (_now_ms(), value)

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


def _maybe_one(conn: Any, sql: str, params: tuple) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return dict(rows[0]) if rows else None


def latest_contract_row(conn: Any, domain: str, gcid: str, cols: str) -> dict | None:
    """Latest disco_site_contract row of (domain, gcid); gcid stored exactly as 'gcid:xxx'."""
    return _maybe_one(
        conn,
        f"select {cols} from disco_site_contract where domain = %s and category_slug = %s "
        "order by learned_at desc limit 1",
        (domain, gcid),
    )


def source_row(conn: Any, domain: str, gcid: str, cols: str) -> dict | None:
    return _maybe_one(
        conn,
        f"select {cols} from exp_etl_sources where source_domain = %s and gcid = %s limit 1",
        (domain, gcid),
    )


def registry_rows(conn: Any, gcid: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            f"select {_REGISTRY_COLS} from exp_vertical_node_registry "
            "where gcid = %s and is_active = true",
            (gcid,),
        )
        return [dict(r) for r in cur.fetchall()]


def harvest_routes(conn: Any, gcid: str, contract: dict | None) -> dict[str, list]:
    """Contract routes + the category's generic taxonomy routes (single-value ids only)."""
    saved = (contract or {}).get("static_routes") or {}
    if (not contract or not contract.get("primary_subject") or not contract.get("taxonomy_fields")
            or not dict(contract["taxonomy_fields"])):
        return saved
    try:
        lib = sc()
        tax_keys = lib.resolve_taxonomy_keys(lib.filter_taxonomy_rows(registry_rows(conn, gcid)),
                                             contract["primary_subject"])
        generic = lib.build_static_routes({
            "fields": {}, "taxonomyFields": contract["taxonomy_fields"], "taxKeys": tax_keys,
            "primary": contract["primary_subject"], "extraFields": {}, "extraCandidates": {},
            "extraValues": [], "sampleUrls": [],
        })["routes"]
        out: dict[str, list] = {sid: list(rs) for sid, rs in saved.items() if isinstance(rs, list)}
        for sid, rs in generic.items():
            if lib.is_mergeable_id(sid) or not isinstance(rs, list):
                continue  # lists keep the contract's own routes only
            tax_only = [r for r in rs if r.get("kind") == "taxonomy"]
            if tax_only:
                out[sid] = [*out.get(sid, []), *tax_only]
        return out
    except Exception:
        log.exception("generic taxonomy routes failed")
        return saved


_ROW_COLS = ("domain, category_slug, detail_pattern, field_floor, detail_entity_type, learned_at, "
             "extraction")


def load_contract_row(cache: TtlCache, domain: str, gcid: str) -> dict | None:
    """The harvest's contract row (+ source_type, routes), cached per (domain, gcid)."""
    key = f"{domain}|{gcid}"
    hit, row = cache.get(key)
    if hit:
        return row
    with role_connection("service_role") as conn:
        row = latest_contract_row(conn, domain, gcid, _ROW_COLS)
        if row:
            src = source_row(conn, domain, gcid, "source_type")
            row["source_type"] = (src or {}).get("source_type")
            extraction = row.get("extraction") or {}
            row["routes"] = harvest_routes(conn, gcid, extraction.get("site_contract"))
    cache.set(key, row)
    return row


def matches_detail_pattern(url: str, pattern: str | None) -> bool:
    if not pattern:
        return False
    from _base.disco.agent_engine import js_re

    try:
        rx = js_re(pattern)
    except Exception:  # noqa: BLE001 - an invalid pattern never matches
        return False
    return bool(rx.search(url) or rx.search(url.split("#")[0].split("?")[0]))


def site_entity_names(cache: TtlCache, key: str, domain: str, contract: dict,
                      crawl_method: str) -> set[str]:
    """Names of the site's own entities: from the contract, else read from the home page."""
    if isinstance(contract.get("site_entity_names"), list):
        return set(contract["site_entity_names"])
    hit, names = cache.get(key)
    if hit:
        return names
    from _base.disco import webscraper

    home = webscraper.scrape_website({"url": f"https://{domain}/", "crawl_method": crawl_method})
    names = (set(sc().collect_site_entity_names(home["content"]))
             if home.get("ok") and home.get("content") else set())
    cache.set(key, names)
    return names


def empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "") or (isinstance(v, list) and not v)
