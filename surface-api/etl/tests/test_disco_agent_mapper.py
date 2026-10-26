"""Route tests for POST /public/disco-agent-mapper (research monkeypatched)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from surfaces.etl.disco import agent_mapper as am
from surfaces.etl.disco_agent_mapper.router import router


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DISCO_WORKER_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a")
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


H = {"x-disco-worker-key": "k"}


def test_auth_and_input_errors(client):
    r = client.post("/public/disco-agent-mapper", content=b"{}")
    assert r.status_code == 401 and r.text == "Unauthorized"
    r = client.post("/public/disco-agent-mapper", content=b"not json", headers=H)
    assert r.status_code == 400 and r.json() == {"error": "invalid JSON body"}
    r = client.post("/public/disco-agent-mapper", json={"domain": "x.com"}, headers=H)
    assert r.status_code == 400
    assert r.json() == {"error": "version 2 runs as a dry run only (dry_run: true)"}


def test_done_shape(client, monkeypatch):
    def run(self, key):
        self.st["calls"] += 1
        self.st["result"] = {"outcome": "config", "config": {"domain": "x.com"},
                             "report_markdown": "r", "coverage_justification": None,
                             "validation": [{"sample_urls": ["https://x.com/a/1",
                                                             "https://x.com/a/1"]}]}

    monkeypatch.setattr(am.Explorer, "run", run)
    r = client.post("/public/disco-agent-mapper", headers=H,
                    json={"dry_run": True, "domain": "x.com", "category": "gcid:lawyer"})
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "done" and j["outcome"] == "config" and j["version"] == 2
    assert j["profile_urls"] == ["https://x.com/a/1"] and j["calls"] == 1
    assert j["browser"] == {"used": True, "error": None, "actions": 0}
    assert "field_learning" not in j and "flags" not in j


def test_continue_and_failure_shapes(client, monkeypatch):
    monkeypatch.setattr(am.Explorer, "run", lambda self, key: self.st["messages"].append(
        {"role": "user", "content": "hi"}))
    j = client.post("/public/disco-agent-mapper", headers=H,
                    json={"dry_run": True, "domain": "x.com"}).json()
    assert j["status"] == "continue" and j["state"]["v"] == 1 and "log_tail" in j

    def boom(self, key):
        raise RuntimeError("nope")

    monkeypatch.setattr(am.Explorer, "run", boom)
    j = client.post("/public/disco-agent-mapper", headers=H,
                    json={"dry_run": True, "domain": "x.com"}).json()
    assert j["status"] == "failed" and j["error"] == "nope"


def test_unexpected_error_is_json_500(client, monkeypatch):
    def bad(body):
        raise KeyError("x")

    monkeypatch.setattr(am, "new_state", bad)
    r = client.post("/public/disco-agent-mapper", headers=H,
                    json={"dry_run": True, "domain": "x.com"})
    assert r.status_code == 500
    assert r.json()["status"] == "failed" and "KeyError" in r.json()["error"]
