"""disco-ai-worker — the AI brain for Category Population (port of `disco-ai-worker.ts`).

Calls Claude, strictly validates the structured output, and writes back through the governed
RPCs (`disco_discover_ingest`, `disco_method_ingest`, `disco_map_site_ingest`,
`disco_map_site_no_profiles`, `disco_check_method_complete`). The request queue row
(`disco_llm_requests`) and review proposals (`disco_proposals`) are updated directly, as in the
TS. Tools: discover_companies (source discovery), classify_method, map_site.

Network policy: Anthropic calls always go direct; every fetch of a target website goes through
the shared webscraper layer (`_base.disco.webscraper.scrape_website`).

Trigger: POST /public/disco-ai-worker with header x-disco-worker-key. It drains up to BATCH
`pending` rows of disco_llm_requests (one map_site per call) and returns. Dry runs
(`dry_run: true`) read only.

The implementation is split by section: `ai_worker_discover` (§1), `ai_worker_classify` (§2),
`ai_worker_map` / `ai_worker_routes` / `ai_worker_links` (§3), `ai_worker_v2` (version 2,
detail route, save rule), `ai_worker_util` (JS semantics, DB, Anthropic, fetch).
"""
from __future__ import annotations

import json
import os
from typing import Any

from psycopg.types.json import Jsonb
from surfaces.etl.disco import ai_worker_classify as cl
from surfaces.etl.disco import ai_worker_discover as dc
from surfaces.etl.disco import ai_worker_routes as rt
from surfaces.etl.disco import ai_worker_util as u
from surfaces.etl.disco import ai_worker_v2 as v2m

from _base.db.session import role_connection
from _base.disco import ai_cost, boundary, extra_keys

BATCH = 5

# Re-exported names of the TS module (library surface for other ports).
MapSiteError = u.MapSiteError
call_claude = u.call_claude
discover_sources = dc.discover_sources
validate_discovered_sources = dc.validate_discovered_sources
build_discover_prompt = dc.build_discover_prompt
classify_method = cl.classify_method
map_with_v2 = v2m.map_with_v2
map_site_with_limit = v2m.map_site_with_limit
run_detail_route = v2m.run_detail_route
attach_detail_route = v2m.attach_detail_route
run_deferred_routes = rt.run_deferred_routes
no_nul = u.no_nul


def _jsonb(v: Any) -> Jsonb:
    return Jsonb(u.to_json(u.no_nul(v)))


def _crawl_method(v: Any) -> str:
    if v == "needs_js_api":
        return "needs_js_api"
    if v == "needs_proxy":
        return "needs_proxy"
    return "server_crawl"


def _rpc(sql: str, params: tuple) -> str | None:
    """A governed RPC; returns the error message (supabase-js `{ error }`) or None."""
    try:
        u.db().write(sql, params)
        return None
    except Exception as e:  # noqa: BLE001
        return str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__


def _update_request(request_id: Any, status: str, response: Any = None,
                    with_response: bool = False) -> str | None:
    """`disco_llm_requests` status (+ response) update; returns the error message or None."""
    try:
        if with_response:
            u.db().write(
                "update disco_llm_requests set status = %s, response = %s where request_id = %s",
                (status, _jsonb(response), request_id),
            )
        else:
            u.db().write("update disco_llm_requests set status = %s where request_id = %s",
                         (status, request_id))
        return None
    except Exception as e:  # noqa: BLE001
        return str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__


def _strs(v: Any, n: int) -> list[str]:
    return [x for x in v if isinstance(x, str)][:n] if isinstance(v, list) else []


def _v2_budget() -> float:
    raw = os.environ.get("DISCO_V2_BUDGET")
    n = u.num(raw if raw is not None else 3)
    return u.as_int(n) if u.finite(n) and n else 3


def handle_request(raw_body: bytes | str | None, worker_key: str | None) -> tuple[int, Any]:
    """The TS `drain(request)`: returns (status, body). A str body is plain text."""
    expected = os.environ.get("DISCO_WORKER_KEY")
    if not expected or worker_key != expected:
        return 401, "Unauthorized"
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return 500, {"error": "ANTHROPIC_API_KEY not configured"}
    env_model = os.environ.get("DISCO_MODEL")
    model = env_model if env_model is not None else u.DEFAULT_MODEL

    try:
        body = json.loads(raw_body) if raw_body else None
    except (ValueError, TypeError):
        body = None
    body = body if isinstance(body, dict) else None

    if body and body.get("dry_run") is True:
        return _dry_run(body, api_key, model)
    return _drain(api_key, model)


def _dry_run(body: dict, api_key: str, model: str) -> tuple[int, Any]:
    """Dry runs (regression tests, 2026-10-05): nothing is written to any table."""
    # Second call of a dry run (step 6 follow-up): only the network-call and search routes.
    if body.get("phase") == "routes" and isinstance(body.get("state"), dict):
        started = u.now_ms()
        try:
            out = rt.run_deferred_routes(body["state"],
                                         force_network=body.get("force_network") is True,
                                         force_search=body.get("force_search") is True)
            return 200, {"dry_run": True, "phase": "routes", "ok": True,
                         "ms": u.now_ms() - started, **out}
        except Exception as e:  # noqa: BLE001
            return 200, {"dry_run": True, "phase": "routes", "ok": False,
                         "ms": u.now_ms() - started, "error": u.err_string(e)}
    # Detail route dry run (2026-10-14).
    if body.get("phase") == "detail":
        domain = body["domain"].strip().lower() if isinstance(body.get("domain"), str) else ""
        category = body["category"].strip() if isinstance(body.get("category"), str) else ""
        urls = _strs(body.get("profile_urls"), 60)
        if not domain or not category or not urls:
            return 400, {"dry_run": True, "phase": "detail", "ok": False,
                         "error": "domain, category and profile_urls required"}
        detail = v2m.run_detail_route(api_key, model, category, domain, urls)
        return 200, {"dry_run": True, "phase": "detail", "ok": True, "domain": domain,
                     "category": category, "detail": detail}
    domain = body["domain"].strip().lower() if isinstance(body.get("domain"), str) else ""
    category = body["category"].strip() if isinstance(body.get("category"), str) else ""
    if not domain or not category:
        return 400, {"dry_run": True, "ok": False, "error": "domain and category required"}
    crawl_method = _crawl_method(body.get("crawl_method"))
    started = u.now_ms()
    try:
        profile_urls = _strs(body.get("profile_urls"), 60)
        if body.get("engine") == "v2":
            contract = v2m.map_with_v2(
                api_key, model, category, domain, None, crawl_method,
                start_url=body["start_url"] if isinstance(body.get("start_url"), str) else None,
                profile_urls=profile_urls, force_network=body.get("force_network") is True,
                force_search=body.get("force_search") is True,
            )["contract"]
        else:
            v2_led = {"pattern": body["v2_pattern"]} \
                if isinstance(body.get("v2_pattern"), str) and profile_urls else None
            contract = v2m.map_site_with_limit(
                api_key, model, category, domain, None, crawl_method,
                {"forceNetwork": body.get("force_network") is True,
                 "forceSearch": body.get("force_search") is True, "profileUrls": profile_urls,
                 "v2Led": v2_led},
            )
        if isinstance(body.get("detail"), dict) and body.get("engine") != "v2":
            v2m.attach_detail_route(contract, body["detail"])
        return 200, {"dry_run": True, "ok": True, "domain": domain, "category": category,
                     "ms": u.now_ms() - started, "contract": contract}
    except Exception as e:  # noqa: BLE001
        return 200, {"dry_run": True, "ok": False, "domain": domain, "category": category,
                     "ms": u.now_ms() - started, "error": u.err_string(e),
                     "diagnostics": u.diagnostics_of(e)}


def _drain(api_key: str, model: str) -> tuple[int, Any]:
    db = u.db()
    try:
        reqs = db.rows(
            "select request_id, job_id, tool, prompt_input, response from disco_llm_requests "
            "where status = %s limit %s",
            ("pending", BATCH),
        )
    except Exception as e:  # noqa: BLE001
        return 500, {"error": f"query error: {e}"}

    results: list[dict] = []
    for r in reqs:
        # Fix (ETL AI cost log, 2026-10-22): the request runs inside a cost context.
        r_in = r.get("prompt_input") if isinstance(r.get("prompt_input"), dict) else {}
        ctx = ai_cost.CostContext(
            db=lambda: role_connection("service_role", write=True),
            activity=ai_cost.ACTIVITY_BY_REQUEST_TOOL.get(r.get("tool"), u.js_str(r.get("tool"))),
            gcid=r_in.get("category"), domain=r_in.get("domain"),
            request_id=r.get("request_id"), job_id=r.get("job_id"),
        )
        ai_cost.with_cost_context(ctx, lambda r=r: _process(r, api_key, model, results))
        # Fix 10: one map_site request per worker call — remaining rows stay pending.
        if r.get("tool") == "map_site":
            break
    return 200, {"model": model, "pending_picked": len(reqs), "processed": results}


def _process(r: dict, api_key: str, model: str, results: list[dict]) -> None:
    """One request row (the body of the TS loop)."""
    db = u.db()
    request_id = r.get("request_id")
    # Fix (keep version 2 / profile API on failure, 2026-10-15)
    map_carry: dict | None = None
    try:
        _update_request(request_id, "sent")
        inp = r.get("prompt_input") if isinstance(r.get("prompt_input"), dict) else {}
        category: str | None = inp.get("category")
        domain: str | None = inp.get("domain")
        bnd: dict | None = inp.get("boundary") if inp.get("boundary") is not None else None
        complexity: str | None = inp.get("complexity")
        crawl_method = _crawl_method(inp.get("crawl_method"))
        tool = r.get("tool")

        if tool == "discover_companies":
            if not category:
                raise RuntimeError("prompt_input.category missing")
            # Fix (generated category boundaries, 2026-10-16)
            if not (bnd or {}).get("definition"):
                try:
                    with db.connection(write=True) as conn:
                        gb = boundary.generate_category_boundary(
                            conn, model, category,
                            lambda prompt, t: u.call_claude(api_key, model, prompt, t, 2048),
                        )
                    gbd = (gb or {}).get("boundary")
                    if isinstance(gbd, dict) and gbd.get("definition"):
                        bnd = gbd
                except Exception as e:  # noqa: BLE001
                    u.log.error("boundary generation failed %s", u.err_string(e))
            ctx = dc.load_discover_context(db, category, complexity, bnd)
            sources = dc.discover_sources(api_key, model, ctx)
            # governed write: quarantine only, human confirms next
            err = _rpc(
                "select * from disco_discover_ingest(p_request_id => %s, p_companies => %s)",
                (request_id, _jsonb(sources)),
            )
            if err:
                raise RuntimeError(err)
            results.append({"request_id": request_id, "discovered": len(sources)})
        elif tool == "classify_method":
            if not domain:
                raise RuntimeError("prompt_input.domain missing")
            res = cl.classify_method(api_key, model, domain, category or "", bnd)
            err = _rpc(
                "select * from disco_method_ingest(p_request_id => %s, p_domain => %s, "
                "p_method => %s, p_evidence => %s, p_fetch_tier => %s)",
                (request_id, domain, res["method"], u.no_nul(res["evidence"]),
                 res["fetch_tier"]),
            )
            if err:
                raise RuntimeError(err)
            results.append({"request_id": request_id, "domain": domain,
                            "method": res["method"], "evidence": res["evidence"]})
        elif tool == "map_site":
            if not domain:
                raise RuntimeError("prompt_input.domain missing")
            map_carry = _map_site_request(r, inp, api_key, model, domain, category, bnd,
                                          crawl_method, results)
        else:
            raise RuntimeError(f"tool not yet implemented: {tool}")
    except Exception as e:  # noqa: BLE001
        carry = getattr(e, "map_carry", None) or map_carry
        response = {
            "error": u.err_string(e),
            **(u.diagnostics_of(e) or {}),
            **({"map_step": "failed_v1", "v2": carry["v2"], "detail": carry["detail"]}
               if carry else {}),
        }
        _update_request(request_id, "error", response, with_response=True)
        results.append({"request_id": request_id, "error": u.err_string(e)})


def _map_site_request(
    r: dict, inp: dict, api_key: str, model: str, domain: str, category: str | None,
    bnd: dict | None, crawl_method: str, results: list[dict],
) -> dict | None:
    """map_site in steps (Fix: map in steps, 2026-10-14). Returns the map carry (None when
    this call only ran an earlier step); errors carry it as `e.map_carry`."""
    db = u.db()
    request_id = r.get("request_id")
    start_url = inp["start_url"] if isinstance(inp.get("start_url"), str) else None
    prev = r.get("response") if isinstance(r.get("response"), dict) else {}
    v2_done: Any = v2m._UNSET
    detail_done: dict | None = None
    if inp.get("v1_only") is not True:
        if prev.get("map_step") == "v1":
            v2_done = prev.get("v2")
            detail_done = prev.get("detail")
        elif prev.get("map_step") == "detail":
            # Detail route step (2026-10-14): the site's own profile API and its JSON field map.
            v2r = prev.get("v2")
            detail = v2m.run_detail_route(api_key, model, category or "", domain,
                                          (v2r or {}).get("profile_urls") or [])
            err = _update_request(request_id, "pending",
                                  {"map_step": "v1", "v2": v2r, "detail": detail,
                                   "updated_at": u.iso_now()}, with_response=True)
            if err:
                raise RuntimeError(f"map step save failed: {err}")
            js = detail.get("json")
            results.append({"request_id": request_id, "domain": domain, "map_step": "v1",
                            "detail_api": (detail.get("probe") or {}).get("status"),
                            "json_fields": len(js.get("fields") or {}) if js else 0})
            return None  # one map step per worker call
        else:
            try:
                step = u.call_opts(
                    u.mapper().run_v2_step, api_key,
                    opts={"domain": domain, "category": category or "", "start_url": start_url,
                          "budget": _v2_budget(),
                          "state": prev.get("v2_state") if prev.get("map_step") == "v2"
                          else None},
                )
            except Exception as e:  # noqa: BLE001
                step = {"status": "done", "research": v2m._failed_research(e)}
            if step.get("status") == "continue":
                nxt = {"map_step": "v2", "v2_state": step.get("state"),
                       "v2_progress": {"calls": step.get("calls"), "turns": step.get("turns"),
                                       "active_seconds": step.get("active_seconds"),
                                       "cost_usd": step.get("cost_usd"), "log": step.get("log")},
                       "updated_at": u.iso_now()}
            else:
                res = step.get("research") or {}
                nxt = {"map_step": "detail" if res.get("config") and res.get("profile_urls")
                       else "v1",
                       "v2": res, "updated_at": u.iso_now()}
            err = _update_request(request_id, "pending", nxt, with_response=True)
            if err:
                raise RuntimeError(f"map step save failed: {err}")
            extra = {"v2_calls": step.get("calls")} if step.get("status") == "continue" \
                else {"v2_outcome": (step.get("research") or {}).get("outcome")}
            results.append({"request_id": request_id, "domain": domain,
                            "map_step": nxt["map_step"], **extra})
            return None  # one map step per worker call
    carry = {"v2": v2_done, "detail": detail_done} if v2_done is not v2m._UNSET else None
    try:
        contract = v2m.map_with_v2(
            api_key, model, category or "", domain, bnd, crawl_method,
            v1_only=inp.get("v1_only") is True, start_url=start_url, v2=v2_done,
            v1_limit_ms=v2m.V1_STEP_LIMIT_MS, detail=detail_done,
        )["contract"]
        if contract.get("outcome") == "no_profiles_on_site":
            evidence = contract.get("evidence") if isinstance(contract.get("evidence"),
                                                              dict) else {}
            err = _rpc(
                "select * from disco_map_site_no_profiles(p_request_id => %s, p_evidence => %s)",
                (request_id, _jsonb(evidence)),
            )
            if err:
                raise RuntimeError(f"no_profiles_on_site rejected: {err}")
            results.append({"request_id": request_id, "domain": domain,
                            "outcome": "no_profiles_on_site",
                            "where_profiles_live": evidence.get("where_profiles_live")})
            return carry
        # Fix (combine list routes, 2026-10-14)
        try:
            v2m.merge_saved_list_route(db, domain, category or "", contract)
        except Exception as e:  # noqa: BLE001
            u.log.error("list route merge failed %s", u.err_string(e))
        # Fix (save rule, 2026-10-07): a working saved contract is never replaced by a worse one.
        save_check = v2m.saved_contract_check(db, domain, category or "", contract, crawl_method)
        # G2 (save rule D1, 2026-10-13): only a site's FIRST contract saves itself.
        first_contract = save_check["saved"] is None
        if not first_contract or not save_check["fresh"]["must_have_ok"]:
            src_row = db.row_or_none(
                "select status from exp_etl_sources where source_domain = %s and gcid = %s "
                "limit 1",
                (domain, category or ""),
            )
            save_check["compare_reason"] = save_check["reason"]
            save_check["compare_save"] = save_check["save"]
            save_check["save"] = False
            save_check["reason"] = (
                "first contract, but the required fields are not met: kept as a proposal for "
                "review"
                if first_contract else
                f"kept as a proposal for review (source {(src_row or {}).get('status') or 'unknown'}"
                f"; comparison: {save_check['compare_reason']})"
            )
        contract["save_check"] = save_check
        if not save_check["save"]:
            # G2: the result is stored as a pending proposal for the review panel.
            try:
                db.write(
                    "insert into disco_proposals (job_id, category_slug, kind, state, payload) "
                    "values (%s, %s, %s, %s, %s)",
                    (r.get("job_id"), category or "", "site_map", "pending",
                     _jsonb({**contract, "domain": domain.lower(), "request_id": request_id,
                             "proposed_at": u.iso_now()})),
                )
            except Exception as e:  # noqa: BLE001
                u.log.error("proposal insert failed %s", e)
            err = _update_request(request_id, "completed",
                                  {"kept_existing_contract": True, "save_check": save_check,
                                   "new_contract": contract}, with_response=True)
            if err:
                raise RuntimeError(f"keep-existing update failed: {err}")
            ck = _rpc("select * from disco_check_method_complete(p_cat => %s)", (category or "",))
            if ck:
                u.log.error("disco_check_method_complete failed %s", ck)
            results.append({"request_id": request_id, "domain": domain,
                            "outcome": "kept_existing_contract", "reason": save_check["reason"]})
            return carry
        # The RPC rejects detail_pattern-less or field_floor < 5 contracts.
        err = _rpc("select * from disco_map_site_ingest(p_request_id => %s, p_contract => %s)",
                   (request_id, _jsonb(contract)))
        if err:
            raise RuntimeError(f"contract rejected: {err}")
        # C14 / C14b / C14c: shared extra-key list for the category. Failures are logged.
        ext = contract.get("extraction") if isinstance(contract.get("extraction"), dict) else {}
        scd = ext.get("site_contract") if isinstance(ext.get("site_contract"), dict) else {}
        try:
            with db.connection(write=True) as conn:
                extra_keys.refresh_extra_keys(conn, category or "", domain,
                                              scd.get("extra_fields") or {})
        except Exception as e:  # noqa: BLE001
            u.log.error("extra key refresh failed %s", e)
        results.append({
            "request_id": request_id, "domain": domain, "crawl_method": crawl_method,
            "rendered_fetch_possible": crawl_method == "needs_js_api",
            "detail_pattern": contract.get("detail_pattern"),
            "field_floor": contract.get("field_floor"),
        })
        return carry
    except Exception as e:
        if carry:
            try:
                e.map_carry = carry  # type: ignore[attr-defined]
            except AttributeError:
                pass
        raise
