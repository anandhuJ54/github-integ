"""/organizations reads — port of the supabase-js calls in
surface-ui/admin/src/routes/_authenticated/organizations.tsx (the stat tiles are `_base`'s
loadOrgStats and move with `_base`)."""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import and_, func, select

from _base.core.sql import fetch_all, fetch_one
from _base.schema.tables import t_organizations as org_t

PAGE_SIZE = 50
# ORG_COLUMNS in surface-ui/_base/src/lib/console-surfaces.ts
ORG_COLUMNS = (
    "id", "name", "slug", "gcid", "entity_type", "parent_org_id", "claimed", "is_active",
    "is_demo", "search_rank_score", "score_updated_at", "address_city", "address_state", "phone",
    "website_url", "hierarchy_depth", "gbp_connected",
)


def category_options(conn: psycopg.Connection) -> list[str]:
    """Distinct gcids among the rows the page read (`limit(5000)`, capped at MAX_ROWS), sorted."""
    g = org_t.c.gcid
    rows = fetch_all(conn, select(g).where(g.is_not(None)).limit(5000))
    return sorted({r["gcid"] for r in rows})


def page(conn: psycopg.Connection, *, search: str, gcid: str, status: str, scope: str,
         page_no: int) -> dict[str, Any]:
    o = org_t.c
    where: list[Any] = []
    if search.strip():
        where.append(o.name.ilike(f"%{search.strip()}%".replace("*", "%")))
    if gcid != "all":
        where.append(o.gcid == gcid)
    if status == "claimed":
        where.append(o.claimed.is_(True))
    if status == "unclaimed":
        where.append(o.claimed.is_not(True))
    if status == "scored":
        where.append(o.search_rank_score.is_not(None))
    if scope == "real":
        where.append(o.is_demo.is_not(True))
    if scope == "demo":
        where.append(o.is_demo.is_(True))
    rows_stmt = (
        select(*(o[k] for k in ORG_COLUMNS))
        # id breaks ties, so a row can't move between pages (the TS had none)
        .order_by(o.search_rank_score.desc().nulls_last(), o.name.asc(), o.id)
        .offset(page_no * PAGE_SIZE)
        .limit(PAGE_SIZE)
    )
    count_stmt = select(func.count().label("n")).select_from(org_t)
    if where:
        rows_stmt = rows_stmt.where(and_(*where))
        count_stmt = count_stmt.where(and_(*where))
    count = (fetch_one(conn, count_stmt) or {}).get("n", 0)
    return {"rows": fetch_all(conn, rows_stmt), "count": count}
