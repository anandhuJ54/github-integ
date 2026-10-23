"""Tests for the server-function plumbing and role-scoped connections (no live DB)."""
from __future__ import annotations

import json
from contextlib import contextmanager

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from _base.core import db
from _base.core.server_fn import FnCall, fn_router, not_implemented, optional_user


def _app() -> FastAPI:
    router = fn_router("demo")

    @router.post("/echo")
    def echo(call: FnCall, claims: dict | None = Depends(optional_user)) -> dict:
        return {"data": call.data, "authed": claims is not None}

    @router.post("/todo")
    def todo(call: FnCall) -> dict:
        raise not_implemented("todo")

    app = FastAPI()
    app.include_router(router)
    return app


def test_fn_route_shape_and_optional_auth():
    client = TestClient(_app())
    res = client.post("/demo/fn/echo", json={"data": {"q": 1}})
    assert res.status_code == 200
    assert res.json() == {"data": {"q": 1}, "authed": False}


def test_missing_data_defaults_to_none():
    res = TestClient(_app()).post("/demo/fn/echo", json={})
    assert res.json()["data"] is None


def test_not_implemented_is_501():
    res = TestClient(_app()).post("/demo/fn/todo", json={"data": None})
    assert res.status_code == 501
    assert res.json()["detail"] == "not_implemented: todo"


class _Cur:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append((sql, params))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Conn:
    def __init__(self, log):
        self.log = log

    def cursor(self):
        return _Cur(self.log)


@pytest.fixture
def leased(monkeypatch):
    log: list = []
    seen: dict = {}

    @contextmanager
    def fake_lease(url, claims):
        seen["url"], seen["claims"] = url, claims
        yield _Conn(log)

    monkeypatch.setattr(db, "_lease", fake_lease)
    monkeypatch.setenv("DATABASE_URL", "postgres://primary")
    monkeypatch.setenv("DATABASE_READ_URL", "postgres://replica")
    return log, seen


def test_role_connection_sets_role_and_claims(leased):
    log, seen = leased
    with db.role_connection("authenticated", {"sub": "u1", "role": "authenticated"}):
        pass
    # claims and role in one statement (one round trip), both transaction-local
    (sql, params), = log
    assert "set_config('request.jwt.claims', %s, true)" in sql
    assert "set_config('role', %s, true)" in sql
    assert params == (json.dumps({"sub": "u1", "role": "authenticated"}), "authenticated")
    assert seen == {"url": "postgres://replica", "claims": None}


def test_role_connection_write_uses_primary(leased):
    log, seen = leased
    with db.role_connection("service_role", write=True):
        pass
    assert seen["url"] == "postgres://primary"
    (_, params), = log
    assert params == (json.dumps({"role": "service_role"}), "service_role")


def test_role_connection_rejects_unknown_role_and_missing_claims(leased):
    with pytest.raises(ValueError), db.role_connection("postgres"):
        pass
    with pytest.raises(ValueError), db.role_connection("authenticated"):
        pass
