"""POST /public/disco-ai-worker with the DB and network faked (records SQL + params)."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from surfaces.etl.disco import ai_worker as w
from surfaces.etl.disco import ai_worker_classify as cl
from surfaces.etl.disco import ai_worker_discover as dc
from surfaces.etl.disco import ai_worker_util as u
from surfaces.etl.disco import ai_worker_v2 as v2m
from surfaces.etl.disco_ai_worker.router import router


class FakeCursor:
    def __init__(self, db: FakeDB, write: bool):
        self.db, self.write, self._rows = db, write, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, params: Any = None) -> None:
        self.db.log.append((" ".join(sql.split()), params))
        for needle, result in self.db.responses:
            if needle in sql:
                result = result(sql, params) if callable(result) else result
                if isinstance(result, BaseException):
                    raise result
                self._rows = list(result)
                return
        self._rows = []

    def fetchall(self) -> list[dict]:
        return self._rows


class FakeDB:
    def __init__(self):
        self.log: list[tuple[str, Any]] = []
        self.responses: list[tuple[str, Any]] = []

    def on(self, needle: str, result: Any) -> None:
        self.responses.append((needle, result))

    def sql(self, needle: str) -> list[tuple[str, Any]]:
        return [x for x in self.log if needle in x[0]]


class FakeConn:
    def __init__(self, db: FakeDB, write: bool):
        self.db, self.write_ = db, write

    def cursor(self):
        return FakeCursor(self.db, self.write_)

    def transaction(self):
        @contextmanager
        def t():
            yield

        return t()


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()

    @contextmanager
    def role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "service_role"
        yield FakeConn(fake, write)

    monkeypatch.setattr(u, "role_connection", role_connection)
    monkeypatch.setattr(w, "role_connection", role_connection)
    monkeypatch.setenv("DISCO_WORKER_KEY", "wk")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "ak")
    monkeypatch.delenv("DISCO_MODEL", raising=False)
    return fake


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


H = {"x-disco-worker-key": "wk"}


def test_auth(client, db, monkeypatch):
    r = client.post("/public/disco-ai-worker", headers={"x-disco-worker-key": "no"})
    assert r.status_code == 401 and r.text == "Unauthorized"
    monkeypatch.delenv("DISCO_WORKER_KEY")
    assert client.post("/public/disco-ai-worker", headers=H).status_code == 401
    monkeypatch.setenv("DISCO_WORKER_KEY", "wk")
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    r = client.post("/public/disco-ai-worker", headers=H)
    assert r.status_code == 500 and r.json() == {"error": "ANTHROPIC_API_KEY not configured"}


def test_dry_run_validation(client, db):
    r = client.post("/public/disco-ai-worker", headers=H, json={"dry_run": True})
    assert r.status_code == 400
    assert r.json() == {"dry_run": True, "ok": False, "error": "domain and category required"}
    r = client.post("/public/disco-ai-worker", headers=H,
                    json={"dry_run": True, "phase": "detail", "domain": "ex.com"})
    assert r.status_code == 400 and r.json()["error"] == "domain, category and profile_urls required"


def test_dry_run_map(client, db, monkeypatch):
    seen = {}

    def fake(api_key, model, category, domain, boundary, cm, opts):
        seen.update(category=category, domain=domain, cm=cm, opts=opts, model=model)
        return {"detail_pattern": "^x$", "field_floor": 7}

    monkeypatch.setattr(v2m, "map_site_with_limit", fake)
    r = client.post("/public/disco-ai-worker", headers=H, json={
        "dry_run": True, "domain": " Ex.COM ", "category": "gcid:x", "crawl_method": "needs_js_api",
        "profile_urls": ["https://ex.com/a", 3], "v2_pattern": "^p$", "force_search": True})
    body = r.json()
    assert r.status_code == 200 and body["ok"] is True and body["domain"] == "ex.com"
    assert body["contract"] == {"detail_pattern": "^x$", "field_floor": 7}
    assert seen["cm"] == "needs_js_api" and seen["model"] == "claude-sonnet-4-6"
    assert seen["opts"] == {"forceNetwork": False, "forceSearch": True,
                            "profileUrls": ["https://ex.com/a"], "v2Led": {"pattern": "^p$"}}
    assert db.log == []  # dry runs write (and read) nothing here

    def boom(*a):
        raise u.MapSiteError("no fetchable entity detail page", {"tried": []})

    monkeypatch.setattr(v2m, "map_site_with_limit", boom)
    body = client.post("/public/disco-ai-worker", headers=H,
                       json={"dry_run": True, "domain": "ex.com", "category": "c"}).json()
    assert body["ok"] is False
    assert body["error"] == "MapSiteError: no fetchable entity detail page"
    assert body["diagnostics"] == {"tried": []}


def test_dry_run_routes_phase(client, db, monkeypatch):
    monkeypatch.setattr(w.rt, "run_deferred_routes",
                        lambda st, force_network, force_search: {"best_route": {"route": "x"}})
    body = client.post("/public/disco-ai-worker", headers=H, json={
        "dry_run": True, "phase": "routes", "state": {"domain": "ex.com"}}).json()
    assert body["phase"] == "routes" and body["ok"] is True
    assert body["best_route"] == {"route": "x"}


def test_drain_discover(client, db, monkeypatch):
    db.on("from disco_llm_requests", [
        {"request_id": 7, "job_id": 3, "tool": "discover_companies",
         "prompt_input": {"category": "gcid:x", "boundary": {"definition": "d"}},
         "response": None}])
    db.on("from gbp_categories", [{"display_name": "X", "entity_type": "both"}])
    monkeypatch.setattr(dc, "discover_sources", lambda k, m, ctx: [
        {"name": "A\u0000", "domain": "a.com"}])
    body = client.post("/public/disco-ai-worker", headers=H).json()
    assert body == {"model": "claude-sonnet-4-6", "pending_picked": 1,
                    "processed": [{"request_id": 7, "discovered": 1}]}
    upd = db.sql("update disco_llm_requests set status")
    assert upd[0][1] == ("sent", 7)
    rpc = db.sql("disco_discover_ingest")
    assert rpc and rpc[0][1][0] == 7 and rpc[0][1][1].obj == [{"name": "A", "domain": "a.com"}]


def test_drain_classify_error_marks_row(client, db, monkeypatch):
    db.on("from disco_llm_requests", [
        {"request_id": 8, "job_id": None, "tool": "classify_method",
         "prompt_input": {"domain": "ex.com"}, "response": None},
        {"request_id": 9, "job_id": None, "tool": "classify_method", "prompt_input": {},
         "response": None}])
    monkeypatch.setattr(cl, "classify_method", lambda *a: {
        "method": "server_crawl", "evidence": "ok", "fetch_tier": "direct"})
    db.on("disco_method_ingest", RuntimeError("bad method\nDETAIL: x"))
    body = client.post("/public/disco-ai-worker", headers=H).json()
    assert body["processed"] == [
        {"request_id": 8, "error": "Error: bad method"},
        {"request_id": 9, "error": "Error: prompt_input.domain missing"}]
    err = [x for x in db.sql("update disco_llm_requests set status = %s, response")]
    assert err[0][1][0] == "error" and err[0][1][1].obj == {"error": "Error: bad method"}


def test_drain_map_site_v2_step_then_stops(client, db, monkeypatch):
    db.on("from disco_llm_requests", [
        {"request_id": 11, "job_id": 1, "tool": "map_site",
         "prompt_input": {"domain": "ex.com", "category": "c"}, "response": None},
        {"request_id": 12, "job_id": 1, "tool": "map_site",
         "prompt_input": {"domain": "ex2.com", "category": "c"}, "response": None}])

    class Mapper:
        @staticmethod
        def run_v2_step(api_key, opts=None, **kw):
            assert opts["domain"] == "ex.com" and "state" not in opts or opts["state"] is None
            return {"status": "continue", "state": {"v": 1}, "calls": 1, "turns": 2,
                    "active_seconds": 3, "cost_usd": 0.1, "log": ["a"]}

    monkeypatch.setattr(u, "mapper", lambda: Mapper)
    body = client.post("/public/disco-ai-worker", headers=H).json()
    assert body["processed"] == [{"request_id": 11, "domain": "ex.com", "map_step": "v2",
                                  "v2_calls": 1}]
    saved = db.sql("update disco_llm_requests set status = %s, response")[0][1]
    assert saved[0] == "pending" and saved[1].obj["map_step"] == "v2"
    assert saved[1].obj["v2_state"] == {"v": 1}


def test_drain_map_site_v1_saves_first_contract(client, db, monkeypatch):
    prev = {"map_step": "v1", "v2": None, "detail": None}
    db.on("from disco_llm_requests", [
        {"request_id": 21, "job_id": 1, "tool": "map_site",
         "prompt_input": {"domain": "ex.com", "category": "c"}, "response": prev}])
    contract = {"detail_pattern": "^x$", "field_floor": 6, "extraction": {
        "site_contract": {"must_have": {"ok": True}, "extra_fields": {}}}}
    seen = {}

    def fake_map(*a, **k):
        seen.update(k)
        return {"contract": contract, "v2": None}

    monkeypatch.setattr(v2m, "map_with_v2", fake_map)
    monkeypatch.setattr(w.extra_keys, "refresh_extra_keys", lambda *a: seen.setdefault("ek", a))
    body = client.post("/public/disco-ai-worker", headers=H).json()
    assert seen["v2"] is None and seen["v1_limit_ms"] == 255_000
    assert body["processed"] == [{"request_id": 21, "domain": "ex.com",
                                  "crawl_method": "server_crawl",
                                  "rendered_fetch_possible": False, "detail_pattern": "^x$",
                                  "field_floor": 6}]
    ingest = db.sql("disco_map_site_ingest")[0][1]
    assert ingest[0] == 21 and ingest[1].obj["save_check"]["reason"] == "no saved contract"
    assert not db.sql("insert into disco_proposals")


def test_drain_map_site_failure_keeps_carry(client, db, monkeypatch):
    prev = {"map_step": "v1", "v2": {"outcome": "config"}, "detail": {"probe": {}}}
    db.on("from disco_llm_requests", [
        {"request_id": 31, "job_id": 1, "tool": "map_site",
         "prompt_input": {"domain": "ex.com", "category": "c"}, "response": prev}])

    def fail(*a, **k):
        raise u.MapSiteError("must-have fields not found: phone", {"detail_url": "u"})

    monkeypatch.setattr(v2m, "map_with_v2", fail)
    client.post("/public/disco-ai-worker", headers=H)
    resp = db.sql("update disco_llm_requests set status = %s, response")[0][1][1].obj
    assert resp == {"error": "MapSiteError: must-have fields not found: phone", "detail_url": "u",
                    "map_step": "failed_v1", "v2": {"outcome": "config"},
                    "detail": {"probe": {}}}
