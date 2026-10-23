"""Search control plane endpoints (no live DB/auth). The gated indexing RPCs are only checked for
the SQL they would send — nothing here runs them."""
from __future__ import annotations

from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from search.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}


class Cur:
    def __init__(self, rows):
        self.rows = rows or []
        self.description = [("x",)]

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def execute(self, sql, params=None):
        self.log.append((self.write, sql, params or {}))
        return Cur([] if "savepoint" in sql else self.answer(sql, params or {}))

    def cursor(self):
        conn = self

        class C(Cur):
            def __init__(self):
                super().__init__([])

            def execute(self, sql, params=None):
                self.rows = conn.execute(sql, params).rows

        return C()


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
    ("get", "/search/console/indexing"), ("post", "/search/console/index/sync"),
    ("put", "/search/console/index-config/indexnow_key"), ("delete", "/search/console/ads/a1"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {"value": "x"}} if method == "put" else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


def test_indexing_reads_in_one_trip_plus_coverage(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if "count(*)" in sql:
            return [{"held": 3, "pending": 2, "submitting": 0, "submitted": 0, "indexed": 1}]
        return [{"id": "x"}]

    state["answer"] = answer
    body = client().get("/search/console/indexing").json()
    assert body["coverage"] == [{"state": "held", "count": 3}, {"state": "pending", "count": 2},
                                {"state": "submitting", "count": 0},
                                {"state": "submitted", "count": 0}, {"state": "indexed", "count": 1}]
    queue = next(s for _, s, _ in log if "FROM public.exp_index_queue" in s and "count" not in s)
    assert "thoroughness_pct DESC" in queue


def test_site_indexing_switch_cannot_be_set_here(dbfake):
    log, _ = dbfake
    r = client().put("/search/console/index-config/site_indexing_enabled", json={"value": "true"})
    assert r.status_code == 400 and "super admin" in r.json()["detail"]
    assert not [s for _, s, _ in log if "exp_index_config" in s]  # nothing was sent


def test_other_index_config_is_an_upsert(dbfake):
    log, _ = dbfake
    assert client().put("/search/console/index-config/indexnow_key",
                        json={"value": "k"}).json() == {"ok": True}
    (write, sql, params), = [x for x in log if "exp_index_config" in x[1]]
    assert write and "ON CONFLICT (key) DO UPDATE" in sql and "k" in params.values()


@pytest.mark.parametrize("path,fn,body", [
    ("/search/console/sitemap/rebuild", "exp_sitemap_rebuild()", None),
    ("/search/console/index/submit-tick", "exp_index_submit_tick(p_batch =>", {"batch": 25}),
    ("/search/console/index/sync", "exp_index_sync()", None),
])
def test_indexing_buttons_call_the_governed_functions_as_writes(dbfake, path, fn, body):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"r": {"ok": 1}}]
    assert client().post(path, json=body).json() == {"ok": 1}
    (write, sql, _), = log
    assert write and fn in sql


def test_submit_tick_batch_is_bounded(dbfake):
    assert client().post("/search/console/index/submit-tick",
                         json={"batch": 100000}).status_code == 422


def test_pricing_and_ad_patches_are_allow_listed(dbfake):
    assert client().patch("/search/console/sponsored-pricing/p1",
                          json={"monthly_price": 99}).json() == {"ok": True}
    assert client().patch("/search/console/sponsored-pricing/p1",
                          json={"is_demo": False}).status_code == 400
    assert client().patch("/search/console/ads/a1", json={"id": "a1", "status": "live"}).json() \
        == {"ok": True}
    assert client().patch("/search/console/ads/a1", json={"nope": 1}).status_code == 400


def test_assign_with_lock_sets_the_locked_rate(dbfake):
    log, _ = dbfake
    client().post("/search/console/sponsored-slots/s1/assign", json={
        "advertiser_name": "Acme", "price": 500, "status": "sold", "lock": True, "per_1k": 4})
    (_, sql, params), = log
    assert "locked_at=now()" in sql.replace(" ", "")
    assert params["locked_price"] == 500 and params["locked_per_1k"] == 4
    log.clear()
    client().post("/search/console/sponsored-slots/s1/assign", json={
        "advertiser_name": "Acme", "price": 500, "status": "sold"})
    assert log[0][2]["locked_price"] is None


def test_release_clears_the_slot_and_create_is_an_open_demo_zip_slot(dbfake):
    log, _ = dbfake
    client().post("/search/console/sponsored-slots/s1/release")
    assert log[0][2]["status"] == "open" and log[0][2]["advertiser_name"] is None
    client().post("/search/console/sponsored-slots", json={"gcid": "g", "geo_value": "94301",
                                                            "position": 2})
    params = log[1][2]
    assert params["geo_type"] == "zip" and params["is_demo"] is True and params["status"] == "open"
