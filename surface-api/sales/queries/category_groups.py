"""sales category groups (S4) — port of the supabase-js calls in
surface-ui/sales/src/lib/category-groups.ts (exp_category_groups, exp_category_group_members,
gbp_categories, exp_sales_quotas, exp_sales_rep_metrics, exp_sales_reps, exp_sales_pipeline; the
territory reads go through sales/queries/territories.py) and of loadAdminGroups / loadHydration in
surface-ui/sales/src/lib/territory-admin.ts (exp_etl_staging counts).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads are the
browser's statements, PostgREST-shaped (the 1000-row cap, numeric → JSON number); a function that
made several reads gets them back in one response, raw, and the browser still joins and rolls up
(the scorecard, the overview, the hydration percentage). Reads whose error the browser ignored are
tolerant here too.

The 1000-row cap: none of these reads has a LIMIT over 1000. Uncapped reads that could pass it are
cut at 1000, as PostgREST did: the members (6 rows at port time), quotas (91), rep metrics (22) and
the scorecard's exp_sales_pipeline read (91, no ORDER BY). The exp_etl_staging reads are exact
counts (`{ count: "exact", head: true }`), computed in SQL: not capped.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import func, or_, select

from _base.core.sql import fetch_all, fetch_many
from _base.schema import tables as T
from sales.queries.cpq import cols, execute
from sales.queries.territories import category_names_stmt, slots_stmt

groups = T.t_exp_category_groups
members = T.t_exp_category_group_members
categories = T.t_gbp_categories
quotas = T.t_exp_sales_quotas
metrics = T.t_exp_sales_rep_metrics
reps = T.t_exp_sales_reps
pipeline = T.t_exp_sales_pipeline
staging = T.t_exp_etl_staging

GROUP_QUOTA_COLS = "id,rep_id,group_key,period_type,period_start,target,actual,is_demo"


def groups_stmt() -> Any:
    """loadCategoryGroups: select("*").order("label")."""
    return select(groups).order_by(groups.c.label.asc())


def list_groups(conn: psycopg.Connection) -> list:
    return fetch_all(conn, groups_stmt())


def admin_groups_stmt() -> Any:
    """loadAdminGroups: select("group_key,label,is_catchall").order("label")."""
    return (select(groups.c.group_key, groups.c.label, groups.c.is_catchall)
            .order_by(groups.c.label.asc()))


def admin_groups(conn: psycopg.Connection) -> list:
    return fetch_all(conn, admin_groups_stmt())


def members_stmt(group_key: str | None) -> Any:
    """loadGroupMembers: select("id,group_key,gcid").order("gcid")[.eq("group_key")]."""
    stmt = select(*cols(members, "id,group_key,gcid"))
    if group_key:
        stmt = stmt.where(members.c.group_key == group_key)
    return stmt.order_by(members.c.gcid.asc())


def group_members(conn: psycopg.Connection, group_key: str | None) -> dict[str, list]:
    """loadGroupMembers' reads: the members (threw), then their categories' names (error
    ignored; only when there is a gcid). The browser labels them."""
    rows = fetch_all(conn, members_stmt(group_key))
    gcids = list(dict.fromkeys(r["gcid"] for r in rows))
    cats = (fetch_many(conn, {"cats": category_names_stmt(gcids)}, tolerant=True)["cats"]
            if gcids else [])
    return {"members": rows, "cats": cats}


def quotas_stmt(group_key: str | None) -> Any:
    """loadGroupQuotas: select(GROUP_QUOTA_COLS).order("period_start", desc)[.eq("group_key")]."""
    stmt = select(*cols(quotas, GROUP_QUOTA_COLS))
    if group_key:
        stmt = stmt.where(quotas.c.group_key == group_key)
    return stmt.order_by(quotas.c.period_start.desc())


def group_quotas(conn: psycopg.Connection, group_key: str | None) -> list:
    return fetch_all(conn, quotas_stmt(group_key))


def metrics_stmt(group_key: str | None) -> Any:
    """loadGroupMetrics: exp_sales_rep_metrics select("*").order("period_start", desc)
    [.eq("group_key")]."""
    stmt = select(metrics)
    if group_key:
        stmt = stmt.where(metrics.c.group_key == group_key)
    return stmt.order_by(metrics.c.period_start.desc())


def group_metrics(conn: psycopg.Connection, group_key: str | None) -> list:
    return fetch_all(conn, metrics_stmt(group_key))


def search_stmt(term: str) -> Any:
    """searchCategories: select("gcid,display_name")
    .or(`display_name.ilike.%t%,gcid.ilike.%t%`).limit(25) (no ORDER BY)."""
    pat = f"%{term}%"
    return (select(categories.c.gcid, categories.c.display_name)
            .where(or_(categories.c.display_name.ilike(pat), categories.c.gcid.ilike(pat)))
            .limit(25))


def search_categories(conn: psycopg.Connection, term: str) -> list:
    return fetch_all(conn, search_stmt(term))


def scorecard(conn: psycopg.Connection, group_key: str) -> dict[str, list]:
    """loadGroupScorecard's Promise.all: quotas, metrics, territories (each threw: they are
    loadGroupQuotas / loadGroupMetrics / loadGroupTerritories), then reps and pipeline (errors
    ignored). The browser builds the cards."""
    out = fetch_many(conn, {
        "quotas": quotas_stmt(group_key),
        "metrics": metrics_stmt(group_key),
        "territories": slots_stmt(None, group_key),
    })
    out.update(fetch_many(conn, {
        "reps": select(*cols(reps, "id,name,role,group_key,is_demo")).order_by(reps.c.name.asc()),
        "pipeline": select(*cols(pipeline, "owner,stage,value,is_demo")),
    }, tolerant=True))
    return out


def staging_count_stmt(gcids: list[str], deep: bool) -> Any:
    """loadHydration's head(): exp_etl_staging select("stage_id", { count: "exact", head: true })
    .in("gcid", gcids)[.eq("payload->>field_tier", "deep")] — the count only."""
    stmt = select(func.count().label("count")).select_from(staging).where(staging.c.gcid.in_(gcids))
    if deep:
        stmt = stmt.where(staging.c.payload["field_tier"].astext == "deep")
    return stmt


def hydration(conn: psycopg.Connection, group_key: str) -> dict[str, Any]:
    """loadHydration's reads: the member gcids (threw), then (only when there is one) the two
    counts (errors ignored: null). The browser computes the percentage."""
    rows = fetch_all(conn, select(members.c.gcid).where(members.c.group_key == group_key))
    gcids = [r["gcid"] for r in rows]
    if not gcids:
        return {"members": rows, "total": None, "deep": None}
    got = fetch_many(conn, {"total": staging_count_stmt(gcids, False),
                            "deep": staging_count_stmt(gcids, True)}, tolerant=True)
    def count(k: str) -> int | None:
        return got[k][0]["count"] if got[k] else None

    return {"members": rows, "total": count("total"), "deep": count("deep")}


def add_member(conn: psycopg.Connection, group_key: str, gcid: str) -> None:
    """addGroupMember: insert({ group_key, gcid })."""
    execute(conn, members.insert().inline().values(group_key=group_key, gcid=gcid))


def remove_member(conn: psycopg.Connection, member_id: str) -> None:
    """removeGroupMember: delete().eq("id", id)."""
    execute(conn, members.delete().where(members.c.id == member_id))
