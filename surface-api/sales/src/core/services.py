"""sales core (S2) — port of the supabase-js calls in surface-ui/sales/src/lib/sales.ts: reps and
territory (exp_sales_reps, exp_sales_assignments), activity (exp_activity_events), account tiers
(exp_account_tier, organizations, professionals), the price book (exp_price_book, exp_products),
contracts and their line items, signatures and renewals, and the revenue rollup.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads keep the
PostgREST shape: the same select lists and ORDER BYs, the 1000-row cap (follow-up 1j: the
browser's `.limit(5000)` / `.limit(20000)` were cut to 1000 by PostgREST, and still are), and
numerics rendered by `jsonish` as PostgREST rendered them. Each `Promise.all` batch is one
request; reads whose error the browser ignored (`data ?? []`, `count ?? 0`) are tolerant here
too, the ones it threw are not.

Writes are the browser's statements, ported as they were: same table, same columns (only the keys
the page sent), same filter. Money and quantity values arrive as `Decimal` (parsed from the JSON
number's text) and are bound as such: nothing here re-prices, rounds or converts a money value
(the browser still computes mrr, cost, net and margin, as before). `updated_at` / `signed_at`,
which the browser stamped with `new Date().toISOString()`, are stamped with the server's clock.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from _base.db import tables as T
from _base.db.sql import fetch_all, fetch_many
from surfaces.sales.internal import cols, execute, now, single

reps = T.t_exp_sales_reps
assignments = T.t_exp_sales_assignments
activity = T.t_exp_activity_events
account_tier = T.t_exp_account_tier
orgs = T.t_organizations
pros = T.t_professionals
book = T.t_exp_price_book
products = T.t_exp_products
contracts = T.t_exp_contracts
lines = T.t_exp_contract_line_items
signatures = T.t_exp_contract_signatures
renewals = T.t_exp_contract_renewals

# jsonb columns these pages write: psycopg adapts a dict / list only when wrapped
JSON_COLS = {"discount_tiers"}

REP_COLS = "id,name,email,role,group_key,photo_url,is_demo"
ASSIGNMENT_COLS = "id,rep_id,group_key,assignment_type,target_ref"
ACTIVITY_COLS = "id,event_type,subject_type,subject_id,account_id,logo,location,actor,value,occurred_at"
ACCOUNT_TIER_COLS = "account_id,agent_count,tier,group_key"
PRICE_BOOK_COLS = ("id,product_key,scope,unit,list_price,contract_price,billing_type,notes,cost_type,"
                   "cost_value,floor_margin_pct,discount_tiers,credit_cost_per_unit")
CONTRACT_COLS = ("id,org_id,account_id,name,status,start_date,end_date,token_package,mrr,created_by,"
                 "sold_by,net,cost,margin_pct,approval_state,approval_note,is_demo")
LINE_COLS = "id,contract_id,product_key,qty,unit_price,term,notes,discount_pct,cost,net,margin_pct"
SIGNATURE_COLS = "id,contract_id,signer_name,signer_email,status,signed_at"
RENEWAL_COLS = "id,contract_id,renewal_date,reminder_state,notes"


def jsonb(values: dict[str, Any]) -> dict[str, Any]:
    """`values` with the jsonb columns wrapped for psycopg. A JSON null stays SQL NULL."""
    return {k: Jsonb(v) if k in JSON_COLS and v is not None else v for k, v in values.items()}


def update_by(table: Any, key: Any, value: Any, patch: dict[str, Any]) -> Any:
    return table.update().where(key == value).values(**jsonb(patch))


def insert_rows(table: Any, rows: list[dict[str, Any]]) -> Any:
    """supabase-js `insert(obj)` / `insert([...])`: the columns are the union of the rows' keys
    (supabase-js sends them as `columns=`), a row missing one gets NULL (PostgREST's default for
    a bulk insert); no RETURNING (no `.select()`)."""
    keys: list[str] = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    return table.insert().inline().values([jsonb({k: r.get(k) for k in keys}) for r in rows])


# --- reps + territory ------------------------------------------------------------------------

def reps_stmt() -> Any:
    """loadReps: select(REP_COLS).order("group_key").order("role")."""
    return select(*cols(reps, REP_COLS)).order_by(reps.c.group_key.asc(), reps.c.role.asc())


def list_reps(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, reps_stmt())


def assignments_stmt() -> Any:
    """loadAssignments: no ORDER BY."""
    return select(*cols(assignments, ASSIGNMENT_COLS))


def list_assignments(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, assignments_stmt())


# --- activity --------------------------------------------------------------------------------

def activity_stmt(since: datetime) -> Any:
    """loadActivity: gte("occurred_at", since).order("occurred_at", desc).limit(5000) — the
    limit is lowered to the 1000-row cap, as PostgREST did. `since` is the browser's
    `Date.now() - days`, as before."""
    return (select(*cols(activity, ACTIVITY_COLS)).where(activity.c.occurred_at >= since)
            .order_by(activity.c.occurred_at.desc()).limit(5000))


def list_activity(conn: psycopg.Connection, since: datetime) -> list[dict[str, Any]]:
    return fetch_all(conn, activity_stmt(since))


# --- account tiers ---------------------------------------------------------------------------

def account_tiers_stmt() -> Any:
    """loadAccountTiers: order("agent_count", { ascending: false })."""
    return select(*cols(account_tier, ACCOUNT_TIER_COLS)).order_by(account_tier.c.agent_count.desc())


def list_account_tiers(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, account_tiers_stmt())


def account_names_stmt(ids: list[str]) -> Any:
    """loadAccountNames: select("id,name").in("id", ids)."""
    return select(orgs.c.id, orgs.c.name).where(orgs.c.id.in_(ids))


def account_names(conn: psycopg.Connection, ids: list[str]) -> list[dict[str, Any]]:
    """The rows (the browser maps them to {id: name}); [] for no ids (the browser sent none)."""
    return fetch_all(conn, account_names_stmt(ids)) if ids else []


def tier_inputs(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """recomputeAccountTiers' two reads (no ORDER BY; `.limit(20000)` cut to 1000, follow-up 1j)."""
    return fetch_many(conn, {
        "orgs": select(orgs.c.id, orgs.c.name, orgs.c.parent_org_id).limit(20000),
        "pros": select(pros.c.id, pros.c.primary_org_id).limit(20000),
    })


def upsert_account_tiers(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    """recomputeAccountTiers: upsert(rows, { onConflict: "account_id" }) — PostgREST's
    `ON CONFLICT (account_id) DO UPDATE SET <each sent column> = EXCLUDED.<column>`, with each
    row's `updated_at` from the server's clock."""
    if not rows:
        return
    stamped = now()
    stmt = pg_insert(account_tier).inline().values([{**r, "updated_at": stamped} for r in rows])
    sent = [k for k in {**rows[0], "updated_at": stamped} if k != "account_id"]
    execute(conn, stmt.on_conflict_do_update(
        index_elements=[account_tier.c.account_id],
        set_={k: stmt.excluded[k] for k in sent}))


# --- price book ------------------------------------------------------------------------------

def price_book(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadPriceBook's two reads (both threw): the book (no ORDER BY; the browser sorts) and the
    products' names and sort, order("sort")."""
    return fetch_many(conn, {
        "book": select(*cols(book, PRICE_BOOK_COLS)),
        "products": select(products.c.product_key, products.c.name, products.c.sort)
        .order_by(products.c.sort.asc()),
    })


def update_price(conn: psycopg.Connection, price_id: str, patch: dict[str, Any]) -> None:
    """savePrice: update(patch).eq("id", id)."""
    if patch:
        execute(conn, update_by(book, book.c.id, price_id, patch))


def update_credit_config(conn: psycopg.Connection, product_key: str, patch: dict[str, Any]) -> None:
    """saveCreditConfig: update(patch).eq("product_key", key)."""
    if patch:
        execute(conn, update_by(products, products.c.product_key, product_key, patch))


# --- contracts -------------------------------------------------------------------------------

def contracts_stmt() -> Any:
    """loadContracts: order("name")."""
    return select(*cols(contracts, CONTRACT_COLS)).order_by(contracts.c.name.asc())


def contract_bundle(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadContracts' four reads: the contracts (threw), then line items, signatures and renewals
    (their errors were ignored: `data ?? []`). None has more than the cap's 1000 rows."""
    out = {"contracts": fetch_all(conn, contracts_stmt())}
    out.update(fetch_many(conn, {
        "lineItems": select(*cols(lines, LINE_COLS)),
        "signatures": select(*cols(signatures, SIGNATURE_COLS)),
        "renewals": select(*cols(renewals, RENEWAL_COLS)),
    }, tolerant=True))
    return out


def create_contract(conn: psycopg.Connection, values: dict[str, Any]) -> dict[str, Any]:
    """createContract: insert({...}).select("id").single(). Returns {id}."""
    rows = execute(conn, contracts.insert().values(**values).returning(contracts.c.id))
    return {"id": single(rows)["id"]}


def update_contract(conn: psycopg.Connection, contract_id: str, patch: dict[str, Any]) -> None:
    """syncContractMrr, setContractStatus, persistQuoteMargins, requestMarginApproval,
    setMarginApproval, setContractSeller: update(patch).eq("id", id)."""
    if patch:
        execute(conn, update_by(contracts, contracts.c.id, contract_id, patch))


def insert_line_items(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    """addLineItem (one row) / duplicateContract (the copied rows): one insert."""
    if rows:
        execute(conn, insert_rows(lines, rows))


def update_line_item(conn: psycopg.Connection, line_id: str, patch: dict[str, Any]) -> None:
    """setLineDiscount / persistQuoteMargins: update(patch).eq("id", id)."""
    if patch:
        execute(conn, update_by(lines, lines.c.id, line_id, patch))


def delete_line_item(conn: psycopg.Connection, line_id: str) -> None:
    """removeLineItem: delete().eq("id", id)."""
    execute(conn, lines.delete().where(lines.c.id == line_id))


def insert_signature(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """sendSignature: insert({contract_id, signer_name, signer_email, status: "sent"})."""
    execute(conn, insert_rows(signatures, [values]))


def mark_signed(conn: psycopg.Connection, signature_id: str) -> None:
    """markSigned: update({status: "signed", signed_at: now}).eq("id", id)."""
    execute(conn, update_by(signatures, signatures.c.id, signature_id,
                            {"status": "signed", "signed_at": now()}))


def insert_renewal(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """upsertRenewal: a plain insert (despite the name), as before."""
    execute(conn, insert_rows(renewals, [values]))


def update_renewal(conn: psycopg.Connection, renewal_id: str, patch: dict[str, Any]) -> None:
    """setRenewalState: update({reminder_state}).eq("id", id)."""
    if patch:
        execute(conn, update_by(renewals, renewals.c.id, renewal_id, patch))


# --- revenue rollup --------------------------------------------------------------------------

def active_mrr_stmt() -> Any:
    """loadRevenue: select("mrr").eq("status", "active") (capped at 1000, as PostgREST did)."""
    return select(contracts.c.mrr).where(contracts.c.status == "active")


def expiring_count_stmt(today: date, in90: date) -> Any:
    """select("id", { count: "exact", head: true }).eq("status", "active")
    .gte("end_date", today).lte("end_date", in90)."""
    return (select(func.count().label("n")).select_from(contracts)
            .where(contracts.c.status == "active", contracts.c.end_date >= today,
                   contracts.c.end_date <= in90))


def pending_signatures_stmt() -> Any:
    """select("id", { count: "exact", head: true }).eq("status", "sent")."""
    return select(func.count().label("n")).select_from(signatures).where(signatures.c.status == "sent")


def revenue(conn: psycopg.Connection, today: date, in90: date) -> dict[str, Any]:
    """loadRevenue's three reads: the active contracts' mrr (threw), and two exact counts whose
    errors were ignored (`count ?? 0` in the browser: null here). The browser sums them."""
    active = fetch_all(conn, active_mrr_stmt())
    counts = fetch_many(conn, {"expiring": expiring_count_stmt(today, in90),
                               "pending": pending_signatures_stmt()}, tolerant=True)
    return {
        "active": active,
        "expiring": counts["expiring"][0]["n"] if counts["expiring"] else None,
        "pendingSignatures": counts["pending"][0]["n"] if counts["pending"] else None,
    }
