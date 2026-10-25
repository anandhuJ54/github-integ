"""Control-graph claims (no live DB/auth): the SQL each read compiles to, the caps, the roles and
the RPC allow-list. Moved from graph/queries/entities_test.py (surface audit 2026-10-25)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from _base.core.sql import capped, compile_sql
from admin.queries import control_claims as q
from admin.routers.control_claims import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
PID = "11111111-1111-4111-8111-111111111111"


def sql(stmt) -> str:
    return " ".join(compile_sql(capped(stmt))[0].split())


def params(stmt) -> dict:
    return compile_sql(capped(stmt))[1]


# --- compiled SQL ------------------------------------------------------------------------------

def test_entities_lite_keeps_the_1000_cap():
    # claims-tab asked for 2000; PostgREST max-rows returned 1000 (gap 1g, kept)
    assert params(q.entities_lite_stmt())["param_1"] == 1000
    assert "ORDER BY" not in sql(q.entities_lite_stmt())


def test_claims_newest_500():
    assert "ORDER BY public.exp_claim.created_at DESC" in sql(q.claims_stmt())
    assert params(q.claims_stmt())["param_1"] == 500


# --- the RPC allow-list ------------------------------------------------------------------------

def test_rpc_adjudicate_casts_given_arguments():
    s, p = q.rpc_sql("exp_claim_adjudicate", {"p_claim": PID, "p_approve": False})
    assert s == ("select public.exp_claim_adjudicate(p_claim => %(p_claim)s::uuid, "
                 "p_approve => %(p_approve)s::boolean) as v")
    assert p == {"p_claim": PID, "p_approve": False}


@pytest.mark.parametrize("name,args", [
    ("exp_ctrl_create_node", {}),  # graph's, not admin's
    ("exp_graph_upsert_nodes", {}),
    ("exp_claim_adjudicate", {"p_claim": PID, "p_evil": 1}),
])
def test_rpc_outside_the_allow_list_is_refused(name, args):
    with pytest.raises(q.UnknownRpc):
        q.rpc_sql(name, args)


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


@pytest.mark.parametrize("method,path", [
    ("get", "/admin/control-claims"), ("get", "/admin/control-claims/entities-lite"),
    ("get", "/admin/control-claims/users"),
    ("post", "/admin/control-claims/rpc/exp_claim_adjudicate"),
])
def test_endpoints_need_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path, **({"json": {}} if method == "post" else {})) \
        .status_code == 403


def test_reads_run_as_the_user(fake):
    _, leases, state = fake
    state["answer"] = lambda s, p: [{"claim_id": PID}] if "exp_claim" in s else []
    assert client().get("/admin/control-claims").json() == [{"claim_id": PID}]
    assert client().get("/admin/control-claims/entities-lite").json() == []
    assert leases == [("authenticated", CLAIMS, False)] * 2


def test_users_calls_list_control_users(fake):
    log, leases, state = fake
    state["answer"] = lambda s, p: [{"user_id": PID, "email": "a@example.com"}]
    r = client().get("/admin/control-claims/users")
    assert r.json() == [{"user_id": PID, "email": "a@example.com"}]
    assert "list_control_users()" in log[0][0] and leases == [("authenticated", CLAIMS, False)]


def test_rpc_runs_as_the_user_on_the_primary(fake):
    log, leases, state = fake
    state["answer"] = lambda s, p: [{"v": None}]
    r = client().post("/admin/control-claims/rpc/exp_claim_adjudicate",
                      json={"args": {"p_claim": PID, "p_approve": True}})
    assert r.status_code == 200 and leases == [("authenticated", CLAIMS, True)]
    assert "exp_claim_adjudicate(" in log[0][0]


def test_unknown_rpc_is_400_without_a_connection(fake):
    _, leases, _ = fake
    assert client().post("/admin/control-claims/rpc/exp_ctrl_create_node", json={"args": {}}) \
        .status_code == 400
    assert leases == []


def test_refusal_is_403(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("forbidden")
    assert client().get("/admin/control-claims/users").status_code == 403
