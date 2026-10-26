"""Tests for _base.disco.extra_keys (fake connection + a stub site_contract module)."""
from __future__ import annotations

import sys
import types
from contextlib import contextmanager

import pytest

from _base.disco import extra_keys as ek


@pytest.fixture(autouse=True)
def _site_contract(monkeypatch):
    sc = types.ModuleType("_base.disco.site_contract")
    sc.PERSON_IDENTITY_KEYS = ["name", "phone"]
    sc.LOCATION_KEYS = {"street": "x"}
    sc.FIRM_KEYS = {"firm_name": "x"}
    sc.EXTRA_VALUE_TYPES = ("text", "number", "list")
    sc.EXTRA_SUBJECTS = ("person", "location", "firm")
    sc.is_static_extra_key = lambda key, names: key in names
    monkeypatch.setitem(sys.modules, "_base.disco.site_contract", sc)


class SqlError(Exception):
    def __init__(self, msg, sqlstate=None):
        super().__init__(msg)
        self.sqlstate = sqlstate


class FakeConn:
    """`handler(sql, params)` returns rows or raises; every statement is logged."""

    def __init__(self, handler):
        self.handler = handler
        self.log: list[tuple[str, tuple]] = []
        self.savepoints = 0

    @contextmanager
    def transaction(self):
        self.savepoints += 1
        yield

    @contextmanager
    def cursor(self):
        conn = self

        class Cur:
            description = None
            _rows: tuple = ()

            def execute(self, sql, params=None):
                conn.log.append((sql, params))
                rows = conn.handler(sql, params)
                self._rows = rows or []
                self.description = [("x",)] if sql.lstrip().startswith("select") else None

            def fetchall(self):
                return self._rows

        yield Cur()


def stmts(conn, prefix):
    return [(s, p) for s, p in conn.log if s.startswith(prefix)]


SPEC = {"label": "Years licensed", "definition": "Years since first licence",
        "value_type": "number", "subject": "person", "examples": ["1", "2", "3", "4"]}


def test_new_extra_queued_and_dictionary_defined():
    def handler(sql, params):
        if sql.startswith("select count(*)"):
            return [{"n": 3 if "category_slug" in sql else 9}]
        if sql.startswith("select discovery_id, normalized"):
            return [{"discovery_id": "d1", "normalized": "years_licensed"},
                    {"discovery_id": "d2", "normalized": "gone_key"}]
        if sql.startswith("select"):
            return []  # no existing rows
        return []

    def counted(sql, params):
        if sql.startswith("select count(*)") and params[0] == "gone_key":
            return [{"n": 0}]
        return handler(sql, params)

    conn = FakeConn(counted)
    ek.refresh_extra_keys(conn, "gcid:realtor", "ex.com", {"years_licensed": SPEC, "phone": SPEC})
    # static key skipped entirely
    assert all("phone" not in (p or ()) for _, p in conn.log)
    count_sql, count_params = conn.log[0]
    assert "extraction->'site_contract'->'extra_fields'->%s is not null" in count_sql
    assert count_params == ("years_licensed", "gcid:realtor")
    ins = stmts(conn, "insert into exp_field_discovery")
    assert len(ins) == 2
    assert ins[0][1] == ("gcid:realtor", "Years licensed", "years_licensed",
                         "extra field (C14): staging only, not promoted", "ex.com", 3)
    d = ins[1][1]
    assert "'extra_key'" in ins[1][0] and d[1:6] == (
        "Years licensed", "years_licensed", "Years since first licence", "number", "person")
    assert d[6].obj == ["1", "2", "3"] and d[-1] == 9  # any-category count
    # hygiene: kept row recounted, orphan deleted
    assert stmts(conn, "update exp_field_discovery")[-1][1] == (3, "d1")
    assert stmts(conn, "delete from exp_field_discovery")[0][1] == ("d2",)
    assert conn.savepoints == len(conn.log)


def test_existing_rows_updated_and_incomplete_definition_skipped():
    def handler(sql, params):
        if sql.startswith("select count(*)"):
            return [{"n": 0}]
        if "element_kind = 'extra_field' and normalized" in sql:
            return [{"discovery_id": "d1", "first_source": "a", "seen_count": 1}]
        if "element_kind = 'extra_key'" in sql and sql.startswith("select"):
            return []
        return []

    conn = FakeConn(handler)
    ek.refresh_extra_keys(conn, "g", "ex.com", {"k1": {"label": "K1"}})
    assert stmts(conn, "update exp_field_discovery")[0][1] == (1, "d1")  # seen >= 1
    assert stmts(conn, "insert") == []  # no definition -> no dictionary row


def test_failures_are_logged_not_raised(caplog):
    def handler(sql, params):
        if sql.startswith("select count(*)"):
            raise SqlError("count boom")
        if sql.startswith("select discovery_id, first_source"):
            return [{"discovery_id": "a"}, {"discovery_id": "b"}]  # maybeSingle: >1 row
        if sql.startswith("insert"):
            raise SqlError("dup", sqlstate="23505")
        return []

    conn = FakeConn(handler)
    ek.refresh_extra_keys(conn, "g", "ex.com", {"k1": SPEC})
    assert "extra key count failed k1: count boom" in caplog.text
    assert "extra key lookup failed k1: multiple rows returned" in caplog.text
    assert "dictionary insert failed" not in caplog.text  # 23505 is silent
