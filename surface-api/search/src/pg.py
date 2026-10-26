"""Small SQL helpers for the search Surface (supabase-js parity).

supabase-js returned `{ data: null, error }` instead of throwing; `safe()` keeps that by
running the statement in a savepoint and yielding the fallback on a database error.
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
    return list(conn.execute(sql, params).fetchall())


def safe(conn: Any, sql: str, params: Sequence[Any] | None, default: Any) -> Any:
    try:
        with conn.transaction():
            return rows(conn, sql, params)
    except psycopg.Error as exc:
        log.warning("search query failed, using fallback: %s", type(exc).__name__)
        return default


def rpc_args(args: Sequence[tuple[str, Any, str]]) -> tuple[str, list[Any]]:
    """Named-argument list `name := %s::type, ...` for a function call.

    `args` holds (name, value, pg type). Names and types come from code only, never input.
    Callers omit an argument entirely to get the function default (supabase-js `undefined`).
    """
    parts = [f"{name} := %s::{pgtype}" for name, _value, pgtype in args]
    return ", ".join(parts), [value for _name, value, _t in args]


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
