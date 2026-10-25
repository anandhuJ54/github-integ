"""Console home endpoints (no live DB/auth), moved from the ops Surface (surface audit
2026-10-25)."""
from __future__ import annotations

from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from admin.routers.console_home import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "email": "me@example.com",
          "role": "authenticated"}


class Cur:
    def __init__(self, rows):
        self.rows = rows or []
        self.description = [("x",)]

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def execute(self, sql, params=None):
        self.log.append((self.write, sql, params or {}))
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS and not write
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


@pytest.mark.parametrize("path", [
    "/admin/console/revenue", "/admin/console/profiles", "/admin/console/categories",
    "/admin/console/nora-events",
])
def test_every_endpoint_needs_a_signed_in_user(path):
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get(path).status_code == 403


def test_console_profiles_two_queries_with_date_typed_bounds(dbfake):
    log, state = dbfake
    keys = ["total", "new7", "prev7", "claimed", "claims7", "claimsPrev7", "claimsToday"]
    state["answer"] = lambda s, p: [dict.fromkeys(keys, 1)]
    body = client().get("/admin/console/profiles", params={
        "d7": "2026-10-16T00:00:00Z", "d14": "2026-10-09T00:00:00Z",
        "today": "2026-10-23T00:00:00Z"}).json()
    assert set(body) == {f"{t}_{k}" for t in ("pros", "orgs") for k in keys}
    counts = [s for _, s, _ in log if "count(*)" in s]
    assert len(counts) == 2 and all("::TIMESTAMP WITH TIME ZONE" in s for s in counts)
