"""Claim server functions — thin orchestration over the NORA claim gate (port of
lib/claim.functions.ts).

Every step is a live run of a registered claim_* skill (execute_skill_run → exp_skill_run row),
and every write is a governed DB function (exp_claim_gate_*), which writes exp_claim +
claim_queue + exp_claim_events + the owner grant + professionals.claimed together. Nothing here
writes a table directly. The claimant's own click is the approval + consent for these runs
(trigger "manual").
"""
from __future__ import annotations

import math
import re
from typing import Any

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from _base.auth import current_user
from _base.server_fn import FnCall, bad_input, fn_router
from nora_os.capabilities import capability_handlers
from nora_os.db import Db, DbError
from nora_os.jsutil import js_number, nz
from nora_os.nora.claim_gate import REFUSAL_MESSAGE, decide_next, ui_status
from nora_os.nora.claim_otp import otp_hash
from nora_os.routers.nora_runner_fn import _issues
from nora_os.runner_server import execute_skill_run

router = fn_router("nora_os")

# zod's .uuid() pattern (any version / variant, case-insensitive).
_UUID = re.compile(
    r"^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$"
)


def _uuid(v: str) -> str:
    if not _UUID.match(v):
        raise ValueError("Invalid uuid")
    return v


def _max(v: str | None, n: int) -> str | None:
    if v is None:
        return None
    t = v.strip()
    if len(t) > n:
        raise ValueError(f"String must contain at most {n} character(s)")
    return t


class SubmitInput(BaseModel):
    model_config = ConfigDict(strict=True)
    professionalId: str
    licenseNumber: str | None = None

    @field_validator("professionalId")
    @classmethod
    def check_professional_id(cls, v: str) -> str:
        return _uuid(v)

    @field_validator("licenseNumber")
    @classmethod
    def check_license(cls, v: str | None) -> str | None:
        return _max(v, 64)


class VerifyInput(BaseModel):
    model_config = ConfigDict(strict=True)
    professionalId: str
    code: str

    @field_validator("professionalId")
    @classmethod
    def check_professional_id(cls, v: str) -> str:
        return _uuid(v)

    @field_validator("code")
    @classmethod
    def check_code(cls, v: str) -> str:
        t = v.strip()
        if not re.fullmatch(r"\d{6}", t, flags=re.ASCII):
            raise ValueError("Enter the 6-digit code")
        return t


class ReleaseInput(BaseModel):
    model_config = ConfigDict(strict=True)
    professionalId: str
    reason: str | None = None

    @field_validator("professionalId")
    @classmethod
    def check_professional_id(cls, v: str) -> str:
        return _uuid(v)

    @field_validator("reason")
    @classmethod
    def check_reason(cls, v: str | None) -> str | None:
        return _max(v, 500)


def _parse(model: type[BaseModel], raw: Any) -> Any:
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise bad_input(_issues(exc)) from exc


class ClaimStepRefused(HTTPException):
    """A claim step the governance envelope refused, or a deliberate claim-flow stop."""

    def __init__(self, detail: str, status_code: int = 409) -> None:
        super().__init__(status_code=status_code, detail=detail)


class Gate:
    """`gate()` in the TS: the service-role client, its handlers and one-step live runs."""

    def __init__(self) -> None:
        self.db = Db("service_role")
        self.handlers = capability_handlers(self.db)

    def run(
        self, actor: str, skill_key: str, entity_id: str, inputs: dict, capability: str
    ) -> dict:
        """One live claim-skill run; returns the named capability's outputs or raises."""
        run = execute_skill_run(
            db=self.db,
            writer=self.db,
            actor=actor,
            data={
                "skillKey": skill_key,
                "entityId": entity_id,
                "mode": "live",
                "trigger": "manual",
                "inputs": inputs,
                "approval": {"approved": True, "consent": True},
            },
            handlers=self.handlers,
        )
        if run.get("verdict") != "executed":
            outputs = run.get("outputs") or {}
            blockers = (outputs.get("governance") or {}).get("live_blockers")
            reason = nz(run.get("error"), "; ".join(blockers) if blockers is not None else None, "refused")
            raise ClaimStepRefused(f"Claim step {skill_key} {_js_str(run.get('verdict'))}: {reason}")
        caps = (run.get("outputs") or {}).get("capabilities") or {}
        return nz(caps.get(capability), {})


def _js_str(v: Any) -> str:
    return "null" if v is None else str(v)


def entity_for(db: Db, record_type: str, id_: str) -> str:
    """Canonical exp_entity for the published record (linked / created by the governed fn)."""
    data = db.rpc(
        "exp_entity_for_record",
        {"p_record_type": record_type, "p_record_id": id_, "p_create": True},
        casts={"p_record_id": "uuid"},
    )
    if not data:
        raise ClaimStepRefused("Profile not found", status_code=404)
    return str(data)


def my_claim(db: Db, entity_id: str, user_id: str, statuses: list[str]) -> dict | None:
    return db.maybe_one(
        "select claim_id, status, trust_tier from exp_claim"
        " where entity_id = %s and user_id = %s and status = any(%s::text[])"
        " order by created_at desc limit 1",
        (entity_id, user_id, statuses),
        what="exp_claim",
    )


def _tier(v: Any) -> int | float:
    n = js_number(v)
    return int(n) if not math.isnan(n) and float(n).is_integer() else n


def submit_claim_flow(g: Gate, user_id: str, inp: SubmitInput) -> dict:
    entity_id = entity_for(g.db, "professional", inp.professionalId)

    # 1. Silent precheck (GBP Place ID + held signals + brief keys). Read-only.
    pre = g.run(
        user_id,
        "claim_silent_precheck",
        entity_id,
        {"licenseNumber": inp.licenseNumber},
        "claim_precheck",
    )
    refusal = pre.get("refusal")
    if refusal in ("claimed_by_other", "already_owner"):
        return {"status": ui_status(refusal), "professionalId": inp.professionalId}
    if refusal:
        raise bad_input(REFUSAL_MESSAGE.get(refusal, str(refusal)))

    confidence = _tier(nz(pre.get("confidence"), 0))
    signals = nz(pre.get("signals"), {})
    nxt = pre.get("next")
    base = {"confidence": confidence, "signals": signals, "professionalId": inp.professionalId}

    # 2. Open / raise the claim at the earned tier (T0 at minimum: authenticated).
    started = g.run(
        user_id,
        "claim_initiate",
        entity_id,
        {
            "claim_id": pre.get("claim_id"),
            "tier": _tier(nz(pre.get("tier"), 0)),
            "path": pre.get("path"),
            "confidence": confidence,
            "signals": signals,
            "queue_status": "manual_review" if nxt == "manual_review" else None,
        },
        "claim_gate_write",
    )
    if started.get("status") in ("claimed_by_other", "already_owner"):
        return {"status": ui_status(started["status"]), **base}
    if started.get("status") != "pending":
        raise ClaimStepRefused(f"Claim could not start ({_js_str(started.get('status'))})")
    claim_id = _js_str(started.get("claim_id"))
    tier = _tier(nz(started.get("trust_tier"), 0))
    if tier >= 1:
        nxt = "grant"

    # 3a. Earned T1+: bind now.
    if nxt == "grant":
        granted = g.run(user_id, "claim_grant", entity_id, {"claim_id": claim_id}, "claim_bind")
        return {"status": "approved", **base, "tier": _tier(nz(granted.get("trust_tier"), tier))}

    # 3b. Short of T1: ONE explained OTP to the on-file email, only if transport is live.
    if nxt == "challenge":
        if pre.get("challenge_active"):
            return {
                "status": "needs_verification",
                **base,
                "tier": tier,
                "challenge": {"sent": True, "destination": None},
            }
        sent = g.run(user_id, "claim_challenge", entity_id, {"claim_id": claim_id}, "otp_send")
        if sent.get("status") == "sent":
            return {
                "status": "needs_verification",
                **base,
                "tier": tier,
                "challenge": {"sent": True, "destination": sent.get("destination")},
            }
        # not_configured / no_channel / already_issued → the next cheapest path.
        nxt = decide_next(
            tier=tier,
            confidence=confidence,
            record_email=None,
            transport_ready=False,
            challenge_issued=True,
            license_provided=bool(inp.licenseNumber),
            brief_wants_credential=bool(pre.get("wants_credential")),
            record_has_license=bool(pre.get("record_has_license")),
        )

    if nxt == "license":
        return {
            "status": "needs_verification",
            **base,
            "tier": tier,
            "needsLicense": True,
            "challenge": None,
        }

    # 3c. Manual review (staff adjudicate via exp_claim_queue_adjudicate).
    if pre.get("next") != "manual_review":
        g.run(
            user_id,
            "claim_initiate",
            entity_id,
            {"claim_id": claim_id, "tier": tier, "queue_status": "manual_review"},
            "claim_gate_write",
        )
    return {"status": "manual_review", **base, "tier": tier}


def verify_claim_flow(g: Gate, user_id: str, inp: VerifyInput) -> dict:
    entity_id = entity_for(g.db, "professional", inp.professionalId)
    claim = my_claim(g.db, entity_id, user_id, ["pending"])
    if not claim:
        raise bad_input("No open claim for this profile.")
    res = g.run(
        user_id,
        "claim_verify_email",
        entity_id,
        {"claim_id": claim["claim_id"], "code_hash": otp_hash(claim["claim_id"], inp.code)},
        "otp_verify",
    )
    outcome = _js_str(nz(res.get("outcome"), "none"))
    if outcome != "verified":
        locked = outcome in ("expired", "locked", "none")
        attempts = nz(res.get("attempts_left"), 0)
        return {
            "status": "manual_review" if locked else "needs_verification",
            "professionalId": inp.professionalId,
            "otp": outcome,
            "challenge": None if locked else {"sent": True, "destination": None},
            "message": f"That code didn't match ({_js_str(attempts)} tries left)."
            if outcome == "mismatch"
            else "That code can no longer be used — our team will review your claim.",
        }
    granted = g.run(
        user_id, "claim_grant", entity_id, {"claim_id": claim["claim_id"]}, "claim_bind"
    )
    return {
        "status": "approved",
        "professionalId": inp.professionalId,
        "tier": _tier(nz(granted.get("trust_tier"), 1)),
    }


def release_claim_flow(g: Gate, user_id: str, inp: ReleaseInput) -> dict:
    entity_id = entity_for(g.db, "professional", inp.professionalId)
    claim = my_claim(g.db, entity_id, user_id, ["verified", "pending"])
    if not claim:
        return {"status": "noop"}
    res = g.run(
        user_id,
        "claim_release",
        entity_id,
        {"claim_id": claim["claim_id"], "reason": inp.reason},
        "claim_unbind",
    )
    return {"status": _js_str(nz(res.get("status"), "released"))}


def _db_errors(fn):
    try:
        return fn()
    except DbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/submitClaim")
def submit_claim(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    inp = _parse(SubmitInput, call.data)
    return _db_errors(lambda: submit_claim_flow(Gate(), claims["sub"], inp))


@router.post("/verifyClaimCode")
def verify_claim_code(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    inp = _parse(VerifyInput, call.data)
    return _db_errors(lambda: verify_claim_flow(Gate(), claims["sub"], inp))


@router.post("/releaseClaim")
def release_claim(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    inp = _parse(ReleaseInput, call.data)
    return _db_errors(lambda: release_claim_flow(Gate(), claims["sub"], inp))
