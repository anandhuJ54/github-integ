"""Site-map proposal review (port of legacy `lib/site-proposal.functions.ts`).

G2 (contract review, 2026-10-13): "Preview records" builds records exactly as the harvest would
stage them (same builders as the harvest workers: apply_site_contract, apply_address_owner,
apply_extra_fields, build_harvest_record). Read-only: nothing is written. Admins only
(super_admin / architect). Contract re-check (2026-10-15): the preview also runs on the SAVED
contract (`{domain, gcid}` instead of `proposalId`), on the contract's sample pages or on up to
10 reviewer-given URLs (each must be on the site and match the profile page pattern). A contract
whose detail route reads the site's profile API (record_source 'api' / 'api+page') is previewed
the way disco-detail-api-worker harvests it: JSON values first, the page fills the rest.

Accept: `disco_accept_site_proposal` (called with the reviewer's own session) does the save and
the admin check; then the category's shared extra-key list is refreshed.
"""
from __future__ import annotations

import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import urlsplit

from fastapi import Depends

from _base.auth import current_user
from _base.db.session import role_connection
from _base.server_fn import FnCall, bad_input, fn_router, forbidden
from surfaces.etl.routers._sql import maybe_single

log = logging.getLogger(__name__)

router = fn_router("etl")

# The fetch tier decides first, exactly as exp_etl_fetch_tick does (proxy_render -> rendered,
# proxy -> server_crawl, direct -> direct); the crawl method only when no tier is set.
CRAWL_BY_TIER = {"proxy_render": "needs_js_api", "proxy": "server_crawl", "direct": "direct"}
CRAWL_BY_SOURCE = {"blocked_needs_proxy": "needs_proxy", "js_needs_api": "needs_js_api"}
MAX_GIVEN_URLS = 10
ADMIN_ROLES = ["super_admin", "architect"]
_HTTP_RE = re.compile(r"^https?://", re.IGNORECASE)


# --- small JS-parity helpers -----------------------------------------------


def js_number(value: Any) -> float:
    """JS `Number(x)`."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0.0
        try:
            return float(int(text, 0)) if text.lower().startswith(("0x", "0o", "0b")) else float(
                text
            )
        except ValueError:
            return math.nan
    return math.nan


def _id(num: float) -> int | float:
    return int(num) if float(num).is_integer() else num


def _js_string(value: Any) -> str:
    return "" if value is None else str(value)


def empty_v(value: Any) -> bool:
    return (
        value is None
        or (isinstance(value, str) and value.strip() == "")
        or (isinstance(value, list) and len(value) == 0)
    )


def _pick(obj: Any, *names: str, default: Any = None) -> Any:
    """Read a field from a dict or object result, under its snake_case or TS name."""
    for name in names:
        if isinstance(obj, dict):
            if name in obj:
                return obj[name]
        elif hasattr(obj, name):
            return getattr(obj, name)
    return default


def pattern_matches(url: str, pattern: str | None) -> bool:
    if not pattern:
        return True
    try:
        rx = re.compile(pattern)
    except re.error:
        return True
    return bool(rx.search(url) or rx.search(url.split("#")[0].split("?")[0]))


def given_url_problem(url: str, domain: str, pattern: str | None) -> str | None:
    """Why a reviewer-given URL is not fetched, or None when it may be fetched."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "not a valid address"
    if not parts.scheme:
        return "not a valid address"
    if parts.scheme.lower() not in ("http", "https"):
        return "not an http(s) address"
    host = (parts.hostname or "").lower()
    if not host:
        return "not a valid address"
    d = domain.lower()
    if host != d and not host.endswith("." + d):
        return f"not on {domain}"
    if not pattern_matches(url, pattern):
        return "does not match the contract's profile page pattern"
    return None


def parse_preview_input(raw: Any) -> dict:
    x = raw if isinstance(raw, dict) else {}
    num = js_number(x.get("proposalId"))
    urls: list[str] = []
    if isinstance(x.get("urls"), list):
        cleaned = [("" if u is None else str(u)).strip() for u in x["urls"]]
        urls = list(dict.fromkeys(u for u in cleaned if u))
    if len(urls) > MAX_GIVEN_URLS:
        raise bad_input(f"at most {MAX_GIVEN_URLS} URLs")
    if math.isfinite(num) and num > 0:
        return {"proposalId": _id(num), "domain": None, "gcid": None, "urls": urls}
    domain = x["domain"].strip().lower() if isinstance(x.get("domain"), str) else ""
    gcid = x["gcid"].strip() if isinstance(x.get("gcid"), str) else ""
    if not domain or not gcid:
        raise bad_input("proposalId, or domain and gcid, required")
    return {"proposalId": None, "domain": domain, "gcid": gcid, "urls": urls}


def crawl_method_for(src: dict | None) -> str:
    src = src or {}
    return (
        CRAWL_BY_TIER.get(_js_string(src.get("fetch_tier")))
        or CRAWL_BY_SOURCE.get(_js_string(src.get("crawl_method")))
        or "server_crawl"
    )


def sample_urls(sc: dict) -> list[str]:
    samples = sc.get("samples") if isinstance(sc.get("samples"), list) else []
    urls = []
    for s in samples:
        u = s if isinstance(s, str) else (s.get("url") if isinstance(s, dict) else None)
        if isinstance(u, str) and _HTTP_RE.match(u):
            urls.append(u)
    return list(dict.fromkeys(urls))[:5]


# --- preview ----------------------------------------------------------------


def _load_contract(db: Any, data: dict) -> dict:
    """The contract to preview: a pending proposal, or the saved contract of domain + gcid."""
    if data["proposalId"]:
        prop = maybe_single(
            db,
            "select proposal_id, category_slug, kind, payload from disco_proposals "
            "where proposal_id = %s",
            (data["proposalId"],),
        )
        if not prop or prop.get("kind") != "site_map":
            raise bad_input("proposal not found")
        p = prop.get("payload") or {}
        extraction = p.get("extraction") if isinstance(p, dict) else None
        dp = p.get("detail_pattern")
        return {
            "sc": extraction.get("site_contract") if isinstance(extraction, dict) else None,
            "domain": _js_string(p.get("domain")),
            "gcid": _js_string(prop.get("category_slug")),
            "field_floor": p.get("field_floor"),
            "detail_entity_type": p.get("detail_entity_type"),
            "detail_pattern": dp if isinstance(dp, str) else None,
            "target": f"proposal #{data['proposalId']}",
        }
    row = maybe_single(
        db,
        "select domain, category_slug, detail_pattern, field_floor, detail_entity_type, "
        "learned_at, extraction from disco_site_contract "
        "where domain = %s and category_slug = %s order by learned_at desc limit 1",
        (data["domain"], data["gcid"]),
    ) or {}
    extraction = row.get("extraction")
    dp = row.get("detail_pattern")
    return {
        "sc": extraction.get("site_contract") if isinstance(extraction, dict) else None,
        "domain": _js_string(row["domain"] if row.get("domain") is not None else data["domain"]),
        "gcid": _js_string(data["gcid"]),
        "field_floor": row.get("field_floor"),
        "detail_entity_type": row.get("detail_entity_type"),
        "detail_pattern": dp if isinstance(dp, str) else None,
        "target": "saved contract",
    }


def preview_one(
    url: str,
    *,
    why: str | None,
    sc: dict,
    names: set[str],
    firm_signatures: set[str],
    crawl_method: str,
    src: dict | None,
    field_floor: Any,
    detail_entity_type: Any,
) -> dict:
    """One preview record (never raises: failures become `{ok: False, reason}`)."""
    if why:
        return {"url": url, "ok": False, "reason": f"not fetched: {why}"}
    from _base.disco import detail_api as DA
    from _base.disco import site_contract as SC
    from _base.disco.webscraper import looks_blocked, scrape_website

    try:
        dr = sc.get("detail_route") or {}
        rs = dr.get("record_source")
        mode = rs if rs in ("api", "api+page") else "page"
        # 1. Profile API (contracts proven on it), as disco-detail-api-worker does.
        api_values: dict | None = None
        api_why = ""
        if mode != "page" and dr.get("api") and dr.get("json_fields"):
            got = DA.fetch_detail_for(dr["api"], url, 30_000)
            api_why = _pick(got, "why", default="") or ""
            if _pick(got, "json", default=None) is not None:  # TS: got.json !== undefined
                api_values = DA.json_values(_pick(got, "json"), dr["json_fields"])
        # JS truthiness: an empty values object still counts as the API having answered.
        answered = api_values is not None
        source = "page" if mode == "page" else (mode if answered else "page_fallback")
        # 2. Profile page (page contracts, api+page, or the API did not answer).
        page_values: dict = {}
        extras: dict = {}
        firm_relabelled: list = []
        if source != "api":
            page = scrape_website({"url": url, "crawl_method": crawl_method})
            ok = _pick(page, "ok", default=False)
            content = _pick(page, "content", default=None)
            status_code = _pick(page, "status_code", default=None)
            failed = not ok or not content or looks_blocked(status_code, content)
            if failed and not answered:
                base = (
                    "blocked" if ok and content else f"did not load (status {status_code or 0})"
                )
                reason = f"{base}; profile API: {api_why}" if api_why else base
                return {"url": url, "ok": False, "reason": reason}
            if not failed:
                opts = {"firm_signatures": firm_signatures}
                applied = SC.apply_site_contract(content, url, sc, names, opts)
                page_values = _pick(applied, "values", default={}) or {}
                firm_relabelled = (
                    _pick(applied, "firm_relabelled", "firmRelabelled", default=[]) or []
                )
                if not answered and SC.looks_not_found(
                    content, SC.apply_address_owner(page_values, sc)
                ):
                    return {"url": url, "ok": False, "reason": "page reads as not found"}
                extras = SC.apply_extra_fields(content, url, sc, names, opts)
        # 3. Merge: the JSON value wins where both have one; the page fills the rest.
        merged = dict(page_values)
        for k, v in (api_values or {}).items():
            if not empty_v(v):
                merged[k] = v
        filled = SC.apply_address_owner(SC.apply_value_rules(merged, sc, url), sc)
        own_key = sc.get("own_page_key")
        if (
            (src or {}).get("source_type") == "brand_site"
            and own_key
            and empty_v(filled.get(f"tax.{own_key}"))
        ):
            filled[f"tax.{own_key}"] = url
        rec = SC.build_harvest_record(
            contract=sc,
            values=filled,
            detail_url=url,
            detail_entity_type=detail_entity_type,
            field_floor=field_floor,
            firm_relabelled=firm_relabelled,
            extras=extras,
        )
        identity = _pick(rec, "identity_candidates", default={}) or {}
        return {
            "url": url,
            "ok": True,
            "entity_type": _pick(rec, "entity_type"),
            "filled": _pick(rec, "filled"),
            "floor_needed": _pick(rec, "floor_needed"),
            "shallow": _pick(rec, "shallow"),
            "must_have": _pick(rec, "must_have"),
            "universal": _pick(identity, "universal"),
            "payload": _pick(rec, "payload"),
            "identity": identity,
            "detail_source": source,
        }
    # per-URL failure is reported in the record, as in the TS
    except Exception as exc:  # noqa: BLE001
        return {"url": url, "ok": False, "reason": str(exc)[:200]}


def _require_admin(claims: dict) -> None:
    try:
        with role_connection("authenticated", claims) as conn, conn.cursor() as cur:
            cur.execute(
                "select exp_ctrl_has_role(p_roles := %s) as allowed", (ADMIN_ROLES,)
            )
            row = cur.fetchone()
        allowed = row.get("allowed") if row else None
    # the TS ignored the rpc error: anything but `true` is refused
    except Exception:  # noqa: BLE001
        allowed = None
    if allowed is not True:
        raise forbidden("insufficient_privilege")


@router.post("/previewSiteProposal")
def preview_site_proposal(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data = parse_preview_input(call.data)
    _require_admin(claims)

    with role_connection("service_role") as db:
        c = _load_contract(db, data)
        sc, domain, gcid = c["sc"], c["domain"], c["gcid"]
        if not isinstance(sc, dict) or not domain or js_number(sc.get("version")) < 3:
            raise bad_input("no site contract to preview")
    try:
        with role_connection("service_role") as db:
            src = maybe_single(
                db,
                "select crawl_method, fetch_tier, source_type from exp_etl_sources "
                "where source_domain = %s and gcid = %s limit 1",
                (domain, gcid),
            )
    # the TS ignored this read's error (src undefined)
    except Exception:  # noqa: BLE001
        src = None
    crawl_method = crawl_method_for(src)

    # Pages: the reviewer's URLs (checked first), else up to 5 of the contract's sample pages.
    skipped: dict[str, str] = {}
    if data["urls"]:
        urls = data["urls"]
        for u in urls:
            why = given_url_problem(u, domain, c["detail_pattern"])
            if why:
                skipped[u] = why
    else:
        urls = sample_urls(sc)
    if not urls:
        return {"domain": domain, "target": c["target"], "records": []}

    names_raw = sc.get("site_entity_names")
    names = set(names_raw) if isinstance(names_raw, list) else set()
    firm_signatures = set(sc.get("firm_signatures") or [])

    def run(u: str) -> dict:
        return preview_one(
            u,
            why=skipped.get(u),
            sc=sc,
            names=names,
            firm_signatures=firm_signatures,
            crawl_method=crawl_method,
            src=src,
            field_floor=c["field_floor"],
            detail_entity_type=c["detail_entity_type"],
        )

    with ThreadPoolExecutor(max_workers=len(urls)) as pool:
        records = list(pool.map(run, urls))
    return {"domain": domain, "target": c["target"], "records": records}


# --- accept -----------------------------------------------------------------


def parse_accept_input(raw: Any) -> dict:
    num = js_number(raw.get("proposalId") if isinstance(raw, dict) else None)
    if not math.isfinite(num) or num <= 0:
        raise bad_input("proposalId required")
    return {"proposalId": _id(num)}


@router.post("/acceptSiteProposal")
def accept_site_proposal(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data = parse_accept_input(call.data)
    # The DB function does the save and the admin check, with the reviewer's own session.
    with role_connection("authenticated", claims, write=True) as conn, conn.cursor() as cur:
        cur.execute(
            "select disco_accept_site_proposal(p_proposal_id := %s) as res",
            (data["proposalId"],),
        )
        row = cur.fetchone()
    res = (row or {}).get("res")
    out: dict = dict(res) if isinstance(res, dict) else {}
    try:
        from _base.disco.extra_keys import refresh_extra_keys

        domain = _js_string(res.get("domain") if isinstance(res, dict) else None)
        with role_connection("service_role", write=True) as db:
            prop = maybe_single(
                db,
                "select category_slug from disco_proposals where proposal_id = %s",
                (data["proposalId"],),
            )
            gcid = _js_string((prop or {}).get("category_slug"))
            contract = maybe_single(
                db,
                "select extraction from disco_site_contract "
                "where domain = %s and category_slug = %s",
                (domain, gcid),
            )
            extraction = (contract or {}).get("extraction")
            site_contract = (
                extraction.get("site_contract") if isinstance(extraction, dict) else None
            )
            extra_fields = (
                site_contract.get("extra_fields") if isinstance(site_contract, dict) else None
            )
            refresh_extra_keys(db, gcid, domain, extra_fields or {})
        out["extra_keys_refreshed"] = True
    except Exception as exc:  # noqa: BLE001
        out["extra_keys_refreshed"] = False
        out["extra_keys_error"] = str(exc)[:200]
    return out
