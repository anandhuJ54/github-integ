"""Shared fakes for the conversion_agents function tests (no live DB)."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core.auth import current_user


class FakeDB:
    """Records (role, sql, params) and answers each query from a responder."""

    def __init__(self, responder: Callable[[str, Any], list[dict]]):
        self.responder = responder
        self.log: list[tuple[str, dict | None, bool, str, Any]] = []

    def role_connection(self, role, jwt_claims=None, *, write=False, fresh=False):
        db = self

        class _Cur:
            def __init__(self):
                self.rows: list[dict] = []

            def execute(self, sql, params=None):
                db.log.append((role, jwt_claims, write, sql, params))
                self.rows = list(db.responder(sql, params))

            def fetchall(self):
                return self.rows

            def fetchone(self):
                return self.rows[0] if self.rows else None

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        class _Conn:
            def cursor(self):
                return _Cur()

        @contextmanager
        def _cm():
            yield _Conn()

        return _cm()


@pytest.fixture
def fake_db(monkeypatch):
    def install(responder: Callable[[str, Any], list[dict]]) -> FakeDB:
        db = FakeDB(responder)
        from conversion_agents.routers import _sql, site_proposal_fn

        monkeypatch.setattr(_sql, "role_connection", db.role_connection)
        monkeypatch.setattr(site_proposal_fn, "role_connection", db.role_connection)
        return db

    return install


@pytest.fixture
def client():
    from conversion_agents.router import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: {"sub": "user-1", "role": "authenticated"}
    return TestClient(app)
