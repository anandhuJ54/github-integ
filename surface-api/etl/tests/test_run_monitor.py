"""GET /etl/run-monitor: SQL shape, figures and the TS-parity edge cases (no live DB/auth)."""
from __future__ import annotations

from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from surfaces.etl.routers.run_monitor import router

from _base.auth import current_user
from _base.db import session as core_db

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}

FLOOR = {"gcid": "gcid:insurance_agent", "min_fields": 8, "required_keys": ["person.name"],
         "min_products": 0, "min_licenses": 0, "notes": None,
         "created_at": "2026-10-12T06:36:42+00:00", "updated_at": "2026-10-12T06:36:50+00:00"}


def answer(sql: str, params: dict):
    if "FROM public.exp_etl_field_floors" in sql:
        return [FLOOR]
    if "count(*) FILTER" in sql and "exp_etl_staging" in sql:
        return [{"total": 10, "processed": 4, "remaining": 6, "flagged": 1}]
    if "FROM public.professionals" in sql:
        return [{"profiles": 5, "withBio": 5, "withPhoto": 4, "withPlaceId": 2}]
    if "FROM public.graph_nodes" in sql:
        return [{"product_service": 7, "social_profile": 3, "credential": 1}]
    if "field_count" in sql:
        return [{"field_count": v} for v in ("20", "23", None, "", "abc", "0", "-2")]
    if "resolution_status, " in sql:
        return [
            {"stage_id": "s1", "detail_url": "u", "resolution_status": "shallow",
             "payload": {"gate_reasons": ["a", 2]}, "resolved_at": None},
            {"stage_id": "s2", "detail_url": None, "resolution_status": "needs_review",
             "payload": {"gate_reasons": "one"}, "resolved_at": "2026-08-31T18:25:00+00:00"},
            {"stage_id": "s3", "detail_url": None, "resolution_status": "shallow",
             "payload": {}, "resolved_at": None},
        ]
    raise AssertionError(f"unexpected query: {sql}")


class FakeConn:
    def __init__(self, log):
        self.log = log

    def cursor(self):
        log = self.log

        class Cur:
            def execute(self, sql, params=None):
                log.append((sql, params))
                self._rows = answer(sql, params or {})

            def fetchall(self):
                return self._rows

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return Cur()


@pytest.fixture
def calls(monkeypatch):
    log: list = []
    roles: list = []

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        roles.append((role, claims, write))
        yield FakeConn(log)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, roles


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def test_requires_a_signed_in_user():
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get("/etl/run-monitor").status_code == 403


def test_reads_as_the_user_and_builds_the_monitor(calls):
    log, roles = calls
    r = client().get("/etl/run-monitor")
    assert r.status_code == 200
    assert roles == [("authenticated", CLAIMS, False)]
    assert r.json() == {
        "progress": {"total": 10, "processed": 4, "remaining": 6, "pctComplete": 0.4},
        "yield": {"profiles": 5, "withBio": 5, "withPhoto": 4, "withPlaceId": 2,
                  "nodes": {"product_service": 7, "social_profile": 3, "credential": 1}},
        "gate": {
            "floors": [FLOOR],
            "flagged": 1,
            "shallowRate": 0.25,
            "recent": [
                {"stage_id": "s1", "detail_url": "u", "resolution_status": "shallow",
                 "reasons": ["a", "2"], "resolved_at": None},
                {"stage_id": "s2", "detail_url": None, "resolution_status": "needs_review",
                 "reasons": ["one"], "resolved_at": "2026-08-31T18:25:00+00:00"},
                {"stage_id": "s3", "detail_url": None, "resolution_status": "shallow",
                 "reasons": [], "resolved_at": None},
            ],
        },
        # Number() filter keeps only finite positives: 20, 23 → 21.5
        "depth": {"baseline": 3, "avgFieldsNow": 21.5, "deepRows": 2},
    }
    sqls = [s for s, _ in log]
    staging = next(s for s in sqls if "count(*) FILTER" in s and "exp_etl_staging" in s)
    assert "field_tier IN (%(field_tier_1_1)s::VARCHAR, %(field_tier_1_2)s::VARCHAR)" in staging
    recent = next(s for s in sqls if "resolution_status, " in s)
    assert "ORDER BY public.exp_etl_staging.resolved_at DESC NULLS LAST" in recent
    assert "LIMIT %(param_1)s" in recent
    pro = next(s for s in sqls if "FROM public.professionals" in s)
    assert "ILIKE" in pro


def test_zero_totals_do_not_divide(calls, monkeypatch):
    from surfaces.etl.queries import run_monitor as q

    monkeypatch.setattr(q, "staging_counts",
                        lambda c: {"total": 0, "processed": 0, "remaining": 0, "flagged": 0})
    monkeypatch.setattr(q, "deep_field_counts", lambda c: [])
    body = client().get("/etl/run-monitor").json()
    assert body["progress"]["pctComplete"] == 0
    assert body["gate"]["shallowRate"] == 0
    assert body["depth"]["avgFieldsNow"] is None
