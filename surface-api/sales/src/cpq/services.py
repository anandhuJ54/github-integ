"""sales CPQ — port of the supabase-js calls in surface-ui/sales/src/lib/sales-cpq.ts: quotes
(exp_quotes), the entitlement commit (exp_contracts, exp_contract_line_items,
exp_contract_provision), volume tiers (exp_price_tiers) and promo codes (exp_promo_codes,
exp_promo_redemptions). Pricing stays in the browser (cpq-pricing): nothing here re-prices,
rounds or converts a money value.

Runs as the signed-in user, so RLS decides exactly as it did for the browser (on GCP most of these
tables have RLS off: the writes really change quotes, contracts and promo codes). Reads keep the
PostgREST shape (the 1000-row cap, numeric → JSON number, `.maybeSingle()` → one object or null).

Writes are the browser's statements, ported as they were: same table, same columns, same filter.
Money and quantity values arrive as `Decimal` (parsed from the JSON number's text) and are bound
as such, so Postgres stores the digits the browser sent, as it did through PostgREST.
`updated_at`, which the browser stamped with `new Date().toISOString()`, is stamped with the
server's clock; `created_by` (the browser's `auth.getUser()` id) comes from the verified token.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db import tables as T
from _base.db.sql import fetch_all, jsonish
from surfaces.sales.internal import (
    cols,
    execute,
    insert,
    jsonb,
    maybe_single,
    now,
    single,
    update,
)

quotes = T.t_exp_quotes
accounts = T.t_exp_accounts
contracts = T.t_exp_contracts
lines = T.t_exp_contract_line_items
tiers = T.t_exp_price_tiers
promos = T.t_exp_promo_codes
redemptions = T.t_exp_promo_redemptions


QUOTE_LIST_COLS = "id,name,status,summary,updated_at,account_id,opportunity_id"
ACCOUNT_COLS = "id,name,org_id,industry,account_type,city,region"
PROMO_COLS = ("id,code,active,applies_to_products,discount_kind,amount,discount_pct,pricing_type,"
              "duration_months,starts_at,expires_at,scope_type,applies_to_scope,seller_id")




# --- quotes ----------------------------------------------------------------------------------

def list_quotes_stmt() -> Any:
    """listQuotes: order("updated_at", { ascending: false, nullsFirst: false })."""
    return select(*cols(quotes, QUOTE_LIST_COLS)).order_by(quotes.c.updated_at.desc().nulls_last())


def list_quotes(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, list_quotes_stmt())


def quote_state_stmt(name: str) -> Any:
    """loadQuote: select("state").eq("name", …).order(updated_at desc nulls last).limit(1)."""
    return (select(quotes.c.state).where(quotes.c.name == name)
            .order_by(quotes.c.updated_at.desc().nulls_last()).limit(1))


def quote_state(conn: psycopg.Connection, name: str) -> dict[str, Any] | None:
    return maybe_single(fetch_all(conn, quote_state_stmt(name)))


def opportunity_quote_stmt(opportunity_id: str) -> Any:
    """prepareOpportunityQuote: select("name").eq("opportunity_id", …).order(…).limit(1)."""
    return (select(quotes.c.name).where(quotes.c.opportunity_id == opportunity_id)
            .order_by(quotes.c.updated_at.desc().nulls_last()).limit(1))


def opportunity_quote(conn: psycopg.Connection, opportunity_id: str) -> dict[str, Any] | None:
    return maybe_single(fetch_all(conn, opportunity_quote_stmt(opportunity_id)))


def save_quote(conn: psycopg.Connection, payload: dict[str, Any],
               created_by: str | None) -> dict[str, Any]:
    """saveQuote's two steps, in order: the id of the quote named `payload["name"]`
    (`.limit(1).maybeSingle()`), then update that row by id, or insert one with `created_by`
    (`.select("id").single()`). Returns {"id": …}."""
    values = {**payload, "updated_at": now()}
    existing = maybe_single(fetch_all(conn, select(quotes.c.id)
                                      .where(quotes.c.name == payload["name"]).limit(1)))
    if existing:
        execute(conn, update(quotes, existing["id"], values))
        return {"id": existing["id"]}
    rows = execute(conn, quotes.insert().values(**jsonb({**values, "created_by": created_by}))
                   .returning(quotes.c.id))
    return {"id": single(rows)["id"]}


# --- accounts --------------------------------------------------------------------------------

def list_accounts_stmt() -> Any:
    return select(*cols(accounts, ACCOUNT_COLS)).order_by(accounts.c.name.asc())


def list_accounts(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, list_accounts_stmt())


# --- contracts (commitEntitlements) ----------------------------------------------------------

def create_contract(conn: psycopg.Connection, values: dict[str, Any],
                    created_by: str | None) -> dict[str, Any]:
    """insert({..., created_by}).select("id").single()."""
    rows = execute(conn, contracts.insert().values(**jsonb({**values, "created_by": created_by}))
                   .returning(contracts.c.id))
    return {"id": single(rows)["id"]}


def update_contract(conn: psycopg.Connection, contract_id: str, patch: dict[str, Any]) -> None:
    """update(patch).eq("id", id) with the sent columns."""
    if patch:
        execute(conn, update(contracts, contract_id, patch))


def delete_contract_lines(conn: psycopg.Connection, contract_id: str) -> None:
    """delete().eq("contract_id", id)."""
    execute(conn, lines.delete().where(lines.c.contract_id == contract_id))


def insert_contract_lines(conn: psycopg.Connection, contract_id: str,
                          rows: list[dict[str, Any]]) -> None:
    """One multi-row insert, as the browser's array insert (each row with `contract_id`)."""
    if rows:
        execute(conn, lines.insert().inline().values([{**r, "contract_id": contract_id}
                                                      for r in rows]))


def contract_approval_stmt(contract_id: str) -> Any:
    return (select(contracts.c.approval_state, contracts.c.approval_note)
            .where(contracts.c.id == contract_id).limit(2))


def contract_approval(conn: psycopg.Connection, contract_id: str) -> dict[str, Any] | None:
    return maybe_single(fetch_all(conn, contract_approval_stmt(contract_id)))


# --- RPCs ------------------------------------------------------------------------------------

# name → [(param, db type)]. exp_contract_provision is SECURITY DEFINER with no caller check and
# creates entitlements (SF-10): it runs as the signed-in user, as the browser called it.
CPQ_RPCS: dict[str, list[tuple[str, str]]] = {
    "exp_contract_provision": [("p_contract", "uuid")],
}


class UnknownRpc(ValueError):
    """Not an allow-listed function, or a parameter it doesn't take."""


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The call for an allow-listed function with the named arguments given (omitted ones take
    the function's defaults, as supabase-js `rpc` did)."""
    if name not in CPQ_RPCS:
        raise UnknownRpc(f"unknown function {name!r}")
    allowed = dict(CPQ_RPCS[name])
    unknown = set(args) - set(allowed)
    if unknown:
        raise UnknownRpc(f"{name}: unknown parameter(s) {sorted(unknown)}")
    named = ", ".join(f"{p} => %({p})s::{t}" for p, t in CPQ_RPCS[name] if p in args)
    return f"select public.{name}({named}) as v", dict(args)


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    sql, params = rpc_sql(name, args)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None


# --- volume tiers ----------------------------------------------------------------------------

def list_tiers_stmt() -> Any:
    """listPriceTiers: select("*").order("product_key").order("min_qty")."""
    return select(tiers).order_by(tiers.c.product_key.asc(), tiers.c.min_qty.asc())


def list_tiers(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, list_tiers_stmt())


def update_tier(conn: psycopg.Connection, tier_id: str, patch: dict[str, Any]) -> None:
    """updateTierFields / upsertPriceTier (with an id): update(patch).eq("id", id)."""
    if patch:
        execute(conn, update(tiers, tier_id, patch))


def create_tier(conn: psycopg.Connection, row: dict[str, Any]) -> None:
    """upsertPriceTier (no id): insert(row)."""
    execute(conn, insert(tiers, row))


def delete_tier(conn: psycopg.Connection, tier_id: str) -> None:
    execute(conn, tiers.delete().where(tiers.c.id == tier_id))


# --- promo codes -----------------------------------------------------------------------------

def list_promos_stmt() -> Any:
    return select(*cols(promos, PROMO_COLS)).order_by(promos.c.created_at.desc().nulls_last())


def list_promos(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, list_promos_stmt())


def create_promo(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """insert({...p, active: true})."""
    execute(conn, insert(promos, {**values, "active": True}))


def set_promo_active(conn: psycopg.Connection, promo_id: str, active: bool) -> None:
    execute(conn, update(promos, promo_id, {"active": active}))


def redemption_codes_stmt() -> Any:
    """redemptionCounts: select("code") (counted in the browser; the 1000-row cap stays)."""
    return select(redemptions.c.code)


def redemption_codes(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, redemption_codes_stmt())


def find_promo_stmt(code: str) -> Any:
    """findPromo: ilike("code", code).eq("active", true).limit(1). PostgREST reads `*` in a like
    pattern as `%`; `%` and `_` stay wildcards, as they were."""
    return (select(*cols(promos, PROMO_COLS))
            .where(promos.c.code.ilike(code.replace("*", "%")), promos.c.active.is_(True))
            .limit(1))


def find_promo(conn: psycopg.Connection, code: str) -> dict[str, Any] | None:
    """The row (the in-window check stays in the browser), or null."""
    return maybe_single(fetch_all(conn, find_promo_stmt(code)))
