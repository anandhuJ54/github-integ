"""sales catalog & pricing (S1) — port of the supabase-js calls in surface-ui/sales/src/lib
catalog-admin.ts, cpq-catalog.ts, cpq-depth.ts, comp.ts and the money loaders of
surface-ui/_base/src/lib/console-surfaces.ts (loadProductCatalog, loadBilling).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads keep the
PostgREST shape: the same select lists and ORDER BYs, the 1000-row cap, and numerics rendered by
`jsonish` as PostgREST rendered them (int when integral, else float — what the page's
`JSON.parse` made of PostgREST's numeric text). Each `Promise.all` batch is one `fetch_many`
round trip; every one of them threw its error, so none is tolerant.

The writes are the browser's statements, ported as they were (these tables are writable by any
signed-in user under RLS — the server adds no rule of its own): same table, same columns (only
the keys the page sent), same filter, same RETURNING list. Money values arrive as `Decimal`, so a
price reaches the numeric column with the digits the page sent (no float rounding on the way).
`updated_at`, which the page stamped with `new Date().toISOString()`, is stamped with the
server's clock.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import select
from sqlalchemy.sql import ClauseElement

from _base.db import tables as T
from _base.db.sql import compile_sql, fetch_all, fetch_many, jsonish

products = T.t_exp_products
book = T.t_exp_price_book
config = T.t_exp_pricing_config
comp_plans = T.t_exp_comp_plans
contracts = T.t_exp_contracts
entitlements = T.t_exp_entitlements

# jsonb columns written by these pages: psycopg adapts a list only when wrapped (else an array)
JSON_COLS = {"package_includes", "value_json"}


def cols(t: Any, names: str) -> list[Any]:
    """A supabase-js select list ("a, b,c") as the table's columns, in that order."""
    return [t.c[n.strip()] for n in names.split(",")]


def now() -> datetime:
    """The page's `new Date().toISOString()`, from the server's clock."""
    return datetime.now(UTC)


def jsonb(values: dict[str, Any]) -> dict[str, Any]:
    """`values` with the jsonb columns wrapped for psycopg. A JSON null stays SQL NULL, as
    PostgREST stored it."""
    return {k: Jsonb(v) if k in JSON_COLS and v is not None else v for k, v in values.items()}


def execute(conn: psycopg.Connection, stmt: ClauseElement) -> list[dict[str, Any]]:
    """Run a write; the RETURNING rows (PostgREST-shaped) when it has a RETURNING clause."""
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


# --- catalog-admin.ts ------------------------------------------------------------------------

ADMIN_PRODUCT_COLS = (
    "product_key,name,description,lane,price_monthly,price_monthly_location,price_unit,"
    "billing_type,creditable,discountable,passthrough,min_charge,package_includes,active,sort"
)


def admin_products(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """listAdminProducts: `select(COLS).order("sort", { ascending: true })`."""
    return fetch_all(conn, select(*cols(products, ADMIN_PRODUCT_COLS))
                     .order_by(products.c.sort.asc()))


def update_admin_product(conn: psycopg.Connection, product_key: str,
                         patch: dict[str, Any]) -> list[dict[str, Any]]:
    """updateAdminProduct: `update(row).eq("product_key", key).select("product_key")`. The
    RETURNING rows go back; the page throws on none (RLS hid the row, or no such key). An empty
    patch updates nothing (PostgREST answered an empty PATCH body with no rows)."""
    if not patch:
        return []
    stmt =(products.update().where(products.c.product_key == product_key)
            .values(**jsonb(patch)).returning(products.c.product_key))
    return execute(conn, stmt)


def add_admin_product(conn: psycopg.Connection, row: dict[str, Any]) -> None:
    """addAdminProduct: `insert({ product_key, ...row })`, no `.select()` (no RETURNING).
    Columns the page left out (undefined) take their defaults, as with PostgREST."""
    execute(conn, products.insert().inline().values(**jsonb(row)))


def pricing_config(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """listPricingConfig: `select("key,value,value_json,label,unit,updated_at").order("key")`."""
    return fetch_all(conn, select(*cols(config, "key,value,value_json,label,unit,updated_at"))
                     .order_by(config.c.key.asc()))


def save_pricing_config_value(conn: psycopg.Connection, key: str,
                              value: Any) -> list[dict[str, Any]]:
    """savePricingConfigValue: `update({ value, updated_at }).eq("key", key).select("key,value")`."""
    stmt = (config.update().where(config.c.key == key)
            .values(value=value, updated_at=now()).returning(config.c.key, config.c.value))
    return execute(conn, stmt)


def save_volume_tiers(conn: psycopg.Connection, tiers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """saveVolumeTiers: `update({ value_json: clean, updated_at }).eq("key", "volume_tiers")
    .select("key")`. The page cleans and sorts the tiers before sending (unchanged)."""
    stmt = (config.update().where(config.c.key == "volume_tiers")
            .values(**jsonb({"value_json": tiers}), updated_at=now()).returning(config.c.key))
    return execute(conn, stmt)


# --- cpq-catalog.ts / cpq-depth.ts -----------------------------------------------------------

def cpq_catalog(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadCatalog's three reads (no ORDER BY, as the page sent them)."""
    return fetch_many(conn, {
        "products": select(*cols(products, "product_key,name,description,lane,price_monthly,"
                                           "price_monthly_location,active,creditable,discountable,"
                                           "passthrough,min_charge,package_includes")),
        "book": select(*cols(book, "product_key,scope,unit,list_price,billing_type")),
        "config": select(*cols(config, "key,value,value_json")),
    })


def pricing_context(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadPricingContext's two reads."""
    return fetch_many(conn, {
        "book": select(*cols(book, "product_key,scope,unit,list_price,billing_type,cost_type,"
                                   "cost_value,floor_margin_pct,discount_tiers,"
                                   "credit_cost_per_unit")),
        "products": select(*cols(products, "product_key,name,billing_type,consumes_llm_credits,"
                                           "est_credits_per_professional,"
                                           "est_credits_per_location"))
        .order_by(products.c.sort.asc()),
    })


# --- comp.ts ---------------------------------------------------------------------------------

def comp_plan_rows(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """loadCompPlans: `select("id,name,role,rate_pct,basis,active,is_demo,notes").order("role")`."""
    return fetch_all(conn, select(*cols(comp_plans, "id,name,role,rate_pct,basis,active,is_demo,notes"))
                     .order_by(comp_plans.c.role.asc()))


def save_comp_rate(conn: psycopg.Connection, plan_id: str, rate_pct: Any) -> None:
    """saveCompRate: `update({ rate_pct }).eq("id", id)` — no `.select()`, so no row check."""
    execute(conn, comp_plans.update().where(comp_plans.c.id == plan_id).values(rate_pct=rate_pct))


# --- @v3/ui console-surfaces.ts (money loaders) ----------------------------------------------

def product_catalog(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadProductCatalog's two reads."""
    return fetch_many(conn, {
        "products": select(*cols(products, "product_key, name, description, entity_scope, "
                                           "billing_type, price_monthly, price_monthly_location, "
                                           "price_unit, is_addon, active, sort"))
        .order_by(products.c.sort.asc()),
        "price_book": select(*cols(book, "id, product_key, scope, unit, list_price, "
                                         "contract_price, billing_type, cost_type, cost_value, "
                                         "floor_margin_pct, discount_tiers, description"))
        .order_by(book.c.product_key.asc()),
    })


def billing(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadBilling's three reads."""
    return fetch_many(conn, {
        "contracts": select(*cols(contracts, "id, name, org_id, account_id, status, start_date, "
                                             "end_date, mrr, net, cost, margin_pct, "
                                             "approval_state, token_package, is_demo"))
        .order_by(contracts.c.created_at.desc()),
        "entitlements": select(*cols(entitlements, "id, subject_type, subject_id, product_key, "
                                                   "state, source, tokens_included, granted_at, "
                                                   "expires_at"))
        .order_by(entitlements.c.granted_at.desc()),
        "products": select(products.c.product_key, products.c.name),
    })
