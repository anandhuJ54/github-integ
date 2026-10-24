"""Live ETL run monitor (read-only) — port of surface-ui/etl/src/lib/etl-monitor.ts.

Every figure is a table read against exp_etl_staging, exp_etl_field_floors, professionals and
graph_nodes, made as the signed-in user (role `authenticated`, RLS applies) like the browser's
supabase-js reads were. The 11 `count=exact, head=true` requests become three aggregate
queries with FILTER clauses; the figures are the same.
"""
from __future__ import annotations

import math
from typing import Any

import psycopg
from sqlalchemy import func, nulls_last, select

from _base.core.sql import fetch_all, fetch_one
from _base.schema.tables import t_exp_etl_field_floors as floors_t
from _base.schema.tables import t_exp_etl_staging as stg_t
from _base.schema.tables import t_graph_nodes as nodes_t
from _base.schema.tables import t_professionals as pro_t

AGENT_GCID = "gcid:insurance_agent"
AGENCY_GCID = "gcid:insurance_agency"
# Depth baseline measured on the pre-deep core capture (~3 fields/profile).
BASELINE_FIELDS_PER_PROFILE = 3

_FLAGGED = ("shallow", "needs_review")


def _count(where: Any = None) -> Any:
    c = func.count()
    return c.filter(where) if where is not None else c


def staging_counts(conn: psycopg.Connection) -> dict[str, int]:
    s = stg_t.c
    stmt = select(
        _count().label("total"),
        _count(s.field_tier.in_(("deep", "enrichment"))).label("processed"),
        _count(s.field_tier == "core").label("remaining"),
        _count(s.resolution_status.in_(_FLAGGED)).label("flagged"),
    ).where(s.gcid == AGENT_GCID)
    return fetch_one(conn, stmt) or {}


def professional_counts(conn: psycopg.Connection) -> dict[str, int]:
    p = pro_t.c
    stmt = select(
        _count().label("profiles"),
        _count(p.bio.is_not(None)).label("withBio"),
        _count(p.photo_url.is_not(None)).label("withPhoto"),
        _count(p.gbp_place_id.is_not(None)).label("withPlaceId"),
    ).where(p.gcid == AGENCY_GCID, p.canonical_url.ilike("%statefarm.com/agent%"))
    return fetch_one(conn, stmt) or {}


def node_counts(conn: psycopg.Connection) -> dict[str, int]:
    n = nodes_t.c
    stmt = select(
        *(
            _count(n.node_type == t).label(t)
            for t in ("product_service", "social_profile", "credential")
        )
    ).where(n.source == "etl")
    return fetch_one(conn, stmt) or {}


def field_floors(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, select(floors_t).order_by(floors_t.c.gcid))


def recent_flagged(conn: psycopg.Connection) -> list[dict[str, Any]]:
    s = stg_t.c
    stmt = (
        select(s.stage_id, s.detail_url, s.resolution_status, s.payload, s.resolved_at)
        .where(s.resolution_status.in_(_FLAGGED))
        .order_by(nulls_last(s.resolved_at.desc()))
        .limit(10)
    )
    return fetch_all(conn, stmt)


def deep_field_counts(conn: psycopg.Connection) -> list[Any]:
    """payload->>field_count of up to 5000 deep rows (the TS filtered on payload->>field_tier)."""
    s = stg_t.c
    stmt = (
        select(s.payload["field_count"].astext.label("field_count"))
        .where(s.gcid == AGENT_GCID, s.payload["field_tier"].astext == "deep")
        .limit(5000)
    )
    return [r["field_count"] for r in fetch_all(conn, stmt)]


def _js_number(v: Any) -> float:
    """JS Number(v) for the values a ->> read can return (text or null)."""
    if v is None:
        return 0.0
    t = str(v).strip()
    if t == "":
        return 0.0
    try:
        return float(t)
    except ValueError:
        return float("nan")


def _round1(x: float) -> float:
    # Math.round(x * 10) / 10 — half up, not banker's rounding.
    return math.floor(x * 10 + 0.5) / 10


def _reasons(payload: Any) -> list[str]:
    raw = payload.get("gate_reasons") if isinstance(payload, dict) else None
    if isinstance(raw, list):
        return [_js_string(x) for x in raw]
    return [_js_string(raw)] if raw else []


def _js_string(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def load_etl_monitor(conn: psycopg.Connection) -> dict[str, Any]:
    stg = staging_counts(conn)
    pro = professional_counts(conn)
    nodes = node_counts(conn)
    floors = field_floors(conn)
    recent_rows = recent_flagged(conn)
    # Number.isFinite(n) && n > 0
    counts = [
        n for n in (_js_number(v) for v in deep_field_counts(conn)) if math.isfinite(n) and n > 0
    ]

    total, processed, flagged = stg["total"], stg["processed"], stg["flagged"]
    recent = [
        {
            "stage_id": str(r["stage_id"]),
            "detail_url": r["detail_url"],
            "resolution_status": str(r["resolution_status"]),
            "reasons": _reasons(r["payload"]),
            "resolved_at": r["resolved_at"],
        }
        for r in recent_rows
    ]
    avg = _round1(sum(counts) / len(counts)) if counts else None
    return {
        "progress": {
            "total": total,
            "processed": processed,
            "remaining": stg["remaining"],
            "pctComplete": processed / total if total else 0,
        },
        "yield": {
            "profiles": pro["profiles"],
            "withBio": pro["withBio"],
            "withPhoto": pro["withPhoto"],
            "withPlaceId": pro["withPlaceId"],
            "nodes": nodes,
        },
        "gate": {
            "floors": floors,
            "flagged": flagged,
            "shallowRate": flagged / processed if processed else 0,
            "recent": recent,
        },
        "depth": {
            "baseline": BASELINE_FIELDS_PER_PROFILE,
            "avgFieldsNow": int(avg) if avg is not None and avg.is_integer() else avg,
            "deepRows": len(counts),
        },
    }
