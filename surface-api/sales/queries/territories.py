"""sales territories (S4) — port of the supabase-js calls in surface-ui/_base/src/lib/territories.ts
(exp_territories, exp_territory_brand, exp_territory_proposals, exp_territory_ramps,
exp_territory_rules, exp_sales_quotas, exp_sales_reps, exp_sales_assignments, exp_category_groups,
exp_category_group_members, exp_lead_routing_state, gbp_categories, organizations; the
exp_generate_territories / exp_territory_logo_profiles RPCs) and of the territory, seat, ramp and
proposal calls in surface-ui/sales/src/lib/territory-admin.ts (exp_territory_seats,
exp_territory_group_profiles; exp_etl_staging lives in category_groups.py).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads are the
browser's statements, PostgREST-shaped (the 1000-row cap, numeric → JSON number). A function that
made several reads gets them back in one response, raw; the browser still joins, sorts and sizes
(the bin-packing, the proposal builder and every derivation stay in the TS). Reads whose error the
browser ignored (`data ?? []`, `{ data }` of a `.maybeSingle()`) are tolerant here too.

The 1000-row cap: no read here has a LIMIT over 1000. Reads with no LIMIT on a table that could
pass it are cut at 1000, as PostgREST did: exp_territory_logo_profiles() (one row per root
organization, no ORDER BY) and the reads of exp_territories / exp_territory_brand / ramps / quotas
(13, 5, 0, 91 rows at port time).

Writes are the browser's statements, one endpoint per supabase-js call, in the browser's order
(the browser still orchestrates saveTerritory, deleteTerritory, setLaneOwner, approveProposal).
Two find-then-write steps run as one request: the quota upsert (find this month's row, update its
target or insert it) and the brand link (find the territory × org link, insert it if missing).
`reviewed_at` and the quota's `period_start` come from the server's clock (the browser used its
own); `created_by` of a proposal (the browser's `auth.getUser()` id) comes from the verified token.
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import Text, func, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from _base.db import tables as T
from _base.db.sql import fetch_all, fetch_many, typed
from sales.queries.contracts import call, rpc_call
from sales.queries.cpq import cols, execute, single

territories = T.t_exp_territories
brand = T.t_exp_territory_brand
proposals = T.t_exp_territory_proposals
ramps = T.t_exp_territory_ramps
rules = T.t_exp_territory_rules
quotas = T.t_exp_sales_quotas
reps = T.t_exp_sales_reps
assignments = T.t_exp_sales_assignments
groups = T.t_exp_category_groups
members = T.t_exp_category_group_members
routing = T.t_exp_lead_routing_state
categories = T.t_gbp_categories
orgs = T.t_organizations
seats = T.t_exp_territory_seats

REP_COLS = "id,name,email,role,group_key,on_duty,backup_rep_id,is_demo"
QUOTA_COLS = "id,rep_id,period_type,period_start,target,actual,is_demo"
PROFILE_COLS = ("group_key", "logo_id", "logo_name", "logo_gcid", "locations", "professionals")
RAMP_COLS = "territory_id,rep_id,month_offset,ramp_pct"
# LANE_ASSIGNMENT's values: the only assignment types territories.ts reads, writes or deletes
LANE_TYPES = ("account", "claims_queue")


def _one(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the browser ignored: the row, null for none — and null for
    2+ rows too (PostgREST's 406 left `data` null)."""
    return rows[0] if len(rows) == 1 else None


def _tolerant(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    """One read whose error the browser ignored (`data ?? []`)."""
    return fetch_many(conn, {"rows": stmt}, tolerant=True)["rows"]


def period_start(today: date | None = None) -> date:
    """currentPeriodStart(): the first of the current UTC month, from the server's clock."""
    d = today or datetime.now(UTC).date()
    return d.replace(day=1)


def now() -> datetime:
    return datetime.now(UTC)


# --- loadTerritoryCategories -----------------------------------------------------------------

def gcids_stmt() -> Any:
    """exp_territories select("gcid").order("gcid")."""
    return select(territories.c.gcid).order_by(territories.c.gcid.asc())


def category_names_stmt(gcids: list[str]) -> Any:
    """gbp_categories select("gcid,display_name").in("gcid", gcids) (no ORDER BY)."""
    return select(categories.c.gcid, categories.c.display_name).where(categories.c.gcid.in_(gcids))


def territory_categories(conn: psycopg.Connection, catchall: str = "*") -> dict[str, Any]:
    """loadTerritoryCategories' reads: the slots' gcids (threw), then the names of every gcid but
    the catch-all (error ignored; only when there is one). The browser counts and labels."""
    rows = fetch_all(conn, gcids_stmt())
    gcids = [g for g in dict.fromkeys(r["gcid"] for r in rows) if g != catchall]
    cats = _tolerant(conn, category_names_stmt(gcids)) if gcids else []
    return {"territories": rows, "cats": cats}


# --- loadTerritories / loadGroupTerritories / loadTerritoryLabel -----------------------------

def slots_stmt(gcid: str | None = None, group_key: str | None = None) -> Any:
    """select("*").order("tier").order("seq")[.eq("gcid", gcid)][.eq("group_key", groupKey)]
    (each filter only when given: truthy, as the browser's `if`)."""
    stmt = select(territories)
    if gcid:
        stmt = stmt.where(territories.c.gcid == gcid)
    if group_key:
        stmt = stmt.where(territories.c.group_key == group_key)
    return stmt.order_by(territories.c.tier.asc(), territories.c.seq.asc())


def list_slots(conn: psycopg.Connection, gcid: str | None, group_key: str | None) -> list:
    return fetch_all(conn, slots_stmt(gcid, group_key))


def label_stmt(territory_id: str) -> Any:
    """select("id,label,tier,seller_id").eq("id", id).maybeSingle() (limit 2: sees a 2nd row)."""
    return select(*cols(territories, "id,label,tier,seller_id")).where(
        territories.c.id == territory_id).limit(2)


def territory_label(conn: psycopg.Connection, territory_id: str) -> dict[str, Any] | None:
    """Error ignored (`(data ?? null)`): null on any failure."""
    return _one(_tolerant(conn, label_stmt(territory_id)))


# --- rules, reps, quotas, routing ------------------------------------------------------------

def rules_stmt() -> Any:
    """exp_territory_rules select("*") (no ORDER BY; the browser sorts by tier)."""
    return select(rules)


def list_rules(conn: psycopg.Connection) -> list:
    return fetch_all(conn, rules_stmt())


def reps_stmt() -> Any:
    """loadTerritoryReps: select(REP_COLS).order("name")."""
    return select(*cols(reps, REP_COLS)).order_by(reps.c.name.asc())


def list_reps(conn: psycopg.Connection) -> list:
    return fetch_all(conn, reps_stmt())


def nora_rep_stmt() -> Any:
    """loadNoraRep: select("id,name").ilike("role", "nora").limit(1)."""
    return select(reps.c.id, reps.c.name).where(reps.c.role.ilike("nora")).limit(1)


def nora_rep(conn: psycopg.Connection) -> list:
    """Error ignored: [] (the browser takes [0] ?? null)."""
    return _tolerant(conn, nora_rep_stmt())


def update_rep(conn: psycopg.Connection, rep_id: str, values: dict[str, Any]) -> None:
    """setRepDuty / setRepBackup: update({ on_duty } | { backup_rep_id }).eq("id", repId). An
    empty patch writes nothing (as PostgREST did with an empty body)."""
    if values:
        execute(conn, reps.update().where(reps.c.id == rep_id).values(**values))


def current_quotas_stmt(start: date) -> Any:
    """loadCurrentQuotas: select(QUOTA_COLS).eq("period_start", currentPeriodStart())."""
    return select(*cols(quotas, QUOTA_COLS)).where(
        quotas.c.period_start == typed(quotas.c.period_start, start))


def current_quotas(conn: psycopg.Connection, start: date) -> list:
    return fetch_all(conn, current_quotas_stmt(start))


def routing_stmt() -> Any:
    return select(routing)


def routing_state(conn: psycopg.Connection) -> list:
    return fetch_all(conn, routing_stmt())


def quota_find_stmt(rep_id: str, start: date, group_key: str | None, by_group: bool) -> Any:
    """select("id").eq("rep_id", …)[.eq("group_key", …)].eq("period_start", …).maybeSingle()."""
    stmt = select(quotas.c.id).where(quotas.c.rep_id == rep_id)
    if by_group:
        stmt = stmt.where(quotas.c.group_key == group_key)
    return stmt.where(quotas.c.period_start == typed(quotas.c.period_start, start)).limit(2)


def upsert_quota(conn: psycopg.Connection, rep_id: str, target: Decimal,
                 group_key: str | None, by_group: bool, start: date) -> None:
    """assignTerritory / saveQuota / assignGroupTerritory: this month's quota row for the rep
    (and group, when the caller filtered by one). Its lookup's error was ignored, so 0 or 2+ rows
    (PostgREST's 406 left `data` null) both insert. Found: update({ target }) by id; else insert
    { rep_id[, group_key], period_type "month", period_start, target, actual 0 }."""
    found = _one(_tolerant(conn, quota_find_stmt(rep_id, start, group_key, by_group)))
    if found:
        execute(conn, quotas.update().where(quotas.c.id == found["id"]).values(target=target))
        return
    row: dict[str, Any] = {"rep_id": rep_id}
    if by_group:
        row["group_key"] = group_key
    row.update(period_type="month", period_start=start, target=target, actual=0)
    execute(conn, quotas.insert().inline().values(**row))


# --- loadTerritoryBrands / loadAllTerritories ------------------------------------------------

def brands_stmt(territory_ids: list[str]) -> Any:
    """loadTerritoryBrands: select("territory_id,org_id,lane").in("territory_id", ids)
    .is("success_handoff_at", null)."""
    return select(*cols(brand, "territory_id,org_id,lane")).where(
        brand.c.territory_id.in_(territory_ids), brand.c.success_handoff_at.is_(None))


def territory_brands(conn: psycopg.Connection, territory_ids: list[str]) -> list:
    """Threw. No ids: [] without asking, as the browser."""
    return fetch_all(conn, brands_stmt(territory_ids)) if territory_ids else []


def all_territories_stmts(start: date) -> dict[str, Any]:
    """loadAllTerritories' Promise.all besides loadTerritoryReps, in its order."""
    return {
        "territories": select(territories).order_by(
            territories.c.group_key.asc(), territories.c.tier.asc(), territories.c.seq.asc()),
        "groups": select(groups.c.group_key, groups.c.label),
        "assignments": select(*cols(assignments, "id,rep_id,assignment_type,target_ref")).where(
            assignments.c.assignment_type.in_(LANE_TYPES)),
        "quotas": select(*cols(quotas, "rep_id,group_key,target,actual")).where(
            quotas.c.period_start == typed(quotas.c.period_start, start)),
        "ramps": select(ramps),
    }


def all_territories(conn: psycopg.Connection, start: date) -> dict[str, list]:
    """loadAllTerritories' reads: territories (threw), groups (ignored), reps (threw: it is
    loadTerritoryReps), assignments, quotas and ramps (ignored), then the brands of every
    territory (loadTerritoryBrands, threw). The browser joins them."""
    stmts = all_territories_stmts(start)
    terr = fetch_all(conn, stmts.pop("territories"))
    rep_rows = list_reps(conn)
    rest = fetch_many(conn, stmts, tolerant=True)
    return {"territories": terr, "groups": rest["groups"], "reps": rep_rows,
            "assignments": rest["assignments"], "quotas": rest["quotas"], "ramps": rest["ramps"],
            "brands": territory_brands(conn, [t["id"] for t in terr])}


# --- searchBrands ----------------------------------------------------------------------------

def org_search_stmt(term: str) -> Any:
    """organizations select("id,name").is("parent_org_id", null).ilike("name", `%term%`)
    .limit(20) (no ORDER BY). `term` is what the browser sent (already trimmed)."""
    return select(orgs.c.id, orgs.c.name).where(
        orgs.c.parent_org_id.is_(None), orgs.c.name.ilike(f"%{term}%")).limit(20)


def search_brands(conn: psycopg.Connection, term: str) -> list:
    """Error ignored: []."""
    return _tolerant(conn, org_search_stmt(term))


# --- saveTerritory's reads and writes --------------------------------------------------------

def next_seq_stmt(group_key: str, tier: str) -> Any:
    """nextSeq: select("seq").eq("group_key").eq("tier").order("seq", desc).limit(1)."""
    return (select(territories.c.seq)
            .where(territories.c.group_key == group_key, territories.c.tier == tier)
            .order_by(territories.c.seq.desc()).limit(1))


def next_seq(conn: psycopg.Connection, group_key: str, tier: str) -> list:
    """Error ignored: [] (the browser makes it seq 1)."""
    return _tolerant(conn, next_seq_stmt(group_key, tier))


def group_gcid_stmt(group_key: str) -> Any:
    """groupGcid / proposeCategorySplit: exp_category_group_members select("gcid")
    .eq("group_key").order("gcid").limit(1)."""
    return (select(members.c.gcid).where(members.c.group_key == group_key)
            .order_by(members.c.gcid.asc()).limit(1))


def group_gcid(conn: psycopg.Connection, group_key: str) -> list:
    """Error ignored: [] (the browser falls back)."""
    return _tolerant(conn, group_gcid_stmt(group_key))


def insert_slot(conn: psycopg.Connection, values: dict[str, Any]) -> dict[str, Any]:
    """saveTerritory (new): insert({...}).select("id").single(). Returns {id}."""
    rows = execute(conn, territories.insert().values(**values).returning(territories.c.id))
    return single(rows)


def update_slot(conn: psycopg.Connection, territory_id: str, values: dict[str, Any]) -> None:
    """update(patch).eq("id", id): assignTerritory, unassignTerritory, saveTerritory (edit),
    setLaneOwner. An empty patch writes nothing."""
    if values:
        execute(conn, territories.update().where(territories.c.id == territory_id).values(**values))


def brand_link_stmt(territory_id: str, org_id: str) -> Any:
    """select("id").eq("territory_id").eq("org_id").maybeSingle()."""
    return select(brand.c.id).where(
        brand.c.territory_id == territory_id, brand.c.org_id == org_id).limit(2)


def link_brand(conn: psycopg.Connection, territory_id: str, org_id: str, lane: str) -> None:
    """saveTerritory's brand link: the link (error ignored: 0 or 2+ rows → missing), then, when
    missing, insert({ territory_id, org_id, lane }) (threw)."""
    if _one(_tolerant(conn, brand_link_stmt(territory_id, org_id))):
        return
    execute(conn, brand.insert().inline().values(territory_id=territory_id, org_id=org_id,
                                                 lane=lane))


def delete_assignments(conn: psycopg.Connection, territory_id: str, types: list[str]) -> None:
    """exp_sales_assignments delete().eq("target_ref", id).in("assignment_type", types)
    (deleteTerritory: both lanes; setLaneOwner: .eq("assignment_type", type))."""
    stmt = assignments.delete().where(assignments.c.target_ref == territory_id)
    if len(types) == 1:
        stmt = stmt.where(assignments.c.assignment_type == types[0])
    else:
        stmt = stmt.where(assignments.c.assignment_type.in_(types))
    execute(conn, stmt)


def insert_assignment(conn: psycopg.Connection, territory_id: str, values: dict[str, Any]) -> None:
    """setLaneOwner: insert({ rep_id, group_key, assignment_type, target_ref })."""
    execute(conn, assignments.insert().inline().values(**values, target_ref=territory_id))


def delete_ramps(conn: psycopg.Connection, territory_id: str, rep_id: str | None) -> None:
    """saveRamp: delete().eq("territory_id"); saveSeatRamp adds .eq("rep_id", repId)."""
    stmt = ramps.delete().where(ramps.c.territory_id == territory_id)
    if rep_id is not None:
        stmt = stmt.where(ramps.c.rep_id == rep_id)
    execute(conn, stmt)


def insert_ramps(conn: psycopg.Connection, territory_id: str, rows: list[dict[str, Any]]) -> None:
    """saveRamp / saveSeatRamp: insert(pcts.map(...)) — one statement for every row."""
    if not rows:
        return
    execute(conn, ramps.insert().inline().values([{"territory_id": territory_id, **r}
                                                  for r in rows]))


def delete_brands(conn: psycopg.Connection, territory_id: str) -> None:
    """deleteTerritory: exp_territory_brand delete().eq("territory_id", id)."""
    execute(conn, brand.delete().where(brand.c.territory_id == territory_id))


def delete_slot(conn: psycopg.Connection, territory_id: str) -> list:
    """deleteTerritory: delete().eq("id", id).select("id"). Returns the deleted [{id}] (the
    browser throws when RLS left it empty)."""
    return execute(conn, territories.delete().where(territories.c.id == territory_id)
                   .returning(territories.c.id))


# --- loadRamps (territory-admin.ts) ----------------------------------------------------------

def ramps_for_stmt(territory_ids: list[str]) -> Any:
    """loadRamps: select(RAMP_COLS).in("territory_id", ids).order("month_offset")."""
    return (select(*cols(ramps, RAMP_COLS)).where(ramps.c.territory_id.in_(territory_ids))
            .order_by(ramps.c.month_offset.asc()))


def ramps_for(conn: psycopg.Connection, territory_ids: list[str]) -> list:
    return fetch_all(conn, ramps_for_stmt(territory_ids)) if territory_ids else []


# --- proposals -------------------------------------------------------------------------------

def proposals_stmt(state: str | None) -> Any:
    """loadProposals: select("*").order("created_at", desc)[.eq("state", state)]."""
    stmt = select(proposals)
    if state:
        stmt = stmt.where(proposals.c.state == state)
    return stmt.order_by(proposals.c.created_at.desc())


def list_proposals(conn: psycopg.Connection, state: str | None) -> list:
    return fetch_all(conn, proposals_stmt(state))


def insert_proposals(conn: psycopg.Connection, rows: list[dict[str, Any]],
                     created_by: str | None) -> None:
    """proposeTerritories / proposeCategorySplit: insert(rows), each row's created_by the
    caller's id (the browser's `auth.getUser()` id). Columns: every key any row sent (PostgREST
    writes a missing key as null)."""
    if not rows:
        return
    keys = list(dict.fromkeys(k for r in rows for k in r))
    values = [{**{k: r.get(k) for k in keys}, "created_by": created_by} for r in rows]
    for v in values:
        if v.get("payload") is not None:
            v["payload"] = Jsonb(v["payload"])
    execute(conn, proposals.insert().inline().values(values))


def review_proposal(conn: psycopg.Connection, proposal_id: str, values: dict[str, Any]) -> None:
    """approveProposal / rejectProposal: update({ state, reviewed_at[, payload] }).eq("id"),
    reviewed_at from the server's clock."""
    if values.get("payload") is not None:
        values = {**values, "payload": Jsonb(values["payload"])}
    execute(conn, proposals.update().where(proposals.c.id == proposal_id)
            .values(**values, reviewed_at=now()))


# --- profile counts (read-only aggregates) ---------------------------------------------------

def logo_profiles_stmt() -> Any:
    """rpc("exp_territory_logo_profiles"): every row of the set (capped at 1000, as PostgREST)."""
    fn = func.public.exp_territory_logo_profiles().table_valued(*PROFILE_COLS)
    return select(fn)


def group_profiles_stmt(group_key: str) -> Any:
    """rpc("exp_territory_group_profiles", { p_group_key })."""
    fn = func.public.exp_territory_group_profiles(literal(group_key, Text)).table_valued(
        *PROFILE_COLS)
    return select(fn)


def proxy_counts_stmt() -> Any:
    """loadLogoProfiles' fallback: exp_territories select("group_key,office_count,agent_count")."""
    return select(*cols(territories, "group_key,office_count,agent_count"))


def logo_profiles(conn: psycopg.Connection) -> dict[str, list]:
    """loadLogoProfiles' reads: the profiles (threw), then the stored counts (error ignored)."""
    profiles = fetch_all(conn, logo_profiles_stmt())
    return {"profiles": profiles, "territories": _tolerant(conn, proxy_counts_stmt())}


def group_profiles(conn: psycopg.Connection, group_key: str) -> list:
    return fetch_all(conn, group_profiles_stmt(group_key))


def proposal_groups_stmt() -> Any:
    """proposeTerritories: exp_category_groups select("group_key,label,is_catchall")."""
    return select(groups.c.group_key, groups.c.label, groups.c.is_catchall)


def proposal_groups(conn: psycopg.Connection) -> list:
    """Error ignored: []."""
    return _tolerant(conn, proposal_groups_stmt())


# --- seats (territory-admin.ts) --------------------------------------------------------------

def seats_stmt(group_key: str) -> Any:
    """loadSeats: select("*").eq("group_key").order("created_at")."""
    return (select(seats).where(seats.c.group_key == group_key)
            .order_by(seats.c.created_at.asc()))


def list_seats(conn: psycopg.Connection, group_key: str) -> list:
    return fetch_all(conn, seats_stmt(group_key))


SEAT_KEY = ("territory_id", "rep_id", "lane_role")


def upsert_seats_stmt(rows: list[dict[str, Any]], ignore_duplicates: bool) -> Any:
    """upsert(rows, { onConflict: "territory_id,rep_id,lane_role"[, ignoreDuplicates] }):
    PostgREST's ON CONFLICT DO NOTHING, or DO UPDATE SET <each sent column> = EXCLUDED.<col>."""
    keys = list(dict.fromkeys(k for r in rows for k in r))
    stmt = pg_insert(seats).inline().values([{k: r.get(k) for k in keys} for r in rows])
    index = [seats.c[k] for k in SEAT_KEY]
    rest = [k for k in keys if k not in SEAT_KEY]  # the key columns already match
    if ignore_duplicates or not rest:
        return stmt.on_conflict_do_nothing(index_elements=index)
    return stmt.on_conflict_do_update(index_elements=index,
                                      set_={k: stmt.excluded[k] for k in rest})


def upsert_seats(conn: psycopg.Connection, rows: list[dict[str, Any]],
                 ignore_duplicates: bool) -> None:
    if rows:
        execute(conn, upsert_seats_stmt(rows, ignore_duplicates))


def update_seat(conn: psycopg.Connection, seat_id: str, values: dict[str, Any]) -> None:
    """updateSeatQuota: update({ monthly_quota }).eq("id", seatId). An empty patch writes
    nothing."""
    if values:
        execute(conn, seats.update().where(seats.c.id == seat_id).values(**values))


def delete_seat(conn: psycopg.Connection, seat_id: str) -> None:
    """removeSeat: delete().eq("id", seatId)."""
    execute(conn, seats.delete().where(seats.c.id == seat_id))


# --- RPCs that generate territories ----------------------------------------------------------

# name → [(param, db type)] (pg_get_function_identity_arguments, read-only at port time). Both
# are SECURITY INVOKER, return jsonb and write territories: run as the signed-in user, as the
# browser called them. Never executed by tests or parity.
TERRITORY_RPCS: dict[str, list[tuple[str, str]]] = {
    "exp_generate_territories": [("p_gcid", "text")],
    "exp_generate_group_territories": [("p_group_key", "text")],
}


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return rpc_call(TERRITORY_RPCS, name, args)


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    sql, params = rpc_sql(name, args)
    return call(conn, sql, params)
