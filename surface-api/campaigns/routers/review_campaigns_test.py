"""Enterprise review campaigns endpoints (fake connection, no live DB or auth): roles, shapes and
the write model's allow-list. Moved from xmp/routers/seat_router_test.py with the endpoints,
surface audit 2026-10-25."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from campaigns.routers.review_campaigns import router

UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CLAIMS = {"sub": UID, "role": "authenticated"}
PID = "11111111-1111-4111-8111-111111111111"
OID = "22222222-2222-4222-8222-222222222222"


class Cur:
    def __init__(self, rows):
        self.rows, self.description = rows, [("x",)]

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer):
        self.log, self.answer = log, answer

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def execute(self, s, p=None):
        self.log.append((" ".join(s.split()), p or {}))
        rows = [] if "savepoint" in s else self.answer(s, p or {})
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)

    def cursor(self):
        conn = self

        class C(Cur):
            def __init__(self):
                super().__init__([])

            def execute(self, s, p=None):
                self.rows = conn.execute(s, p).rows

        return C()


@pytest.fixture
def fake(monkeypatch):
    log: list = []
    leases: list = []
    state = {"answer": lambda s, p: []}

    @contextmanager
    def role_connection(role, claims=None, *, write=False, fresh=False):
        leases.append((role, claims, write))
        yield FakeConn(log, lambda s, p: state["answer"](s, p))

    monkeypatch.setattr(core_db, "role_connection", role_connection)
    return log, leases, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def sent(log) -> list[str]:
    return [s for s, _ in log if "savepoint" not in s]


@pytest.mark.parametrize("method,path", [
    ("get", "/campaigns/enterprise/orgs/x/campaigns"), ("post", "/campaigns/enterprise/campaigns"),
    ("patch", "/campaigns/enterprise/campaigns/x"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    r = getattr(TestClient(app), method)(path, **({"json": {}} if method != "get" else {}))
    assert r.status_code == 403


def test_campaigns_page_unknown_slug(fake):
    log, _, _ = fake
    assert client().get("/campaigns/enterprise/orgs/nope/campaigns").json() == {"root": None}
    assert len(sent(log)) == 1


def test_writes_run_as_the_user_on_the_primary(fake):
    _, leases, _ = fake
    assert client().patch(f"/campaigns/enterprise/campaigns/{PID}", json={"status": "paused"}).json() \
        == {"ok": True}
    assert leases == [("authenticated", CLAIMS, True)]


def test_campaign_insert_forbids_other_columns(fake):
    _, leases, _ = fake
    r = client().post("/campaigns/enterprise/campaigns", json={"name": "x", "redirect_url": "http://e"})
    assert r.status_code == 422 and leases == []


def test_campaign_insert_rls_error_is_403_with_the_message(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "review_campaigns"')
    r = client().post("/campaigns/enterprise/campaigns", json={"name": "x", "status": "draft"})
    assert r.status_code == 403 and "row-level security" in r.json()["detail"]
