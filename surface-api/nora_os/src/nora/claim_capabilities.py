"""Claim-gate capability handlers (port of lib/nora/claim-capabilities.server.ts).

Each one is reached only through a claim_* skill run, so every step leaves an exp_skill_run row.

  gbp_list_locations  read   GBP locations the claimant manages (stub until creds — never faked)
  claim_precheck      read   silent precheck → refusal | tier | next step
  claim_gate_write    write  exp_claim_gate_start / _advance
  otp_send            write  exp_claim_gate_challenge (one OTP per claim, via exp_outbox)
  otp_verify          write  exp_claim_gate_verify_otp → T1
  claim_bind          write  exp_claim_gate_grant (both sides, atomically)
  claim_unbind        write  exp_claim_gate_release

The write functions are service-role only in the database, so these handlers only work with the
service client the claim gate passes. From the console's RLS client they fail closed. The actor
always comes from HandlerContext.actor, never from inputs; the OTP code never appears in
inputs/outputs (only its HMAC).
"""
from __future__ import annotations

import os
from typing import Any

import httpx
from surfaces.nora_os.category_brief import (
    compile_category_brief,
    entity_brief_for_office,
    load_category_brief_rows,
)
from surfaces.nora_os.db import Db
from surfaces.nora_os.jsutil import date_ms, js_number, js_round, now_ms, nz
from surfaces.nora_os.nora.claim_gate import (
    OTP_TTL_MINUTES,
    BriefClaim,
    Claimant,
    ClaimRecord,
    ExistingClaim,
    brief_wants_credential,
    claim_refusal,
    decide_next,
    mask_email,
    score_precheck,
)
from surfaces.nora_os.nora.claim_otp import generate_otp, otp_hash
from surfaces.nora_os.nora.integrations_adapter import with_integration
from surfaces.nora_os.office_mode import is_single_pro, load_office_mode
from surfaces.nora_os.runner import CapabilityHandler, HandlerContext, HandlerRegistry
from surfaces.nora_os.runner_server import is_uuid


def _need(ctx: HandlerContext, what: str) -> tuple[str, str]:
    if not ctx.actor:
        raise ValueError(f"{what} needs an acting user")
    if not ctx.entity or not is_uuid(ctx.entity.ref):
        raise ValueError(f"{what} needs an exp_entity id")
    return ctx.actor, ctx.entity.ref


def _str(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


def _load_professional_record(db: Db, id_: str) -> dict | None:
    """professionals row → {gcid, record} (shared by the plain and the single-pro office paths)."""
    p = db.maybe_one(
        "select id, display_name, first_name, last_name, email, website_url, phone,"
        " primary_license_number, gbp_place_id, claimed, user_id, is_active, gcid"
        " from professionals where id = %s",
        (id_,),
        what="professionals",
    )
    if not p:
        return None
    joined = " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x)
    return {
        "gcid": p.get("gcid"),
        "record": ClaimRecord(
            record_type="professional",
            id=str(p["id"]),
            name=nz(p.get("display_name"), joined or None),
            email=p.get("email"),
            website_url=p.get("website_url"),
            telephone=p.get("phone"),
            license_number=p.get("primary_license_number"),
            place_id=p.get("gbp_place_id"),
            claimed=bool(p.get("claimed")),
            owner_user_id=p.get("user_id"),
            active=p.get("is_active") is not False,
        ),
    }


def load_claim_record(db: Db, entity_id: str) -> dict:
    """exp_entity → its published record, normalised: {record, gcid, entityType, claimEntityId}.

    Single-pro office (exp_office_mode = 'single_pro'): whichever record the entity links to,
    the claim ACTS AS THE PROFESSIONAL; claimEntityId is the professional's exp_entity; the
    Place ID is the LOCATION's (the pro's own is the fallback); "claimed" if either side is.
    """
    ent = db.maybe_one(
        "select entity_type, identity_keys from exp_entity where entity_id = %s",
        (entity_id,),
        what="exp_entity",
    )
    keys = (ent or {}).get("identity_keys") or {}
    none = {
        "record": None,
        "gcid": None,
        "entityType": (ent or {}).get("entity_type"),
        "claimEntityId": entity_id,
    }

    if keys.get("professional_id"):
        office = load_office_mode(db, "professional", keys["professional_id"])
    elif keys.get("organization_id"):
        office = load_office_mode(db, "organization", keys["organization_id"])
    else:
        office = None
    if is_single_pro(office):
        pro = _load_professional_record(db, office["professionalId"])
        if not pro:
            return none
        loc = db.maybe_one(
            "select gbp_place_id, claimed from organizations where id = %s",
            (office["locationId"],),
            what="organizations",
        )
        rec: ClaimRecord = pro["record"]
        place_id = nz((loc or {}).get("gbp_place_id"), rec.place_id)
        if keys.get("professional_id"):
            claim_entity_id = entity_id
        else:
            claim_entity_id = nz(
                db.rpc(
                    "exp_entity_for_record",
                    {
                        "p_record_type": "professional",
                        "p_record_id": office["professionalId"],
                        "p_create": True,
                    },
                    casts={"p_record_id": "uuid"},
                ),
                entity_id,
            )
        if (loc or {}).get("gbp_place_id"):
            src = "location"
        elif rec.place_id:
            src = "professional"
        else:
            src = None
        rec.place_id = place_id
        rec.claimed = rec.claimed or bool((loc or {}).get("claimed"))
        rec.office = {
            "mode": "single_pro",
            "professionalId": office["professionalId"],
            "locationId": office["locationId"],
            "placeIdSource": src,
        }
        return {
            "gcid": pro["gcid"],
            "entityType": "professional",
            "claimEntityId": claim_entity_id,
            "record": rec,
        }

    if keys.get("professional_id"):
        pro = _load_professional_record(db, keys["professional_id"])
        if not pro:
            return none
        return {**pro, "entityType": "professional", "claimEntityId": entity_id}
    if keys.get("organization_id"):
        o = db.maybe_one(
            "select id, name, email, website_url, phone, gbp_place_id, claimed, is_active, gcid"
            " from organizations where id = %s",
            (keys["organization_id"],),
            what="organizations",
        )
        if not o:
            return none
        return {
            "gcid": o.get("gcid"),
            "entityType": nz((ent or {}).get("entity_type"), "location"),
            "claimEntityId": entity_id,
            "record": ClaimRecord(
                record_type="organization",
                id=str(o["id"]),
                name=o.get("name"),
                email=o.get("email"),
                website_url=o.get("website_url"),
                telephone=o.get("phone"),
                license_number=None,
                place_id=o.get("gbp_place_id"),
                claimed=bool(o.get("claimed")),
                owner_user_id=None,
                active=o.get("is_active") is not False,
            ),
        }
    return none


def _auth_admin_get_user(user_id: str) -> dict:
    """supabase-js `auth.admin.getUserById` → GoTrue admin API (service role key)."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        missing = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)) if not v]
        raise RuntimeError(f"Missing Supabase server environment variable(s): {', '.join(missing)}")
    headers = {"apikey": key}
    # New Supabase API keys are opaque strings, not bearer JWTs (client.server.ts).
    if not key.startswith(("sb_publishable_", "sb_secret_")):
        headers["Authorization"] = f"Bearer {key}"
    res = httpx.get(f"{url.rstrip('/')}/auth/v1/admin/users/{user_id}", headers=headers, timeout=30)
    body: Any
    try:
        body = res.json()
    except ValueError:
        body = {}
    if res.status_code >= 400 or not isinstance(body, dict) or not body.get("id"):
        msg = None
        if isinstance(body, dict):
            msg = body.get("msg") or body.get("message") or body.get("error_description")
        raise RuntimeError(f"auth user: {msg or 'not found'}")
    return body


def load_claimant(db: Db, user_id: str) -> Claimant:
    """The claimant as the auth provider asserts it (service client only)."""
    if not db.is_service:
        raise RuntimeError("claimant identity needs the service client")
    u = _auth_admin_get_user(user_id)
    meta = u.get("user_metadata") or {}
    return Claimant(
        user_id=user_id,
        email=u.get("email") or None,
        email_verified=bool(u.get("email_confirmed_at")),
        name=nz(_str(meta.get("full_name")), _str(meta.get("name"))),
    )


def load_brief_claim(
    db: Db, gcid: str | None, entity_type: str | None, record: ClaimRecord | None
) -> BriefClaim | None:
    """Category brief view for the entity type — the source of the verification keys. A
    single-pro office uses the professional's claim keys, via entity_brief_for_office."""
    if not gcid:
        return None
    brief = compile_category_brief(load_category_brief_rows(db, gcid))
    mode = (record.office or {}).get("mode") if record and record.office else None
    ob = entity_brief_for_office(brief, mode, entity_type)
    return BriefClaim(claimable=ob["claim"]["claimable"], keys=ob["claim"]["keys"]) if ob else None


def transport_ready(db: Db) -> bool:
    try:
        row = db.maybe_one(
            "select value from exp_app_config where key = %s",
            ("sendgrid_api_key",),
            what="exp_app_config",
        )
    except Exception:  # noqa: BLE001
        return False
    v = (row or {}).get("value")
    return bool(v and str(v).strip())


def _gbp_list_locations(_ctx: HandlerContext) -> dict:
    """GBP locations the claimant manages — Place IDs only. Stub until GBP creds; never faked."""

    def live(_creds: dict) -> list[str]:
        # Live path needs the claimant's business.manage OAuth token (per user), which the
        # sign-in flow does not capture yet. Fail loudly rather than guess.
        raise RuntimeError("GBP managed-locations call needs the claimant's business.manage token")

    res = with_integration("google_business_profile", live)
    if not res["ok"]:
        return {"outputs": {"status": res["status"], "reason": res["reason"], "place_ids": None}}
    return {"outputs": {"status": "live", "place_ids": res["data"]}}


def claim_capability_handlers(db: Db) -> HandlerRegistry:
    def claim_precheck(ctx: HandlerContext) -> dict:
        actor, entity_id = _need(ctx, "claim_precheck")
        # single-pro office: claims live on the professional's entity (claimEntityId)
        loaded = load_claim_record(db, entity_id)
        record: ClaimRecord | None = loaded["record"]
        claim_entity_id = loaded["claimEntityId"]
        claimant = load_claimant(db, actor)
        brief = load_brief_claim(db, loaded["gcid"], loaded["entityType"], record)
        claims = db.rows(
            "select claim_id, user_id, status, trust_tier from exp_claim"
            " where entity_id = %s and status = any(%s::text[])",
            (claim_entity_id, ["pending", "verified"]),
            what="exp_claim",
        )
        existing = [
            ExistingClaim(user_id=c["user_id"], status=c["status"], trust_tier=nz(c.get("trust_tier"), 0))
            for c in claims
        ]
        refusal = claim_refusal(record, claimant.user_id, existing, brief)
        gbp = ctx.prior.get("gbp_list_locations") or {}
        managed = {"placeIds": gbp["place_ids"]} if gbp.get("place_ids") is not None else None
        mine = next((c for c in claims if c["user_id"] == actor and c["status"] == "pending"), None)
        challenge_issued = False
        challenge_active = False
        if mine:
            reqs = db.rows(
                "select status, expires_at from exp_verification_requests where claim_id = %s",
                (mine["claim_id"],),
                what="exp_verification_requests",
            )
            challenge_issued = len(reqs) > 0
            now = now_ms()
            challenge_active = any(
                r.get("status") == "sent"
                and bool(r.get("expires_at"))
                and (date_ms(r["expires_at"]) or float("nan")) > now
                for r in reqs
            )
        if not record or refusal:
            return {
                "outputs": {
                    "refusal": refusal,
                    "claim_id": (mine or {}).get("claim_id"),
                    "record_type": record.record_type if record else None,
                }
            }
        license_ = _str(ctx.inputs.get("licenseNumber"))
        pre = score_precheck(
            record=record, claimant=claimant, brief=brief, license_number=license_, managed=managed
        )
        tier = max(pre["tier"], nz((mine or {}).get("trust_tier"), 0))
        ready = transport_ready(db)
        if challenge_active:
            nxt = "challenge"
        else:
            nxt = decide_next(
                tier=tier,
                confidence=pre["confidence"],
                record_email=record.email,
                transport_ready=ready,
                challenge_issued=challenge_issued,
                license_provided=bool(license_),
                brief_wants_credential=brief_wants_credential(brief),
                record_has_license=bool(record.license_number),
            )
        return {
            "outputs": {
                "refusal": None,
                "record_type": record.record_type,
                "record_id": record.id,
                "office": record.office,
                "claim_entity_id": claim_entity_id,
                "claim_id": (mine or {}).get("claim_id"),
                "confidence": pre["confidence"],
                "signals": pre["signals"],
                "tier": pre["tier"],
                "path": pre["path"],
                "effective_tier": tier,
                "next": nxt,
                "challenge_active": challenge_active,
                "challenge_issued": challenge_issued,
                "transport_ready": ready,
                "uncheckable": pre["uncheckable"],
                "wants_credential": brief_wants_credential(brief),
                "record_has_license": bool(record.license_number),
                "brief": {
                    "claimable": brief.claimable,
                    "keys": [k.get("schemaProperty") for k in brief.keys],
                }
                if brief
                else None,
            }
        }

    def claim_gate_write(ctx: HandlerContext) -> dict:
        """Open (or raise) the claim at the earned tier; optionally route its queue row."""
        actor, entity_id = _need(ctx, "claim_gate_write")
        i = ctx.inputs
        tier = js_number(nz(i.get("tier"), 0))
        queue_status = _str(i.get("queue_status"))
        claim_id = _str(i.get("claim_id"))
        if not claim_id:
            record = load_claim_record(db, entity_id)["record"]
            if not record:
                raise ValueError("entity has no linked published record")
            claimant = load_claimant(db, actor)
            out = db.rpc(
                "exp_claim_gate_start",
                {
                    "p_actor": actor,
                    "p_record_type": record.record_type,
                    "p_record_id": record.id,
                    "p_tier": _int(tier),
                    "p_path": _str(i.get("path")),
                    "p_confidence": _int(js_round(js_number(nz(i.get("confidence"), 0)))),
                    "p_signals": nz(i.get("signals"), {}),
                    "p_claimant_email": claimant.email,
                    "p_claimant_name": claimant.name,
                    "p_method": nz(_str(i.get("method")), "google_oauth"),
                },
                casts={
                    "p_actor": "uuid",
                    "p_record_id": "uuid",
                    "p_tier": "smallint",
                    "p_confidence": "smallint",
                },
            )
            if out.get("status") != "pending":
                return {"outputs": out}
            claim_id = str(out.get("claim_id"))
            if not queue_status:
                return {"outputs": out}
        adv = db.rpc(
            "exp_claim_gate_advance",
            {
                "p_actor": actor,
                "p_claim": claim_id,
                "p_tier": _int(tier),
                "p_path": _str(i.get("path")),
                "p_evidence": nz(i.get("evidence"), {}),
                "p_queue_status": queue_status,
            },
            casts={"p_actor": "uuid", "p_claim": "uuid", "p_tier": "smallint"},
        )
        return {"outputs": {"status": "pending", **(adv or {}), "queue_status": queue_status}}

    def otp_send(ctx: HandlerContext) -> dict:
        """One explained OTP to the on-file email (never to an address the claimant supplies)."""
        actor, _ = _need(ctx, "otp_send")
        claim_id = _str(ctx.inputs.get("claim_id"))
        if not claim_id:
            raise ValueError("otp_send needs claim_id")
        code = generate_otp()
        subject = "Your Experience.com verification code"
        body = (
            "<p>Someone (hopefully you) asked to claim this profile on Experience.com.</p>"
            f"<p>Your verification code is <strong>{code}</strong>. It expires in "
            f"{OTP_TTL_MINUTES} minutes.</p><p>If this wasn't you, ignore this email — nothing "
            "changes without the code.</p>"
        )
        res = db.rpc(
            "exp_claim_gate_challenge",
            {
                "p_actor": actor,
                "p_claim": claim_id,
                "p_code_hash": otp_hash(claim_id, code),
                "p_subject": subject,
                "p_body_html": body,
                "p_ttl_minutes": OTP_TTL_MINUTES,
            },
            casts={"p_actor": "uuid", "p_claim": "uuid", "p_ttl_minutes": "integer"},
        ) or {}
        return {
            "outputs": {
                "status": res.get("status"),
                "request_id": res.get("request_id"),
                "destination": mask_email(res["destination"]) if res.get("destination") else None,
            }
        }

    def otp_verify(ctx: HandlerContext) -> dict:
        """Verify the code's HMAC (computed by the server function; the code is never logged)."""
        actor, _ = _need(ctx, "otp_verify")
        claim_id = _str(ctx.inputs.get("claim_id"))
        code_hash = _str(ctx.inputs.get("code_hash"))
        if not claim_id or not code_hash:
            raise ValueError("otp_verify needs claim_id and code_hash")
        res = db.rpc(
            "exp_claim_gate_verify_otp",
            {"p_actor": actor, "p_claim": claim_id, "p_code_hash": code_hash},
            casts={"p_actor": "uuid", "p_claim": "uuid"},
        )
        return {"outputs": res}

    def claim_bind(ctx: HandlerContext) -> dict:
        """Bind account ↔ entity at the earned tier (T1+), both sides in one transaction."""
        actor, _ = _need(ctx, "claim_bind")
        claim_id = _str(ctx.inputs.get("claim_id"))
        if not claim_id:
            raise ValueError("claim_bind needs claim_id")
        res = db.rpc(
            "exp_claim_gate_grant",
            {"p_actor": actor, "p_claim": claim_id},
            casts={"p_actor": "uuid", "p_claim": "uuid"},
        )
        return {"outputs": res}

    def claim_unbind(ctx: HandlerContext) -> dict:
        """One-tap unclaim / reset."""
        actor, _ = _need(ctx, "claim_unbind")
        claim_id = _str(ctx.inputs.get("claim_id"))
        if not claim_id:
            raise ValueError("claim_unbind needs claim_id")
        res = db.rpc(
            "exp_claim_gate_release",
            {"p_claim": claim_id, "p_reason": _str(ctx.inputs.get("reason")), "p_actor": actor},
            casts={"p_claim": "uuid", "p_actor": "uuid"},
        )
        return {"outputs": res}

    return {
        "gbp_list_locations": CapabilityHandler(read_only=True, run=_gbp_list_locations),
        "claim_precheck": CapabilityHandler(read_only=True, run=claim_precheck),
        "claim_gate_write": CapabilityHandler(read_only=False, run=claim_gate_write),
        "otp_send": CapabilityHandler(read_only=False, run=otp_send),
        "otp_verify": CapabilityHandler(read_only=False, run=otp_verify),
        "claim_bind": CapabilityHandler(read_only=False, run=claim_bind),
        "claim_unbind": CapabilityHandler(read_only=False, run=claim_unbind),
    }


def _int(x: float) -> int | float:
    """A JS number bound to an int column: integral → int (PostgREST would reject a fraction)."""
    return int(x) if float(x).is_integer() else x

