"""/professionals reads — port of the supabase-js calls in
surface-ui/admin/src/routes/_authenticated/professionals.tsx.

Run as the signed-in user (role `authenticated`), so professionals RLS (active rows only) applies
as it did for the browser. Lists are capped at MAX_ROWS like the PostgREST responses were.
"""
from __future__ import annotations

import re
from typing import Any

import psycopg
from sqlalchemy import and_, func, or_, select

from _base.core.sql import fetch_all, fetch_one
from _base.schema.tables import t_gbp_categories as cat_t
from _base.schema.tables import t_graph_nodes as nodes_t
from _base.schema.tables import t_organizations as org_t
from _base.schema.tables import t_professionals as pro_t
from _base.schema.tables import t_search_rank_scores as score_t

PAGE_SIZE = 50
NO_MATCH = "00000000-0000-0000-0000-000000000000"
LIST_COLUMNS = (
    "id", "first_name", "last_name", "display_name", "slug", "photo_url", "gcid", "job_title",
    "address_city", "address_state", "primary_org_id", "primary_license_number",
    "primary_license_verified", "claimed", "bio", "territory_id",
)
SCORE_RANGES = {"0-300": (0, 300), "300-600": (300, 600), "600-850": (600, 850)}


def _pattern(term: str) -> str:
    # PostgREST ilike: the value is the pattern, and `*` is also a wildcard.
    return f"%{term}%".replace("*", "%")


def category_options(conn: psycopg.Connection) -> list[str]:
    """Distinct non-null gcids in order. The TS walked them one request at a time, 200 at most."""
    g = pro_t.c.gcid
    stmt = select(g).where(g.is_not(None)).distinct().order_by(g).limit(200)
    return [r["gcid"] for r in fetch_all(conn, stmt)]


def stats(conn: psycopg.Connection) -> dict[str, int]:
    p = pro_t.c
    stmt = select(
        func.count().label("total"),
        func.count().filter(p.is_active.is_(True)).label("active"),
        func.count().filter(p.claimed.is_(True)).label("claimed"),
        func.count().filter(p.primary_license_verified.is_(True)).label("verified"),
    )
    return fetch_one(conn, stmt) or {"total": 0, "active": 0, "claimed": 0, "verified": 0}


def _score_ids(conn: psycopg.Connection, score: str) -> list[str]:
    s = score_t.c
    stmt = select(s.entity_id, s.total_score).where(s.entity_type == "professional")
    if score in SCORE_RANGES:
        lo, hi = SCORE_RANGES[score]
        stmt = stmt.where(s.total_score >= lo, s.total_score <= hi)
    return [str(r["entity_id"]) for r in fetch_all(conn, stmt)]


def page(
    conn: psycopg.Connection, *, search: str, gcid: str, location: str, claimed: str,
    score: str, page_no: int,
) -> dict[str, Any]:
    """One page of the list plus the exact count of every matching row (`count: "exact"`)."""
    p = pro_t.c
    where: list[Any] = []
    if score != "all":
        ids = _score_ids(conn, score)
        if score == "unscored":
            if ids:
                where.append(p.id.not_in(ids))
        else:
            where.append(p.id.in_(ids or [NO_MATCH]))
    if search.strip():
        s = _pattern(search.strip())
        where.append(or_(p.display_name.ilike(s), p.first_name.ilike(s), p.last_name.ilike(s)))
    if gcid != "all":
        where.append(p.gcid == gcid)
    if location.strip():
        loc = _pattern(location.strip())
        where.append(or_(p.address_city.ilike(loc), p.address_state.ilike(loc)))
    if claimed == "claimed":
        where.append(p.claimed.is_(True))
    if claimed == "unclaimed":
        where.append(p.claimed.is_(False))
    cond = and_(*where) if where else None

    rows_stmt = (
        select(*(p[k] for k in LIST_COLUMNS))
        .order_by(p.display_name.asc().nulls_last())
        .offset(page_no * PAGE_SIZE)
        .limit(PAGE_SIZE)
    )
    count_stmt = select(func.count().label("n")).select_from(pro_t)
    if cond is not None:
        rows_stmt = rows_stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    count = (fetch_one(conn, count_stmt) or {}).get("n", 0)
    return {"rows": fetch_all(conn, rows_stmt), "count": count}


def scores(conn: psycopg.Connection, ids: list[str]) -> dict[str, dict[str, Any]]:
    s = score_t.c
    rows = fetch_all(conn, select(s.entity_id, s.total_score, s.max_possible, s.local_rank,
                                  s.local_rank_of, s.gaps)
                     .where(s.entity_type == "professional", s.entity_id.in_(ids)))
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out[str(r["entity_id"])] = {
            "total": r["total_score"],
            "max": r["max_possible"] if r["max_possible"] is not None else 850,
            "rank": r["local_rank"],
            "rankOf": r["local_rank_of"],
        }
    return out


_PRODUCT = re.compile(r"product|service|offer", re.IGNORECASE)
_SOCIAL = re.compile(r"social|same_?as", re.IGNORECASE)
_CREDENTIAL = re.compile(r"credential|license|certif", re.IGNORECASE)


def depth(conn: psycopg.Connection, ids: list[str]) -> dict[str, dict[str, int]]:
    """Active graph nodes per professional by kind, over the same (capped) rows the page read."""
    n = nodes_t.c
    rows = fetch_all(conn, select(n.entity_id, n.node_type)
                     .where(n.entity_type == "professional", n.is_active.is_(True),
                            n.entity_id.in_(ids)))
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        d = out.setdefault(str(r["entity_id"]),
                           {"products": 0, "socials": 0, "credentials": 0, "total": 0})
        d["total"] += 1
        t = r["node_type"] or ""
        if _PRODUCT.search(t):
            d["products"] += 1
        elif _SOCIAL.search(t):
            d["socials"] += 1
        elif _CREDENTIAL.search(t):
            d["credentials"] += 1
    return out


def extras(conn: psycopg.Connection, org_ids: list[str], gcids: list[str]) -> dict[str, Any]:
    orgs: dict[str, str] = {}
    cats: dict[str, str] = {}
    if org_ids:
        for r in fetch_all(conn, select(org_t.c.id, org_t.c.name).where(org_t.c.id.in_(org_ids))):
            orgs[str(r["id"])] = r["name"]
    if gcids:
        for r in fetch_all(conn, select(cat_t.c.gcid, cat_t.c.display_name)
                           .where(cat_t.c.gcid.in_(gcids))):
            cats[r["gcid"]] = r["display_name"]
    return {"orgs": orgs, "cats": cats}
