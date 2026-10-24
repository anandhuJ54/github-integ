"""Shared helpers for the xmp enterprise / seat / dashboard reads (PostgREST semantics).

Reads run on the caller's role connection, so RLS decides as it did for the browser. RPCs go
through one allow-list (XMP_RPCS) with each parameter cast to its database type; all of them
are SECURITY INVOKER reads.
"""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from sqlalchemy.sql import ClauseElement

from _base.core.sql import MAX_ROWS, compile_sql, jsonish

_log = logging.getLogger(__name__)


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


def execute(conn: psycopg.Connection, stmt: ClauseElement) -> None:
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)


def soft(conn: psycopg.Connection, stmt: ClauseElement) -> bool:
    """A write whose error the page ignored: in a savepoint, False on error."""
    try:
        with conn.transaction():
            execute(conn, stmt)
        return True
    except psycopg.Error as exc:
        _log.warning("xmp: ignored write error (as the page did): %s",
                     exc.diag.message_primary if exc.diag else exc)
        return False


# --- RPCs --------------------------------------------------------------------------------------

# name → ([(param, db type)], returns a set). Each is a SECURITY INVOKER read: RLS decides.
XMP_RPCS: dict[str, tuple[list[tuple[str, str]], bool]] = {
    "exp_xmp_brand_overview": ([("p_brand", "uuid")], False),
    "exp_xmp_state_rollup": ([("p_brand", "uuid"), ("p_limit", "integer")], True),
    "exp_xmp_offices_page": ([("p_brand", "uuid"), ("p_q", "text"), ("p_state", "text"),
                              ("p_limit", "integer"), ("p_offset", "integer")], True),
    "exp_xmp_top_pros_score": ([("p_brand", "uuid"), ("p_limit", "integer")], True),
    "exp_xmp_top_depth": ([("p_brand", "uuid"), ("p_limit", "integer")], True),
    "exp_xmp_top_reviews": ([("p_brand", "uuid"), ("p_limit", "integer")], True),
    "exp_office_mode": ([("p_entity_type", "text"), ("p_entity_id", "uuid")], False),
}


class UnknownRpc(ValueError):
    """Not an allow-listed function, or a parameter it doesn't take."""


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any], bool]:
    """The call for an allow-listed function with the named arguments given (omitted ones take
    the function's defaults, as supabase-js `rpc` did). A set-returning function's rows keep the
    PostgREST 1000-row cap."""
    if name not in XMP_RPCS:
        raise UnknownRpc(f"unknown function {name!r}")
    params, returns_set = XMP_RPCS[name]
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
