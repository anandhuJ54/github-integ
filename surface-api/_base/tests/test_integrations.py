"""Pure + DB-faked tests for the shared integrations library."""
from __future__ import annotations

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from _base.integrations import google_workspace as gw
from _base.integrations import status
from _base.integrations.catalog import derive_integration_status, not_configured


def test_derive_status_not_configured_then_stub_then_live():
    refs = {"apiToken": "MY_TOKEN"}
    s = derive_integration_status("apify", mode="live", refs=refs,
                                  settings={"mapRankActorId": " ", "llmCitationActorId": "b"},
                                  persisted=True, has_secret=lambda r: r == "MY_TOKEN")
    assert s["status"] == "not_configured" and s["missing"] == ["mapRankActorId"]
    assert s["refs"] == {"apiToken": "MY_TOKEN"}
    settings = {"mapRankActorId": "a", "llmCitationActorId": "b"}
    stub = derive_integration_status("apify", mode="live", refs=refs, settings=settings,
                                     persisted=False, has_secret=lambda r: True)
    assert stub["status"] == "configured_stub"
    live = derive_integration_status("apify", mode="live", refs=refs, settings=settings,
                                     persisted=True, has_secret=lambda r: True)
    assert live["status"] == "live"
    nc = not_configured(s)
    assert nc["reason"] == "Apify is not configured — missing mapRankActorId"
    assert not_configured(stub)["reason"].endswith("still in stub mode — no live calls")


def test_default_refs_used_when_unset():
    s = derive_integration_status("google_places", mode="stub", refs={}, settings={},
                                  persisted=False, has_secret=lambda r: False)
    assert s["refs"] == {"apiKey": "GOOGLE_PLACES_API_KEY"}
    assert s["missing"] == ["GOOGLE_PLACES_API_KEY"]


def test_secret_by_ref(monkeypatch):
    monkeypatch.setenv("GOOD_REF", "v")
    monkeypatch.setenv("BLANK_REF", "  ")
    assert gw.secret_by_ref("GOOD_REF") == "v"
    assert gw.secret_by_ref("BLANK_REF") is None
    assert gw.secret_by_ref("bad-ref") is None and gw.secret_by_ref(None) is None
    row = {"status": "connected", "domain_status": "verified", "service_account_ref": "GOOD_REF"}
    assert gw.can_deliver(row) and not gw.can_deliver({**row, "domain_status": "pending"})


def test_mime_header():
    assert gw.mime_header("Hello") == "Hello"
    assert gw.mime_header("Héllo") == "=?UTF-8?B?SMOpbGxv?="


# A toy RSA key (small primes) wrapped as PKCS#8, to test the DER parse + PKCS#1 v1.5 math.
def test_sign_assertion_is_verifiable_rs256():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    claims = {"iss": "sa@example.iam", "sub": "u@example.com", "aud": "https://oauth2.googleapis.com/token"}
    token = gw.sign_assertion(claims, pem)
    assert jwt.get_unverified_header(token) == {"alg": "RS256", "typ": "JWT"}
    decoded = jwt.decode(token, key.public_key(), algorithms=["RS256"],
                         audience="https://oauth2.googleapis.com/token")
    assert decoded["sub"] == "u@example.com"


def test_status_missing_table_falls_back(fakedb):
    db = fakedb(status)
    db.on("from exp_integration_settings", psycopg.errors.UndefinedTable("missing"))
    s = status.get_integration_status("google_places")
    assert s["persisted"] is False and s["mode"] == "stub"
    assert db.leases[0] == {"role": "service_role", "claims": None, "write": False, "fresh": True}


def test_status_live_and_with_integration(fakedb, monkeypatch):
    monkeypatch.setenv("PLACES_KEY", "secret")
    db = fakedb(status)
    db.on("from exp_integration_settings", [
        {"key": "google_places", "mode": "live", "secret_refs": {"apiKey": "PLACES_KEY"},
         "settings": {}}])
    assert status.is_live("google_places")
    out = status.with_integration("google_places", lambda c: c["secrets"]["apiKey"][:3])
    assert out == {"ok": True, "status": "live", "integration": "google_places", "data": "sec"}
    stub = status.with_integration("apify", lambda c: pytest.fail("must not run"))
    assert stub["ok"] is False and stub["status"] == "not_configured"
    assert [s["key"] for s in status.list_integration_statuses()] == [
        "google_business_profile", "google_places", "apify"]
