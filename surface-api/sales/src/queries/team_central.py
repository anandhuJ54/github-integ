"""sales Team Central: lib/insurance-team.ts — the rows each supabase-js query returned, under the
names the page used. Split out of the seat queries when those moved to srp, then moved from xmp
(xmp/queries/team.py, /xmp/team/*) to sales, surface audit 2026-10-25 (§9 row E; same SQL).

Reads run as the signed-in user (RLS unchanged); any error is thrown, as the page did. The
commercial tables (exp_revenue_components etc.) are only read here.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db import tables as T
from _base.db.sql import fetch_many
from surfaces.sales.queries.catalog import cols

org_t = T.t_organizations


# --- lib/insurance-team.ts ---------------------------------------------------------------------

reps_t, terr_t, rev_t, quota_t, groups_t = T.t_exp_sales_reps, T.t_exp_territories, \
    T.t_exp_revenue_components, T.t_exp_sales_quotas, T.t_exp_category_groups
tb_t, exp_v, month_v = T.t_exp_territory_brand, T.t_v_logo_expansion, T.t_v_logo_expansion_month


def team_base(conn: psycopg.Connection, group_key: str) -> dict[str, Any]:
    """loadTeamCentral()'s first Promise.all (any error thrown, as the page did)."""
    rows = fetch_many(conn, {
        "reps": select(reps_t).where(reps_t.c.group_key == group_key).order_by(reps_t.c.role),
        "territories": select(terr_t).order_by(terr_t.c.tier, terr_t.c.seq),
        "revenue": select(*cols(rev_t, "id,seller_id,attributed_seller_id,amount,period_start,"
                                       "source")).where(rev_t.c.group_key == group_key),
        "quotas": select(quota_t).where(quota_t.c.group_key == group_key),
        "groups": select(groups_t.c.group_key, groups_t.c.label),
    })
    return rows


def team_family(conn: psycopg.Connection, family_key: str | None, territory_ids: list[str],
                year: int) -> dict[str, Any]:
    """The family-dependent reads, after the page picked the family and its territories: the
    territory→brand links, the linked organizations' names, the expansion views and the territory
    sellers' names (any error thrown, as the page did). The page reads only the sellers outside
    the team; every territory seller is returned here and the page's map keeps the same names."""
    stmts: dict[str, Any] = {}
    if territory_ids:
        stmts["links"] = select(tb_t.c.territory_id, tb_t.c.org_id) \
            .where(tb_t.c.territory_id.in_(territory_ids))
        linked = select(tb_t.c.org_id).where(tb_t.c.territory_id.in_(territory_ids))
        stmts["orgs"] = select(org_t.c.id, org_t.c.name).where(org_t.c.id.in_(linked))
        sellers = select(terr_t.c.seller_id).where(terr_t.c.id.in_(territory_ids),
                                                   terr_t.c.seller_id.is_not(None))
        stmts["sellers"] = select(reps_t.c.id, reps_t.c.name).where(reps_t.c.id.in_(sellers))
    if family_key:
        stmts["expansion"] = select(exp_v).where(exp_v.c.group_key == family_key) \
            .order_by(exp_v.c.year)
        m = month_v.c
        stmts["months"] = select(m.month_start, m.month_revenue, m.cumulative_revenue, m.year) \
            .where(m.group_key == family_key, m.year == year).order_by(m.month_start)
    rows = fetch_many(conn, stmts) if stmts else {}
    return {k: rows.get(k, []) for k in ("links", "orgs", "sellers", "expansion", "months")}
