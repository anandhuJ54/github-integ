"""Deep-hydration writer (port of `lib/etl-deep-hydrate.server.ts`).

Takes a parsed State Farm agent page and lands it in:
  1. exp_etl_staging.payload (+ field_tier='deep')
  2. the matching professionals row (enrichment)
  3. graph_nodes for the professional (ring 2 products/socials, ring 3 licenses)
  4. team members as professionals under the same office (Location) + credential
Deterministic. No AI. The caller supplies a service-role (write) psycopg connection.

Note: like the TS, `replace_etl_nodes` deletes and inserts `graph_nodes` rows directly instead
of going through the governed upsert function (ported as-is; flagged in the port report).
"""
from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
from psycopg import sql
from psycopg.types.json import Jsonb

from etl.statefarm import parse_ok, parse_state_farm_agent

BRAND_ORG_ID = "bbbbbbb1-0000-4000-8000-000000000001"  # State Farm brand org
LICENSE_TYPE = "Insurance Producer License"
GCID = "gcid:insurance_agency"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)

DEFAULT_FLOOR: dict[str, Any] = {
    "gcid": "*",
    "min_fields": 8,
    "required_keys": [],
    "min_products": 0,
    "min_licenses": 0,
}

PENDING_SELECT = "stage_id, detail_url, payload"

_NODE_TYPES = ["product_service", "social_profile", "credential"]


# ---- small helpers ------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(UTC)


def _iso(d: datetime | None = None) -> str:
    """``new Date().toISOString()``."""
    d = d or _now()
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def _js_round(x: float) -> int:
    return math.floor(x + 0.5)


def hash_slug(prefix: str, seed: str, length: int) -> str:
    return prefix + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:length]


def split_name(full: str) -> dict[str, str]:
    parts = full.strip().split()
    return {
        "first": parts[0] if parts else full,
        "last": " ".join(parts[1:]) if len(parts) > 1 else "",
    }


def _q(conn: Any, query: Any, params: tuple | list | None = None) -> list[dict]:
    """Execute one statement; rows when it returns any."""
    with conn.cursor() as cur:
        cur.execute(query, params)
        return list(cur.fetchall()) if cur.description else []


def _insert(conn: Any, table: str, row: dict[str, Any], returning: str | None = None) -> list[dict]:
    cols = list(row)
    query = sql.SQL("insert into {} ({}) values ({}){}").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(c) for c in cols),
        sql.SQL(", ").join(sql.Placeholder() for _ in cols),
        sql.SQL(f" returning {returning}") if returning else sql.SQL(""),
    )
    return _q(conn, query, [row[c] for c in cols])


def _update_by(conn: Any, table: str, patch: dict[str, Any], key: str, value: Any) -> None:
    cols = list(patch)
    query = sql.SQL("update {} set {} where {} = %s").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in cols),
        sql.Identifier(key),
    )
    _q(conn, query, [*(patch[c] for c in cols), value])


def _err(prefix: str, fn: Callable[[], Any]) -> Any:
    """`if (error) throw new Error(`${prefix}: ${error.message}`)`."""
    try:
        return fn()
    except Exception as e:
        raise RuntimeError(f"{prefix}: {e}") from e


def fetch_agent_html(url: str, timeout_ms: int = 20000) -> str:
    res = httpx.get(
        url,
        headers={
            "user-agent": USER_AGENT,
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
            "upgrade-insecure-requests": "1",
        },
        follow_redirects=True,
        timeout=timeout_ms / 1000,
    )
    if not (200 <= res.status_code < 300):
        raise Exception(f"fetch {res.status_code}")  # noqa: TRY002
    return res.text


# ---- office (Location) ----------------------------------------------------------------------
def ensure_office(conn: Any, f: dict[str, Any]) -> str | None:
    office_name = f"{f['name']} — State Farm" if f.get("name") else None
    if not office_name:
        return None

    if f.get("street") and f.get("city") and f.get("state"):
        data = _q(
            conn,
            "select id from organizations where entity_type = 'office' and address_street = %s "
            "and address_city = %s and address_state = %s limit 1",
            (f["street"], f["city"], f["state"]),
        )
        if data:
            return str(data[0]["id"])

    by_name = _q(
        conn,
        "select id from organizations where entity_type = 'office' and name = %s "
        "and address_city = %s limit 1",
        (office_name, f.get("city") if f.get("city") is not None else ""),
    )
    if by_name:
        return str(by_name[0]["id"])

    slug = hash_slug("sf-office-", f"{f['detail_url']}|office", 16)
    created = _err("office insert", lambda: _insert(conn, "organizations", {
        "name": office_name,
        "slug": slug,
        "entity_type": "office",
        "gcid": GCID,
        "schema_type": "Organization",
        "parent_org_id": BRAND_ORG_ID,
        "address_street": f.get("street"),
        "address_city": f.get("city"),
        "address_state": f.get("state"),
        "address_zip": f.get("postal_code"),
        "address_country": "US",
        "latitude": f.get("latitude"),
        "longitude": f.get("longitude"),
        "phone": f.get("phone"),
        "website_url": f.get("website_url"),
        "logo_url": f.get("logo"),
        "gbp_place_id": f.get("gbp_place_id"),
        "is_active": True,
        "is_demo": False,
    }, "id"))
    if len(created) != 1:
        raise RuntimeError("office insert: expected one row")
    return str(created[0]["id"])


# ---- professional -----------------------------------------------------------------------------
def find_professional(conn: Any, f: dict[str, Any]) -> str | None:
    by_url = _q(conn, "select id from professionals where canonical_url = %s limit 1",
                (f["detail_url"],))
    if by_url:
        return str(by_url[0]["id"])

    # Phone is office-unique for State Farm agents: strongest secondary key.
    phone_digits = _digits(f.get("phone"))
    if len(phone_digits) == 10:
        by_phone = _q(
            conn,
            "select id, phone, display_name from professionals where phone = %s or phone = %s "
            "limit 5",
            (f.get("phone"), phone_digits),
        )
        hit = next((r for r in by_phone if _digits(str(r.get("phone") or "")) == phone_digits),
                   None)
        if hit:
            return str(hit["id"])

    if not f.get("name") or not f.get("city") or not f.get("state"):
        return None

    data = _q(
        conn,
        "select id, phone from professionals where display_name = %s and address_city = %s "
        "and address_state = %s limit 20",
        (f["name"], f["city"], f["state"]),
    )
    if not data:
        return None
    phone = _digits(f.get("phone"))
    exact = next((r for r in data if phone and _digits(str(r.get("phone") or "")) == phone), None)
    return str((exact or data[0])["id"])


def upsert_professional(conn: Any, f: dict[str, Any], office_id: str | None) -> dict[str, Any]:
    licenses = f.get("licenses") or []
    primary = next((lic for lic in licenses if lic.get("primary")), None) or (
        licenses[0] if licenses else None
    )
    city, state = f.get("city"), f.get("state")
    patch: dict[str, Any] = {
        "display_name": f.get("name"),
        "headline": f"State Farm Insurance Agent — {city}, {state}" if city and state else None,
        "bio": f.get("bio"),
        "short_bio": f.get("short_bio"),
        "photo_url": f.get("photo_url"),
        "cover_photo_url": f.get("cover_photo_url"),
        "canonical_url": f["detail_url"],
        "job_title": "State Farm Agent",
        "phone": f.get("phone"),
        "website_url": f.get("website_url"),
        "address_city": city,
        "address_state": state,
        "address_zip": f.get("postal_code"),
        "gbp_place_id": f.get("gbp_place_id"),
        "primary_license_number": primary["number"] if primary else None,
        "primary_license_type": LICENSE_TYPE if primary else None,
        "primary_license_state": primary["state"] if primary else None,
        "languages": f["languages"] if f.get("languages") else None,
        "markets_served": f["area_served"] if f.get("area_served") else None,
        "same_as": [s["url"] for s in f["social"]] if f.get("social") else None,
        "schema_type": "InsuranceAgency",
        "gcid": GCID,
        "is_active": True,
        "is_demo": False,
        "updated_at": _now(),
    }
    if office_id:
        patch["primary_org_id"] = office_id

    existing = find_professional(conn, f)
    if existing:
        _err("pro update", lambda: _update_by(conn, "professionals", patch, "id", existing))
        return {"id": existing, "created": False}

    name = split_name(f.get("name") or "Unknown")
    slug = hash_slug("sf-", f["detail_url"], 24)
    data = _err("pro insert", lambda: _insert(
        conn, "professionals",
        {**patch, "first_name": name["first"], "last_name": name["last"], "slug": slug}, "id",
    ))
    if len(data) != 1:
        raise RuntimeError("pro insert: expected one row")
    return {"id": str(data[0]["id"]), "created": True}


# ---- graph nodes --------------------------------------------------------------------------------
def nodes_for(entity_id: str, f: dict[str, Any]) -> list[dict[str, Any]]:
    base = {
        "entity_type": "professional",
        "entity_id": entity_id,
        "source": "etl",
        "source_url": f["detail_url"],
        "fetched_at": _now(),
        "is_active": True,
        "verified": False,
    }
    rows: list[dict[str, Any]] = []
    for p in f.get("products") or []:
        rows.append({
            **base, "ring": 2, "node_type": "product_service", "title": p["name"],
            "url": p.get("url"), "schema_property": "makesOffer",
            "extracted_data": {"description": p.get("description")},
        })
    for s in f.get("social") or []:
        rows.append({
            **base, "ring": 2, "node_type": "social_profile", "title": s["platform"],
            "url": s["url"], "schema_property": "sameAs",
        })
    for lic in f.get("licenses") or []:
        rows.append({
            **base, "ring": 3, "node_type": "credential", "title": lic["raw"],
            "schema_property": "hasCredential",
            "extracted_data": {
                "license_number": lic["number"],
                "license_state": lic["state"],
                "license_type": LICENSE_TYPE,
                "primary": lic["primary"],
            },
        })
    return rows


def _db_node(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    if "extracted_data" in out:
        out["extracted_data"] = Jsonb(out["extracted_data"])
    return out


def replace_etl_nodes(conn: Any, entity_id: str, rows: list[dict[str, Any]]) -> None:
    """Direct delete + insert on graph_nodes, as the TS did (not the governed upsert)."""
    _err("node delete", lambda: _q(
        conn,
        "delete from graph_nodes where entity_type = 'professional' and entity_id = %s "
        "and source = 'etl' and node_type = any(%s)",
        (entity_id, _NODE_TYPES),
    ))
    if not rows:
        return

    def ins() -> None:
        for r in rows:
            _insert(conn, "graph_nodes", _db_node(r))

    _err("node insert", ins)


# ---- team members ----------------------------------------------------------------------------
def upsert_team(conn: Any, f: dict[str, Any], office_id: str | None) -> int:
    if not office_id:
        return 0
    created = 0
    for m in f.get("team") or []:
        name = split_name(m["name"])
        slug = hash_slug("sf-", f"{f['detail_url']}|team|{m['name']}", 24)
        patch: dict[str, Any] = {
            "display_name": m["name"],
            "first_name": name["first"],
            "last_name": name["last"],
            "job_title": m.get("role"),
            "bio": m.get("description"),
            "photo_url": m.get("photo_url"),
            "primary_org_id": office_id,
            "address_city": f.get("city"),
            "address_state": f.get("state"),
            "address_zip": f.get("postal_code"),
            "gcid": GCID,
            "schema_type": "Person",
            "primary_license_number": m.get("license"),
            "primary_license_type": LICENSE_TYPE if m.get("license") else None,
            "primary_license_state": f.get("state"),
            "is_active": True,
            "is_demo": False,
            "updated_at": _now(),
        }
        existing = _q(conn, "select id from professionals where slug = %s limit 1", (slug,))
        if existing:
            mid = str(existing[0]["id"])
            _err("team update", lambda mid=mid, patch=patch: _update_by(
                conn, "professionals", patch, "id", mid))
        else:
            data = _err("team insert", lambda patch=patch, slug=slug: _insert(
                conn, "professionals", {**patch, "slug": slug}, "id"))
            if len(data) != 1:
                raise RuntimeError("team insert: expected one row")
            mid = str(data[0]["id"])
            created += 1

        if m.get("license"):
            replace_etl_nodes(conn, mid, [{
                "entity_type": "professional",
                "entity_id": mid,
                "source": "etl",
                "source_url": f["detail_url"],
                "fetched_at": _now(),
                "is_active": True,
                "verified": False,
                "ring": 3,
                "node_type": "credential",
                "title": f"Lic# {m['license']}",
                "schema_property": "hasCredential",
                "extracted_data": {
                    "license_number": m["license"],
                    "license_state": f.get("state"),
                    "license_type": LICENSE_TYPE,
                    "role": m.get("role"),
                },
            }])
    return created


# ---- field-yield gate ----------------------------------------------------------------------------
def load_field_floor(conn: Any, gcid: str) -> dict[str, Any]:
    rows = _q(
        conn,
        "select gcid, min_fields, required_keys, min_products, min_licenses "
        "from exp_etl_field_floors where gcid = %s limit 2",
        (gcid,),
    )
    # maybeSingle: zero or more than one row -> no data -> the default floor
    return dict(rows[0]) if len(rows) == 1 else {**DEFAULT_FLOOR, "gcid": gcid}


def gate_fields(f: dict[str, Any], floor: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    fc = f.get("field_count", 0)
    if fc < floor["min_fields"]:
        reasons.append(f"field_count {fc} < min_fields {floor['min_fields']}")
    if len(f.get("products") or []) < floor["min_products"]:
        reasons.append(f"products {len(f.get('products') or [])} < min {floor['min_products']}")
    if len(f.get("licenses") or []) < floor["min_licenses"]:
        reasons.append(f"licenses {len(f.get('licenses') or [])} < min {floor['min_licenses']}")
    for key in floor.get("required_keys") or []:
        v = f.get(key)
        if v is None or v == "" or (isinstance(v, list) and not v):
            reasons.append(f"missing required key '{key}'")
    return {"passed": not reasons, "reasons": reasons, "field_count": fc}


def mark_shallow(conn: Any, row: dict[str, Any], reasons: list[str],
                 f: dict[str, Any] | None) -> None:
    payload = {
        **(row.get("payload") or {}),
        **(f or {}),
        "field_tier": "shallow",
        "extraction": "sf_deep_v1",
        "gate_passed": False,
        "gate_reasons": reasons,
        "gate_checked_at": _iso(),
    }
    _err("staging shallow update", lambda: _q(
        conn,
        "update exp_etl_staging set payload = %s, resolution_status = 'shallow' "
        "where stage_id = %s",
        (Jsonb(payload), row["stage_id"]),
    ))


# ---- orchestration ----------------------------------------------------------------------------------
_NO_LD = "no JSON-LD agency object on detail page"


def _verdict(f: dict[str, Any], floor: dict[str, Any]) -> dict[str, Any]:
    if parse_ok(f):
        return gate_fields(f, floor)
    return {"passed": False, "reasons": [_NO_LD], "field_count": f["field_count"]}


def hydrate_staging_row(
    conn: Any,
    row: dict[str, Any],
    html: str,
    floor: dict[str, Any],
    refetch: Callable[[str], str] | None = None,
) -> dict[str, Any]:
    url = row.get("detail_url") or ""
    f = parse_state_farm_agent(html, url)
    verdict = _verdict(f, floor)

    # The gate re-checks once after a fresh deep extraction of the detail_url, so a
    # transient/partial fetch is not recorded as a shallow capture.
    if not verdict["passed"] and refetch and url:
        try:
            retry = parse_state_farm_agent(refetch(url), url)
            retry_verdict = _verdict(retry, floor)
            if retry_verdict["passed"] or retry["field_count"] > f["field_count"]:
                f, verdict = retry, retry_verdict
        except Exception:  # noqa: BLE001, S110 - keep the first verdict
            pass

    if not verdict["passed"]:
        mark_shallow(conn, row, verdict["reasons"], f if parse_ok(f) else None)
        return {
            "stage_id": row["stage_id"],
            "detail_url": url,
            "ok": False,
            "shallow": True,
            "gate_reasons": verdict["reasons"],
            "field_count": verdict["field_count"],
            "error": f"field-yield gate: {'; '.join(verdict['reasons'])}",
        }

    office_id = ensure_office(conn, f)
    pro = upsert_professional(conn, f, office_id)
    replace_etl_nodes(conn, pro["id"], nodes_for(pro["id"], f))
    created_team = upsert_team(conn, f, office_id)

    # The governed staging table constrains field_tier to 'core' | 'enrichment', so the deep
    # tier is recorded as 'enrichment' with field_tier:'deep' in payload.
    payload = {
        **(row.get("payload") or {}),
        **f,
        "field_tier": "deep",
        "extraction": "sf_deep_v1",
        "gate_passed": True,
        "gate_reasons": [],
        "hydrated_at": _iso(),
    }
    _err("staging update", lambda: _q(
        conn,
        "update exp_etl_staging set payload = %s, field_tier = 'enrichment', "
        "resolution_status = 'created' where stage_id = %s",
        (Jsonb(payload), row["stage_id"]),
    ))

    out: dict[str, Any] = {
        "stage_id": row["stage_id"],
        "detail_url": url,
        "ok": True,
        "professional_id": pro["id"],
    }
    if office_id:
        out["office_id"] = office_id
    out.update({
        "field_count": f["field_count"],
        "products": len(f["products"]),
        "socials": len(f["social"]),
        "licenses": len(f["licenses"]),
        "team": len(f["team"]),
        "has_bio": bool(f.get("bio")),
        "created_professional": pro["created"],
        "created_team": created_team,
    })
    return out


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [r for r in results if r.get("ok")]
    n = len(ok)

    def pct(k: int) -> float:
        return _js_round(k / n * 1000) / 10 if n else 0

    def num(v: float) -> int | float:
        return int(v) if float(v).is_integer() else v

    def total(key: str) -> int:
        return sum(r.get(key) or 0 for r in ok)

    return {
        "processed": len(results),
        "parsed": n,
        "promoted": n,
        "shallow": len([r for r in results if r.get("shallow")]),
        "failed": len([r for r in results if not r.get("ok") and not r.get("shallow")]),
        "avg_fields": num(_js_round(total("field_count") / n * 10) / 10) if n else 0,
        "pct_with_bio": num(pct(len([r for r in ok if r.get("has_bio")]))),
        "pct_with_products": num(pct(len([r for r in ok if (r.get("products") or 0) > 0]))),
        "pct_with_socials": num(pct(len([r for r in ok if (r.get("socials") or 0) > 0]))),
        "pct_with_licenses": num(pct(len([r for r in ok if (r.get("licenses") or 0) > 0]))),
        "pct_with_team": num(pct(len([r for r in ok if (r.get("team") or 0) > 0]))),
        "team_members_created": total("created_team"),
        "professionals_created": len([r for r in ok if r.get("created_professional")]),
        "failures": [
            {"url": r.get("detail_url"), "shallow": bool(r.get("shallow")), "error": r.get("error")}
            for r in results if not r.get("ok")
        ],
    }


def load_pending_staging_rows(
    conn: Any, gcid: str, limit: int, include_urls: list[str] | None = None
) -> list[dict[str, Any]]:
    """Rows still awaiting deep hydration: not yet deep, not gate-flagged shallow."""
    include_urls = include_urls or []
    rows: list[dict[str, Any]] = []
    if include_urls:
        rows.extend(_q(
            conn,
            f"select {PENDING_SELECT} from exp_etl_staging where gcid = %s "
            "and detail_url = any(%s)",
            (gcid, include_urls),
        ))
    if len(rows) < limit:
        data = _err("queue load", lambda: _q(
            conn,
            f"select {PENDING_SELECT} from exp_etl_staging where gcid = %s "
            "and detail_url is not null and resolution_status <> 'shallow' "
            "and (payload->>'field_tier' is null or payload->>'field_tier' <> 'deep') "
            "order by observed_at asc limit %s",
            (gcid, limit),
        ))
        seen = {str(r["stage_id"]) for r in rows}
        for r in data:
            if len(rows) >= limit:
                break
            if str(r["stage_id"]) in seen:
                continue
            rows.append(r)
    return rows[:limit]


def load_core_staging_rows(
    conn: Any, limit: int, include_urls: list[str] | None = None
) -> list[dict[str, Any]]:
    """Backwards-compatible alias used by the pilot runner."""
    return load_pending_staging_rows(conn, "gcid:insurance_agent", limit, include_urls)


def hydration_progress(conn: Any, gcid: str) -> dict[str, Any]:
    def count(extra: str = "") -> int:
        rows = _q(conn, f"select count(*) as n from exp_etl_staging where gcid = %s{extra}",
                  (gcid,))
        return int(rows[0]["n"]) if rows else 0

    total = count()
    deep = count(" and payload->>'field_tier' = 'deep'")
    shallow = count(" and resolution_status = 'shallow'")
    return {
        "gcid": gcid, "total": total, "deep": deep, "shallow": shallow,
        "remaining": max(total - deep - shallow, 0),
    }
