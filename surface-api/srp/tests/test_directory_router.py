"""srp directory endpoints (fake connection, no live DB or auth): the professional and
organization rows for the sales Directory drill-downs. Moved from sales/queries/nav_test.py with
the endpoints (/sales/nav/professionals/{id}, /sales/nav/organizations/{id}), surface audit
2026-10-25."""
from __future__ import annotations

import uuid
from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.srp.directory.router import router

UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CLAIMS = {"sub": UID, "role": "authenticated"}
RID = "11111111-1111-4111-8111-111111111111"
P = "/srp/directory"


class Cur:
    def __init__(self, rows):
        self.rows, self.description = rows, [("x",)]

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer):
        self.log, self.answer = log, answer

    def cursor(self):
        conn = self

        class C(Cur):
            def __init__(self):
                super().__init__([])

            def execute(self, sql, params=None):
                conn.log.append((sql, params or {}))
                rows = conn.answer(sql, params or {})
                if isinstance(rows, Exception):
                    raise rows
                self.rows = rows

        return C()


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    leases: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS
        leases.append(write)
        yield FakeConn(log, lambda s, p: state["answer"](s, p))

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state, leases


def client(claims=CLAIMS) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    if claims is not None:
        app.dependency_overrides[current_user] = lambda: claims
    return TestClient(app)


@pytest.mark.parametrize("path", [f"{P}/organizations/{RID}", f"{P}/professionals/{RID}"])
def test_every_read_needs_a_signed_in_user(path):
    assert client(None).get(path).status_code == 403


def test_org_and_professional_star_maybe_single(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/organizations/{RID}").json() == {"id": RID}
    assert client().get(f"{P}/professionals/{RID}").json() == {"id": RID}
    assert leases == [False, False]
    (o, op), (pr, pp) = log
    assert "public.organizations.hierarchy_depth" in o  # select("*")
    assert "FROM public.organizations" in o and "WHERE public.organizations.id = " in o
    assert "FROM public.professionals" in pr and "WHERE public.professionals.id = " in pr
    assert RID in op.values() and 2 in op.values()  # .maybeSingle(): limit 2
    assert RID in pp.values() and 2 in pp.values()
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/professionals/{RID}").json() is None
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get(f"{P}/organizations/{RID}").status_code == 406
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation("invalid input syntax")
    assert client().get(f"{P}/professionals/x").status_code == 400
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"{P}/organizations/{RID}").status_code == 403
