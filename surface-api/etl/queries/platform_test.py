"""ETL /etl/platform counters (no live DB/auth): the exact counts each loader sends, in one
round trip, as the signed-in user."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from etl.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
P = "/etl/platform"


class Cur:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class FakeConn:
    def __init__(self, log, answer):
        self.log, self.answer = log, answer

    @contextmanager
    def pipeline(self):
        self.log.append("<pipeline>")
        yield

    def execute(self, sql, params=None):
        if "savepoint" in sql:
            return Cur([])
        self.log.append(sql)
        rows = self.answer(sql)
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql: [{"count": 7}]}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS and not write
        yield FakeConn(log, lambda s: state["answer"](s))

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def test_report_metrics_fourteen_exact_counts_in_one_round_trip(dbfake):
    log, _ = dbfake
    r = client().get(f"{P}/report-metrics")
    assert r.status_code == 200
    assert r.json() == dict.fromkeys(
        ["categories", "launched", "fieldModels", "graphNodes", "scored", "orgs", "pros",
         "registry", "contracts", "entitlements", "devTeams", "devProjects", "leads", "pages"], 7)
    assert log[0] == "<pipeline>" and log.count("<pipeline>") == 1
    sqls = log[1:]
    assert len(sqls) == 14 and all(s.startswith("SELECT count(*) AS count \nFROM ") for s in sqls)
    assert sqls[0] == "SELECT count(*) AS count \nFROM public.gbp_categories \n LIMIT %(param_1)s::INTEGER"
    assert "WHERE public.gbp_categories.is_launched = true" in sqls[1]
    assert "FROM public.exp_category_schema \nWHERE public.exp_category_schema.is_launched = true" \
        in sqls[2]
    assert "FROM public.graph_nodes \n LIMIT" in sqls[3]  # exact, never an estimate
    assert "WHERE public.organizations.is_demo IS NOT true" in sqls[5]
    assert "WHERE public.professionals.is_demo IS NOT true" in sqls[6]
    assert "WHERE public.exp_contracts.is_demo IS NOT true" in sqls[8]
    assert "WHERE public.exp_entitlements.state = %(state_1)s::VARCHAR" in sqls[9]
    assert "FROM public.exp_web_pages" in sqls[13]


def test_pipeline_health_jobs_and_counts(dbfake):
    log, state = dbfake
    job = {"job_id": 3, "category_slug": "plumber", "step": "run", "status": "awaiting_human",
           "note": None, "created_at": None, "updated_at": None}
    state["answer"] = lambda s: [job] if "disco_jobs" in s else [{"count": 2}]
    r = client().get(f"{P}/pipeline-health")
    assert r.json() == {"jobs": [job], "counts": dict.fromkeys(
        ["proposals", "llm", "siteContracts", "engineRequests", "engineSnapshots",
         "enginePrompts"], 2)}
    jobs_sql = log[1]
    assert jobs_sql.startswith(
        "SELECT public.disco_jobs.job_id, public.disco_jobs.category_slug, public.disco_jobs.step, "
        "public.disco_jobs.status, public.disco_jobs.note, public.disco_jobs.created_at, "
        "public.disco_jobs.updated_at \nFROM public.disco_jobs "
        "ORDER BY public.disco_jobs.updated_at DESC \n LIMIT")
    assert "FROM public.exp_engine_requests" in log[5]
    assert "FROM public.exp_engine_prompts" in log[7]


def test_org_stats_filters(dbfake):
    log, _ = dbfake
    assert client().get(f"{P}/org-stats").json() == dict.fromkeys(
        ["total", "real", "demo", "claimed", "scored", "gbp"], 7)
    sqls = log[1:]
    assert "WHERE" not in sqls[0]
    assert sqls[1].endswith("WHERE public.organizations.is_demo IS NOT true \n LIMIT %(param_1)s::INTEGER")
    assert "WHERE public.organizations.is_demo = true" in sqls[2]
    assert "WHERE public.organizations.claimed = true" in sqls[3]
    assert "WHERE public.organizations.search_rank_score IS NOT NULL" in sqls[4]
    assert "WHERE public.organizations.gbp_connected = true" in sqls[5]


def test_a_failed_count_fails_the_loader(dbfake):
    _, state = dbfake
    state["answer"] = lambda s: psycopg.errors.QueryCanceled(
        "canceling statement due to statement timeout") if "graph_nodes" in s else [{"count": 1}]
    r = client().get(f"{P}/report-metrics")
    assert r.status_code == 400 and "statement timeout" in r.json()["detail"]
    state["answer"] = lambda s: psycopg.errors.InsufficientPrivilege(
        "permission denied for table disco_proposals")
    assert client().get(f"{P}/pipeline-health").status_code == 403
