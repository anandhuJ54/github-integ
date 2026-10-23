"""Rows come back the way PostgREST returned them to the browser."""
from __future__ import annotations

import datetime as dt
import decimal
import uuid

import pytest

from _base.core.sql import jsonish

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
