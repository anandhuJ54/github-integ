"""sales teams (S4) — port of the supabase-js calls in surface-ui/sales/src/lib/teams.ts (territory
management): reps (exp_sales_reps), territories (exp_territories), brand links
(exp_territory_brand), quotas (exp_sales_quotas) and the territory stamps on organizations and
professionals. Also the rep-name read of routes/_authenticated/sales.promos.tsx.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads keep the
PostgREST shape (the 1000-row cap, numeric → JSON number, `.maybeSingle()` → one object or null,
406 for two). Reads whose error the browser ignored are tolerant ([] / null / a null count).

Writes are the browser's statements, ported as they were: same table, same columns, same filter.
The browser still orchestrates the territory move, the recount and the seller assignment, one
endpoint per supabase-js call, in its order. Quota targets arrive as `Decimal` and are bound as
such (never float, never rounded). No column here takes the clock or the signed-in user.
"""
from __future__ import annotations

from datetime import date
from typing import Any

import psycopg
from sqlalchemy import func, select

from _base.db import tables as T
from _base.db.sql import fetch_all, fetch_many, typed
from sales.queries.cpq import cols, execute, maybe_single, now

reps = T.t_exp_sales_reps
terrs = T.t_exp_territories
links = T.t_exp_territory_brand
quotas = T.t_exp_sales_quotas
orgs = T.t_organizations
pros = T.t_professionals

REP_COLS = "id,name,role,group_key,on_duty,is_demo,photo_url"
LINK_COLS = "id,territory_id,lane,org_id"
ORG_COLS = "id,name,slug,account_tier,is_demo,logo_url"
QUOTA_COLS = "rep_id,target,group_key,period_start"


def one(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the browser ignored: the row, or null for none — and null for
    2+ rows too (PostgREST's error left `data` null)."""
    return rows[0] if len(rows) == 1 else None


def count_stmt(t: Any, *where: Any) -> Any:
    """select("id", { count: "exact", head: true }) with the filters: the exact count."""
    return select(func.count().label("n")).select_from(t).where(*where)


def counts(got: dict[str, list[dict[str, Any]]], key: str) -> int | None:
    """A tolerant count: the number, or null when it failed (the browser's `count ?? 0`)."""
    return got[key][0]["n"] if got.get(key) else None


# --- reps ------------------------------------------------------------------------------------

def reps_stmt() -> Any:
    """loadReps: select(REP_COLS).order("name")."""
    return select(*cols(reps, REP_COLS)).order_by(reps.c.name.asc())


def list_reps(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """loadReps (threw)."""
    return fetch_all(conn, reps_stmt())


def rep_names_stmt() -> Any:
    """sales.promos.tsx: select("id,name") (no ORDER BY)."""
    return select(reps.c.id, reps.c.name)


def rep_names(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """The promos page's rep names (threw)."""
    return fetch_all(conn, rep_names_stmt())


# --- territories -----------------------------------------------------------------------------

def territories_stmt(group_key: str | None) -> Any:
    """select("*")[.eq("group_key", groupKey)].order("tier").order("seq")."""
    stmt = select(terrs)
    if group_key is not None:
        stmt = stmt.where(terrs.c.group_key == group_key)
    return stmt.order_by(terrs.c.tier.asc(), terrs.c.seq.asc())


def list_territories(conn: psycopg.Connection, group_key: str | None) -> list[dict[str, Any]]:
    """loadTeamsSummary (every territory) / loadGroupTeams and loadTeamDetail's siblings (one
    group). loadTeamDetail ignored the siblings' error; the caller does that."""
    return fetch_all(conn, territories_stmt(group_key))


def all_territories_stmt() -> Any:
    """loadAllBrandLinks: select("*") (no ORDER BY)."""
    return select(terrs)


def all_territories(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, all_territories_stmt())


def territory_stmt(territory_id: str) -> Any:
    """loadTeamDetail: select("*").eq("id", id).maybeSingle() (limit 2: enough to see a second
    row)."""
    return select(terrs).where(terrs.c.id == territory_id).limit(2)


def get_territory(conn: psycopg.Connection, territory_id: str) -> dict[str, Any] | None:
    """The row, null for none, 406 for two (threw)."""
    return maybe_single(fetch_all(conn, territory_stmt(territory_id)))


def territory_count_stmts(territory_id: str, brands: bool) -> dict[str, Any]:
    """The exact counts of one territory. recountTerritories: brands, offices, professionals
    (in that order); loadTeamDetail: professionals, then offices."""
    offices = count_stmt(orgs, orgs.c.territory_id == territory_id, orgs.c.entity_type == "office")
    profiles = count_stmt(pros, pros.c.territory_id == territory_id)
    if brands:
        return {"brands": count_stmt(links, links.c.territory_id == territory_id),
                "offices": offices, "profiles": profiles}
    return {"profiles": profiles, "offices": offices}


def territory_counts(conn: psycopg.Connection, territory_id: str,
                     brands: bool) -> dict[str, int | None]:
    """Every count's error was ignored (`count ?? 0`): a failed count is null."""
    got = fetch_many(conn, territory_count_stmts(territory_id, brands), tolerant=True)
    return {k: counts(got, k) for k in got}


# --- brandsForTerritories --------------------------------------------------------------------

def brand_links_stmt(territory_ids: list[str]) -> Any:
    """select(LINK_COLS).in("territory_id", ids).is("success_handoff_at", null) (no ORDER BY)."""
    return (select(*cols(links, LINK_COLS))
            .where(links.c.territory_id.in_(territory_ids), links.c.success_handoff_at.is_(None)))


def brand_orgs_stmt(org_ids: list[str]) -> Any:
    """select(ORG_COLS).in("id", orgIds) (no ORDER BY)."""
    return select(*cols(orgs, ORG_COLS)).where(orgs.c.id.in_(org_ids))


def brand_count_stmts(org_ids: list[str], link_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """One office count per brand (`parent_org_id`), then one professional count per link (its
    territory, repeated per link as the browser asked)."""
    out = {f"offices.{i}": count_stmt(orgs, orgs.c.parent_org_id == oid)
           for i, oid in enumerate(org_ids)}
    out.update({f"profiles.{i}": count_stmt(pros, pros.c.territory_id == lk["territory_id"])
                for i, lk in enumerate(link_rows)})
    return out


def brands_for_territories(conn: psycopg.Connection,
                           territory_ids: list[str]) -> dict[str, list[Any]]:
    """brandsForTerritories' reads, raw, in the browser's order: the links (threw); the brands'
    organizations (error ignored); the office counts, then the professional counts (each error
    ignored: null). `offices` follows the distinct org ids in link order (the browser's
    `[...new Set(...)]`), `profiles` follows the links. Nothing when there are no links."""
    empty: dict[str, list[Any]] = {"links": [], "orgs": [], "offices": [], "profiles": []}
    if not territory_ids:
        return empty
    link_rows = fetch_all(conn, brand_links_stmt(territory_ids))
    if not link_rows:
        return empty
    org_ids = list(dict.fromkeys(r["org_id"] for r in link_rows))
    org_rows = fetch_many(conn, {"orgs": brand_orgs_stmt(org_ids)}, tolerant=True)["orgs"]
    got = fetch_many(conn, brand_count_stmts(org_ids, link_rows), tolerant=True)
    return {
        "links": link_rows,
        "orgs": org_rows,
        "offices": [counts(got, f"offices.{i}") for i in range(len(org_ids))],
        "profiles": [counts(got, f"profiles.{i}") for i in range(len(link_rows))],
    }


# --- quotas ----------------------------------------------------------------------------------

def current_period_start() -> str:
    """currentPeriodStart(): the first of the current UTC month, from the server's clock (the
    browser used its own)."""
    return now().date().replace(day=1).isoformat()


def group_quotas_stmt(group_key: str, period_start: str) -> Any:
    """loadGroupTeams: select(QUOTA_COLS).eq("group_key").eq("period_start") (no ORDER BY)."""
    return (select(*cols(quotas, QUOTA_COLS))
            .where(quotas.c.group_key == group_key,
                   quotas.c.period_start == typed(quotas.c.period_start, period_start)))


def group_quotas(conn: psycopg.Connection, group_key: str) -> list[dict[str, Any]]:
    """For the current period. Error ignored (`quotasRes.data ?? []`)."""
    stmt = group_quotas_stmt(group_key, current_period_start())
    return fetch_many(conn, {"q": stmt}, tolerant=True)["q"]


def quota_lookup_stmt(rep_id: str, group_key: str, period_start: str) -> Any:
    """assignSeller: select("id").eq("rep_id").eq("group_key").eq("period_start").maybeSingle()
    (limit 2: enough to see a second row)."""
    return (select(quotas.c.id)
            .where(quotas.c.rep_id == rep_id, quotas.c.group_key == group_key,
                   quotas.c.period_start == typed(quotas.c.period_start, period_start))
            .limit(2))


def quota_lookup(conn: psycopg.Connection, rep_id: str, group_key: str) -> dict[str, Any] | None:
    """For the current period. Error ignored (`const { data: existing }`): null for none, for 2+
    and on an error."""
    stmt = quota_lookup_stmt(rep_id, group_key, current_period_start())
    got = fetch_many(conn, {"q": stmt}, tolerant=True)
    return one(got["q"])


def update_quota_target(conn: psycopg.Connection, quota_id: str, patch: dict[str, Any]) -> None:
    """assignSeller: update({ target }).eq("id", existing.id)."""
    if patch:
        execute(conn, quotas.update().where(quotas.c.id == quota_id).values(**patch))


def insert_month_quota(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """assignSeller: insert({rep_id, group_key, period_type: "month", period_start, target,
    actual: 0}) (no .select()); period_start is the current period by the server's clock."""
    start = date.fromisoformat(current_period_start())
    execute(conn, quotas.insert().inline().values(**values, period_type="month",
                                                  period_start=start, actual=0))


# --- territory writes ------------------------------------------------------------------------

def update_territory(conn: psycopg.Connection, territory_id: str, patch: dict[str, Any]) -> None:
    """assignSeller / unassignSeller / recountTerritories (and saveSellerSetup's assignment):
    update(patch).eq("id", id)."""
    if patch:
        execute(conn, terrs.update().where(terrs.c.id == territory_id).values(**patch))


def move_link(conn: psycopg.Connection, link_id: str, territory_id: str) -> None:
    """moveBrandTerritory, step 1: exp_territory_brand update({territory_id}).eq("id", linkId)."""
    execute(conn, links.update().where(links.c.id == link_id).values(territory_id=territory_id))


def stamp_org(conn: psycopg.Connection, org_id: str, territory_id: str) -> None:
    """moveBrandTerritory, step 2: organizations update({territory_id}).eq("id", orgId)."""
    execute(conn, orgs.update().where(orgs.c.id == org_id).values(territory_id=territory_id))


def stamp_offices(conn: psycopg.Connection, org_id: str, territory_id: str) -> None:
    """moveBrandTerritory, step 3: organizations update({territory_id}).eq("parent_org_id")."""
    execute(conn, orgs.update().where(orgs.c.parent_org_id == org_id)
            .values(territory_id=territory_id))


def office_ids_stmt(org_id: str) -> Any:
    """moveBrandTerritory, step 4: select("id").eq("parent_org_id", orgId).limit(50000) — cut
    to the 1000-row cap, as PostgREST did (follow-up 1j: ported as it is). No ORDER BY."""
    return select(orgs.c.id).where(orgs.c.parent_org_id == org_id).limit(50000)


def office_ids(conn: psycopg.Connection, org_id: str) -> list[dict[str, Any]]:
    """Error ignored (`officeRows ?? []`)."""
    return fetch_many(conn, {"q": office_ids_stmt(org_id)}, tolerant=True)["q"]


def stamp_professionals(conn: psycopg.Connection, org_ids: list[str], territory_id: str) -> None:
    """moveBrandTerritory, step 5 (one chunk of ≤500 org ids): professionals
    update({territory_id}).in("primary_org_id", chunk)."""
    execute(conn, pros.update().where(pros.c.primary_org_id.in_(org_ids))
            .values(territory_id=territory_id))

