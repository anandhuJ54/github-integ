"""Helpers shared by two or more of the sales Surface's resource folders. Private to this Surface
(other Surfaces import only `exports`); no endpoints.

- Request plumbing every resource router uses: `_guard` / `_read_with` / `_write_with` run a
  services call as the signed-in user and map database errors to HTTP, and `_Body` is the
  allow-list base of the request models (moved from the cpq router).
- PostgREST-shaped query helpers (`cols`, `now`, `jsonb`, `maybe_single`, `single`, `execute`,
  `insert`, `update`, `MultipleRows`; moved from cpq/services.py). `JSON_COLS` is still the
  cpq tables' jsonb columns: `insert` / `update` wrap exactly those, as they did. `one` (moved
  from team/services.py) and `count_stmt` / `count_of` (moved from board/services.py).
- The allow-listed RPC call machinery (`UnknownRpc`, `rpc_call`, `call`; moved from
  contract/services.py, where CONTRACT_RPCS and `rpc_sql` stay).
"""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import HTTPException, status
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.sql import ClauseElement

from _base.db import session as db
from _base.db.sql import compile_sql, jsonish

# jsonb columns: psycopg adapts a dict / list only when wrapped
JSON_COLS = {"state", "summary", "terms"}


class MultipleRows(ValueError):
    """`.single()` / `.maybeSingle()` got the wrong number of rows: PostgREST answered 406."""

    message = "JSON object requested, multiple (or no) rows returned"


# --- helpers ---------------------------------------------------------------------------------

def cols(t: Any, names: str) -> list[Any]:
    """A supabase-js select list ("a,b,c") as the table's columns."""
    return [t.c[n.strip()] for n in names.split(",")]


def now() -> datetime:
    """The browser's `new Date().toISOString()`, from the server's clock."""
    return datetime.now(UTC)


def jsonb(values: dict[str, Any]) -> dict[str, Any]:
    """`values` with the jsonb columns wrapped for psycopg. A JSON null stays SQL NULL."""
    return {k: Jsonb(v) if k in JSON_COLS and v is not None else v for k, v in values.items()}


def maybe_single(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()`: the row, null for none, PostgREST's 406 for more than one."""
    if len(rows) > 1:
        raise MultipleRows(MultipleRows.message)
    return rows[0] if rows else None


def single(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """`.single()`: exactly one row, else PostgREST's 406."""
    if len(rows) != 1:
        raise MultipleRows(MultipleRows.message)
    return rows[0]


def execute(conn: psycopg.Connection, stmt: ClauseElement) -> list[dict[str, Any]]:
    """Run a write; the RETURNING rows (PostgREST-shaped) when it has a RETURNING clause."""
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def insert(table: Any, values: dict[str, Any]) -> Any:
    # inline(): no implicit `RETURNING id` (an insert without .select() returned nothing)
    return table.insert().inline().values(**jsonb(values))


def update(table: Any, row_id: str, values: dict[str, Any]) -> Any:
    return table.update().where(table.c.id == row_id).values(**jsonb(values))


def one(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the browser ignored: the row, or null for none — and null for
    2+ rows too (PostgREST's error left `data` null)."""
    return rows[0] if len(rows) == 1 else None


def count_stmt(t: Any, *where: Any) -> Any:
    """select("id", { count: "exact", head: true }) with the filters: the exact count."""
    return select(func.count().label("n")).select_from(t).where(*where)


def count_of(rows: list[dict[str, Any]]) -> int | None:
    """The count, or null when the count failed (a tolerant read came back [])."""
    return rows[0]["n"] if rows else None


# --- request plumbing ---------------------------------------------------------------------


def _guard(fn, *args):
    try:
        return fn(*args)
    except MultipleRows as exc:  # PostgREST answered `.single()` on 0 or 2+ rows with 406
        raise HTTPException(status.HTTP_406_NOT_ACCEPTABLE, str(exc)) from exc
    except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


def _write_with(claims: dict, fn, *args) -> Any:
    with db.role_connection("authenticated", claims, write=True) as conn:
        out = _guard(fn, conn, *args)
    return {"ok": True} if out is None else out


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


# --- allow-listed RPCs ---------------------------------------------------------------------


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


def call(conn: psycopg.Connection, sql: str, params: dict[str, Any]) -> Any:
    """Run a scalar function call; its value, PostgREST-shaped (void → null)."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None
