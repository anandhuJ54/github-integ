"""roles.tsx port (no live DB/auth): the SQL each call compiles to, the roles, the signed-out
outcome, and that the bootstrap and audit insert are only checked for the SQL they would send."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from _base.auth import current_user
from _base.db import session as core_db
from _base.db.sql import capped, compile_sql
from _base.server_fn import optional_user
from surfaces.admin.queries import me as q
from surfaces.admin.routers.me import router

UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CLAIMS = {"sub": UID, "role": "authenticated"}


def sql(stmt) -> str:
    return " ".join(compile_sql(capped(stmt))[0].split())


# --- compiled SQL ------------------------------------------------------------------------------

def test_grants_read_is_the_users_own_rows_capped():
    st = q.grants_stmts(UID)
    s = sql(st["grants"])
    assert s.startswith("SELECT public.exp_control_grants.id, public.exp_control_grants.role, "
                        "public.exp_control_grants.scope_type, public.exp_control_grants.scope_id, "
                        "public.exp_control_grants.is_primary FROM public.exp_control_grants")
    assert "WHERE public.exp_control_grants.user_id = " in s and "LIMIT" in s
    assert compile_sql(capped(st["grants"]))[1]["user_id_1"] == UID


def test_scope_names_are_keyed_off_the_grants_in_sql():
    st = q.grants_stmts(UID)
    e, n = sql(st["entities"]), sql(st["nodes"])
    assert "SELECT public.exp_entity.entity_id, public.exp_entity.display_name" in e
    assert "WHERE public.exp_entity.entity_id IN (SELECT CASE WHEN (g.scope_id ~* " in e
    assert "CAST(g.scope_id AS UUID)" in e and "FROM public.exp_control_grants AS g" in e
    assert "SELECT public.exp_control_nodes.node_id, public.exp_control_nodes.name" in n
    pe, pn = compile_sql(st["entities"])[1], compile_sql(st["nodes"])[1]
    assert "entity" in pe.values() and "control_node" in pn.values()
    assert UID in pe.values() and UID in pn.values()


def test_audit_insert_sql_and_jsonb_details():
    s, p = compile_sql(q.audit_stmt(UID, {"action": "workspace_switch", "acting_role": "analyst",
                                         "target": "g1", "details": {"role": "analyst"}}))
    assert s.startswith("INSERT INTO public.exp_admin_audit (user_id, acting_role, action, target, "
                        "details) VALUES")
    assert p["user_id"] == UID and isinstance(p["details"], Jsonb)
    assert p["details"].obj == {"role": "analyst"}


# --- endpoints (fake connection) ---------------------------------------------------------------

class Cur:
    def __init__(self, conn):
        self.conn, self.rows, self.description = conn, [], [("x",)]

    def execute(self, s, p=None):
        self.conn.log.append((s, p or {}))
        out = self.conn.answer(s, p or {})
        if isinstance(out, Exception):
            raise out
        self.rows = out

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
        c = Cur(self)
        if "savepoint" in s:
            self.log.append((s, p or {}))
        else:
            c.execute(s, p)
        return c

    def cursor(self):
        return Cur(self)


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


def client(user=CLAIMS) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    app.dependency_overrides[optional_user] = lambda: user
    return TestClient(app)


def _answer(s, p):
    if "FROM public.exp_control_grants" in s and "exp_entity" not in s and "exp_control_nodes" not in s:
        return [{"id": "g1", "role": "analyst", "scope_type": "entity", "scope_id": "e1",
                 "is_primary": False}]
    if "FROM public.exp_entity" in s:
        return [{"entity_id": "e1", "display_name": "Acme"}]
    return []


def test_grants_signed_in_one_round_trip_as_the_user(fake):
    log, leases, state = fake
    state["answer"] = _answer
    r = client().get("/admin/me/grants")
    assert r.status_code == 200 and leases == [("authenticated", CLAIMS, False)]
    body = r.json()
    assert body["grants"][0]["id"] == "g1" and body["entities"] == [
        {"entity_id": "e1", "display_name": "Acme"}] and body["nodes"] == []
    # savepoint, three selects, release — the pipeline batch
    assert log[0][0] == "savepoint fetch_many" and len(log) == 5


def test_grants_signed_out_is_empty_without_a_connection(fake):
    _, leases, _ = fake
    r = client(user=None).get("/admin/me/grants")
    assert r.json() == {"grants": [], "entities": [], "nodes": []} and leases == []


def test_grants_failure_is_no_rows(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("denied")
    assert client().get("/admin/me/grants").json() == {"grants": [], "entities": [], "nodes": []}


def test_bootstrap_calls_the_function_then_rereads_on_the_primary(fake):
    log, leases, state = fake
    state["answer"] = lambda s, p: [{"v": "already_bootstrapped"}] if "bootstrap" in s \
        else _answer(s, p)
    r = client().post("/admin/me/bootstrap")
    assert r.status_code == 200 and leases == [("authenticated", CLAIMS, True)]
    assert log[0][0] == q.BOOTSTRAP_SQL and r.json()["grants"][0]["id"] == "g1"


def test_bootstrap_error_is_ignored(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("nope") if "bootstrap" in s \
        else []
    r = client().post("/admin/me/bootstrap")
    assert r.status_code == 200 and r.json()["grants"] == []


@pytest.mark.parametrize("method,path", [("post", "/admin/me/bootstrap"),
                                         ("post", "/admin/me/audit")])
def test_writes_need_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).post(path, json={"action": "x"}).status_code == 403


def test_audit_user_id_comes_from_the_token(fake):
    log, leases, _ = fake
    r = client().post("/admin/me/audit", json={"action": "workspace_switch", "acting_role": None,
                                               "target": "g1", "details": {"a": 1}})
    assert r.status_code == 200 and leases == [("authenticated", CLAIMS, True)]
    s, p = log[0]
    assert s.startswith("INSERT INTO public.exp_admin_audit") and p["user_id"] == UID
    assert p["acting_role"] is None and p["details"].obj == {"a": 1}


def test_audit_rejects_extra_keys_such_as_user_id(fake):
    _, leases, _ = fake
    r = client().post("/admin/me/audit", json={"action": "x", "user_id": "someone-else"})
    assert r.status_code == 422 and leases == []


def test_audit_refusal_is_403(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("row-level security")
    assert client().post("/admin/me/audit", json={"action": "x"}).status_code == 403
