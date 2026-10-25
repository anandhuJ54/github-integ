"""Search control plane (/search, /search/indexing, /search/sponsored, /search/ads, /search/voce) —
port of surface-ui/admin/src/lib/search-console.ts (moved from the search Surface, surface audit
2026-10-25).

Runs as the signed-in user (role `authenticated`), so access is exactly what the browser had.
Several of these tables have RLS off with full grants (docs/SECURITY_FINDINGS.md SF-1/2/3); the
fix belongs to the DB security release, not to this port. The indexing RPCs are the governed
functions the page called; nothing here turns indexing on (site_indexing_enabled is refused).
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from _base.core.sql import compile_sql, fetch_many, jsonish
from _base.schema import tables as T

cats_t, rollup_t = T.t_gbp_categories, T.t_exp_page_views_rollup
agent_t, queue_t, part_t = T.t_exp_index_agent, T.t_exp_index_queue, T.t_exp_sitemap_partition
log_t, config_t = T.t_exp_index_submission_log, T.t_exp_index_config
pricing_t, slots_t, ads_t = T.t_exp_sponsored_pricing, T.t_exp_sponsored_slots, T.t_exp_web_ads

# The site-wide switch is flipped only through setSiteIndexing (super admin), never here.
SITE_INDEXING_KEY = "site_indexing_enabled"
# exp_index_sync / exp_index_submit_tick pipeline order (QUEUE_STATES in the TS)
QUEUE_STATES = ("held", "pending", "submitting", "submitted", "indexed")
PRICING_PATCH = frozenset({"tier", "spots", "pricing_mode", "monthly_price", "floor_price",
                           "price_per_1k_views", "notes"})
AD_PATCH = frozenset(c.name for c in ads_t.columns) - {"id", "created_at"}


class Refused(ValueError):
    """A write this page may not make (unknown column, or the site indexing switch)."""


def _exec(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def _rpc(conn: psycopg.Connection, sql: str, params: dict[str, Any] | None = None) -> Any:
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None


# --- reads -----------------------------------------------------------------------------------

def category_labels(conn: psycopg.Connection) -> list[dict[str, Any]]:
    c = cats_t.c
    return fetch_many(conn, {"c": select(c.gcid, c.display_name, c.slug)
                             .order_by(c.display_name.asc())})["c"]


def launched_categories(conn: psycopg.Connection) -> list[dict[str, Any]]:
    c = cats_t.c
    return fetch_many(conn, {"c": select(c.gcid, c.display_name, c.slug)
                             .where(c.is_launched.is_(True))
                             .order_by(c.display_name.asc()).limit(500)})["c"]


def overview_rollup(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_many(conn, {"r": select(rollup_t).order_by(rollup_t.c.day.desc())
                             .limit(5000)})["r"]


def indexing(conn: psycopg.Connection) -> dict[str, Any]:
    q = queue_t.c
    r = fetch_many(conn, {
        "agents": select(agent_t).order_by(agent_t.c.gcid.asc()),
        "queue": select(queue_t).order_by(q.thoroughness_pct.desc()).limit(500),
        "partitions": select(part_t).order_by(part_t.c.min_score.desc()),
        "log": select(log_t).order_by(log_t.c.submitted_at.desc()).limit(100),
        "config": select(config_t.c.key, config_t.c.value, config_t.c.updated_at),
    })
    # coverage: one count per state, as the five `count: "exact", head: true` requests were;
    # their errors were ignored (count null), so a failed count is null here too.
    cov = fetch_many(conn, {"cov": select(*(
        func.count().filter(q.state == s).label(s) for s in QUEUE_STATES))}, tolerant=True)["cov"]
    counts = cov[0] if cov else {}
    r["coverage"] = [{"state": s, "count": counts.get(s)} for s in QUEUE_STATES]
    return r


def sponsored(conn: psycopg.Connection) -> dict[str, Any]:
    return fetch_many(conn, {
        "pricing": select(pricing_t).order_by(pricing_t.c.monthly_price.desc()),
        "slots": select(slots_t).order_by(slots_t.c.geo_value.asc(), slots_t.c.position.asc()),
        "rollup": select(rollup_t).limit(5000),
    })


def ads(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_many(conn, {"a": select(ads_t).order_by(ads_t.c.created_at.desc())})["a"]


# --- writes ----------------------------------------------------------------------------------

def set_agent_active(conn: psycopg.Connection, agent_id: str, active: bool) -> None:
    _exec(conn, update(agent_t).where(agent_t.c.id == agent_id).values(active=active))


def set_index_config(conn: psycopg.Connection, key: str, value: str) -> None:
    if key == SITE_INDEXING_KEY:
        raise Refused("Use the site indexing switch (super admin)")
    stmt = pg_insert(config_t).values(key=key, value=value, updated_at=func.now())
    _exec(conn, stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": stmt.excluded.value, "updated_at": func.now()}))


def rebuild_sitemap(conn: psycopg.Connection) -> Any:
    return _rpc(conn, "select public.exp_sitemap_rebuild()")


def submit_tick(conn: psycopg.Connection, batch: int) -> Any:
    return _rpc(conn, "select public.exp_index_submit_tick(p_batch => %(b)s)", {"b": batch})


def sync_queue(conn: psycopg.Connection) -> Any:
    return _rpc(conn, "select public.exp_index_sync()")


def _only(patch: dict[str, Any], allowed: frozenset[str]) -> dict[str, Any]:
    unknown = set(patch) - allowed
    if unknown or not patch:
        raise Refused(f"unknown or empty patch {sorted(unknown)}")
    return patch


def update_pricing(conn: psycopg.Connection, pricing_id: str, patch: dict[str, Any]) -> None:
    _exec(conn, update(pricing_t).where(pricing_t.c.id == pricing_id)
          .values(**_only(patch, PRICING_PATCH)))


def assign_slot(conn: psycopg.Connection, slot_id: str, a: dict[str, Any]) -> None:
    lock = bool(a.get("lock"))
    _exec(conn, update(slots_t).where(slots_t.c.id == slot_id).values(
        advertiser_name=a["advertiser_name"], price=a.get("price"), status=a["status"],
        pricing_mode=a.get("pricing_mode"),
        locked_price=a.get("price") if lock else None,
        locked_per_1k=a.get("per_1k") if lock else None,
        locked_at=func.now() if lock else None,
    ))


def lock_slot_rate(conn: psycopg.Connection, slot_id: str, price: Any, per1k: Any) -> None:
    _exec(conn, update(slots_t).where(slots_t.c.id == slot_id)
          .values(locked_price=price, locked_per_1k=per1k, locked_at=func.now()))


def release_slot(conn: psycopg.Connection, slot_id: str) -> None:
    _exec(conn, update(slots_t).where(slots_t.c.id == slot_id).values(
        advertiser_name=None, advertiser_org_id=None, price=None, status="open",
        locked_price=None, locked_per_1k=None, locked_at=None))


def create_slot(conn: psycopg.Connection, gcid: str, geo_value: str, position: int) -> None:
    _exec(conn, insert(slots_t).values(gcid=gcid, geo_type="zip", geo_value=geo_value,
                                       position=position, status="open", is_demo=True))


def create_ad(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    _exec(conn, insert(ads_t).values(
        name=v["name"], placement=v["placement"], context=v["context"],
        target_gcid=v.get("target_gcid"), target_geo=v.get("target_geo"),
        budget=v.get("budget"), starts_on=v.get("starts_on") or None,
        ends_on=v.get("ends_on") or None, creative={}, status="draft", spend=0))


def update_ad(conn: psycopg.Connection, ad_id: str, patch: dict[str, Any]) -> None:
    patch = {k: v for k, v in patch.items() if k not in ("id", "created_at")}
    _exec(conn, update(ads_t).where(ads_t.c.id == ad_id).values(**_only(patch, AD_PATCH)))


def delete_ad(conn: psycopg.Connection, ad_id: str) -> None:
    _exec(conn, delete(ads_t).where(ads_t.c.id == ad_id))
