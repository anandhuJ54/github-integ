"""Integration registry and pure status derivation (port of `lib/integrations.ts`).

No secret values here — only default secret reference NAMES, scopes and setting keys. The dict
shapes keep the TS keys (`defaultRef`, `redirectPath`, …) so they serialise identically.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

INTEGRATIONS: dict[str, dict[str, Any]] = {
    "google_business_profile": {
        "key": "google_business_profile",
        "name": "Google sign-in + Business Profile",
        "purpose": "End-user OAuth for profile owners claiming their listing (NORA claim gate).",
        "secrets": [
            {"id": "clientId", "label": "OAuth web client ID",
             "defaultRef": "GOOGLE_BP_OAUTH_CLIENT_ID"},
            {"id": "clientSecret", "label": "OAuth web client secret",
             "defaultRef": "GOOGLE_BP_OAUTH_CLIENT_SECRET"},
        ],
        "settings": [],
        "scopes": ["openid", "email", "profile", "https://www.googleapis.com/auth/business.manage"],
        "redirectPath": "/api/public/google-business-oauth-callback",
    },
    "google_places": {
        "key": "google_places",
        "name": "Google Places API",
        "purpose": "Place ID lookup and match for listings.",
        "secrets": [{"id": "apiKey", "label": "Places API key",
                     "defaultRef": "GOOGLE_PLACES_API_KEY"}],
        "settings": [],
    },
    "apify": {
        "key": "apify",
        "name": "Apify",
        "purpose": "Competitive data: map-rank 7x7 grid and LLM-citation monitor actors.",
        "secrets": [{"id": "apiToken", "label": "Apify API token", "defaultRef": "APIFY_API_TOKEN"}],
        "settings": [
            {"id": "mapRankActorId", "label": "Map-rank 7x7 grid actor ID",
             "help": "~$0.05 per run"},
            {"id": "llmCitationActorId", "label": "LLM-citation monitor actor ID"},
        ],
        "costNote": "Map-rank 7x7 grid ≈ $0.05 per run.",
    },
}

INTEGRATION_KEYS: list[str] = list(INTEGRATIONS)
SECRET_REF_PATTERN = re.compile(r"^[A-Z_][A-Z0-9_]*$")

INTEGRATION_STATUS_LABEL: dict[str, str] = {
    "not_configured": "Not configured",
    "configured_stub": "Configured · stub",
    "live": "Live",
}


def derive_integration_status(
    key: str,
    *,
    mode: str,
    refs: dict[str, str],
    settings: dict[str, str],
    persisted: bool,
    has_secret: Callable[[str], bool],
) -> dict[str, Any]:
    """Live only when every secret + setting is present AND a super admin switched mode to live."""
    d = INTEGRATIONS[key]
    secrets: dict[str, bool] = {}
    missing: list[str] = []
    for s in d["secrets"]:
        ref = refs[s["id"]] if refs.get(s["id"]) is not None else s["defaultRef"]
        secrets[s["id"]] = has_secret(ref)
        if not secrets[s["id"]]:
            missing.append(ref)
    for s in d["settings"]:
        if not str(settings.get(s["id"]) or "").strip():
            missing.append(s["id"])
    ready = not missing
    if not ready:
        status = "not_configured"
    elif mode == "live" and persisted:
        status = "live"
    else:
        status = "configured_stub"
    return {
        "key": key,
        "status": status,
        "mode": mode,
        "refs": {
            s["id"]: refs[s["id"]] if refs.get(s["id"]) is not None else s["defaultRef"]
            for s in d["secrets"]
        },
        "secrets": secrets,
        "settings": settings,
        "missing": missing,
        "persisted": persisted,
    }


def not_configured(s: dict[str, Any]) -> dict[str, Any]:
    """Typed stub result: NORA returns this instead of fabricating data."""
    name = INTEGRATIONS[s["key"]]["name"]
    if s["status"] == "configured_stub":
        reason = f"{name} is configured but still in stub mode — no live calls"
    else:
        reason = f"{name} is not configured — missing {', '.join(s['missing'])}"
    return {
        "ok": False,
        "status": "not_configured",
        "integration": s["key"],
        "mode": "stub",
        "missing": s["missing"],
        "reason": reason,
    }
