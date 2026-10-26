"""Route tests for /public/export-prompt-bundles (DB and storage monkeypatched)."""
from __future__ import annotations

import json
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from etl.tests.test_deep_hydrate import FakeConn
from surfaces.etl.routers import export_prompt_bundles as r


class Resp:
    def __init__(self, status: int, body):
        self.status_code = status
        self.text = body if isinstance(body, str) else json.dumps(body)
        self._body = body

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self):
        return json.loads(self.text)


@pytest.fixture
def env(monkeypatch):
    state = {"count": 4041}
    bundles = [{"gcid": f"gcid:c{i:04d}", "bundle": {"gcid": f"gcid:c{i:04d}"}}
               for i in range(state["count"])]

    def respond(q: str, p: list):
        if "count(*)" in q:
            return [{"n": state["count"]}]
        limit, offset = p
        return bundles[offset:offset + limit]

    conn = FakeConn(respond)

    @contextmanager
    def fake_role(role, claims=None, *, write=False, fresh=False):
        assert role == "service_role"
        yield conn

    monkeypatch.setattr(r, "role_connection", fake_role)
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc")
    posts: list[dict] = []
    replies: list = []

    def fake_post(url, headers=None, content=None, timeout=None):
        posts.append({"url": url, "headers": headers, "content": content})
        return replies.pop(0)

    monkeypatch.setattr(r.httpx, "post", fake_post)
    app = FastAPI()
    app.include_router(r.router)
    return TestClient(app), state, posts, replies


def test_not_ready(env):
    client, state, posts, _ = env
    state["count"] = 12
    assert client.get("/public/export-prompt-bundles").json() == {"status": "not_ready",
                                                                  "built": 12}
    assert not posts


def test_export_uploads_and_signs(env):
    client, _, posts, replies = env
    replies += [Resp(200, {"Key": "exports/x"}), Resp(200, {"signedURL": "/object/sign/e?t=1"})]
    body = client.post("/public/export-prompt-bundles").json()
    base = "https://proj.supabase.co"
    assert body == {
        "status": "done", "url": f"{base}/storage/v1/object/sign/e?t=1",
        "public_url": f"{base}/storage/v1/object/public/exports/category_prompt_bundles.json",
        "bytes": len(posts[0]["content"]), "rows": 4041,
    }
    up = posts[0]
    assert up["url"] == f"{base}/storage/v1/object/exports/category_prompt_bundles.json"
    assert up["headers"]["x-upsert"] == "true" and up["headers"]["apikey"] == "svc"
    doc = json.loads(up["content"])
    assert doc["format"] == "exp_category_bundle_universe" and doc["count"] == 4041
    assert len(doc["categories"]) == 4041 and doc["categories"][0] == {"gcid": "gcid:c0000"}
    assert json.loads(posts[1]["content"]) == {"expiresIn": 604800}


def test_upload_error(env):
    client, _, _, replies = env
    replies.append(Resp(400, {"message": "bucket not found"}))
    res = client.get("/public/export-prompt-bundles")
    assert res.status_code == 500
    assert res.json() == {"status": "error", "message": "bucket not found"}
