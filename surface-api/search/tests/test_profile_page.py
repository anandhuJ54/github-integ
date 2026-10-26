"""The long-form profile page reads (no live DB/auth): the SQL each read compiles to and the
endpoint shapes. Moved from graph/queries/entities_test.py with the reads, surface audit 2026-10-25."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from _base.db.sql import capped, compile_sql
from surfaces.search.queries import profile_page as pp
from surfaces.search.routers.profile_page import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
PID = "11111111-1111-4111-8111-111111111111"
OID = "22222222-2222-4222-8222-222222222222"


def sql(stmt) -> str:
    return " ".join(compile_sql(capped(stmt))[0].split())


def params(stmt) -> dict:
    return compile_sql(capped(stmt))[1]


def test_profile_side_reads():
    st = pp.profile_side_stmts(PID, "gcid:insurance_agency")
    assert "(public.graph_nodes.ring = " in sql(st["graphNodes"]) and \
        "OR public.graph_nodes.schema_property = " in sql(st["graphNodes"])
    assert "ORDER BY public.credentials.verified DESC" in sql(st["credentials"])
    assert "ORDER BY public.reviews.review_date DESC" in sql(st["reviews"])
    assert params(st["reviews"])["param_1"] == 5 and params(st["content"])["param_1"] == 3
    assert "aggregate_ratings.source = " in sql(st["aggregateRating"])
    # loadOrg(primary_org_id) keyed off the professional in SQL
    assert "organizations.id = (SELECT public.professionals.primary_org_id" in sql(st["org"])
    assert set(params(st["taxonomy"]).values()) >= set(pp.TAX_LEVELS)
    assert "taxonomy" not in pp.profile_side_stmts(PID, None)


def test_services_by_priority_20():
    s = sql(pp.services_stmt("gcid:x"))
    assert "ORDER BY public.exp_taxonomy.priority ASC" in s
    assert params(pp.services_stmt("gcid:x"))["param_1"] == 20


# --- endpoints (fake connection) ---------------------------------------------------------------

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
        self.log.append((s, p or {}))
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


@pytest.mark.parametrize("path", ["/search/profile-page/x", "/search/profile-services?gcid=gcid:x"])
def test_profile_needs_a_signed_in_user(path):
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get(path).status_code == 403


def test_profile_services_error_is_no_rows(fake):
    _, leases, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("forbidden")
    assert client().get("/search/profile-services?gcid=gcid:x").json() == []
    assert leases == [("authenticated", CLAIMS, False)]


def test_profile_unknown_slug_is_null_and_skips_side_reads(fake):
    log, _, _ = fake
    assert client().get("/search/profile-page/nobody").json() == {"profile": None}
    assert len([s for s, _ in log if "savepoint" not in s]) == 1


def test_profile_several_view_rows_is_an_error(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: [{"id": PID}, {"id": OID}]
    assert client().get("/search/profile-page/dup").status_code == 400


def test_profile_side_reads_by_name(fake):
    _, _, state = fake

    def answer(s, p):
        if "v_professional_profile" in s:
            return [{"id": PID, "gcid": "gcid:x"}]
        if "FROM public.organizations" in s:
            return [{"id": OID, "name": "Org"}]
        if "FROM public.reviews" in s:
            return [{"id": "r1"}]
        return []

    state["answer"] = answer
    r = client().get("/search/profile-page/a").json()
    assert r["org"] == {"id": OID, "name": "Org"} and r["reviews"] == [{"id": "r1"}]
    assert r["pro"] is None and r["aggregateRating"] is None and r["taxonomy"] == []
