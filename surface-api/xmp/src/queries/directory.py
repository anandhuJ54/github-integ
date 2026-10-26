"""xmp directory read for the sales Directory brand drill-down: the brand rollup behind
surface-ui/sales/src/lib/sales-nav.ts loadBrandRollup (the /sales/brands/$orgId page; the
/sales/locations/$orgId page calls it too).

Moved from sales (sales/queries/nav.py load_brand_rollup), surface audit 2026-10-25: brand data
belongs to xmp, published for the sales pages. Same SQL. `count_stmt` and `count_of` are copied
from sales/queries/boards.py (no cross-Surface import).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. The claim events
are `.limit(10000)` with no ORDER BY, cut to an arbitrary 1000 by the PostgREST cap (950 at port
time).
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import func, select

from _base.db import tables as T
from _base.db.sql import fetch_all, fetch_many
from surfaces.xmp.queries.common import cols

pros = T.t_professionals
orgs = T.t_organizations
claims = T.t_exp_claim_events


def count_stmt(t: Any, *where: Any) -> Any:
    """select("id", { count: "exact", head: true }) with the filters: the exact count."""
    return select(func.count().label("n")).select_from(t).where(*where)


def count_of(rows: list[dict[str, Any]]) -> int | None:
    """The count, or null when the count failed (a tolerant read came back [])."""
    return rows[0]["n"] if rows else None


def brand_locations_stmt(org_id: str) -> Any:
    return (select(*cols(orgs, "id,name,entity_type,address_city,address_state,claimed,is_demo,"
                               "search_rank_score"))
            .where(orgs.c.parent_org_id == org_id).order_by(orgs.c.name.asc()).limit(500))


def brand_rollup_stmts(org_id: str) -> dict[str, Any]:
    """loadBrandRollup's ignored-error reads. viaOffices: professionals embedding their primary
    organization `!inner` filtered on its parent_org_id — the count of professionals whose
    primary org's parent is the brand."""
    via = pros.join(orgs, pros.c.primary_org_id == orgs.c.id)
    return {
        "childCount": count_stmt(orgs, orgs.c.parent_org_id == org_id),
        "directCount": count_stmt(pros, pros.c.primary_org_id == org_id),
        "viaOfficesCount": (select(func.count().label("n")).select_from(via)
                            .where(orgs.c.parent_org_id == org_id)),
        # .limit(10000), no ORDER BY: cut to 1000 by the cap, as PostgREST did
        "claims": (select(*cols(claims, "entity_id,entity_type,event_type"))
                   .where(claims.c.logo_org_id == org_id,
                          claims.c.event_type.in_(["claimed", "engaged", "upgraded"]))
                   .limit(10000)),
    }


def load_brand_rollup(conn: psycopg.Connection, org_id: str) -> dict[str, Any]:
    """`{ locations, childCount, directCount, viaOfficesCount, claims }`: the locations threw;
    the counts (null when failed) and the claim events were tolerant."""
    out: dict[str, Any] = {"locations": fetch_all(conn, brand_locations_stmt(org_id))}
    got = fetch_many(conn, brand_rollup_stmts(org_id), tolerant=True)
    for k in ("childCount", "directCount", "viaOfficesCount"):
        out[k] = count_of(got[k])
    out["claims"] = got["claims"]
    return out
