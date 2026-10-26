"""Adapter onto the NORA integrations stub contract for the organize source layer (port of
lib/nora/organize/integrations.ts).

`with_integration` always returns NotConfigured (no live call, never fabricated data), exactly as
the legacy module did. Oxylabs is not an integration in that registry — it is the ETL's fetch
configuration (OXYLABS_USERNAME / OXYLABS_PASSWORD); `with_oxylabs` applies the same contract:
live only when those env vars are present.
"""
from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

# Default secret reference names (names only, no values).
DEFAULT_REFS: dict[str, list[str]] = {
    "google_business_profile": ["GOOGLE_BP_OAUTH_CLIENT_ID", "GOOGLE_BP_OAUTH_CLIENT_SECRET"],
    "google_places": ["GOOGLE_PLACES_API_KEY"],
    "apify": ["APIFY_API_TOKEN"],
}


def with_integration(key: str, _live: Callable[[dict], Any]) -> dict:
    return {
        "ok": False,
        "status": "not_configured",
        "integration": key,
        "mode": "stub",
        "missing": list(DEFAULT_REFS[key]),
        "reason": f"{key} is not configured — the integrations registry (PR #50) is not on main"
        " yet; no live calls",
    }


def with_oxylabs(live: Callable[[], Any]) -> dict:
    missing = [k for k in ("OXYLABS_USERNAME", "OXYLABS_PASSWORD") if not os.environ.get(k)]
    if missing:
        return {
            "ok": False,
            "status": "not_configured",
            "integration": "oxylabs",
            "mode": "stub",
            "missing": missing,
            "reason": f"Oxylabs is not configured — missing {', '.join(missing)}",
        }
    return {"ok": True, "status": "live", "integration": "oxylabs", "data": live()}
