"""Small SQL helpers mirroring the supabase-js read shapes used by the ported functions."""
from __future__ import annotations

import logging
from typing import Any

from _base.core.db import role_connection

log = logging.getLogger(__name__)


def fetch_all(conn: Any, sql: str, params: tuple | dict = ()) -> list[dict]:
    """Run a query and return every row as a dict."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def maybe_single(conn: Any, sql: str, params: tuple | dict = ()) -> dict | None:
    """`.maybeSingle()`: None when no row, the row when one, an error when more than one."""
    rows = fetch_all(conn, sql, params)
    if len(rows) > 1:
        raise RuntimeError("JSON object requested, multiple (or no) rows returned")
    return rows[0] if rows else None


def safe_rows(role: str, sql: str, params: tuple | dict = ()) -> list[dict]:
    """A read whose failure yields no rows, as `(await q).data ?? []` did in the TS.

    Each read gets its own connection so one failed query cannot abort the others.
    """
    try:
        with role_connection(role) as conn:
            return fetch_all(conn, sql, params)
    # supabase-js returned {data: null, error}; callers used []
    except Exception as exc:  # noqa: BLE001
        log.warning("read failed: %s", type(exc).__name__)
        return []
