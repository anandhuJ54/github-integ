"""robots.txt and the X-Robots-Tag helper for the site-wide indexing switch.

Port of the indexing parts of legacy `lib/index-floor.ts` and `lib/sitemap.server.ts`.
The switch is read by `surfaces.search.site_indexing` (`exp_index_enabled()`, SECURITY DEFINER,
anon-callable); it defaults OFF and any failure reads as OFF. Nothing here ever writes it.
Moved from the srp Surface, which had its own copy of the flag reader (surface audit
2026-10-25).
"""
from __future__ import annotations

from typing import Any

from surfaces.search.site_indexing import load_site_indexing_enabled

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
