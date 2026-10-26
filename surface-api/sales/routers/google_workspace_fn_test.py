"""Route wiring + shape for the sales opportunity Google delivery functions (DB/HTTP faked)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from sales.router import router
from sales.routers import google_workspace_fn

CLAIMS = {"sub": "u-1", "role": "authenticated", "email": "Me@Corp.com"}
OPP = "11111111-2222-3333-4444-555555555555"
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
    d = fakedb(google_workspace_fn)
    d.on("from exp_integration_google", [dict(WS_ROW)])
    return d


def test_delivery_status_any_user(client, db):
    res = client.post("/sales/fn/getGoogleDeliveryStatus", json={"data": None})
    assert res.json() == {"status": "not_connected", "domainStatus": "unverified",
                          "domain": "corp.com", "canDeliver": False}


def test_send_email_queues_when_not_live(client, db):
    db.on("from exp_sales_pipeline", [{"id": OPP, "owner": None, "account_id": "a1"}])
    db.on("insert into exp_email_outbox", [{"id": "ob-1"}])
    res = client.post("/sales/fn/sendOpportunityEmail", json={"data": {
        "opportunityId": OPP, "to": ["x@y.com"], "subject": " Hi ", "body": "Body"}})
    assert res.json() == {"status": "pending", "error": None, "outboxId": "ob-1"}
    ins = db.sql("insert into exp_email_outbox")[0]
    assert ins[0] == "authenticated" and ins[2][2] == "me@corp.com" and ins[2][4] == "Hi"
    assert db.sql("insert into exp_activity_events")[0][2][0] == "email_queued"


def test_send_email_validation_and_missing_opp(client, db):
    bad = client.post("/sales/fn/sendOpportunityEmail", json={"data": {
        "opportunityId": "nope", "to": [], "subject": "", "body": "b"}})
    assert bad.status_code == 400
    res = client.post("/sales/fn/sendOpportunityEmail", json={"data": {
        "opportunityId": OPP, "to": ["x@y.com"], "subject": "s", "body": "b"}})
    assert (res.status_code, res.json()["detail"]) == (400, "Opportunity not found")


def test_send_email_live_delivery(client, fakedb, monkeypatch):
    d = fakedb(google_workspace_fn)
    d.on("from exp_integration_google", [{**WS_ROW, "status": "connected",
                                          "domain_status": "verified"}])
    d.on("from exp_sales_pipeline", [{"id": OPP, "owner": None, "account_id": None}])
    d.on("insert into exp_email_outbox", [{"id": "ob-2"}])
    monkeypatch.setenv("G_SA", "{}")
    monkeypatch.setattr(google_workspace_fn.gw, "send_gmail", lambda *a: "gmail-1")
    res = client.post("/sales/fn/sendOpportunityEmail", json={"data": {
        "opportunityId": OPP, "to": ["x@y.com"], "subject": "s", "body": "b"}})
    assert res.json()["status"] == "sent"
    upd = d.sql("update exp_email_outbox")[0]
    assert upd[0] == "service_role" and upd[2][:2] == ("sent", "gmail-1")


def test_schedule_meeting(client, db):
    db.on("insert into exp_sales_demos", [{"id": "demo-1"}])
    payload = {"opportunityId": OPP, "kind": "demo", "start": "2026-11-01T15:00:00Z",
               "durationMinutes": 30, "objective": "Show", "agenda": "", "attendees": [],
               "sellerId": None}
    res = client.post("/sales/fn/scheduleOpportunityMeeting", json={"data": payload})
    assert res.json() == {"demoId": "demo-1", "calendar": "pending"}
    ins = db.sql("insert into exp_sales_demos")[0][2]
    assert ins[2] == "2026-11-01T15:00:00.000Z" and ins[4] is None
    bad = client.post("/sales/fn/scheduleOpportunityMeeting",
                      json={"data": {**payload, "start": "not a real date"}})
    assert (bad.status_code, bad.json()["detail"]) == (400, "Invalid start time")



def test_routes_served_under_sales():
    paths = {r.path for r in router.routes}
    for name in ("getGoogleDeliveryStatus", "sendOpportunityEmail", "scheduleOpportunityMeeting"):
        assert f"/sales/fn/{name}" in paths
