"""setSiteIndexing (moved from search, surface audit 2026-10-25): super admin only, one key
upserted through the caller's session, audited, and the search cache-reset signal emitted."""
from __future__ import annotations

import json
from contextlib import contextmanager, nullcontext

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from admin.routers import site_indexing_fn
from admin.routers.site_indexing_fn import router


class _Result:
    def __init__(self, found):
        self.found = list(found)

    def fetchall(self):
        return self.found

    def fetchone(self):
        return self.found[0] if self.found else None


@pytest.fixture
def fake_db(monkeypatch):
    log: list = []

    def install(responder):
        @contextmanager
        def role_connection(role, jwt_claims=None, *, write=False, fresh=False):
            class _Conn:
                def execute(self, sql, params=None):
                    log.append((role, write, sql, params))
                    return _Result(responder(sql, params) or [])

                def transaction(self):
                    return nullcontext()

            yield _Conn()

        monkeypatch.setattr(site_indexing_fn, "role_connection", role_connection)
        return log

    return install


def _client(signed_in=True) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    if signed_in:
        app.dependency_overrides[current_user] = lambda: {"sub": "user-1", "role": "authenticated"}
    return TestClient(app)


def test_set_site_indexing_requires_super_admin(fake_db):
    assert _client(False).post("/admin/fn/setSiteIndexing",
                               json={"data": {"enabled": False}}).status_code in (401, 403)
    log = fake_db(lambda sql, p: [{"ok": False}] if "exp_ctrl_has_role" in sql else [])
    res = _client().post("/admin/fn/setSiteIndexing", json={"data": {"enabled": False}})
    assert res.status_code == 403 and res.json()["detail"] == "Super admin required"
    assert not [e for e in log if "exp_index_config" in e[2]]
    assert _client().post("/admin/fn/setSiteIndexing",
                          json={"data": {"enabled": "no"}}).status_code == 400


def test_set_site_indexing_writes_key_and_audits(fake_db):
    log = fake_db(lambda sql, p: [{"ok": True}] if "exp_ctrl_has_role" in sql else [])
    res = _client().post("/admin/fn/setSiteIndexing", json={"data": {"enabled": False}})
    assert res.json() == {"enabled": False}
    role, write, sql, params = next(e for e in log if "exp_index_config" in e[2])
    assert role == "authenticated" and write and "on conflict (key)" in sql
    assert params[:2] == ["site_indexing_enabled", "false"]
    audit = next(e for e in log if "insert into audit_log" in e[2])[3]
    assert audit[:2] == ["user-1", "site_indexing_disabled"]
    assert json.loads(audit[2]) == {"site_indexing_enabled": False}
