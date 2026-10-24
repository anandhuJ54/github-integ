"""Public search reads — port of the supabase-js RPCs in surface-ui/_base/src/lib/search.ts
(runSearch / suggest: home search, /find, city pages).

The four search_docs* functions are SECURITY INVOKER and executable by anon and authenticated;
they run on the visitor's role connection, so access is what the browser had. Calls go through
one allow-list (SEARCH_PUBLIC_RPCS) with each argument cast to its database type; an argument
the TS left `undefined` is omitted so the function default applies.
"""
from __future__ import annotations

from typing import Any

import psycopg

from _base.core.sql import MAX_ROWS, jsonish

_FILTERS = [("p_q", "text"), ("p_gcid", "text"), ("p_loc", "text"),
            ("p_min_rating", "numeric"), ("p_claimed", "boolean")]

# name → [(param, db type)], from pg_proc (migration 0023_search_projection.sql).
SEARCH_PUBLIC_RPCS: dict[str, list[tuple[str, str]]] = {
    "search_docs": [*_FILTERS, ("p_sort", "text"), ("p_limit", "integer"), ("p_offset", "integer")],
    "search_docs_count": _FILTERS,
    "search_docs_facets": _FILTERS,
    "search_docs_suggest": [("p_q", "text"), ("p_limit", "integer")],
}
# set-returning functions: rows (capped like PostgREST); the others return one value
_SETOF = {"search_docs", "search_docs_suggest"}


class UnknownRpc(ValueError):
    """Not an allow-listed function, or a parameter it doesn't take."""


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if name not in SEARCH_PUBLIC_RPCS:
        raise UnknownRpc(f"unknown function {name!r}")
    given = {k: v for k, v in args.items() if v is not None}
    unknown = set(given) - {p for p, _ in SEARCH_PUBLIC_RPCS[name]}
    if unknown:
        raise UnknownRpc(f"{name}: unknown parameter(s) {sorted(unknown)}")
    named = ", ".join(f"{p} => %({p})s::{t}" for p, t in SEARCH_PUBLIC_RPCS[name] if p in given)
    if name in _SETOF:
        return f"select * from public.{name}({named}) limit {MAX_ROWS}", given
    return f"select public.{name}({named}) as v", given


def call(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    """The function's rows (set-returning) or value, PostgREST-shaped."""
    sql, params = rpc_sql(name, args)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        if name in _SETOF:
            return [jsonish(dict(r)) for r in cur.fetchall()]
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None


def _attempt(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> tuple[Any, str | None]:
    """(data, None), or (None, the database's message) — each call in its own savepoint so one
    failure doesn't lose the others, as the three independent REST calls didn't."""
    try:
        with conn.transaction():
            return call(conn, name, args), None
    except psycopg.Error as exc:
        return None, (exc.diag.message_primary if exc.diag else None) or str(exc)


def run_search(conn: psycopg.Connection, filters: dict[str, Any], page: dict[str, Any]
               ) -> dict[str, Any]:
    """runSearch()'s Promise.all: search_docs (filters + sort/limit/offset), search_docs_count
    and search_docs_facets (filters), each result's data and error as the TS saw them."""
    rows, rows_err = _attempt(conn, "search_docs", {**filters, **page})
    count, count_err = _attempt(conn, "search_docs_count", filters)
    facets, facets_err = _attempt(conn, "search_docs_facets", filters)
    return {"rows": rows, "count": count, "facets": facets,
            "error": rows_err or count_err or facets_err}


def suggest(conn: psycopg.Connection, q: str, limit: int) -> list[dict[str, Any]]:
    """suggest(): search_docs_suggest; an error is no suggestions (the TS ignored it)."""
    data, _ = _attempt(conn, "search_docs_suggest", {"p_q": q, "p_limit": limit})
    return data or []
