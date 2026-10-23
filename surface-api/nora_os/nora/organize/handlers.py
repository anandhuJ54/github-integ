"""Capability handlers for interview step 2 "organize the internet" — source layer (port of
lib/nora/organize/handlers.ts), keyed by exp_capability_registry keys:

  page_fetch   → fetch_site(url)                  (Oxylabs via scrape_website; cost declared)
  source_crawl → hop2(owned candidates)           (one hop, same fetch + parse)
  serp_fetch   → web_sweep(category, name, geo)   (Oxylabs google_search; stub when unconfigured)
  geocode      → gbp_lookup(name, address)        (Google Places; stub until integrations land)

All are read-only toward our DB (the only DB read is gbp_categories.display_name) and the
registry lists none with side effects, so the runner's dry-run rule lets them fetch in a dry
run. Every output carries telemetry: {mode, total_est_cost_usd, lines}.
"""
from __future__ import annotations

from typing import Any

from nora_os.db import Db
from nora_os.jsutil import nz
from nora_os.nora.organize.costs import sum_costs
from nora_os.nora.organize.fetch_site import CRAWL_METHODS, fetch_site, hop2, owned_urls
from nora_os.nora.organize.gbp import gbp_lookup
from nora_os.nora.organize.web_sweep import web_sweep
from nora_os.runner import CapabilityHandler, HandlerContext, HandlerRegistry


def _str(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


def _crawl(v: Any) -> str | None:
    return v if v in CRAWL_METHODS else None


def prior_facts(prior: dict[str, Any]) -> list[dict]:
    """CandidateFacts from earlier capabilities in this run (page_fetch first, then hop2 pages)."""
    out: list[dict] = []
    pf = (prior.get("page_fetch") or {}).get("facts")
    if pf:
        out.append(pf)
    for p in (prior.get("source_crawl") or {}).get("pages") or []:
        if p.get("facts"):
            out.append(p["facts"])
    return out


def _telemetry(ctx: HandlerContext, costs: list[dict]) -> dict:
    return {"mode": ctx.mode, **sum_costs(costs)}


def _entity_name(ctx: HandlerContext) -> str | None:
    return ctx.entity.name if ctx.entity and ctx.entity.name is not None else None


def organize_handlers(db: Db | None) -> HandlerRegistry:
    def page_fetch(ctx: HandlerContext) -> dict:
        url = _str(ctx.inputs.get("url")) or _str(ctx.inputs.get("site_url"))
        if not url:
            raise ValueError("page_fetch needs inputs.url")
        r = fetch_site(
            url,
            crawl_method=_crawl(ctx.inputs.get("crawl_method")),
            entity_name=nz(_entity_name(ctx), _str(ctx.inputs.get("entity_name"))),
        )
        return {
            "outputs": {
                "url": url,
                "ok": r["ok"],
                "status_code": r["status_code"],
                "rendered": r["rendered"],
                "error": r["error"],
                "facts": r["facts"],
                "telemetry": _telemetry(ctx, [r["cost"]]),
            }
        }

    def source_crawl(ctx: HandlerContext) -> dict:
        given = owned_urls(ctx.inputs.get("owned_candidates"))
        from_prior = [
            o["url"] for f in prior_facts(ctx.prior) for o in f["links"]["ownedCandidates"]
        ]
        candidates = given if given else from_prior
        r = hop2(
            candidates,
            crawl_method=_crawl(ctx.inputs.get("crawl_method")),
            entity_name=nz(_entity_name(ctx), _str(ctx.inputs.get("entity_name"))),
        )
        return {
            "outputs": {
                "followed": len(r["pages"]),
                "skipped": r["skipped"],
                "pages": [{k: v for k, v in p.items() if k != "cost"} for p in r["pages"]],
                "telemetry": _telemetry(ctx, [p["cost"] for p in r["pages"]]),
            }
        }

    def serp_fetch(ctx: HandlerContext) -> dict:
        facts = prior_facts(ctx.prior)
        entity_name = nz(
            _str(ctx.inputs.get("entity_name")),
            _entity_name(ctx),
            facts[0]["nap"].get("name") if facts else None,
        )
        if not entity_name:
            raise ValueError("serp_fetch needs an entity name")
        category_name = _str(ctx.inputs.get("category_name"))
        if not category_name and ctx.entity and ctx.entity.gcid:
            # The TS ignored this read's error (`const { data } = …`).
            try:
                row = db.maybe_one(
                    "select display_name from gbp_categories where gcid = %s",
                    (ctx.entity.gcid,),
                    what="gbp_categories",
                ) if db is not None else None
            except Exception:  # noqa: BLE001
                row = None
            category_name = _str((row or {}).get("display_name"))
        nap = facts[0]["nap"] if facts else None
        addr = (nap or {}).get("address") or {}
        geo = nz(
            _str(ctx.inputs.get("geo")),
            ctx.entity.market if ctx.entity else None,
            ", ".join(x for x in (addr.get("addressLocality"), addr.get("addressRegion")) if x)
            or None,
        )
        known: list[str] = []
        for f in facts:
            known.append(f["source_url"])
            known.extend(s["url"] for s in f["sameAs"])
            known.extend(o["url"] for o in f["links"]["ownedCandidates"])
        r = web_sweep(
            {
                "categoryName": category_name,
                "entityName": entity_name,
                "geo": geo,
                "siteUrl": nz(_str(ctx.inputs.get("url")), facts[0]["source_url"] if facts else None),
                "phone": (nap or {}).get("phone"),
                "knownUrls": known,
            }
        )
        if not r["ok"]:
            return {"outputs": {**r, "telemetry": _telemetry(ctx, [])}}
        data = dict(r["data"])
        cost = data.pop("cost")
        return {"outputs": {"status": "live", **data, "telemetry": _telemetry(ctx, [cost])}}

    def geocode(ctx: HandlerContext) -> dict:
        facts = prior_facts(ctx.prior)
        nap = next((f["nap"] for f in facts if f["nap"].get("name")), None)
        name = nz(_str(ctx.inputs.get("entity_name")), _entity_name(ctx), (nap or {}).get("name"))
        if not name:
            raise ValueError("geocode needs an entity name")
        r = gbp_lookup(
            {
                "name": name,
                "address": nz(
                    _str(ctx.inputs.get("address")), ((nap or {}).get("address") or {}).get("text")
                ),
                "phone": nz(_str(ctx.inputs.get("phone")), (nap or {}).get("phone")),
                "placeId": nz(
                    _str(ctx.inputs.get("place_id")),
                    next((f["place_id"] for f in facts if f.get("place_id")), None),
                ),
            }
        )
        if not r["ok"]:
            return {"outputs": {**r, "telemetry": _telemetry(ctx, [])}}
        data = dict(r["data"])
        cost = data.pop("cost")
        return {"outputs": {"status": "live", **data, "telemetry": _telemetry(ctx, [cost])}}

    return {
        "page_fetch": CapabilityHandler(read_only=True, run=page_fetch),
        "source_crawl": CapabilityHandler(read_only=True, run=source_crawl),
        "serp_fetch": CapabilityHandler(read_only=True, run=serp_fetch),
        "geocode": CapabilityHandler(read_only=True, run=geocode),
    }
