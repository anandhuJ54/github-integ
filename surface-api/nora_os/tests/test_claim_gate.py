"""Port of tests/claim-gate.test.ts."""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
from dataclasses import replace

import pytest
from surfaces.nora_os.nora.claim_gate import (
    BriefClaim,
    Claimant,
    ClaimRecord,
    ExistingClaim,
    advance_tier,
    brief_wants_credential,
    claim_refusal,
    decide_next,
    domain_matches,
    mask_email,
    otp_outcome,
    queue_status,
    required_tier,
    score_precheck,
    tier_allows,
    ui_status,
    website_host,
)
from surfaces.nora_os.nora.claim_otp import generate_otp, otp_hash

RECORD = ClaimRecord(
    record_type="professional",
    id="p1",
    name="Jane Agent",
    email=None,
    website_url="https://www.statefarm.com/agent/us/ky/x/jane-agent",
    telephone="+15555550100",
    license_number="KY-12345",
    place_id="ChIJ123",
    claimed=False,
    owner_user_id=None,
    active=True,
)
CLAIMANT = Claimant(user_id="u1", email="jane.agent@statefarm.com", email_verified=True, name="Jane Agent")


def record(**o):
    return replace(RECORD, **o)


def claimant(**o):
    return replace(CLAIMANT, **o)


def key(k, schema_property=None):
    return {"key": k, "label": k, "schemaProperty": schema_property or k, "source": "derived"}


BRIEF_CRED = BriefClaim(
    claimable=True, keys=[key("name"), key("email"), key("credential_id", "hasCredential.identifier")]
)
BRIEF_PLAIN = BriefClaim(claimable=True, keys=[key("name"), key("email")])


def pre(**o):
    args = {"record": RECORD, "claimant": CLAIMANT, "brief": BRIEF_PLAIN, "managed": None}
    args.update(o)
    return score_precheck(**args)


def test_tiers():
    assert required_tier("view") == 0
    assert required_tier("organize_graph") == 1
    assert required_tier("change_nap") == 2
    assert required_tier("something_new") == 2
    assert tier_allows(1, "publish") is False
    assert tier_allows(2, "publish") is True
    assert tier_allows(0, "preview") is True
    assert tier_allows(None, "view") is False


def test_tiers_only_go_up():
    assert advance_tier(0, 1) == 1
    assert advance_tier(2, 1) == 2
    assert advance_tier(1, 1) == 1
    for bad in (3, -1, 1.5):
        with pytest.raises(ValueError):
            advance_tier(0, bad)


def test_refusals():
    assert claim_refusal(None, "u1", [], BRIEF_PLAIN) == "record_not_found"
    assert claim_refusal(record(active=False), "u1", [], BRIEF_PLAIN) == "record_inactive"
    assert claim_refusal(record(), "u1", [], BriefClaim(claimable=False)) == "not_claimable"
    verified_me = [ExistingClaim("u1", "verified", 1)]
    assert claim_refusal(record(), "u1", verified_me, None) == "already_owner"
    assert claim_refusal(record(claimed=True, owner_user_id="u1"), "u1", [], None) == "already_owner"
    assert claim_refusal(record(), "u1", [ExistingClaim("u2", "verified", 2)], None) == "claimed_by_other"
    assert claim_refusal(record(claimed=True, owner_user_id="u2"), "u1", [], None) == "claimed_by_other"
    # a competing PENDING claim does not refuse (it becomes a conflict at grant)
    assert claim_refusal(record(), "u1", [ExistingClaim("u2", "pending", 0)], None) is None


def test_place_id_match_is_dispositive():
    p = pre(
        claimant=claimant(name="Someone Else", email="x@gmail.com"),
        brief=BRIEF_CRED,
        managed={"placeIds": ["ChIJ999", "ChIJ123"]},
    )
    assert (p["tier"], p["path"], p["confidence"]) == (2, "gbp_place_id", 100)


def test_integration_not_live_never_faked():
    p = pre()
    assert p["signals"]["place_id"]["matched"] is False
    assert p["signals"]["place_id"]["detail"] == "not_configured"


def test_verified_email_exact_plus_name_is_t1():
    p = pre(record=record(email="Jane.Agent@statefarm.com"), brief=BRIEF_CRED)
    assert (p["tier"], p["path"]) == (1, "email_exact")


def test_unverified_email_never_exact():
    p = pre(record=record(email="jane.agent@statefarm.com"), claimant=claimant(email_verified=False))
    assert p["signals"]["email_exact"]["matched"] is False


def test_domain_plus_name_needs_credential_when_brief_asks():
    no_lic = pre(brief=BRIEF_CRED)
    assert no_lic["signals"]["email_domain"]["matched"] is True
    assert no_lic["tier"] == 0
    with_lic = pre(brief=BRIEF_CRED, license_number="ky 12345")
    assert (with_lic["tier"], with_lic["path"], with_lic["confidence"]) == (1, "domain_identity", 100)
    assert pre()["tier"] == 1


def test_generic_mailbox_never_matches():
    p = pre(record=record(website_url="https://gmail.com"), claimant=claimant(email="jane@gmail.com"))
    assert p["signals"]["email_domain"]["matched"] is False
    assert p["tier"] == 0


def test_name_mismatch_stays_t0():
    p = pre(
        claimant=claimant(name="Rival Agent", email="rival@statefarm.com"),
        brief=BRIEF_CRED,
        license_number="KY-12345",
    )
    assert p["tier"] == 0


def test_uncheckable_keys():
    p = pre(record=record(license_number=None, email=None), brief=BRIEF_CRED)
    assert sorted(p["uncheckable"]) == ["email", "licenseNumber"]
    assert brief_wants_credential(BRIEF_CRED) is True
    assert brief_wants_credential(BRIEF_PLAIN) is False


def test_signal_shapes_match_the_ts():
    p = pre(record=record(office={"mode": "single_pro", "placeIdSource": "location"}))
    assert p["signals"]["email_domain"] == {"matched": True, "weight": 35, "detail": "@statefarm.com"}
    assert p["signals"]["email_exact"] == {"matched": False, "weight": 15}
    assert p["signals"]["license"] == {"matched": False, "weight": 30, "detail": "none"}
    assert p["signals"]["place_id"]["detail"] == "not_configured · place id from location"


NEXT = {
    "tier": 0,
    "confidence": 35,
    "record_email": "jane@x.com",
    "transport_ready": True,
    "challenge_issued": False,
    "license_provided": False,
    "brief_wants_credential": True,
    "record_has_license": True,
}


def nxt(**o):
    return decide_next(**{**NEXT, **o})


def test_next_step():
    assert nxt(tier=1) == "grant"
    assert nxt(tier=2) == "grant"
    assert nxt() == "challenge"
    assert nxt(challenge_issued=True) == "manual_review"
    assert nxt(transport_ready=False) == "manual_review"
    assert nxt(record_email=None) == "manual_review"
    assert nxt(transport_ready=False, confidence=70) == "license"
    assert nxt(transport_ready=False, confidence=70, license_provided=True) == "manual_review"
    assert nxt(transport_ready=False, confidence=70, record_has_license=False) == "manual_review"


def test_statuses():
    allowed = ["pending", "auto_approved", "manual_review", "approved", "rejected", "conflict", "released"]
    for s in ("grant", "challenge", "license", "manual_review", "granted", "released", "rejected"):
        assert queue_status(s) in allowed
    assert ui_status("granted") == "approved"
    assert ui_status("challenge") == "needs_verification"
    assert ui_status("license") == "needs_verification"
    assert ui_status("claimed_by_other") == "already_claimed"
    assert ui_status("already_owner") == "approved"
    assert ui_status("manual_review") == "manual_review"


def test_otp_outcomes():
    now = dt.datetime(2026, 10, 11, 12, tzinfo=dt.UTC)
    live = {"status": "sent", "expiresAt": "2026-10-11T12:10:00Z", "attempts": 0}
    assert otp_outcome(challenge=None, matches=True, now=now) == "none"
    assert otp_outcome(challenge=live, matches=True, now=now) == "verified"
    assert otp_outcome(challenge=live, matches=False, now=now) == "mismatch"
    expired = {**live, "expiresAt": "2026-10-11T11:59:00Z"}
    assert otp_outcome(challenge=expired, matches=True, now=now) == "expired"
    assert otp_outcome(challenge={**live, "attempts": 5}, matches=True, now=now) == "locked"
    assert otp_outcome(challenge={**live, "status": "verified"}, matches=True, now=now) == "none"


def test_otp_hash_is_keyed_and_bound_to_the_claim():
    a = otp_hash("c1", "123456", "secret")
    assert a == otp_hash("c1", " 123456 ", "secret")
    assert a != otp_hash("c2", "123456", "secret")
    assert a != otp_hash("c1", "123456", "other")
    assert "123456" not in a
    # byte-for-byte the node createHmac("sha256", secret).update(`${claimId}:${code}`) digest
    assert a == hmac.new(b"secret", b"c1:123456", hashlib.sha256).hexdigest()


def test_otp_secret_from_env(monkeypatch):
    monkeypatch.delenv("CLAIM_OTP_SECRET", raising=False)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc")
    assert otp_hash("c", "1") == otp_hash("c", "1", "svc")
    monkeypatch.setenv("CLAIM_OTP_SECRET", "s2")
    assert otp_hash("c", "1") == otp_hash("c", "1", "s2")
    monkeypatch.delenv("CLAIM_OTP_SECRET")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    with pytest.raises(RuntimeError, match="claim OTP secret missing"):
        otp_hash("c", "1")


def test_generate_otp():
    for _ in range(50):
        c = generate_otp()
        assert len(c) == 6 and c.isdigit()


def test_helpers():
    assert website_host("www.Example.com/x") == "example.com"
    assert domain_matches("statefarm.com", "agents.statefarm.com") is True
    assert domain_matches("evil-statefarm.com", "statefarm.com") is False
    assert mask_email("jane@x.com") == "j•••@x.com"
    assert mask_email("bad") == ""
