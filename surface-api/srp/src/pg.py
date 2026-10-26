"""Small SQL helpers for the srp Surface (supabase-js parity).

supabase-js never threw on a query error; it returned `{ data: null, error }` and the legacy
code read `data ?? fallback`. `safe()` keeps that: the statement runs inside a savepoint, and
any database error yields the fallback without aborting the surrounding transaction.
"""
from __future__ import annotations

import logging
import math
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

import psycopg

log = logging.getLogger(__name__)


def rows(conn: Any, sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    """All rows of a statement as dicts."""
    return list(conn.execute(sql, params).fetchall())


def safe(conn: Any, sql: str, params: Sequence[Any] | None, default: Any) -> Any:
    """Rows of `sql`, or `default` when the database reports an error (supabase-js parity)."""
    try:
        with conn.transaction():
            return rows(conn, sql, params)
    except psycopg.Error as exc:
        log.warning("srp query failed, using fallback: %s", type(exc).__name__)
        return default


def safe_scalar(conn: Any, sql: str, params: Sequence[Any] | None, default: Any) -> Any:
    """First column of the first row, or `default` on error / no row."""
    got = safe(conn, sql, params, None)
    if not got:
        return default
    first = got[0]
    return next(iter(first.values())) if isinstance(first, dict) else first[0]


def rpc_args(args: Sequence[tuple[str, Any, str]]) -> tuple[str, list[Any]]:
    """Named-argument list `name := %s::type, ...` for a function call.

    `args` holds (name, value, pg type). Names and types come from code only, never input.
    Callers omit an argument entirely to get the function default (supabase-js `undefined`).
    """
    parts = [f"{name} := %s::{pgtype}" for name, _value, pgtype in args]
    return ", ".join(parts), [value for _name, value, _t in args]


def maybe_single(found: list[dict] | None) -> dict | None:
    """supabase-js `.maybeSingle()`: the row when exactly one matched, else None."""
    return found[0] if found and len(found) == 1 else None


def js_number(value: Any) -> float:
    """JavaScript `Number(value)` for JSON input (missing → NaN, null → 0)."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0.0
        try:
            return float(text)
        except ValueError:
            return math.nan
    return math.nan


def num(value: Any, default: float = 0.0) -> float:
    """`Number(value ?? default)` for DB values."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def as_int_if_whole(value: float) -> float | int:
    """Render a JS number the way JSON.stringify would (3 not 3.0)."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value
