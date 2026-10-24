"""sales opportunities (S3) — port of the supabase-js calls in
surface-ui/sales/src/lib/opportunity-file.ts (the opportunity list and file: exp_sales_pipeline,
exp_accounts, exp_sales_reps, exp_pipeline_stages, exp_stage_requirements, the exp_opportunity_*
tables, exp_contacts, exp_sales_notes, exp_sales_tasks, exp_sales_demos, exp_activity_events,
exp_claim_events, exp_contracts, exp_contract_line_items, exp_price_book, exp_products,
exp_quotes, organizations, exp_territory_brand, exp_territory_seats, search_rank_scores,
audit_log; the exp_opp_* RPCs) and of the AuditPanel reads in
components/sales/opportunity-automation.tsx (exp_opportunity_owner_history,
exp_promo_redemptions).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads are the
browser's statements, PostgREST-shaped (the 1000-row cap, numeric → JSON number). The opportunity
file's reads come back in one response, raw: which reads run, and with which ids, follows the
browser's control flow exactly (the uuid checks, the brand → territory → seats → reps chain);
every join, mapping and the logo-intelligence rollup (the money math: ARR = Σ mrr × 12, the
catalog prices) stays in the browser. Reads whose error the browser ignored (`data ?? []`,
`.data` of a failed `.maybeSingle()`) are tolerant here too; the ones it threw are not.

The 1000-row cap: the claim-events read for one logo is `.limit(10000)`, which PostgREST cut to
1000; one logo has 1,850 claim events at port time, so it is still cut to 1000 (1:1).

Writes are the browser's statements, one endpoint per supabase-js call (the browser still runs
them in its order: the row, then the activity event, then the audit_log row, each its own
request, so an audit failure still leaves the row written, as before). Constant columns the
browser hard-coded (subject_type "opportunity", source / source_origin "manual", done false,
is_demo false, attended true, entity_type "opportunity") are set here; `occurred_at`, which the
browser stamped with `new Date().toISOString()`, is the server's clock. The actor-like columns
(seller_id, created_by, owner_id, actor, uploaded_by) stay request fields: the callers fill them
with the opportunity's owner (rep id / name), not the signed-in user.
"""
from __future__ import annotations

import re
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import and_, func, or_, select

from _base.core.sql import fetch_all, fetch_many
from _base.schema import tables as T
from sales.queries.contracts import call, rpc_call
from sales.queries.cpq import cols, execute, maybe_single, now, single

pipeline = T.t_exp_sales_pipeline
accounts = T.t_exp_accounts
reps = T.t_exp_sales_reps
stages = T.t_exp_pipeline_stages
requirements = T.t_exp_stage_requirements
opp_contacts = T.t_exp_opportunity_contacts
opp_products = T.t_exp_opportunity_products
opp_files = T.t_exp_opportunity_files
opp_history = T.t_exp_opportunity_stage_history
owner_history = T.t_exp_opportunity_owner_history
contacts = T.t_exp_contacts
notes = T.t_exp_sales_notes
tasks = T.t_exp_sales_tasks
demos = T.t_exp_sales_demos
activity = T.t_exp_activity_events
claims = T.t_exp_claim_events
contracts = T.t_exp_contracts
lines = T.t_exp_contract_line_items
book = T.t_exp_price_book
products = T.t_exp_products
quotes = T.t_exp_quotes
orgs = T.t_organizations
territory_brand = T.t_exp_territory_brand
seats = T.t_exp_territory_seats
rank_scores = T.t_search_rank_scores
redemptions = T.t_exp_promo_redemptions
audit = T.t_audit_log

OPP_COLS = ("id,name,owner,stage,value,probability,account_id,org_id,expected_close,product_summary,"
            "source_owner,source_channel,lost_reason,win_back,notes,is_demo,created_at,updated_at,"
            "created_by")
STAGE_COLS = "key,label,sort,is_open"
REQUIREMENT_COLS = "id,stage_key,field_label,field_type,required,sort"
LINK_COLS = ("id,contact_id,role,is_champion,is_primary,relationship_strength,last_touch_at,"
             "source_origin,champion_detail")
PRODUCT_COLS = "id,product,qty,unit_price,amount"
NOTE_COLS = "id,body,created_at,created_by,pinned,mentions"
TASK_COLS = "id,title,task_type,due_at,done,priority,owner_id,created_at"
FILE_COLS = "id,filename,kind,storage_url,size_bytes,uploaded_at,uploaded_by"
EVENT_COLS = "id,event_type,source,actor,occurred_at,value"
HISTORY_COLS = "id,from_stage,to_stage,captured,moved_by,moved_at"
ACCOUNT_COLS = "id,name,account_type,account_stage,industry,city,region,active_arr,org_id"
MEETING_COLS = ("id,booked_at,objective,agenda,attendees,outcome,attended,recording_url,follow_up,"
                "disposition,meeting_kind,calendar_status")
BRAND_COLS = "id,name,gcid,logo_url"
CLAIM_COLS = "id,entity_id,entity_label,entity_type,event_type,occurred_at,nora_engagement,upgraded"
CONTRACT_COLS = "id,mrr,status"
PRICE_COLS = "product_key,scope,unit,billing_type,list_price"
TEAM_COLS = "id,name,photo_url,role,title"
PEOPLE_COLS = "id,first_name,last_name,email,phone,job_title"
OWNER_HISTORY_COLS = "id,from_owner,to_owner,changed_by,changed_at"

# jsonb columns these pages write: psycopg adapts a dict / list only when wrapped
JSON_COLS = {"champion_detail", "value", "field_changes", "attendees"}

_UUIDISH = re.compile(r"[0-9a-f-]{36}", re.IGNORECASE)


def uuidish(v: Any) -> bool:
    """The browser's `/^[0-9a-f-]{36}$/i.test(v)` (a string of 36 hex digits / dashes)."""
    return isinstance(v, str) and _UUIDISH.fullmatch(v) is not None


def _uniq(ids: list[Any]) -> list[Any]:
    """`[...new Set(ids.filter(Boolean))]`: truthy, first-seen order."""
    return list(dict.fromkeys(i for i in ids if i))


def _one(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the browser ignored: the row, or null for none — and null for
    2+ rows too (PostgREST's error left `data` null)."""
    return rows[0] if len(rows) == 1 else None


def jsonb(values: dict[str, Any]) -> dict[str, Any]:
    """`values` with the jsonb columns wrapped for psycopg. A JSON null stays SQL NULL."""
    return {k: Jsonb(v) if k in JSON_COLS and v is not None else v for k, v in values.items()}


def _insert(table: Any, values: dict[str, Any], returning: bool = False) -> Any:
    stmt = table.insert().values(**jsonb(values))
    # inline(): no implicit `RETURNING id` (an insert without .select() returned nothing)
    return stmt.returning(table.c.id) if returning else stmt.inline()


# --- stages ----------------------------------------------------------------------------------

def stages_stmt() -> Any:
    """loadStages: select("key,label,sort,is_open").order("sort")."""
    return select(*cols(stages, STAGE_COLS)).order_by(stages.c.sort.asc())


def list_stages(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """The rows (threw); the browser maps them (label ?? key, sort ?? 0)."""
    return fetch_all(conn, stages_stmt())


def requirements_stmt(stage_key: str) -> Any:
    """loadStageRequirements: .eq("stage_key", key).order("sort")."""
    return (select(*cols(requirements, REQUIREMENT_COLS)).where(requirements.c.stage_key == stage_key)
            .order_by(requirements.c.sort.asc()))


def list_requirements(conn: psycopg.Connection, stage_key: str) -> list[dict[str, Any]]:
    return fetch_all(conn, requirements_stmt(stage_key))


# --- loadOpportunityList ---------------------------------------------------------------------

def opp_list_stmt() -> Any:
    """order("value", { ascending: false }) (PostgREST: DESC, nulls first).limit(500)."""
    return select(*cols(pipeline, OPP_COLS)).order_by(pipeline.c.value.desc()).limit(500)


def list_rows(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadOpportunityList's reads besides loadStages: the opportunities (threw), then the
    account and rep names (errors ignored: `data ?? []`; no ORDER BY). The browser joins them."""
    out = {"opps": fetch_all(conn, opp_list_stmt())}
    out.update(fetch_many(conn, {
        "accounts": select(accounts.c.id, accounts.c.name),
        "reps": select(reps.c.id, reps.c.name),
    }, tolerant=True))
    return out


# --- loadOpportunityFile ---------------------------------------------------------------------

def opp_stmt(opp_id: str) -> Any:
    """.eq("id", oppId).maybeSingle() (limit 2: enough to see a second row)."""
    return select(*cols(pipeline, OPP_COLS)).where(pipeline.c.id == opp_id).limit(2)


def events_stmt(opp_id: str, account_id: Any) -> Any:
    """.or(and(subject_type.eq.opportunity,subject_id.eq.<id>)[,account_id.eq.<account>])
    .order("occurred_at", desc).limit(200). The account branch only when the opportunity has one
    (truthy, as the browser's spread)."""
    cond = and_(activity.c.subject_type == "opportunity", activity.c.subject_id == opp_id)
    if account_id:
        cond = or_(cond, activity.c.account_id == account_id)
    return (select(*cols(activity, EVENT_COLS)).where(cond)
            .order_by(activity.c.occurred_at.desc()).limit(200))


def file_reads(opp: dict[str, Any]) -> dict[str, Any]:
    """The browser's Promise.all after the opportunity, in its order (loadStages runs first,
    separately: it threw). Conditional reads are left out exactly when the browser resolved them
    to an empty answer without asking."""
    oid = opp["id"]
    org_id, owner, account_id = opp.get("org_id"), opp.get("owner"), opp.get("account_id")
    stmts: dict[str, Any] = {
        "links": select(*cols(opp_contacts, LINK_COLS)).where(opp_contacts.c.opportunity_id == oid),
        "products": select(*cols(opp_products, PRODUCT_COLS)).where(opp_products.c.opportunity_id == oid),
        "notes": (select(*cols(notes, NOTE_COLS))
                  .where(notes.c.subject_type == "opportunity", notes.c.subject_id == oid)
                  .order_by(notes.c.created_at.desc())),
        "tasks": (select(*cols(tasks, TASK_COLS)).where(tasks.c.opportunity_id == oid)
                  .order_by(tasks.c.due_at.asc())),
        "files": (select(*cols(opp_files, FILE_COLS)).where(opp_files.c.opportunity_id == oid)
                  .order_by(opp_files.c.uploaded_at.desc())),
        "events": events_stmt(oid, account_id),
        "history": (select(*cols(opp_history, HISTORY_COLS)).where(opp_history.c.opportunity_id == oid)
                    .order_by(opp_history.c.moved_at.desc())),
    }
    if account_id:
        stmts["account"] = (select(*cols(accounts, ACCOUNT_COLS))
                            .where(accounts.c.id == account_id).limit(2))
    if owner:
        key = reps.c.id if uuidish(owner) else reps.c.name
        stmts["ownerRep"] = select(reps.c.name).where(key == owner).limit(2)
    stmts["meetings"] = (select(*cols(demos, MEETING_COLS)).where(demos.c.opportunity_id == oid)
                         .order_by(demos.c.booked_at.asc()))
    if org_id and uuidish(org_id):
        stmts["brand"] = select(*cols(orgs, BRAND_COLS)).where(orgs.c.id == org_id).limit(2)
        # .limit(10000): cut to the 1000-row cap, as PostgREST did
        stmts["claims"] = (select(*cols(claims, CLAIM_COLS)).where(claims.c.logo_org_id == org_id)
                           .order_by(claims.c.occurred_at.desc()).limit(10000))
    if org_id:
        stmts["contracts"] = (select(*cols(contracts, CONTRACT_COLS))
                              .where(contracts.c.org_id == org_id,
                                     contracts.c.status.in_(["active", "won"])))
    stmts["prices"] = select(*cols(book, PRICE_COLS))
    stmts["productCatalog"] = select(products.c.product_key, products.c.name)
    stmts["quote"] = (select(quotes.c.name).where(quotes.c.opportunity_id == oid)
                      .order_by(quotes.c.updated_at.desc()).limit(1))
    return stmts


SINGLES = ("account", "ownerRep", "brand", "quote")


def load_file(conn: psycopg.Connection, opp_id: str) -> dict[str, Any] | None:
    """loadOpportunityFile's reads, raw, in the browser's order; null when there is no such
    opportunity (406 for two). Rounds: the opportunity (threw); the stages (threw); the
    Promise.all (all tolerant); then the follow-ups the browser made one after another — the
    brand's location count and territory links (when the brand row came back), the contacts of
    the links, the active contracts' line items and the claim entities' scores (independent
    reads, one round trip); the territories' seats; the team's reps. All tolerant."""
    opp = maybe_single(fetch_all(conn, opp_stmt(opp_id)))
    if opp is None:
        return None
    out: dict[str, Any] = {"opp": opp, "stages": fetch_all(conn, stages_stmt())}
    got = fetch_many(conn, file_reads(opp), tolerant=True)
    for k in ("links", "products", "notes", "tasks", "files", "events", "history", "meetings",
              "claims", "contracts", "prices", "productCatalog"):
        out[k] = got.get(k, [])
    for k in SINGLES:
        out[k] = _one(got[k]) if k in got else None

    org_id, owner = opp.get("org_id"), opp.get("owner")
    has_brand = bool(out["brand"] and org_id)
    follow: dict[str, Any] = {}
    if has_brand:
        # select("id", { count: "exact", head: true }).eq("parent_org_id", org)
        follow["locations"] = (select(func.count().label("n")).select_from(orgs)
                               .where(orgs.c.parent_org_id == org_id))
        follow["territoryLinks"] = (select(territory_brand.c.territory_id)
                                    .where(territory_brand.c.org_id == org_id))
    contact_ids = [r["contact_id"] for r in out["links"] if r.get("contact_id")]
    if contact_ids:
        follow["people"] = select(*cols(contacts, PEOPLE_COLS)).where(contacts.c.id.in_(contact_ids))
    contract_ids = [r["id"] for r in out["contracts"]]
    if contract_ids:
        follow["lines"] = select(lines.c.product_key).where(lines.c.contract_id.in_(contract_ids))
    score_ids = _uniq([r.get("entity_id") for r in out["claims"] if uuidish(r.get("entity_id"))])
    if score_ids:
        follow["scores"] = (select(rank_scores.c.entity_id, rank_scores.c.total_score)
                            .where(rank_scores.c.entity_id.in_(score_ids)))
    more = fetch_many(conn, follow, tolerant=True) if follow else {}
    out["people"] = more.get("people", [])
    out["lines"] = more.get("lines", [])
    out["scores"] = more.get("scores", [])

    # the brand's team: null/[] when the browser skipped it
    out["locations"] = None
    out["territoryLinks"] = []
    out["seats"] = []
    out["teamReps"] = []
    if has_brand:
        loc = more.get("locations", [])
        # `locationsRes.error ? null : count ?? 0` (a failed count came back as [] here)
        out["locations"] = loc[0]["n"] if loc else None
        out["territoryLinks"] = more.get("territoryLinks", [])
        territory_ids = _uniq([r.get("territory_id") for r in out["territoryLinks"]])
        if territory_ids:
            out["seats"] = fetch_many(conn, {"seats": (
                select(seats.c.rep_id, seats.c.lane_role, seats.c.is_nora_default)
                .where(seats.c.territory_id.in_(territory_ids)))}, tolerant=True)["seats"]
        rep_ids = _uniq([*(r.get("rep_id") for r in out["seats"]), owner])
        if rep_ids:
            out["teamReps"] = fetch_many(conn, {"teamReps": (
                select(*cols(reps, TEAM_COLS)).where(reps.c.id.in_(rep_ids)))},
                tolerant=True)["teamReps"]
    return out


# --- AuditPanel (opportunity-automation.tsx) -------------------------------------------------

def audit_trail(conn: psycopg.Connection, opp_id: str,
                quote_id: str | None) -> dict[str, list[dict[str, Any]]]:
    """AuditPanel's two reads (errors ignored: `data ?? []`): the owner changes, newest first,
    and the quote's promo redemptions (only when there is a quote; no ORDER BY)."""
    stmts: dict[str, Any] = {"owners": (
        select(*cols(owner_history, OWNER_HISTORY_COLS))
        .where(owner_history.c.opportunity_id == opp_id)
        .order_by(owner_history.c.changed_at.desc()))}
    if quote_id:
        stmts["promos"] = (select(redemptions.c.id, redemptions.c.code, redemptions.c.redeemed_at)
                           .where(redemptions.c.subject_id == quote_id))
    got = fetch_many(conn, stmts, tolerant=True)
    return {"owners": got["owners"], "promos": got.get("promos", [])}


# --- writes ----------------------------------------------------------------------------------

def insert_contact(conn: psycopg.Connection, values: dict[str, Any]) -> dict[str, Any]:
    """addContact: exp_contacts insert({..., source_origin: "manual"}).select("id").single()."""
    rows = execute(conn, _insert(contacts, {**values, "source_origin": "manual"}, returning=True))
    return {"id": single(rows)["id"]}


def insert_contact_link(conn: psycopg.Connection, opp_id: str, values: dict[str, Any]) -> None:
    """addContact: exp_opportunity_contacts insert({opportunity_id, ..., source_origin: "manual"})."""
    execute(conn, _insert(opp_contacts, {"opportunity_id": opp_id, **values,
                                         "source_origin": "manual"}))


def update_contact_link(conn: psycopg.Connection, opp_id: str, link_id: str,
                        patch: dict[str, Any]) -> None:
    """updateOpportunityContact: update(patch).eq("id", link).eq("opportunity_id", opp)."""
    if patch:
        execute(conn, opp_contacts.update()
                .where(opp_contacts.c.id == link_id, opp_contacts.c.opportunity_id == opp_id)
                .values(**jsonb(patch)))


def insert_note(conn: psycopg.Connection, opp_id: str, values: dict[str, Any]) -> dict[str, Any]:
    """addOppNote: insert({subject_type: "opportunity", subject_id, ...}).select("id").single()."""
    rows = execute(conn, _insert(notes, {"subject_type": "opportunity", "subject_id": opp_id,
                                         **values}, returning=True))
    return {"id": single(rows)["id"]}


def update_note(conn: psycopg.Connection, opp_id: str, note_id: str, patch: dict[str, Any]) -> None:
    """updateOppNote: update(patch).eq("id").eq("subject_type", "opportunity").eq("subject_id")."""
    if patch:
        execute(conn, notes.update()
                .where(notes.c.id == note_id, notes.c.subject_type == "opportunity",
                       notes.c.subject_id == opp_id)
                .values(**patch))


def insert_task(conn: psycopg.Connection, opp_id: str, values: dict[str, Any]) -> dict[str, Any]:
    """addOppTask: insert({opportunity_id, ..., done: false}).select("id").single()."""
    rows = execute(conn, _insert(tasks, {"opportunity_id": opp_id, **values, "done": False},
                                 returning=True))
    return {"id": single(rows)["id"]}


def set_task_done(conn: psycopg.Connection, task_id: str, patch: dict[str, Any]) -> None:
    """setTaskDone: update({ done }).eq("id", taskId) (no opportunity filter, as before)."""
    if patch:
        execute(conn, tasks.update().where(tasks.c.id == task_id).values(**patch))


def insert_activity(conn: psycopg.Connection, opp_id: str, values: dict[str, Any]) -> None:
    """recordOpportunityActivity: insert({event_type, subject_type: "opportunity", subject_id,
    account_id, actor, source: "manual", occurred_at: now, value}); occurred_at = server clock."""
    execute(conn, _insert(activity, {**values, "subject_type": "opportunity", "subject_id": opp_id,
                                     "source": "manual", "occurred_at": now()}))


def insert_audit(conn: psycopg.Connection, opp_id: str, values: dict[str, Any]) -> None:
    """auditOpportunityWrite: audit_log insert({action, entity_type: "opportunity", entity_id,
    field_changes}). Its error reaches the page, as the browser threw it."""
    execute(conn, _insert(audit, {**values, "entity_type": "opportunity", "entity_id": opp_id}))


def insert_demo(conn: psycopg.Connection, opp_id: str, values: dict[str, Any]) -> dict[str, Any]:
    """bookOpportunityDemo: insert({opportunity_id, ..., is_demo: false}).select("id").single()."""
    rows = execute(conn, _insert(demos, {"opportunity_id": opp_id, **values, "is_demo": False},
                                 returning=True))
    return {"id": single(rows)["id"]}


def complete_demo(conn: psycopg.Connection, opp_id: str, demo_id: str,
                  patch: dict[str, Any]) -> None:
    """completeOpportunityDemo: update({attended: true, ...}).eq("id").eq("opportunity_id")."""
    execute(conn, demos.update()
            .where(demos.c.id == demo_id, demos.c.opportunity_id == opp_id)
            .values(attended=True, **patch))


def insert_file(conn: psycopg.Connection, opp_id: str, values: dict[str, Any]) -> None:
    """recordOppFile: exp_opportunity_files insert (the row only; storage is not wired)."""
    execute(conn, _insert(opp_files, {"opportunity_id": opp_id, **values}))


# --- exp_opp_* RPCs --------------------------------------------------------------------------

# name → [(param, db type)], in the function's order (pg_get_function_identity_arguments). Each
# is SECURITY DEFINER (search_path=public) and checks the caller's role itself; none takes an
# actor parameter. They run as the signed-in user, as the browser called them.
OPP_RPCS: dict[str, list[tuple[str, str]]] = {
    "exp_opp_advance_stage": [("p_opp", "uuid"), ("p_target", "text"), ("p_captured", "jsonb")],
    "exp_opp_close_lost": [("p_opp", "uuid"), ("p_reason", "text"), ("p_competitor", "text"),
                           ("p_revisit", "date")],
    "exp_opp_close_won": [("p_opp", "uuid"), ("p_captured", "jsonb")],
}


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return rpc_call(OPP_RPCS, name, args)


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    sql, params = rpc_sql(name, args)
    return call(conn, sql, params)
