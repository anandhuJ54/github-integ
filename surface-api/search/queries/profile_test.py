"""SRP public endpoints (profiles, monetization) and fetch_many (no live DB)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.db import session as core_db
from _base.server_fn import optional_user
from search.router import router

USER = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}


class FakeConn:
    """Answers by SQL substring; supports the pipeline + savepoint calls fetch_many makes."""

    def __init__(self, log, answer):
        self.log, self.answer = log, answer
        self.params: list = []

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def execute(self, sql, params=None):
        self.log.append(sql)
        self.params.append(params or {})
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return _Cur(rows)

    def cursor(self):
        conn = self

        class Cur(_Cur):
            def __init__(self):
                super().__init__([])

            def execute(self, sql, params=None):
                r = conn.execute(sql, params)
                self.rows, self.description = r.rows, r.description

        return Cur()


class _Cur:
    def __init__(self, rows):
        self.rows = rows or []
        self.description = [("x",)]

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state: dict = {"answer": lambda sql, params: [], "roles": []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        state["roles"].append((role, claims, write))
        yield FakeConn(log, lambda s, p: state["answer"](s, p))

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client(user=None) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[optional_user] = lambda: user
    return TestClient(app)


PRO = {"id": "p1", "slug": "s", "gcid": "gcid:x", "primary_org_id": "o1"}


def pro_answer(sql, params):
    if "FROM public.professionals" in sql and "professionals.slug =" in sql:
        return [PRO]
    if "FROM public.organizations" in sql and "(SELECT" in sql:
        return [{"id": "c1", "name": "Company"}]  # the company (subquery on the office)
    if "FROM public.organizations" in sql and "organizations.id =" in sql:
        return [{"id": "o1", "name": "Office", "parent_org_id": "c1"}]
    if "FROM public.gbp_categories" in sql:
        return [{"display_name": "X", "slug": "x"}]
    if "FROM public.graph_nodes" in sql:
        return [{"node_type": "service", "title": "T", "url": None, "extracted_data": {}}]
    return []


def test_profile_runs_as_anon_when_signed_out_and_as_the_user_when_signed_in(dbfake):
    _, state = dbfake
    state["answer"] = pro_answer
    assert client().get("/search/profile/p/s").status_code == 200
    assert client(USER).get("/search/profile/p/s").status_code == 200
    assert [r[:2] for r in state["roles"]] == [("anon", None), ("authenticated", USER)]


def test_professional_profile_in_two_round_trips(dbfake):
    log, state = dbfake
    state["answer"] = pro_answer
    body = client().get("/search/profile/p/s").json()
    assert body["pro"] == PRO and body["office"]["name"] == "Office"
    assert body["company"]["name"] == "Company" and body["category"]["display_name"] == "X"
    assert len(body["graphNodes"]) == 1 and body["expertise"]["edges"] == []
    # two pipelines: the professional, then everything else (each wrapped in one savepoint)
    assert sum("savepoint fetch_many" in s and "release" not in s for s in log) == 2
    graph_sql = next(s for s in log if "FROM public.graph_nodes" in s and "ring_layer" not in s)
    assert "node_type IN (" in graph_sql and "is_active IS true" in graph_sql


def test_unknown_or_ambiguous_slug_is_404(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: []
    assert client().get("/search/profile/p/nope").status_code == 404
    state["answer"] = lambda s, p: [PRO, PRO] if "professionals.slug" in s else []
    assert client().get("/search/profile/p/twice").status_code == 404  # .maybeSingle() on 2 rows


def test_failed_side_read_is_empty_not_an_error(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "FROM public.reviews" in sql:
            return psycopg.errors.InsufficientPrivilege("permission denied for table reviews")
        return pro_answer(sql, params)

    state["answer"] = answer
    body = client().get("/search/profile/p/s").json()
    assert body["reviews"] == [] and body["office"]["name"] == "Office"


def test_org_template_lane_follows_kind_and_entity_type(dbfake):
    _, state = dbfake
    lanes: list = []

    def answer(sql, params):
        if "exp_category_page_template" in sql:
            lanes.append(next(v for k, v in params.items() if k.startswith("entity_type")))
        return [org] if "organizations.slug =" in sql else []

    state["answer"] = answer
    for entity_type, kind in (("office", "o"), ("company", "o"), ("office", "c")):
        org = {"id": "g1", "slug": "b", "gcid": None, "entity_type": entity_type,
               "parent_org_id": None}
        assert client().get(f"/search/profile/{kind}/b").json()["org"] == org
    assert lanes == ["location", "brand", "brand"]  # orgLane(); /c is always the brand lane


def test_rpcs_are_tolerant_and_page_view_never_fails(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"slot_id": "s1"}] if "public_sponsored_slots" in s else []
    assert client().get("/search/sponsored-slots", params={"gcid": "g", "geo": "94301"}).json() == [
        {"slot_id": "s1"}]
    state["answer"] = lambda s, p: psycopg.errors.UndefinedFunction("no such function")
    assert client().get("/search/ad-units", params={"context": "serp"}).json() == []
    r = client().post("/search/page-view", json={"gcid": "g", "zip": "94301", "claimCta": True})
    assert r.status_code == 200
    assert state["roles"][-1] == ("anon", None, True)  # the ping is a write


# --- fetch_many ------------------------------------------------------------------------------

def test_fetch_many_one_pipeline_and_tolerant_fallback():
    from sqlalchemy import column, select, table

    from _base.db.sql import fetch_many

    t = table("t", column("a"))
    log: list = []
    conn = FakeConn(log, lambda s, p: [{"a": 1}])
    out = fetch_many(conn, {"x": select(t.c.a), "y": select(t.c.a)})
    assert out == {"x": [{"a": 1}], "y": [{"a": 1}]}
    assert log[0] == "savepoint fetch_many" and log[-1] == "release savepoint fetch_many"
    assert all("LIMIT" in s for s in log[1:-1])  # capped at MAX_ROWS

    calls = {"n": 0}

    def flaky(sql, params):
        calls["n"] += 1
        return psycopg.errors.DivisionByZero("x") if "WHERE" in sql else [{"a": 2}]

    conn = FakeConn([], flaky)
    out = fetch_many(conn, {"ok": select(t.c.a), "bad": select(t.c.a).where(t.c.a == 1)},
                     tolerant=True)
    assert out == {"ok": [{"a": 2}], "bad": []}
    with pytest.raises(psycopg.Error):
        fetch_many(FakeConn([], flaky), {"bad": select(t.c.a).where(t.c.a == 1)})
