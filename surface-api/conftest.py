"""Test fixtures shared by every Surface (no live DB, no network).

Two fake DBs stand in for `_base.db.session.role_connection`:
- `fakedb(module, ...)`: cursor style. `db.on(substring, rows | exception | fn)` answers queries
  whose SQL contains the substring (first match wins); `db.log` has (role, sql, params).
- `fake_db_for(modules)(responder)`: execute style. `responder(sql, params)` returns rows or an
  exception; `db.log` has (role, write, sql, params). A Surface's own `conftest.py` wraps it in a
  `fake_db` fixture naming the modules it patches.
`surface_client(name)` builds a TestClient on one Surface's router (signed in, or anonymous).
"""
from __future__ import annotations

import importlib
from collections.abc import Callable, Iterable
from contextlib import contextmanager, nullcontext
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_srp_user, current_user

# --- cursor-style fake: `fakedb` -------------------------------------------------------------


class FakeCursor:
    def __init__(self, db: FakeDB, role: str):
        self.db, self.role, self._rows = db, role, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, params: Any = None) -> None:
        self.db.log.append((self.role, " ".join(sql.split()), params))
        for needle, result in self.db.responses:
            if needle in sql:
                if callable(result):
                    result = result(sql, params)
                if isinstance(result, BaseException):
                    raise result
                self._rows = list(result)
                return
        self._rows = []

    def fetchall(self) -> list[dict]:
        return self._rows

    def fetchone(self) -> dict | None:
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self, db: FakeDB, role: str):
        self.db, self.role = db, role

    def cursor(self) -> FakeCursor:
        return FakeCursor(self.db, self.role)

    @contextmanager
    def transaction(self):
        yield


class FakeDB:
    """`on(substring, rows | exception | fn)` registers a response; first match wins."""

    def __init__(self):
        self.responses: list[tuple[str, Any]] = []
        self.log: list[tuple[str, str, Any]] = []
        self.leases: list[dict] = []

    def on(self, needle: str, result: Any) -> FakeDB:
        self.responses.append((needle, result))
        return self

    @contextmanager
    def role_connection(self, role, jwt_claims=None, *, write=False, fresh=False):
        self.leases.append({"role": role, "claims": jwt_claims, "write": write, "fresh": fresh})
        yield FakeConn(self, role)

    def sql(self, needle: str) -> list[tuple[str, str, Any]]:
        return [e for e in self.log if needle in e[1]]


@pytest.fixture
def fakedb(monkeypatch) -> Callable[..., FakeDB]:
    """`fakedb(module, ...)` patches each module's `role_connection` with one FakeDB."""

    def make(*modules) -> FakeDB:
        db = FakeDB()
        for m in modules:
            monkeypatch.setattr(m, "role_connection", db.role_connection)
        return db

    return make


# --- execute-style fake: `fake_db_for` -------------------------------------------------------

Responder = Callable[[str, Any], Any]


class RecordingDB:
    """Records (role, write, sql, params); a responder returns rows or an Exception to raise."""

    def __init__(self, responder: Responder):
        self.responder = responder
        self.log: list[tuple[str, bool, str, Any]] = []

    def sql(self) -> list[str]:
        return [entry[2] for entry in self.log]

    def find(self, needle: str) -> list[tuple[str, bool, str, Any]]:
        return [entry for entry in self.log if needle in entry[2]]

    def role_connection(self, role, jwt_claims=None, *, write=False, fresh=False):
        db = self

        class _Result:
            def __init__(self, found):
                self.found = list(found)

            def fetchall(self):
                return self.found

            def fetchone(self):
                return self.found[0] if self.found else None

        class _Conn:
            def execute(self, sql, params=None):
                db.log.append((role, write, sql, params))
                out = db.responder(sql, params)
                if isinstance(out, Exception):
                    raise out
                return _Result(out or [])

            def transaction(self):
                return nullcontext()

        @contextmanager
        def _cm():
            yield _Conn()

        return _cm()


@pytest.fixture
def fake_db_for(monkeypatch) -> Callable[[Iterable[str]], Callable[[Responder], RecordingDB]]:
    """`fake_db_for(module_names)` -> `install(responder)`, which patches each named module's
    `role_connection` with one RecordingDB and returns it."""

    def bind(modules: Iterable[str]) -> Callable[[Responder], RecordingDB]:
        names = tuple(modules)

        def install(responder: Responder) -> RecordingDB:
            db = RecordingDB(responder)
            for name in names:
                monkeypatch.setattr(importlib.import_module(name), "role_connection", db.role_connection)
            return db

        return install

    return bind


# --- a client on one Surface's router ---------------------------------------------------------


@pytest.fixture
def surface_client() -> Callable[..., TestClient]:
    """`surface_client("search")` signed in as an authenticated user; `signed_in=False` for anon."""

    def make(name: str, *, signed_in: bool = True) -> TestClient:
        app = FastAPI()
        app.include_router(importlib.import_module(f"surfaces.{name}.router").router)
        if signed_in:
            claims = {"sub": "user-1", "role": "authenticated"}
            app.dependency_overrides[current_user] = lambda: claims
            app.dependency_overrides[current_srp_user] = lambda: claims
        return TestClient(app)

    return make
