"""Run SQLAlchemy Core statements on the psycopg connections from `_base.core.db`.

Queries are built with the Core query builder against `_base.schema.tables` (no ORM: no
mapped classes, no session). They compile to psycopg's `%(name)s` paramstyle and run on a
leased `role_connection` / `read_connection`, so the RLS context and role set there apply.
Rows come back JSON-shaped (`nora_os.db.jsonish` semantics), as PostgREST returned them.
"""
from __future__ import annotations

import datetime as _dt
import decimal
import uuid
from typing import Any

import psycopg
from sqlalchemy.dialects.postgresql import psycopg as _pg_psycopg
from sqlalchemy.sql import ClauseElement

_DIALECT = _pg_psycopg.dialect()


def compile_sql(stmt: ClauseElement) -> tuple[str, dict[str, Any]]:
    """The SQL text and bound parameters psycopg executes for `stmt`."""
    # render_postcompile expands IN (...) lists into one bound parameter per value.
    compiled = stmt.compile(dialect=_DIALECT, compile_kwargs={"render_postcompile": True})
    return str(compiled), dict(compiled.params)


def jsonish(v: Any) -> Any:
    """PostgREST-shaped value (uuid → str, timestamps → ISO, numeric → int/float)."""
    if isinstance(v, dict):
        return {k: jsonish(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonish(x) for x in v]
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (_dt.datetime, _dt.time)):
        return _pg_iso(v)
    if isinstance(v, _dt.date):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


def _pg_iso(v: _dt.datetime | _dt.time) -> str:
    """ISO text as Postgres' to_json renders it (what PostgREST sent): the fraction of a second
    keeps only significant digits, `.2803` not `.280300`."""
    text = v.isoformat()
    if not v.microsecond:
        return text
    head, frac = text.split(".", 1)
    digits, tz = frac[:6], frac[6:]
    return f"{head}.{digits.rstrip('0')}{tz}"


def fetch_all(conn: psycopg.Connection, stmt: ClauseElement) -> list[dict[str, Any]]:
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()]


def fetch_one(conn: psycopg.Connection, stmt: ClauseElement) -> dict[str, Any] | None:
    rows = fetch_all(conn, stmt)
    return rows[0] if rows else None
