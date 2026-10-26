"""disco-detail-api-worker (port, 2026-10-14) — harvest one profile from the site's profile API.

The fetch tick sends a detail_page here (instead of disco-harvest-worker) when the source's
saved contract has site_contract.detail_route.record_source 'api' or 'api+page'. Input and
reply are the same as disco-harvest-worker's, so exp_etl_fetch_collect stages the record
unchanged:

- 'api':      the record is built from the profile API's JSON with the contract's field map;
- 'api+page': the profile page is fetched too and fills the fields the JSON lacks (JSON wins);
- the API call fails or returns another profile: the record is built from the page
  ('page_fallback').

detail_url stays the profile page URL. payload._contract.detail_source says which source was
used. No AI. Nothing is written here. Dry run: { dry_run: true, url, domain, gcid,
crawl_method, contract? } — contract may be passed for a site without a saved contract.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from _base.disco import detail_api, webscraper
from _base.disco.agent_engine import as_num, js_truthy
from surfaces.etl.disco import contract_row as cr
from surfaces.etl.routers._worker import is_invalid, jresp, read_json, worker_key_ok
from surfaces.etl.routers.disco_harvest_worker import cr_num, validate_body

router = APIRouter(tags=["etl:disco"])

_rows = cr.TtlCache()
_names = cr.TtlCache()


def _row_for(body: dict) -> dict | None:
    """Dry run with a contract passed in; otherwise the saved contract row."""
    given = body.get("contract") if body.get("dry_run") is True else None
    if isinstance(given, dict):
        floor = cr_num(body.get("field_floor"))
        return {
            "domain": body["domain"], "category_slug": body["gcid"],
            "detail_pattern": body["detail_pattern"]
            if isinstance(body.get("detail_pattern"), str) else None,
            "field_floor": as_num(floor) if js_truthy(floor) else None,
            "detail_entity_type": None, "extraction": {"site_contract": given},
            "routes": given["static_routes"] if given.get("static_routes") is not None else {},
        }
    return cr.load_contract_row(_rows, body["domain"], body["gcid"])


def detail(body: dict) -> tuple[int, dict]:
    url, domain, crawl_method = body["url"], body["domain"], body["crawl_method"]
    frontier_id = body.get("frontier_id")
    try:
        row = _row_for(body)
        contract = ((row or {}).get("extraction") or {}).get("site_contract")
        if not row or not contract or cr_num(contract.get("version")) < 3:
            return 200, {"ok": False, "frontier_id": frontier_id, "url": url,
                         "reason": "no_contract"}
        if not cr.matches_detail_pattern(url, row.get("detail_pattern")):
            return 200, {"ok": False, "frontier_id": frontier_id, "url": url,
                         "reason": "not_detail_page"}
        dr = contract.get("detail_route") or {}
        rs = dr.get("record_source")
        mode = rs if rs in ("api", "api+page") else "page"
        lib = cr.sc()

        # 1. Profile API.
        api_values: dict[str, Any] | None = None
        api_why = "no profile api in the contract"
        api_url: str | None = None
        if mode != "page" and dr.get("api") and dr.get("json_fields"):
            got = detail_api.fetch_detail_for(dr["api"], url, 30_000)
            api_why, api_url = got.get("why"), got.get("api_url")
            if "json" in got:
                api_values = detail_api.json_values(got["json"], dr["json_fields"])
        source = ("api" if mode == "api" else "api+page") if api_values is not None \
            else "page_fallback"

        # 2. Profile page (api+page, or the API did not answer for this profile).
        page_values: dict[str, Any] = {}
        extras: dict[str, Any] = {}
        firm_relabelled: list = []
        page: dict[str, Any] = {}
        if source != "api":
            p = webscraper.scrape_website({"url": url, "crawl_method": crawl_method})
            page = {"resolved_url": p.get("resolved_url"), "status_code": p.get("status_code")}
            if (not p.get("ok") or not p.get("content")
                    or webscraper.looks_blocked(p.get("status_code"), p.get("content"))):
                if api_values is None:
                    blocked = webscraper.looks_blocked(p.get("status_code"), p.get("content"))
                    return 200, {
                        "ok": False, "frontier_id": frontier_id, "url": url,
                        "reason": "blocked" if blocked and p.get("content") else "fetch_failed",
                        "status_code": p.get("status_code"), "error": p.get("error"),
                        "api": api_why,
                    }
            else:
                names = cr.site_entity_names(_names, f"{domain}|{contract.get('learned_at')}",
                                             domain, contract, crawl_method)
                firm_signatures = set(contract.get("firm_signatures") or [])
                applied = lib.apply_site_contract(p["content"], url, contract, names,
                                                  {"firmSignatures": firm_signatures})
                page_values = applied["values"]
                firm_relabelled = applied.get("firmRelabelled") or []
                if api_values is None and lib.looks_not_found(
                        p["content"], lib.apply_address_owner(page_values, contract)):
                    return 200, {"ok": False, "frontier_id": frontier_id, "url": url,
                                 "reason": "not_detail_page", "detail": "not_found"}
                extras = lib.apply_extra_fields(p["content"], url, contract, names,
                                                {"firmSignatures": firm_signatures})

        # 3. Merge: the JSON value wins where both have one; the page fills the rest.
        merged: dict[str, Any] = dict(page_values)
        for k, v in (api_values or {}).items():
            if not cr.empty(v):
                merged[k] = v
        # Fix (taxonomy copies on profile-API records, 2026-10-15): value-only rules run on
        # the merged values, so an API record gets them as a page record does.
        filled = lib.apply_address_owner(lib.apply_value_rules(merged, contract, url), contract)
        own_key = contract.get("own_page_key")
        if (row.get("source_type") == "brand_site" and own_key
                and cr.empty(filled.get("tax." + own_key))):
            filled["tax." + own_key] = url
        record = lib.build_harvest_record({
            "contract": {**contract, "static_routes": row.get("routes")
                         if row.get("routes") is not None else contract.get("static_routes")},
            "values": filled, "detailUrl": url, "detailEntityType": row.get("detail_entity_type"),
            "fieldFloor": row.get("field_floor"), "firmRelabelled": firm_relabelled,
            "extras": extras,
        })
        payload = record.setdefault("payload", {})
        meta = payload.get("_contract") or {}
        payload["_contract"] = {
            **meta, "detail_source": source,
            **({"api_issue": api_why} if source == "page_fallback" and mode != "page" else {}),
        }
        out: dict[str, Any] = {
            "ok": True, "frontier_id": frontier_id, "url": url,
            "resolved_url": page.get("resolved_url"),
            "status_code": page["status_code"] if page.get("status_code") is not None else 200,
            "contract_version": contract.get("version"), "detail_source": source,
            "api_url": api_url, "record": record,
        }
        if body.get("dry_run") is True:
            out.update({
                "dry_run": True, "api_values": api_values,
                "page_fields": len([k for k, v in page_values.items() if not cr.empty(v)]),
            })
        return 200, out
    except Exception as error:  # noqa: BLE001 - the worker always answers in JSON
        return 500, {"ok": False, "frontier_id": frontier_id, "url": url, "reason": "error",
                     "error": f"{type(error).__name__}: {error}"}


@router.post("/public/disco-detail-api-worker")
async def disco_detail_api_worker(request: Request):
    if not worker_key_ok(request):
        return jresp({"error": "unauthorized"}, 401)
    body = await read_json(request)
    if is_invalid(body):
        return jresp({"error": "Invalid JSON body"}, 400)
    bad = validate_body(body)
    if bad:
        return jresp(bad[1], bad[0])
    status, out = await run_in_threadpool(detail, body)
    return jresp(out, status)
