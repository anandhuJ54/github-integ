"""Cost declarations for the organize source layer (port of lib/nora/organize/costs.ts).

List-rate ESTIMATES (USD per request) — verify against the Oxylabs / Google contracts before
using them for billing. They exist so every handler states what it spent in telemetry.
"""
from __future__ import annotations

import os

from surfaces.nora_os.internal.jsutil import js_round

UNIT_COST_USD = {
    # Oxylabs Web Scraper API, source "universal", no JS render.
    "oxylabs_universal": 0.0015,
    # Oxylabs Web Scraper API with render=html (JS rendering surcharge).
    "oxylabs_render": 0.003,
    # Oxylabs Web Scraper API, source "google_search" parsed.
    "oxylabs_google_search": 0.0018,
    # Google Places Text Search (New) with contact fields (Enterprise SKU).
    "google_places_text_search": 0.035,
}


def _round(n: float) -> float:
    return js_round(n * 1e6) / 1e6


def proxy_forced() -> bool:
    """Same rule as scrape_website: a no-proxy fetch only when FORCE_PROXY is exactly "false"."""
    return os.environ.get("FORCE_PROXY") != "false"


def sum_costs(costs: list[dict]) -> dict:
    by: dict[str, dict] = {}
    for c in costs:
        prev = by.get(c["provider"])
        if prev:
            prev["requests"] += c["requests"]
            prev["est_cost_usd"] = _round(prev["est_cost_usd"] + c["est_cost_usd"])
        else:
            by[c["provider"]] = dict(c)
    lines = list(by.values())
    return {"total_est_cost_usd": _round(sum(c["est_cost_usd"] for c in lines)), "lines": lines}


def scrape_cost(r: dict) -> dict:
    """Cost of one scrape_website call from its result shape."""
    # A successful direct fetch carries no oxylabs block (scrape_website's direct branch).
    # (`!r.oxylabs` in JS: only a missing block counts — an empty object is truthy.)
    direct = r.get("oxylabs") is None and r.get("ok") and r.get("crawl_method") == "direct"
    if direct and not proxy_forced():
        return {"provider": "direct", "requests": 1, "est_cost_usd": 0}
    plain = 1 if r.get("attempted_render_fallback") else (0 if r.get("rendered") else 1)
    rendered = 1 if r.get("rendered") else 0
    return {
        "provider": "oxylabs",
        "requests": plain + rendered,
        "est_cost_usd": _round(
            plain * UNIT_COST_USD["oxylabs_universal"] + rendered * UNIT_COST_USD["oxylabs_render"]
        ),
    }
