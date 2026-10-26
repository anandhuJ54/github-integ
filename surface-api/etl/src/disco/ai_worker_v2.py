"""Map orchestration around version 1's field learner (port of `disco-ai-worker.ts`).

- G1 (one mapper behind Map, 2026-10-13): site mapper version 2 finds and proves where the site
  lists its profiles; version 1 then learns the fields from the pages version 2 handed over.
- Detail route (2026-10-14): the site's own profile API and its JSON field map.
- Save rule (2026-10-07): a working saved contract is never replaced by a worse one.
- Run limit (2026-10-08): a map run is stopped before the worker limit with what it learned.

Nothing here writes; saving stays with the worker's normal save path.
"""
from __future__ import annotations

import re
from typing import Any

from surfaces.etl.disco import ai_worker_map as mp
from surfaces.etl.disco import ai_worker_util as u

from _base.disco import detail_api

MAP_RUN_LIMIT_MS = 285_000
V2_CALL_MS = 480_000  # version 2 research, one call (dry runs)
V1_STEP_LIMIT_MS = 255_000  # live map, version 1 step: leaves time for the save check and save
# G3: the list worker reads listing / API / hub / type-ahead routes
V2_HARVESTABLE = {"sitemap", "listing", "link_crawl", "autocomplete"}
DETAIL_STEP_MS = 230_000

_UNSET: Any = object()


def map_site_with_limit(
    api_key: str,
    model: str,
    category: str,
    domain: str,
    boundary: dict | None,
    crawl_method: str,
    opts: dict | None = None,
) -> dict:
    """Fix (report before the limit, 2026-10-08): stop the run at MAP_RUN_LIMIT_MS (or
    opts.limitMs) and raise a MapSiteError with `stopped` and `progress`. Like the JS race, the
    run itself keeps going in the background; its result is dropped."""
    progress: dict[str, Any] = {}
    o = dict(opts or {})
    limit_ms = o.pop("limitMs", None)
    limit_ms = MAP_RUN_LIMIT_MS if limit_ms is None else limit_ms
    map_opts = {**o, "progress": progress}
    sentinel = object()
    result = u.with_timeout(
        lambda: mp.map_site(api_key, model, category, domain, boundary, crawl_method, None,
                            map_opts),
        limit_ms, sentinel,
    )
    if result is sentinel:
        snap: Any = {}
        for _ in range(3):
            try:
                snap = u.to_json(progress)
                break
            except RuntimeError:  # mutated while copying
                continue
        step = snap.get("step") if isinstance(snap, dict) else None
        raise u.MapSiteError(
            f"run stopped at {u.as_int(limit_ms / 1000)} s, before the worker limit "
            f"(last step: {u.js_str(step if step is not None else 'start')})",
            {"stopped": True, "progress": snap},
        )
    return result


def _failed_research(e: BaseException) -> dict:
    return {"outcome": "failed", "reason": None, "config": None, "profile_urls": [],
            "sample_pool": 0, "cost_usd": 0, "active_seconds": 0, "coverage": {},
            "coverage_justification": None, "flags": None, "error": u.err_message(e)[:300],
            "log": []}


def v2_summary(v2: dict | None) -> dict | None:
    if not v2:
        return None
    cfg = v2.get("config") or {}
    sources = cfg.get("sources") if isinstance(cfg, dict) else None
    return {
        "outcome": v2.get("outcome"), "reason": v2.get("reason"), "error": v2.get("error"),
        "cost_usd": v2.get("cost_usd"), "active_seconds": v2.get("active_seconds"),
        "profile_urls_given": len(v2.get("profile_urls") or []),
        "sample_pool": v2.get("sample_pool"), "coverage": v2.get("coverage"),
        "flags": v2.get("flags"),
        "sources": [
            {"name": (x or {}).get("name") if isinstance(x, dict) else None,
             "type": (x or {}).get("type") if isinstance(x, dict) else None}
            for x in sources
        ] if isinstance(sources, list) else None,
        "estimate": cfg.get("estimate") if isinstance(cfg, dict) else None,
        "log": list(v2.get("log") or [])[-15:],
    }


def _ensure(d: dict, key: str) -> dict:
    if d.get(key) is None:
        d[key] = {}
    return d[key]


def _uniq(xs: list[Any]) -> list[Any]:
    out: list[Any] = []
    for x in xs:
        if x not in out:
            out.append(x)
    return out


def apply_v2(contract: dict, v2: dict) -> None:
    """Version 2's list route on the contract: site_contract.list_route, profile_sitemaps, the
    profile pattern when version 1's misses 10% of the samples, and the best route's reach."""
    cfg = v2.get("config")
    if not cfg:
        return
    extraction = _ensure(contract, "extraction")
    sc = _ensure(extraction, "site_contract")
    sources = cfg.get("sources") if isinstance(cfg.get("sources"), list) else []
    # Fix (sitemap filters, 2026-10-14): a sitemap source with an include filter adds only its
    # resolved matching shards, never the root index.
    sm: list[Any] = []
    for x in sources:
        if not isinstance(x, dict) or x.get("type") != "sitemap":
            continue
        if x.get("include"):
            rs = x.get("resolved_sitemaps")
            sm.extend(rs if isinstance(rs, list) else [])
        else:
            s = x.get("sitemaps")
            sm.extend(s if isinstance(s, list) else [])
    sitemaps = _uniq([s for s in sm if isinstance(s, str) and re.match(r"^https?://", s, re.IGNORECASE)])
    harvestable = bool(sources) and all(
        u.js_str((x or {}).get("type") if isinstance(x, dict) else None) in V2_HARVESTABLE
        for x in sources
    )
    pattern_from = "v1"
    v1_pattern = contract["detail_pattern"] if isinstance(contract.get("detail_pattern"), str) \
        else ""
    v2_re = None
    pup = cfg.get("profile_url_pattern")
    try:
        v2_re = u.js_re(pup) if isinstance(pup, str) and pup else None
    except ValueError:
        v2_re = None
    purls = v2.get("profile_urls") or []
    if v2_re and purls:
        try:
            v1_re = u.js_re(v1_pattern) if v1_pattern else None
        except ValueError:
            v1_re = None
        hit = len([x for x in purls if v1_re.search(x)]) / len(purls) if v1_re else 0
        if hit < 0.9:
            contract["detail_pattern"] = pup
            pattern_from = "v2"
    rr = contract.get("route_report") if isinstance(contract.get("route_report"), dict) else {}
    fo = rr.get("fields_only") if isinstance(rr.get("fields_only"), dict) else {}
    if fo.get("v2_pattern_used"):
        pattern_from = "v2"
    if sitemaps:
        prev = contract["profile_sitemaps"] if isinstance(contract.get("profile_sitemaps"), list) \
            else []
        contract["profile_sitemaps"] = _uniq([*sitemaps, *prev])
    # Fix (fields only after version 2, 2026-10-14)
    br = extraction.get("best_route")
    est = cfg.get("estimate") if isinstance(cfg.get("estimate"), dict) else {}
    v2_reach = u.numz(est.get("expected_profiles") if est.get("expected_profiles") is not None
                      else 0)
    fields_only = bool(fo.get("v2_led"))
    br_reach = u.num(br.get("reach_estimate")) if isinstance(br, dict) else float("nan")
    if (fields_only or not br or br.get("route") == "none" or not (br_reach > 0)) \
            and v2_reach > 0:
        first_type = sources[0].get("type") if sources and isinstance(sources[0], dict) else None
        basis = u.js_str(est.get("basis") if est.get("basis") is not None else "")[:300]
        extraction["best_route"] = {
            "route": u.js_str(first_type if first_type is not None else "sitemap"),
            "reach_estimate": u.as_int(v2_reach),
            "basis": f"version 2 list route: {basis}", "from": "v2",
        }
    sc["list_route"] = {
        "version": 2, "learned_at": u.iso_now(), "summary": cfg.get("summary"),
        "start_url": cfg.get("start_url"), "profile_url_pattern": cfg.get("profile_url_pattern"),
        "detail_pattern_from": pattern_from, "v1_detail_pattern": v1_pattern or None,
        "sources": sources, "estimate": cfg.get("estimate"), "coverage": v2.get("coverage"),
        "coverage_justification": v2.get("coverage_justification"),
        "render": cfg.get("render") if cfg.get("render") is not None else False,
        "harvestable": harvestable,
        "harvest_note": None if harvestable else "a source type the harvest cannot read",
        "cost_usd": v2.get("cost_usd"), "flags": v2.get("flags"),
    }


def resolve_sitemap_includes(v2: dict | None) -> None:
    """Fix (sitemap filters, 2026-10-14): resolve sitemap sources with an include filter to the
    matching child sitemaps of their index (at most 50), stored as source.resolved_sitemaps."""
    cfg = (v2 or {}).get("config") or {}
    sources = cfg.get("sources") if isinstance(cfg, dict) and isinstance(cfg.get("sources"),
                                                                         list) else []
    for src in sources:
        if not isinstance(src, dict) or src.get("type") != "sitemap" or not src.get("include") \
                or not isinstance(src.get("sitemaps"), list):
            continue
        try:
            rx = u.js_re(src["include"])
        except (ValueError, TypeError):
            continue
        found: list[str] = []
        for root in src["sitemaps"][:5]:
            if not isinstance(root, str):
                continue
            r = u.with_timeout(
                lambda root=root: u.safe(lambda: u.fetch_page(root, "server_crawl"), None),
                30_000, None,
            )
            if not r or not r.get("ok") or not r.get("body"):
                continue
            if re.search(r"<sitemapindex", r["body"][:3000], re.IGNORECASE):
                for m in re.finditer(r"<loc>\s*([^<\s]+)\s*</loc>", r["body"], re.IGNORECASE):
                    x = m.group(1).replace("&amp;", "&")
                    if rx.search(x) and x not in found:
                        found.append(x)
            elif rx.search(root):
                found.append(root)
        src["resolved_sitemaps"] = found[:50]


def _list_key(x: Any) -> str:
    x = x if isinstance(x, dict) else {}
    listing = x.get("listing") if isinstance(x.get("listing"), dict) else {}
    req = listing.get("request") if isinstance(listing.get("request"), dict) else {}
    items = x.get("items") if isinstance(x.get("items"), dict) else {}

    def nn(v: Any) -> Any:
        return v if v is not None else None

    return u.js_json({"t": x.get("type"), "u": nn(req.get("url")), "b": nn(req.get("body")),
                      "s": nn(x.get("sitemaps")), "i": nn(x.get("include")),
                      "p": nn(items.get("path")), "a": nn(x.get("start_urls"))})


def merge_saved_list_route(db: u.Db, domain: str, category: str, contract: dict) -> None:
    """Fix (combine list routes, 2026-10-14): a remap keeps the saved contract's proven list
    sources and adds the new run's; the larger measured estimate and reach win."""
    row = db.row_or_none(
        "select profile_sitemaps, extraction from disco_site_contract "
        "where domain = %s and category_slug = %s",
        (domain.lower(), category),
    )
    ext = (row or {}).get("extraction") if isinstance((row or {}).get("extraction"), dict) else {}
    saved_sc = ext.get("site_contract") if isinstance(ext.get("site_contract"), dict) else {}
    saved_lr = saved_sc.get("list_route")
    if not isinstance(saved_lr, dict) or not isinstance(saved_lr.get("sources"), list) \
            or not saved_lr["sources"]:
        return
    extraction = _ensure(contract, "extraction")
    sc = _ensure(extraction, "site_contract")
    lr = sc.get("list_route")
    if not isinstance(lr, dict) or not isinstance(lr.get("sources"), list):
        sc["list_route"] = {**saved_lr, "carried_from_saved": True}
    else:
        have = {_list_key(x) for x in lr["sources"]}
        added = [x for x in saved_lr["sources"] if _list_key(x) not in have]
        if added:
            n_new = u.numz((lr.get("estimate") or {}).get("expected_profiles")
                           if isinstance(lr.get("estimate"), dict) else 0)
            n_saved = u.numz((saved_lr.get("estimate") or {}).get("expected_profiles")
                             if isinstance(saved_lr.get("estimate"), dict) else 0)
            all_sources = [*lr["sources"], *added]
            sc["list_route"] = {
                **lr,
                "sources": all_sources,
                "estimate": saved_lr.get("estimate") if n_saved > n_new else lr.get("estimate"),
                "estimates": {"new": lr.get("estimate"), "saved": saved_lr.get("estimate")},
                "harvestable": all(
                    u.js_str(x.get("type") if isinstance(x, dict) else None) in V2_HARVESTABLE
                    for x in all_sources
                ),
                "combined_with_saved": {"sources_added": len(added),
                                        "saved_learned_at": saved_lr.get("learned_at")},
            }
    saved_sm = row.get("profile_sitemaps") if isinstance(row.get("profile_sitemaps"), list) else []
    if saved_sm:
        cur = contract["profile_sitemaps"] if isinstance(contract.get("profile_sitemaps"), list) \
            else []
        contract["profile_sitemaps"] = _uniq([*cur, *saved_sm])
    saved_br = ext.get("best_route")
    cur_br = extraction.get("best_route") if isinstance(extraction.get("best_route"), dict) else {}
    cur_reach = u.num(cur_br.get("reach_estimate") if cur_br.get("reach_estimate") is not None
                      else 0)
    if isinstance(saved_br, dict) and u.num(saved_br.get("reach_estimate")) > cur_reach:
        basis = u.js_str(saved_br.get("basis") if saved_br.get("basis") is not None else "")
        extraction["best_route"] = {
            **saved_br,
            "basis": f"combined list route; larger reach from the saved contract: {basis[:200]}",
        }


# ---- detail route (2026-10-14) ------------------------------------------------------------------
def run_detail_route(
    api_key: str, model: str, category: str, domain: str, profile_urls: list[str]
) -> dict:
    """Check the site's own profile API (proven by replay on 3 profiles) and learn its JSON field
    map from up to 20 profiles. Writes nothing."""
    started = u.now_ms()
    try:
        probe = detail_api.probe_detail_api(domain=domain, profile_urls=profile_urls,
                                            deadline_at=started + 150_000)
        if probe.get("status") != "proven" or not probe.get("api"):
            return {"probe": probe, "ms": u.now_ms() - started}
        api = probe["api"]
        urls = _uniq([*(c.get("profile_url") for c in probe.get("proven_on") or []),
                      *profile_urls])[:20]
        items: list[dict] = []
        i = 0
        while i < len(urls) and u.now_ms() < started + 185_000:
            batch = urls[i:i + 6]

            def one(x: str) -> dict:
                t = max(5_000, min(25_000, started + 190_000 - u.now_ms()))
                return {"profile_url": x, "json": detail_api.fetch_detail_json(api, x, t)}

            got = u.parallel([lambda x=x: one(x) for x in batch])
            items.extend(x for x in got if x["json"] is not None)
            i += 6
        db = u.db()
        cat_row = db.row_or_none("select entity_type from gbp_categories where gcid = %s",
                                 (category,))
        primary = "location" if (cat_row or {}).get("entity_type") == "location" else "person"
        sc = u.sc()

        def learn() -> dict | None:
            try:
                return detail_api.learn_json_fields(
                    items=items, field_ids=list(sc.all_field_ids(primary)),
                    meanings=sc.FIELD_MEANINGS,
                    ask=lambda prompt: u.call_claude_map(api_key, model, prompt,
                                                         detail_api.JSON_FIELDS_TOOL, 2048),
                    must_have=lambda v: bool(u.g(sc.record_must_have(v, primary, None), "ok")),
                )
            except Exception:  # noqa: BLE001
                return None

        js = u.with_timeout(learn, max(5_000, started + DETAIL_STEP_MS - u.now_ms()), None)
        out: dict[str, Any] = {"probe": probe}
        if js is not None:
            out["json"] = js
        out["ms"] = u.now_ms() - started
        if not js:
            out["error"] = "JSON field map not learned in time"
        return out
    except Exception as e:  # noqa: BLE001
        ms = u.now_ms() - started
        return {"probe": {"status": "error", "reason": u.err_message(e)[:200], "proven_on": [],
                          "checked": [], "captures": 0, "ms": ms},
                "error": u.err_string(e)[:200], "ms": ms}


def attach_detail_route(contract: dict, detail: dict | None) -> None:
    """Record site_contract.detail_route: record_source 'api', 'api+page' or 'page'."""
    if not detail or not detail.get("probe"):
        return
    extraction = _ensure(contract, "extraction")
    sc = _ensure(extraction, "site_contract")
    summ = contract.get("site_contract_summary") if isinstance(
        contract.get("site_contract_summary"), dict) else {}
    per_page = summ.get("field_floor_per_sample") if isinstance(
        summ.get("field_floor_per_sample"), list) else []
    sorted_page = sorted(per_page)
    page_median = sorted_page[len(sorted_page) // 2] if sorted_page else u.as_int(
        u.num(contract.get("field_floor") if contract.get("field_floor") is not None else 0))
    probe = detail["probe"]
    api = probe.get("api") if probe.get("status") == "proven" else None
    j = detail.get("json")
    source = "page"
    if not api:
        reason = f"no profile API: {u.js_str(probe.get('reason'))}"
    elif not j or not (j.get("fields") or {}):
        err = f" ({detail['error']})" if detail.get("error") else ""
        reason = f"profile API proven but no field could be mapped{err}"
    elif j["must_have_share"] < 0.8:
        reason = (f"profile API has the required fields on {u.js_round(j['must_have_share'] * 100)}"
                  f"% of {j['items']} profiles (under 80%)")
    else:
        # Fix (API plus page when the page adds fields, 2026-10-15)
        json_ids = set(j["fields"])
        fields = sc.get("fields") if isinstance(sc.get("fields"), dict) else {}
        page_only = [
            fid for fid, f in fields.items()
            if fid not in json_ids and not fid.startswith("extra.")
            and ((f or {}).get("locator") or {}).get("tier") != "alias"
            and u.numz((f or {}).get("hits") if (f or {}).get("hits") is not None else 0) >= 2
        ]
        if j["median"] >= page_median and not page_only:
            source = "api"
            reason = f"profile API median {j['median']} fields, page median {page_median}"
        else:
            source = "api+page"
            adds = (f"{len(page_only)} field(s) the API lacks ({', '.join(page_only[:12])})"
                    if page_only else "fields")
            reason = (f"profile API median {j['median']} fields, page median {page_median}: "
                      f"the page adds {adds}")
    has_sample = isinstance(j, dict) and "sample" in j
    sample_text = u.js_json(j["sample"]) if has_sample else ""
    sc["detail_route"] = {
        "record_source": source, "reason": reason, "api": api,
        "json_fields": (j or {}).get("fields") if j else None,
        "measured": {
            "json_median": j.get("median") if j else None,
            "json_per_item": j.get("per_item") if j else None,
            "page_median": page_median, "page_per_sample": per_page,
            "must_have_share": j.get("must_have_share") if j else None,
            "items": (j.get("items") or 0) if j else 0,
        },
        "fill_rate": j.get("fill") if j else None,
        "dropped": list((j.get("dropped") if j else None) or [])[:20],
        "json_sample": j["sample"] if sample_text and len(sample_text) <= 4_000 else None,
        "probe": {"status": probe.get("status"), "reason": probe.get("reason"),
                  "proven_on": probe.get("proven_on"),
                  "checked": list(probe.get("checked") or [])[:15],
                  "captures": probe.get("captures"), "ms": probe.get("ms")},
        "learned_at": u.iso_now(),
    }


def map_with_v2(
    api_key: str,
    model: str,
    category: str,
    domain: str,
    boundary: dict | None,
    crawl_method: str,
    *,
    v1_only: bool = False,
    start_url: str | None = None,
    profile_urls: list[str] | None = None,
    force_network: bool = False,
    force_search: bool = False,
    v2: Any = _UNSET,
    v1_limit_ms: int | None = None,
    detail: dict | None = None,
) -> dict:
    """Version 2 list discovery (unless given or v1_only), then version 1 field learning.
    Returns {contract, v2}."""
    # Fix (map in steps, 2026-10-14): the live map passes the version 2 result its earlier steps
    # produced (v2), so this call only runs version 1; dry runs still run version 2 here.
    research: dict | None = None if v2 is _UNSET else v2
    given = [x for x in (profile_urls or []) if isinstance(x, str)]
    if not v1_only and not given and v2 is _UNSET:
        try:
            budget = _v2_budget()
            research = u.call_opts(
                u.mapper().run_v2_research, api_key,
                opts={"domain": domain, "category": category, "start_url": start_url,
                      "budget": budget, "callMs": V2_CALL_MS},
            )
        except Exception as e:  # noqa: BLE001
            research = _failed_research(e)
    purls = given if given else (research.get("profile_urls") or []) \
        if research and research.get("config") else []
    try:
        # Fix (fields only after version 2, 2026-10-14)
        v2_led = None
        if research and research.get("config") and research.get("profile_urls") and not given:
            p = research["config"].get("profile_url_pattern")
            v2_led = {"pattern": p if isinstance(p, str) else None}
        contract = map_site_with_limit(
            api_key, model, category, domain, boundary, crawl_method,
            {"forceNetwork": force_network, "forceSearch": force_search, "profileUrls": purls,
             "limitMs": v1_limit_ms, "v2Led": v2_led},
        )
        if research and research.get("config") and contract.get("outcome") != "no_profiles_on_site":
            resolve_sitemap_includes(research)
            apply_v2(contract, research)
        if detail and contract.get("outcome") != "no_profiles_on_site":
            attach_detail_route(contract, detail)
        if research:
            contract["v2_research"] = v2_summary(research)
        return {"contract": contract, "v2": research}
    except Exception as e:
        # Fix (API-built contract, 2026-10-15)
        built = api_built_contract(category, research, detail, e) \
            if research and research.get("config") else None
        if built:
            apply_v2(built, research)
            attach_detail_route(built, detail)
            built["v2_research"] = v2_summary(research)
            return {"contract": built, "v2": research}
        if research:
            prev = u.diagnostics_of(e) or {}
            try:
                e.diagnostics = {**prev, "v2_research": v2_summary(research)}  # type: ignore[attr-defined]
            except AttributeError:
                pass
        raise


def _v2_budget() -> float:
    import os

    raw = os.environ.get("DISCO_V2_BUDGET")
    n = u.num(raw if raw is not None else 3)
    return u.as_int(n) if u.finite(n) and n else 3


def api_built_contract(
    _category: str, v2: dict, detail: dict | None, err: BaseException
) -> dict | None:
    """A contract built from the proven profile API when version 1 could not learn the page."""
    j = (detail or {}).get("json")
    cfg = v2.get("config") or {}
    pattern = cfg.get("profile_url_pattern") if isinstance(cfg.get("profile_url_pattern"),
                                                            str) else None
    probe = (detail or {}).get("probe") or {}
    if not pattern or probe.get("status") != "proven" or not probe.get("api") or not j:
        return None
    if j["must_have_share"] < 0.8 or len(j["fields"]) < 5 or j["median"] < 5:
        return None
    primary = "person" if any(fid.startswith("person.") for fid in j["fields"]) else "location"
    learned_at = u.iso_now()
    msg = u.err_message(err)[:300]
    purls = v2.get("profile_urls") or []
    return {
        "roster_pattern": None,
        "detail_pattern": pattern,
        "field_floor": j["median"],
        "detail_entity_type": "professional" if primary == "person" else "location",
        "extraction": {
            "list_source": "none",
            "site_contract": {
                "version": 3, "primary_subject": primary, "fields": {},
                "must_have": {"required": ["name", "phone|email", "city", "state"], "ok": True,
                              "missing": []},
                "address_owner": None, "unmapped": [], "unkeyed": [], "samples": purls[:10],
                "learned_at": learned_at, "site_entity_names": [], "built_from": "profile_api",
            },
            "best_route": {"route": "none", "reach_estimate": 0,
                           "basis": "version 1 did not run on the page"},
        },
        "site_contract_summary": {
            "fields": 0, "must_have_ok": True, "samples": j["items"],
            "field_floor_measured": j["median"], "field_floor_per_sample": j["per_item"],
            "built_from": "profile_api", "page_error": msg,
        },
        "route_report": {"fields_only": {"v2_led": True, "api_built": True, "page_error": msg}},
        "sample_detail_url": purls[0] if purls else None,
        "profile_sitemaps": [],
    }


# ---- save rule (2026-10-07) ---------------------------------------------------------------------
def saved_contract_check(
    db: u.Db, domain: str, category: str, fresh: dict, crawl_method: str
) -> dict:
    """Re-check the saved contract on the live site (up to 3 sample pages); a broken one is
    replaced, a working one only by a contract that is the same or better on every measure."""
    fresh_ext = fresh.get("extraction") if isinstance(fresh.get("extraction"), dict) else {}
    fresh_sc = fresh_ext.get("site_contract") if isinstance(fresh_ext.get("site_contract"),
                                                            dict) else {}
    fresh_br = fresh_ext.get("best_route") if isinstance(fresh_ext.get("best_route"), dict) else {}
    fresh_m = {
        "field_floor": u.as_int(u.num(fresh.get("field_floor")
                                      if fresh.get("field_floor") is not None else 0)),
        "must_have_ok": ((fresh_sc.get("must_have") or {}).get("ok") is True),
        "reach": fresh_br.get("reach_estimate") if u.is_num(fresh_br.get("reach_estimate"))
        else None,
    }
    row = db.row_or_none(
        "select detail_pattern, field_floor, extraction from disco_site_contract "
        "where domain = %s and category_slug = %s",
        (domain.lower(), category),
    )
    ext = (row or {}).get("extraction") if isinstance((row or {}).get("extraction"), dict) else {}
    saved_sc = ext.get("site_contract")
    if not row or not row.get("detail_pattern") or not saved_sc:
        return {"save": True, "reason": "no saved contract", "saved": None, "fresh": fresh_m,
                "live": []}
    saved_br = ext.get("best_route") if isinstance(ext.get("best_route"), dict) else {}
    saved_m = {
        "field_floor": row.get("field_floor"),
        "must_have_ok": (saved_sc.get("must_have") or {}).get("ok"),
        "reach": saved_br.get("reach_estimate") if u.is_num(saved_br.get("reach_estimate"))
        else None,
    }
    try:
        saved_re = u.js_re(row["detail_pattern"])
    except (ValueError, TypeError):
        saved_re = None
    samples = saved_sc.get("samples") if isinstance(saved_sc.get("samples"), list) else []
    urls = [x for x in samples if isinstance(x, str)][:3]
    names = {u.js_str(n).lower() for n in (saved_sc.get("site_entity_names") or [])}
    firm_signatures = set(saved_sc.get("firm_signatures") or [])
    sc = u.sc()

    def check(x: str) -> dict:
        r = u.safe(lambda: u.fetch_page(x, crawl_method), None)
        if u.page_did_not_load(r) or not r:
            return {"url": x, "ok": False,
                    "why": f"did not load (status {(r or {}).get('status') or 0})"}
        if saved_re and not saved_re.search(r["url"]) and not saved_re.search(x):
            return {"url": x, "ok": False, "why": f"redirected to {r['url']}"}
        try:
            res = sc.apply_site_contract(r["body"], r["url"], saved_sc, names,
                                         {"firmSignatures": firm_signatures})
            values = u.g(res, "values")
            mh = sc.record_must_have(values, saved_sc.get("primary_subject") or "person",
                                     saved_sc.get("name_owner"))
            if u.g(mh, "ok"):
                return {"url": x, "ok": True, "why": "works"}
            return {"url": x, "ok": False, "why": f"missing {', '.join(u.g(mh, 'missing') or [])}"}
        except Exception as e:  # noqa: BLE001
            return {"url": x, "ok": False, "why": f"check failed: {u.err_string(e)[:80]}"}

    live = u.parallel([lambda x=x: check(x) for x in urls])
    failed = len([x for x in live if not x["ok"]])
    if not urls or failed >= 2:
        reason = (f"saved contract no longer works ({failed} of {len(live)} sample pages fail)"
                  if urls else "saved contract has no sample pages to re-check")
        return {"save": True, "reason": reason, "saved": saved_m, "fresh": fresh_m, "live": live}
    worse: list[str] = []
    if saved_m["must_have_ok"] is True and not fresh_m["must_have_ok"]:
        worse.append("required fields")
    if saved_m["field_floor"] is not None and fresh_m["field_floor"] < saved_m["field_floor"]:
        worse.append(f"field floor {fresh_m['field_floor']} < {saved_m['field_floor']}")
    if saved_m["reach"] is not None and fresh_m["reach"] is not None \
            and fresh_m["reach"] < saved_m["reach"]:
        worse.append(f"route reach {fresh_m['reach']} < {saved_m['reach']}")
    if worse:
        return {"save": False,
                "reason": f"saved contract still works and the new one is worse: "
                          f"{'; '.join(worse)}",
                "saved": saved_m, "fresh": fresh_m, "live": live}
    return {"save": True, "reason": "new contract is the same or better on every measure",
            "saved": saved_m, "fresh": fresh_m, "live": live}
