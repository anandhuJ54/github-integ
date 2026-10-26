"""Claim gate — the pure half (port of lib/nora/claim-gate.ts).

Trust tiers (power scales with proof, not with entry):
  T0 authenticated        — view / preview / sandbox interview. No public changes.
  T1 identity + email     — organize / confirm the graph, set the work agreement.
  T2 ownership proven     — change NAP, publish, alter competitive signals, buy.

Silent-first: score what we already hold (OAuth identity vs the published record, the category
brief's identity keys, a GBP Place ID match) BEFORE asking for anything. Only when that falls
short is ONE explained OTP sent to an on-file channel. A Place ID match on a location the
claimant manages is dispositive → instant T2. Verification keys come from the category brief;
there is no per-category code here. No I/O.
"""
from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from surfaces.nora_os.jsutil import date_ms, now_ms

TIERS = (0, 1, 2)
TIER_LABEL = {
    0: "T0 · authenticated",
    1: "T1 · identity + email verified",
    2: "T2 · ownership proven",
}

# Actions by the minimum tier that unlocks them. Harmful actions sit behind T2.
TIER_ACTIONS: dict[int, tuple[str, ...]] = {
    0: ("view", "preview", "sandbox_interview"),
    1: ("organize_graph", "confirm_facts", "set_work_agreement", "edit_bio", "request_reviews"),
    2: ("change_nap", "publish", "alter_competitive_signals", "purchase", "delegate", "transfer"),
}


def required_tier(action: str) -> int:
    """Minimum tier for an action; unknown actions are treated as harmful (T2)."""
    for t in TIERS:
        if action in TIER_ACTIONS[t]:
            return t
    return 2


def tier_allows(tier: int | None, action: str) -> bool:
    """May a holder of `tier` (None = no binding) perform `action`?"""
    if tier is None:
        return False
    return tier >= required_tier(action)


def advance_tier(current: int, proposed: float) -> int:
    """Tiers only ever go up inside one claim; out-of-range proposals are refused."""
    if isinstance(proposed, bool) or not float(proposed).is_integer() or not 0 <= proposed <= 2:
        raise ValueError(f"invalid trust tier {proposed}")
    return max(current, int(proposed))


# ───────── Record + claimant shapes ─────────


@dataclass
class ClaimRecord:
    """The published record (professionals / organizations row), normalised.

    `office` is set only for a single-pro office: {mode, professionalId, locationId,
    placeIdSource}; the record then IS the professional and `place_id` is the location's.
    """

    record_type: str
    id: str
    name: str | None
    email: str | None
    website_url: str | None
    telephone: str | None
    license_number: str | None
    place_id: str | None
    claimed: bool
    owner_user_id: str | None
    active: bool
    office: dict | None = None


@dataclass
class Claimant:
    user_id: str
    email: str | None
    # True when the OAuth provider asserts the email.
    email_verified: bool
    name: str | None


@dataclass
class ExistingClaim:
    user_id: str
    status: str
    trust_tier: int


@dataclass
class BriefClaim:
    """Category brief view of this entity type: claimable, and the identity keys (dicts with
    key / label / schemaProperty / source)."""

    claimable: bool
    keys: list[dict] = field(default_factory=list)


GENERIC_EMAIL_DOMAINS = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "yahoo.com",
        "outlook.com",
        "hotmail.com",
        "icloud.com",
        "me.com",
        "aol.com",
        "proton.me",
        "protonmail.com",
        "live.com",
        "msn.com",
    }
)


def normalize_name(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def email_domain(email: str | None) -> str:
    e = (email or "").strip().lower()
    at = e.rfind("@")
    return "" if at == -1 else e[at + 1 :]


def website_host(url: str | None) -> str:
    if not url:
        return ""
    try:
        full = url if re.match(r"^https?://", url, re.IGNORECASE) else f"https://{url}"
        host = urlsplit(full).hostname or ""
    except ValueError:
        return ""
    return re.sub(r"^www\.", "", host).lower()


def domain_matches(email_dom: str, host: str) -> bool:
    """a@b.com is a domain match for b.com and for any subdomain of it (agents.b.com)."""
    if not email_dom or not host:
        return False
    return host == email_dom or host.endswith(f".{email_dom}") or email_dom.endswith(f".{host}")


def names_match(a: str | None, b: str | None) -> bool:
    x = normalize_name(a)
    y = normalize_name(b)
    return len(x) > 2 and len(y) > 2 and (x == y or y in x or x in y)


def normalize_key(s: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def mask_email(email: str | None) -> str:
    e = (email or "").strip()
    at = e.find("@")
    if at < 1:
        return ""
    return f"{e[0]}{'•' * max(1, min(6, at - 1))}{e[at:]}"


# Brief identity key (by schema.org property) → which record field verifies it.
KEY_FIELD: dict[str, str] = {
    "name": "name",
    "email": "email",
    "url": "websiteUrl",
    "telephone": "telephone",
    "hasCredential.identifier": "licenseNumber",
    "identifier": "licenseNumber",
}
# TS ClaimRecord field name → Python attribute.
_RECORD_ATTR = {
    "name": "name",
    "email": "email",
    "websiteUrl": "website_url",
    "telephone": "telephone",
    "licenseNumber": "license_number",
}


def key_field(k: dict) -> str | None:
    return KEY_FIELD.get(k.get("schemaProperty") or "") or KEY_FIELD.get(k.get("key") or "")


def brief_wants_credential(brief: BriefClaim | None) -> bool:
    """Does the brief ask for a credential id (licence number) as a verification key?"""
    return bool(brief) and any(key_field(k) == "licenseNumber" for k in brief.keys)


# ───────── Refusals ─────────

REFUSAL_MESSAGE = {
    "record_not_found": "Profile not found.",
    "record_inactive": "This profile is not active.",
    "not_claimable": "This profile type cannot be claimed for its category.",
    "already_owner": "You already own this profile.",
    "claimed_by_other": "This profile has already been claimed.",
}


def claim_refusal(
    record: ClaimRecord | None,
    claimant_user_id: str,
    existing: list[ExistingClaim],
    brief: BriefClaim | None,
) -> str | None:
    """Should the claim be refused before any scoring? Never accuses — just stops."""
    if not record:
        return "record_not_found"
    if not record.active:
        return "record_inactive"
    if brief and not brief.claimable:
        return "not_claimable"
    verified = [c for c in existing if c.status == "verified"]
    if any(c.user_id == claimant_user_id for c in verified):
        return "already_owner"
    if record.claimed and record.owner_user_id == claimant_user_id:
        return "already_owner"
    if verified or record.claimed:
        return "claimed_by_other"
    return None


# ───────── Silent precheck ─────────

# Weights mirror the pre-gate submitClaim scoring so the queue's confidence stays comparable.
WEIGHTS = {"email_domain": 35, "email_exact": 15, "name": 35, "license": 30, "place_id": 100}


def score_precheck(
    *,
    record: ClaimRecord,
    claimant: Claimant,
    brief: BriefClaim | None,
    managed: dict | None,
    license_number: str | None = None,
) -> dict:
    """Score the signals already held and derive the silent tier.

    T2 — a Place ID the claimant manages (GBP) equals the record's Place ID (dispositive).
    T1 — name match AND either the verified OAuth email equals the on-file email, or a
         non-generic email domain matches the record's website domain AND (when the brief asks
         for a credential id) the licence number matches.
    T0 — otherwise. `managed` is {"placeIds": [...]} or None (integration not live).
    Returns {confidence, signals, tier, path, uncheckable}.
    """
    signals: dict[str, dict] = {}
    score = 0
    uncheckable: list[str] = []

    user_dom = email_domain(claimant.email)
    generic = user_dom in GENERIC_EMAIL_DOMAINS
    host = website_host(record.website_url)
    rec_dom = email_domain(record.email)
    domain_match = bool(user_dom) and not generic and (
        user_dom == rec_dom or domain_matches(user_dom, host)
    )
    signals["email_domain"] = {
        "matched": domain_match,
        "weight": WEIGHTS["email_domain"],
        "detail": f"@{user_dom}" if user_dom else "",
    }
    if domain_match:
        score += WEIGHTS["email_domain"]

    exact = (
        bool(record.email)
        and bool(claimant.email)
        and claimant.email_verified
        and claimant.email.strip().lower() == record.email.strip().lower()
    )
    signals["email_exact"] = {"matched": exact, "weight": WEIGHTS["email_exact"]}
    if exact:
        score += WEIGHTS["email_exact"]

    name_ok = names_match(claimant.name, record.name)
    signals["name"] = {"matched": name_ok, "weight": WEIGHTS["name"]}
    if name_ok:
        score += WEIGHTS["name"]

    wants_credential = brief_wants_credential(brief)
    lic = normalize_key(license_number)
    rec_lic = normalize_key(record.license_number)
    lic_ok = len(lic) > 0 and len(rec_lic) > 0 and lic == rec_lic
    signals["license"] = {
        "matched": lic_ok,
        "weight": WEIGHTS["license"],
        "detail": "provided" if lic else "none",
    }
    if lic_ok:
        score += WEIGHTS["license"]
    if wants_credential and not rec_lic:
        uncheckable.append("licenseNumber")

    for k in brief.keys if brief else []:
        f = key_field(k)
        if f and f not in ("licenseNumber", "name") and not getattr(record, _RECORD_ATTR[f]):
            uncheckable.append(f)

    place_ids = (managed or {}).get("placeIds") or []
    place_ok = bool(managed) and bool(record.place_id) and any(
        p and p == record.place_id for p in place_ids
    )
    office_src = (record.office or {}).get("placeIdSource")
    signals["place_id"] = {
        "matched": place_ok,
        "weight": WEIGHTS["place_id"],
        "detail": (f"{len(place_ids)} managed" if managed else "not_configured")
        + (f" · place id from {office_src}" if office_src else ""),
    }

    tier, path = 0, "none"
    if place_ok:
        tier, path = 2, "gbp_place_id"
    elif name_ok and exact:
        tier, path = 1, "email_exact"
    elif name_ok and domain_match and (not wants_credential or lic_ok):
        tier, path = 1, "domain_identity"
    confidence = 100 if place_ok else min(100, score)
    return {
        "confidence": confidence,
        "signals": signals,
        "tier": tier,
        "path": path,
        "uncheckable": list(dict.fromkeys(uncheckable)),
    }


# ───────── Next step ─────────


def decide_next(
    *,
    tier: int,
    confidence: float,
    record_email: str | None,
    transport_ready: bool,
    challenge_issued: bool,
    license_provided: bool,
    brief_wants_credential: bool,
    record_has_license: bool,
) -> str:
    """OTP is offered ONCE per claim, only when the silent check fell short and an on-file email
    exists and transport is live."""
    if tier >= 1:
        return "grant"
    if record_email and transport_ready and not challenge_issued:
        return "challenge"
    if brief_wants_credential and record_has_license and not license_provided and confidence >= 50:
        return "license"
    return "manual_review"


def queue_status(nxt: str) -> str:
    """claim_queue.status for a gate state (values allowed by claim_queue_status_check)."""
    return {
        "granted": "auto_approved",
        "released": "released",
        "rejected": "rejected",
        "manual_review": "manual_review",
    }.get(nxt, "pending")


def ui_status(nxt: str) -> str:
    """The submitClaim response status the claim page already renders."""
    if nxt in ("granted", "grant", "already_owner"):
        return "approved"
    if nxt in ("challenge", "license"):
        return "needs_verification"
    if nxt == "claimed_by_other":
        return "already_claimed"
    return "manual_review"


# ───────── OTP ─────────

OTP_TTL_MINUTES = 15
OTP_MAX_ATTEMPTS = 5


def otp_outcome(
    *, challenge: dict | None, matches: bool, now: _dt.datetime | None = None
) -> str:
    """Pure mirror of exp_claim_gate_verify_otp. `challenge` = {status, expiresAt, attempts}."""
    if not challenge or challenge.get("status") != "sent":
        return "none"
    exp = date_ms(challenge.get("expiresAt"))
    now_t = now.timestamp() * 1000 if now else now_ms()
    # `new Date(NaN) <= now` is false in JS, so an unparseable expiry never reads as expired.
    if exp is not None and exp <= now_t:
        return "expired"
    if challenge.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        return "locked"
    return "verified" if matches else "mismatch"


def as_json(v: Any) -> Any:
    """ClaimRecord → the TS JSON shape (camelCase), for outputs."""
    if isinstance(v, ClaimRecord):
        return {
            "recordType": v.record_type,
            "id": v.id,
            "name": v.name,
            "email": v.email,
            "websiteUrl": v.website_url,
            "telephone": v.telephone,
            "licenseNumber": v.license_number,
            "placeId": v.place_id,
            "claimed": v.claimed,
            "ownerUserId": v.owner_user_id,
            "active": v.active,
            **({"office": v.office} if v.office is not None else {}),
        }
    return v
