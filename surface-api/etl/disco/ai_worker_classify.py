"""§2 classify_method — how a site's pages can be fetched (port of `disco-ai-worker.ts`).

Tier 1 direct fetch, tier 2 proxy, tier 3 rendered retry (only to rescue a js_needs_api
conclusion). One roster-style link is followed when the homepage exposes one; genuinely
ambiguous pages are judged by the model from a markup excerpt.
"""
from __future__ import annotations

from typing import Any

from etl.disco import ai_worker_links as lk
from etl.disco import ai_worker_util as u
from etl.disco.ai_worker_tools import METHOD_TOOL, ROSTER_LINK_TOOL


def get_dynamic_roster_hints(db: u.Db, gcid: str) -> list[str]:
    """Category-driven roster phrases from exp_taxonomy profession titles ([] on any error)."""
    if not gcid:
        return []
    try:
        rows = db.rows_or_none(
            "select term_display from exp_taxonomy "
            "where gcid = %s and level = %s and is_active = true",
            (gcid, "profession_title"),
        )
        if rows is None:
            return []
        out: dict[str, None] = {}
        for row in rows:
            term = str(row.get("term_display") or "").strip().lower()
            if not term:
                continue
            for h in (term, f"find a {term}", f"find your {term}", f"our {term}s",
                      f"meet our {term}s", f"{term} directory"):
                out[h] = None
        return list(out)
    except Exception:  # noqa: BLE001
        return []


def pick_roster_link_with_llm(
    api_key: str,
    model: str,
    category: str,
    boundary: dict | None,
    links: list[dict],
    temperature: float | None = None,
) -> str | None:
    """LLM escalation — only called when the deterministic hint match fails."""
    b = boundary if isinstance(boundary, dict) else {}
    boundary_block = ""
    if b.get("definition"):
        boundary_block = f"CATEGORY BOUNDARY:\n{b['definition']}\n"
        if b.get("includes"):
            boundary_block += f"Includes: {'; '.join(u.js_str(x) for x in b['includes'])}\n"
    lst = "\n".join(f"{i}. {lnk['text']} — {lnk['href']}" for i, lnk in enumerate(links))
    inp = u.call_claude(
        api_key,
        model,
        f'Category: "{category}".\n'
        + boundary_block
        + "\nBelow is a numbered list of links from a company's website. Which numbered link, "
        "if any, "
        "leads to a directory/roster of this category's professionals or locations? "
        f"Answer via the pick_roster_link tool (found=false if none).\n\n{lst}",
        ROSTER_LINK_TOOL,
        256,
        temperature,
    )
    if (inp or {}).get("found") is not True:
        return None
    idx = u.num(inp.get("index"))
    if not u.finite(idx) or idx != int(idx) or idx < 0 or idx >= len(links):
        return None
    return links[int(idx)]["href"]


def classify_method(
    api_key: str, model: str, domain: str, category: str, boundary: dict | None
) -> dict:
    """{method, evidence, fetch_tier}."""
    url = f"https://{domain}/"
    tier: str | None = None
    home: dict | None = None

    # Tier 1 — always attempt a genuine direct fetch first.
    direct = u.fetch_page(url, "direct")
    if (
        not direct.get("networkError") and direct["ok"] and not u.looks_bot_blocked(direct)
        and not lk.is_js_shell(direct["body"]) and lk.has_entity_data(direct["body"])
    ):
        home = direct
        tier = "direct"

    # Tier 2 — proxy. A direct-only failure proves nothing about the site itself.
    if not home:
        via_proxy = u.fetch_page(url, "server_crawl")
        tier = "proxy"
        if via_proxy.get("networkError"):
            return {"method": "unreachable",
                    "evidence": f"fetch failed: {via_proxy['networkError'][:200]}",
                    "fetch_tier": None}
        if u.looks_bot_blocked(via_proxy):
            return {"method": "blocked_needs_proxy",
                    "evidence": f"homepage returned {via_proxy['status']} / anti-bot challenge — "
                                "needs proxy IP rotation",
                    "fetch_tier": None}
        if via_proxy["status"] >= 500:
            return {"method": "unreachable", "evidence": f"homepage returned {via_proxy['status']}",
                    "fetch_tier": None}
        if not via_proxy["ok"]:
            return {"method": "unreachable", "evidence": f"homepage returned {via_proxy['status']}",
                    "fetch_tier": None}
        home = via_proxy

    # Tier 3 — rendered retry, only used to rescue a js_needs_api conclusion.
    def render_rescue(probe_url: str, fallback_evidence: str) -> dict:
        rendered = u.fetch_page(probe_url, "needs_js_api")
        if not rendered.get("networkError") and rendered["ok"] and lk.has_entity_data(
            rendered["body"]
        ):
            return {"method": "server_crawl",
                    "evidence": f"{fallback_evidence} — but rendered fetch returned entity data; "
                                "crawlable with rendering",
                    "fetch_tier": "proxy_render"}
        return {"method": "js_needs_api", "evidence": fallback_evidence, "fetch_tier": None}

    # Follow one roster-style link when the homepage exposes one.
    probe = home
    probe_label = "homepage"
    extra_hints = get_dynamic_roster_hints(u.db(), category)
    roster = lk.find_roster_link(home["body"], home["url"], extra_hints)
    if not roster:
        links = lk.extract_all_links(home["body"], home["url"])
        if links:
            roster = pick_roster_link_with_llm(api_key, model, category, boundary, links)
    if roster:
        r = u.fetch_page(roster, "server_crawl")
        if r.get("networkError"):
            return {"method": "unreachable", "evidence": f"roster {roster} fetch failed",
                    "fetch_tier": None}
        if u.looks_bot_blocked(r):
            return {"method": "blocked_needs_proxy",
                    "evidence": f"roster page {roster} returned {r['status']} / anti-bot — needs "
                                "proxy IP rotation",
                    "fetch_tier": None}
        if r["ok"]:
            probe = r
            probe_label = f"roster {roster}"

    if lk.is_js_shell(probe["body"]):
        return render_rescue(
            probe["url"], f"{probe_label} is an empty JS shell — data loads via XHR; needs data API"
        )
    if lk.has_entity_data(probe["body"]):
        return {"method": "server_crawl",
                "evidence": f"{probe_label} is server-rendered with entity data in raw HTML",
                "fetch_tier": tier}

    # Genuinely ambiguous — let the model judge from a markup excerpt.
    inp: Any = u.call_claude(
        api_key,
        model,
        "Decide whether this raw HTML (fetched server-side, no JavaScript executed) already "
        "contains real entity data "
        "(person/office names, JSON-LD, embedded state), or whether it is an empty shell whose "
        "data loads over XHR.\n"
        'Answer "server_crawl" or "needs_js_api" via the return_render_mode tool.\n\n'
        f"URL: {probe['url']}\n\nHTML (truncated):\n{probe['body'][:12000]}",
        METHOD_TOOL,
        512,
    )
    ev = (inp or {}).get("evidence")
    evidence = f"model judgement on {probe_label}: {u.js_str(ev if ev is not None else '')[:300]}"
    if (inp or {}).get("method") == "needs_js_api":
        return render_rescue(probe["url"], evidence)
    return {"method": "server_crawl", "evidence": evidence, "fetch_tier": tier}
