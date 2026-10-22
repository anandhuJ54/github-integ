"""Unit tests for the read/write split in _base.core.db.

No live database: pools and leases are faked so these assert *routing* and *RLS wiring*
only (acceptance criteria 1-6 of surface-spec/_base/db-read-write-split). Integration against
a real primary+replica pair is a separate gated test.
"""
from __future__ import annotations

import json
from contextlib import contextmanager
from typing import ClassVar

import pytest

from _base.core import db


@pytest.fixture(autouse=True)
def _clean_pools():
    """Each test starts with no cached pools."""
    db._pools.clear()
    yield
    db._pools.clear()


# --- fakes ---------------------------------------------------------------

class _FakeCursor:
    def __init__(self, log):
        self._log = log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self._log.append((sql, params))


class _FakeConn:
    def __init__(self, log):
        self._log = log

    def cursor(self):
        return _FakeCursor(self._log)


class _FakeConnCtx:
    def __init__(self, conn):
        self._conn = conn

    def __enter__(self):
        return self._conn

    def __exit__(self, *exc):
        return False


class _FakePool:
    """Minimal stand-in for psycopg_pool.ConnectionPool."""

    instances: ClassVar[list[_FakePool]] = []

    def __init__(self, url, **kwargs):
        self.url = url
        self.kwargs = kwargs
        self.log: list = []
        self.closed = False
        _FakePool.instances.append(self)

    def connection(self):
        return _FakeConnCtx(_FakeConn(self.log))

    def close(self):
        self.closed = True


@pytest.fixture
def fake_pool(monkeypatch):
    _FakePool.instances = []
    monkeypatch.setattr(db, "ConnectionPool", _FakePool)
    return _FakePool


# --- url resolution (criteria 1-3) --------------------------------------

def test_replica_set_routes_reads_to_replica(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://primary")
    monkeypatch.setenv("DATABASE_READ_URL", "postgres://replica")
    assert db._replica_url() == "postgres://replica"   # read target
    assert db._primary_url() == "postgres://primary"   # write target


def test_replica_unset_falls_back_to_primary(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://primary")
    monkeypatch.delenv("DATABASE_READ_URL", raising=False)
    assert db._replica_url() == "postgres://primary"
    assert db._primary_url() == "postgres://primary"


def test_read_connection_fresh_uses_primary(monkeypatch, fake_pool):
    monkeypatch.setenv("DATABASE_URL", "postgres://primary")
    monkeypatch.setenv("DATABASE_READ_URL", "postgres://replica")
    captured = {}

    @contextmanager
    def spy_lease(url, claims):
        captured["url"] = url
        yield object()

    monkeypatch.setattr(db, "_lease", spy_lease)

    with db.read_connection():
        pass
    assert captured["url"] == "postgres://replica"

    with db.read_connection(fresh=True):
        pass
    assert captured["url"] == "postgres://primary"

    with db.write_connection():
        pass
    assert captured["url"] == "postgres://primary"


# --- pool reuse (criterion 6) -------------------------------------------

def test_pool_is_lazy_and_reused_per_url(fake_pool):
    a1 = db._pool("postgres://one")
    a2 = db._pool("postgres://one")
    b1 = db._pool("postgres://two")
    assert a1 is a2                     # reused for same url
    assert b1 is not a1                 # distinct per url
    assert len(fake_pool.instances) == 2
    assert a1.kwargs["kwargs"]["row_factory"] is db.dict_row


# --- RLS context (criterion 4) ------------------------------------------

def test_lease_sets_rls_context_when_claims_present(fake_pool):
    db._pools["postgres://primary"] = _FakePool("postgres://primary")
    claims = {"sub": "user-1", "aud": "authenticated"}
    with db._lease("postgres://primary", claims):
        pass
    log = db._pools["postgres://primary"].log
    assert len(log) == 1
    sql, params = log[0]
    assert "set_config" in sql and "request.jwt.claims" in sql
    assert params == (json.dumps(claims),)


def test_lease_skips_rls_context_when_no_claims(fake_pool):
    db._pools["postgres://primary"] = _FakePool("postgres://primary")
    with db._lease("postgres://primary", None):
        pass
    assert db._pools["postgres://primary"].log == []


# --- pool lifecycle ------------------------------------------------------

def test_close_pools_closes_and_forgets(fake_pool):
    p = _FakePool("postgres://primary")
    db._pools["postgres://primary"] = p
    db.close_pools()
    assert p.closed is True
    assert db._pools == {}


def test_close_pools_is_safe_when_empty():
    db._pools.clear()
    db.close_pools()  # must not raise
    assert db._pools == {}


# --- backward-compatible aliases (criterion 5) --------------------------

def test_legacy_aliases_exist_and_route_to_primary(monkeypatch, fake_pool):
    monkeypatch.setenv("DATABASE_URL", "postgres://primary")
    monkeypatch.setenv("DATABASE_READ_URL", "postgres://replica")
    captured = {}

    @contextmanager
    def spy_lease(url, claims):
        captured["url"] = url
        captured["claims"] = claims
        yield object()

    monkeypatch.setattr(db, "_lease", spy_lease)

    with db.connection():
        pass
    assert captured["url"] == "postgres://primary"
    assert captured["claims"] is None

    with db.rls_connection({"sub": "u"}):
        pass
    assert captured["url"] == "postgres://primary"
    assert captured["claims"] == {"sub": "u"}
