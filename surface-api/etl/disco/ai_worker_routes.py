"""Listing navigation, background-call route (step 5), search-input route (step 6), the search
seed and the deferred route phase (dry runs). Port of `disco-ai-worker.ts`.

All reads; no AI picks a call or a value. Background calls count only on evidence (>= 3
profile links), paging is proven by replaying the next call, search inputs by two values that
return different profiles. Cookies and login/session headers are never kept.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from etl.disco import ai_worker_links as lk
from etl.disco import ai_worker_util as u
from etl.disco import search_route as sr
from etl.disco.ai_worker_discover import is_same_site

# ---- listing navigation (P3 pagination, pulled forward 2026-10-05) -----------------------------


def learn_navigation(
    listing: dict,
    home_url: str,
    detail_re: re.Pattern[str],
    roster_pattern: str | None,
    crawl_method: str,
) -> dict:
    """How to reach the next page of the listing and its sub-listings; each kept as verified only
    when fetching it yields profile links page 1 did not have."""
    links = lk.collect_page_links(listing["body"], listing["url"])
    page1 = lk.detail_link_set(links, detail_re)
    page1_set = set(page1)
    nav: dict[str, Any] = {
        "listing_url": listing["url"], "page1_detail_links": len(page1), "next_page": None,
        "sub_listings": None, "profile_links": [],
    }
    # Fix (sub-listings without profiles on page 1, 2026-10-07)
    no_page1 = len(page1) == 0
    lu = u.try_url(listing["url"])
    if lu:
        u.clear_hash(lu)
        listing_key = re.sub(r"/+$", "", lu.href)
    else:
        listing_key = listing["url"]

    def not_listing(h: str) -> bool:
        hk = re.sub(r"/+$", "", h)
        return hk != listing_key and hk != re.sub(r"/+$", "", home_url)

    # (a) next page: rel=next, then "page 2" URL, then a "Next" link.
    nxt: dict | None = None
    rel_next = next(
        (x for x in links if re.search(r"\bnext\b", x["rel"]) and not_listing(x["href"])), None
    )
    if rel_next:
        nxt = {"how": "rel_next", "url": rel_next["href"]}
    if not nxt:
        def numbered_ok(x: dict) -> bool:
            if not (not_listing(x["href"]) and x["href"] not in page1_set):
                return False
            if not lk.page_template(x["href"], listing["url"]):
                return False
            p = u.try_url(x["href"])
            if not p:
                return False
            vals = [int(v) for v in [*(v for _, v in p.search_params()), *p.pathname.split("/")]
                    if re.match(r"^\d+$", v)]
            return 2 in vals or any(2 < v <= 100 for v in vals)

        numbered = next((x for x in links if numbered_ok(x)), None)
        if numbered:
            nxt = {"how": "url_number", "url": numbered["href"]}
    if not nxt:
        text_next = next((
            x for x in links
            if not_listing(x["href"]) and x["href"] not in page1_set and (
                lk.NAV_NEXT_TEXT.search(x["label"])
                or re.search(r"\b(next|pagination-next|page-next)\b", x["cls"])
            )
        ), None)
        if text_next:
            nxt = {"how": "link_text", "url": text_next["href"]}
    if no_page1:
        nxt = None

    # (b) sub-listings: links that are not profiles, grouped by roster_pattern or parent path.
    def non_detail_ok(x: dict) -> bool:
        if not (not_listing(x["href"]) and x["href"] not in page1_set
                and x["href"] != (nxt or {}).get("url")):
            return False
        try:
            return not detail_re.search(x["href"])
        except Exception:  # noqa: BLE001
            return True

    non_detail = [x for x in links if non_detail_ok(x)]
    sub: dict | None = None
    if roster_pattern:
        try:
            rre = u.js_re(roster_pattern)
            urls = [x["href"] for x in non_detail
                    if rre.search(x["href"]) and not lk.page_template(x["href"], listing["url"])]
            if len(urls) >= 2:
                sub = {"pattern": roster_pattern, "source": "roster_pattern", "urls": urls}
        except ValueError:
            pass
    if not sub:
        listing_segs = [s.lower() for s in u.path_segs(lu)] if lu else []
        groups: dict[str, list[str]] = {}
        for x in non_detail:
            p = u.try_url(x["href"])
            if not p or p.search:
                continue
            segs = [s.lower() for s in u.path_segs(p)]
            if len(segs) <= len(listing_segs) or any(
                segs[i] != s for i, s in enumerate(listing_segs)
            ):
                continue
            parent = "/".join(segs[:-1])
            groups.setdefault(parent, []).append(x["href"])
        big = [(k, g) for k, g in groups.items() if len(g) >= 5]
        big.sort(key=lambda kv: -len(kv[1]))
        if big:
            parent, g = big[0]
            host = u.url_of(listing["url"]).host
            mid = f"{'/'.join(u.re_esc(s) for s in parent.split('/'))}/" if parent else ""
            sub = {"pattern": f"^https?://{u.re_esc(host)}/{mid}[^/?#]+/?$",
                   "source": "same_path_group", "urls": g}

    def new_links(r: dict | None) -> list[str]:
        if not r or not r.get("ok") or not r.get("body"):
            return []
        return [x for x in lk.detail_link_set(lk.collect_page_links(r["body"], r["url"]),
                                              detail_re) if x not in page1_set]

    need = min(3, len(page1)) if page1 else 3
    next_page, sub_page = u.parallel([
        (lambda: u.safe(lambda: u.fetch_page(nxt["url"], crawl_method), None))
        if nxt else (lambda: None),
        (lambda: u.safe(lambda: u.fetch_page(sub["urls"][0], crawl_method), None))
        if sub else (lambda: None),
    ])
    if nxt:
        n = len(new_links(next_page))
        template = lk.page_template(nxt["url"], listing["url"])
        max_page: int | None = None
        if template:
            tre = u.js_re("^" + u.re_esc(template).replace("\\{n\\}", "(\\d+)", 1) + "$")
            for x in links:
                m = tre.search(x["href"])
                if m:
                    max_page = max(max_page or 0, int(m.group(1)))
        nav["next_page"] = {"how": nxt["how"], "example_url": nxt["url"], "template": template,
                            "max_page_seen": max_page, "new_detail_links": n,
                            "verified": n >= need}
    if sub:
        n = len(new_links(sub_page))
        nav["sub_listings"] = {
            "pattern": sub["pattern"], "source": sub["source"],
            "count_on_listing": len(sub["urls"]), "examples": sub["urls"][:3],
            "example_checked": sub["urls"][0], "new_detail_links": n, "verified": n >= need,
        }
    pl: dict[str, None] = {}
    for x in [*new_links(next_page), *new_links(sub_page)]:
        pl[x] = None
    nav["profile_links"] = list(pl)[:40]
    if no_page1 and not (nav["sub_listings"] or {}).get("verified"):
        nav["skipped"] = "no profile links on the directory page itself"
    return nav


# ---- step 5 (2026-10-07): background calls (XHR / fetch) ----------------------------------------
NETWORK_CAPTURE_MS = 60_000
# Fix (replay time, 2026-10-07): 45 s (was 20 s).
NETWORK_REPLAY_MS = 45_000


def _status(call: Any) -> int | None:
    return u.g(call, "status_code")


def learn_network_route(
    *,
    page_url: str,
    scope: str,
    sub_listing_count: int,
    matches: Callable[[str], bool],
    known_profiles: list[str],
    crawl_method: str,
    deadline_at: float,
    judge: Callable[[str], dict],
    forced: bool,
    trigger_why: str,
) -> dict:
    """The directory page's background calls; one counts only when its JSON holds >= 3 profile
    links (or profile ids whose built links pass the page check). Paging is proven by replay."""
    nr = u.nr()
    started = u.now_ms()

    def left() -> float:
        return deadline_at - u.now_ms()

    head = {"trigger": f"forced (dry run); {trigger_why}" if forced else trigger_why,
            "captured_on": page_url, "scope": scope}
    if left() < 20_000:
        return {"status": "skipped", "reason": "time budget", **head}
    cap = u.capture_network_calls(page_url, {"timeoutMs": min(NETWORK_CAPTURE_MS, left() - 5_000)})
    if not cap.get("ok"):
        return {"status": "error",
                "reason": f"capture failed: {cap.get('error') or 'no result'}", **head,
                "failed_attempts": cap.get("failed_attempts"),
                "ms": u.as_int(u.now_ms() - started)}
    all_calls = list(nr.normalize_captured_calls(cap.get("content")))
    # Trackers, consent, bot-detection, monitoring and asset calls are dropped before checking.
    excluded: dict[str, int] = {}
    calls: list[Any] = []
    for c in all_calls:
        why = nr.noise_reason(u.g(c, "url"))
        if why:
            excluded[why] = excluded.get(why, 0) + 1
        else:
            calls.append(c)

    def cand_of(c: Any) -> dict:
        none = {"call": c, "json": None, "urls": [], "path": None, "via": None, "template": None,
                "record": None, "known": False}
        st = _status(c)
        if st is not None and (st < 200 or st >= 300):
            return {**none, "why": f"status {st}"}
        js = nr.parse_json_loose(u.g(c, "response_body"))
        if js is None:
            return {**none, "why": "not JSON"}
        p = nr.profile_urls_in_json(js, page_url, matches)
        purls = list(u.g(p, "urls") or [])
        if len(purls) >= 3:
            return {**none, "json": js, "urls": purls, "path": u.g(p, "path"), "via": "url",
                    "why": f"{len(purls)} profile links"}
        # Fix (links from record fields, 2026-10-07)
        rec = nr.record_template_hits(js, known_profiles, matches)
        if rec and len(u.g(rec, "urls") or []) >= 3:
            rurls = list(u.g(rec, "urls"))
            return {**none, "json": js, "urls": rurls, "path": u.g(rec, "array_path"),
                    "via": "record", "template": u.g(rec, "label"),
                    "record": {"array_path": u.g(rec, "array_path"),
                               "template": u.g(rec, "template")},
                    "why": f"{len(rurls)} records → profile links ({u.g(rec, 'label')})"}
        idh = nr.id_template_hits(js, known_profiles, matches)
        if idh and len(u.g(idh, "urls") or []) >= 3:
            iurls = list(u.g(idh, "urls"))
            known = bool(u.g(idh, "known_match"))
            return {**none, "json": js, "urls": iurls, "path": u.g(idh, "field_path"),
                    "via": "id", "template": u.g(idh, "template"), "known": known,
                    "why": f"{len(iurls)} profile IDs"
                           f"{' (match known profiles)' if known else ''}"}
        why = f"{len(purls)} profile links (3 needed)" if purls else "no profile links"
        return {**none, "json": js, "why": why}

    cands = [cand_of(c) for c in calls]

    def report() -> list[dict]:
        return [
            {"endpoint": nr.endpoint_key(c["call"]), "status": _status(c["call"]),
             "profiles": len(c["urls"]), "via": c["via"], "why": c["why"]}
            for c in sorted(cands, key=lambda c: -len(c["urls"]))[:15]
        ]

    base0: dict[str, Any] = {
        **head, "scrolled": cap.get("scrolled"), "actions": cap.get("actions"),
        **({"failed_attempts": cap["failed_attempts"]} if cap.get("failed_attempts") else {}),
        "calls_captured": len(all_calls), "calls_excluded": excluded,
        "calls_checked": len(calls),
    }
    hits = sorted([c for c in cands if c["via"]],
                  key=lambda c: (0 if c["via"] == "url" else 1, -len(c["urls"])))
    if not hits:
        reason = ("no background call lists profile links" if calls
                  else "the page made no background calls")
        return {"status": "none_found", "reason": reason, **base0, "calls": report(),
                "ms": u.as_int(u.now_ms() - started)}
    known_set = {
        re.sub(r"/+$", "", re.sub(r"[?#].*$", "", x)).lower() for x in known_profiles
    }
    best: dict | None = None
    for h in hits[:3]:
        if h["via"] == "url":
            best = h
            break
        probe = next((x for x in h["urls"] if re.sub(r"/+$", "", x).lower() not in known_set),
                     None)
        if not probe:
            h["why"] += "; every built link is an already known profile"
            continue
        if left() < 35_000:
            if h["via"] == "record":
                h["why"] += "; built link not checked (time budget)"
                best = h
                break
            h["why"] += "; built link not checked (time budget)"
            break
        v = judge(probe)
        if v.get("ok"):
            h["why"] += "; built link passed the page check"
            best = h
            break
        h["why"] += f"; built link failed the page check ({v.get('reason')})"
    if not best:
        return {"status": "none_found",
                "reason": "profile IDs found, but no built link passed the profile-page check",
                **base0, "calls": report(), "ms": u.as_int(u.now_ms() - started)}
    b = best

    def extract(js: Any) -> list[str]:
        if b["via"] == "record" and b["record"]:
            return list(nr.record_urls_at(js, b["record"]["array_path"], b["record"]["template"],
                                          matches))
        if b["via"] == "id" and b["template"] and b["path"]:
            return list(nr.id_urls_at(js, b["path"], b["template"], matches))
        return list(u.g(nr.profile_urls_in_json(js, page_url, matches), "urls") or [])

    # Paging: two captured calls to the same endpoint first, else a page/offset parameter.
    seen = set(b["urls"])
    paging: Any = None
    base = b["call"]
    for s in calls:
        if s is b["call"] or nr.endpoint_key(s) != nr.endpoint_key(b["call"]):
            continue
        later = nr.paging_from_two_calls(b["call"], s)
        earlier = None if later else nr.paging_from_two_calls(s, b["call"])
        if later or earlier:
            paging = later or earlier
            base = s if later else b["call"]
            sj = nr.parse_json_loose(u.g(s, "response_body"))
            if sj is not None:
                seen.update(extract(sj))
            break
    if not paging:
        paging = nr.paging_from_params(b["call"], len(b["urls"]))
    totals = nr.totals_in_json(b["json"], len(b["urls"]))
    total = u.g(totals, "total")
    total_pages = u.g(totals, "total_pages")
    headers = nr.replay_headers(u.g(base, "request_headers") or {})
    proof: dict[str, Any] = {"page1_profiles": len(b["urls"]), "next_value": None,
                             "next_new_profiles": 0, "proven": False,
                             "why": "no paging found in the call"}
    if paging:
        next_value = u.g(paging, "current") + u.g(paging, "step")
        proof["next_value"] = next_value
        nc = nr.call_with_page(base, u.g(paging, "key"), next_value)
        if not nc:
            proof["why"] = "could not build the next call"
        elif left() < 12_000:
            proof["why"] = "next call not tried (time budget)"
        else:
            r = u.fetch_api_call({
                "url": u.g(nc, "url"), "method": u.g(base, "method"), "headers": headers,
                "body": u.g(nc, "body"), "crawl_method": crawl_method,
                "timeoutMs": min(NETWORK_REPLAY_MS, left() - 2_000),
            })
            if not r.get("ok"):
                sc_ = r.get("status_code")
                if sc_ in (401, 403):
                    proof["why"] = f"next call refused (status {sc_}): needs a session, not used"
                else:
                    err = f": {r['error'][:120]}" if r.get("error") else ""
                    proof["why"] = f"next call failed (status {sc_ or 0}{err})"
            else:
                j = nr.parse_json_loose(r.get("content"))
                fresh = [] if j is None else [x for x in extract(j) if x not in seen]
                proof["next_new_profiles"] = len(fresh)
                need = min(3, len(b["urls"]))
                proof["proven"] = len(fresh) >= need
                if j is None:
                    proof["why"] = "next call did not return JSON"
                elif proof["proven"]:
                    proof["why"] = f"next call returned {len(fresh)} new profiles"
                else:
                    proof["why"] = f"next call returned {len(fresh)} new profiles ({need} needed)"
    page_size = (u.g(paging, "page_size") if paging else None) or len(b["urls"])
    reach: float = 0
    basis = ""
    if proof["proven"]:
        if total:
            reach = total
            basis = f"total stated by the call ({u.g(totals, 'total_key')})"
        elif total_pages and page_size:
            reach = total_pages * page_size
            basis = f"{total_pages} pages × {page_size} per page"
        else:
            reach = len(seen) + proof["next_new_profiles"]
            basis = "profiles on the pages fetched (no total stated): lower bound"
        if scope == "sub_listing" and sub_listing_count > 1:
            reach *= sub_listing_count
            basis += f" × {sub_listing_count} sub-listings (estimate)"
    ps = u.g(paging, "page_size") if paging else None
    return {
        "status": "proven" if proof["proven"] else "found_not_proven",
        "reason": proof["why"],
        **base0,
        "calls": report(),
        "route": {
            "method": u.g(base, "method"),
            "url": u.g(base, "url"),
            "body": u.g(base, "request_payload"),
            "headers": headers,
            "profile_links_at": b["path"],
            "id_template": b["template"] if b["via"] in ("id", "record") else None,
            "paging": paging,
            "page_size": ps if ps is not None else len(b["urls"]),
            "total": total,
            "total_pages": total_pages,
            "proof": proof,
        },
        "reach_estimate": reach,
        "basis": basis,
        "ms": u.as_int(u.now_ms() - started),
    }


# ---- step 6 (2026-10-07): search inputs ---------------------------------------------------------
SEARCH_CITY_SHORTLIST = 6
SEARCH_NAME_SAMPLE = 3000


def load_search_values(db: u.Db, kinds: set[str]) -> dict:
    """The largest cities (exp_us_cities), the most common ZIP among our professionals in each,
    and the commonest last-name starts: {cities, letters, bigrams}."""
    cities: list[dict] = []
    if "city" in kinds or "zip" in kinds:
        rows = db.rows_or_none(
            "select city, state_abbr, population from exp_us_cities "
            "order by population desc limit %s",
            (SEARCH_CITY_SHORTLIST,),
        ) or []
        cities = [{"city": u.js_str(r.get("city")), "state": u.js_str(r.get("state_abbr")),
                   "zip": None} for r in rows]
        if "zip" in kinds:
            for c in cities[:4]:
                zr = db.rows_or_none(
                    "select address_zip from professionals where address_city ilike %s "
                    "and address_state ilike %s and address_zip is not null limit 300",
                    (c["city"], c["state"]),
                ) or []
                counts: dict[str, int] = {}
                for r in zr:
                    z = str(r.get("address_zip") or "")[:5]
                    if re.match(r"^\d{5}$", z):
                        counts[z] = counts.get(z, 0) + 1
                ranked = sorted(counts.items(), key=lambda kv: -kv[1])
                c["zip"] = ranked[0][0] if ranked else None
    letters: list[str] = []
    bigrams: dict[str, str] = {}
    if "name" in kinds:
        rows = db.rows_or_none(
            "select last_name from professionals where last_name is not null limit %s",
            (SEARCH_NAME_SAMPLE,),
        ) or []
        ns = sr.name_starts([str(r.get("last_name") or "") for r in rows])
        letters, bigrams = ns["letters"], ns["bigrams"]
    return {"cities": cities, "letters": letters, "bigrams": bigrams}


def _boxes_report(boxes: list[dict]) -> list[dict]:
    return [{"label": b["label"], "kinds": b["kinds"],
             "form": f"{b['form']['method']} {b['form']['action']}" if b.get("form") else None}
            for b in boxes]


def _fields_with(form: dict, value: str) -> dict[str, str]:
    return {**form["fields"], form["inputName"]: value}


def learn_search_route(
    *,
    db: u.Db,
    page_url: str,
    page_html: str | None,
    boxes: list[dict],
    detail_re: re.Pattern[str],
    known_profiles: list[str],
    category_words: list[str],
    crawl_method: str,
    deadline_at: float,
    trigger: str,
) -> dict:
    """Search the directory's box with values from our own data. Proven when the first value
    returns >= 3 profile links and a second value returns >= 3 the first did not."""
    nr = u.nr()
    started = u.now_ms()

    def left() -> float:
        return deadline_at - u.now_ms()

    def matches(x: str) -> bool:
        try:
            return bool(detail_re.search(x))
        except Exception:  # noqa: BLE001
            return False

    head = {"trigger": trigger, "boxes": _boxes_report(boxes)}
    kinds = {k for b in boxes for k in b["kinds"]}
    vals = load_search_values(db, kinds)
    attempts: list[dict] = []

    # Fix (results-page menu links, 2026-10-08)
    on_search_page = {lk.page_key(x["href"]) for x in lk.collect_page_links(page_html, page_url)} \
        if page_html else set()

    def html_links(html: str, base: str) -> list[str]:
        merged: dict[str, None] = {}
        for x in lk.detail_link_set(lk.collect_page_links(html, base), detail_re):
            merged[x] = None
        for x in u.sc().embedded_entity_urls(html, base):
            if matches(x):
                merged[x] = None
        return [x for x in merged if lk.page_key(x) not in on_search_page]

    state: dict[str, Any] = {"last_calls": []}
    # Fix (script-only form results, 2026-10-08)
    shell_forms: set[int] = set()

    def capped_fetch(x: str, cap_ms: float) -> dict:
        return u.with_timeout(lambda: u.safe(lambda: u.fetch_page(x, crawl_method), u.miss(x)),
                              cap_ms, u.miss(x))

    def try_value(box: dict, value: str, allow_browser: bool = True) -> dict | None:
        state["last_calls"] = []
        form = box.get("form")
        # 1) a real form is submitted directly (fast, no browser)
        if form and id(box) not in shell_forms and left() > 25_000:
            fields = _fields_with(form, value)
            if form["method"] == "GET":
                x = u.url_of(form["action"])
                for k, v in fields.items():
                    u.set_search_param(x, k, v)
                r = capped_fetch(x.href, min(40_000, left() - 5_000))
                urls = html_links(r["body"], r["url"]) if r["ok"] else []
                if r["ok"] and not urls and lk.is_empty_shell(r["body"]):
                    shell_forms.add(id(box))
                    state["last_calls"] = ["form result is script-only; typing in the browser"]
                if len(urls) >= 3:
                    tpl = u.url_of(form["action"])
                    for k, v in fields.items():
                        u.set_search_param(tpl, k, "__VALUE__" if k == form["inputName"] else v)
                    stated = sr.stated_total_in_text(r["body"], category_words)
                    return {"how": "form_get", "urls": urls,
                            "stated": stated["total"] if stated else None,
                            "request": {"method": "GET",
                                        "url": tpl.href.replace("__VALUE__", "{value}", 1),
                                        "body": None, "value_at": f"query:{form['inputName']}"},
                            "path": None, "template": None, "html": r["body"], "finalUrl": r["url"]}
            else:
                body = u.search_params_string(fields)
                r = u.fetch_api_call({
                    "url": form["action"], "method": "POST",
                    "headers": {"content-type": "application/x-www-form-urlencoded"},
                    "body": body, "crawl_method": crawl_method,
                    "timeoutMs": min(40_000, left() - 5_000),
                })
                content = r.get("content")
                urls = html_links(content, form["action"]) if r.get("ok") and content else []
                if r.get("ok") and not urls and lk.is_empty_shell(content or ""):
                    shell_forms.add(id(box))
                    state["last_calls"] = ["form result is script-only; typing in the browser"]
                if len(urls) >= 3:
                    tpl_body = u.search_params_string(
                        {**form["fields"], form["inputName"]: "__VALUE__"}
                    ).replace("__VALUE__", "{value}", 1)
                    stated = sr.stated_total_in_text(content, category_words) if content else None
                    return {"how": "form_post", "urls": urls,
                            "stated": stated["total"] if stated else None,
                            "request": {"method": "POST", "url": form["action"], "body": tpl_body,
                                        "value_at": f"form:{form['inputName']}"},
                            "path": None, "template": None, "html": content or "",
                            "finalUrl": form["action"]}
        # 2) typed into the box in the browser; the background calls carry the results.
        if not allow_browser or left() < 35_000:
            return None
        cap = u.capture_network_calls(page_url, {
            "timeoutMs": min(60_000, left() - 5_000),
            "typeInput": {"xpath": box["inputXpath"], "value": value,
                          "submitXpath": box["submitXpath"]},
        })
        if not cap.get("ok"):
            state["last_calls"] = [f"capture failed: {cap.get('error') or ''}"[:120]]
            return None
        best: dict | None = None
        for c in nr.normalize_captured_calls(cap.get("content")):
            if nr.noise_reason(u.g(c, "url")):
                continue
            if len(state["last_calls"]) < 6:
                state["last_calls"].append(nr.endpoint_key(c))
            st = _status(c)
            if st is not None and (st < 200 or st >= 300):
                continue
            js = nr.parse_json_loose(u.g(c, "response_body"))
            if js is None:
                continue
            urls = [x for x in (u.g(nr.profile_urls_in_json(js, page_url, matches), "urls") or [])
                    if lk.page_key(x) not in on_search_page]
            path = None
            template = None
            if len(urls) < 3:
                rec = nr.record_template_hits(js, known_profiles, matches)
                if rec:
                    urls = list(u.g(rec, "urls") or [])
                    path = u.g(rec, "array_path")
                    template = u.g(rec, "label")
            if len(urls) < 3 or (best and len(best["urls"]) >= len(urls)):
                continue
            # which request field carries the typed value
            p = next((f for f in nr.call_params(c)
                      if isinstance(u.g(f, "value"), str)
                      and value.lower() in str(u.g(f, "value")).lower()), None)
            value_at = None
            if p:
                ref = u.g(p, "ref") or {}
                param = u.g(ref, "param")
                value_at = (f"{u.g(ref, 'where')}:{f'{param}.' if param else ''}"
                            f"{'.'.join(u.g(ref, 'path') or [])}")
            best = {
                "how": "browser_call", "urls": urls,
                "stated": u.g(nr.totals_in_json(js, len(urls)), "total"),
                "request": {"method": u.g(c, "method"), "url": u.g(c, "url"),
                            "body": u.g(c, "request_payload"), "value_at": value_at,
                            "headers": nr.replay_headers(u.g(c, "request_headers") or {})},
                "path": path, "template": template,
            }
        return best

    kind_order = ["zip", "city", "name"]
    # Fix (next box sooner, 2026-10-08)
    for box in boxes[:3]:
        box_misses = 0
        next_box = False
        for kind in [k for k in kind_order if k in box["kinds"]]:
            lists = sr.search_values(kind, vals["cities"], vals["letters"], vals["bigrams"])
            first: dict | None = None
            format_idx = -1
            for variants in lists[:3]:
                if left() < 25_000:
                    break
                got: dict | None = None
                if first:
                    order = [variants[format_idx] if 0 <= format_idx < len(variants)
                             else variants[0]]
                else:
                    order = variants
                for vi, v in enumerate(order):
                    if left() < 25_000:
                        break
                    if vi > 0 and (not box.get("form") or id(box) in shell_forms):
                        break  # typed boxes: first format only
                    hit = try_value(box, v, vi == 0)
                    first_urls = first["hit"]["urls"] if first else []
                    fresh_n = len([x for x in hit["urls"] if x not in first_urls]) if hit else 0
                    att: dict[str, Any] = {
                        "kind": kind, "value": v, "how": hit["how"] if hit else "no profiles",
                        "profiles": len(hit["urls"]) if hit else 0, "fresh": fresh_n,
                        "stated": hit["stated"] if hit else None,
                    }
                    if state["last_calls"]:
                        att["calls"] = state["last_calls"]
                    attempts.append(att)
                    if hit:
                        got = {"hit": hit, "value": v, "format": format_idx if first else vi}
                        break
                if not got:
                    if not first:
                        box_misses += 1
                        if box_misses >= 2:
                            next_box = True
                            break
                    continue
                if not first:
                    first = got
                    format_idx = got["format"]
                    continue
                fresh = [x for x in got["hit"]["urls"] if x not in first["hit"]["urls"]]
                if len(fresh) < 3:
                    continue
                # proven: two values return different profiles.
                next_page: dict | None = None
                fh = first["hit"]
                if fh["how"] == "form_get" and fh.get("html") and fh.get("finalUrl") \
                        and left() > 30_000:
                    links = lk.collect_page_links(fh["html"], fh["finalUrl"])
                    nx = next((x for x in links if re.search(r"\bnext\b", x["rel"])), None) or \
                        next((x for x in links if lk.NAV_NEXT_TEXT.search(x["label"])), None)
                    if nx:
                        r = capped_fetch(nx["href"], min(30_000, left() - 5_000))
                        more = len([x for x in html_links(r["body"], r["url"])
                                    if x not in fh["urls"]]) if r["ok"] else 0
                        next_page = {
                            "template": lk.page_template(nx["href"], fh["finalUrl"]) or nx["href"],
                            "new_profiles": more,
                        }
                all_ = set(fh["urls"]) | set(got["hit"]["urls"])
                formats = (["ZIP"] if kind == "zip" else
                           ["City, ST", "City ST", "City"] if kind == "city" else
                           ["initial", "two-letter start"])
                rule = (
                    "last-name starts in the order our professionals' names use them"
                    if kind == "name" else
                    "largest US cities (exp_us_cities by population)"
                    + (", most common ZIP among our professionals in each" if kind == "zip" else "")
                )
                return {
                    "status": "proven",
                    "reason": f'"{first["value"]}" returned {len(fh["urls"])} profiles and '
                              f'"{got["value"]}" {len(fresh)} new',
                    **head,
                    "attempts": attempts,
                    "route": {
                        "kind": kind,
                        "format": formats[format_idx] if 0 <= format_idx < len(formats)
                        else formats[0],
                        "how": fh["how"],
                        "request": fh["request"],
                        "profile_links_at": fh["path"],
                        "id_template": fh["template"],
                        "inputs": {"rule": rule, "tried": [first["value"], got["value"]]},
                        "per_input": {"profiles": [len(fh["urls"]), len(got["hit"]["urls"])],
                                      "stated": [fh["stated"], got["hit"]["stated"]]},
                        "next_page": next_page,
                    },
                    "reach_estimate": len(all_),
                    "basis": "distinct profiles from the 2 values tried (lower bound; the "
                             "harvest's input list decides the real reach)",
                    "ms": u.as_int(u.now_ms() - started),
                }
            if next_box:
                break
            if first:
                return {"status": "found_not_proven",
                        "reason": f'"{first["value"]}" returned profiles but no second value '
                                  "returned new ones",
                        **head, "attempts": attempts, "route": None,
                        "ms": u.as_int(u.now_ms() - started)}
    reason = ("no search value returned profile links" if attempts
              else "no value could be tried (time budget)")
    return {"status": "none_found", "reason": reason, **head, "attempts": attempts,
            "ms": u.as_int(u.now_ms() - started)}


# ---- step 6 follow-up (2026-10-07): search supplies the first profile candidates --------------
_SEED_EXT_RE = re.compile(r"\.(xml|pdf|jpe?g|png|gif|svg|css|js)(\?|$)", re.IGNORECASE)


def search_seed_candidates(
    *, db: u.Db, pages: list[dict], site_root: str, crawl_method: str, deadline_at: float
) -> dict:
    """When a run has no candidates, the site's own search box (first value from our own data)
    supplies them: {urls, report}."""
    nr = u.nr()

    def left() -> float:
        return deadline_at - u.now_ms()

    # Fix (search pages, 2026-10-08): boxes from every page given, at most 3; boxes labelled for
    # one kind of value come before catch-all site-search boxes, page order otherwise.
    pairs: list[dict] = []
    for p in pages:
        for b in sr.find_search_inputs(p["html"], p["url"]):
            pairs.append({"page": p, "box": b, "i": len(pairs)})
    picked = sorted(pairs, key=lambda x: (1 if len(x["box"]["kinds"]) >= 3 else 0, x["i"]))[:3]
    pages_checked = [p["url"] for p in pages]
    if not picked:
        return {"urls": [], "report": {"status": "no search box", "pages": pages_checked}}
    skip = {lk.page_key(p["url"]) for p in pages}

    def keep(x: str) -> bool:
        if not is_same_site(x, site_root) or lk.page_key(x) in skip:
            return False
        p = u.try_url(x)
        if not p:
            return False
        return len(u.path_segs(p)) >= 1 and not _SEED_EXT_RE.search(x)

    vals = load_search_values(db, {k for x in picked for k in x["box"]["kinds"]})
    tries: list[dict] = []
    # Fix (results-page menu links, 2026-10-08)
    menu_links: dict[str, set[str]] = {}

    def on_page(page: dict) -> set[str]:
        s = menu_links.get(page["url"])
        if s is None:
            s = {lk.page_key(x["href"]) for x in lk.collect_page_links(page["html"], page["url"])}
            menu_links[page["url"]] = s
        return s

    for pk in picked:
        page, box = pk["page"], pk["box"]
        form_shell = False  # Fix (script-only form results, 2026-10-08)
        box_misses = 0  # Fix (next box sooner, 2026-10-08)
        for kind in [k for k in ("zip", "city", "name") if k in box["kinds"]]:
            if box_misses >= 2:
                break
            box_misses += 1
            lists = sr.search_values(kind, vals["cities"], vals["letters"], vals["bigrams"])
            variants = lists[0] if lists else []
            for value in variants:
                if left() < 20_000:
                    return {"urls": [], "report": {"status": "time budget",
                                                   "pages": pages_checked, "tries": tries}}
                form = box.get("form")
                if form and not form_shell:
                    fields = _fields_with(form, value)
                    html = ""
                    base = form["action"]
                    if form["method"] == "GET":
                        x = u.url_of(form["action"])
                        for k, v in fields.items():
                            u.set_search_param(x, k, v)
                        href = x.href
                        r = u.with_timeout(
                            lambda href=href: u.safe(lambda: u.fetch_page(href, crawl_method),
                                                     u.miss(href)),
                            min(40_000, left() - 5_000), u.miss(href),
                        )
                        if r["ok"]:
                            html = r["body"]
                            base = r["url"]
                    else:
                        r = u.fetch_api_call({
                            "url": form["action"], "method": "POST",
                            "headers": {"content-type": "application/x-www-form-urlencoded"},
                            "body": u.search_params_string(fields), "crawl_method": crawl_method,
                            "timeoutMs": min(40_000, left() - 5_000),
                        })
                        if r.get("ok") and r.get("content"):
                            html = r["content"]
                    menu = on_page(page)
                    urls = [x for x in lk.collect_detail_urls(html, base, lk.LINK_CANDIDATE_CAP)
                            if keep(x) and lk.page_key(x) not in menu] if html else []
                    if html and not urls and lk.is_empty_shell(html):
                        form_shell = True
                    how = f"form_{form['method'].lower()}"
                    tries.append({"page": page["url"], "box": box["label"], "kind": kind,
                                  "value": value,
                                  "how": f"{how}{' (script-only result)' if form_shell else ''}",
                                  "links": len(urls)})
                    if len(urls) >= 3:
                        return {"urls": urls, "report": {
                            "status": "candidates found", "page": page["url"], "box": box["label"],
                            "kind": kind, "value": value, "how": how, "pages": pages_checked,
                            "tries": tries}}
                if left() < 35_000:
                    continue
                cap = u.capture_network_calls(page["url"], {
                    "timeoutMs": min(60_000, left() - 5_000),
                    "typeInput": {"xpath": box["inputXpath"], "value": value,
                                  "submitXpath": box["submitXpath"]},
                })
                found: dict[str, None] = {}
                seen_calls: list[str] = []
                if cap.get("ok"):
                    for c in nr.normalize_captured_calls(cap.get("content")):
                        if nr.noise_reason(u.g(c, "url")):
                            continue
                        if len(seen_calls) < 6:
                            seen_calls.append(nr.endpoint_key(c))
                        js = nr.parse_json_loose(u.g(c, "response_body"))
                        if js is None:
                            continue
                        pg = page
                        hits = nr.profile_urls_in_json(
                            js, page["url"],
                            lambda x, pg=pg: keep(x) and lk.page_key(x) not in on_page(pg),
                        )
                        for x in u.g(hits, "urls") or []:
                            found[x] = None
                how = "browser_call" if cap.get("ok") else \
                    f"browser failed: {cap.get('error') or ''}"[:120]
                tries.append({"page": page["url"], "box": box["label"], "kind": kind,
                              "value": value, "how": how, "links": len(found),
                              "calls": seen_calls})
                if len(found) >= 3:
                    return {"urls": list(found), "report": {
                        "status": "candidates found", "page": page["url"], "box": box["label"],
                        "kind": kind, "value": value, "how": "browser_call",
                        "pages": pages_checked, "tries": tries}}
                break  # one browser try per kind
    return {"urls": [], "report": {"status": "no candidates from search", "pages": pages_checked,
                                   "tries": tries}}


# ---- step 6 follow-up (2026-10-07): route search as a second call (dry runs) ------------------
def run_deferred_routes(st: dict, *, force_network: bool = False,
                        force_search: bool = False) -> dict:
    """{dry_run, phase: 'routes', state}: only the network-call and search routes, from the
    routes_state a first dry run returned. Read-only; the page check has no AI step."""
    started = u.now_ms()
    deadline = started + 262_000
    db = u.db()
    try:
        detail_re = u.js_re(st["detail_pattern"])
    except (ValueError, TypeError, KeyError):
        return {"error": "bad detail_pattern"}

    def matches(x: str) -> bool:
        try:
            return bool(detail_re.search(x))
        except Exception:  # noqa: BLE001
            return False

    cm = st["crawl_method"]
    home_url = f"https://{st['domain']}/"
    home = u.with_timeout(lambda: u.safe(lambda: u.fetch_page(home_url, cm), None), 45_000, None)
    site_entity_names = u.sc().collect_site_entity_names(home["body"]) \
        if home and home.get("ok") else set()

    def judge(url: str) -> dict:
        r = u.with_timeout(lambda: u.safe(lambda: u.fetch_page(url, cm), None), 30_000, None)
        if not r or u.page_did_not_load(r):
            return {"ok": False, "reason": "did not load"}
        ev = u.sc().page_entity_evidence(r["body"], r["url"], site_entity_names,
                                         "person" if st["person"] else "location")
        if u.g(ev, "kind") == "listing":
            return {"ok": False, "reason": "listing page"}
        if u.g(ev, "kind") == "profile":
            return {"ok": True, "reason": "one entity tied to the page"}
        if matches(r["url"]):
            return {"ok": True, "reason": "loads, matches the profile rule, not a listing"}
        return {"ok": False, "reason": f"redirected to {r['url']}"}

    static = st["static"]
    cov = sr.needs_more_routes(static["reach"], static["lower_bound"], st.get("stated_total"))
    if not st.get("network_page"):
        network: dict = {"status": "skipped", "reason": "no directory page"}
    elif not force_network and not cov["more"]:
        network = {"status": "skipped", "reason": f"not needed: {cov['why']}"}
    else:
        def run_network() -> dict:
            try:
                return learn_network_route(
                    page_url=st["network_page"], scope=st["scope"],
                    sub_listing_count=st["sub_listing_count"], matches=matches,
                    known_profiles=st["known_profiles"], crawl_method=cm,
                    deadline_at=deadline - 90_000, judge=judge,
                    forced=bool(force_network) and not cov["more"], trigger_why=cov["why"],
                )
            except Exception as e:  # noqa: BLE001
                return {"status": "error", "reason": u.err_string(e)[:200]}

        network = u.with_timeout(
            run_network, max(1_000, deadline - 90_000 - u.now_ms()),
            {"status": "skipped", "reason": "time budget (did not finish in time)"},
        )
    network_reach = (network.get("reach_estimate") or 0) if network["status"] == "proven" else 0
    stated = max(st.get("stated_total") or 0,
                 ((network.get("route") or {}).get("total") or 0)) or None
    cov2 = sr.needs_more_routes(max(static["reach"], network_reach),
                                network_reach <= static["reach"] and static["lower_bound"], stated)
    boxes: list[dict] = []
    search_page: str | None = None
    search_html = ""
    for x in st.get("search_pages") or []:
        if u.now_ms() > deadline - 60_000:
            break
        r = u.with_timeout(lambda x=x: u.safe(lambda: u.fetch_page(x, cm), None), 30_000, None)
        if r and r.get("ok"):
            boxes = sr.find_search_inputs(r["body"], r["url"])
            if boxes:
                search_page = r["url"]
                search_html = r["body"]
                break
    if not boxes or not search_page:
        search: dict = {"status": "skipped",
                        "reason": "no search box on the directory page or homepage"}
    elif not force_search and not cov2["more"]:
        search = {"status": "skipped", "reason": f"not needed: {cov2['why']}"}
    else:
        sp = search_page

        def run_search() -> dict:
            try:
                return learn_search_route(
                    db=db, page_url=sp, page_html=search_html, boxes=boxes, detail_re=detail_re,
                    known_profiles=st["known_profiles"], category_words=st["count_words"],
                    crawl_method=cm, deadline_at=deadline,
                    trigger=f"forced (dry run); {cov2['why']}"
                    if force_search and not cov2["more"] else cov2["why"],
                )
            except Exception as e:  # noqa: BLE001
                return {"status": "error", "reason": u.err_string(e)[:200]}

        search = u.with_timeout(
            run_search, max(1_000, deadline - u.now_ms()),
            {"status": "skipped", "reason": "time budget (did not finish in time)"},
        )
    search_reach = (search.get("reach_estimate") or 0) if search["status"] == "proven" else 0
    if search_reach > max(static["reach"], network_reach):
        best = {"route": "search_input", "reach_estimate": search_reach,
                "basis": f"search inputs: {search.get('basis') or ''}",
                "search_input": search.get("route")}
    elif network_reach > static["reach"]:
        best = {"route": "network_call", "reach_estimate": network_reach,
                "basis": f"network call: {network.get('basis') or ''}",
                "network_call": network.get("route")}
    else:
        best = {"route": static["route"], "reach_estimate": static["reach"],
                "basis": static["basis"]}
    return {"network_calls": network, "search_inputs": search, "best_route": best,
            "run_ms": u.as_int(u.now_ms() - started)}
