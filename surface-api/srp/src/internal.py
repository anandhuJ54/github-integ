"""Shared helpers for the srp seat / dashboard reads (PostgREST semantics).

Shared by two or more of this Surface's resource folders (directory, seat); private to srp,
no endpoints. Was srp/queries/common.py.

Copied from xmp/queries/common.py when the seat and dashboard pages moved to srp, surface audit
2026-10-25 (no cross-Surface import). Reads run on the caller's role connection, so RLS decides
as it did for the browser. RPCs go through one allow-list (SRP_RPCS) with each parameter cast to
its database type; all of them are SECURITY INVOKER reads.
"""
from __future__ import annotations

from typing import Any

import psycopg

from _base.db.sql import MAX_ROWS, jsonish


def cols(t: Any, names: str) -> list[Any]:
    """A supabase-js select list ("a,b,c") as the table's columns."""
    return [t.c[n.strip()] for n in names.split(",")]


def single(rows: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page ignored: the row when exactly one matched
    (query with limit 2), else nothing."""
    return rows[0] if rows and len(rows) == 1 else None


class MultipleRows(ValueError):
    """`.maybeSingle()` matched more than one row: PostgREST answered 406, which the page threw."""

    message = "JSON object requested, multiple (or no) rows returned"


def single_or_raise(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(rows) > 1:
        raise MultipleRows(MultipleRows.message)
    return rows[0] if rows else None


# --- RPCs --------------------------------------------------------------------------------------

# name → ([(param, db type)], returns a set). Each is a SECURITY INVOKER read: RLS decides.
# exp_office_mode moved here from xmp's allow-list with the seat and dashboard pages.
SRP_RPCS: dict[str, tuple[list[tuple[str, str]], bool]] = {
    "exp_office_mode": ([("p_entity_type", "text"), ("p_entity_id", "uuid")], False),
}


class UnknownRpc(ValueError):
    """Not an allow-listed function, or a parameter it doesn't take."""


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any], bool]:
    """The call for an allow-listed function with the named arguments given (omitted ones take
    the function's defaults, as supabase-js `rpc` did). A set-returning function's rows keep the
    PostgREST 1000-row cap."""
    if name not in SRP_RPCS:
        raise UnknownRpc(f"unknown function {name!r}")
    params, returns_set = SRP_RPCS[name]
    unknown = set(args) - {p for p, _ in params}
    if unknown:
        raise UnknownRpc(f"{name}: unknown parameter(s) {sorted(unknown)}")
    named = ", ".join(f"{p} => %({p})s::{t}" for p, t in params if p in args)
    if returns_set:
        return f"select * from public.{name}({named}) limit {MAX_ROWS}", dict(args), True
    return f"select public.{name}({named}) as v", dict(args), False


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    """The rows (set-returning) or the value, as PostgREST sent them."""
    sql, params, returns_set = rpc_sql(name, args)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        if returns_set:
            return [jsonish(dict(r)) for r in cur.fetchall()]
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None
