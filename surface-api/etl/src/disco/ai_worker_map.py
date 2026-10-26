"""§3 map_site — the parser-learner (port of `mapSite` in `disco-ai-worker.ts`).

Reads only: homepage, robots.txt, sitemaps, the directory page, candidate profile pages and
sample pages; the AI judges candidate pages and proposes extraction rules; code builds the
profile URL rule, checks every rule on every sample and measures the routes. Returns the
contract (the worker saves it through the governed RPC) or raises MapSiteError with
diagnostics.
"""
from __future__ import annotations

import re
import time
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag
from bs4.element import PreformattedString

from surfaces.etl.disco import ai_worker_classify as cl
from surfaces.etl.disco import ai_worker_discover as dc
from surfaces.etl.disco import ai_worker_links as lk
from surfaces.etl.disco import ai_worker_routes as rt
from surfaces.etl.disco import ai_worker_util as u
from surfaces.etl.disco import search_route as sr
from surfaces.etl.disco.ai_worker_tools import (
    CONTRACT_TOOL,
    ENTITY_PAGE_TOOL,
    LOCATOR_TOOL,
    NO_PROFILES_TOOL,
    PATTERN_TOOL,
    match_extra_tool,
)

SITEMAP_MAX_TOP = 6  # top-level sitemaps fetched per run
SITEMAP_MAX_CHILDREN = 3  # children sampled per sitemap index
SITEMAP_MAX_DEPTH = 2  # index -> index -> urlset at most
SITEMAP_MAX_FETCHES = 10  # hard cap on sitemap fetches per mapSite run
SITEMAP_LOCS_READ = 500  # <loc> values read per sitemap document
SITEMAP_CANDIDATE_CAP = 40  # same cap step 0 already used

INCONCLUSIVE_REASON_RE = re.compile(
    r"\b(404|not found|page not found|blocked|access denied|captcha|error page|not accessible"
    r"|unavailable|forbidden)\b",
    re.IGNORECASE,
)
SEARCH_PAGE_RE = re.compile(r"\b(search|find|locator|locate|lookup)\b", re.IGNORECASE)


def load_previous_contract(db: u.Db, domain: str, category: str) -> dict | None:
    """C10: the domain's latest site contract for this category (None when none or version < 3)."""
    try:
        data = db.row(
            "select extraction, learned_at from disco_site_contract "
            "where domain = %s and category_slug = %s order by learned_at desc limit 1",
            (domain, category),
        )
        ext = (data or {}).get("extraction")
        sc = ext.get("site_contract") if isinstance(ext, dict) else None
        return sc if isinstance(sc, dict) and u.numz(sc.get("version")) >= 3 else None
    except Exception:  # noqa: BLE001
        return None


def _entity_prompt(cat_block: str, r: dict, embedded: list[Any]) -> str:
    return (
        cat_block
        + "\nDoes this page describe ONE identifiable person, professional, or business, or is "
        "it a "
        "directory / search-form / marketing page? Answer via the return_entity_page tool with "
        'is_entity_page, entity_kind ("person" if the page describes one person, "business" if '
        "one business/office), "
        "and fits_category (true only if the page's subject belongs to the category above as "
        "defined).\n\n"
        f"URL: {r['url']}\n\n"
        + (f"RECORDS EMBEDDED IN THE PAGE DATA (first {len(embedded)}):\n"
           f"{u.js_json(embedded)[:3000]}\n\n" if embedded else "")
        + f"HTML (truncated):\n{r['body'][:12000]}"
    )


def _uniq(xs: list[Any]) -> list[Any]:
    out: dict[Any, None] = {}
    for x in xs:
        out[x] = None
    return list(out)


def _sig(e: Any) -> str:
    if not isinstance(e, Tag) or isinstance(e, BeautifulSoup) or (e.name or "") in (
        "script", "style"
    ):
        return ""
    raw_id = e.get("id")
    raw_id = " ".join(raw_id) if isinstance(raw_id, list) else raw_id
    id_ = f"#{raw_id}" if raw_id and not re.search(r"\d{3,}", raw_id) else ""
    raw_cls = e.get("class")
    raw_cls = " ".join(raw_cls) if isinstance(raw_cls, list) else str(raw_cls or "")
    cls = "".join(f".{c}" for c in sorted(
        c for c in re.split(r"\s+", raw_cls) if c and not re.search(r"\d{3,}", c) and len(c) < 30
    ))
    ip = e.get("itemprop")
    ip = f"[itemprop={ip}]" if ip else ""
    return f"{e.name}{id_}{cls}{ip}"


_CHROME_TAGS = {"header", "nav", "footer"}
_CHROME_ROLES = {"navigation", "banner", "contentinfo"}


def _in_chrome(el: Tag) -> bool:
    n: Any = el
    while isinstance(n, Tag) and not isinstance(n, BeautifulSoup):
        if (n.name or "") in _CHROME_TAGS or n.get("role") in _CHROME_ROLES:
            return True
        n = n.parent
    return False


def _blocks(sample: dict) -> list[dict]:
    """Text blocks of a sample page outside the site chrome, keyed by structure."""
    doc = u.sc().doc_of(sample)
    soup = doc["$"] if doc is not None else None
    if soup is None:
        return []
    out: list[dict] = []
    for el in soup.select("body *"):
        if el.name in ("script", "style", "noscript", "svg", "header", "nav", "footer", "head"):
            continue
        if _in_chrome(el):
            continue
        own = "".join(
            str(c) for c in el.children
            if isinstance(c, NavigableString) and not isinstance(c, PreformattedString)
        )
        own = re.sub(r"\s+", " ", own).strip()
        if not own or len(own) > 300:
            continue
        par = el.parent
        out.append({"key": f"{_sig(par.parent if par is not None else None)} > {_sig(par)} > "
                           f"{_sig(el)}",
                    "text": own})
    return out


def map_site(
    api_key: str,
    model: str,
    category: str,
    domain: str,
    boundary: dict | None,
    crawl_method: str = "server_crawl",
    retry: dict | None = None,
    opts: dict | None = None,
) -> dict:
    sc = u.sc()
    opts = opts or {}
    map_started_at = u.now_ms()
    # Fix (fields only after version 2, 2026-10-14)
    v2_led = bool(opts.get("v2Led")) and len(opts.get("profileUrls") or []) > 0

    # Fix (early fetch caps, 2026-10-07)
    def run_left() -> int:
        return 270_000 - (u.now_ms() - map_started_at)

    def capped_fetch(url: str, cap_ms: float, method: str | None = None) -> dict:
        m = method or crawl_method
        return u.with_timeout(lambda: u.safe(lambda: u.fetch_page(url, m), u.miss(url)),
                              max(1_000, min(cap_ms, run_left())), u.miss(url))

    # Fix (plain fetch for sitemaps, 2026-10-08)
    plain_method = "server_crawl" if crawl_method == "needs_js_api" else crawl_method
    # Fix (report before the limit, 2026-10-08)
    progress: dict[str, Any] = opts.get("progress") if opts.get("progress") is not None else {}

    def mark(step: str, extra: dict | None = None) -> None:
        progress.update(extra or {})
        progress["step"] = step
        progress["at_ms"] = u.now_ms() - map_started_at

    db = u.db()
    extra_hints = cl.get_dynamic_roster_hints(db, category)
    prof_terms = [h for h in extra_hints if not h.startswith("find ") and not h.startswith("our ")
                  and not h.startswith("meet ") and not h.endswith(" directory")]

    # Category context, loaded once for every category-fit judgement below.
    cat_row = db.row_or_none(
        "select display_name, entity_type from gbp_categories where gcid = %s", (category,)
    )
    cat_boundary = boundary
    if not (cat_boundary or {}).get("definition"):
        b = db.row_or_none(
            "select definition, includes, excludes from exp_category_boundary where gcid = %s",
            (category,),
        )
        if b:
            cat_boundary = b
    cb = cat_boundary or {}
    cat_name = (cat_row or {}).get("display_name")
    cat_name = cat_name if cat_name is not None else category
    excl = [u.js_str(e.get("type")) for e in (cb.get("excludes") or [])
            if isinstance(e, dict) and e.get("type")]
    cat_block = (
        f"CATEGORY: {cat_name} ({category})\n"
        + (f"DEFINITION: {cb['definition']}\n" if cb.get("definition") else "")
        + (f"INCLUDES: {'; '.join(u.js_str(x) for x in cb['includes'])}\n"
           if cb.get("includes") else "")
        + (f"EXCLUDES: {'; '.join(excl)}\n" if cb.get("excludes") else "")
    )

    # Homepage first — probed with the already-known crawl method.
    mark("homepage")
    home_fetched = capped_fetch(f"https://{domain}/", 60_000)
    if not home_fetched["ok"] and not v2_led:
        raise RuntimeError(
            f"homepage fetch failed ({home_fetched['status']}"
            f"{home_fetched.get('networkError') or ''})"
        )
    home_missing = not home_fetched["ok"]
    home = home_fetched if home_fetched["ok"] else {
        **home_fetched, "body": "", "url": f"https://{domain}/"
    }
    # The site's own brand/firm entity names — never page-specific evidence.
    site_entity_names = set(sc.collect_site_entity_names(home["body"]))

    site_root = re.sub(r"^www\.", "", domain.lower())
    home_host = u.host_of(home["url"])
    roster_ranked = lk.rank_roster_links(home["body"], home["url"], extra_hints)
    best_roster = roster_ranked[0]["href"] if roster_ranked and roster_ranked[0]["score"] > 0 \
        else None

    # Fix (no AI prediction, 2026-10-06): hints are no longer used.
    hints: dict | None = None
    hints_diag: dict | None = (retry or {}).get("hintsDiag")
    hint_directory: dict | None = None

    roster_host = u.host_of(
        (retry or {}).get("rosterUrl") or (hint_directory or {}).get("url") or best_roster or ""
    )
    # robots.txt of other same-site subdomains that positively-scored roster links point to
    extra_hosts: list[str] = []
    if retry and retry.get("host") and retry["host"] != home_host:
        extra_hosts.append(retry["host"])
    for link in [] if v2_led else roster_ranked:
        if len(extra_hosts) >= lk.ROBOTS_MAX_SUBDOMAINS:
            break
        if link["score"] <= 0:
            break
        h = u.host_of(link["href"])
        if not h:
            continue
        if h != home_host and h not in extra_hosts:
            extra_hosts.append(h)
        if len(extra_hosts) >= lk.ROBOTS_MAX_SUBDOMAINS:
            break
    subdomain_robots: list[dict] = []
    subdomain_sitemaps: list[str] = []
    robots_fetched = u.parallel([
        (lambda h=h: capped_fetch(f"https://{h}/robots.txt", 20_000, plain_method))
        for h in extra_hosts
    ])
    for ri, h in enumerate(extra_hosts):
        rb = robots_fetched[ri]
        sms = [x for x in lk.extract_robots_sitemaps(rb["body"]) if dc.is_same_site(x, site_root)] \
            if rb["ok"] else []
        subdomain_robots.append({"host": h, "status": rb["status"], "sitemaps": sms})
        subdomain_sitemaps.extend(sms)

    is_person_category = (cat_row or {}).get("entity_type") != "location"
    cat_terms = dc.load_category_terms(db, category, "person" if is_person_category else "place")
    generic_tokens = lk.GENERIC_PERSON_TOKENS if is_person_category else lk.GENERIC_PLACE_TOKENS
    head_words = lk.head_tokens([*cat_terms["terms"], *prof_terms])

    # Fix (sitemap order, 2026-10-05)
    def sitemap_pick_score(x: str) -> int:
        return (
            lk.sitemap_relevance(x, prof_terms) + lk.host_relevance(x, site_root, prof_terms)
            + (2 if head_words and any(any(lk.tok_eq(t, h) for h in head_words)
                                       for t in lk.url_path_tokens(x)) else 0)
        )

    # 0. sitemap-derived candidates. Bounded breadth-first walk.
    sitemap_candidates: list[str] = []
    sitemap_trace: list[dict] = []
    parent_of: dict[str, str] = {}
    sitemap_family: dict[str, int] = {}
    from_of: dict[str, str] = {}
    sitemap_score: dict[str, int] = {}
    sitemap_pool_urls: list[str] = []
    try:
        if v2_led:
            raise RuntimeError("sitemap walk skipped: version 2 list route")
        dom = domain.lower()
        dom_row = db.row_or_none("select sitemap_url from exp_etl_domains where domain = %s",
                                 (dom,))
        src_row = db.row_or_none(
            "select recon from exp_etl_sources where source_domain = %s and gcid = %s",
            (dom, category),
        )
        recon = (src_row or {}).get("recon")
        recon_sitemaps = recon.get("sitemaps") if isinstance(recon, dict) else None
        raw_top: list[str] = [*subdomain_sitemaps]
        if isinstance((dom_row or {}).get("sitemap_url"), str):
            raw_top.append(dom_row["sitemap_url"])
        if isinstance(recon_sitemaps, list):
            raw_top.extend(s for s in recon_sitemaps if isinstance(s, str))
        visited: set[str] = set()
        top: list[str] = []
        for s in raw_top:
            x = dc.clean_url(s)
            if not x or not dc.is_same_site(x, dom) or re.search(r"\.gz$", x, re.IGNORECASE) \
                    or x in visited:
                continue
            visited.add(x)
            top.append(x)
        queue = [
            {"url": t["url"], "depth": 0}
            for t in sorted(
                ({"url": x, "i": i, "s": sitemap_pick_score(x)} for i, x in enumerate(top)),
                key=lambda t: (-t["s"], t["i"]),
            )[:SITEMAP_MAX_TOP]
        ]
        pool: list[dict] = []
        fetches = 0
        while queue and fetches < SITEMAP_MAX_FETCHES:
            item = queue.pop(0)
            url, depth = item["url"], item["depth"]
            fetches += 1
            sm_fallback = {"ok": False, "status": 0, "body": "", "url": url}
            sm = u.with_timeout(lambda url=url: u.fetch_page(url, plain_method), 25_000,
                                sm_fallback)
            # Fix (sitemap retry, 2026-10-06): one retry when a sitemap file errors.
            if not sm["ok"] or sm["status"] >= 400:
                time.sleep(1.5)
                sm = u.with_timeout(lambda url=url: u.fetch_page(url, plain_method), 25_000,
                                    sm_fallback)
            if not sm["ok"] or sm["status"] >= 400:
                sitemap_trace.append({"url": url, "depth": depth, "kind": "error",
                                      "status": sm["status"], "locs": 0})
                continue
            locs = [x for x in lk.extract_locs(sm["body"], SITEMAP_LOCS_READ)
                    if dc.is_same_site(x, dom)]
            if lk.is_sitemap_index(sm["body"]):
                children = [c for c in locs if not re.search(r"\.gz$", c, re.IGNORECASE)
                            and c not in visited]
                sampled: list[str] = []
                if depth + 1 <= SITEMAP_MAX_DEPTH:
                    sampled = [x["c"] for x in sorted(
                        ({"c": c, "i": i, "s": sitemap_pick_score(c)}
                         for i, c in enumerate(children)),
                        key=lambda x: (-x["s"], x["i"]),
                    )[:SITEMAP_MAX_CHILDREN]]

                    # Fix (sitemap spread, 2026-10-07)
                    def fam(x: str) -> str:
                        return re.sub(r"\d+", "#", x)

                    top0 = sampled[0] if sampled else None
                    if top0:
                        family = [c for c in children if fam(c) == fam(top0)]
                        if len(family) >= 4:
                            sampled = _uniq([family[0], family[len(family) // 2], family[-1]])
                        for c in sampled:
                            if fam(c) == fam(top0):
                                sitemap_family[c] = len(family)
                    for c in sampled:
                        visited.add(c)
                        parent_of[c] = url
                        queue.append({"url": c, "depth": depth + 1})
                sitemap_trace.append({"url": url, "depth": depth, "kind": "index",
                                      "status": sm["status"], "locs": len(locs),
                                      "sampled": sampled})
            else:
                from_score = lk.sitemap_relevance(url, prof_terms) + lk.host_relevance(
                    url, site_root, prof_terms)
                for x in locs:
                    pool.append({"url": x, "from": url, "fromScore": from_score})
                sitemap_trace.append({"url": url, "depth": depth, "kind": "urlset",
                                      "status": sm["status"], "locs": len(locs)})
        ranked = sorted(
            ({"u": p["url"], "from": p["from"], "i": i,
              "s": lk.sitemap_relevance(p["url"], prof_terms)
              + lk.host_relevance(p["url"], site_root, prof_terms)
              + (1 if roster_host and u.host_of(p["url"]) == roster_host else 0),
              "f": p["fromScore"]} for i, p in enumerate(pool)),
            key=lambda r: (-r["s"], -r["f"], r["i"]),
        )
        seen_c: set[str] = set()
        sorted_unique: list[str] = []
        for r in ranked:
            if r["u"] in seen_c:
                continue
            seen_c.add(r["u"])
            sitemap_score[r["u"]] = r["s"]
            sorted_unique.append(r["u"])
            sitemap_pool_urls.append(r["u"])
            from_of[r["u"]] = r["from"]
        # Diversify: round-robin across URL-shape groups, groups ordered by first appearance.
        groups: dict[str, list[str]] = {}
        for x in sorted_unique:
            groups.setdefault(lk.url_template(x), []).append(x)
        lists = list(groups.values())
        k = 0
        while len(sitemap_candidates) < SITEMAP_CANDIDATE_CAP:
            any_ = False
            for g in lists:
                if k < len(g):
                    any_ = True
                    sitemap_candidates.append(g[k])
                    if len(sitemap_candidates) >= SITEMAP_CANDIDATE_CAP:
                        break
            if not any_:
                break
            k += 1
    except Exception:  # noqa: BLE001, S110  (no sitemap — fall through)
        pass

    # 1. roster / directory page
    mark("directory page", {"sitemap_trace": sitemap_trace})
    roster_page = home
    if v2_led:
        roster_url = None
    elif retry:
        roster_url = retry["rosterUrl"]
    elif hint_directory:
        roster_url = hint_directory["url"]
    else:
        roster_url = best_roster
    if not roster_url and not v2_led:
        links = lk.extract_all_links(home["body"], home["url"])
        if links:
            roster_url = u.with_timeout(
                lambda: cl.pick_roster_link_with_llm(api_key, model, category, cat_boundary, links,
                                                     u.MAP_TEMPERATURE),
                max(1_000, min(30_000, run_left())), None,
            )
    if hint_directory and roster_url == hint_directory["url"]:
        roster_page = hint_directory
    elif roster_url:
        r = capped_fetch(roster_url, 45_000)
        if r["ok"]:
            roster_page = r

    # 2. one detail page that fits this category (person pages preferred).
    embedded_roster_urls = list(sc.embedded_entity_urls(roster_page["body"], roster_page["url"]))
    link_candidates = [
        *embedded_roster_urls,
        *(x for x in lk.collect_detail_urls(roster_page["body"], roster_page["url"],
                                            lk.LINK_CANDIDATE_CAP)
          if x not in embedded_roster_urls),
    ]
    page_key = lk.page_key
    not_candidate = {page_key(x) for x in [roster_page["url"], home["url"],
                                            (retry or {}).get("rosterUrl") or ""] if x}

    def on_site(x: str) -> bool:
        p = u.try_url(x)
        if not p:
            return False
        h = re.sub(r"^www\.", "", p.hostname.lower())
        d = re.sub(r"^www\.", "", domain.lower())
        return h == d or h.endswith(f".{d}")

    given_profiles = [x for x in (opts.get("profileUrls") or []) if on_site(x)][:60]
    for x in reversed(given_profiles):
        if x not in sitemap_pool_urls:
            sitemap_pool_urls.insert(0, x)
    if given_profiles:
        mark("profile urls from version 2", {"given_profiles": len(given_profiles)})
    pre_all = [
        *given_profiles,
        *(x for x in sitemap_candidates if sitemap_score.get(x, 0) > 0),
        *(x for x in link_candidates if x not in sitemap_candidates),
        *(x for x in sitemap_candidates if sitemap_score.get(x, 0) <= 0),
    ]
    first_idx: dict[str, int] = {}
    for i, x in enumerate(pre_all):
        first_idx.setdefault(x, i)
    pre_order = [x for i, x in enumerate(pre_all)
                 if page_key(x) not in not_candidate and first_idx[x] == i]

    # Fix (search pages, 2026-10-08)
    def search_seed_pages() -> list[dict]:
        first = [{"html": roster_page["body"], "url": roster_page["url"]}]
        last = [{"html": home["body"], "url": home["url"]}] if roster_page is not home else []
        seen = {page_key(p["url"]) for p in [*first, *last]}
        linked: list[str] = []
        for link in [lnk for p in [*first, *last] for lnk in lk.extract_all_links(p["html"],
                                                                                  p["url"])]:
            if len(linked) >= 2:
                break
            p = u.try_url(link["href"])
            if not p:
                continue
            path = re.sub(r"[-_/.]+", " ", p.pathname)
            if not SEARCH_PAGE_RE.search(link["text"]) and not SEARCH_PAGE_RE.search(path):
                continue
            if re.search(r"\.(pdf|xml|jpe?g|png|gif|svg|css|js)(\?|$)", link["href"], re.IGNORECASE) \
                    or page_key(link["href"]) in seen:
                continue
            seen.add(page_key(link["href"]))
            linked.append(link["href"])
        fetched = u.parallel([(lambda x=x: capped_fetch(x, 30_000)) for x in linked]) \
            if linked and run_left() > 100_000 else []
        extra = [{"html": r["body"], "url": r["url"]} for r in fetched
                 if r["ok"] and not u.page_did_not_load(r)]
        return [*first, *extra, *last]

    def run_search_seed(deadline_at: float) -> dict:
        def go() -> dict:
            try:
                return rt.search_seed_candidates(db=db, pages=search_seed_pages(),
                                                 site_root=site_root, crawl_method=crawl_method,
                                                 deadline_at=deadline_at)
            except Exception as e:  # noqa: BLE001
                return {"urls": [], "report": {"status": "error",
                                               "error": u.err_string(e)[:200]}}

        return u.with_timeout(go, max(1_000, deadline_at + 5_000 - u.now_ms()),
                              {"urls": [], "report": {"status": "time budget"}})

    # Step 6 follow-up: no candidates at all -> the site's own search box supplies them.
    search_seed: dict | None = None
    mark("search seed", {"roster_url": roster_page["url"],
                         "candidates_before_seed": len(pre_order)})
    if not pre_order and run_left() > 120_000:
        search_seed = run_search_seed(map_started_at + 150_000)
    base_order = [*pre_order, *(
        x for x in (search_seed or {}).get("urls", [])
        if page_key(x) not in not_candidate and x not in pre_order
    )]
    score_candidate = lk.make_candidate_scorer(
        heads=head_words,
        generic=generic_tokens,
        negatives=lk.negative_tokens(cat_terms["negatives"],
                                     [*cat_terms["terms"], *prof_terms, *generic_tokens]),
        roster_url=None if roster_page is home else roster_page["url"],
        profile_hint=(hints or {}).get("profile_url_example"),
    )
    # Pinned on the first pass only; a self-heal pass already tried it.
    pinned = [*given_profiles[:3],
              *([hints["profile_url_example"]] if not retry and hints
                and hints.get("profile_url_example") else [])]
    roster_link_set = set(link_candidates)

    # Fix (keep sitemap/host evidence, 2026-10-05) + Fix (directory links first, 2026-10-05)
    def evidence_score(x: str) -> int:
        host = max(0, lk.host_relevance(x, site_root, prof_terms))
        sitemap = max(0, sitemap_score.get(x, 0) - host) if x in sitemap_score else 0
        on_roster = 1 if roster_page is not home and x in roster_link_set else 0
        return score_candidate(x) + sitemap + 2 * host + on_roster

    ranked_candidates = lk.rank_detail_candidates(base_order, evidence_score, pinned)
    candidates = [c["url"] for c in ranked_candidates]
    detail: dict | None = None
    detail_candidate_url: str | None = None
    detail_entity_type: str | None = None
    detail_entity_type_source: str | None = None
    fallback: dict | None = None
    tried: list[dict] = []
    mark("profile page check", {**({"search_seed": search_seed["report"]} if search_seed else {}),
                                "tried": tried})
    candidate_batch = candidates[: lk.MAP_DETAIL_TRIES + len(pinned)]
    rnd = 0
    while rnd < 2 and candidate_batch:
        for url in candidate_batch:
            if run_left() < 60_000:
                tried.append({"url": url, "ok": False, "status": 0, "jsonld_entity": False,
                              "llm_entity": None, "reason": "skipped (time budget)"})
                break
            r = capped_fetch(url, 45_000)
            if not r["ok"]:
                tried.append({"url": url, "ok": False, "status": r["status"],
                              "jsonld_entity": False, "llm_entity": None,
                              "reason": "fetch failed", "error": r.get("networkError"),
                              "body_len": len(r["body"]), "rendered": r.get("rendered")})
                continue
            if u.page_did_not_load(r):
                tried.append({"url": url, "ok": False, "status": r["status"],
                              "jsonld_entity": False, "llm_entity": None,
                              "reason": f"did not load (status {r['status']})",
                              "body_len": len(r["body"]), "rendered": r.get("rendered")})
                continue
            # Fix (profile-page check, 2026-10-06)
            page_ev = sc.page_entity_evidence(r["body"], r["url"], site_entity_names,
                                              "person" if is_person_category else "location")
            if u.g(page_ev, "kind") == "listing":
                tried.append({"url": url, "ok": True, "status": r["status"],
                              "jsonld_entity": False, "llm_entity": None,
                              "reason": f"listing page: {u.g(page_ev, 'entities')} entities, "
                                        "none tied to the page"})
                continue
            jsonld_ok = u.g(page_ev, "kind") == "profile"
            embedded = [] if jsonld_ok else list(sc.collect_embedded_entities(r["body"]))[:3]
            if not jsonld_ok and not embedded and not lk.has_entity_data(r["body"]):
                tried.append({"url": url, "ok": True, "status": r["status"],
                              "jsonld_entity": False, "llm_entity": None,
                              "reason": "no page-specific JSON-LD entity and no entity data"})
                continue
            verdict: Any = None
            try:
                rr, emb = r, embedded
                verdict = u.with_timeout(
                    lambda rr=rr, emb=emb: u.call_claude_map(
                        api_key, model, _entity_prompt(cat_block, rr, emb), ENTITY_PAGE_TOOL, 256),
                    max(1_000, min(30_000, run_left())), None,
                )
            except Exception:
                if not jsonld_ok:
                    raise
            vd = verdict if isinstance(verdict, dict) else {}
            if not jsonld_ok and vd.get("is_entity_page") is not True:
                reason = "page check timed out" if verdict is None else \
                    f"LLM: not an entity page — {u.js_str(vd.get('reason') or '')}"
                tried.append({"url": url, "ok": True, "status": r["status"],
                              "jsonld_entity": False, "llm_entity": False, "reason": reason})
                continue
            llm_entity = None if jsonld_ok else True
            if vd.get("fits_category") is not True:
                tried.append({"url": url, "ok": True, "status": r["status"],
                              "jsonld_entity": jsonld_ok, "llm_entity": llm_entity,
                              "reason": f"not this category: {u.js_str(vd.get('reason') or '')}"})
                continue
            if vd.get("entity_kind") == "person":
                kind, source = "professional", "llm"
            elif vd.get("entity_kind") == "business":
                kind, source = "location", "llm"
            else:
                detected = lk.detect_page_entity_kind_detailed(r["body"], site_entity_names,
                                                               r["url"])
                kind, source = detected["kind"], detected["source"]
            if prof_terms and kind != "professional":
                if not fallback:
                    fallback = {"url": url, "r": r, "kind": kind, "source": source}
                tried.append({"url": url, "ok": True, "status": r["status"],
                              "jsonld_entity": jsonld_ok, "llm_entity": llm_entity,
                              "reason": "accepted (business page; still looking for a person "
                                        "page)"})
                continue
            tried.append({"url": url, "ok": True, "status": r["status"],
                          "jsonld_entity": jsonld_ok, "llm_entity": llm_entity,
                          "reason": "accepted"})
            detail = r
            detail_candidate_url = url
            detail_entity_type = kind
            detail_entity_type_source = source
            break
        # Fix (search after failed candidates, 2026-10-08)
        if v2_led or detail or fallback or rnd > 0 or search_seed or run_left() < 120_000:
            break
        mark("search after failed candidates", {"tried": tried})
        search_seed = run_search_seed(min(map_started_at + 200_000, u.now_ms() + 100_000))
        tried_keys = {page_key(t["url"]) for t in tried}
        seed_urls = [x for x in search_seed["urls"]
                     if page_key(x) not in not_candidate and page_key(x) not in tried_keys]
        candidate_batch = [c["url"] for c in lk.rank_detail_candidates(
            seed_urls, evidence_score, [])][: lk.MAP_DETAIL_TRIES]
        rnd += 1
    if not detail and fallback:
        detail = fallback["r"]
        detail_candidate_url = fallback["url"]
        detail_entity_type = fallback["kind"]
        detail_entity_type_source = fallback["source"]
    if not detail:
        return _no_detail(
            api_key=api_key, model=model, category=category, domain=domain, boundary=boundary,
            crawl_method=crawl_method, retry=retry, hints=hints, hints_diag=hints_diag,
            tried=tried, roster_page=roster_page, home=home, candidates=candidates,
            sitemap_trace=sitemap_trace, subdomain_robots=subdomain_robots,
            link_candidates=link_candidates, ranked_candidates=ranked_candidates,
            embedded_roster_urls=embedded_roster_urls, search_seed=search_seed,
            site_root=site_root, run_left=run_left,
        )
    return _learn_contract(locals())


def _no_detail(
    *, api_key: str, model: str, category: str, domain: str, boundary: dict | None,
    crawl_method: str, retry: dict | None, hints: dict | None, hints_diag: dict | None,
    tried: list[dict], roster_page: dict, home: dict, candidates: list[str],
    sitemap_trace: list[dict], subdomain_robots: list[dict], link_candidates: list[str],
    ranked_candidates: list[dict], embedded_roster_urls: list[str], search_seed: dict | None,
    site_root: str, run_left: Any,
) -> dict:
    """No profile page passed: ask once where profiles live; self-heal once onto another
    subdomain of the same site, or report no_profiles_on_site, else raise MapSiteError."""

    # P0: the message says what the tried pages were, not just how many candidates existed.
    def why(t: dict) -> str:
        if not t["ok"]:
            return "did not load"
        if t["reason"].startswith("not this category"):
            return "another category"
        if t["reason"].startswith("no page-specific"):
            return "no profile data"
        return "not a profile page"

    why_counts: dict[str, int] = {}
    for t in tried:
        why_counts[why(t)] = why_counts.get(why(t), 0) + 1
    why_text = ", ".join(f"{n} {k}" for k, n in why_counts.items())
    no_detail_msg = (
        f"no fetchable entity detail page found from {roster_page['url']} "
        f"({len(candidates)} candidates; tried {len(tried)}"
        f"{f': {why_text}' if why_text else ''})"
    )
    ok_count = len([t for t in tried if t["ok"]])
    has_urlset = any(t["kind"] == "urlset" and t["locs"] > 0 for t in sitemap_trace)
    gate_passed = ok_count >= 3 and (has_urlset or len(link_candidates) > 0)
    diagnostics: dict[str, Any] = {
        "tried": tried,
        "sitemap_trace": sitemap_trace,
        "subdomain_robots": subdomain_robots,
        "roster_url": roster_page["url"],
        "gate": "passed" if gate_passed else "failed",
        **({"mapper_hints": hints_diag} if hints_diag else {}),
        "candidate_scores": ranked_candidates[: lk.MAP_DETAIL_TRIES + 4],
        "embedded_roster_urls": len(embedded_roster_urls),
        **({"search_seed": search_seed["report"]} if search_seed else {}),
    }
    heal_url: str | None = None
    heal_verdict: Any = None
    if gate_passed:
        try:
            home_links = lk.extract_all_links(home["body"], home["url"])[:50]
            b = boundary or {}
            boundary_text = f"\nCATEGORY DEFINITION: {b['definition']}" if b.get("definition") \
                else ""
            tried_lines = "\n".join(f"- {t['url']} ({t['reason']})" for t in tried)
            link_lines = "\n".join(f"- {x['href']} {x['text']}" for x in home_links)
            verdict = u.call_claude_map(
                api_key,
                model,
                f"CATEGORY: {category}{boundary_text}\nDOMAIN: {domain}\n"
                f"ROSTER PAGE URL: {roster_page['url']}\n\n"
                f"PAGES TRIED:\n{tried_lines}\n\n"
                f"HOMEPAGE LINKS (same-site, up to 50):\n{link_lines}\n\n"
                "Does this website host individual profile pages for professionals in this "
                "category, one page per person or office? "
                f"Pages on any subdomain of {site_root} are part of this website. "
                "If not, where do those profiles live? Answer via the return_profile_availability "
                "tool.",
                NO_PROFILES_TOOL,
                512,
            )
            vd = verdict if isinstance(verdict, dict) else {}
            diagnostics["ai_verdict"] = vd.get("hosts_profiles")
            diagnostics["where_profiles_live"] = vd.get("where_profiles_live")
            diagnostics["note"] = vd.get("note")
            diagnostics["profiles_url"] = vd.get("profiles_url")
            pu = dc.clean_url(u.js_str(vd.get("profiles_url")
                                       if vd.get("profiles_url") is not None else ""))
            pu_ok = u.try_url(pu) is not None

            def same_page(a: str, c: str) -> bool:
                return re.sub(r"/+$", "", re.sub(r"[?#].*$", "", a)) == \
                    re.sub(r"/+$", "", re.sub(r"[?#].*$", "", c))

            if (
                not retry and pu_ok and dc.is_same_site(pu, site_root)
                and not same_page(pu, roster_page["url"]) and not same_page(pu, home["url"])
                and not any(same_page(t["url"], pu) for t in tried)
            ):
                diagnostics["self_heal"] = {"profiles_url": pu}
                heal_url = pu
                heal_verdict = vd
            if not heal_url and vd.get("hosts_profiles") == "no":
                return {
                    "outcome": "no_profiles_on_site",
                    "evidence": {
                        "ai_verdict": "no",
                        "where_profiles_live": vd.get("where_profiles_live"),
                        "note": vd.get("note"),
                        "roster_url": roster_page["url"],
                        "tried": tried,
                        "sitemap_trace": sitemap_trace,
                        "subdomain_robots": subdomain_robots,
                        "profiles_url": vd.get("profiles_url"),
                        **({"self_heal": {"from_host": retry["host"],
                                          "roster_url": retry["rosterUrl"],
                                          "reason": retry["reason"]}} if retry else {}),
                    },
                }
        except Exception as e:  # noqa: BLE001
            diagnostics["llm_error"] = u.err_string(e)
    # Fix (self-heal time guard, 2026-10-08)
    if heal_url and run_left() < 90_000:
        diagnostics["self_heal"] = {
            "profiles_url": heal_url,
            "skipped": f"time budget ({u.js_round(run_left() / 1000)} s left)",
        }
        heal_url = None
    if heal_url:
        # Self-heal once: profiles live on another subdomain of this same company site.
        try:
            return map_site(api_key, model, category, domain, boundary, crawl_method, {
                "host": u.host_of(heal_url),
                "rosterUrl": heal_url,
                "reason": u.js_str((heal_verdict or {}).get("where_profiles_live")
                                   if (heal_verdict or {}).get("where_profiles_live") is not None
                                   else ""),
                "hints": hints,
                "hintsDiag": hints_diag,
            })
        except u.MapSiteError as e:
            e.diagnostics["first_pass"] = {
                "tried": tried, "roster_url": roster_page["url"],
                "ai_verdict": (heal_verdict or {}).get("hosts_profiles"),
                "profiles_url": heal_url,
            }
            raise
    raise u.MapSiteError(no_detail_msg, diagnostics)


def _learn_contract(v: dict[str, Any]) -> dict:
    """Steps 3+ of map_site once a profile page was accepted (`v` = map_site's locals)."""
    sc = u.sc()
    api_key: str = v["api_key"]
    model: str = v["model"]
    category: str = v["category"]
    domain: str = v["domain"]
    boundary: dict | None = v["boundary"]
    crawl_method: str = v["crawl_method"]
    retry: dict | None = v["retry"]
    opts: dict = v["opts"]
    db: u.Db = v["db"]
    map_started_at: int = v["map_started_at"]
    run_left = v["run_left"]
    capped_fetch = v["capped_fetch"]
    mark = v["mark"]
    v2_led: bool = v["v2_led"]
    home: dict = v["home"]
    home_missing: bool = v["home_missing"]
    roster_page: dict = v["roster_page"]
    detail: dict = v["detail"]
    detail_candidate_url: str | None = v["detail_candidate_url"]
    detail_entity_type: str | None = v["detail_entity_type"]
    detail_entity_type_source: str | None = v["detail_entity_type_source"]
    tried: list[dict] = v["tried"]
    pinned: list[str] = v["pinned"]
    link_candidates: list[str] = v["link_candidates"]
    sitemap_pool_urls: list[str] = v["sitemap_pool_urls"]
    sitemap_trace: list[dict] = v["sitemap_trace"]
    subdomain_robots: list[dict] = v["subdomain_robots"]
    from_of: dict[str, str] = v["from_of"]
    parent_of: dict[str, str] = v["parent_of"]
    sitemap_family: dict[str, int] = v["sitemap_family"]
    site_entity_names: set[str] = v["site_entity_names"]
    is_person_category: bool = v["is_person_category"]
    head_words: list[str] = v["head_words"]
    given_profiles: list[str] = v["given_profiles"]
    search_seed: dict | None = v["search_seed"]
    embedded_roster_urls: list[str] = v["embedded_roster_urls"]
    cat_block: str = v["cat_block"]
    hints_diag: dict | None = v["hints_diag"]

    # Taxonomy layer: the category's registry keys, loaded once.
    taxonomy_rows = db.rows_or_none(
        "select node_slug, node_name, node_description, schema_type, schema_property, "
        "entity_scope, owns_lane from exp_vertical_node_registry "
        "where gcid = %s and is_active = true",
        (category,),
    ) or []

    # 3. the contract, with the boundary for field relevance
    b = boundary or {}
    boundary_block = ""
    if b.get("definition"):
        boundary_block = f"CATEGORY BOUNDARY (use it to judge which fields matter):\n" \
                         f"{b['definition']}\n"
        if b.get("includes"):
            boundary_block += f"Includes: {'; '.join(u.js_str(x) for x in b['includes'])}\n"

    # Fix (pattern coverage, 2026-10-05): other links with the same parent path.
    detail_parent = lk.parent_key(detail["url"])
    known_non_detail = {home["url"], roster_page["url"],
                        *([retry["rosterUrl"]] if retry and retry.get("rosterUrl") else [])}
    same_parent_pool: list[str] = []
    seen_pool = {detail["url"], *([detail_candidate_url] if detail_candidate_url else [])}
    for x in [*link_candidates, *sitemap_pool_urls,
              *lk.collect_detail_urls(detail["body"], detail["url"], lk.LINK_CANDIDATE_CAP)]:
        if len(same_parent_pool) >= 200:
            break
        if x in seen_pool or x in known_non_detail:
            continue
        seen_pool.add(x)
        if detail_parent and lk.parent_key(x) == detail_parent:
            same_parent_pool.append(x)
    same_path_block = (
        "OTHER LINKS WITH THE SAME PATH AS THE DETAIL PAGE (from the directory page and "
        "sitemaps; most are usually other profiles, a few may be listing pages):\n"
        + "\n".join(same_parent_pool[:12]) + "\n\n"
    ) if same_parent_pool else ""

    contract_prompt = (
        f'You are writing a deterministic parser contract for {domain} (category "{category}").\n'
        + boundary_block
        + f"\nROSTER PAGE URL: {roster_page['url']}\nDETAIL PAGE URL: {detail['url']}\n\n"
        + same_path_block
        + "From the detail-page markup below, enumerate EVERY field it exposes (JSON-LD keys, "
        "__NEXT_DATA__ paths, or stable CSS selectors) and emit a contract via the "
        "return_site_contract tool:\n"
        "- roster_pattern: a REGULAR EXPRESSION matched against a URL, true for roster/listing "
        'pages on this site (e.g. "/agents/[a-z-]+/?$")\n'
        "- detail_pattern: a REGULAR EXPRESSION matched against a URL, true for entity detail "
        "pages, generalised from the URL above (REQUIRED). "
        "Its variable part must accept every profile URL form seen in the same-path links (e.g. "
        "both numeric ids and name slugs), not only the characters of one example\n"
        "- field_floor: how many distinct fields the detail page offers (must be at least 5, "
        "count honestly)\n"
        "- extraction: if the detail page has application/ld+json script tags containing the "
        "entity's data, "
        'set list_source to "jsonld", json_path to the array of keys from the JSON-LD root down '
        "to the entity "
        "object (or list of entity objects), and field_map to our field names mapped to the "
        "JSON-LD's own key "
        'names, e.g. { "list_source": "jsonld", "json_path": ["mainEntity"], "field_map": { '
        '"bio": "description", "phone": "telephone" } }. '
        'If there is no JSON-LD entity data, set list_source to "none".\n\n'
        f"DETAIL PAGE MARKUP (truncated):\n{detail['body'][:40000]}"
    )
    inp: Any = u.call_claude_map(api_key, model, contract_prompt, CONTRACT_TOOL, 4096)

    # Deterministic URL-pattern check with one corrective retry.
    must_match = [detail["url"]]
    if detail_candidate_url and detail_candidate_url != detail["url"]:
        must_match.append(detail_candidate_url)
    must_not_set: dict[str, None] = {}
    ambiguous_same_path: list[str] = []

    def add_must_not(x: str | None) -> None:
        if x:
            must_not_set[x] = None

    add_must_not(home["url"])
    add_must_not(roster_page["url"])
    add_must_not((retry or {}).get("rosterUrl"))
    for t in tried:
        # Fix (hint guess, 2026-10-05)
        if t["url"] in pinned:
            continue
        # Fix (pattern coverage, 2026-10-05): same-path entity page of another kind.
        if t["reason"].startswith("not this category") and detail_parent \
                and lk.parent_key(t["url"]) == detail_parent:
            ambiguous_same_path.append(t["url"])
            continue
        if INCONCLUSIVE_REASON_RE.search(t["reason"]):
            continue
        if (
            t["reason"].startswith("LLM: not an entity page")
            or t["reason"].startswith("not this category")
            or t["reason"].startswith("no page-specific JSON-LD")
            or t["reason"].startswith("listing page")
        ):
            add_must_not(t["url"])
    must_match_set = set(must_match)
    must_not_match = [x for x in must_not_set if x not in must_match_set][:20]

    # Fix (code-built profile rule, 2026-10-06)
    def over_time(ms: int) -> bool:
        return u.now_ms() - map_started_at > ms

    rejected_tried = {t["url"] for t in tried if not t["reason"].startswith("accepted")}

    def time_left() -> int:
        return 270_000 - (u.now_ms() - map_started_at)

    def judge_url(url: str) -> dict:
        if time_left() < 5_000:
            return {"url": url, "ok": False, "reason": "skipped (time budget)",
                    "inconclusive": True}
        r = u.with_timeout(lambda: u.safe(lambda: u.fetch_page(url, crawl_method), None),
                           min(30_000, time_left()), None)
        if u.page_did_not_load(r):
            return {"url": url, "ok": False,
                    "reason": f"did not load (status {(r or {}).get('status') or 0})",
                    "inconclusive": True}
        ev = sc.page_entity_evidence(r["body"], r["url"], site_entity_names,
                                     "person" if is_person_category else "location")
        if u.g(ev, "kind") == "listing":
            return {"url": url, "ok": False,
                    "reason": f"listing page ({u.g(ev, 'entities')} entities, none tied)", "r": r}
        embedded = [] if u.g(ev, "kind") == "profile" else \
            list(sc.collect_embedded_entities(r["body"]))[:3]
        try:
            vv = u.with_timeout(
                lambda: u.call_claude_map(api_key, model, _entity_prompt(cat_block, r, embedded),
                                          ENTITY_PAGE_TOOL, 256),
                min(30_000, time_left()), None,
            )
        except Exception:  # noqa: BLE001
            return {"url": url, "ok": False, "reason": "check failed", "r": r,
                    "inconclusive": True}
        if vv is None:
            return {"url": url, "ok": False, "reason": "check timed out", "r": r,
                    "inconclusive": True}
        vd = vv if isinstance(vv, dict) else {}
        reason_raw = u.js_str(vd.get("reason") if vd.get("reason") is not None else "")
        if vd.get("is_entity_page") is not True:
            return {"url": url, "ok": False, "reason": f"not an entity page: {reason_raw}"[:200],
                    "r": r, "inconclusive": bool(INCONCLUSIVE_REASON_RE.search(reason_raw))}
        if vd.get("fits_category") is not True:
            return {"url": url, "ok": False, "reason": f"not this category: {reason_raw}"[:200],
                    "r": r}
        ek = vd.get("entity_kind")
        kind = "professional" if ek == "person" else "location" if ek == "business" else None
        if detail_entity_type and kind and kind != detail_entity_type:
            return {"url": url, "ok": False,
                    "reason": f"{ek} page; the profile is {detail_entity_type}", "r": r}
        return {"url": url, "ok": True, "reason": "passed", "r": r}

    # Judge URLs in parallel batches until `want` conclusive verdicts (or the list runs out).
    def judge_until(urls: list[str], want: int, cap: int, stop_at_ok: bool = False) -> list[dict]:
        out: list[dict] = []
        i = 0

        def have() -> int:
            return len([x for x in out if x["ok"]]) if stop_at_ok else \
                len([x for x in out if not x.get("inconclusive")])

        while have() < want and i < min(len(urls), cap) and not over_time(240_000):
            batch = urls[i:min(i + max(1, want - have()), cap)]
            i += len(batch)
            out.extend(u.parallel([(lambda x=x: judge_url(x)) for x in batch]))
        return out

    rule_pool = [x for x in _uniq([
        *link_candidates, *sitemap_pool_urls,
        *lk.collect_detail_urls(detail["body"], detail["url"], lk.LINK_CANDIDATE_CAP),
    ]) if x not in rejected_tried]
    rule_main = lk.build_profile_rule(detail["url"], rule_pool)
    # v2Led: version 2's validated profile pattern when it matches the accepted page and 90%.
    v2_pattern_used: str | None = None
    v2l = opts.get("v2Led") if isinstance(opts.get("v2Led"), dict) else None
    if v2_led and v2l and v2l.get("pattern"):
        try:
            vre = u.js_re(v2l["pattern"])
            given = given_profiles if given_profiles else (opts.get("profileUrls") or [])
            hit = len([x for x in given if vre.search(x)]) / len(given) if given else 0
            if (vre.search(detail["url"]) or (
                    bool(vre.search(detail_candidate_url)) if detail_candidate_url else False)) \
                    and hit >= 0.9:
                v2_pattern_used = v2l["pattern"]
        except ValueError:
            v2_pattern_used = None
    form_checks: list[dict] = []
    if not v2_pattern_used and rule_main["otherForms"] and not over_time(200_000):
        groups = sorted(rule_main["otherForms"], key=lambda x: -len(x["urls"]))[:2]
        # Fix (inconclusive pages, 2026-10-06)
        results = u.parallel([
            (lambda g=g: {"g": g, "verdicts": judge_until(
                [x for x in g["urls"] if x not in rejected_tried], 2, 4)})
            for g in groups
        ])
        extra: set[str] = set()
        failed: set[str] = set()
        for res in results:
            g, verdicts = res["g"], res["verdicts"]
            conclusive = [x for x in verdicts if not x.get("inconclusive")]
            ok = bool(conclusive) and all(x["ok"] for x in conclusive)
            form_checks.append({
                "pos": g["pos"], "form": g["form"], "included": ok,
                "urls": [{"url": x["url"], "ok": x["ok"],
                          "reason": f"inconclusive: {x['reason']}" if x.get("inconclusive")
                          else x["reason"]} for x in verdicts],
            })
            if ok:
                extra.add(f"{g['pos']}:{g['form']}")
            elif conclusive:
                failed.add(f"{g['pos']}:{g['form']}")
        rule_main = lk.build_profile_rule(detail["url"], rule_pool, extra, failed)
    # A redirect (candidate URL -> longer resolved URL with the same tail).
    rule_alt: dict | None = None
    if detail_candidate_url and detail_candidate_url != detail["url"]:
        rule_alt = lk.build_profile_rule(detail_candidate_url, rule_pool)
        try:
            long_p = re.sub(r"/+$", "", u.url_of(detail["url"]).pathname)
            short_p = re.sub(r"/+$", "", u.url_of(detail_candidate_url).pathname)
            if rule_main["thin"] and short_p and long_p.endswith(short_p) and long_p != short_p:
                extra_prefix = long_p[: len(long_p) - len(short_p)]
                origin = u.url_of(detail["url"]).origin
                short_depth = len([s for s in short_p.split("/") if s])
                mapped: list[str] = []
                for x in rule_pool:
                    p = u.try_url(x)
                    if p and not p.search and len(u.path_segs(p)) == short_depth:
                        mapped.append(f"{origin}{extra_prefix}{p.pathname}")
                if mapped:
                    rule_main = lk.build_profile_rule(detail["url"], [*rule_pool, *mapped])
        except Exception:  # noqa: BLE001, S110  (keep the rule as built)
            pass
    code_pattern = v2_pattern_used or lk.combine_rules(
        [rule_main["pattern"] or "", (rule_alt or {}).get("pattern") or ""]
    )
    excluded_non_detail: list[str] = []
    if code_pattern and not v2_pattern_used:
        rx = None
        try:
            rx = u.js_re(code_pattern)
        except ValueError:
            code_pattern = None
        if rx:
            for x in must_not_match:
                bare_u = re.sub(r"[?#].*$", "", x)
                if rx.search(x) or rx.search(bare_u):
                    excluded_non_detail.append(
                        re.sub(r"/+$", "", re.sub(r"^https?://", "", bare_u))
                    )
            if excluded_non_detail:
                alts = "|".join(u.re_esc(x) for x in _uniq(excluded_non_detail))
                code_pattern = (f"^(?!https?://(?:{alts})/?(?:[?#]|$))"
                                + u.regexp_source(code_pattern)[1:])
    rule_source = "code" if code_pattern else "ai_fallback"
    if code_pattern:
        inp = {**(inp or {}), "detail_pattern": code_pattern}

    first_check = lk.check_detail_pattern((inp or {}).get("detail_pattern"), must_match,
                                          must_not_match)
    retried = False
    final_problems = first_check["problems"]
    if rule_source == "ai_fallback" and first_check["problems"]:
        retried = True
        try:
            second = u.call_claude_map(
                api_key,
                model,
                contract_prompt
                + f"\n\nYOUR PREVIOUS detail_pattern WAS: "
                f"{u.js_str((inp or {}).get('detail_pattern'))}\n"
                f"IT IS WRONG: {'; '.join(first_check['problems'])}.\n"
                "Return a corrected contract. detail_pattern must match every DETAIL PAGE URL "
                "above and must NOT match any of these non-detail URLs:\n"
                + "\n".join(must_not_match) + "\n"
                "Prefer a pattern built from the structural feature that distinguishes profile "
                "URLs from the non-detail URLs (path depth, a fixed path segment, a dot or an id) "
                "— "
                "only a feature that every detail URL and the same-path links share; never narrow "
                "the variable part to the characters of one example. Avoid a bare one-word slug.",
                CONTRACT_TOOL,
                4096,
            )
            second_check = lk.check_detail_pattern((second or {}).get("detail_pattern"),
                                                   must_match, must_not_match)
            if second_check["ok"] or len(second_check["problems"]) < len(first_check["problems"]):
                inp = second
                final_problems = second_check["problems"]
        except Exception:  # noqa: BLE001, S110  (keep the first contract)
            pass

    # Fix (pattern coverage, 2026-10-05): one small corrective call widens a narrow pattern.
    pattern_coverage_diag: dict | None = (
        {"source": "code", "pool": rule_main["candidates"],
         "matched_before": rule_main["matched"], "widened": False, "thin": rule_main["thin"]}
        if rule_source == "code" else None
    )
    if rule_source == "ai_fallback" and len(same_parent_pool) >= 5:
        before = lk.pattern_coverage((inp or {}).get("detail_pattern"), same_parent_pool)
        pattern_coverage_diag = {"pool": before["total"], "matched_before": before["matched"],
                                 "widened": False}
        if before["ratio"] < 0.5:
            relaxed_must_not = [x for x in must_not_match if lk.parent_key(x) != detail_parent]
            same_path_rejected = [x for x in must_not_match
                                  if lk.parent_key(x) == detail_parent]
            try:
                w = u.call_claude_map(
                    api_key,
                    model,
                    f"Site {domain}. detail_pattern is a regular expression that must be true for "
                    "profile (detail) page URLs.\n"
                    f"CURRENT detail_pattern: {u.js_str((inp or {}).get('detail_pattern'))}\n"
                    f"It matches only {before['matched']} of {before['total']} links that share "
                    "the detail page's path, so it is probably too narrow.\n\n"
                    f"KNOWN DETAIL PAGES (must match):\n{chr(10).join(must_match)}\n\n"
                    "SAME-PATH LINKS IT DOES NOT MATCH (from the directory page and sitemaps; "
                    "most are usually profiles, a few may be listing or search pages):\n"
                    f"{chr(10).join(before['unmatched'][:15])}\n\n"
                    "KNOWN NON-DETAIL PAGES (must NOT match):\n"
                    f"{chr(10).join(relaxed_must_not) or '(none)'}\n\n"
                    + ("These same-path pages failed a single profile check (team or business "
                       "profiles, or failed loads); they do not have to be excluded:\n"
                       f"{chr(10).join(same_path_rejected)}\n\n" if same_path_rejected else "")
                    + "Return a detail_pattern that accepts every profile URL form seen above "
                    "(for example both numeric ids and name slugs), keeps the fixed host and path "
                    "prefix, and still excludes the non-detail pages and obvious listing, search "
                    "or utility paths.",
                    PATTERN_TOOL,
                    512,
                )
                wd = w if isinstance(w, dict) else {}
                w_check = lk.check_detail_pattern(wd.get("detail_pattern"), must_match,
                                                  relaxed_must_not)
                after = lk.pattern_coverage(wd["detail_pattern"], same_parent_pool) \
                    if w_check["ok"] else None
                pattern_coverage_diag["proposed"] = wd.get("detail_pattern")
                pattern_coverage_diag["proposed_problems"] = w_check["problems"]
                if w_check["ok"] and after and after["matched"] > before["matched"]:
                    pattern_coverage_diag["narrow_pattern"] = (inp or {}).get("detail_pattern")
                    inp = {**(inp or {}), "detail_pattern": wd["detail_pattern"]}
                    pattern_coverage_diag["widened"] = True
                    pattern_coverage_diag["matched_after"] = after["matched"]
                    if same_path_rejected:
                        pattern_coverage_diag["not_enforced"] = same_path_rejected
            except Exception:  # noqa: BLE001, S110  (keep the current pattern)
                pass

    # ---- site contract (universal keys) -----------------------------------------------------
    primary_subject = "person" if detail_entity_type == "professional" else "location"
    contract_started_at = u.now_ms()
    contract_budget_ms = 60_000
    detail_re = None
    dp = (inp or {}).get("detail_pattern")
    try:
        if isinstance(dp, str) and dp:
            detail_re = u.js_re(dp)
    except ValueError:
        detail_re = None
    sample_seen = {detail["url"], *([detail_candidate_url] if detail_candidate_url else [])}
    extra_sample_urls: list[str] = []
    # Fix (10 samples, 2026-10-06)
    sample_extra_wanted = 9
    sample_candidates_max = 16
    sample_short = over_time(200_000)
    sample_target = 4 if sample_short else sample_candidates_max
    mark("listing navigation and samples", {"detail_url": detail["url"],
                                            "detail_pattern": (inp or {}).get("detail_pattern")})

    def nav_stub(skipped: str) -> dict:
        return {"listing_url": roster_page["url"], "page1_detail_links": 0, "next_page": None,
                "sub_listings": None, "profile_links": [], "skipped": skipped}

    navigation: dict | None
    if roster_page is not home and detail_re and over_time(180_000):
        navigation = nav_stub("time budget (run past 180 s)")
    elif roster_page is not home and detail_re:
        def nav() -> dict:
            try:
                return rt.learn_navigation(roster_page, home["url"], detail_re, None, crawl_method)
            except Exception as e:  # noqa: BLE001
                return nav_stub(f"error: {u.err_string(e)[:200]}")

        navigation = u.with_timeout(
            nav, max(0, min(45_000, 240_000 - (u.now_ms() - map_started_at))),
            nav_stub("time budget (navigation took too long)"),
        )
    else:
        navigation = None
    nv = navigation or {}
    nxt_p = nv.get("next_page") or {}
    sub_l = nv.get("sub_listings") or {}
    listing_reach = (
        nv["page1_detail_links"] * ((nxt_p.get("max_page_seen") or 2) if nxt_p.get("verified")
                                    else 1)
        + (sub_l["count_on_listing"] * sub_l["new_detail_links"] if sub_l.get("verified") else 0)
    ) if navigation else 0

    def matches_rule(x: str) -> bool:
        try:
            return bool(detail_re) and bool(detail_re.search(x))
        except Exception:  # noqa: BLE001
            return False

    sitemap_profile_urls = len([x for x in sitemap_pool_urls if matches_rule(x)])
    per_file: dict[str, int] = {}
    for x in sitemap_pool_urls:
        if not matches_rule(x):
            continue
        f = from_of.get(x)
        if f:
            per_file[f] = per_file.get(f, 0) + 1
    sitemap_estimate: float = sitemap_profile_urls
    sitemap_basis = "profile URLs read"
    fam_files = [f for f in per_file if f in sitemap_family]
    if fam_files:
        avg = sum(per_file.get(f, 0) for f in fam_files) / len(fam_files)
        size = max(sitemap_family.get(f, 1) for f in fam_files)
        family_est = u.js_round(avg * size)
        if family_est > sitemap_estimate:
            sitemap_estimate = family_est
            sitemap_basis = (f"{len(fam_files)} of {size} files read, {u.js_round(avg)} profiles "
                             "per file")
    if any(n >= SITEMAP_LOCS_READ for n in per_file.values()):
        sitemap_basis += f" (a file hit the {SITEMAP_LOCS_READ}-URL read limit: lower bound)"
    # ---- step 5: background calls ----
    static_reach = max(sitemap_estimate, listing_reach)
    static_lower_bound = sitemap_estimate >= listing_reach and "lower bound" in sitemap_basis
    count_words = head_words if is_person_category else [*head_words, *lk.GENERIC_PLACE_TOKENS]
    page_stated = sr.stated_total_in_text(roster_page["body"], count_words)
    coverage_static = sr.needs_more_routes(static_reach, static_lower_bound,
                                           (page_stated or {}).get("total"))
    network_scope = "sub_listing" if (nv.get("sub_listings") and not sub_l.get("verified")
                                      and nv.get("page1_detail_links", 0) < 3) else "listing"
    if roster_page is home:
        network_page = None
    elif network_scope == "sub_listing":
        network_page = sub_l["example_checked"]
    else:
        network_page = roster_page["url"]
    if v2_led:
        network_why_not: str | None = "not needed: version 2 list route"
    elif not detail_re:
        network_why_not = "no profile rule"
    elif not network_page:
        network_why_not = "no directory page (homepage used)"
    elif not opts.get("forceNetwork") and not coverage_static["more"]:
        network_why_not = f"not needed: {coverage_static['why']}"
    elif run_left() < 60_000:
        network_why_not = "time budget (under 60 s left)"
    else:
        network_why_not = None
    network_known = _uniq([
        detail["url"],
        *(x for x in (search_seed or {}).get("urls", []) if matches_rule(x)),
        *(x for x in link_candidates if matches_rule(x)),
        *(nv.get("profile_links") or []),
        *[x for x in sitemap_pool_urls if matches_rule(x)][:50],
    ])
    network_deadline = map_started_at + 255_000
    if network_why_not:
        nw_reason = network_why_not

        def network_wait() -> dict:
            return {"status": "skipped", "reason": nw_reason}
    else:
        def run_network() -> dict:
            try:
                return rt.learn_network_route(
                    page_url=network_page, scope=network_scope,
                    sub_listing_count=sub_l.get("count_on_listing") or 0,
                    matches=matches_rule, known_profiles=network_known,
                    crawl_method=crawl_method, deadline_at=network_deadline, judge=judge_url,
                    forced=bool(opts.get("forceNetwork")) and not coverage_static["more"],
                    trigger_why=coverage_static["why"],
                )
            except Exception as e:  # noqa: BLE001
                return {"status": "error", "reason": u.err_string(e)[:200]}

        network_wait = u.start(lambda: u.with_timeout(
            run_network, max(1_000, network_deadline - u.now_ms()),
            {"status": "skipped", "reason": "time budget (did not finish in time)"},
        ))
    if detail_re:
        # P0: links on the accepted profile page itself come last.
        for x in [*sitemap_pool_urls, *link_candidates, *(nv.get("profile_links") or []),
                  *lk.collect_detail_urls(detail["body"], detail["url"], lk.LINK_CANDIDATE_CAP)]:
            if len(extra_sample_urls) >= sample_target:
                break
            if x in sample_seen or x in rejected_tried:
                continue
            if not matches_rule(x):
                continue
            sample_seen.add(x)
            extra_sample_urls.append(x)
    if not sample_short:
        sample_judged = judge_until(extra_sample_urls, sample_extra_wanted, sample_target, True)
    else:
        def quick(x: str) -> dict:
            r0 = capped_fetch(x, 30_000)
            r = r0 if r0["ok"] or r0["status"] else None
            ev = sc.page_entity_evidence(r["body"], r["url"], site_entity_names,
                                         "person" if is_person_category else "location") \
                if r and r["ok"] and r["body"] else None
            kind = u.g(ev, "kind") if ev is not None else None
            return {"url": x, "ok": ev is not None and kind != "listing",
                    "reason": ("listing page" if kind == "listing" else
                               "not judged (time budget)") if ev is not None else "did not load",
                    "r": r}

        sample_judged = u.parallel([(lambda x=x: quick(x)) for x in extra_sample_urls])
    samples: list[dict] = [
        {"url": detail["url"], "html": detail["body"], "primary": primary_subject},
        *[{"url": j["r"]["url"], "html": j["r"]["body"], "primary": primary_subject}
          for j in [j for j in sample_judged
                    if j["ok"] and j.get("r") and j["r"]["ok"] and len(j["r"]["body"]) > 0]
          [: 4 if sample_short else sample_extra_wanted]],
    ]
    # The 60 s budget for the corrective must-have call starts once the samples are in.
    contract_started_at = u.now_ms()

    # Step 2 — JSON-LD tier.
    jl = sc.build_json_ld_fields(samples, primary_subject, site_entity_names)
    universal_jsonld_fields = u.g(jl, "fields")
    firm_signatures = u.g(jl, "firmSignatures")
    tax_keys = list(sc.resolve_taxonomy_keys(taxonomy_rows, primary_subject))
    all_tax_keys = tax_keys
    contract_opts: dict[str, Any] = {
        "firmSignatures": firm_signatures,
        "taxSubjects": sc.taxonomy_subject_map(tax_keys),
        "actionIds": sc.taxonomy_action_ids(tax_keys),
        "logoIds": sc.taxonomy_logo_ids(tax_keys),
    }
    taxonomy_roles: Any = {}
    own_page_key: str | None = None
    tax_types = sc.taxonomy_types(tax_keys)
    tax_item_words = sc.taxonomy_item_words(tax_keys)
    jsonld_fields = sc.build_taxonomy_json_ld_fields(universal_jsonld_fields, tax_keys, samples,
                                                     site_entity_names, contract_opts)

    # Step 3 — CSS tier (one AI call) for every id JSON-LD did not produce.
    def typed_ids(ids: list[str]) -> str:
        return "\n".join(
            f"{i} ({sc.field_type(i)})"
            + (f" — {sc.FIELD_MEANINGS[i]}" if sc.FIELD_MEANINGS.get(i) else "")
            for i in ids
        )

    sample_markup = "\n\n".join(
        f"SAMPLE {i + 1} — {s['url']}\n{sc.clean_html_for_prompt(s, 30_000)}"
        for i, s in enumerate(samples[:2])
    )
    # Fix (page-specific footer values, 2026-10-22)
    page_chrome_markup = ""
    if len(samples) >= 2:
        c1 = sc.chrome_html_for_prompt(samples[0], 6_000)
        c2 = sc.chrome_html_for_prompt(samples[1], 6_000)
        if c1 and c1 != c2:
            page_chrome_markup = (
                "\n\nSAMPLE 1 HEADER / FOOTER (it differs from sample 2's; parts that change "
                f"between pages may hold this page's fields) — {samples[0]['url']}\n{c1}"
            )
    # Fix (all samples for rule proposals, 2026-10-14)
    other_samples_digest = ""
    if len(samples) > 2:
        shown_keys = {blk["key"] for x in samples[:2] for blk in _blocks(x)}
        extra_blocks: dict[str, dict] = {}
        for smp in samples[2:]:
            seen_b: set[str] = set()
            for blk in _blocks(smp):
                if blk["key"] in shown_keys or blk["key"] in seen_b:
                    continue
                seen_b.add(blk["key"])
                e = extra_blocks.get(blk["key"])
                if e:
                    e["n"] += 1
                else:
                    extra_blocks[blk["key"]] = {"n": 1, "text": blk["text"][:160],
                                                "url": smp["url"]}
        lines = [
            f'{k}  (on {e["n"]} of {len(samples) - 2} other samples): "{e["text"]}"  — {e["url"]}'
            for k, e in sorted(extra_blocks.items(), key=lambda kv: -kv[1]["n"])[:80]
        ]
        other_samples_digest = "\n".join(lines)[:10_000]
    # C9 brand pass input: homepage chrome + main-content head, and ONE sample's chrome.
    home_sample = {"url": home["url"], "html": home["body"]}
    firm_markup = (
        f"HOMEPAGE CHROME — {home['url']}\n{sc.chrome_html_for_prompt(home_sample, 12_000)}\n\n"
        f"HOMEPAGE MAIN CONTENT (head)\n{sc.clean_html_for_prompt(home_sample, 6_000)}\n\n"
        f"SAMPLE 1 CHROME — {samples[0]['url']}\n"
        f"{sc.chrome_html_for_prompt(samples[0], 12_000)}"
    )
    # C14: shared extra-key list. Fix (extra key dictionary, 2026-10-22)
    extra_key_rows: list[dict] = []
    try:
        dict_rows, own, other = u.parallel([
            lambda: db.rows_or_none(
                "select normalized, raw_label, gcid, first_source, definition, value_type, "
                "subject, examples from exp_field_discovery where element_kind = %s limit 2000",
                ("extra_key",)),
            lambda: db.rows_or_none(
                "select normalized, raw_label, gcid, first_source from exp_field_discovery "
                "where element_kind = %s and gcid = %s", ("extra_field", category)),
            lambda: db.rows_or_none(
                "select normalized, raw_label, gcid, first_source from exp_field_discovery "
                "where element_kind = %s and gcid <> %s order by seen_count desc limit 100",
                ("extra_field", category)),
        ])
        defined = [r for r in (dict_rows or []) if r and r.get("normalized")]
        defined_names = {r["normalized"] for r in defined}
        legacy = [r for r in [*(own or []), *(other or [])]
                  if r and r.get("normalized") and r["normalized"] not in defined_names]
        legacy_seen: set[str] = set()
        legacy_kept: list[dict] = []
        for r in legacy:
            if r["normalized"] in legacy_seen:
                continue
            legacy_seen.add(r["normalized"])
            legacy_kept.append(r)
        extra_key_rows = [*defined, *legacy_kept]
    except Exception:  # noqa: BLE001
        u.log.exception("extra key list load failed")

    def extra_key_line(r: dict) -> str:
        if not r.get("definition"):
            return f"{r['normalized']} — {r.get('raw_label') or ''}"
        exs = r.get("examples")
        ex = f" — e.g. {u.js_str(exs[0])[:60]}" if isinstance(exs, list) and exs else ""
        return (f"{r['normalized']} — {r['definition']} ({r.get('value_type') or 'text'}, "
                f"{r.get('subject') or '?'}){ex}")

    extra_section = (
        "\nEXTRA FIELDS\n"
        "EXISTING EXTRA KEYS (reuse the key whenever the meaning is the same; never make a variant "
        "of an existing name): key — meaning (format, whose fact) or example label\n"
        + ("\n".join(extra_key_line(r) for r in extra_key_rows) if extra_key_rows
           else "(none yet)")
        + f"\n- In unkeyed, list up to 20 labelled facts about this {primary_subject} that none "
        "of the field ids or category keys cover. "
        "For each return label, sample, key (snake_case), match ('existing_extra' = key copied "
        "from EXISTING EXTRA KEYS; "
        "'taxonomy' = it is one of the category keys above, key = that slug; 'static' = it is one "
        "of the universal field ids; 'new'), "
        "and a rule (strategy css|label, css or label, attr, multi:true for lists). Every extra "
        "must come with a working rule (css required when strategy is css); omit facts you cannot "
        "write a rule for. "
        "Skip buttons, calls to action, images, navigation, legal/disclosure text and anything "
        "identical on every page of the site.\n"
    )

    def locator_prompt(ids: list[str], extra: str = "", tax_ids: list[str] | None = None,
                       firm_ids_: list[str] | None = None) -> str:
        tax_ids = tax_ids or []
        firm_ids_ = firm_ids_ or []
        subj = "person" if primary_subject == "person" else "location"
        return (
            f"You are writing extraction rules for ONE {subj} detail page layout on {domain}.\n"
            + cat_block
            + f"\nFIELD IDS TO LOCATE (id and value type):\n{typed_ids(ids)}\n\n"
            + ((
                "CATEGORY KEYS (roles) — every category key with its default subject (person = "
                "this professional, branch = this location/office, firm = the brand/company):\n"
                f"{sc.taxonomy_role_lines(all_tax_keys)}\n\n"
                "In taxonomy_roles, list ONLY keys whose correct subject differs from the default "
                "(e.g. a key that means the firm/brand but defaults to branch), "
                "plus at most ONE url key that means this professional's/location's own page URL "
                "on this site (role own_page_url).\n\n"
            ) if all_tax_keys and tax_ids else "")
            + ((
                "CATEGORY FIELD IDS TO LOCATE (id (type) — name: description):\n"
                f"{sc.taxonomy_prompt_lines([k for k in tax_keys if u.g(k, 'id') in tax_ids])}"
                "\n\n"
            ) if tax_ids else "")
            + ((
                "FIRM IDS — locate in the SITE CHROME / HOMEPAGE below (the brand/company, not "
                f"this {primary_subject}); "
                "only these ids may target the header, footer or navigation:\n"
                + "\n".join(
                    f"{i} ({tax_types.get(i) if i.startswith('tax.') else sc.field_type(i)})"
                    for i in firm_ids_
                ) + "\n\n"
            ) if firm_ids_ else "")
            + "For url-type ids, point at an element with a real link attribute "
            "(href/src/content); never at button text.\n"
            'For geo ids return both latitude and longitude, e.g. two rules with part:"latitude" '
            'and part:"longitude" (or one element holding "lat, lng").\n'
            "For list ids: entries in separate elements are separate entries (multi:true). When "
            "ONE element lists several entries separated by commas, set split_commas:true only if "
            'each part is a complete entry on its own ("Annuities, 529 Plans", "Life & Health, '
            'Property & Casualty" as two lines of business); keep it false when the parts depend '
            'on each other ("Series 7, 63, 65").\n'
            "For person.awards and person.education, when each entry is a block with separate "
            "parts (title, year, issuer, description, link / school, degree, year), give css for "
            "the block and item_fields with the css of each part relative to the block.\n"
            "Return rules via the return_locator_rules tool. Each rule is either\n"
            '  { id, strategy:"css", css:"<selector>", attr?:"content"|"href"|"src", '
            'multi?:true, part?:"latitude"|"longitude" }\n'
            '  { id, strategy:"label", label:"<visible label text>", multi?:true }\n'
            "Rules:\n"
            "- Prefer itemprop / id / data-* / aria-* / semantic hooks (h1, a[href^=\"tel:\"], "
            "a[href^=\"mailto:\"]) and label-anchored rules.\n"
            "- Avoid auto-generated / hashed class names.\n"
            "- Only propose a rule when the value is visibly present on the samples.\n"
            f"- The page describes ONE {primary_subject}; never target the site header, footer or "
            "navigation (except FIRM IDS), "
            "unless the part holds this page's own data that changes between pages (for example "
            "a branch address in the footer, shown under SAMPLE 1 HEADER / FOOTER).\n"
            "- Never use the site's or firm's own name as a label.\n"
            "- Never select by the text content itself (no :contains); select by structure (tags, "
            "classes, ids, attributes).\n"
            + extra_section
            + "- If the address is shown as one block (lines for street, city, state, ZIP), "
            "return a rule for location.address_block pointing at the element that contains the "
            "whole block.\n"
            + extra
            + f"\n{sample_markup}"
            + page_chrome_markup
            + ((
                f"\n\nOTHER SAMPLES ({len(samples) - 2} more pages of the same layout): text "
                "blocks they show whose structure is not on samples 1-2, "
                "as parent > element (tag#id.classes[itemprop]), with how many of them show it "
                "and one example. Propose rules for any field id or "
                "category key these blocks hold too (every rule is checked on all samples):\n"
                f"{other_samples_digest}"
            ) if other_samples_digest else "")
            + (f"\n\n=== SITE CHROME / HOMEPAGE (for FIRM IDS only) ===\n{firm_markup}"
               if firm_ids_ else "")
        )

    all_missing_ids = list(sc.locator_target_ids(jsonld_fields, primary_subject))
    all_missing_tax_ids = list(sc.taxonomy_locator_ids(jsonld_fields, tax_keys))
    # C9: firm-subject category keys go to the brand-pass section.
    firm_ids = list(sc.firm_locator_ids(jsonld_fields, tax_keys, all_missing_tax_ids))
    firm_id_set = set(firm_ids)
    contract_fields: dict = jsonld_fields
    failed_ids: list[str] = []
    # Fix (rejected rules kept, 2026-10-22)
    rejected_rules: dict = {}
    unkeyed: list[dict] = []
    extra_items: list[Any] = []
    prev_contract: dict | None = None
    last_rules: list[dict] = []
    firm_diagnostics: list[Any] = []
    homepage_differs: set[str] = set()

    # C10 sticky rules: previous CSS/label rules that still validate on the new samples are kept.
    kept_ids: set[str] = set()
    prev = load_previous_contract(db, domain, category)
    prev_contract = prev
    pcr = sc.previous_contract_rules(prev)
    prev_rules = list(u.g(pcr, "rules") or [])
    backups = u.g(pcr, "backups")
    if prev_rules:
        adv_targets = {*all_missing_ids, *(i for i in all_missing_tax_ids if i not in firm_id_set)}
        before_ids = set(contract_fields)
        adv = sc.merge_css_rules(contract_fields, [r for r in prev_rules if r["id"] in adv_targets],
                                 samples, primary_subject, site_entity_names, contract_opts,
                                 tax_types, tax_item_words)
        rejected_rules.update(u.g(adv, "rejected") or {})
        firm = sc.merge_firm_rules(u.g(adv, "fields"),
                                   [r for r in prev_rules if r["id"] in firm_id_set], home_sample,
                                   samples, site_entity_names, contract_opts, firm_ids, tax_types)
        firm_diagnostics = list(u.g(firm, "diagnostics") or [])
        homepage_differs.update(u.g(firm, "homepageDiffers") or [])
        rule_ids = {r["id"] for r in prev_rules}
        for fid in u.g(firm, "fields"):
            if fid not in before_ids and fid in rule_ids:
                kept_ids.add(fid)
        # Derived address parts re-derived from a kept address_block stay.
        contract_fields = sc.mark_kept_fields(u.g(firm, "fields"), kept_ids, backups)
    missing_ids = [i for i in all_missing_ids if not contract_fields.get(i)]
    missing_tax_ids = [i for i in all_missing_tax_ids
                       if i not in firm_id_set and not contract_fields.get(i)]
    prompt_firm_ids = [i for i in firm_ids if not contract_fields.get(i)]
    if missing_ids or missing_tax_ids or prompt_firm_ids:
        try:
            loc = u.call_claude_map(api_key, model,
                                    locator_prompt(missing_ids, "", missing_tax_ids,
                                                   prompt_firm_ids),
                                    LOCATOR_TOOL, 12288)
            loc = loc if isinstance(loc, dict) else {}
            last_rules = list(loc["rules"])[:120] if isinstance(loc.get("rules"), list) else []
            extra_items = [x for x in loc["unkeyed"]
                           if x and isinstance(x, dict) and isinstance(x.get("label"), str)][:20] \
                if isinstance(loc.get("unkeyed"), list) else []
            unkeyed = [{"label": u.js_str(x["label"]),
                        "sample": u.js_str(x.get("sample") if x.get("sample") is not None
                                           else "")} for x in extra_items]
            # C1: role overrides — re-run the taxonomy JSON-LD tier for keys whose subject changed.
            role_res = sc.apply_taxonomy_roles(tax_keys, loc.get("taxonomy_roles"),
                                               primary_subject)
            tax_keys = list(u.g(role_res, "keys"))
            taxonomy_roles = u.g(role_res, "roles")
            own_page_key = u.g(role_res, "ownPageKey")
            contract_opts["taxSubjects"] = sc.taxonomy_subject_map(tax_keys)
            contract_opts["ownPageKey"] = own_page_key
            changed_ids = list(u.g(role_res, "changed") or [])
            if changed_ids:
                changed = set(changed_ids)
                kept = {fid: f for fid, f in contract_fields.items() if fid not in changed}
                contract_fields = sc.build_taxonomy_json_ld_fields(
                    kept, [k for k in tax_keys if u.g(k, "id") in changed], samples,
                    site_entity_names, contract_opts)
            advisor_rules = [r for r in last_rules
                             if not (isinstance(r, dict) and r.get("id") in firm_id_set)]
            firm_rules = [r for r in last_rules if isinstance(r, dict) and r.get("id") in firm_id_set]
            merged = sc.merge_css_rules(contract_fields, advisor_rules, samples, primary_subject,
                                        site_entity_names, contract_opts, tax_types,
                                        tax_item_words)
            rejected_rules.update(u.g(merged, "rejected") or {})
            contract_fields = u.g(merged, "fields")
            failed_ids = list(u.g(merged, "failed") or [])
            # C9 brand pass: firm rules must be identical on the homepage and every sample.
            firm_merged = sc.merge_firm_rules(contract_fields, firm_rules, home_sample, samples,
                                              site_entity_names, contract_opts, firm_ids,
                                              tax_types)
            contract_fields = u.g(firm_merged, "fields")
            failed_ids = [i for i in [*failed_ids, *(u.g(firm_merged, "failed") or [])]
                          if not contract_fields.get(i)]
            firm_diagnostics = [*firm_diagnostics, *(u.g(firm_merged, "diagnostics") or [])]
            homepage_differs.update(u.g(firm_merged, "homepageDiffers") or [])
        except Exception:  # noqa: BLE001, S110  (the must-have check below decides)
            pass

    extra = _extra_fields_step(
        db=db, sc=sc, api_key=api_key, model=model, category=category,
        primary_subject=primary_subject, contract_fields=contract_fields,
        all_tax_keys=all_tax_keys, prev_contract=prev_contract, extra_items=extra_items,
        samples=samples, site_entity_names=site_entity_names, contract_opts=contract_opts,
        extra_key_rows=extra_key_rows,
    )
    contract_fields = extra["contract_fields"]
    extra_fields = extra["extra_fields"]
    extra_dropped = extra["extra_dropped"]
    route_cands = extra["route_cands"]

    contract_fields = sc.add_taxonomy_aliases(contract_fields, tax_keys)

    def finalize() -> dict:
        return sc.finalize_site_contract({
            "fields": contract_fields, "failed": failed_ids, "samples": samples,
            "primary": primary_subject, "siteEntityNames": site_entity_names,
            "unkeyed": unkeyed, "opts": contract_opts, "taxonomy": tax_keys,
            "rejectedRules": rejected_rules,
        })

    contract = finalize()

    # Step 4 — must-haves, one corrective call.
    over_budget = u.now_ms() - contract_started_at > contract_budget_ms
    if not contract["must_have"]["ok"] and not over_budget:
        all_ids = list(sc.all_field_ids(primary_subject))
        mh_ids = [i for label in contract["must_have"]["missing"]
                  for i in sc.must_have_ids(label, primary_subject) if i in all_ids]
        failed_for_them = [r for r in last_rules if isinstance(r, dict) and r.get("id") in mh_ids]
        try:
            loc = u.call_claude_map(
                api_key, model,
                locator_prompt(
                    mh_ids,
                    "\nTHESE ARE REQUIRED FIELDS THAT ARE STILL MISSING. Previous rules for them "
                    "failed validation on the samples:\n"
                    f"{u.js_json(failed_for_them)}\nPropose different rules.\n",
                ),
                LOCATOR_TOOL, 8192,
            )
            rules = list(loc["rules"])[:120] if isinstance(loc, dict) \
                and isinstance(loc.get("rules"), list) else []
            merged = sc.merge_css_rules(
                contract_fields,
                [r for r in rules if not (isinstance(r, dict) and r.get("id") in firm_id_set)],
                samples, primary_subject, site_entity_names, contract_opts, tax_types,
                tax_item_words,
            )
            rejected_rules.update(u.g(merged, "rejected") or {})
            merged_fields = u.g(merged, "fields")
            contract_fields = sc.add_taxonomy_aliases(merged_fields, tax_keys)
            failed_ids = [i for i in _uniq([*failed_ids, *(u.g(merged, "failed") or [])])
                          if not merged_fields.get(i)]
            contract = finalize()
        except Exception:  # noqa: BLE001, S110  (fall through to the must-have error below)
            pass
    if not contract["must_have"]["ok"]:
        raise u.MapSiteError(
            "must-have fields not found: " + ", ".join(contract["must_have"]["missing"]),
            {"tried": tried, "sitemap_trace": sitemap_trace, "site_contract": contract,
             "detail_url": detail["url"]},
        )

    firm_profile = {
        **sc.build_firm_profile(
            {"fields": contract["fields"], "taxonomy_fields": contract.get("taxonomy_fields"),
             "own_page_key": own_page_key},
            home_sample, samples, site_entity_names, contract_opts, homepage_differs,
        ),
        "diagnostics": firm_diagnostics[: sc.FIRM_DIAGNOSTICS_CAP],
    }
    tf = contract.get("taxonomy_fields") or {}
    rules_kept = len([i for i in kept_ids
                      if (bool(tf.get(i[4:])) if i.startswith("tax.")
                          else bool(contract["fields"].get(i)))])

    profile_src = from_of.get(detail["url"]) or (
        from_of.get(detail_candidate_url) if detail_candidate_url else None)
    profile_sitemaps = [
        parent_of[profile_src] if lk.is_shard_sitemap(profile_src) and parent_of.get(profile_src)
        else profile_src
    ] if profile_src else []

    # Staging schema step 2: routes for static ids the page rules do not fill.
    static_routes: Any = {"routes": {}, "dropped": []}
    try:
        route_probe = {"extra_fields": extra_fields}
        static_routes = sc.build_static_routes({
            "fields": contract["fields"],
            "taxonomyFields": contract.get("taxonomy_fields") or {},
            "taxKeys": tax_keys,
            "primary": primary_subject,
            "extraFields": extra_fields,
            "extraCandidates": route_cands,
            "extraValues": [sc.apply_extra_fields(sc.doc_of(s), s["url"], route_probe,
                                                  site_entity_names, contract_opts)
                            for s in samples],
            "sampleUrls": [s["url"] for s in samples],
        })
    except Exception:  # noqa: BLE001
        u.log.exception("static routes step failed")
    fs_list = list(firm_signatures or [])
    final_site_contract: dict[str, Any] = {
        **contract,
        "taxonomy_roles": taxonomy_roles,
        "own_page_key": own_page_key,
        "site_entity_names": list(site_entity_names),
        "firm_signatures": fs_list[:50],
        "firm_profile": firm_profile,
        "extra_fields": extra_fields,
        "extra_dropped": extra_dropped[: sc.EXTRA_DROPPED_CAP],
        "static_routes": u.g(static_routes, "routes"),
        "static_routes_dropped": u.g(static_routes, "dropped"),
        "boilerplate_values": {},
        "sitewide_actions": {},
        "sitewide_media": {},
        "media_scan": True,
    }
    names_fsc = set(final_site_contract["site_entity_names"])
    sigs_fsc = set(final_site_contract["firm_signatures"])

    def apply_values(s: dict) -> dict:
        res = sc.apply_site_contract(s["html"], s["url"], final_site_contract, names_fsc,
                                     {"firmSignatures": sigs_fsc})
        return u.g(res, "values") or {}

    # Staging schema step 3: boilerplate description text.
    try:
        bp_id = "person.bio" if primary_subject == "person" else "location.description"
        texts = [t for t in (apply_values(s).get(bp_id) for s in samples)
                 if isinstance(t, str) and t.strip()]
        counts: dict[str, int] = {}
        for t in texts:
            counts[sc.boilerplate_key(t)] = counts.get(sc.boilerplate_key(t), 0) + 1
        top = max(counts.items(), key=lambda kv: kv[1]) if counts else None
        if top and top[0] and top[1] >= 2 and top[1] / len(texts) >= 0.6:
            final_site_contract["boilerplate_values"][bp_id] = [top[0]]
    except Exception:  # noqa: BLE001
        u.log.exception("boilerplate check failed")
    # Staging schema: site-wide calls to action and media.
    try:
        per_sample = [apply_values(s) for s in samples]
        need = max(2, -(-6 * len(samples) // 10))
        for sid in ("person.actions", "location.actions"):
            counts = {}
            for vals in per_sample:
                keys: dict[str, None] = {}
                for item in vals.get(sid) if isinstance(vals.get(sid), list) else []:
                    a = sc.decode_action(item) if isinstance(item, str) else None
                    if a:
                        keys[sc.action_key(u.g(a, "label"), u.g(a, "url"))] = None
                for k in keys:
                    counts[k] = counts.get(k, 0) + 1
            site = [k for k, n in counts.items() if n >= need][:50]
            if site:
                final_site_contract["sitewide_actions"][sid] = site
        for sid in ("person.videos", "location.videos", "person.gallery", "location.gallery"):
            counts = {}
            for i, vals in enumerate(per_sample):
                urls: dict[str, None] = {}
                for item in vals.get(sid) if isinstance(vals.get(sid), list) else []:
                    if isinstance(item, dict):
                        raw = u.js_str(item.get("url") if item.get("url") is not None else "")
                    else:
                        raw = u.js_str(item if item is not None else "")
                    if sid.endswith(".videos"):
                        vv = sc.video_from_url(raw, samples[i]["url"])
                        if vv:
                            urls[u.g(vv, "url")] = None
                    elif raw:
                        urls[re.sub(r"^http:", "https:", raw)] = None
                for x in urls:
                    counts[x] = counts.get(x, 0) + 1
            site = [x for x, n in counts.items() if n >= need][:50]
            if site:
                final_site_contract["sitewide_media"][sid] = site
    except Exception:  # noqa: BLE001
        u.log.exception("site-wide actions check failed")

    # S4-1: measured field floor — the final contract applied to every sample as the harvest.
    def floor_of(s: dict) -> int:
        values = apply_values(s)
        ex = sc.apply_extra_fields(sc.doc_of(s), s["url"], final_site_contract, names_fsc,
                                   {"firmSignatures": sigs_fsc})
        filled = sc.apply_address_owner(values, final_site_contract)
        st = sc.build_staging_static({"contract": final_site_contract, "values": filled,
                                      "extras": ex, "pageUrl": s["url"]})
        return sc.count_staging_fields(u.g(st, "universal"), filled)

    field_floor_per_sample = [floor_of(s) for s in samples]
    field_floor_measured = max(field_floor_per_sample) if field_floor_per_sample else 0
    ff_ai = u.num((inp or {}).get("field_floor") if (inp or {}).get("field_floor") is not None
                  else 0)
    field_floor_ai = u.as_int(ff_ai) if u.finite(ff_ai) else None
    # ---- step 3 (2026-10-07): listing pattern and best route, from evidence ----
    roster_parts: list[str] = []
    if roster_page is not home:
        lu = u.try_url(roster_page["url"])
        if lu:
            roster_parts.append(
                f"https?://{u.re_esc(lu.host)}{u.re_esc(re.sub(r'/+$', '', lu.pathname))}"
                "/?(?:[?#].*)?"
            )
        tpl = nxt_p.get("template") if nxt_p.get("verified") else None
        if tpl:
            roster_parts.append(re.sub(r"^https?:", "https?:",
                                       u.re_esc(tpl).replace("\\{n\\}", "\\d+", 1), count=1))
        if sub_l.get("verified"):
            roster_parts.append(re.sub(r"\$$", "", re.sub(r"^\^", "", sub_l["pattern"])))
    code_roster_pattern = f"^(?:{'|'.join(roster_parts)})$" if roster_parts else None
    if code_roster_pattern:
        try:
            rre = u.js_re(code_roster_pattern)
            if any(rre.search(x["url"]) for x in samples):
                code_roster_pattern = f"^(?:{roster_parts[0]})$" if len(roster_parts) > 1 \
                    else None
        except ValueError:
            code_roster_pattern = None
    if sitemap_estimate == 0 and listing_reach == 0:
        static_best: dict = {"route": "none", "reach_estimate": 0, "basis": "no route measured"}
    elif sitemap_estimate >= listing_reach:
        static_best = {"route": "sitemap", "reach_estimate": sitemap_estimate,
                       "basis": f"sitemap: {sitemap_basis}"}
    else:
        subs = " + sub-listings" if sub_l.get("verified") else ""
        if nxt_p.get("verified"):
            basis = (f"listing: {nv['page1_detail_links']} per page × "
                     f"{nxt_p.get('max_page_seen') or 2} pages{subs}")
        else:
            basis = f"listing: {nv.get('page1_detail_links') or 0} on the directory page{subs}"
        static_best = {"route": "listing", "reach_estimate": listing_reach, "basis": basis}
    network_route = network_wait()
    network_reach = (network_route.get("reach_estimate") or 0) \
        if network_route["status"] == "proven" and network_route.get("route") else 0
    # ---- step 6 (2026-10-07): search inputs ----
    best_so_far = max(static_best["reach_estimate"], network_reach)
    stated_all = max((page_stated or {}).get("total") or 0,
                     (network_route.get("route") or {}).get("total") or 0) or None
    coverage_search = sr.needs_more_routes(
        best_so_far, network_reach <= static_best["reach_estimate"] and static_lower_bound,
        stated_all)
    search_boxes = sr.find_search_inputs(roster_page["body"], roster_page["url"])
    search_page_url = roster_page["url"]
    if not search_boxes and roster_page is not home:
        search_boxes = sr.find_search_inputs(home["body"], home["url"])
        search_page_url = home["url"]
    search_deadline = map_started_at + 262_000
    if v2_led:
        search_why_not: str | None = "not needed: version 2 list route"
    elif not detail_re:
        search_why_not = "no profile rule"
    elif not search_boxes:
        search_why_not = "no search box on the directory page or homepage"
    elif not opts.get("forceSearch") and not coverage_search["more"]:
        search_why_not = f"not needed: {coverage_search['why']}"
    # Fix (search time floor, 2026-10-08)
    elif search_deadline - u.now_ms() < 120_000:
        search_why_not = f"time budget ({u.js_round((search_deadline - u.now_ms()) / 1000)} s left)"
    else:
        search_why_not = None
    if search_why_not:
        search_route_r: dict = {"status": "skipped", "reason": search_why_not,
                                **({"boxes": rt._boxes_report(search_boxes)}
                                   if search_boxes else {})}
    else:
        def run_search() -> dict:
            try:
                return rt.learn_search_route(
                    db=db, page_url=search_page_url,
                    page_html=roster_page["body"] if search_page_url == roster_page["url"]
                    else home["body"],
                    boxes=search_boxes, detail_re=detail_re, known_profiles=network_known,
                    category_words=count_words, crawl_method=crawl_method,
                    deadline_at=search_deadline,
                    trigger=f"forced (dry run); {coverage_search['why']}"
                    if opts.get("forceSearch") and not coverage_search["more"]
                    else coverage_search["why"],
                )
            except Exception as e:  # noqa: BLE001
                return {"status": "error", "reason": u.err_string(e)[:200]}

        search_route_r = u.with_timeout(
            run_search, max(1_000, search_deadline - u.now_ms()),
            {"status": "skipped", "reason": "time budget (did not finish in time)"},
        )
    search_reach = (search_route_r.get("reach_estimate") or 0) \
        if search_route_r["status"] == "proven" and search_route_r.get("route") else 0
    if search_reach > max(static_best["reach_estimate"], network_reach):
        best_route = {"route": "search_input", "reach_estimate": search_reach,
                      "basis": f"search inputs: {search_route_r.get('basis') or ''}",
                      "search_input": search_route_r["route"]}
    elif network_reach > static_best["reach_estimate"]:
        best_route = {"route": "network_call", "reach_estimate": network_reach,
                      "basis": f"network call: {network_route.get('basis') or ''}",
                      "network_call": network_route["route"]}
    else:
        best_route = static_best
    listing_profile_links = len([x for x in link_candidates if matches_rule(x)]) \
        if roster_page is not home else 0
    mark("report")
    collected_on_detail = len(list(sc.collect_embedded_entities(detail["body"])))
    route_report = {
        **({"fields_only": {
            "v2_led": True, "homepage_loaded": not home_missing,
            "v2_pattern_used": bool(v2_pattern_used),
            "skipped": ["subdomain robots.txt", "sitemap walk", "directory page",
                        "listing navigation", "profile-rule form checks",
                        "background-call capture", "search route"],
        }} if v2_led else {}),
        "ai_temperature": "model default (temperature not supported)",
        "run_ms": u.now_ms() - map_started_at,
        "sitemaps": {
            "docs_read": len([t for t in sitemap_trace if t["kind"] != "error"]),
            "urls_read": len(sitemap_pool_urls),
            "profile_urls_seen": sitemap_profile_urls,
            "profile_urls_estimate": sitemap_estimate,
            "estimate_basis": sitemap_basis,
            "profile_sitemaps": profile_sitemaps,
            "note": f"at most {SITEMAP_LOCS_READ} URLs read per sitemap file and "
                    f"{SITEMAP_MAX_FETCHES} files per run",
        },
        "listing": {
            "listing_url": roster_page["url"],
            "profile_links_on_page": listing_profile_links,
            "next_page": {"how": nxt_p["how"], "template": nxt_p["template"],
                          "max_page_seen": nxt_p["max_page_seen"],
                          "new_profiles": nxt_p["new_detail_links"],
                          "proven": nxt_p["verified"]} if nxt_p else None,
            "sub_listings": {"count": sub_l["count_on_listing"],
                             "new_profiles": sub_l["new_detail_links"],
                             "proven": sub_l["verified"]} if sub_l else None,
        } if roster_page is not home else {"listing_url": None,
                                           "note": "no directory page found; homepage used"},
        "embedded": {
            "profile_urls_on_listing": len(embedded_roster_urls),
            "records_on_profile_page": collected_on_detail,
        },
        "best_route": best_route,
        "listing_reach_estimate": listing_reach,
        "network_calls": network_route,
        "search_inputs": search_route_r,
        **({"search_seed": search_seed["report"]} if search_seed else {}),
        # Second-call support (dry runs)
        "routes_deferred": any(
            r["status"] == "skipped" and re.match(r"^time budget", r.get("reason") or "")
            for r in (network_route, search_route_r)
        ),
        "routes_state": {
            "domain": domain,
            "category": category,
            "crawl_method": crawl_method,
            "detail_pattern": (inp or {}).get("detail_pattern"),
            "person": is_person_category,
            "count_words": count_words,
            "known_profiles": network_known[:60],
            "network_page": network_page,
            "scope": network_scope,
            "sub_listing_count": sub_l.get("count_on_listing") or 0,
            "search_pages": _uniq([roster_page["url"], home["url"]]),
            "static": {"route": static_best["route"], "reach": static_best["reach_estimate"],
                       "lower_bound": static_lower_bound, "basis": static_best["basis"]},
            "stated_total": (page_stated or {}).get("total"),
        },
        "stated_total": {"total": stated_all, "page_text": (page_stated or {}).get("snippet")}
        if stated_all else None,
        "profile_rule": {
            "source": rule_source,
            "candidates": rule_main["candidates"] if rule_source == "code" else None,
            "thin_evidence": rule_main["thin"] if rule_source == "code" else None,
            "fixed_segments": rule_main["fixed"] if rule_source == "code" else None,
            "forms": rule_main["forms"] if rule_source == "code" else None,
            "form_checks": form_checks,
            "redirect_form": (rule_alt or {}).get("pattern"),
            "excluded_non_profile_urls": excluded_non_detail,
            "sample_checks": [{"url": j["url"], "ok": j["ok"],
                               "reason": f"inconclusive: {j['reason']}" if j.get("inconclusive")
                               else j["reason"]} for j in sample_judged],
            "pattern": (inp or {}).get("detail_pattern"),
            "same_path_links": (pattern_coverage_diag or {}).get("pool"),
            "matched": (pattern_coverage_diag or {}).get("matched_after")
            if (pattern_coverage_diag or {}).get("widened")
            else (pattern_coverage_diag or {}).get("matched_before"),
            "known_problems": final_problems,
        },
        "samples": {
            "target": 5 if sample_short else sample_extra_wanted + 1,
            "fetched": len(samples),
            "must_have_ok": contract["must_have"]["ok"],
            "fields": len(contract["fields"]),
            "field_floor": field_floor_measured,
        },
    }
    extraction_in = (inp or {}).get("extraction")
    return {
        # v2Led: no roster pattern (version 2's list route replaces the roster crawl).
        "roster_pattern": None if v2_led else code_roster_pattern,
        "detail_pattern": (inp or {}).get("detail_pattern"),
        "field_floor": field_floor_measured,
        "extraction": {
            **(extraction_in if isinstance(extraction_in, dict) else {"list_source": "none"}),
            "site_contract": final_site_contract,
            **({"navigation": navigation} if navigation else {}),
            "best_route": best_route,
        },
        "site_contract_summary": {
            "fields": len(contract["fields"]),
            "must_have_ok": contract["must_have"]["ok"],
            "unmapped": len(contract.get("unmapped") or []),
            "unkeyed": len(contract.get("unkeyed") or []),
            "samples": len(contract.get("samples") or []),
            "taxonomy_fields": len(contract.get("taxonomy_fields") or {}),
            "taxonomy_candidates": contract.get("taxonomy_candidates") or 0,
            "taxonomy_duplicates": len(contract.get("taxonomy_duplicates") or []),
            "firm_profile_fields": len(u.g(firm_profile, "values") or {}),
            "rules_kept": rules_kept,
            "extra_fields": len(extra_fields),
            "extra_new": len([f for f in extra_fields.values()
                              if u.g(f, "key_source") == "new"]),
            "field_floor_ai": field_floor_ai,
            "field_floor_measured": field_floor_measured,
            "field_floor_per_sample": field_floor_per_sample,
        },
        "route_report": route_report,
        "sample_roster_url": roster_page["url"],
        "sample_detail_url": detail["url"],
        "sitemap_trace": sitemap_trace,
        "profile_sitemaps": profile_sitemaps,
        "subdomain_robots": subdomain_robots,
        "detail_pattern_check": {
            "must_match": must_match,
            "must_not_match": must_not_match,
            "first_problems": first_check["problems"],
            "retried": retried,
            "final_problems": final_problems,
            **({"same_path_other_kind": ambiguous_same_path} if ambiguous_same_path else {}),
            **({"coverage": pattern_coverage_diag} if pattern_coverage_diag else {}),
        },
        **({"self_heal": {"from_host": retry["host"], "roster_url": retry["rosterUrl"],
                          "reason": retry["reason"]}} if retry else {}),
        **({"mapper_hints": hints_diag} if hints_diag else {}),
        "listing_navigation": {
            "page1_detail_links": nv["page1_detail_links"],
            "next_page": (f"{nxt_p['how']}: +{nxt_p['new_detail_links']}"
                          f"{' (verified)' if nxt_p['verified'] else ''}") if nxt_p else None,
            "sub_listings": (f"{sub_l['source']} x{sub_l['count_on_listing']}: "
                             f"+{sub_l['new_detail_links']}"
                             f"{' (verified)' if sub_l['verified'] else ''}") if sub_l else None,
            **({"skipped": nv["skipped"]} if nv.get("skipped") else {}),
        } if navigation else {
            "skipped": "no directory page (homepage used)" if roster_page is home
            else "no detail pattern",
        },
        "embedded_roster_urls": len(embedded_roster_urls),
        "embedded_detail_records": collected_on_detail,
        "detail_entity_type": detail_entity_type,
        "detail_entity_type_source": detail_entity_type_source,
    }


def _extra_fields_step(
    *, db: u.Db, sc: Any, api_key: str, model: str, category: str, primary_subject: str,
    contract_fields: dict, all_tax_keys: list[Any], prev_contract: dict | None,
    extra_items: list[Any], samples: list[dict], site_entity_names: set[str],
    contract_opts: dict, extra_key_rows: list[dict],
) -> dict:
    """C14: extra fields — provisional keys before validation; C14c: final key decided by the
    matching call. Returns {contract_fields, extra_fields, extra_dropped, route_cands}."""
    extra_dropped: list[dict] = []
    extra_fields: dict[str, Any] = {}
    sticky_keys: set[str] = set()
    # Staging schema step 2: static ids with no page rule yet, and extra -> static candidates.
    open_static_ids = [i for i in sc.all_field_ids(primary_subject)
                       if sc.is_route_target(i) and (not contract_fields.get(i)
                                                     or sc.is_mergeable_id(i))]
    open_static_set = set(open_static_ids)
    route_cands: dict[str, dict] = {}
    ai_static_keys: set[str] = set()
    prefix = sc.EXTRA_PREFIX
    try:
        universal_names = {*sc.PERSON_IDENTITY_KEYS, *sc.LOCATION_KEYS, *sc.FIRM_KEYS}
        tax_slugs = {u.g(k, "slug") for k in all_tax_keys}
        cands: list[dict] = []
        # Sticky: previous extra rules come first so a still-valid rule is kept.
        prev_extra = (prev_contract or {}).get("extra_fields") or {}
        for r in u.g(sc.previous_contract_rules(prev_contract), "rules") or []:
            if not r["id"].startswith(prefix):
                continue
            key = r["id"][len(prefix):]
            pf = prev_extra.get(key) if isinstance(prev_extra, dict) else None
            if not (pf or {}).get("sample"):
                continue
            sticky_keys.add(key)
            cands.append({"key": key, "label": pf.get("label") or key, "rule": r,
                          "key_source": pf.get("key_source") or "new", "sample": pf["sample"]})
        for sid, lst in ((prev_contract or {}).get("static_routes") or {}).items():
            for route in lst if isinstance(lst, list) else []:
                if isinstance(route, dict) and route.get("kind") == "extra" \
                        and route.get("from") in sticky_keys and sid in open_static_set:
                    route_cands[route["from"]] = {
                        "static_id": sid, "source": "sticky",
                        **({"reason": route["reason"]} if route.get("reason") else {}),
                    }
        for it in extra_items:
            label = u.js_str(it.get("label") if it.get("label") is not None else "").strip()
            key = sc.normalize_extra_key(u.js_str(it.get("key") or label))
            if not key:
                continue
            if it.get("match") == "static" or sc.is_static_extra_key(key, universal_names):
                target = sc.static_target_for_key(key, open_static_set, primary_subject)
                if target:
                    route_cands[key] = {"static_id": target, "source": "name"}
                elif sc.is_static_extra_key(key, universal_names) or not open_static_set:
                    extra_dropped.append({"label": label, "key": key, "reason": "static"})
                    continue
                else:
                    ai_static_keys.add(key)
            if it.get("match") == "taxonomy" or key in tax_slugs:
                d = {"label": label, "key": key, "reason": "taxonomy"}
                if key in tax_slugs:
                    d["match"] = key
                extra_dropped.append(d)
                continue
            rule: dict[str, Any] = {"id": "",
                                    "strategy": "label" if it.get("strategy") == "label" else "css"}
            if it.get("css"):
                rule["css"] = u.js_str(it["css"])
            if it.get("strategy") == "label":
                rule["label"] = label
            if it.get("attr"):
                rule["attr"] = it["attr"]
            if it.get("multi"):
                rule["multi"] = True
            if it.get("split_commas"):
                rule["split_commas"] = True
            # C14c: incomplete rules are dropped.
            if (rule["strategy"] == "css" and not rule.get("css")) or (
                    rule["strategy"] == "label" and not rule.get("label")):
                diag_rule = {k: x for k, x in rule.items() if k != "id"}
                extra_dropped.append({"label": label, "key": key,
                                      "reason": "rule_failed_validation", "rule": diag_rule,
                                      "found": 0, "samples": len(samples)})
                continue
            if key in sticky_keys:
                continue  # sticky rule for this key already present
            cands.append({"key": key, "label": label, "rule": rule, "key_source": "new",
                          "sample": u.js_str(it.get("sample") if it.get("sample") is not None
                                             else "")})
        extra_meta: dict[str, dict] = {}
        extra_rules: list[dict] = []
        extra_types: dict[str, str] = {}
        for c in cands:
            if c["key"] in extra_meta:
                continue  # two items with the same key: keep the first
            extra_meta[c["key"]] = {"label": c["label"], "key_source": c["key_source"],
                                    "sample": c["sample"]}
            fid = prefix + c["key"]
            extra_rules.append({**c["rule"], "id": fid})
            r = c["rule"]
            extra_types[fid] = "list" if r.get("multi") else "url" \
                if r.get("attr") in ("href", "src") else "text"
        if extra_rules:
            merged = sc.merge_css_rules(contract_fields, extra_rules, samples, primary_subject,
                                        site_entity_names, contract_opts, extra_types)
            rule_by_id = {r["id"]: r for r in extra_rules}

            def diag_of(fid: str) -> dict | None:
                r = rule_by_id.get(fid)
                if not r:
                    return None
                return {k: x for k, x in r.items() if k != "id"}

            extra_found = u.g(merged, "extraFound") or {}
            for fid, reason in (u.g(merged, "extraReasons") or {}).items():
                key = fid[len(prefix):]
                extra_dropped.append({
                    "label": (extra_meta.get(key) or {}).get("label") or key, "key": key,
                    "reason": reason, "rule": diag_of(fid), "found": extra_found.get(fid) or 0,
                    "samples": len(samples),
                })
            extras_only = {fid: f for fid, f in (u.g(merged, "fields") or {}).items()
                           if fid.startswith(prefix)}
            # C14b: one list = one container, then the sample agreement check.
            shown_docs = [sc.doc_of(s) for s in samples[:2]]
            for fid, f in list(extras_only.items()):
                key = fid[len(prefix):]
                ai_sample = (extra_meta.get(key) or {}).get("sample") or ""
                spec = f
                loc = (f or {}).get("locator") or {}
                if loc.get("tier") == "css" and loc.get("multi"):
                    spec = {**f, "locator": sc.choose_extra_container(loc, shown_docs, ai_sample)}
                one = {"extra_fields": {key: {**spec, "label": "", "key_source": "new"}}}
                shown = [
                    (sc.apply_extra_fields(shown_docs[i], s["url"], one, site_entity_names,
                                           contract_opts) or {}).get(key)
                    for i, s in enumerate(samples[:2])
                ]
                if not sc.extra_sample_agrees(ai_sample, shown):
                    extra_dropped.append({
                        "label": (extra_meta.get(key) or {}).get("label") or key, "key": key,
                        "reason": "sample_mismatch", "rule": diag_of(fid),
                        "found": extra_found.get(fid) or 0, "samples": len(samples),
                    })
                    del extras_only[fid]
                    continue
                extras_only[fid] = spec
            probe = {"extra_fields": {fid[len(prefix):]: {**f, "label": "", "key_source": "new"}
                                      for fid, f in extras_only.items()}}
            per_sample = [sc.apply_extra_fields(sc.doc_of(s), s["url"], probe, site_entity_names,
                                                contract_opts) for s in samples]
            fin = sc.finalize_extra_fields({**contract_fields, **extras_only}, extra_meta,
                                           per_sample, len(samples))
            contract_fields = u.g(fin, "fields")
            extra_fields = dict(u.g(fin, "extra_fields") or {})
            extra_dropped.extend(u.g(fin, "dropped") or [])
        # C14c: key matching by the LLM on real example values (new, non-sticky extras only).
        new_keys = [k for k in extra_fields
                    if k not in sticky_keys and (route_cands.get(k) or {}).get("source") != "name"]
        list_keys = {r["normalized"] for r in extra_key_rows}
        match_of: dict[str, dict] = {}
        matched = False
        open_for_match = [i for i in open_static_ids if sc.is_mergeable_id(i) or not any(
            c.get("static_id") == i for c in route_cands.values())]
        sticky_for_static = [k for k in extra_fields if k in sticky_keys and k not in route_cands]
        def_of: dict[str, dict] = {}
        new_name_of: dict[str, str | None] = {}
        if new_keys or (sticky_for_static and open_for_match):
            try:
                doms = list(dict.fromkeys(r["first_source"] for r in extra_key_rows
                                          if r.get("first_source")))
                ex_by_dom: dict[str, list[dict]] = {}
                if doms:
                    c_rows = db.rows_or_none(
                        "select domain, category_slug, "
                        "extraction->'site_contract'->'extra_fields' as extra_fields "
                        "from disco_site_contract where domain = any(%s)",
                        (doms,),
                    ) or []
                    for cr in c_rows:
                        ex_by_dom.setdefault(cr["domain"], []).append(
                            {"category_slug": cr["category_slug"],
                             "extra_fields": cr.get("extra_fields")})
                existing = []
                for r in extra_key_rows:
                    arr = ex_by_dom.get(r.get("first_source") or "", [])

                    def has(c: dict, r: dict = r) -> bool:
                        ef = c.get("extra_fields")
                        return isinstance(ef, dict) and bool(ef.get(r["normalized"]))

                    hit = next((c for c in arr if c["category_slug"] == r.get("gcid") and has(c)),
                               None) or next((c for c in arr if has(c)), None)
                    spec = (hit or {}).get("extra_fields", {}).get(r["normalized"]) if hit else None
                    spec = spec if isinstance(spec, dict) else {}
                    dict_examples = list(r["examples"])[:3] if isinstance(r.get("examples"),
                                                                           list) else []
                    lbl = spec.get("label") if spec.get("label") is not None else r.get("raw_label")
                    entry: dict[str, Any] = {"key": r["normalized"],
                                             "label": u.js_str(lbl if lbl is not None else "")}
                    if r.get("definition"):
                        entry.update({"meaning": r["definition"], "format": r.get("value_type"),
                                      "whose": r.get("subject")})
                    entry["examples"] = dict_examples if dict_examples else (
                        list(spec["examples"])[:3] if isinstance(spec.get("examples"), list)
                        else [])
                    entry["category"] = r.get("gcid")
                    existing.append(entry)
                news = [
                    *({"key": k, "label": u.g(extra_fields[k], "label"),
                       "examples": u.g(extra_fields[k], "examples") or []} for k in new_keys),
                    *({"key": k, "label": u.g(extra_fields[k], "label"),
                       "examples": u.g(extra_fields[k], "examples") or [], "keep_key": True}
                      for k in sticky_for_static),
                ]
                static_lines = "\n".join(
                    f"{i} ({sc.field_type(i)})"
                    + (f" — {sc.FIELD_MEANINGS[i]}" if sc.FIELD_MEANINGS.get(i) else "")
                    for i in open_for_match
                )
                prompt = (
                    "You match newly found extra facts from a website to an existing shared list "
                    "of extra keys.\n"
                    f"NEW EXTRAS (key, label, example values):\n{u.js_json(news)}\n\n"
                    "EXISTING KEYS (key, label, example values, category):\n"
                    f"{u.js_json(existing)}\n\n"
                    + ((
                        "STATIC IDS (fixed profile fields; list ids collect several extras, e.g. "
                        '"Products" and "Services" both → person.services; id (type) — meaning):\n'
                        f"{static_lines}\n\n"
                    ) if open_for_match else "")
                    + "For each new extra decide whether it holds the same kind of information as "
                    "an existing key "
                    "(same meaning, judged by the example values, not by wording). Answer for "
                    "every new extra with "
                    "{ key, match: <existing key> | null, static_id: <open static id> | null, "
                    "reason: <one short sentence> }. "
                    "static_id only when the example values are exactly what that static id means "
                    "(e.g. a list of focus areas → person.services); otherwise null. "
                    "Two new extras must not map to the same existing key, nor to the same "
                    "non-list static id. "
                    "For extras marked keep_key, answer match: null; only static_id may be set.\n"
                    "For every new extra with match: null (not keep_key), also give definition "
                    "(one generic sentence saying what the value "
                    "means, not tied to this site), value_type (one of "
                    f"{', '.join(sc.EXTRA_VALUE_TYPES)}) and subject "
                    f"({', '.join(sc.EXTRA_SUBJECTS)}). "
                    "If its key is already an EXISTING key name but the meaning differs, give "
                    "new_key: a different descriptive snake_case "
                    "name that is not in the existing list; never add numbers to make a name "
                    "unique."
                )
                out = u.call_claude_map(api_key, model, prompt, match_extra_tool(), 2048)
                used: set[str] = set()
                used_static: set[str] = set()
                ms = out.get("matches") if isinstance(out, dict) else None
                for m in ms if isinstance(ms, list) else []:
                    m = m if isinstance(m, dict) else {}
                    k = u.js_str(m.get("key") if m.get("key") is not None else "")
                    reason = u.js_str(m.get("reason") if m.get("reason") is not None
                                      else "")[:300]
                    if k in sticky_for_static:
                        sid0 = u.js_str(m["static_id"]) if m.get("static_id") else None
                        if sid0 and sid0 in open_for_match and (
                                sc.is_mergeable_id(sid0) or sid0 not in used_static) \
                                and k not in route_cands:
                            used_static.add(sid0)
                            route_cands[k] = {"static_id": sid0, "source": "sticky",
                                              "reason": reason}
                        continue
                    if k not in new_keys or k in match_of:
                        continue
                    target = u.js_str(m["match"]) if m.get("match") else None
                    if target and (target not in list_keys or target in used
                                   or (target != k and extra_fields.get(target))):
                        target = None
                    if target:
                        used.add(target)
                    match_of[k] = {"match": target, "reason": reason}
                    if not target:
                        vt = m.get("value_type") if u.js_str(m.get("value_type")) in \
                            sc.EXTRA_VALUE_TYPES else None
                        sj = m.get("subject") if u.js_str(m.get("subject")) in sc.EXTRA_SUBJECTS \
                            else None
                        df = m["definition"].strip()[:300] if isinstance(m.get("definition"),
                                                                        str) else ""
                        if df and vt and sj:
                            def_of[k] = {"definition": df, "value_type": vt, "subject": sj}
                        new_name_of[k] = sc.normalize_extra_key(u.js_str(m["new_key"])) \
                            if m.get("new_key") else None
                    sid = u.js_str(m["static_id"]) if m.get("static_id") else None
                    if sid and sid in open_for_match and (sc.is_mergeable_id(sid)
                                                          or sid not in used_static):
                        used_static.add(sid)
                        route_cands[k] = {"static_id": sid, "source": "match", "reason": reason}
                matched = True
            except Exception:  # noqa: BLE001
                u.log.exception("extra key matching failed")
        renamed: dict[str, Any] = {}
        renamed_from: dict[str, str] = {}
        for k, spec in extra_fields.items():
            if k in sticky_keys or (route_cands.get(k) or {}).get("source") == "name":
                if k not in renamed:
                    renamed[k] = spec
                continue
            # Called static by the locator call but not routed to an open static id: dropped.
            if k in ai_static_keys and k not in route_cands:
                extra_dropped.append({"label": u.g(spec, "label"), "key": k, "reason": "static"})
                continue
            key = k
            src = "new"
            m = match_of.get(k)
            if matched:
                if m and m.get("match"):
                    key = m["match"]
                    src = "existing_extra"
                elif k in list_keys or (re.search(r"_\d+$", k)
                                        and re.sub(r"_\d+$", "", k) in list_keys):
                    # Fix (extra key dictionary, 2026-10-22)
                    nk = new_name_of.get(k) or ""
                    ok = (bool(nk) and not re.search(r"_\d+$", nk) and nk not in list_keys
                          and not extra_fields.get(nk) and not renamed.get(nk)
                          and not sc.is_static_extra_key(nk, universal_names)
                          and nk not in tax_slugs)
                    if not ok:
                        d = {"label": u.g(spec, "label"), "key": k, "reason": "name_conflict"}
                        if nk:
                            d["match"] = nk
                        extra_dropped.append(d)
                        continue
                    key = nk
            elif k in list_keys:
                src = "existing_extra"  # fallback: exact key equality only
            if key in renamed:
                continue
            df = def_of.get(k) if src == "new" else None
            renamed[key] = {**spec, "key_source": src,
                            **({"match_reason": m["reason"]} if m and m.get("reason") else {}),
                            **(df or {})}
            if key != k:
                renamed_from[k] = key
        for frm, to in renamed_from.items():
            if frm in route_cands and to not in route_cands:
                route_cands[to] = route_cands.pop(frm)
        # Registry slugs (any gcid) only for keys that are still new — one query.
        pending_keys = [k for k, s in renamed.items()
                        if k not in sticky_keys and u.g(s, "key_source") == "new"]
        if pending_keys:
            reg = db.rows_or_none(
                "select node_slug from exp_vertical_node_registry where node_slug = any(%s) "
                "limit 50",
                (pending_keys,),
            ) or []
            for row in reg:
                if renamed.get(row["node_slug"]):
                    renamed[row["node_slug"]]["key_source"] = "registry_slug"
        extra_fields = renamed
    except Exception:  # noqa: BLE001
        u.log.exception("extra fields step failed")
    return {"contract_fields": contract_fields, "extra_fields": extra_fields,
            "extra_dropped": extra_dropped, "route_cands": route_cands}
