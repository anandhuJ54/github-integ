"""Admin console endpoints that replaced the browser's direct Supabase calls (no live DB/auth)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.admin.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}


class DbErr(psycopg.Error):
    def __init__(self, msg):
        super().__init__(msg)
        self._msg = msg

    @property
    def diag(self):
        return type("D", (), {"message_primary": self._msg})()


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write

    @contextmanager
    def transaction(self):
        yield

    def cursor(self):
        conn = self

        class Cur:
            description = None

            def execute(self, sql, params=None):
                conn.log.append((conn.write, sql, params or {}))
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
        assert role == "authenticated" and claims == CLAIMS
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("get", "/admin/professionals"), ("get", "/admin/professionals/stats"),
    ("get", "/admin/organizations"), ("get", "/admin/compliance/coverage"),
    ("get", "/admin/control-users"), ("delete", "/admin/control-grants/g1"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path).status_code == 403


def test_pro_categories_one_distinct_query_200_max(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"gcid": "gcid:a"}, {"gcid": "gcid:b"}]
    assert client().get("/admin/professionals/categories").json() == ["gcid:a", "gcid:b"]
    (_, sql, params), = log
    assert "SELECT DISTINCT" in sql and "ORDER BY" in sql and 200 in params.values()


def test_pro_page_filters_order_page_and_count(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if "search_rank_scores" in sql:
            return [{"entity_id": "s1", "total_score": 400}]
        if "count(*)" in sql:
            return [{"n": 7}]
        return [{"id": "p1"}]

    state["answer"] = answer
    r = client().get("/admin/professionals", params={
        "search": "smi*th", "gcid": "gcid:x", "location": "tx", "claimed": "unclaimed",
        "score": "300-600", "page": 2})
    assert r.json() == {"rows": [{"id": "p1"}], "count": 7}
    score_sql, count_sql, rows_sql = (x[1] for x in log)
    assert "total_score >=" in score_sql and "total_score <=" in score_sql
    for sql in (count_sql, rows_sql):
        assert sql.count("ILIKE") == 5 and "claimed IS false" in sql and ".id IN (" in sql
    assert "ORDER BY public.professionals.display_name ASC NULLS LAST" in rows_sql
    params = log[2][2]
    assert 50 in params.values() and 100 in params.values()  # page 2 → offset 100, 50 rows
    assert "%smi%th%" in params.values()  # PostgREST treats * as a wildcard too


def test_pro_page_unscored_excludes_scored_ids_and_empty_scope_matches_nothing(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"n": 0}] if "count(*)" in s else []
    client().get("/admin/professionals", params={"score": "600-850"})
    assert "00000000-0000-0000-0000-000000000000" in log[1][2].values()
    log.clear()
    state["answer"] = lambda s, p: ([{"entity_id": "s1", "total_score": 1}]
                                    if "search_rank_scores" in s else [{"n": 0}])
    client().get("/admin/professionals", params={"score": "unscored"})
    assert "NOT IN" in log[1][1]


def test_pro_depth_classifies_node_types(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [
        {"entity_id": "p1", "node_type": "product_service"},
        {"entity_id": "p1", "node_type": "same_as"},
        {"entity_id": "p1", "node_type": "license"},
        {"entity_id": "p1", "node_type": None},
    ]
    assert client().post("/admin/professionals/depth", json={"ids": ["p1"]}).json() == {
        "p1": {"products": 1, "socials": 1, "credentials": 1, "total": 4}}


def test_pro_scores_default_max_850(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"entity_id": "p1", "total_score": 300, "max_possible": None,
                                     "local_rank": None, "local_rank_of": 9, "gaps": None}]
    assert client().post("/admin/professionals/scores", json={"ids": ["p1"]}).json() == {
        "p1": {"total": 300, "max": 850, "rank": None, "rankOf": 9}}


def test_org_page_status_and_scope(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"n": 3}] if "count(*)" in s else []
    r = client().get("/admin/organizations", params={"status": "unclaimed", "scope": "real"})
    assert r.json() == {"rows": [], "count": 3}
    rows_sql = log[1][1]
    assert "claimed IS NOT true" in rows_sql and "is_demo IS NOT true" in rows_sql
    assert "search_rank_score DESC NULLS LAST" in rows_sql


def test_org_categories_unique_sorted(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"gcid": "b"}, {"gcid": "a"}, {"gcid": "b"}]
    assert client().get("/admin/organizations/categories").json() == ["a", "b"]


def test_compliance_ignores_side_read_errors_like_the_page(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "gbp_categories" in sql:
            return [{"gcid": "g", "display_name": "G"}]
        return DbErr("permission denied")

    state["answer"] = answer
    assert client().get("/admin/compliance/coverage").json() == {
        "cats": [{"gcid": "g", "display_name": "G"}], "comp": [], "rules": []}


def test_control_users_forbidden_for_non_super_admin(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: DbErr("forbidden")
    r = client().get("/admin/control-users")
    assert r.status_code == 403 and r.json()["detail"] == "forbidden"


def test_assign_and_revoke_grant_are_writes(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": "g1"}] if s.startswith("INSERT") else None
    uid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    assert client().post("/admin/control-grants",
                         json={"user_id": uid, "role": "analyst"}).json() == {"ok": True}
    assert client().delete("/admin/control-grants/g1").json() == {"ok": True}
    assert [w for w, _, _ in log] == [True, True]
    assert log[0][1].startswith("INSERT INTO public.exp_control_grants")
    assert log[1][1].startswith("DELETE FROM public.exp_control_grants")


def test_assign_rejects_unknown_roles_and_rls_refusal_is_403(dbfake):
    _, state = dbfake
    uid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    assert client().post("/admin/control-grants",
                         json={"user_id": uid, "role": "owner"}).status_code == 422
    state["answer"] = lambda s, p: DbErr("new row violates row-level security policy")
    assert client().post("/admin/control-grants",
                         json={"user_id": uid, "role": "analyst"}).status_code == 403
