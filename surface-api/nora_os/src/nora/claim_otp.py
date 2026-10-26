"""Claim OTP primitives (server only; port of lib/nora/claim-otp.server.ts).

The stored / logged value is an HMAC keyed by a server secret and bound to the claim, so
exp_verification_requests / exp_skill_run never reveal the code.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets


def otp_secret() -> str:
    s = os.environ.get("CLAIM_OTP_SECRET") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not s:
        raise RuntimeError("claim OTP secret missing (CLAIM_OTP_SECRET / service role key)")
    return s


def otp_hash(claim_id: str, code: str, secret: str | None = None) -> str:
    """hex HMAC-SHA256 of `${claimId}:${code.trim()}` — identical to the TS createHmac."""
    key = (secret if secret is not None else otp_secret()).encode("utf-8")
    msg = f"{claim_id}:{code.strip()}".encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def generate_otp() -> str:
    """Six digits, uniformly random (crypto.randomInt(0, 1_000_000))."""
    return str(secrets.randbelow(1_000_000)).zfill(6)
