"""Small SQL helpers for the search Surface (supabase-js parity).

supabase-js returned `{ data: null, error }` instead of throwing; `safe()` keeps that by
running the statement in a savepoint and yielding the fallback on a database error.
"""
from __future__ import annotations

import logging
from collections.abc import Sequence
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
