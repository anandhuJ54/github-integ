"""disco-harvest-worker — rule-based harvest of ONE detail page (port, Phase B).

Applies the site contract learned by mapSite (extraction.site_contract, version >= 3) to a
single page, without AI. Reads disco_site_contract only; writes NOTHING to the database
(persistence is done by the SQL collector).

POST /public/disco-harvest-worker   header x-disco-worker-key
body { url, domain, gcid, crawl_method, frontier_id? }
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from _base.disco import webscraper
from surfaces.etl.disco import contract_row as cr
from surfaces.etl.internal import cr_num, is_invalid, jresp, read_json, validate_body, worker_key_ok

router = APIRouter(tags=["etl:disco"])

_rows = cr.TtlCache()
_names = cr.TtlCache()


def matches_detail_pattern(url: str, pattern: str | None) -> bool:
    return cr.matches_detail_pattern(url, pattern)


def harvest(body: dict) -> tuple[int, dict]:
    url, domain, gcid, crawl_method = body["url"], body["domain"], body["gcid"], body["crawl_method"]
    frontier_id = body.get("frontier_id")
    try:
        row = cr.load_contract_row(_rows, domain, gcid)
        contract = ((row or {}).get("extraction") or {}).get("site_contract")
        if not row or not contract or cr_num(contract.get("version")) < 3:
            return 200, {"ok": False, "frontier_id": frontier_id, "url": url,
                         "reason": "no_contract"}
        if not matches_detail_pattern(url, row.get("detail_pattern")):
            return 200, {"ok": False, "frontier_id": frontier_id, "url": url,
                         "reason": "not_detail_page"}

        page = webscraper.scrape_website({"url": url, "crawl_method": crawl_method})
        if not page.get("ok") or not page.get("content"):
            blocked = webscraper.looks_blocked(page.get("status_code"), page.get("content"))
            return 200, {
                "ok": False, "frontier_id": frontier_id, "url": url,
                "reason": "blocked" if blocked and page.get("content") else "fetch_failed",
                "status_code": page.get("status_code"), "error": page.get("error"),
            }
        if webscraper.looks_blocked(page.get("status_code"), page["content"]):
            return 200, {"ok": False, "frontier_id": frontier_id, "url": url, "reason": "blocked",
                         "status_code": page.get("status_code"), "error": page.get("error")}

        lib = cr.sc()
        names = cr.site_entity_names(
            _names, f"{row['domain']}|{row['category_slug']}|{contract.get('learned_at')}",
            row["domain"], contract, crawl_method)
        firm_signatures = set(contract.get("firm_signatures") or [])
        applied = lib.apply_site_contract(page["content"], url, contract, names,
                                          {"firmSignatures": firm_signatures})
        filled = lib.apply_address_owner(applied["values"], contract)
        # Station 5: a 200 page that reads as "not found" (removed profile) is skipped.
        if lib.looks_not_found(page["content"], filled):
            return 200, {"ok": False, "frontier_id": frontier_id, "url": url,
                         "reason": "not_detail_page", "detail": "not_found"}
        # C2: on brand sites the page itself is the entity's own page.
        own_key = contract.get("own_page_key")
        if row.get("source_type") == "brand_site" and own_key:
            k = "tax." + own_key
            cur = filled.get(k)
            if cur is None or (isinstance(cur, str) and cur.strip() == ""):
                filled[k] = url
        # C14: extra fields (staging only, never promoted).
        extras = lib.apply_extra_fields(page["content"], url, contract, names,
                                        {"firmSignatures": firm_signatures})
        record = lib.build_harvest_record({
            "contract": {**contract, "static_routes": row.get("routes")
                         if row.get("routes") is not None else contract.get("static_routes")},
            "values": filled, "detailUrl": url, "detailEntityType": row.get("detail_entity_type"),
            "fieldFloor": row.get("field_floor"),
            "firmRelabelled": applied.get("firmRelabelled") or [], "extras": extras,
        })
        return 200, {
            "ok": True, "frontier_id": frontier_id, "url": url,
            "resolved_url": page.get("resolved_url"), "status_code": page.get("status_code"),
            "contract_version": contract.get("version"), "record": record,
        }
    except Exception as error:  # noqa: BLE001 - the worker always answers in JSON
        return 500, {"ok": False, "frontier_id": frontier_id, "url": url, "reason": "error",
                     "error": f"{type(error).__name__}: {error}"}


@router.post("/public/disco-harvest-worker")
async def disco_harvest_worker(request: Request):
    if not worker_key_ok(request):
        return jresp({"error": "unauthorized"}, 401)
    body = await read_json(request)
    if is_invalid(body):
        return jresp({"error": "Invalid JSON body"}, 400)
    bad = validate_body(body)
    if bad:
        return jresp(bad[1], bad[0])
    status, out = await run_in_threadpool(harvest, body)
    return jresp(out, status)
