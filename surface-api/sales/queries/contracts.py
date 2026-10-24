"""sales contracts (Module 4) — port of the supabase-js calls in
surface-ui/sales/src/lib/contracts.ts (exp_contracts and its exp_contract_* tables, organizations,
exp_notifications, exp_order_sku, exp_invoice / exp_invoice_line, exp_usage_meter, the m4_* RPCs)
and the exp_contracts read in routes/_authenticated/sales.quotes.$quoteId.tsx.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads are the
browser's statements, in its order, PostgREST-shaped (the 1000-row cap, numeric → JSON number).
A function that made several reads gets them back in one response, raw; the browser still
joins them (the joins and derivations in contracts.ts are unchanged).

Every lifecycle write goes through an allow-listed m4_* function (CONTRACT_RPCS), with each
argument cast to the function's own parameter type: money and quantities bind as `Decimal`
(parsed from the JSON number's text, never a float), integers as whole numbers only. Where the
browser filled the actor with the signed-in user's email (`auth.getUser()`), it now comes from
the verified token instead and the request may not send it.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import select

from _base.core.sql import fetch_all, fetch_many, jsonish
from _base.schema import tables as T
from sales.queries.cpq import cols, execute, maybe_single, now, update

contracts = T.t_exp_contracts
orgs = T.t_organizations
activity = T.t_exp_contract_activity
renewals = T.t_exp_contract_renewals
line_items = T.t_exp_contract_line_items
versions = T.t_exp_contract_versions
recipients = T.t_exp_contract_recipients
approvals = T.t_exp_contract_approvals
signatures = T.t_exp_contract_signatures
documents = T.t_exp_contract_documents
notifications = T.t_exp_notifications
skus = T.t_exp_order_sku
invoices = T.t_exp_invoice
invoice_lines = T.t_exp_invoice_line
usage = T.t_exp_usage_meter

ORG_COLS = "id,name,logo_url"
OPEN_RENEWAL = ["upcoming", "in_progress"]


def _org_key(c: dict[str, Any]) -> str:
    """`c.org_id ?? c.account_id ?? ""` (`??`: only null falls through)."""
    if c.get("org_id") is not None:
        return c["org_id"]
    return c["account_id"] if c.get("account_id") is not None else ""


def _uniq(ids: list[Any]) -> list[Any]:
    """`[...new Set(ids.filter(Boolean))]`: truthy, first-seen order."""
    return list(dict.fromkeys(i for i in ids if i))


def orgs_stmt(ids: list[str]) -> Any:
    """orgsById: organizations select("id,name,logo_url").in("id", ids)."""
    return select(*cols(orgs, ORG_COLS)).where(orgs.c.id.in_(ids))


# --- listContracts ---------------------------------------------------------------------------

def list_contracts_stmt() -> Any:
    """exp_contracts select("*").order("created_at", { ascending: false })."""
    return select(contracts).order_by(contracts.c.created_at.desc())


def contracts_activity_stmt(ids: list[str]) -> Any:
    """exp_contract_activity .in("contract_id", ids).order(occurred_at desc).limit(2000) (the
    PostgREST cap lowers it to 1000, as it did)."""
    return (select(activity).where(activity.c.contract_id.in_(ids))
            .order_by(activity.c.occurred_at.desc()).limit(2000))


def contracts_renewals_stmt(ids: list[str]) -> Any:
    return select(renewals).where(renewals.c.contract_id.in_(ids))


def list_contracts(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """listContracts' reads: the contracts, then (together) their orgs, activity and renewals.
    The browser joins them."""
    cs = fetch_all(conn, list_contracts_stmt())
    ids = [c["id"] for c in cs]
    org_ids = _uniq([_org_key(c) for c in cs])
    stmts: dict[str, Any] = {}
    if org_ids:
        stmts["orgs"] = orgs_stmt(org_ids)
    if ids:
        stmts["activity"] = contracts_activity_stmt(ids)
        stmts["renewals"] = contracts_renewals_stmt(ids)
    got = fetch_many(conn, stmts) if stmts else {}
    return {"contracts": cs, "orgs": got.get("orgs", []), "activity": got.get("activity", []),
            "renewals": got.get("renewals", [])}


# --- getContract -----------------------------------------------------------------------------

def contract_stmt(contract_id: str) -> Any:
    """select("*").eq("id", id).maybeSingle() (limit 2: enough to see a second row)."""
    return select(contracts).where(contracts.c.id == contract_id).limit(2)


def _by(t: Any, contract_id: str, order: str | None = None, asc: bool = False) -> Any:
    """getContract's `by(t, order, asc)`: select("*").eq("contract_id", id)[.order(...)]."""
    stmt = select(t).where(t.c.contract_id == contract_id)
    if order:
        stmt = stmt.order_by(t.c[order].asc() if asc else t.c[order].desc())
    return stmt


def contract_children_stmts(contract_id: str) -> dict[str, Any]:
    """getContract's eight child reads, keyed as the page names them."""
    return {
        "lineItems": _by(line_items, contract_id),
        "versions": _by(versions, contract_id, "version_no"),
        "recipients": _by(recipients, contract_id, "signing_order", True),
        "approvals": _by(approvals, contract_id, "requested_at"),
        "signatures": _by(signatures, contract_id, "signing_order", True),
        "activity": _by(activity, contract_id, "occurred_at"),
        "documents": _by(documents, contract_id),
        "renewals": _by(renewals, contract_id),
    }


def get_contract(conn: psycopg.Connection, contract_id: str) -> dict[str, Any] | None:
    """getContract's reads: the contract (null if none; the browser throws "Contract not
    found"), then its org and child rows together. The browser picks the org and renewals[0]."""
    contract = maybe_single(fetch_all(conn, contract_stmt(contract_id)))
    if contract is None:
        return None
    stmts = contract_children_stmts(contract_id)
    org_ids = _uniq([_org_key(contract)])
    if org_ids:
        stmts = {"orgs": orgs_stmt(org_ids), **stmts}
    got = fetch_many(conn, stmts)
    return {"contract": contract, "orgs": got.pop("orgs", []), **got}


# --- loadRenewals ----------------------------------------------------------------------------

def open_renewals_stmt() -> Any:
    """.in("status", ["upcoming", "in_progress"]).order("renewal_date", { ascending: true })."""
    return (select(renewals).where(renewals.c.status.in_(OPEN_RENEWAL))
            .order_by(renewals.c.renewal_date.asc()))


def contracts_in_stmt(ids: list[str]) -> Any:
    return select(contracts).where(contracts.c.id.in_(ids))


def load_renewals(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadRenewals' reads: the open renewals, then their contracts. The browser joins them."""
    rens = fetch_all(conn, open_renewals_stmt())
    ids = list(dict.fromkeys(r["contract_id"] for r in rens))
    cs = fetch_all(conn, contracts_in_stmt(ids)) if ids else []
    return {"renewals": rens, "contracts": cs}


# --- sales.quotes.$quoteId.tsx: the contract for a quote -------------------------------------

def quote_contract_stmt(quote_id: str) -> Any:
    """select("id").eq("quote_id", quoteId).order("created_at", desc).limit(1)."""
    return (select(contracts.c.id).where(contracts.c.quote_id == quote_id)
            .order_by(contracts.c.created_at.desc()).limit(1))


def quote_contract(conn: psycopg.Connection, quote_id: str) -> list[dict[str, Any]]:
    return fetch_all(conn, quote_contract_stmt(quote_id))


# --- updateSpecialTerms ----------------------------------------------------------------------

def update_special_terms(conn: psycopg.Connection, contract_id: str,
                         special_terms: str | None) -> None:
    """update({ special_terms }).eq("id", id) (the browser sends `text || null`)."""
    execute(conn, update(contracts, contract_id, {"special_terms": special_terms}))


# --- notifications ---------------------------------------------------------------------------

def notifications_stmt(limit: int) -> Any:
    """loadNotifications: select("*").order("created_at", desc).limit(limit)."""
    return select(notifications).order_by(notifications.c.created_at.desc()).limit(limit)


def load_notifications(conn: psycopg.Connection, limit: int) -> list[dict[str, Any]]:
    return fetch_all(conn, notifications_stmt(limit))


def mark_notification_read(conn: psycopg.Connection, notification_id: str) -> None:
    """update({ read_at }).eq("id", id); read_at from the server's clock (the browser used its
    own `new Date().toISOString()`)."""
    execute(conn, update(notifications, notification_id, {"read_at": now()}))


# --- order form ------------------------------------------------------------------------------

def skus_stmt() -> Any:
    """loadSkus: .eq("active", true).order("family").order("name")."""
    return (select(skus).where(skus.c.active.is_(True))
            .order_by(skus.c.family.asc(), skus.c.name.asc()))


def load_skus(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, skus_stmt())


# --- invoices and usage ----------------------------------------------------------------------

def invoices_stmt(contract_id: str) -> Any:
    """loadInvoices: .eq("contract_id", id).order("issued_at", desc, nullsFirst: true)."""
    return (select(invoices).where(invoices.c.contract_id == contract_id)
            .order_by(invoices.c.issued_at.desc().nulls_first()))


def invoice_lines_stmt(ids: list[str]) -> Any:
    return select(invoice_lines).where(invoice_lines.c.invoice_id.in_(ids))


def load_invoices(conn: psycopg.Connection, contract_id: str) -> dict[str, list[dict[str, Any]]]:
    """loadInvoices' reads: the invoices, then their lines. The browser attaches the lines."""
    invs = fetch_all(conn, invoices_stmt(contract_id))
    ids = [i["id"] for i in invs]
    lines = fetch_all(conn, invoice_lines_stmt(ids)) if ids else []
    return {"invoices": invs, "lines": lines}


def usage_stmt(contract_id: str) -> Any:
    """loadUsage: .eq("contract_id", id).order("period_start", desc)."""
    return (select(usage).where(usage.c.contract_id == contract_id)
            .order_by(usage.c.period_start.desc()))


def load_usage(conn: psycopg.Connection, contract_id: str) -> list[dict[str, Any]]:
    return fetch_all(conn, usage_stmt(contract_id))


# --- m4_* RPCs -------------------------------------------------------------------------------

# name → [(param, db type)], in the function's order (pg_get_function_identity_arguments). Every
# one is SECURITY DEFINER; they run as the signed-in user, as the browser called them.
CONTRACT_RPCS: dict[str, list[tuple[str, str]]] = {
    "m4_create_contract_from_quote": [("p_quote_id", "uuid"), ("p_created_by", "text")],
    "m4_add_version": [("p_contract", "uuid"), ("p_kind", "text"), ("p_label", "text"),
                       ("p_uploaded_by", "text"), ("p_changes", "jsonb"), ("p_source", "text")],
    "m4_request_approval": [("p_contract", "uuid"), ("p_role", "text"), ("p_name", "text"),
                            ("p_email", "text"), ("p_actor", "text")],
    "m4_decide_approval": [("p_approval", "uuid"), ("p_status", "text"), ("p_reason", "text"),
                           ("p_actor", "text")],
    "m4_finalize": [("p_contract", "uuid"), ("p_actor", "text")],
    "m4_send_for_signature": [("p_contract", "uuid"), ("p_actor", "text")],
    "m4_start_renewal": [("p_contract", "uuid"), ("p_actor", "text")],
    "m4_add_line": [("p_contract", "uuid"), ("p_code", "text"), ("p_qty", "numeric"),
                    ("p_unit_price", "numeric"), ("p_discount_pct", "numeric"),
                    ("p_term_months", "integer"), ("p_billing_mode", "text"),
                    ("p_actor", "text")],
    "m4_remove_line": [("p_line", "uuid"), ("p_actor", "text")],
    "m4_add_recipient": [("p_contract", "uuid"), ("p_party", "text"), ("p_name", "text"),
                         ("p_email", "text"), ("p_role", "text"), ("p_order", "integer"),
                         ("p_actor", "text")],
    "m4_remove_recipient": [("p_recipient", "uuid"), ("p_actor", "text")],
    "m4_assemble_document": [("p_contract", "uuid"), ("p_actor", "text")],
    "m4_generate_invoice": [("p_contract", "uuid"), ("p_type", "text"), ("p_ps", "date"),
                            ("p_pe", "date"), ("p_actor", "text")],
    "m4_record_usage": [("p_contract", "uuid"), ("p_code", "text"), ("p_metric", "text"),
                        ("p_period_start", "date"), ("p_period_end", "date"),
                        ("p_measured", "numeric"), ("p_high_water", "numeric"),
                        ("p_actor", "text")],
    "m4_create_addendum": [("p_parent", "uuid"), ("p_kind", "text"), ("p_title", "text"),
                           ("p_actor", "text")],
    "m4_generate_renewal_notice": [("p_contract", "uuid"), ("p_actor", "text")],
}

# The parameter the server fills with the caller's email (every browser caller passed the
# signed-in user's own `auth.getUser()` email). Not accepted from the request. The rest
# (p_created_by of m4_create_contract_from_quote included: one caller sends a display name)
# come from the request.
ACTOR_PARAMS: dict[str, str] = {
    name: ("p_uploaded_by" if name == "m4_add_version" else "p_actor")
    for name, params in CONTRACT_RPCS.items()
    if any(p in ("p_actor", "p_uploaded_by") for p, _ in params)
}


class UnknownRpc(ValueError):
    """Not an allow-listed function, a parameter it doesn't take, or a value of the wrong type."""


def _arg(name: str, param: str, kind: str, value: Any) -> Any:
    """`value` as psycopg binds it for a `::kind` parameter. Text-ish types take strings, numeric
    takes the JSON number's digits as a Decimal, integer whole numbers only, boolean true/false
    only, a text-ish array (`uuid[]`) a list of strings, jsonb any JSON."""
    if value is None:
        return None
    if kind == "jsonb":
        return Jsonb(value)
    if kind == "numeric":
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            raise UnknownRpc(f"{name}: {param} must be a number")
        try:
            num = Decimal(str(value))
        except ArithmeticError as exc:
            raise UnknownRpc(f"{name}: {param} must be a number") from exc
        if not num.is_finite():
            raise UnknownRpc(f"{name}: {param} must be a number")
        return num
    if kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise UnknownRpc(f"{name}: {param} must be a whole number")
        return value
    if kind == "boolean":
        if not isinstance(value, bool):
            raise UnknownRpc(f"{name}: {param} must be true or false")
        return value
    if kind.endswith("[]"):  # an array of a text-ish type (uuid[], text[]): a list of strings
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise UnknownRpc(f"{name}: {param} must be a list of strings")
        return value
    if not isinstance(value, str):
        raise UnknownRpc(f"{name}: {param} must be a string")
    return value


def rpc_call(registry: dict[str, list[tuple[str, str]]], name: str, args: dict[str, Any],
             server_args: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
    """The call for an allow-listed function with the named arguments given (omitted ones take
    the function's defaults, as supabase-js `rpc` did) plus the server-filled ones."""
    if name not in registry:
        raise UnknownRpc(f"unknown function {name!r}")
    kinds = dict(registry[name])
    server_args = server_args or {}
    unknown = set(args) - set(kinds)
    if unknown:
        raise UnknownRpc(f"{name}: unknown parameter(s) {sorted(unknown)}")
    clash = set(args) & set(server_args)
    if clash:
        raise UnknownRpc(f"{name}: {sorted(clash)} is set by the server")
    given = {**args, **server_args}
    params = {p: _arg(name, p, kinds[p], given[p]) for p, _ in registry[name] if p in given}
    named = ", ".join(f"{p} => %({p})s::{t}" for p, t in registry[name] if p in given)
    return f"select public.{name}({named}) as v", params


def rpc_sql(name: str, args: dict[str, Any],
            actor: str | None = None) -> tuple[str, dict[str, Any]]:
    """A CONTRACT_RPCS call; its actor parameter (if any) is `actor`, the caller's email."""
    server = {ACTOR_PARAMS[name]: actor} if name in ACTOR_PARAMS else {}
    return rpc_call(CONTRACT_RPCS, name, args, server)


def call(conn: psycopg.Connection, sql: str, params: dict[str, Any]) -> Any:
    """Run a scalar function call; its value, PostgREST-shaped (void → null)."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any],
             actor: str | None) -> Any:
    sql, params = rpc_sql(name, args, actor)
    return call(conn, sql, params)
