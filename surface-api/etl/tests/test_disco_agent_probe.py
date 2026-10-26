"""Route tests for POST /public/disco-agent-probe (network monkeypatched)."""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from surfaces.etl.routers import disco_agent_probe as probe


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DISCO_WORKER_KEY", "k")
    app = FastAPI()
    app.include_router(probe.router)
    return TestClient(app)


H = {"x-disco-worker-key": "k"}


class Resp:
    def __init__(self, status, body):
        self.status_code = status
        self.text = json.dumps(body)

    @property
    def is_success(self):
        return 200 <= self.status_code < 300


def test_unauthorized(client):
    r = client.post("/public/disco-agent-probe", json={})
    assert r.status_code == 401 and r.text == "Unauthorized"


def test_checks_shape(client, monkeypatch):
    for k in ("OXYLABS_HB_USERNAME", "OXYLABS_HB_PASSWORD", "OXYLABS_USERNAME",
              "OXYLABS_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret")
    sent = {}

    def post(url, timeout=None, headers=None, content=None):
        sent["body"] = json.loads(content)
        return Resp(200, {"model": "claude-sonnet-5-5", "content": [{"text": "OK"}],
                          "usage": {"input_tokens": 3}})

    monkeypatch.setattr(probe.httpx, "post", post)
    monkeypatch.setattr(probe.webscraper, "capture_network_calls",
                        lambda url, **kw: {"ok": True, "status_code": 200, "scrolled": True,
                                           "content": [{}, {}]})
    r = client.post("/public/disco-agent-probe", headers=H, content=b"garbage")
    j = r.json()
    assert r.status_code == 200 and j["url"] == "https://kw.com/agents"
    assert j["model"]["ok"] and j["model"]["reply"] == "OK"
    assert sent["body"]["model"] == "claude-sonnet-5-5"
    assert j["headless_browser"] == {"ok": False, "credentials": "OXYLABS_* (scraper account)",
                                     "error": "no Oxylabs credentials configured"}
    assert j["render"]["calls"] == 2 and j["render"]["error"] is None
    assert j["env_seen"]["ANTHROPIC_API_KEY"] is True and "secret" not in r.text


def test_only_requested_checks(client, monkeypatch):
    monkeypatch.setattr(probe.webscraper, "capture_network_calls",
                        lambda url, **kw: (_ for _ in ()).throw(RuntimeError("down")))
    r = client.post("/public/disco-agent-probe", headers=H,
                    json={"checks": ["render"], "url": "https://x.com/a"})
    j = r.json()
    assert j["model"] is None and j["headless_browser"] is None
    assert j["render"]["ok"] is False and j["render"]["error"] == "Error: down"
