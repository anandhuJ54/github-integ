"""Small SQL helpers mirroring supabase-js call semantics (port support, no live DB in tests)."""
from __future__ import annotations

from collections.abc import Sequence
from typing import Any, TypeVar

import psycopg
from pydantic import BaseModel, ValidationError

from _base.server_fn import bad_input

M = TypeVar("M", bound=BaseModel)


def fetch_all(conn: Any, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def maybe_one(conn: Any, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    """`.maybeSingle()`: None for no row, error for more than one."""
    rows = fetch_all(conn, sql, params)
    if len(rows) > 1:
        raise ValueError("JSON object requested, multiple (or no) rows returned")
    return rows[0] if rows else None


def one(conn: Any, sql: str, params: Sequence[Any] = ()) -> dict[str, Any]:
    """`.single()`: exactly one row or an error."""
    rows = fetch_all(conn, sql, params)
    if len(rows) != 1:
        raise ValueError("JSON object requested, multiple (or no) rows returned")
    return rows[0]


def execute(conn: Any, sql: str, params: Sequence[Any] = ()) -> None:
    with conn.cursor() as cur:
        cur.execute(sql, params)


def soft_fetch_all(conn: Any, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]] | None:
    """A call whose `error` the TS ignored: run in a savepoint, None on a DB error."""
    try:
        with conn.transaction():
            return fetch_all(conn, sql, params)
    except psycopg.Error:
        return None


def soft_maybe_one(conn: Any, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    """`(await q.maybeSingle()).data` with the error ignored: None on no/many rows or DB error."""
    rows = soft_fetch_all(conn, sql, params)
    return rows[0] if rows and len(rows) == 1 else None


def soft_execute(conn: Any, sql: str, params: Sequence[Any] = ()) -> bool:
    """A write whose `error` the TS ignored: savepoint, False when it failed."""
    try:
        with conn.transaction():
            execute(conn, sql, params)
        return True
    except psycopg.Error:
        return False


def parse_input(model: type[M], data: Any) -> M:
    """zod `.parse` -> 400 with the validation messages."""
    try:
        return model.model_validate(data)
    except ValidationError as e:
        msgs = "; ".join(
            f"{'.'.join(str(p) for p in err['loc']) or 'data'}: {err['msg']}" for err in e.errors()
        )
        raise bad_input(msgs) from e
