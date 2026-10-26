"""Shared fakes for the srp tests (no live DB, no network)."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager, nullcontext
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user

Responder = Callable[[str, Any], Any]


class FakeDB:
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


_MODULES = ("surfaces.srp.routers.reviews_fn",)


@pytest.fixture
def fake_db(monkeypatch):
    import importlib

    def install(responder: Responder) -> FakeDB:
        db = FakeDB(responder)
        for name in _MODULES:
            monkeypatch.setattr(importlib.import_module(name), "role_connection", db.role_connection)
        return db

    yield install


@pytest.fixture
def client():
    from surfaces.srp.router import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: {"sub": "user-1", "role": "authenticated"}
    return TestClient(app)


@pytest.fixture
def anon_client():
    from surfaces.srp.router import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)
