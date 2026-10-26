"""Shared helpers for the ETL console queries (PostgREST-shaped reads on SQLAlchemy Core)."""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import func, literal_column, select

from _base.db.sql import fetch_many, jsonish


def one_of(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page ignored: the row when exactly one matched."""
    return rows[0] if len(rows) == 1 else None


def rpc_rows(conn: psycopg.Connection, sql: str, params: dict[str, Any] | None = None):
    """A set-returning RPC: its rows (as PostgREST sent them)."""
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def rpc_value(conn: psycopg.Connection, sql: str, params: dict[str, Any] | None = None) -> Any:
    """A scalar RPC (e.g. jsonb): its single value."""
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None


def json_rows(cols: dict[str, Any], where: list[Any], table: Any) -> Any:
    """A PostgREST to-many embed: a JSON array of `cols` from `table` rows matching `where`
    (`[]` when none)."""
    obj = func.json_build_object(*[x for k, c in cols.items() for x in (literal_column(f"'{k}'"), c)])
    agg = select(func.coalesce(func.json_agg(obj), literal_column("'[]'::json"))) \
        .select_from(table).where(*where)
    return agg.scalar_subquery()


def json_row(cols: dict[str, Any], where: list[Any], table: Any) -> Any:
    """A PostgREST to-one embed: a JSON object of the matching row, or null."""
    obj = func.json_build_object(*[x for k, c in cols.items() for x in (literal_column(f"'{k}'"), c)])
    return select(obj).select_from(table).where(*where).limit(1).scalar_subquery()


__all__ = ["fetch_many", "json_row", "json_rows", "one_of", "rpc_rows", "rpc_value"]
