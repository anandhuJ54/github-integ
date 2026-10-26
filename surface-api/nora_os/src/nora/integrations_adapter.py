"""Local adapter for the NORA integrations stub contract (port of
lib/nora/integrations-adapter.server.ts).

The legacy module mirrored the integrations-admin interface but ALWAYS took the stub path: a
typed NotConfigured result, never fabricated data. The port keeps that behaviour exactly; wiring
it to `_base.integrations.status` is a behaviour change that needs its own increment.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

INTEGRATION_KEYS = ("google_business_profile", "google_places", "apify")

_NAMES = {
    "google_business_profile": "Google sign-in + Business Profile",
    "google_places": "Google Places API",
    "apify": "Apify",
}


def is_live(_key: str) -> bool:
    return False


def with_integration(key: str, _live: Callable[[dict], Any]) -> dict:
    """Always `{ok: False, status: "not_configured", …}` — the live callback is never run."""
    return {
        "ok": False,
        "status": "not_configured",
        "integration": key,
        "mode": "stub",
        "missing": [],
        "reason": f"{_NAMES[key]} is not configured — integrations admin (PR #50) not merged",
    }
