"""Test fixtures: a fake role-scoped DB that records SQL and returns canned rows (no live DB)."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from typing import Any

import pytest


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
