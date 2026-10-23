"""Claim-gate capability handlers (lib/nora/claim-capabilities.server.ts) with a fake Db."""
from __future__ import annotations

import pytest

from nora_os.nora import claim_capabilities as cc
from nora_os.nora.claim_gate import BriefClaim, Claimant
from nora_os.nora.claim_otp import otp_hash
from nora_os.runner import HandlerContext, RunEntity
from nora_os.tests.fakes import FakeDb

ENT = "11111111-1111-4111-8111-111111111111"
PRO = "22222222-2222-4222-8222-222222222222"
LOC = "33333333-3333-4333-8333-333333333333"
PRO_ENT = "44444444-4444-4444-8444-444444444444"

PRO_ROW = {
    "id": PRO, "display_name": None, "first_name": "Jane", "last_name": "Agent", "email": "jane@agency.com",
    "website_url": "https://agency.com", "phone": "+15555550100", "primary_license_number": "KY-1",
    "gbp_place_id": "ChIJpro", "claimed": False, "user_id": None, "is_active": True, "gcid": "gcid:insurance_agency",
}


def ctx(inputs=None, prior=None, actor="u1", ref=ENT):
    return HandlerContext(mode="live", entity=RunEntity(ref=ref, type="professional"), inputs=inputs or {},
                          prior=prior or {}, actor=actor)


def test_load_claim_record_plain_professional():
    db = FakeDb([
        ("from exp_entity", [{"entity_type": "professional", "identity_keys": {"professional_id": PRO}}]),
        ("rpc:exp_office_mode", {"mode": "professional_only"}),
        ("from professionals", [PRO_ROW]),
    ])
    r = cc.load_claim_record(db, ENT)
    assert r["entityType"] == "professional" and r["claimEntityId"] == ENT and r["gcid"] == "gcid:insurance_agency"
    rec = r["record"]
    assert (rec.name, rec.license_number, rec.place_id, rec.active, rec.office) == (
        "Jane Agent", "KY-1", "ChIJpro", True, None,
    )


def test_load_claim_record_single_pro_office_from_the_location():
    db = FakeDb([
        ("from exp_entity", [{"entity_type": "location", "identity_keys": {"organization_id": LOC}}]),
        ("rpc:exp_office_mode", {"mode": "single_pro", "professional_id": PRO, "location_id": LOC}),
        ("from professionals", [PRO_ROW]),
        ("select gbp_place_id, claimed from organizations", [{"gbp_place_id": "ChIJloc", "claimed": True}]),
        ("rpc:exp_entity_for_record", PRO_ENT),
    ])
    r = cc.load_claim_record(db, ENT)
    assert r["entityType"] == "professional" and r["claimEntityId"] == PRO_ENT
    rec = r["record"]
    assert rec.place_id == "ChIJloc" and rec.claimed is True
    assert rec.office == {"mode": "single_pro", "professionalId": PRO, "locationId": LOC, "placeIdSource": "location"}
    assert db.sql("rpc:exp_entity_for_record")[0][1] == {
        "p_record_type": "professional", "p_record_id": PRO, "p_create": True,
    }


def test_office_mode_errors_fall_back_to_the_record_itself():
    db = FakeDb([
        ("from exp_entity", [{"entity_type": "location", "identity_keys": {"organization_id": LOC}}]),
        ("rpc:exp_office_mode", RuntimeError("function missing")),
        ("from organizations", [{"id": LOC, "name": "Acme", "email": None, "website_url": None, "phone": None,
                                 "gbp_place_id": "P", "claimed": False, "is_active": None, "gcid": "gcid:a"}]),
    ])
    r = cc.load_claim_record(db, ENT)
    assert r["entityType"] == "location" and r["record"].record_type == "organization"
    assert r["record"].active is True


def test_claimant_needs_the_service_client():
    with pytest.raises(RuntimeError, match="claimant identity needs the service client"):
        cc.load_claimant(FakeDb(role="authenticated"), "u1")


def test_claimant_from_gotrue_admin(monkeypatch):
    monkeypatch.setattr(cc, "_auth_admin_get_user", lambda uid: {
        "id": uid, "email": "jane@agency.com", "email_confirmed_at": "2026-01-01T00:00:00Z",
        "user_metadata": {"full_name": "  ", "name": "Jane Agent"},
    })
    c = cc.load_claimant(FakeDb(), "u1")
    assert c == Claimant(user_id="u1", email="jane@agency.com", email_verified=True, name="Jane Agent")


def test_gotrue_admin_request(monkeypatch):
    sent = {}

    class R:
        status_code = 200

        def json(self):
            return {"id": "u1", "email": "a@b.c"}

    def get(url, headers, timeout):
        sent.update(url=url, headers=headers)
        return R()

    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc")
    monkeypatch.setattr(cc.httpx, "get", get)
    assert cc._auth_admin_get_user("u1")["email"] == "a@b.c"
    assert sent["url"] == "https://x.supabase.co/auth/v1/admin/users/u1"
    assert sent["headers"] == {"apikey": "sb_secret_abc"}  # opaque keys are not bearer tokens


@pytest.fixture
def precheck_env(monkeypatch):
    monkeypatch.setattr(cc, "load_claimant", lambda db, uid: Claimant(uid, "jane@agency.com", True, "Jane Agent"))
    monkeypatch.setattr(cc, "load_brief_claim", lambda db, gcid, et, rec: BriefClaim(
        claimable=True, keys=[{"key": "name", "schemaProperty": "name"}, {"key": "email", "schemaProperty": "email"}]))


def _precheck_db(claims=(), reqs=(), sendgrid="key"):
    return FakeDb([
        ("from exp_entity", [{"entity_type": "professional", "identity_keys": {"professional_id": PRO}}]),
        ("rpc:exp_office_mode", None),
        ("from professionals", [PRO_ROW]),
        ("from exp_claim", list(claims)),
        ("from exp_verification_requests", list(reqs)),
        ("from exp_app_config", [{"value": sendgrid}] if sendgrid is not None else []),
    ])


def test_precheck_t1_by_email_exact(precheck_env):
    db = _precheck_db()
    out = cc.claim_capability_handlers(db)["claim_precheck"].run(ctx({"licenseNumber": " "}))["outputs"]
    assert out["refusal"] is None and out["tier"] == 1 and out["path"] == "email_exact"
    assert out["next"] == "grant" and out["confidence"] == 85
    assert out["brief"] == {"claimable": True, "keys": ["name", "email"]}
    assert out["claim_entity_id"] == ENT and out["claim_id"] is None
    assert out["transport_ready"] is True and out["wants_credential"] is False
    assert db.sql("from exp_claim")[0][1] == (ENT, ["pending", "verified"])


def test_precheck_refusal_short_circuits(precheck_env):
    db = _precheck_db(claims=[{"claim_id": "c9", "user_id": "u2", "status": "verified", "trust_tier": 2}])
    out = cc.claim_capability_handlers(db)["claim_precheck"].run(ctx())["outputs"]
    assert out == {"refusal": "claimed_by_other", "claim_id": None, "record_type": "professional"}


def test_precheck_active_challenge_wins(precheck_env, monkeypatch):
    monkeypatch.setattr(cc, "load_claimant", lambda db, uid: Claimant(uid, "x@gmail.com", True, "Someone"))
    db = _precheck_db(
        claims=[{"claim_id": "c1", "user_id": "u1", "status": "pending", "trust_tier": 0}],
        reqs=[{"status": "sent", "expires_at": "2999-01-01T00:00:00+00:00"}],
    )
    out = cc.claim_capability_handlers(db)["claim_precheck"].run(ctx())["outputs"]
    assert out["next"] == "challenge" and out["challenge_active"] is True and out["claim_id"] == "c1"


def test_precheck_uses_managed_place_ids(precheck_env, monkeypatch):
    monkeypatch.setattr(cc, "load_claimant", lambda db, uid: Claimant(uid, "x@gmail.com", True, "Someone"))
    out = cc.claim_capability_handlers(_precheck_db(sendgrid=None))["claim_precheck"].run(
        ctx(prior={"gbp_list_locations": {"place_ids": ["ChIJpro"]}}))["outputs"]
    assert out["tier"] == 2 and out["path"] == "gbp_place_id" and out["transport_ready"] is False


def test_gbp_list_locations_is_a_stub():
    out = cc.claim_capability_handlers(FakeDb())["gbp_list_locations"].run(ctx())["outputs"]
    assert out["status"] == "not_configured" and out["place_ids"] is None


def test_claim_gate_write_start_then_advance(monkeypatch):
    monkeypatch.setattr(cc, "load_claimant", lambda db, uid: Claimant(uid, "jane@agency.com", True, "Jane"))
    db = FakeDb([
        ("from exp_entity", [{"entity_type": "professional", "identity_keys": {"professional_id": PRO}}]),
        ("rpc:exp_office_mode", None),
        ("from professionals", [PRO_ROW]),
        ("rpc:exp_claim_gate_start", {"status": "pending", "claim_id": "c1", "trust_tier": 0}),
        ("rpc:exp_claim_gate_advance", {"trust_tier": 0, "queue": "manual_review"}),
    ])
    out = cc.claim_capability_handlers(db)["claim_gate_write"].run(ctx({
        "tier": 0, "confidence": 34.5, "signals": {"name": {"matched": True}}, "queue_status": "manual_review",
        "actor": "attacker",  # never read: the actor is the run's
    }))["outputs"]
    start = db.sql("rpc:exp_claim_gate_start")[0][1]
    assert start["p_actor"] == "u1" and start["p_record_id"] == PRO and start["p_record_type"] == "professional"
    assert start["p_confidence"] == 35 and start["p_tier"] == 0 and start["p_method"] == "google_oauth"
    assert start["p_claimant_email"] == "jane@agency.com"
    adv = db.sql("rpc:exp_claim_gate_advance")[0][1]
    assert adv == {"p_actor": "u1", "p_claim": "c1", "p_tier": 0, "p_path": None, "p_evidence": {},
                   "p_queue_status": "manual_review"}
    assert out == {"status": "pending", "trust_tier": 0, "queue": "manual_review", "queue_status": "manual_review"}


def test_claim_gate_write_advances_an_open_claim():
    db = FakeDb([("rpc:exp_claim_gate_advance", {"trust_tier": 1})])
    out = cc.claim_capability_handlers(db)["claim_gate_write"].run(ctx({"claim_id": "c1", "tier": 1}))["outputs"]
    assert out == {"status": "pending", "trust_tier": 1, "queue_status": None}


def test_otp_send_hashes_the_code_and_masks_the_destination(monkeypatch):
    monkeypatch.setenv("CLAIM_OTP_SECRET", "s")
    monkeypatch.setattr(cc, "generate_otp", lambda: "123456")
    db = FakeDb([("rpc:exp_claim_gate_challenge", {"status": "sent", "destination": "jane@agency.com", "request_id": "r1"})])
    out = cc.claim_capability_handlers(db)["otp_send"].run(ctx({"claim_id": "c1"}))["outputs"]
    assert out == {"status": "sent", "request_id": "r1", "destination": "j•••@agency.com"}
    args = db.calls[0][1]
    assert args["p_code_hash"] == otp_hash("c1", "123456", "s")
    assert "123456" in args["p_body_html"] and args["p_ttl_minutes"] == 15
    assert "123456" not in str(out)


def test_write_handlers_need_actor_and_entity():
    h = cc.claim_capability_handlers(FakeDb())
    with pytest.raises(ValueError, match="claim_bind needs an acting user"):
        h["claim_bind"].run(ctx({"claim_id": "c"}, actor=None))
    with pytest.raises(ValueError, match="claim_bind needs an exp_entity id"):
        h["claim_bind"].run(ctx({"claim_id": "c"}, ref="not-a-uuid"))
    with pytest.raises(ValueError, match="otp_verify needs claim_id and code_hash"):
        h["otp_verify"].run(ctx({"claim_id": "c"}))


def test_bind_verify_release_call_the_governed_functions():
    db = FakeDb([
        ("rpc:exp_claim_gate_grant", {"status": "verified", "trust_tier": 1}),
        ("rpc:exp_claim_gate_verify_otp", {"outcome": "verified"}),
        ("rpc:exp_claim_gate_release", {"status": "released"}),
    ])
    h = cc.claim_capability_handlers(db)
    assert h["claim_bind"].run(ctx({"claim_id": "c1"}))["outputs"]["trust_tier"] == 1
    assert h["otp_verify"].run(ctx({"claim_id": "c1", "code_hash": "h"}))["outputs"] == {"outcome": "verified"}
    assert h["claim_unbind"].run(ctx({"claim_id": "c1", "reason": " moved "}))["outputs"]["status"] == "released"
    assert db.sql("rpc:exp_claim_gate_release")[0][1] == {"p_claim": "c1", "p_reason": "moved", "p_actor": "u1"}
    assert db.sql("rpc:exp_claim_gate_grant")[0][1] == {"p_actor": "u1", "p_claim": "c1"}
