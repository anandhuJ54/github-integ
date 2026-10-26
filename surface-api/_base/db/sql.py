"""Run SQLAlchemy Core statements on the psycopg connections from `_base.db.session`.

Queries are built with the Core query builder against `_base.db.tables` (no ORM: no
mapped classes, no session). They compile to psycopg's `%(name)s` paramstyle and run on a
leased `role_connection` / `read_connection`, so the RLS context and role set there apply.
Rows come back JSON-shaped (`nora_os.db.jsonish` semantics), as PostgREST returned them.

Like the self-hosted PostgREST (`max-rows` = 1000, Content-Range 0-999), a SELECT returns at
most MAX_ROWS rows: a larger or missing LIMIT is lowered to it, so an endpoint answers with the
same rows the browser's REST call got. Counts and aggregates are computed in SQL and unaffected.
"""
from __future__ import annotations

import datetime as _dt
import decimal
import logging
import uuid
from typing import Any

import psycopg
from sqlalchemy import literal
from sqlalchemy.dialects.postgresql import psycopg as _pg_psycopg
from sqlalchemy.sql import ClauseElement, ColumnElement, Select

_DIALECT = _pg_psycopg.dialect()
_log = logging.getLogger(__name__)

# Rows per response, matching the self-hosted PostgREST max-rows.
MAX_ROWS = 1000


def typed(column: ColumnElement, value: Any) -> ColumnElement:
    """`value` bound with `column`'s type. Comparing a Date/DateTime column with an ISO string
    otherwise binds the string as VARCHAR, which Postgres won't compare with a date."""
    return literal(value, type_=column.type)


def capped(stmt: ClauseElement, max_rows: int | None = MAX_ROWS) -> ClauseElement:
    """`stmt` with its LIMIT lowered to `max_rows` (SELECTs only; None = no cap)."""
    if max_rows is None or not isinstance(stmt, Select):
        return stmt
    current = stmt._limit  # None, or the int passed to .limit()
    return stmt.limit(max_rows if current is None else min(current, max_rows))


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


def fetch_all(
    conn: psycopg.Connection, stmt: ClauseElement, *, max_rows: int | None = MAX_ROWS
) -> list[dict[str, Any]]:
    sql, params = compile_sql(capped(stmt, max_rows))
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()]


def fetch_many(
    conn: psycopg.Connection, stmts: dict[str, ClauseElement], *, tolerant: bool = False
) -> dict[str, list[dict[str, Any]]]:
    """Run independent SELECTs in one network round trip (psycopg pipeline mode).

    Each statement is capped like fetch_all. With `tolerant=True` a failed statement yields []
    (as `(await q).data ?? []` did in the TS): the batch is retried one statement at a time,
    each in a savepoint, so one failure doesn't lose the others.
    """
    compiled = {k: compile_sql(capped(v)) for k, v in stmts.items()}
    try:
        # SAVEPOINT, every SELECT and RELEASE go out in one round trip. (psycopg's
        # conn.transaction() waits on each savepoint step inside a pipeline: ~4 trips.)
        with conn.pipeline():
            conn.execute("savepoint fetch_many")
            curs = {k: conn.execute(sql, params) for k, (sql, params) in compiled.items()}
            conn.execute("release savepoint fetch_many")
        return {k: [jsonish(dict(r)) for r in cur.fetchall()] for k, cur in curs.items()}
    except psycopg.Error:
        # leave the transaction usable for the caller (and for the per-statement retry)
        conn.execute("rollback to savepoint fetch_many")
        conn.execute("release savepoint fetch_many")
        if not tolerant:
            raise
    out: dict[str, list[dict[str, Any]]] = {}
    for k, (sql, params) in compiled.items():
        try:
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(sql, params)
                out[k] = [jsonish(dict(r)) for r in cur.fetchall()]
        except psycopg.Error as exc:
            # tolerated like the TS's `data ?? []`, but never silently: a bug looks like no rows
            _log.warning("fetch_many: %r failed, returning no rows: %s: %s",
                         k, type(exc).__name__, exc.diag.message_primary if exc.diag else exc)
            out[k] = []
    return out


def fetch_one(conn: psycopg.Connection, stmt: ClauseElement) -> dict[str, Any] | None:
    rows = fetch_all(conn, stmt)
    return rows[0] if rows else None
