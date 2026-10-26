"""sales boards (S4) — port of the supabase-js calls in surface-ui/sales/src/lib/seller-desk.ts
(loadSellerDesk, countNewProfiles), seller-board.ts (loadSellerBoard), sales-board.ts
(loadBoardData, addNote, setCallbackPriority, requestReferral) and sales-story.ts (loadRoster,
loadCategoryStory): exp_sales_reps, exp_sales_quotas, exp_sales_rep_metrics, exp_sales_pipeline,
exp_sales_demos, exp_sales_notes, exp_sales_category_stats, exp_claim_events,
exp_revenue_components, exp_brand_adoption, exp_category_groups, exp_territories,
organizations, professionals.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads are the
browser's statements, PostgREST-shaped, returned raw: every status rule, pacing, attainment and
money rollup stays in the browser. None of these loaders checked an error (`data ?? []`,
`count ?? 0`, `if (!repRes.data) return null`), so every read here is tolerant; a count that
failed comes back null (the browser's `?? 0` stays in the browser).

The 1000-row cap (follow-up 1j): loadBoardData's claim events are `.limit(20000)` ordered by
occurred_at desc; PostgREST cut them to the newest 1000 of 3,474, and so does this. The seller
desk's claim events (no limit; the busiest seller has 926 at port time) would be cut the same way.

Writes are the browser's statements (only the keys sent, no RETURNING). requestReferral's
callback time, which the browser computed as `Date.now() + 2 days`, is the server's clock + 2
days. `seller_id` / `created_by` stay request fields: the callers send a rep id, not the
signed-in user (no caller sends created_by today).
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

import psycopg
from sqlalchemy import or_, select

from _base.db import tables as T
from _base.db.sql import fetch_many, typed
from surfaces.sales.internal import cols, count_of, count_stmt, execute, insert, now, update

reps = T.t_exp_sales_reps
quotas = T.t_exp_sales_quotas
metrics = T.t_exp_sales_rep_metrics
pipeline = T.t_exp_sales_pipeline
demos = T.t_exp_sales_demos
notes = T.t_exp_sales_notes
cat_stats = T.t_exp_sales_category_stats
claims = T.t_exp_claim_events
revenue = T.t_exp_revenue_components
adoption = T.t_exp_brand_adoption
groups = T.t_exp_category_groups
territories = T.t_exp_territories
orgs = T.t_organizations
pros = T.t_professionals

DESK_REP_COLS = ("id,name,role,group_key,title,team_name,email,phone,photo_url,sdrcloud_url,"
                 "attribution_target,is_demo")
BOARD_CLAIM_COLS = ("id,entity_label,entity_type,group_key,seller_id,territory_id,logo_org_id,"
                    "event_type,nora_engagement,upgraded,contact_phone,contact_email,state,is_demo,"
                    "occurred_at")
BOARD_METRIC_COLS = ("rep_id,period_start,group_key,views,attempted_claims,claims,engaged_30d,"
                     "demos_booked,demos_attended,upgrades,revenue,logos_assigned,"
                     "profiles_assigned,is_demo")
BOARD_NOTE_COLS = ("id,seller_id,subject_label,subject_type,body,callback_priority,callback_at,"
                   "created_by,created_at,is_demo")
BOARD_DEMO_COLS = ("id,seller_id,prospect_label,contact_phone,contact_email,booked_at,attended,"
                   "outcome,deal_value,is_demo")
BOARD_ADOPTION_COLS = ("id,org_id,group_key,active_users,engaged_users,referral_marketing,"
                       "referral_regional,referral_location,is_demo")


def _one(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the browser ignored: the row, or null for none — and null for
    2+ rows too (PostgREST's error left `data` null)."""
    return rows[0] if len(rows) == 1 else None


def _uniq(ids: list[Any]) -> list[Any]:
    """`[...new Set(ids.filter(Boolean))]`: truthy, first-seen order."""
    return list(dict.fromkeys(i for i in ids if i))


# --- seller-desk.ts --------------------------------------------------------------------------

def desk_rep_stmt(rep_id: str) -> Any:
    """.eq("id", repId).maybeSingle() (limit 2: enough to see a second row)."""
    return select(*cols(reps, DESK_REP_COLS)).where(reps.c.id == rep_id).limit(2)


def desk_territories_stmt(rep_id: str) -> Any:
    return (select(*cols(territories, "id,label,tier,brand_count,office_count,agent_count"))
            .where(territories.c.seller_id == rep_id).order_by(territories.c.label.asc()))


def desk_reads(rep_id: str, territory_ids: list[str]) -> dict[str, Any]:
    """loadSellerDesk's Promise.all, in its order. The two book counts only with territories
    (the browser answered `{ count: 0 }` without asking)."""
    stmts: dict[str, Any] = {}
    if territory_ids:
        stmts["bookTotal"] = count_stmt(pros, pros.c.territory_id.in_(territory_ids))
        stmts["bookClaimed"] = count_stmt(pros, pros.c.territory_id.in_(territory_ids),
                                          pros.c.claimed.is_(True))
    stmts["events"] = (select(*cols(claims, "event_type,occurred_at,upgraded"))
                       .where(claims.c.seller_id == rep_id))
    stmts["demos"] = (select(*cols(demos, "booked_at,attended,outcome,deal_value"))
                      .where(demos.c.seller_id == rep_id))
    stmts["revenue"] = (select(*cols(revenue, "source,amount,period_start,seller_id,"
                                              "attributed_seller_id"))
                        .where(or_(revenue.c.seller_id == rep_id,
                                   revenue.c.attributed_seller_id == rep_id)))
    stmts["quarters"] = (select(*cols(quotas, "period_start,target,actual"))
                         .where(quotas.c.rep_id == rep_id, quotas.c.period_type == "quarter")
                         .order_by(quotas.c.period_start.asc()))
    return stmts


def load_desk(conn: psycopg.Connection, rep_id: str) -> dict[str, Any] | None:
    """loadSellerDesk's rows: `{ rep, territories, bookTotal, bookClaimed, events, demos,
    revenue, quarters }` (counts: a number, or null when the count failed), or null when there is
    no rep (or two, or the read failed: the browser returned null on `!repRes.data`). Three rounds,
    as the browser: the rep, its territories, then the Promise.all."""
    rep = _one(fetch_many(conn, {"rep": desk_rep_stmt(rep_id)}, tolerant=True)["rep"])
    if rep is None:
        return None
    terr = fetch_many(conn, {"t": desk_territories_stmt(rep_id)}, tolerant=True)["t"]
    ids = [t["id"] for t in terr]
    got = fetch_many(conn, desk_reads(rep_id, ids), tolerant=True)
    return {
        "rep": rep,
        "territories": terr,
        "bookTotal": count_of(got["bookTotal"]) if ids else 0,
        "bookClaimed": count_of(got["bookClaimed"]) if ids else 0,
        "events": got["events"],
        "demos": got["demos"],
        "revenue": got["revenue"],
        "quarters": got["quarters"],
    }


def new_profiles_stmt(territory_ids: list[str], days: int) -> Any:
    """countNewProfiles: .in("territory_id", ids).gte("created_at", now - days); now from the
    server's clock."""
    since = now() - timedelta(days=days)
    return count_stmt(pros, pros.c.territory_id.in_(territory_ids),
                      pros.c.created_at >= typed(pros.c.created_at, since))


def count_new_profiles(conn: psycopg.Connection, territory_ids: list[str],
                       days: int) -> dict[str, int | None]:
    """`{ count }` (null when the count failed); the browser answers 0 for no territories
    without asking."""
    rows = fetch_many(conn, {"n": new_profiles_stmt(territory_ids, days)}, tolerant=True)["n"]
    return {"count": count_of(rows)}


# --- seller-board.ts -------------------------------------------------------------------------

def seller_board_stmts() -> dict[str, Any]:
    return {
        "reps": select(*cols(reps, "id,name,role,group_key,is_demo")).order_by(reps.c.name.asc()),
        "quotas": (select(*cols(quotas, "rep_id,period_type,period_start,target,actual,is_demo"))
                   .where(quotas.c.period_type == "month")
                   .order_by(quotas.c.period_start.desc())),
        "pipeline": select(*cols(pipeline, "owner,stage,value,is_demo")),
    }


def load_seller_board(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadSellerBoard's three reads (`data ?? []`), one round trip: `{ reps, quotas, pipeline }`."""
    return fetch_many(conn, seller_board_stmts(), tolerant=True)


# --- sales-board.ts --------------------------------------------------------------------------

def board_stmts() -> dict[str, Any]:
    """loadBoardData's Promise.all, in its order."""
    return {
        "reps": (select(*cols(reps, "id,name,email,role,group_key,on_duty,is_demo,photo_url"))
                 .order_by(reps.c.name.asc())),
        # .limit(20000): cut to the newest 1000 by the cap, as PostgREST did (follow-up 1j)
        "events": (select(*cols(claims, BOARD_CLAIM_COLS))
                   .order_by(claims.c.occurred_at.desc()).limit(20000)),
        "revenue": select(*cols(revenue, "id,seller_id,territory_id,group_key,source,amount,"
                                         "period_start,is_demo")),
        "demos": select(*cols(demos, BOARD_DEMO_COLS)),
        "notes": select(*cols(notes, BOARD_NOTE_COLS)).order_by(notes.c.created_at.desc()),
        "quotas": (select(*cols(quotas, "rep_id,group_key,period_start,target,actual,period_type"))
                   .where(quotas.c.period_type == "month")),
        "metrics": select(*cols(metrics, BOARD_METRIC_COLS)),
        "territories": select(*cols(territories, "id,label,tier,group_key,seller_id,brand_count,"
                                                 "office_count,agent_count")),
        "groups": (select(*cols(groups, "group_key,label,is_catchall"))
                   .order_by(groups.c.label.asc())),
        "adoption": select(*cols(adoption, BOARD_ADOPTION_COLS)),
    }


def board_org_ids(got: dict[str, list[dict[str, Any]]]) -> list[Any]:
    """The adoption rows' org_id then the events' logo_org_id, truthy, first seen."""
    return _uniq([*(a.get("org_id") for a in got["adoption"]),
                  *(e.get("logo_org_id") for e in got["events"])])


def load_board(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadBoardData's rows, raw: the ten reads (one round trip), then the organizations of the
    adoption rows and the claim events' logos (only when there are any; no ORDER BY). The
    browser keeps every mapping and the Number() coercions."""
    got = fetch_many(conn, board_stmts(), tolerant=True)
    ids = board_org_ids(got)
    got["orgs"] = fetch_many(conn, {"orgs": (
        select(*cols(orgs, "id,name,logo_url,is_demo")).where(orgs.c.id.in_(ids)))},
        tolerant=True)["orgs"] if ids else []
    return got


def add_note(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """addNote: exp_sales_notes insert({seller_id, subject_label, subject_type, body,
    callback_priority, callback_at, created_by}) (the keys the page sent)."""
    execute(conn, insert(notes, values))


def request_referral(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """requestReferral → addNote with subject_type "referral_request", callback_priority true and
    callback_at = now + 2 days (the server's clock)."""
    execute(conn, insert(notes, {
        "seller_id": values.get("seller_id"),
        "subject_label": values.get("subject_label"),
        "subject_type": "referral_request",
        "body": values.get("body"),
        "callback_priority": True,
        "callback_at": now() + timedelta(days=2),
        "created_by": values.get("created_by"),
    }))


def set_callback_priority(conn: psycopg.Connection, note_id: str, on: bool) -> None:
    """setCallbackPriority: update({ callback_priority }).eq("id", noteId)."""
    execute(conn, update(notes, note_id, {"callback_priority": on}))


# --- sales-story.ts --------------------------------------------------------------------------

def roster_stmts() -> dict[str, Any]:
    return {
        "reps": select(*cols(reps, "id,name,role,group_key,is_demo")).order_by(reps.c.name.asc()),
        "metrics": select(metrics).order_by(metrics.c.period_start.desc()),
        "quotas": (select(*cols(quotas, "rep_id,period_type,period_start,target,actual,is_demo"))
                   .where(quotas.c.period_type == "month")
                   .order_by(quotas.c.period_start.desc())),
        "stats": select(cat_stats.c.group_key, cat_stats.c.label),
    }


def load_roster(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadRoster's four reads (`data ?? []`), one round trip: `{ reps, metrics, quotas, stats }`."""
    return fetch_many(conn, roster_stmts(), tolerant=True)


def category_story_stmts() -> dict[str, Any]:
    return {
        "stats": select(cat_stats),
        "metrics": select(metrics),
        "reps": select(reps.c.id, reps.c.group_key),
    }


def load_category_story(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadCategoryStory's three reads (`data ?? []`), one round trip: `{ stats, metrics, reps }`."""
    return fetch_many(conn, category_story_stmts(), tolerant=True)
