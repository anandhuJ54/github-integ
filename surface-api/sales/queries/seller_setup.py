"""sales seller setup (S4) — port of the supabase-js calls in
surface-ui/sales/src/lib/seller-setup.ts (the "Add seller" / "Edit user" form): the rep
(exp_sales_reps), its extra verticals (exp_sales_rep_verticals), its territory
(exp_territories), the logo links (exp_territory_brand, organizations) and its quarterly quotas
(exp_sales_quotas).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Every read in this
file ignored its error (`data ?? []`, `data ?? null`), so every read here is tolerant; a
`.maybeSingle()` with 2+ rows is null. Writes are the browser's statements, ported as they were,
one endpoint per supabase-js call; the territory assignment, the logo moves and the recount reuse
the /sales/teams endpoints, as the browser reused teams.ts. Quota and attribution values arrive as
`Decimal` (never float, never rounded). No column here takes the clock or the signed-in user: the
rep id is the form's.

The photo upload (Supabase Storage, bucket seller-photos) stays in the browser: it is not a table
call.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db import tables as T
from _base.db.sql import fetch_many, typed
from sales.queries.cpq import cols, execute, single
from sales.queries.teams import one

reps = T.t_exp_sales_reps
verticals = T.t_exp_sales_rep_verticals
terrs = T.t_exp_territories
links = T.t_exp_territory_brand
quotas = T.t_exp_sales_quotas
orgs = T.t_organizations

REP_LIST_COLS = "id,name,team_name"
TERRITORY_COLS = "id,label,tier,group_key,seller_id,status,brand_count,agent_count"
REP_COLS = ("id,name,email,phone,title,role,group_key,team_name,photo_url,hire_date,on_duty,"
            "backup_rep_id,sdrcloud_url,attribution_target,is_demo")
VERTICAL_COLS = "id,group_key"
QUOTA_COLS = "id,period_start,target,actual"
LINK_COLS = "id,territory_id,org_id,lane"
ORG_COLS = "id,name,logo_url"
SLOT_COLS = "id,group_key,tier,seller_id"


def quarter_starts(year: int) -> list[str]:
    """quarterStarts(year): the four quarter start dates."""
    return [f"{year}-{m}-01" for m in ("01", "04", "07", "10")]


def _tolerant(conn: psycopg.Connection, stmts: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return fetch_many(conn, stmts, tolerant=True)


def _period_in(year: int) -> Any:
    return quotas.c.period_start.in_([typed(quotas.c.period_start, d) for d in quarter_starts(year)])


# --- loadSellerSetup -------------------------------------------------------------------------

def setup_stmts(rep_id: str | None, year: int) -> dict[str, Any]:
    """loadSellerSetup's first two rounds, in the browser's order: every rep (order name) and
    every territory (order tier, seq); then, for a rep, the rep (maybeSingle), its verticals and
    its quarter quotas for the year (no ORDER BY)."""
    stmts: dict[str, Any] = {
        "reps": select(*cols(reps, REP_LIST_COLS)).order_by(reps.c.name.asc()),
        "territories": select(*cols(terrs, TERRITORY_COLS))
        .order_by(terrs.c.tier.asc(), terrs.c.seq.asc()),
    }
    if rep_id:
        stmts["rep"] = select(*cols(reps, REP_COLS)).where(reps.c.id == rep_id).limit(2)
        stmts["verticals"] = (select(*cols(verticals, VERTICAL_COLS))
                              .where(verticals.c.rep_id == rep_id))
        stmts["quotas"] = (select(*cols(quotas, QUOTA_COLS))
                           .where(quotas.c.rep_id == rep_id, quotas.c.period_type == "quarter",
                                  _period_in(year)))
    return stmts


def handoff_links_stmt() -> Any:
    """select(LINK_COLS).is("success_handoff_at", null) (no ORDER BY)."""
    return select(*cols(links, LINK_COLS)).where(links.c.success_handoff_at.is_(None))


def link_orgs_stmt(org_ids: list[str]) -> Any:
    """select(ORG_COLS).in("id", orgIds) (no ORDER BY)."""
    return select(*cols(orgs, ORG_COLS)).where(orgs.c.id.in_(org_ids))


def load_setup(conn: psycopg.Connection, rep_id: str | None, year: int) -> dict[str, Any]:
    """loadSellerSetup's reads, raw: `{ reps, territories, rep, verticals, quotas, links, orgs }`
    (`rep` null, `verticals` / `quotas` [] without a rep id; `orgs` [] without links, as the
    browser skipped that read). All errors ignored. The browser still maps and joins them."""
    got = _tolerant(conn, setup_stmts(rep_id, year))
    out: dict[str, Any] = {
        "reps": got["reps"], "territories": got["territories"],
        "rep": one(got["rep"]) if "rep" in got else None,
        "verticals": got.get("verticals", []), "quotas": got.get("quotas", []),
    }
    out["links"] = _tolerant(conn, {"q": handoff_links_stmt()})["q"]
    org_ids = list(dict.fromkeys(r["org_id"] for r in out["links"]))
    out["orgs"] = _tolerant(conn, {"q": link_orgs_stmt(org_ids)})["q"] if org_ids else []
    return out


# --- saveSellerSetup -------------------------------------------------------------------------

def insert_rep(conn: psycopg.Connection, values: dict[str, Any]) -> dict[str, Any]:
    """insert(repPayload).select("id").single(). Returns {id} (406 without exactly one row)."""
    rows = execute(conn, reps.insert().values(**values).returning(reps.c.id))
    return {"id": single(rows)["id"]}


def update_rep(conn: psycopg.Connection, rep_id: str, values: dict[str, Any]) -> None:
    """update(repPayload).eq("id", repId)."""
    if values:
        execute(conn, reps.update().where(reps.c.id == rep_id).values(**values))


def rep_verticals_stmt(rep_id: str) -> Any:
    """select("id,group_key").eq("rep_id", repId) (no ORDER BY)."""
    return select(*cols(verticals, VERTICAL_COLS)).where(verticals.c.rep_id == rep_id)


def rep_verticals(conn: psycopg.Connection, rep_id: str) -> list[dict[str, Any]]:
    return _tolerant(conn, {"q": rep_verticals_stmt(rep_id)})["q"]


def insert_verticals(conn: psycopg.Connection, rep_id: str, group_keys: list[str]) -> None:
    """insert(toAdd.map((g) => ({ rep_id, group_key: g }))): one multi-row insert."""
    if group_keys:
        execute(conn, verticals.insert().inline()
                .values([{"rep_id": rep_id, "group_key": g} for g in group_keys]))


def delete_vertical(conn: psycopg.Connection, vertical_id: str) -> None:
    """delete().eq("id", v.id)."""
    execute(conn, verticals.delete().where(verticals.c.id == vertical_id))


def rep_territories_stmt(rep_id: str) -> Any:
    """select("id").eq("seller_id", repId) (no ORDER BY)."""
    return select(terrs.c.id).where(terrs.c.seller_id == rep_id)


def rep_territories(conn: psycopg.Connection, rep_id: str) -> list[dict[str, Any]]:
    return _tolerant(conn, {"q": rep_territories_stmt(rep_id)})["q"]


def all_links_stmt() -> Any:
    """select(LINK_COLS) — every link, handed off or not, no ORDER BY."""
    return select(*cols(links, LINK_COLS))


def all_links(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return _tolerant(conn, {"q": all_links_stmt()})["q"]


def slots_stmt(group_key: str, tier: str) -> Any:
    """select(SLOT_COLS).eq("group_key").eq("tier", role) (no ORDER BY)."""
    return select(*cols(terrs, SLOT_COLS)).where(terrs.c.group_key == group_key, terrs.c.tier == tier)


def slots(conn: psycopg.Connection, group_key: str, tier: str) -> list[dict[str, Any]]:
    return _tolerant(conn, {"q": slots_stmt(group_key, tier)})["q"]


def quota_ids_stmt(rep_id: str, year: int) -> Any:
    """select("id,period_start").eq("rep_id").eq("period_type", "quarter").in("period_start",
    starts) (no ORDER BY)."""
    return (select(quotas.c.id, quotas.c.period_start)
            .where(quotas.c.rep_id == rep_id, quotas.c.period_type == "quarter", _period_in(year)))


def quota_ids(conn: psycopg.Connection, rep_id: str, year: int) -> list[dict[str, Any]]:
    return _tolerant(conn, {"q": quota_ids_stmt(rep_id, year)})["q"]


def update_quota(conn: psycopg.Connection, quota_id: str, patch: dict[str, Any]) -> None:
    """update({ target, actual }).eq("id", id)."""
    if patch:
        execute(conn, quotas.update().where(quotas.c.id == quota_id).values(**patch))


def insert_quarter_quota(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """insert({rep_id, group_key, period_type: "quarter", period_start, target, actual})."""
    execute(conn, quotas.insert().inline().values(**values, period_type="quarter"))
