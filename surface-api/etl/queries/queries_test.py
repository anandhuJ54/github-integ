"""ETL /discovery console endpoints (no live DB/auth). Gated functions are only checked for the
SQL they would send — nothing here runs them."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from etl.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
SID = "11111111-1111-4111-8111-111111111111"


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
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)

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


def sqls(log, needle):
    return [x for x in log if needle in x[1]]


@pytest.mark.parametrize("method,path", [
    ("get", "/etl/console/runs"), ("post", "/etl/console/rpc/disco_activate"),
    ("post", "/etl/console/hierarchy/table"), ("get", "/etl/console/schedules"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path, **({"json": {}} if method == "post" else {})) \
        .status_code == 403


# --- the RPC allow-list ----------------------------------------------------------------------

def test_rpc_casts_each_argument_and_omits_the_rest(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"v": None}]
    client().post("/etl/console/rpc/exp_etl_set_limits",
                  json={"args": {"p_source": SID, "p_window": "02:00-05:00"}})
    (write, sql, params), = log
    assert write
    assert "exp_etl_set_limits(p_source => %(p_source)s::uuid, p_window => %(p_window)s::text)" \
        in sql  # p_daily_quota / p_min_delay keep the function's defaults
    assert params == {"p_source": SID, "p_window": "02:00-05:00"}


def test_rpc_uuid_array_is_cast(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"v": 2}]
    r = client().post("/etl/console/rpc/exp_etl_approve_companies",
                      json={"args": {"p_gcid": "gcid:x", "p_source_ids": [SID]}})
    assert r.json() == 2 and "%(p_source_ids)s::uuid[]" in log[0][1]


@pytest.mark.parametrize("name,args", [
    ("exp_etl_drop_everything", {}),                       # not allow-listed
    ("exp_etl_set_limits", {"p_source": SID, "p_x": 1}),   # unknown parameter
])
def test_rpc_outside_the_allow_list_is_refused(dbfake, name, args):
    log, _ = dbfake
    assert client().post(f"/etl/console/rpc/{name}", json={"args": args}).status_code == 400
    assert log == []


def test_insufficient_privilege_is_403(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("insufficient_privilege")
    assert client().get("/etl/console/schedules").status_code == 403
    r = client().post("/etl/console/rpc/disco_activate", json={"args": {"p_category": "gcid:x"}})
    assert r.status_code == 403


def test_run_source_returns_the_seeding_detail(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "exp_etl_run_source" in sql:
            return [{"v": "run-1"}]
        return [{"detail": {"seeded_sitemaps": 2}}]

    state["answer"] = answer
    assert client().post("/etl/console/sources/run", json={"source_id": SID}).json() == {
        "runId": "run-1", "seeded": {"seeded_sitemaps": 2}}


# --- hierarchy embeds ------------------------------------------------------------------------

def test_hierarchy_filters_become_exists_and_json_embeds(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"n": 0}] if "count(*)" in s else []
    client().post("/etl/console/hierarchy/table", json={
        "filters": {"gcid": "gcid:x", "brand": SID, "office": SID, "q": "a%b(c)"},
        "page": 2, "sort": "name", "dir": "asc"})
    rows_sql, rows_params = log[1][1], log[1][2]
    assert rows_sql.count("EXISTS") == 3 and rows_sql.count("json_agg") == 3
    assert " OR (EXISTS" in rows_sql.replace("\n", " ")  # brand: entity_id = brand OR has a rel
    assert "ORDER BY public.exp_entity.display_name ASC NULLS LAST, public.exp_entity.entity_id" \
        in rows_sql
    assert 50 in rows_params.values() and "%a b c %" in rows_params.values()


def test_tree_unofficed_advisors_have_no_works_at(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"n": 0}] if "count(*)" in s else []
    client().get("/etl/console/hierarchy/tree/advisors", params={"unofficed_brand": SID})
    assert "NOT (EXISTS" in log[1][1]
    assert client().get("/etl/console/hierarchy/tree/advisors").status_code == 400


def test_entity_detail_counts_every_incoming_type_but_classified_as(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if "count(*)" in sql:
            return [{"n": 3 if "WORKS_AT" in params.values() else 0}]
        if "FROM public.exp_entity" in sql and "identity_keys" in sql:
            return [{"entity_id": SID}]
        return []

    state["answer"] = answer
    body = client().get(f"/etl/console/hierarchy/entities/{SID}").json()
    assert body["entity"] == {"entity_id": SID}
    assert [(i["type"], i["count"]) for i in body["incoming"]] == [("WORKS_AT", 3)]
    assert not [p for _, _, p in log if "CLASSIFIED_AS" in p.values() and "count" in str(p)]


# --- group 2 ---------------------------------------------------------------------------------

def test_category_search_escapes_and_builds_the_gcid(dbfake):
    log, _ = dbfake
    client().get("/etl/console/population/category-search", params={"q": "Bed & Break_fast 50%"})
    by_id, starts, _ = (x[2] for x in log[1:4])
    assert "gcid:bed_break_fast_50" in by_id.values()
    assert "Bed & Break\\_fast 50\\%%" in starts.values()


def test_staging_page_is_paged_with_a_tiebreak(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"n": 7}] if "count(*)" in s else []
    r = client().post("/etl/console/pipeline/page", json={"gcid": "gcid:x", "page": 2})
    assert r.json() == {"rows": [], "total": 7}
    assert "observed_at DESC NULLS LAST, public.exp_etl_staging.stage_id" in log[1][1]
    assert 100 in log[1][2].values()


def test_funnel_ignores_the_status_filter(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [dict.fromkeys(
        ["pending", "matched", "created", "corroborated", "conflicted", "shallow", "rejected"], 1)]
    client().post("/etl/console/pipeline/funnel", json={"gcid": "g", "status": "created"})
    sql, params = log[1][1], log[1][2]
    assert sql.count("FILTER") == 7 and "g" in params.values()
    outer_where = sql.split("FROM public.exp_etl_staging", 1)[1]
    assert "resolution_status" not in outer_where and "gcid" in outer_where


def test_source_states_count_queues_only_for_open_runs(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "FROM public.exp_etl_runs" in sql:
            return [{"run_id": "r1", "source_id": SID, "started_at": None}]
        if "count(*)" in sql:
            return [{"n": 4}]
        return []

    state["answer"] = answer
    body = client().post("/etl/console/source-states", json={"sources": [
        {"source_id": SID, "source_domain": "a.com"},
        {"source_id": "22222222-2222-4222-8222-222222222222", "source_domain": "b.com"}]}).json()
    assert body["queuedByDomain"] == {"a.com": 4}


# --- source stats: one jsonb value, sent as the array itself ----------------------------------

def test_source_stats_returns_the_jsonb_array_not_a_wrapped_row(dbfake):
    log, state = dbfake
    stats = [{"source": "bhhs.com", "queued": 38612}]
    state["answer"] = lambda s, p: [{"exp_etl_source_stats": stats}]
    r = client().get("/etl/console/source-stats?gcid=gcid%3Areal_estate_agency")
    assert r.json() == stats
    (_, sql, params), = sqls(log, "exp_etl_source_stats")
    assert sql.startswith("select public.exp_etl_source_stats(") and params["g"] == "gcid:real_estate_agency"


def test_source_stats_null_is_an_empty_list(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"exp_etl_source_stats": None}]
    assert client().get("/etl/console/source-stats?gcid=gcid%3Ax").json() == []
