"""Route wiring + shape for the admin server functions and the OAuth callback (DB/HTTP faked)."""
from __future__ import annotations

import sys
import types
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core.auth import current_user
from _base.integrations import status
from admin.router import router
from admin.routers import google_oauth_callback, google_workspace_fn, integrations_fn

CLAIMS = {"sub": "u-1", "role": "authenticated", "email": "Me@Corp.com"}
WS_ROW = {"id": "workspace", "status": "not_connected", "domain": "corp.com",
          "domain_status": "unverified", "client_id_ref": "G_CID", "client_secret_ref": "G_CSEC",
          "service_account_ref": "G_SA", "requested_scopes": None, "scopes": None}


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app, follow_redirects=False)


@pytest.fixture
def db(fakedb):
    d = fakedb(google_workspace_fn, integrations_fn, status, google_oauth_callback)
    d.on("from exp_integration_google", [dict(WS_ROW)])
    return d


def test_super_admin_enforced(client, db):
    db.responses.insert(0, ("exp_ctrl_has_role", [{"ok": False}]))
    for name in ("getGoogleIntegration", "startDomainVerification", "checkDomainVerification",
                 "dispatchGoogleOutbox", "getNoraIntegrations"):
        res = client.post(f"/admin/fn/{name}", json={"data": None})
        assert (res.status_code, res.json()["detail"]) == (403, "Super admin required"), name
    assert db.sql("exp_ctrl_has_role")[0][0] == "authenticated"


def test_get_google_integration_shape(client, db, monkeypatch):
    monkeypatch.setenv("G_CID", "cid")
    db.responses.insert(0, ("exp_ctrl_has_role", [{"ok": True}]))
    db.on("from exp_email_outbox", [{"count": 2}])
    body = client.post("/admin/fn/getGoogleIntegration", json={"data": None}).json()
    assert body["secrets"] == {"clientId": True, "clientSecret": False, "serviceAccount": False}
    assert body["pendingEmails"] == 2 and body["pendingCalendar"] == 0
    assert body["requestedScopes"][0].endswith("gmail.send")
    assert body["refs"] == {"clientId": "G_CID", "clientSecret": "G_CSEC", "serviceAccount": "G_SA"}


def test_start_connect_missing_secrets_then_url(client, db, monkeypatch):
    db.responses.insert(0, ("exp_ctrl_has_role", [{"ok": True}]))
    res = client.post("/admin/fn/startGoogleConnect",
                      json={"data": {"origin": "https://app.example.com:443/x"}})
    assert res.json() == {"url": None, "missing": ["G_CID", "G_CSEC"]}
    monkeypatch.setenv("G_CID", "cid")
    monkeypatch.setenv("G_CSEC", "sec")
    url = client.post("/admin/fn/startGoogleConnect",
                      json={"data": {"origin": "https://app.example.com:443/x"}}).json()["url"]
    q = parse_qs(urlsplit(url).query)
    assert q["redirect_uri"] == ["https://app.example.com/api/public/google-oauth-callback"]
    assert q["hd"] == ["corp.com"] and len(q["state"][0]) == 64
    assert q["scope"][0].startswith("openid email https://www.googleapis.com/auth/gmail.send")
    upd = db.sql("update exp_integration_google")[0]
    assert upd[0] == "service_role" and upd[2][0] == "awaiting_admin_authorize"
    assert db.sql("insert into audit_log")[0][0] == "authenticated"
    bad = client.post("/admin/fn/startGoogleConnect", json={"data": {"origin": "nope"}})
    assert bad.status_code == 400


def test_update_nora_integration(client, db, monkeypatch):
    db.responses.insert(0, ("exp_ctrl_has_role", [{"ok": True}]))
    bad = client.post("/admin/fn/updateNoraIntegration",
                      json={"data": {"key": "apify", "refs": {"apiToken": "lower"}}})
    assert bad.status_code == 400 and "UPPER_SNAKE_CASE" in bad.json()["detail"]
    db.on("from exp_integration_settings", [])
    res = client.post("/admin/fn/updateNoraIntegration",
                      json={"data": {"key": "apify", "refs": {"apiToken": " APIFY_X "},
                                     "mode": "live"}})
    assert res.status_code == 400 and res.json()["detail"].startswith("Cannot go live — missing")
    up = db.sql("insert into exp_integration_settings")[0]
    assert up[0] == "service_role" and up[2][0] == "apify" and up[2][3] == "stub"
    assert up[2][1].obj == {"apiToken": "APIFY_X"}


def test_staging_keys(client, monkeypatch):
    mod = types.SimpleNamespace(STATIC_FORMATS={"person.name": "text", "firm.url": "url"},
                                FIELD_MEANINGS={"firm.url": "Website"})
    monkeypatch.setitem(sys.modules, "_base.disco.site_contract", mod)
    res = client.post("/admin/fn/getStagingKeys", json={"data": None})
    assert res.json() == [
        {"id": "firm.url", "subject": "firm", "format": "url", "meaning": "Website"},
        {"id": "person.name", "subject": "person", "format": "text", "meaning": None}]


# --- OAuth callback --------------------------------------------------------------------

CB = "/public/google-oauth-callback"


def _loc(res) -> str:
    assert res.status_code == 302
    return res.headers["location"]


def test_callback_rejections(client, db):
    assert _loc(client.get(CB, params={"error": "access_denied"})).endswith(
        "/admin/integrations?google=denied%3Aaccess_denied")
    assert _loc(client.get(CB, params={"code": "c", "state": "short"})).endswith(
        "google=invalid_request")
    assert _loc(client.get(CB, params={"code": "c", "state": "s" * 20})).endswith(
        "google=state_mismatch")


class _Resp:
    def __init__(self, status: int, body: dict):
        self.status_code, self._body, self.text = status, body, str(body)

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._body


def test_callback_connects(client, fakedb, monkeypatch):
    state = "s" * 32
    d = fakedb(google_oauth_callback)
    d.on("from exp_integration_google", [{
        **WS_ROW, "oauth_state": state, "connected_by": "u-9",
        "oauth_state_expires_at": datetime.now(UTC) + timedelta(minutes=5),
        "refresh_token_vault_id": None}])
    d.on("exp_google_vault_put", [{"id": "vault-1"}])
    monkeypatch.setenv("G_CID", "cid")
    monkeypatch.setenv("G_CSEC", "sec")
    posted = {}

    def post(url, data=None, timeout=None):
        posted.update(url=url, data=data)
        return _Resp(200, {"access_token": "at", "refresh_token": "rt", "scope": "openid email"})

    monkeypatch.setattr(google_oauth_callback.httpx, "post", post)
    monkeypatch.setattr(google_oauth_callback.httpx, "get",
                        lambda *a, **k: _Resp(200, {"email": "Admin@corp.com"}))
    loc = _loc(client.get(CB, params={"code": "abc", "state": state}))
    assert loc == "http://testserver/admin/integrations?google=connected"
    assert posted["data"]["redirect_uri"] == "http://testserver/api/public/google-oauth-callback"
    upd = d.sql("set status = %s, connected_by_email")[0]
    assert upd[2][:5] == ("connected", "Admin@corp.com", upd[2][2], ["openid", "email"], "vault-1")
    assert d.sql("insert into audit_log")[0][2][0] == "u-9"


def test_callback_wrong_domain(client, fakedb, monkeypatch):
    state = "s" * 32
    d = fakedb(google_oauth_callback)
    d.on("from exp_integration_google", [{
        **WS_ROW, "oauth_state": state,
        "oauth_state_expires_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat()}])
    monkeypatch.setenv("G_CID", "cid")
    monkeypatch.setenv("G_CSEC", "sec")
    monkeypatch.setattr(google_oauth_callback.httpx, "post",
                        lambda *a, **k: _Resp(200, {"access_token": "at"}))
    monkeypatch.setattr(google_oauth_callback.httpx, "get",
                        lambda *a, **k: _Resp(200, {"email": "x@other.com"}))
    assert _loc(client.get(CB, params={"code": "abc", "state": state})).endswith(
        "google=wrong_domain")


def test_opportunity_delivery_moved_to_sales():
    """Ruling 2026-10-25: these are served by the sales Surface, not admin."""
    paths = {r.path for r in router.routes}
    for name in ("getGoogleDeliveryStatus", "sendOpportunityEmail", "scheduleOpportunityMeeting"):
        assert f"/admin/fn/{name}" not in paths
