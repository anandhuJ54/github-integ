"""/admin/plg-rules: the PLG rules page's endpoints (replaced its direct Supabase calls; no live DB/auth)."""
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
    ("get", "/admin/plg-rules"),
    ("delete", "/admin/plg-rules/r1"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path).status_code == 403


# --- /emp/plg-rules --------------------------------------------------------------------------

def test_rules_page_reads_rules_and_capped_event_stats(dbfake):
    log, state = dbfake
    rule = {"id": "r1", "gcid": None, "rule_name": "a", "rule_type": "banner",
            "trigger_condition": {}, "priority": 1, "headline": "h", "body": "b",
            "cta_text": "c", "cta_action": "x", "cta_url": None, "requires_upgrade": False,
            "upgrade_tier": None, "icon": None, "is_active": True,
            "created_at": "2026-10-23T00:00:00+00:00"}

    def answer(sql, params):
        if "FROM public.plg_rules" in sql:
            return [rule]
        return [{"rule_id": "r1", "fires": 3, "dismissals": 1, "conversions": 0}]

    state["answer"] = answer
    r = client().get("/admin/plg-rules")
    assert r.json() == {"rules": [rule],
                        "stats": [{"rule_id": "r1", "fires": 3, "dismissals": 1, "conversions": 0}]}
    rules_sql = log[0][2]
    assert "ORDER BY public.plg_rules.priority ASC, public.plg_rules.rule_name ASC" in rules_sql
    stats_sql, stats_params = log[1][2], log[1][3]
    assert "GROUP BY" in stats_sql and 1000 in stats_params.values()  # PostgREST max-rows


def test_toggle_updates_then_audits_as_a_write(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: None
    r = client().patch("/admin/plg-rules/r1/active", json={"is_active": False})
    assert r.json() == {"ok": True}
    assert [w for _, w, _, _ in log] == [True, True]
    assert log[0][2].startswith("UPDATE public.plg_rules")
    audit = log[1]
    assert audit[2].startswith("INSERT INTO public.audit_log")
    assert "plg_rule.deactivate" in audit[3].values()


def test_a_refused_audit_row_keeps_the_change(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "audit_log" in sql:
            return DbErr("new row violates row-level security policy")
        return None

    state["answer"] = answer
    assert client().delete("/admin/plg-rules/r1").json() == {"ok": True}


def test_create_logs_the_new_rule_id(dbfake):
    log, state = dbfake

    def answer(sql, params):
        return [{"id": "new-1"}] if sql.startswith("INSERT INTO public.plg_rules") else None

    state["answer"] = answer
    r = client().post("/admin/plg-rules", json={"rule_name": "n", "rule_type": "toast"})
    assert r.json() == {"id": "new-1"}
    assert "new-1" in log[1][3].values()


def test_create_requires_name_and_type(dbfake):
    r = client().post("/admin/plg-rules", json={"rule_name": "", "rule_type": "toast"})
    assert r.status_code == 422


def test_save_error_message_reaches_the_page(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: DbErr("new row violates row-level security policy")
    r = client().put("/admin/plg-rules/r1", json={"rule_name": "n", "rule_type": "x"})
    assert r.status_code == 400 and "row-level security" in r.json()["detail"]


def test_duplicate_copies_inactive_with_suffix(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": "copy-1"}]
    assert client().post("/admin/plg-rules/r1/duplicate").json() == {"id": "copy-1"}
    sql, params = log[0][2], log[0][3]
    assert sql.startswith("INSERT INTO public.plg_rules") and "SELECT" in sql
    assert " (Copy)" in params.values() and False in params.values()


def test_duplicate_of_an_invisible_rule_is_404(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: []
    assert client().post("/admin/plg-rules/r1/duplicate").status_code == 404
