"""Rows come back the way PostgREST returned them to the browser."""
from __future__ import annotations

import datetime as dt
import decimal
import uuid

import pytest
from sqlalchemy import column, func, insert, select, table

from _base.core.sql import MAX_ROWS, capped, compile_sql, jsonish

UTC = dt.UTC


@pytest.mark.parametrize("value,expected", [
    # Postgres' to_json keeps only significant fraction digits
    (dt.datetime(2026, 8, 31, 17, 31, 0, 280300, UTC), "2026-08-31T17:31:00.2803+00:00"),
    (dt.datetime(2026, 10, 12, 6, 36, 42, 213865, UTC), "2026-10-12T06:36:42.213865+00:00"),
    (dt.datetime(2026, 1, 1, tzinfo=UTC), "2026-01-01T00:00:00+00:00"),
    (dt.datetime(2026, 1, 1, 0, 0, 0, 500000), "2026-01-01T00:00:00.5"),
    (dt.time(9, 30, 0, 120000), "09:30:00.12"),
    (dt.date(2026, 1, 2), "2026-01-02"),
    (decimal.Decimal(3), 3),
    (decimal.Decimal("2.5"), 2.5),
    (uuid.UUID("56d35654-1bcd-4ee6-97e3-3571ef61c8f1"), "56d35654-1bcd-4ee6-97e3-3571ef61c8f1"),
])
def test_postgrest_shapes(value, expected):
    assert jsonish({"v": [value]}) == {"v": [expected]}


# --- MAX_ROWS: the self-hosted PostgREST cap -------------------------------------------------

T = table("t", column("a"))


def _limit(stmt):
    sql, params = compile_sql(stmt)
    return params.get("param_1") if "LIMIT" in sql else None


@pytest.mark.parametrize("stmt,expected", [
    (select(T.c.a), MAX_ROWS),                  # no LIMIT → capped
    (select(T.c.a).limit(5000), MAX_ROWS),      # larger LIMIT → lowered
    (select(T.c.a).limit(200), 200),            # smaller LIMIT kept
    (select(func.count()).select_from(T), MAX_ROWS),  # one-row aggregate: harmless
])
def test_selects_return_at_most_max_rows(stmt, expected):
    assert MAX_ROWS == 1000
    assert _limit(capped(stmt)) == expected


def test_cap_can_be_lifted_and_leaves_writes_alone():
    assert _limit(capped(select(T.c.a), None)) is None
    stmt = insert(T).values(a=1)
    assert capped(stmt) is stmt
