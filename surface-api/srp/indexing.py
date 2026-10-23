"""Site-wide indexing switch, robots.txt and the X-Robots-Tag helper.

Port of the indexing parts of legacy `lib/index-floor.ts` and `lib/sitemap.server.ts`.
The switch is read through `exp_index_enabled()` (SECURITY DEFINER, anon-callable); it
defaults OFF and any failure reads as OFF. Nothing here ever writes the switch.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from _base.core.db import role_connection

log = logging.getLogger(__name__)

# exp_index_config key read by exp_index_enabled(); seeded 'false' by migration 0024.
SITE_INDEXING_KEY = "site_indexing_enabled"
SITE_NOINDEX = "noindex,nofollow"

# URL prefixes served by the signed-in console (kept in sync with legacy index-floor.ts).
CONSOLE_PATH_PREFIXES: tuple[str, ...] = (
    "accounts",
    "admin",
    "billing",
    "build",
    "categories",
    "claim",
    "claims",
    "compliance",
    "console",
    "control-graph",
    "dashboard",
    "dev",
    "discovery",
    "emp",
    "enterprise",
    "nora-os",
    "organizations",
    "products",
    "professionals",
    "reports",
    "sales",
    "search",
    "seat",
    "support",
    "website",
)


def parse_indexing_enabled(value: Any) -> bool:
    """Same rule as exp_index_enabled(): only the literal 'true' turns indexing on."""
    if value is True:
        return True
    return isinstance(value, str) and value.strip().lower() == "true"


def site_robots_meta(enabled: bool) -> dict | None:
    """Site-wide robots meta: OFF → noindex,nofollow; ON → nothing (per-page rules decide)."""
    return None if enabled else {"name": "robots", "content": SITE_NOINDEX}


def robots_header_for(enabled: bool) -> str | None:
    """X-Robots-Tag value while indexing is OFF (legacy `siteRobotsHeader`)."""
    return None if enabled else "noindex, nofollow"


def robots_txt(origin: str, enabled: bool = False) -> str:
    """robots.txt body. OFF: disallow everything, no Sitemap line. ON: sitemap index."""
    if not enabled:
        return "User-agent: *\nDisallow: /\n"
    console_rules = [r for p in CONSOLE_PATH_PREFIXES for r in (f"Disallow: /{p}$", f"Disallow: /{p}/")]
    return "\n".join(
        [
            "User-agent: *",
            "Allow: /api/public/sitemap.xml",
            "Allow: /api/public/sitemap/",
            "Disallow: /api/",
            *console_rules,
            "",
            f"Sitemap: {origin}/api/public/sitemap.xml",
            "",
        ]
    )


# --- the switch (cached per process for 60s, like the legacy server instance) ---------------

_SWITCH_TTL_S = 60.0
_switch_cache: dict[str, float | bool] | None = None


def reset_site_indexing_cache() -> None:
    """Drop the cached value on this process (after a super admin flips the switch)."""
    global _switch_cache
    _switch_cache = None


def load_site_indexing_enabled() -> bool:
    """exp_index_enabled() as the anon role. Cached 60s. Any error → OFF."""
    global _switch_cache
    now = time.monotonic()
    if _switch_cache is not None and now - float(_switch_cache["at"]) < _SWITCH_TTL_S:
        return bool(_switch_cache["value"])
    value = False
    try:
        with role_connection("anon") as conn:
            row = conn.execute("select public.exp_index_enabled() as enabled").fetchone()
        value = parse_indexing_enabled(row["enabled"] if row else None)
    except Exception as exc:  # noqa: BLE001 — any failure reads as OFF (legacy behaviour)
        log.warning("exp_index_enabled read failed, treating as OFF: %s", type(exc).__name__)
        value = False
    _switch_cache = {"value": value, "at": now}
    return value


def site_robots_header(enabled: bool | None = None) -> str | None:
    """X-Robots-Tag for any response (legacy `server.ts` withSiteRobotsHeader).

    Pass `enabled` when already known; otherwise the switch is read (cached) and any failure
    keeps "noindex, nofollow". Returns None when indexing is ON (no header to set).
    """
    if enabled is None:
        try:
            enabled = load_site_indexing_enabled()
        except Exception:  # noqa: BLE001 — keep noindex
            enabled = False
    return robots_header_for(enabled)


def apply_site_robots_header(response: Any, enabled: bool | None = None) -> Any:
    """Set X-Robots-Tag on a Starlette/FastAPI response when indexing is OFF; returns it."""
    header = site_robots_header(enabled)
    if header:
        response.headers["X-Robots-Tag"] = header
    return response
