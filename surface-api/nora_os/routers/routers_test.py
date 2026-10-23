"""Route wiring + response shapes for runSkill and the claim functions (no live DB/auth)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from nora_os.router import router
from nora_os.routers import claim_fn

USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PRO = "22222222-2222-4222-8222-222222222222"
ENT = "11111111-1111-4111-8111-111111111111"
CLAIMS = {"sub": USER, "role": "authenticated"}


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


class FakeConn:
    """Records (role, write, sql, params) and answers by SQL substring."""

    def __init__(self, log, answer, role, write):
        self.log, self.answer, self.role, self.write = log, answer, role, write

    def cursor(self):
        conn = self

        class Cur:
            description = None

            def __init__(self):
                self._rows: list = []

            def execute(self, sql, params=None):
                conn.log.append((conn.role, conn.write, sql, params))
                rows = conn.answer(sql, params)
                if isinstance(rows, Exception):
                    raise rows
                self._rows = rows or []
                self.description = [("x",)]

            def fetchall(self):
                return self._rows

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return Cur()


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert write or fresh  # supabase-js parity: every call hits the primary
        if role == "authenticated":
            assert claims == CLAIMS
        yield FakeConn(log, lambda s, p: state["answer"](s, p), role, write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


SKILL = {
    "key": "s", "status": "draft", "is_active": True, "version": "1", "entity_types": [], "tools_used": [],
    "autonomy": "auto", "model_tier": None, "reads_state": [], "requires_entitlement": None,
    "charges_money": False, "captures_consent": False, "requires_user_approval": False,
    "expected_srs_lift": None, "value_prop": None, "price_ref": None, "offer_expected_points": None,
    "trial_eligible": False, "graph_writes": [],
}


def runskill_answer(grants):
    def answer(sql, params):
        if "from exp_control_grants" in sql:
            return [{"role": g} for g in grants]
        if "from exp_skill_registry" in sql:
            return [SKILL]
        if "insert into exp_skill_run" in sql:
            cols = sql.split("(", 1)[1].split(")", 1)[0].split(", ")
            return [{"id": "r1", "created_at": "2026-10-23T00:00:00+00:00",
                     **{c: getattr(v, "obj", v) for c, v in zip(cols, params, strict=True)}}]
        return []

    return answer


def test_run_skill_requires_a_console_role(dbfake):
    _, state = dbfake
    state["answer"] = runskill_answer([])
    r = client().post("/nora_os/fn/runSkill", json={"data": {"skillKey": "s", "mode": "dry_run"}})
    assert r.status_code == 403 and r.json()["detail"] == "Forbidden: no console role"
    state["answer"] = runskill_answer(["owner"])
    r = client().post("/nora_os/fn/runSkill", json={"data": {"skillKey": "s", "mode": "dry_run"}})
    assert r.status_code == 403


def test_live_runs_need_super_admin_or_architect(dbfake):
    _, state = dbfake
    state["answer"] = runskill_answer(["viewer"])
    r = client().post("/nora_os/fn/runSkill", json={"data": {"skillKey": "s", "mode": "live"}})
    assert r.status_code == 403
    assert r.json()["detail"] == "Forbidden: live runs require Super Admin or Architect"


def test_dry_run_returns_the_persisted_row(dbfake):
    log, state = dbfake
    state["answer"] = runskill_answer(["viewer"])
    r = client().post(
        "/nora_os/fn/runSkill",
        json={"data": {"skillKey": "  s  ", "mode": "dry_run", "inputs": {"a": 1}, "extra": "dropped"}},
    )
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["id"] == "r1" and run["skill_key"] == "s" and run["verdict"] == "would_execute"
    assert run["trigger"] == "manual" and run["inputs"] == {"a": 1, "_approval": {"approved": False, "consent": False}}
    roles = [(role, write, sql.split()[0], ("exp_control_grants" in sql) or ("exp_skill_registry" in sql)
              or ("exp_skill_run" in sql)) for role, write, sql, _ in log]
    assert ("service_role", False, "select", True) == roles[0]  # grant check: service role
    assert ("authenticated", False, "select", True) == roles[1]  # registry read: the caller's RLS
    assert roles[-1] == ("service_role", True, "insert", True)  # the row: service role write
    assert log[0][3] == (USER,)


@pytest.mark.parametrize(
    "data",
    [
        None,
        {"mode": "dry_run"},
        {"skillKey": "  ", "mode": "dry_run"},
        {"skillKey": "s", "mode": "fast"},
        {"skillKey": "s", "mode": "dry_run", "trigger": "cron"},
        {"skillKey": "s", "mode": "dry_run", "approval": {"approved": "yes"}},
        {"skillKey": 3, "mode": "dry_run"},
    ],
)
def test_run_skill_validates_input(dbfake, data):
    r = client().post("/nora_os/fn/runSkill", json={"data": data})
    assert r.status_code == 400


def test_db_errors_surface_with_the_ts_message(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied for table x")
    r = client().post("/nora_os/fn/runSkill", json={"data": {"skillKey": "s", "mode": "dry_run"}})
    assert r.status_code == 500
    assert r.json()["detail"].startswith("exp_control_grants: permission denied")


def test_rpc_sql_is_named_and_cast(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"result": ENT}]
    from nora_os.db import Db

    out = Db("service_role").rpc(
        "exp_entity_for_record",
        {"p_record_type": "professional", "p_record_id": PRO, "p_create": True},
        casts={"p_record_id": "uuid"},
    )
    assert out == ENT
    role, write, sql, params = log[0]
    assert (role, write) == ("service_role", True)
    assert sql == ("select public.exp_entity_for_record(p_record_type := %s, p_record_id := %s::uuid,"
                   " p_create := %s) as result")
    assert params == ("professional", PRO, True)


# ── claim functions: orchestration over scripted claim-skill runs ─────────


class FakeGate:
    def __init__(self, script):
        self.script = script
        self.db = object()
        self.runs: list = []

    def run(self, actor, skill_key, entity_id, inputs, capability):
        self.runs.append((skill_key, inputs, capability))
        out = self.script[skill_key]
        if isinstance(out, list):
            out = out.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


@pytest.fixture
def gate(monkeypatch):
    holder = {}

    def make(script):
        g = FakeGate(script)
        holder["g"] = g
        return g

    monkeypatch.setattr(claim_fn, "entity_for", lambda db, rt, pid: ENT)
    monkeypatch.setattr(claim_fn, "my_claim", lambda db, e, u, st: holder.get("claim"))
    return make, holder


def submit(gate_obj, monkeypatch, data):
    monkeypatch.setattr(claim_fn, "Gate", lambda: gate_obj)
    return client().post("/nora_os/fn/submitClaim", json={"data": data})


SIG = {"name": {"matched": True, "weight": 35}}


def test_submit_claimed_by_other(gate, monkeypatch):
    make, _ = gate
    g = make({"claim_silent_precheck": {"refusal": "claimed_by_other"}})
    r = submit(g, monkeypatch, {"professionalId": PRO})
    assert r.json() == {"status": "already_claimed", "professionalId": PRO}


def test_submit_other_refusal_is_an_error(gate, monkeypatch):
    make, _ = gate
    r = submit(make({"claim_silent_precheck": {"refusal": "not_claimable"}}), monkeypatch, {"professionalId": PRO})
    assert r.status_code == 400
    assert r.json()["detail"] == "This profile type cannot be claimed for its category."


def test_submit_earned_tier_grants(gate, monkeypatch):
    make, _ = gate
    g = make({
        "claim_silent_precheck": {"refusal": None, "confidence": 85, "signals": SIG, "next": "grant", "tier": 1,
                                  "path": "email_exact", "claim_id": None},
        "claim_initiate": {"status": "pending", "claim_id": "c1", "trust_tier": 1},
        "claim_grant": {"trust_tier": 1},
    })
    r = submit(g, monkeypatch, {"professionalId": PRO, "licenseNumber": " KY-1 "})
    assert r.json() == {"status": "approved", "confidence": 85, "signals": SIG, "professionalId": PRO, "tier": 1}
    assert g.runs[0] == ("claim_silent_precheck", {"licenseNumber": "KY-1"}, "claim_precheck")
    assert g.runs[1][1] == {"claim_id": None, "tier": 1, "path": "email_exact", "confidence": 85, "signals": SIG,
                            "queue_status": None}
    assert g.runs[2] == ("claim_grant", {"claim_id": "c1"}, "claim_bind")


def test_submit_challenge_sent(gate, monkeypatch):
    make, _ = gate
    g = make({
        "claim_silent_precheck": {"refusal": None, "confidence": 35, "signals": {}, "next": "challenge", "tier": 0},
        "claim_initiate": {"status": "pending", "claim_id": "c1", "trust_tier": 0},
        "claim_challenge": {"status": "sent", "destination": "j•••@x.com"},
    })
    r = submit(g, monkeypatch, {"professionalId": PRO})
    assert r.json() == {"status": "needs_verification", "confidence": 35, "signals": {}, "professionalId": PRO,
                        "tier": 0, "challenge": {"sent": True, "destination": "j•••@x.com"}}


def test_submit_challenge_not_configured_falls_to_license(gate, monkeypatch):
    make, _ = gate
    g = make({
        "claim_silent_precheck": {"refusal": None, "confidence": 70, "signals": {}, "next": "challenge", "tier": 0,
                                  "wants_credential": True, "record_has_license": True},
        "claim_initiate": {"status": "pending", "claim_id": "c1", "trust_tier": 0},
        "claim_challenge": {"status": "not_configured"},
    })
    r = submit(g, monkeypatch, {"professionalId": PRO})
    assert r.json() == {"status": "needs_verification", "confidence": 70, "signals": {}, "professionalId": PRO,
                        "tier": 0, "needsLicense": True, "challenge": None}


def test_submit_manual_review_routes_the_queue(gate, monkeypatch):
    make, _ = gate
    g = make({
        "claim_silent_precheck": {"refusal": None, "confidence": 10, "signals": {}, "next": "challenge", "tier": 0},
        "claim_initiate": [{"status": "pending", "claim_id": "c1", "trust_tier": 0}, {"status": "pending"}],
        "claim_challenge": {"status": "no_channel"},
    })
    r = submit(g, monkeypatch, {"professionalId": PRO})
    assert r.json()["status"] == "manual_review"
    assert g.runs[-1] == ("claim_initiate", {"claim_id": "c1", "tier": 0, "queue_status": "manual_review"},
                          "claim_gate_write")


def test_submit_claim_step_refusal(gate, monkeypatch):
    make, _ = gate
    g = make({
        "claim_silent_precheck": {"refusal": None, "confidence": 10, "signals": {}, "next": "manual_review"},
        "claim_initiate": {"status": "rejected"},
    })
    r = submit(g, monkeypatch, {"professionalId": PRO})
    assert r.status_code == 409 and r.json()["detail"] == "Claim could not start (rejected)"


def test_gate_run_refused_message(monkeypatch):
    run = {"verdict": "blocked", "error": None, "outputs": {"governance": {"live_blockers": ["a: x", "b: y"]}}}
    monkeypatch.setattr(claim_fn, "execute_skill_run", lambda **kw: run)
    monkeypatch.setattr(claim_fn, "capability_handlers", lambda db: {})
    with pytest.raises(claim_fn.ClaimStepRefused) as e:
        claim_fn.Gate().run(USER, "claim_grant", ENT, {}, "claim_bind")
    assert e.value.detail == "Claim step claim_grant blocked: a: x; b: y"


def test_verify_mismatch_and_success(gate, monkeypatch):
    make, holder = gate
    monkeypatch.setenv("CLAIM_OTP_SECRET", "s")
    holder["claim"] = {"claim_id": "c1", "status": "pending", "trust_tier": 0}
    g = make({"claim_verify_email": {"outcome": "mismatch", "attempts_left": 3}})
    monkeypatch.setattr(claim_fn, "Gate", lambda: g)
    r = client().post("/nora_os/fn/verifyClaimCode", json={"data": {"professionalId": PRO, "code": " 123456 "}})
    assert r.json() == {"status": "needs_verification", "professionalId": PRO, "otp": "mismatch",
                        "challenge": {"sent": True, "destination": None},
                        "message": "That code didn't match (3 tries left)."}
    assert g.runs[0][1] == {"claim_id": "c1", "code_hash": claim_fn.otp_hash("c1", "123456", "s")}
    g2 = make({"claim_verify_email": {"outcome": "locked"}})
    monkeypatch.setattr(claim_fn, "Gate", lambda: g2)
    r = client().post("/nora_os/fn/verifyClaimCode", json={"data": {"professionalId": PRO, "code": "123456"}})
    assert r.json()["status"] == "manual_review" and r.json()["challenge"] is None
    g3 = make({"claim_verify_email": {"outcome": "verified"}, "claim_grant": {"trust_tier": 1}})
    monkeypatch.setattr(claim_fn, "Gate", lambda: g3)
    r = client().post("/nora_os/fn/verifyClaimCode", json={"data": {"professionalId": PRO, "code": "123456"}})
    assert r.json() == {"status": "approved", "professionalId": PRO, "tier": 1}


def test_verify_without_open_claim(gate, monkeypatch):
    make, _ = gate
    monkeypatch.setattr(claim_fn, "Gate", lambda: make({}))
    r = client().post("/nora_os/fn/verifyClaimCode", json={"data": {"professionalId": PRO, "code": "123456"}})
    assert r.status_code == 400 and r.json()["detail"] == "No open claim for this profile."


def test_release(gate, monkeypatch):
    make, holder = gate
    monkeypatch.setattr(claim_fn, "Gate", lambda: make({"claim_release": {}}))
    r = client().post("/nora_os/fn/releaseClaim", json={"data": {"professionalId": PRO}})
    assert r.json() == {"status": "noop"}
    holder["claim"] = {"claim_id": "c1", "status": "verified", "trust_tier": 1}
    g = make({"claim_release": {}})
    monkeypatch.setattr(claim_fn, "Gate", lambda: g)
    r = client().post("/nora_os/fn/releaseClaim", json={"data": {"professionalId": PRO, "reason": " moving "}})
    assert r.json() == {"status": "released"}
    assert g.runs[0] == ("claim_release", {"claim_id": "c1", "reason": "moving"}, "claim_unbind")


@pytest.mark.parametrize(
    ("path", "data", "detail"),
    [
        ("verifyClaimCode", {"professionalId": PRO, "code": "12345"}, "Enter the 6-digit code"),
        ("submitClaim", {"professionalId": "nope"}, "Invalid uuid"),
        ("submitClaim", {"professionalId": PRO, "licenseNumber": "x" * 65}, "at most 64"),
        ("releaseClaim", {"professionalId": PRO, "reason": "x" * 501}, "at most 500"),
    ],
)
def test_claim_input_validation(path, data, detail):
    r = client().post(f"/nora_os/fn/{path}", json={"data": data})
    assert r.status_code == 400 and detail in r.json()["detail"]


def test_entity_for_profile_not_found(monkeypatch):
    class Db:
        def rpc(self, fn, args, casts=None):
            return None

    with pytest.raises(claim_fn.ClaimStepRefused) as e:
        claim_fn.entity_for(Db(), "professional", PRO)
    assert e.value.detail == "Profile not found"
