"""Control-graph claims (the "Control graph claims" tab on /claims) — the rows each supabase-js
query in claims-tab.tsx returned, under the same names.

Moved from the graph Surface (graph/queries/entities.py), surface audit 2026-10-25: the tab left
/control-graph for admin's /claims page. Same SQL, roles and responses.

Reads run on the caller's role connection (RLS unchanged); the one write goes through an
allow-list (ADMIN_CONTROL_RPCS) with each parameter cast to its database type, and the function
checks roles itself, as it did for the browser. Reads keep the 1000-row PostgREST cap
(`_base.db.sql.MAX_ROWS`).
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db import tables as T
from _base.db.sql import jsonish

entity_t, claim_t = T.t_exp_entity, T.t_exp_claim


def _cols(t: Any, names: str) -> list[Any]:
    """A supabase-js select list ("a, b, c") as the table's columns."""
    return [t.c[n.strip()] for n in names.split(",")]


def rpc_rows(conn: psycopg.Connection, sql: str, params: dict[str, Any] | None = None):
    """A set-returning RPC: its rows, as PostgREST sent them."""
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def control_users(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """claims-tab.tsx: rpc("list_control_users")."""
    return rpc_rows(conn, "select * from public.list_control_users()")


def claims_stmt() -> Any:
    """claims-tab.tsx: the newest 500 claims."""
    return select(*_cols(claim_t, "claim_id, entity_id, user_id, claim_type, status, evidence, "
                                  "verified_at, created_at")) \
        .order_by(claim_t.c.created_at.desc()).limit(500)


def entities_lite_stmt() -> Any:
    """claims-tab.tsx: `.limit(2000)` unordered — capped at 1000 like PostgREST (gap 1g)."""
    e = entity_t.c
    return select(e.entity_id, e.display_name, e.entity_type).limit(2000)


# name → [(param, db type)]. A role-checked SECURITY DEFINER function; it decides.
ADMIN_CONTROL_RPCS: dict[str, list[tuple[str, str]]] = {
    "exp_claim_adjudicate": [("p_claim", "uuid"), ("p_approve", "boolean"), ("p_note", "text")],
}


class UnknownRpc(ValueError):
    """Not an allow-listed function, or a parameter it doesn't take."""


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The call for an allow-listed function with the named arguments given (omitted ones take
    the function's defaults, as supabase-js `rpc` did)."""
    if name not in ADMIN_CONTROL_RPCS:
        raise UnknownRpc(f"unknown function {name!r}")
    allowed = dict(ADMIN_CONTROL_RPCS[name])
    unknown = set(args) - set(allowed)
    if unknown:
        raise UnknownRpc(f"{name}: unknown parameter(s) {sorted(unknown)}")
    named = ", ".join(f"{p} => %({p})s::{t}" for p, t in ADMIN_CONTROL_RPCS[name] if p in args)
    return f"select public.{name}({named}) as v", {p: args[p] for p in args}


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    sql, params = rpc_sql(name, args)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None
