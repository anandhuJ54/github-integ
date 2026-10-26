"""/admin/claims: the claims page's endpoints (replaced its direct Supabase calls; no live DB/auth)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from surfaces.admin.router import router

from _base.auth import current_user
from _base.db import session as core_db

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}


class Diag:
    def __init__(self, msg):
        self.message_primary = msg


class DbErr(psycopg.Error):
    def __init__(self, msg):
        super().__init__(msg)
        self._msg = msg

    @property
    def diag(self):  # psycopg.Error.diag is read-only; fake it
        return Diag(self._msg)


class FakeConn:
    def __init__(self, log, answer, role, write):
        self.log, self.answer, self.role, self.write = log, answer, role, write

    @contextmanager
    def transaction(self):
        yield

    def cursor(self):
        conn = self

        class Cur:
            description = None

            def execute(self, sql, params=None):
                conn.log.append((conn.role, conn.write, sql, params))
                rows = conn.answer(sql, params or {})
                if isinstance(rows, Exception):
                    raise rows
                self._rows = rows or []
                self.description = [("x",)] if rows is not None else None

            def fetchall(self):
                return self._rows

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return Cur()


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS  # always as the signed-in user
        yield FakeConn(log, lambda s, p: state["answer"](s, p), role, write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("get", "/admin/claims/stats"),
    ("get", "/admin/claims"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path).status_code == 403


# --- /claims ---------------------------------------------------------------------------------

def test_stats_one_query_four_filters(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"pending": 1, "approved": 2, "manual": 3, "conflict": 4}]
    r = client().get("/admin/claims/stats")
    assert r.json() == {"pending": 1, "approved": 2, "manual": 3, "conflict": 4}
    (_, write, sql, params), = log
    assert not write and sql.count("FILTER") == 4 and "FROM public.claim_queue" in sql
    assert sorted(v for k, v in params.items() if k.startswith("status")) == sorted(
        ["pending", "auto_approved", "approved", "manual_review", "conflict"])


@pytest.mark.parametrize("tab,statuses", [
    ("pending", ["pending"]),
    ("auto_approved", ["auto_approved", "approved"]),
    ("all", []),
])
def test_list_filters_by_tab_newest_first_200(dbfake, tab, statuses):
    log, state = dbfake
    row = {"id": "c1", "entity_type": "professional", "entity_id": "p1", "claimant_user_id": None,
           "claimant_email": "a@b.c", "claimant_name": None, "confidence_score": 90,
           "confidence_signals": None, "match_method": "email", "status": "pending",
           "review_notes": None, "created_at": "2026-10-23T00:00:00+00:00", "trust_tier": 2}
    state["answer"] = lambda s, p: [row]
    r = client().get("/admin/claims", params={"tab": tab})
    assert r.status_code == 200 and r.json()[0]["trust_tier"] == 2  # select * passes through
    sql, params = log[0][2], log[0][3]
    assert "ORDER BY public.claim_queue.created_at DESC" in sql and "LIMIT" in sql
    assert params["param_1"] == 200
    assert sorted(v for k, v in params.items() if k.startswith("status")) == sorted(statuses)


def test_list_rejects_an_unknown_tab(dbfake):
    assert client().get("/admin/claims", params={"tab": "x"}).status_code == 422


def test_entities_names_and_failed_read_is_empty(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "FROM public.professionals" in sql:
            return [
                {"id": "p1", "display_name": None, "first_name": "Ann", "last_name": None,
                 "gcid": "gcid:x", "photo_url": None},
                {"id": "p2", "display_name": "", "first_name": None, "last_name": None,
                 "gcid": None, "photo_url": "u"},
            ]
        return DbErr("permission denied for table organizations")

    state["answer"] = answer
    r = client().post("/admin/claims/entities",
                      json={"professionalIds": ["p1", "p2"], "organizationIds": ["o1"]})
    assert r.json() == {
        "p1": {"name": "Ann", "gcid": "gcid:x", "imageUrl": None, "kind": "professional"},
        "p2": {"name": "Unnamed", "gcid": None, "imageUrl": "u", "kind": "professional"},
    }


def test_entities_with_no_ids_makes_no_query(dbfake):
    log, _ = dbfake
    assert client().post("/admin/claims/entities", json={}).json() == {}
    assert log == []


def test_adjudicate_calls_the_governed_function_as_a_write(dbfake):
    log, _ = dbfake
    r = client().post("/admin/claims/q1/adjudicate", json={"approve": True, "note": ""})
    assert r.json() == {"ok": True}
    (_, write, sql, params), = log
    assert write and "exp_claim_queue_adjudicate(p_queue => %(q)s" in sql
    assert params == {"q": "q1", "a": True, "n": None}  # empty note → null, as `|| null` did


def test_adjudicate_error_message_reaches_the_page(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: DbErr("claim already adjudicated")
    r = client().post("/admin/claims/q1/adjudicate", json={"approve": False})
    assert r.status_code == 400 and r.json()["detail"] == "claim already adjudicated"
