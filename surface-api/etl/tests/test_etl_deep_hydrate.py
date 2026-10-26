"""Route tests for /public/etl-deep-hydrate (DB and fetch monkeypatched)."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from etl.tests.test_deep_hydrate import FakeConn
from surfaces.etl.routers import etl_deep_hydrate as r

JOB = {"job_key": "statefarm_deep_hydrate", "gcid": "gcid:insurance_agency", "status": "idle",
       "lease_until": None, "updated_at": "2026-10-01T00:00:00Z", "batch_size": 2,
       "processed": 1, "promoted": 1, "shallow": 0, "failed": 0}


@pytest.fixture
def env(monkeypatch):
    state = {"job": dict(JOB), "claim": [{"job_key": JOB["job_key"]}], "pending": []}

    def respond(q: str, p: list):
        if q.startswith("select * from exp_etl_hydrate_jobs"):
            return [state["job"]] if state["job"] else []
        if "returning job_key" in q:
            return state["claim"]
        if "from exp_etl_field_floors" in q:
            return []
        if "order by observed_at" in q:
            return state["pending"]
        if "count(*)" in q:
            return [{"n": 0}]
        return None

    conn = FakeConn(respond)

    @contextmanager
    def fake_role(role, claims=None, *, write=False, fresh=False):
        assert role == "service_role"
        yield conn

    monkeypatch.setattr(r, "role_connection", fake_role)
    app = FastAPI()
    app.include_router(r.router)
    return TestClient(app), conn, state


def test_get_progress_and_unknown(env):
    client, _conn, state = env
    res = client.get("/public/etl-deep-hydrate")
    assert res.status_code == 200
    assert res.json()["progress"] == {"gcid": "gcid:insurance_agency", "total": 0, "deep": 0,
                                      "shallow": 0, "remaining": 0}
    state["job"] = None
    res = client.get("/public/etl-deep-hydrate?job_key=nope")
    assert res.status_code == 404 and res.text == "Unknown job"


def test_pause_and_guards(env):
    client, conn, state = env
    res = client.post("/public/etl-deep-hydrate", json={"action": "pause"})
    assert res.json() == {"job_key": JOB["job_key"], "status": "paused"}
    assert conn.log[-1][0].startswith("update exp_etl_hydrate_jobs set status = %s")
    state["job"]["status"] = "done"
    assert client.post("/public/etl-deep-hydrate").json() == {"skipped": "job done"}
    state["job"]["status"] = "running"
    state["job"]["lease_until"] = datetime.now(UTC) + timedelta(minutes=3)
    assert client.post("/public/etl-deep-hydrate").json()["skipped"] == (
        "another tick holds the lease")
    state["job"]["lease_until"] = None
    state["claim"] = []
    assert client.post("/public/etl-deep-hydrate").json() == {"skipped": "lease race lost"}


def test_tick_blocked_pauses(env, monkeypatch):
    client, conn, state = env
    state["pending"] = [{"stage_id": "a", "detail_url": "https://x/a", "payload": {}},
                        {"stage_id": "b", "detail_url": "https://x/b", "payload": {}}]

    def blocked(url, timeout_ms=20000):
        raise RuntimeError("fetch 403")

    monkeypatch.setattr(r.mod, "fetch_agent_html", blocked)
    res = client.post("/public/etl-deep-hydrate", json={"batch_size": 9999})
    body = res.json()
    assert res.status_code == 200 and body["paused"] == "source_blocked"
    assert body["summary"]["failed"] == 2
    upd = conn.log[-1]
    assert upd[0].startswith("update exp_etl_hydrate_jobs set status = %s, lease_until = %s, "
                             "failed = %s, last_error = %s")
    assert upd[1][0] == "paused" and upd[1][2] == 2
    claim = next(p for q, p in conn.log if "returning job_key" in q)
    assert claim[2] == JOB["job_key"] and claim[3] == JOB["updated_at"]
    limit_params = next(p for q, p in conn.log if "order by observed_at" in q)
    assert limit_params[1] == r.MAX_BATCH


def test_tick_ok_marks_done(env, monkeypatch):
    client, conn, state = env
    state["pending"] = [{"stage_id": "a", "detail_url": "https://x/a", "payload": {}}]
    monkeypatch.setattr(r.mod, "fetch_agent_html", lambda url, timeout_ms=20000: "<html/>")
    monkeypatch.setattr(r.mod, "hydrate_staging_row", lambda *a, **k: {
        "stage_id": "a", "detail_url": "https://x/a", "ok": True, "field_count": 9})
    body = client.post("/public/etl-deep-hydrate", json={}).json()
    assert body["batch"] == 2 and body["summary"]["parsed"] == 1
    q, p = conn.log[-1]
    assert q.startswith("update exp_etl_hydrate_jobs set status = %s")
    assert p[0] == "done" and p[2] == 2  # processed 1 + 1
