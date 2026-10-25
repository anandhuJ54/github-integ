"""xmp directory endpoint (fake connection, no live DB or auth): the brand rollup for the sales
Directory drill-downs. Moved from sales/queries/nav_test.py with the endpoint
(/sales/nav/organizations/{id}/brand-rollup), surface audit 2026-10-25."""
from __future__ import annotations

import uuid
from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from xmp.routers.directory_data import router

UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CLAIMS = {"sub": UID, "role": "authenticated"}
RID = "11111111-1111-4111-8111-111111111111"
RID2 = "22222222-2222-4222-8222-222222222222"
P = "/xmp/directory"


class Rows:
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

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def _run(self, sql, params):
        self.log.append((sql, params or {}))
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return rows

    def execute(self, sql, params=None):
        return Rows(self._run(sql, params))

    def cursor(self):
        conn = self

        class C(Rows):
            def __init__(self):
                super().__init__([])

            def execute(self, sql, params=None):
                self.rows = conn._run(sql, params)

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


def sqls(log):
    return [s for s, _ in log if "savepoint" not in s]


def params_of(log, sql):
    return next(p for x, p in log if x == sql)


def table_of(sql: str) -> str:
    return sql.split("FROM public.", 1)[1].split()[0]


def test_needs_a_signed_in_user():
    assert client(None).get(f"{P}/brands/{RID}/rollup").status_code == 403


def test_brand_rollup_locations_threw_the_rest_tolerant(dbfake):
    log, state, leases = dbfake

    def answer(sql, params):
        if "count(*)" in sql:
            if "JOIN public.organizations" in sql:
                return psycopg.errors.UndefinedTable("no embed")
            return [{"n": 3}]
        if table_of(sql) == "exp_claim_events":
            return [{"entity_id": uuid.UUID(RID), "entity_type": "location", "event_type": "claimed"}]
        return [{"id": uuid.UUID(RID2)}]

    state["answer"] = answer
    out = client().get(f"{P}/brands/{RID}/rollup").json()
    assert leases == [False]
    assert out == {"locations": [{"id": RID2}], "childCount": 3, "directCount": 3,
                   "viaOfficesCount": None,
                   "claims": [{"entity_id": RID, "entity_type": "location", "event_type": "claimed"}]}
    s = sqls(log)
    assert "ORDER BY public.organizations.name ASC" in s[0] and params_of(log, s[0])["param_1"] == 500
    via = next(x for x in s if "JOIN public.organizations" in x)
    assert "professionals.primary_org_id = public.organizations.id" in via
    assert "public.organizations.parent_org_id = " in via
    claims_sql = next(x for x in s if "FROM public.exp_claim_events" in x)
    assert "ORDER BY" not in claims_sql and params_of(log, claims_sql)["param_1"] == 1000
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"{P}/brands/{RID}/rollup").status_code == 403
