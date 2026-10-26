"""disco list worker — G3 (harvest any list route), port of `disco-list-worker.ts` (2026-10-13).

Runs ONE list unit of a source's accepted list route (disco_site_contract
.extraction.site_contract.list_route, proven by site mapper version 2 at mapping): one listing
seed from a start page (up to 5 pages), one link_crawl hub page, or one autocomplete prefix. It
returns the profile page URLs it found and the next units; exp_etl_fetch_collect queues them.
No AI, no cookies or login headers, requests spaced by the source's min_delay_seconds (at most
10 s). This worker writes nothing.

Queue rows: url = <list start url>#list=<unit> where <unit> is 'root:<source index>' (seeded by
Run) or URI-encoded JSON of an engine ListUnit (made here).

POST /public/disco-list-worker   header x-disco-worker-key
body: { url, domain, gcid, crawl_method?, frontier_id? }            -> one unit (the fetch tick)
      { dry_run: true, domain, gcid, url? | full: true, max_pages?, config? } -> dry run
"""
from __future__ import annotations

import importlib
import json
import math
import re
import threading
import time
from typing import Any

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from _base.db.session import role_connection
from _base.disco import agent_engine as E
from surfaces.etl.disco import contract_row as cr
from surfaces.etl.internal import is_invalid, jresp, read_json, worker_key_ok

router = APIRouter(tags=["etl:disco"])

PAGES_PER_UNIT = 5
UNIT_BUDGET_MS = 200_000
FULL_DRY_RUN_MS = 780_000


def encode_list_unit(base: str, unit: dict) -> str:
    return f"{base.split('#')[0]}#list={E.encode_uri_component(E.json_stringify(unit))}"


def decode_list_unit(url: str) -> dict | None:
    i = url.find("#list=")
    if i < 0:
        return None
    raw = url[i + 6:]
    root = re.match(r"^root:(\d+)\Z", raw)
    if root:
        return {"s": int(root.group(1)), "k": "root"}
    try:
        u = json.loads(E.decode_uri_component(raw))
    except (ValueError, RecursionError):
        return None
    if isinstance(u, dict) and E.is_num(u.get("s")) and isinstance(u.get("k"), str):
        return u
    return None


def load_route(domain: str, gcid: str) -> dict | None:
    with role_connection("service_role") as conn:
        row = cr.latest_contract_row(conn, domain, gcid, "domain, detail_pattern, extraction")
        lr = (((row or {}).get("extraction") or {}).get("site_contract") or {}).get("list_route")
        if not row or not isinstance(lr, dict) or not isinstance(lr.get("sources"), list) \
                or not lr["sources"]:
            return None
        src = cr.source_row(conn, domain, gcid, "min_delay_seconds")
    delay = (src or {}).get("min_delay_seconds")
    delay_n = E.js_number(5 if delay is None else delay)
    return {
        "config": {
            "version": 2, "domain": domain,
            "start_url": lr["start_url"] if lr.get("start_url") is not None
            else f"https://{domain}/",
            # the harvest's own profile page pattern, so list results match what the queue
            # classifies as profile pages
            "profile_url_pattern": row.get("detail_pattern") or lr.get("profile_url_pattern"),
            "strip_query": False,
            "render": lr["render"] if lr.get("render") is not None else False,
            "headers": {}, "sources": lr["sources"],
        },
        "delaySec": 0.0 if math.isnan(delay_n) else max(0.0, min(10.0, delay_n)),
    }


def _oxy_fetch(r: dict) -> dict:
    """Version 2's one network path (resolved at call time from the agent mapper port)."""
    return importlib.import_module("surfaces.etl.disco.agent_mapper").oxy_fetch(r)


def paced_fetch(delay_sec: float) -> E.EngineFetch:
    """oxy_fetch with the source's spacing between requests (one request at a time per unit)."""
    lock = threading.Lock()
    last = [0.0]

    def fetch(r: dict) -> dict:
        with lock:
            wait = last[0] + delay_sec * 1000 - E.now_ms()
            if wait > 0:
                time.sleep(wait / 1000)
            last[0] = E.now_ms()
        return _oxy_fetch(r)

    return fetch


def run_list(body: dict) -> tuple[int, dict]:
    domain = E.js_str(body.get("domain") if body.get("domain") is not None else "").lower()
    gcid = E.js_str(body.get("gcid") if body.get("gcid") is not None else "")
    frontier_id = body.get("frontier_id")
    if not domain or not gcid:
        return 400, {"ok": False, "frontier_id": frontier_id,
                     "reason": "domain and gcid are required"}
    try:
        cfg = body.get("config")
        if body.get("dry_run") is True and isinstance(cfg, dict) \
                and isinstance(cfg.get("sources"), list):
            route = {"config": {"headers": {}, "strip_query": False, "render": False, **cfg,
                                "domain": domain}, "delaySec": 3}
        else:
            route = load_route(domain, gcid)
        if not route:
            return 200, {"ok": False, "frontier_id": frontier_id, "url": body.get("url"),
                         "reason": "no_list_route"}
        collector = E.Collector(route["config"])
        fetch = paced_fetch(route["delaySec"])

        if body.get("dry_run") is True and body.get("full") is True:
            started = E.now_ms()
            limits: dict[str, Any] = {"workers": 2, "deadline": E.now_ms() + FULL_DRY_RUN_MS}
            if E.js_truthy(body.get("max_pages")):
                limits["maxPages"] = E.js_number(body["max_pages"])
            stats = E.run_config(route["config"], collector, limits, fetch)
            return 200, {
                "dry_run": True, "full": True, "ok": True, "domain": domain, "gcid": gcid,
                "seconds": math.floor((E.now_ms() - started) / 1000 + 0.5),
                "profile_urls": len(collector.seen), "samples": list(collector.seen)[:20],
                "sources": [s.summary() for s in stats],
            }

        url = E.js_str(body.get("url") if body.get("url") is not None else "")
        unit = decode_list_unit(url) or ({"s": 0, "k": "root"} if E.js_truthy(body.get("dry_run"))
                                         else None)
        if not unit:
            return 200, {"ok": False, "frontier_id": frontier_id, "url": url,
                         "reason": "not_list_unit"}
        res = E.run_list_unit(route["config"], unit, collector, fetch, {
            "pagesPerUnit": PAGES_PER_UNIT, "deadline": E.now_ms() + UNIT_BUDGET_MS})
        base = route["config"]["start_url"]
        urls = list(collector.seen)
        summary = res["stats"].summary()
        blocked = res["stats"].blocked > 0 and not urls and not res["next"]
        out: dict[str, Any] = {"ok": not blocked, "frontier_id": frontier_id, "url": url}
        if body.get("dry_run") is True:
            out["dry_run"] = True
        out.update({
            "reason": "blocked" if blocked else res["reason"], "unit": unit,
            "profile_urls": urls, "next_units": [encode_list_unit(base, u) for u in res["next"]],
            "stats": {"requests": summary["requests"], "found": summary["profile_urls_found"],
                      "rejected": summary["rejected_by_profile_pattern"],
                      "errors": summary["errors"]},
        })
        return 200, out
    except Exception as e:  # noqa: BLE001 - the worker always answers in JSON
        return 500, {"ok": False, "frontier_id": frontier_id, "url": body.get("url"),
                     "reason": "error", "error": E.error_message(e)[:300]}


@router.post("/public/disco-list-worker")
async def disco_list_worker(request: Request):
    if not worker_key_ok(request):
        return jresp({"error": "unauthorized"}, 401)
    body = await read_json(request)
    if is_invalid(body):
        return jresp({"error": "Invalid JSON body"}, 400)
    status, out = await run_in_threadpool(run_list, body if isinstance(body, dict) else {})
    return jresp(out, status)
