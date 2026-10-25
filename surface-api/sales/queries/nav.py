"""sales navigation (S4) — port of the supabase-js calls in surface-ui/sales/src/lib/sales-nav.ts:
the overview (exp_sales_reps, exp_sales_quotas, exp_contracts, gbp_categories, professionals,
organizations, exp_activity_events, exp_sales_assignments), the universal browse and the
drill-downs (search_rank_scores, exp_activity_events, exp_sales_reps, exp_sales_quotas,
exp_sales_assignments, exp_contracts, gbp_categories, exp_account_tier).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads are the
browser's statements, PostgREST-shaped and raw: the browser keeps the attribution, sold-by and
quota math, the browse row mapping and the team grouping. Reads whose error the browser threw
throw here (a 4xx with the database's message); the ones it ignored (`data ?? []`,
`count ?? 0`) are tolerant, and a failed count is null.

`count: "exact"` is a count(*) over the same filters (computed in SQL, not cut by the cap); with
`.range(from, to)` the rows are OFFSET from LIMIT to - from + 1, and an offset past the count is
PostgREST's 416 (supabase-js threw it). `ilike` patterns turn `*` into `%`, as PostgREST did.

The 1000-row cap: the overview's activity events are `.limit(5000)` with no ORDER BY, cut to an
arbitrary 1000 by PostgREST, and the same here (138 rows in all at port time). The brand
rollup's claim events are `.limit(10000)` with no ORDER BY (950 at port time).

loadProfessional / loadOrg moved to srp (srp/queries/directory.py) and loadBrandRollup to xmp
(xmp/queries/directory.py), surface audit 2026-10-25.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

import psycopg
from sqlalchemy import select

from _base.core.sql import fetch_all, fetch_many, typed
from _base.schema import tables as T
from sales.queries.boards import count_of, count_stmt
from sales.queries.cpq import cols, maybe_single

reps = T.t_exp_sales_reps
quotas = T.t_exp_sales_quotas
contracts = T.t_exp_contracts
cats = T.t_gbp_categories
pros = T.t_professionals
orgs = T.t_organizations
activity = T.t_exp_activity_events
assignments = T.t_exp_sales_assignments
scores = T.t_search_rank_scores
tiers = T.t_exp_account_tier

QUOTA_COLS = "id,rep_id,group_key,period_type,period_start,target,actual,is_demo"
SCORE_COLS = "entity_id,total_score,max_possible,score_pct,local_rank,local_rank_of,gaps,calculated_at"
EVENT_COLS = "id,event_type,subject_type,subject_id,account_id,logo,location,actor,occurred_at,is_demo"
CAT_COLS = "gcid,display_name,status,entity_type,estimated_profiles"
PRO_COLS = ("id,display_name,slug,job_title,address_city,address_state,gcid,claimed,is_demo,"
            "search_rank_score")
ORG_BROWSE_COLS = ("id,name,slug,entity_type,address_city,address_state,gcid,claimed,is_demo,"
                   "parent_org_id,hierarchy_depth")
BRAND_TYPES = ["brand", "enterprise", "company"]
LOCATION_TYPES = ["office", "location", "branch", "firm"]
TABS = ("categories", "teams", "sellers", "brands", "locations", "professionals")


class RangeNotSatisfiable(ValueError):
    """PostgREST answered a `.range()` starting past the exact count with 416 (PGRST103)."""


# --- loadOverview ----------------------------------------------------------------------------

def overview_stmts(period: str, since: dt.date) -> dict[str, Any]:
    """loadOverview's Promise.all, in its order. `sinceTs` is `${since}T00:00:00Z`."""
    since_ts = dt.datetime(since.year, since.month, since.day, tzinfo=dt.UTC)
    return {
        "reps": select(*cols(reps, "id,name,email,role,group_key,is_demo")),
        "quotas": (select(*cols(quotas, QUOTA_COLS))
                   .where(quotas.c.period_type == period,
                          quotas.c.period_start == typed(quotas.c.period_start, since))),
        "contracts": select(*cols(contracts, "id,name,status,mrr,account_id,created_by,is_demo,"
                                             "created_at")),
        "cats": count_stmt(cats, cats.c.status == "active"),
        "proClaims": count_stmt(pros, pros.c.is_demo.is_(False),
                                pros.c.claimed_at >= typed(pros.c.claimed_at, since_ts)),
        "orgClaims": count_stmt(orgs, orgs.c.is_demo.is_(False),
                                orgs.c.claimed_at >= typed(orgs.c.claimed_at, since_ts)),
        # .limit(5000), no ORDER BY: cut to 1000 by the cap, as PostgREST did
        "events": (select(*cols(activity, "id,event_type,account_id,logo,is_demo,occurred_at"))
                   .where(activity.c.occurred_at >= typed(activity.c.occurred_at, since_ts))
                   .limit(5000)),
        "assignments": select(*cols(assignments, "rep_id,assignment_type,target_ref")),
    }


def load_overview(conn: psycopg.Connection, period: str, since: dt.date) -> dict[str, Any]:
    """`{ reps, quotas, contracts, cats, proClaims, orgClaims, events, assignments }` (counts:
    a number or null); nothing was checked, so all tolerant; one round trip."""
    got = fetch_many(conn, overview_stmts(period, since), tolerant=True)
    for k in ("cats", "proClaims", "orgClaims"):
        got[k] = count_of(got[k])
    return got


# --- browse ----------------------------------------------------------------------------------

def like_of(q: str) -> str:
    """`%${q.trim()}%` as PostgREST read it (`*` is a `%` wildcard too)."""
    return f"%{q.strip()}%".replace("*", "%")


def browse_stmts(tab: str, q: str, offset: int, limit: int, gcid: str | None,
                 include_demo: bool) -> tuple[Any, Any] | Any:
    """(rows, count) for a paged tab; the reps read for teams / sellers."""
    if tab in ("teams", "sellers"):
        return (select(*cols(reps, "id,name,email,role,group_key,is_demo"))
                .order_by(reps.c.group_key.asc(), reps.c.name.asc()))
    if tab == "categories":
        t, sel, order = cats, CAT_COLS, cats.c.display_name
        where = [cats.c.display_name.ilike(like_of(q))] if q.strip() else []
    elif tab == "professionals":
        t, sel, order = pros, PRO_COLS, pros.c.display_name
        where = []
        if not include_demo:
            where.append(pros.c.is_demo.is_(False))
        if gcid:
            where.append(pros.c.gcid == gcid)
        if q.strip():
            where.append(pros.c.display_name.ilike(like_of(q)))
    else:  # brands / locations: organizations
        t, sel, order = orgs, ORG_BROWSE_COLS, orgs.c.name
        where = [orgs.c.entity_type.in_(BRAND_TYPES if tab == "brands" else LOCATION_TYPES)]
        if not include_demo:
            where.append(orgs.c.is_demo.is_(False))
        if gcid:
            where.append(orgs.c.gcid == gcid)
        if q.strip():
            where.append(orgs.c.name.ilike(like_of(q)))
    rows = select(*cols(t, sel)).where(*where).order_by(order.asc()).offset(offset).limit(limit)
    return rows, count_stmt(t, *where)


def browse(conn: psycopg.Connection, tab: str, q: str, page: int, page_size: int,
           gcid: str | None, include_demo: bool) -> dict[str, Any]:
    """browse's read (threw): `{ rows, count }` for categories / professionals / brands /
    locations (the page's rows and the exact count), `{ rows, count: null }` for teams / sellers
    (every rep by group_key, name; the browser groups, filters and pages them)."""
    offset = (page - 1) * page_size
    stmts = browse_stmts(tab, q, offset, page_size, gcid, include_demo)
    if not isinstance(stmts, tuple):
        return {"rows": fetch_all(conn, stmts), "count": None}
    got = fetch_many(conn, {"rows": stmts[0], "count": stmts[1]})
    count = count_of(got["count"])
    if count is not None and offset > count:
        raise RangeNotSatisfiable(
            f"Requested range not satisfiable: An offset of {offset} was requested, "
            f"but there are only {count} rows.")
    return {"rows": got["rows"], "count": count}


# --- drill-downs -----------------------------------------------------------------------------

def score_stmt(entity_id: str) -> Any:
    """loadScore: .eq("entity_id").order("calculated_at", desc).limit(1).maybeSingle()."""
    return (select(*cols(scores, SCORE_COLS)).where(scores.c.entity_id == entity_id)
            .order_by(scores.c.calculated_at.desc()).limit(1))


def load_score(conn: psycopg.Connection, entity_id: str) -> dict[str, Any] | None:
    return maybe_single(fetch_all(conn, score_stmt(entity_id)))


def events_for_stmt(subject_id: str | None, account_id: str | None, logo: str | None,
                    location: str | None) -> Any:
    """loadEventsFor: the first of subjectId / accountId / logo / location that is set."""
    stmt = select(*cols(activity, EVENT_COLS))
    if subject_id:
        stmt = stmt.where(activity.c.subject_id == subject_id)
    elif account_id:
        stmt = stmt.where(activity.c.account_id == account_id)
    elif logo:
        stmt = stmt.where(activity.c.logo == logo)
    elif location:
        stmt = stmt.where(activity.c.location == location)
    return stmt.order_by(activity.c.occurred_at.desc()).limit(200)


def load_events_for(conn: psycopg.Connection, subject_id: str | None, account_id: str | None,
                    logo: str | None, location: str | None) -> list[dict[str, Any]]:
    return fetch_all(conn, events_for_stmt(subject_id, account_id, logo, location))


def load_seller(conn: psycopg.Connection, rep_id: str) -> dict[str, Any]:
    """loadSeller: the rep (threw; 406 for two), then its quotas (period_start desc) and
    assignments (ignored errors)."""
    rep = maybe_single(fetch_all(conn, select(reps).where(reps.c.id == rep_id).limit(2)))
    got = fetch_many(conn, {
        "quotas": (select(*cols(quotas, QUOTA_COLS)).where(quotas.c.rep_id == rep_id)
                   .order_by(quotas.c.period_start.desc())),
        "assignments": select(assignments).where(assignments.c.rep_id == rep_id),
    }, tolerant=True)
    return {"rep": rep, **got}


def load_seller_book(conn: psycopg.Connection, account_ids: list[str]) -> dict[str, Any]:
    """loadSellerBook: the accounts' contracts (threw), then their 500 newest activity events
    (ignored error). The browser answers empty lists for no accounts without asking."""
    out = {"contracts": fetch_all(conn, select(contracts)
                                  .where(contracts.c.account_id.in_(account_ids)))}
    out["events"] = fetch_many(conn, {"events": (
        select(*cols(activity, "id,event_type,account_id,logo,location,occurred_at,is_demo"))
        .where(activity.c.account_id.in_(account_ids))
        .order_by(activity.c.occurred_at.desc()).limit(500))}, tolerant=True)["events"]
    return out


def load_category_dashboard(conn: psycopg.Connection, gcid: str) -> dict[str, Any]:
    """loadCategoryDashboard: the category (threw; 406 for two), then the org / professional
    counts and 25 sample orgs by name (ignored errors)."""
    category = maybe_single(fetch_all(conn, select(cats).where(cats.c.gcid == gcid).limit(2)))
    got = fetch_many(conn, {
        "orgCount": count_stmt(orgs, orgs.c.gcid == gcid, orgs.c.is_demo.is_(False)),
        "proCount": count_stmt(pros, pros.c.gcid == gcid, pros.c.is_demo.is_(False)),
        "sampleOrgs": (select(*cols(orgs, "id,name,entity_type,address_city,address_state,claimed"))
                       .where(orgs.c.gcid == gcid, orgs.c.is_demo.is_(False))
                       .order_by(orgs.c.name.asc()).limit(25)),
    }, tolerant=True)
    return {"category": category, "orgCount": count_of(got["orgCount"]),
            "proCount": count_of(got["proCount"]), "sampleOrgs": got["sampleOrgs"]}


def load_team(conn: psycopg.Connection, group_key: str) -> dict[str, Any]:
    """loadTeam: the group's reps by role (threw), then its quotas and account tiers (ignored
    errors; no ORDER BY)."""
    out = {"reps": fetch_all(conn, select(reps).where(reps.c.group_key == group_key)
                             .order_by(reps.c.role.asc()))}
    out.update(fetch_many(conn, {
        "quotas": select(*cols(quotas, QUOTA_COLS)).where(quotas.c.group_key == group_key),
        "tiers": select(tiers).where(tiers.c.group_key == group_key),
    }, tolerant=True))
    return out
