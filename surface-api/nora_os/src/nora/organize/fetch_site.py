"""fetch_site / hop2 — fetch through the shared fetch layer (`scrape_website`: Oxylabs with
render fallback + looks_blocked; a plain fetch only for crawl_method "direct" when
FORCE_PROXY=false) and parse with parse_candidate_facts (port of lib/nora/organize/fetch-site.ts).
Read-only toward our DB.
"""
from __future__ import annotations

import concurrent.futures
import re
from typing import Any

from surfaces.nora_os.internal import disco
from surfaces.nora_os.internal.jsutil import iso_now, message
from surfaces.nora_os.nora.organize.costs import scrape_cost
from surfaces.nora_os.nora.organize.parse import parse_candidate_facts

CRAWL_METHODS = ("server_crawl", "needs_proxy", "needs_js_api", "direct")

# Pages one hop2 call follows at most (each is a paid fetch through Oxylabs by default).
HOP2_CAP = 4


def fetch_site(url: str, *, crawl_method: str | None = None, entity_name: str | None = None) -> dict:
    r = disco.scrape_website({"url": url, "crawl_method": crawl_method or "direct"})
    cost = scrape_cost(r)
    facts = (
        parse_candidate_facts(
            r["content"],
            source_url=url,
            resolved_url=r.get("resolved_url"),
            fetched_at=iso_now(),
            entity_name=entity_name,
            status_code=r.get("status_code"),
        )
        if r.get("content")
        else None
    )
    return {
        "ok": r.get("ok"),
        "status_code": r.get("status_code"),
        "rendered": r.get("rendered"),
        "error": r.get("error"),
        "facts": facts,
        "cost": cost,
    }


def owned_urls(raw: Any) -> list[str]:
    """Normalises hop2 input: OwnedCandidate objects or bare URL strings."""
    out: list[str] = []
    for x in raw if isinstance(raw, list) else []:
        u = x if isinstance(x, str) else (x.get("url") if isinstance(x, dict) else None)
        if isinstance(u, str) and re.match(r"^https?://", u, re.IGNORECASE) and u not in out:
            out.append(u)
    return out


def hop2(
    candidates: list,
    *,
    crawl_method: str | None = None,
    entity_name: str | None = None,
    cap: int | None = None,
) -> dict:
    """One hop to the entity's other owned properties, same fetch + parse."""
    urls = owned_urls(candidates)
    n = cap if cap is not None else HOP2_CAP
    take = urls[:n]

    def one(url: str) -> dict:
        try:
            return {"url": url, **fetch_site(url, crawl_method=crawl_method, entity_name=entity_name)}
        except Exception as exc:  # noqa: BLE001
            return {
                "url": url,
                "ok": False,
                "status_code": None,
                "rendered": False,
                "error": message(exc),
                "facts": None,
                "cost": {"provider": "oxylabs", "requests": 0, "est_cost_usd": 0},
            }

    if not take:
        return {"pages": [], "skipped": urls[n:]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(take)) as pool:
        pages = list(pool.map(one, take))
    return {"pages": pages, "skipped": urls[n:]}
