"""Pure page / URL helpers of the disco AI worker (port of `disco-ai-worker.ts`).

Link extraction, roster-link ranking, page shape checks, page entity kind, listing-navigation
link helpers, sitemap scoring, the code-built profile URL rule and candidate ranking. No network,
no database.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from etl.disco import ai_worker_util as u
from etl.disco.ai_worker_discover import clean_url, is_same_site

_I = re.IGNORECASE

# ---- §2 roster links ----------------------------------------------------------------------------
ROSTER_HINTS = [
    "find a loan officer",
    "find an agent",
    "loan officers",
    "our agents",
    "find a lender",
    "locations",
    "branches",
    "offices",
    "our team",
    "agents",
    "find a ",
    "find an ",
    "locator",
    "near me",
    "near you",
    "directory",
]
ROSTER_NEGATIVE = [
    "career", "job", "login", "log in", "sign in", "recruit", "press", "news",
    "investor relations", "experienced professionals", "students", "graduates", "internship",
    "hiring", "apply now", "join our team", "join us",
]
SITEMAP_NEGATIVE = [
    "video", "image", "news", "blog", "press", "career", "job", "media", "article",
    "disclosure", "legal", "privacy", "terms", "brochure",
]


def site_root_of(url: str) -> str:
    """Host without a leading "www." — the site root for same-company checks."""
    x = u.try_url(url)
    return re.sub(r"^www\.", "", x.host.lower()) if x else ""


def text_tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def extract_all_links(html: str, base: str) -> list[dict]:
    """Every same-site (incl. subdomain) <a> with non-empty visible text, deduped by resolved
    href, capped at 50 in document order: [{href, text}]."""
    out: list[dict] = []
    seen: set[str] = set()
    root = site_root_of(base)
    for m in re.finditer(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)</a>", html, _I):
        if len(out) >= 50:
            break
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip()
        if not text:
            continue
        abs_ = u.absolutize(m.group(1), base)
        if not abs_ or not re.match(r"^https?:", abs_):
            continue
        if not is_same_site(abs_, root):
            continue
        if abs_ in seen:
            continue
        seen.add(abs_)
        out.append({"href": abs_, "text": text[:160]})
    return out


def norm_roster_text(s: str) -> str:
    return re.sub(r"(?:[-_/.+?=&#]|%20)+", " ", s.lower())


def rank_roster_links(html: str, base: str, extra_hints: list[str] | None = None) -> list[dict]:
    """Every same-company link scored as a roster candidate: +3 category phrase (extraHints),
    +1 generic ROSTER_HINTS phrase, -5 negative phrase. Sorted by score, then document order."""
    root = site_root_of(base)
    out: list[dict] = []
    seen: set[str] = set()
    extra_n = [norm_roster_text(h) for h in (extra_hints or [])]
    hints_n = [norm_roster_text(h) for h in ROSTER_HINTS]
    neg_n = [norm_roster_text(h) for h in ROSTER_NEGATIVE]
    i = 0
    for m in re.finditer(r"<a\b([^>]*)>([\s\S]*?)</a>", html, _I):
        attrs = m.group(1)
        hm = re.search(r"\bhref\s*=\s*[\"']([^\"']+)[\"']", attrs, _I)
        if not hm:
            continue
        abs_ = u.absolutize(hm.group(1), base)
        if not abs_ or not re.match(r"^https?:", abs_) or abs_ in seen:
            continue
        if root and not is_same_site(abs_, root):
            continue
        seen.add(abs_)
        inner = m.group(2)
        inner = re.sub(r"<svg\b[\s\S]*?</svg>", " ", inner, flags=_I)
        inner = re.sub(r"<script\b[\s\S]*?</script>", " ", inner, flags=_I)
        inner = re.sub(r"<style\b[\s\S]*?</style>", " ", inner, flags=_I)
        inner = re.sub(r"<[^>]+>", " ", inner)
        am = re.search(r"\baria-label\s*=\s*[\"']([^\"']*)[\"']", attrs, _I)
        tm = re.search(r"\btitle\s*=\s*[\"']([^\"']*)[\"']", attrs, _I)
        label = re.sub(r"\s+", " ", " ".join(
            [inner, am.group(1) if am else "", tm.group(1) if tm else ""]
        )).strip().lower()
        hay = norm_roster_text(f"{label} {abs_}")
        score = 0
        if any(h in hay for h in extra_n):
            score += 3
        if any(h in hay for h in hints_n):
            score += 1
        if any(h in hay for h in neg_n):
            score -= 5
        out.append({"href": abs_, "text": label[:160], "score": score, "i": i})
        i += 1
    out.sort(key=lambda x: (-x["score"], x["i"]))
    return [{"href": x["href"], "text": x["text"], "score": x["score"]} for x in out]


def find_roster_link(html: str, base: str, extra_hints: list[str] | None = None) -> str | None:
    ranked = rank_roster_links(html, base, extra_hints or [])
    return ranked[0]["href"] if ranked and ranked[0]["score"] > 0 else None


# ---- page shape ---------------------------------------------------------------------------------
def _strip_text(html: str, noscript: bool = False) -> str:
    s = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=_I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=_I)
    if noscript:
        s = re.sub(r"<noscript[\s\S]*?</noscript>", " ", s, flags=_I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def has_entity_data(html: str) -> bool:
    if re.search(r"application/ld\+json", html, _I):
        return True
    if re.search(r"__NEXT_DATA__|__NUXT__|window\.__INITIAL_STATE__", html, _I):
        return True
    return len(_strip_text(html)) > 2000


def is_js_shell(html: str) -> bool:
    return len(_strip_text(html)) < 500 and bool(
        re.search(r"<div[^>]+id=[\"'](root|app|__next)[\"']", html, _I)
    )


def is_empty_shell(html: str) -> bool:
    """Fix (script-only form results, 2026-10-08): visible text under 500 characters."""
    if not html:
        return True
    return len(_strip_text(html, noscript=True)) < 500


# ---- page entity kind ---------------------------------------------------------------------------
# Keys whose values are related people/details, not the page's subject.
ENTITY_KIND_EXTRA_SKIP = {
    "employee", "employees", "member", "members", "founder", "founders", "alumni", "contactPoint",
}


def normalize_page_ref(raw: str) -> str:
    """Drop fragment + query, lowercase, drop the www. host prefix, drop one trailing slash."""
    s = raw.strip()
    h = s.find("#")
    if h != -1:
        s = s[:h]
    q = s.find("?")
    if q != -1:
        s = s[:q]
    s = s.lower()
    m = re.match(r"^(https?://)([^/]+)(/.*)?$", s)
    if m:
        host = m.group(2)
        host = host.removeprefix("www.")
        s = host + (m.group(3) or "")
    s = s.removesuffix("/")
    return s


def detect_page_entity_kind_detailed(
    html: str, site_entity_names: set[str], page_url: str | None = None
) -> dict:
    """What the page describes: {kind: 'professional'|'location'|None, source}."""
    sc = u.sc()
    blocks = sc.extract_json_ld_blocks(html)
    entity_re = sc.ENTITY_TYPE_RE
    skip_keys = sc.JSONLD_SKIP_KEYS

    def types(o: dict) -> list[str]:
        return list(sc.json_ld_types(o))

    def qualifies(o: dict) -> bool:
        name = o.get("name")
        return (
            isinstance(name, str) and bool(name.strip())
            and any(entity_re.search(x) for x in types(o))
            and name.strip().lower() not in site_entity_names
        )

    def is_person(o: dict) -> bool:
        return any(re.search("person", x, _I) for x in types(o))

    all_: list[dict] = []
    stack: list[Any] = list(blocks)
    guard = 0
    while stack and guard < 5000:
        guard += 1
        n = stack.pop()
        if isinstance(n, list):
            stack.extend(n)
            continue
        if not isinstance(n, dict):
            continue
        all_.append(n)
        for v in n.values():
            if isinstance(v, dict | list):
                stack.append(v)
    # (a) ProfilePage
    if any("ProfilePage" in types(o) for o in all_):
        return {"kind": "professional", "source": "jsonld"}
    # (b) qualifying mainEntity
    for o in all_:
        me = o.get("mainEntity")
        if isinstance(me, dict) and qualifies(me):
            return {"kind": "professional" if is_person(me) else "location", "source": "jsonld"}
    # (b2) qualifying nodes whose url/@id points at this very page.
    if page_url:
        target = normalize_page_ref(page_url)
        if target:
            self_nodes = [
                o for o in all_
                if qualifies(o) and any(
                    isinstance(v, str) and normalize_page_ref(v) == target
                    for v in (o.get("url"), o.get("@id"))
                )
            ]
            if self_nodes:
                persons = len([o for o in self_nodes if is_person(o)])
                if persons == len(self_nodes):
                    return {"kind": "professional", "source": "url_match"}
                if persons == 0:
                    return {"kind": "location", "source": "url_match"}

    # (c) breadth-first; items of arrays and @graph sit at the same depth as the array
    def expand(items: list[Any]) -> list[dict]:
        out: list[dict] = []
        q: list[Any] = list(items)
        gq = 0
        while q and gq < 5000:
            gq += 1
            n = q.pop(0)
            if isinstance(n, list):
                q.extend(n)
                continue
            if not isinstance(n, dict):
                continue
            out.append(n)
            graph = n.get("@graph")
            if isinstance(graph, list):
                q.extend(graph)
        return out

    level = expand(list(blocks))
    depth = 0
    while level and depth < 50:
        depth += 1
        hits = [o for o in level if qualifies(o)]
        if hits:
            persons = len([o for o in hits if is_person(o)])
            if persons == len(hits):
                return {"kind": "professional", "source": "jsonld"}
            if persons == 0:
                return {"kind": "location", "source": "jsonld"}
            return {"kind": None, "source": None}
        nxt: list[Any] = []
        for o in level:
            for k, v in o.items():
                if k == "@graph" or k in skip_keys or k in ENTITY_KIND_EXTRA_SKIP:
                    continue
                if isinstance(v, dict | list):
                    nxt.append(v)
        level = expand(nxt)
    return {"kind": None, "source": None}


def detect_page_entity_kind(
    html: str, site_entity_names: set[str], page_url: str | None = None
) -> str | None:
    return detect_page_entity_kind_detailed(html, site_entity_names, page_url)["kind"]


# ---- §3 detail URLs -----------------------------------------------------------------------------
_ASSET_RE = re.compile(r"\.(jpg|jpeg|png|gif|svg|pdf|css|js|webp|ico)$", _I)


def collect_detail_urls(html: str, base: str, cap: int = 40) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    bu = u.try_url(base)
    base_host = bu.host if bu else ""
    for m in re.finditer(r"<a\b[^>]*href=[\"']([^\"'#?]+)[\"']", html, _I):
        abs_ = u.absolutize(m.group(1), base)
        if not abs_ or not re.match(r"^https?:", abs_):
            continue
        x = u.try_url(abs_)
        if not x:
            continue
        if base_host and x.host != base_host:
            continue
        if len(u.path_segs(x)) < 2:
            continue
        if _ASSET_RE.search(x.pathname):
            continue
        key = x.href
        if key in seen:
            continue
        seen.add(key)
        out.append(key)

    def depth(s: str) -> int:
        x = u.try_url(s)
        return len(u.path_segs(x)) if x else 0

    # deepest paths first — those are the entity detail pages
    return sorted(out, key=lambda s: -depth(s))[:cap]


# ---- listing navigation links -------------------------------------------------------------------
NAV_PAGE_PARAMS = [
    "page", "p", "pg", "pagenum", "pagenumber", "page_number", "pageno", "start", "offset",
    "from", "skip",
]
NAV_NEXT_TEXT = re.compile(r"^(next|next page|next ›|next »|more|load more|show more|›|»|>|→|>>)$",
                           _I)


def nav_attr(attrs: str, name: str) -> str:
    m = re.search(rf"\b{name}\s*=\s*(\"([^\"]*)\"|'([^']*)')", attrs, _I)
    if not m:
        return ""
    return m.group(2) if m.group(2) is not None else (m.group(3) or "")


def collect_page_links(html: str, base: str, cap: int = 2000) -> list[dict]:
    """Every same-host link on a page, query strings kept: [{href, label, rel, cls}]."""
    out: list[dict] = []
    seen: set[str] = set()
    bu = u.try_url(base)
    base_host = bu.host if bu else ""

    def push(raw_href: str, label: str, rel: str, cls: str) -> None:
        if (
            len(out) >= cap or not raw_href or raw_href.startswith("#")
            or re.match(r"^(javascript|mailto|tel):", raw_href, _I)
        ):
            return
        abs_ = u.absolutize(raw_href.replace("&amp;", "&"), base)
        if not abs_ or not re.match(r"^https?:", abs_):
            return
        x = u.try_url(abs_)
        if not x:
            return
        if base_host and x.host != base_host:
            return
        if re.search(r"\.(jpg|jpeg|png|gif|svg|pdf|css|js|webp|ico|xml)$", x.pathname, _I):
            return
        u.clear_hash(x)
        key = x.href
        if key in seen:
            return
        seen.add(key)
        out.append({"href": key, "label": label, "rel": rel.lower(), "cls": cls.lower()})

    for m in re.finditer(r"<link\b([^>]*)>", html, _I):
        rel = nav_attr(m.group(1), "rel")
        if re.search(r"\bnext\b", rel, _I):
            push(nav_attr(m.group(1), "href"), "", rel, "")
    for m in re.finditer(r"<a\b([^>]*)>([\s\S]{0,600}?)</a>", html, _I):
        attrs = m.group(1)
        text = re.sub(r"<[^>]+>", " ", m.group(2))
        text = re.sub(r"&nbsp;|&#160;", " ", text).replace("&raquo;", "»")
        text = text.replace("&rsaquo;", "›").replace("&gt;", ">")
        text = re.sub(r"\s+", " ", text).strip()
        label = (text or nav_attr(attrs, "aria-label") or nav_attr(attrs, "title"))[:80]
        push(nav_attr(attrs, "href"), label, nav_attr(attrs, "rel"),
             f"{nav_attr(attrs, 'class')} {nav_attr(attrs, 'aria-label')}")
    return out


def detail_link_set(links: list[dict], detail_re: re.Pattern[str]) -> list[str]:
    """Profile links among `links` (an ordered set, as a list)."""
    out: dict[str, None] = {}
    for link in links:
        href = link["href"]
        hit = False
        try:
            hit = bool(detail_re.search(href))
            if not hit:
                x = u.url_of(href)
                u.clear_search(x)
                hit = bool(detail_re.search(x.href))
                if hit:
                    out[x.href] = None
                    continue
        except Exception:  # noqa: BLE001
            hit = False
        if hit:
            out[href] = None
    return list(out)


def page_template(url: str, listing_url: str) -> str | None:
    """"Page n" template when `url` is the listing URL plus a page number (query or path)."""
    try:
        x = u.url_of(url)
        r = u.url_of(listing_url)
        if x.host != r.host:
            return None
        r_path = re.sub(r"/+$", "", r.pathname)
        if re.sub(r"/+$", "", x.pathname) == r_path:
            r_params = r.search_params()
            for k, v in x.search_params():
                if not re.match(r"^\d+$", v) or int(v) < 2:
                    continue
                rv = next((pv for pk, pv in r_params if pk == k), None)
                if rv is not None and rv == v:
                    continue
                if k.lower() not in NAV_PAGE_PARAMS and v != "2":
                    continue
                t = u.url_of(x.href)
                u.set_search_param(t, k, "__N__")
                return t.href.replace("__N__", "{n}", 1)
            return None
        m = re.match(rf"^{u.re_esc(r_path)}/(?:page/|p/)?(\d+)/?$", x.pathname, _I)
        if m and int(m.group(1)) >= 2:
            t = u.url_of(x.href)
            new_path = re.sub(
                rf"{m.group(1)}(/?)$", lambda mm: "{n}" + mm.group(1), x.pathname, count=1
            )
            u.set_pathname(t, new_path)
            return u.decode_uri(t.href)
    except Exception:  # noqa: BLE001, S110
        pass
    return None


# ---- sitemaps -----------------------------------------------------------------------------------
def extract_locs(xml: str, max_: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r"<loc>\s*([^<]+?)\s*</loc>", xml):
        if len(out) >= max_:
            break
        loc = clean_url(m.group(1))
        if not loc or loc in seen:
            continue
        seen.add(loc)
        out.append(loc)
    return out


def is_sitemap_index(xml: str) -> bool:
    return bool(re.search(r"<sitemapindex[\s>]", xml, _I))


def _eq(a: str, t: str) -> bool:
    return a == t or a == t + "s"


def sitemap_relevance(url: str, terms: list[str]) -> int:
    """+2 per term whose tokens appear as a contiguous run in the path; -3 once for a negative
    word."""
    x = u.try_url(url)
    path = x.pathname if x else url
    toks = [t for t in re.split(r"[/\-_.]+", path.lower()) if t]
    score = 0
    for t in terms:
        tt = [w for w in re.split(r"\s+", t.lower()) if w]
        if not tt or len(tt) > len(toks):
            continue
        hit = False
        i = 0
        while i + len(tt) <= len(toks) and not hit:
            hit = all(_eq(toks[i + j], w) for j, w in enumerate(tt))
            i += 1
        if hit:
            score += 2
    if any(any(_eq(a, w) for w in SITEMAP_NEGATIVE) for a in toks):
        score -= 3
    return score


ROBOTS_MAX_SUBDOMAINS = 3


def host_relevance(url: str, site_root: str, terms: list[str]) -> int:
    """Relevance from the SUBDOMAIN part of a URL's host: +1 term head word, -3 negative."""
    x = u.try_url(url)
    if not x:
        return 0
    host = x.host.lower()
    if not site_root or host == site_root or host == "www." + site_root:
        return 0
    sub = host[: -(len(site_root) + 1)] if host.endswith("." + site_root) else host
    toks = text_tokens(sub)
    if any(any(_eq(a, w) for w in SITEMAP_NEGATIVE) for a in toks):
        return -3
    for t in terms:
        tt = text_tokens(t)
        last = tt[-1] if tt else None
        if last and any(_eq(a, last) for a in toks):
            return 1
    return 0


def extract_robots_sitemaps(body: str) -> list[str]:
    out: list[str] = []
    for line in re.split(r"\r?\n", body):
        m = re.match(r"^\s*sitemap\s*:\s*(\S+)", line, _I)
        if m:
            s = clean_url(m.group(1))
            if s and s not in out:
                out.append(s)
    return out


def hint_shape(url: str) -> str:
    """Host + first path segment + number of segments."""
    x = u.try_url(url)
    if not x:
        return ""
    segs = u.path_segs(x)
    return f"{x.host}/{(segs[0] if segs else '').lower()}#{len(segs)}"


def parent_key(url: str) -> str:
    """Host + every path segment except the last, plus depth."""
    x = u.try_url(url)
    if not x:
        return ""
    segs = u.path_segs(x)
    if not segs:
        return ""
    return f"{x.host.lower()}/{'/'.join(segs[:-1]).lower()}#{len(segs)}"


def _rx(pattern: Any) -> re.Pattern[str] | None:
    if not isinstance(pattern, str) or not pattern:
        return None
    try:
        return u.js_re(pattern)
    except ValueError:
        return None


def pattern_coverage(pattern: Any, urls: list[str]) -> dict:
    """Share of `urls` a detail_pattern matches (invalid regex = 0)."""
    rx = _rx(pattern)
    unmatched: list[str] = []
    matched = 0
    for x in urls:
        if rx and rx.search(x):
            matched += 1
        else:
            unmatched.append(x)
    return {"matched": matched, "total": len(urls),
            "ratio": matched / len(urls) if urls else 1, "unmatched": unmatched}


# ---- code-built profile rule (2026-10-06) ------------------------------------------------------
RULE_FIX_MIN = 5


def url_parts(s: str) -> dict | None:
    x = u.try_url(s)
    if not x or x.search:
        return None
    return {"url": s, "host": x.host.lower(), "segs": u.path_segs(x)}


def value_form(v: str) -> str:
    if re.match(r"^\d+$", v):
        return "digits"
    if "." in v:
        return "dotted"
    return "word"


def char_class_for(values: list[str], no_dot: bool) -> str:
    lower = upper = digit = other = False
    punct: dict[str, None] = {}
    for v in values:
        for ch in v:
            if "a" <= ch <= "z":
                lower = True
            elif "A" <= ch <= "Z":
                upper = True
            elif "0" <= ch <= "9":
                digit = True
            elif ch in "-_.%+~,":
                punct[ch] = None
            else:
                other = True
    if other:
        return "[^/?#.]" if no_dot else "[^/?#]"
    # Names and usernames: letters seen -> digits allowed too.
    if lower or upper:
        digit = True
    if no_dot:
        punct.pop(".", None)
    parts = [
        "a-z" if lower else "", "A-Z" if upper else "", "0-9" if digit else "",
        *(u.re_esc(c) for c in punct if c != "-"), "\\-" if "-" in punct else "",
    ]
    return f"[{''.join(parts)}]"


def _seg(c: dict, i: int) -> str | None:
    s = c["segs"]
    return s[i] if -len(s) <= i < len(s) else None


def build_profile_rule(
    accepted_url: str,
    pool_urls: list[str],
    extra_forms: set[str] | None = None,
    failed_forms: set[str] | None = None,
) -> dict:
    """The profile URL rule built from the URLs this run saw (fixed positions shared by many,
    variable positions as a character class covering every value seen)."""
    extra_forms = extra_forms or set()
    failed_forms = failed_forms or set()
    empty = {"pattern": None, "candidates": 0, "matched": 0, "thin": True, "fixed": [],
             "forms": {}, "otherForms": []}
    a = url_parts(accepted_url)
    if not a or not a["segs"]:
        return empty
    bare = re.sub(r"^www\.", "", a["host"])
    depth = len(a["segs"])
    seen = {a["url"]}
    cands = [a]
    for x in pool_urls:
        if x in seen:
            continue
        seen.add(x)
        p = url_parts(x)
        if p and re.sub(r"^www\.", "", p["host"]) == bare and len(p["segs"]) == depth:
            cands.append(p)
    thin = len(cands) < RULE_FIX_MIN
    cur = cands
    fixed: list[str | None] = []
    for i in range(depth):
        if i == depth - 1:
            fixed.append(None)
            continue
        lit = _seg(a, i) or ""
        share = len([c for c in cur if _seg(c, i) == lit])
        # Fix (section-like positions, 2026-10-07)
        distinct = len({_seg(c, i) for c in cur})
        section_like = len(cur) >= RULE_FIX_MIN and share >= 2 and distinct / len(cur) < 0.5
        is_fixed = (
            (share >= RULE_FIX_MIN or share == len(cur) or section_like)
            and not (thin and re.search(r"\d", lit))
        )
        if is_fixed:
            fixed.append(lit)
            cur = [c for c in cur if _seg(c, i) == lit]
        else:
            fixed.append(None)
    forms: dict[str, list[str]] = {}
    other_forms: list[dict] = []
    seg_res: list[str] = []
    for i in range(depth):
        lit = fixed[i]
        if lit is not None:
            seg_res.append(u.re_esc(lit))
            continue
        acc_form = value_form(_seg(a, i) or "")
        groups: dict[str, list[str]] = {}
        for c in cur:
            f = value_form(_seg(c, i) or "")
            groups[f] = [*groups.get(f, []), c["url"]]
        included: dict[str, None] = {acc_form: None}
        for f, urls in groups.items():
            if f == acc_form:
                continue
            if f"{i}:{f}" in extra_forms:
                included[f] = None
            elif len(urls) >= 3:
                other_forms.append({"pos": i, "form": f, "urls": urls})
        forms[str(i)] = list(included)
        values = [_seg(c, i) or "" for c in cur if value_form(_seg(c, i) or "") in included]
        if len(included) == 1 and "digits" in included:
            seg_res.append("\\d+")
        elif len(included) == 1 and "dotted" in included:
            cls = char_class_for(values, True)
            seg_res.append(f"{cls}+(?:\\.{cls}+)+")
        else:
            no_digits = (
                "(?!\\d+(?:/|$))"
                if f"{i}:digits" in failed_forms and "digits" not in included else ""
            )
            seg_res.append(f"{no_digits}{char_class_for(values, False)}+")
    hosts = {c["host"] for c in cur}
    host_re = f"(?:www\\.)?{u.re_esc(bare)}" if any(h != a["host"] for h in hosts) \
        else u.re_esc(a["host"])
    pattern = f"^https?://{host_re}/{'/'.join(seg_res)}/?$"
    try:
        rx = u.js_re(pattern)
        matched = len([c for c in cands if rx.search(c["url"])])
    except ValueError:
        return empty
    return {"pattern": pattern, "candidates": len(cands), "matched": matched, "thin": thin,
            "fixed": fixed, "forms": forms, "otherForms": other_forms}


def combine_rules(patterns: list[str]) -> str | None:
    """One rule for several URL forms of the same profile."""
    uniq: list[str] = []
    for p in patterns:
        if p and p not in uniq:
            uniq.append(p)
    if not uniq:
        return None
    if len(uniq) == 1:
        return uniq[0]
    inner = "|".join(re.sub(r"\$$", "", re.sub(r"^\^", "", x)) for x in uniq)
    return f"^(?:{inner})$"


def url_template(url: str) -> str:
    """Host + one symbol per path segment (D = has a dot, N = has a digit, S = other)."""
    x = u.try_url(url)
    if not x:
        return url
    segs = ["D" if "." in s else "N" if re.search(r"\d", s) else "S" for s in u.path_segs(x)]
    return f"{x.host}/{'/'.join(segs)}"


def is_shard_sitemap(url: str) -> bool:
    """A sitemap file that is one numbered shard of a set."""
    x = u.try_url(url)
    if not x:
        return False
    p = x.pathname.lower()
    return bool(re.search(r"\.xml\.\d+$", p) or re.search(r"\d+\.xml(\.gz)?$", p))


def check_detail_pattern(pattern: Any, must_match: list[str], must_not_match: list[str]) -> dict:
    """The pattern must test true on every known detail page and false on every known
    non-detail page (raw and without query/fragment). {ok, problems}."""
    problems: list[str] = []
    if not isinstance(pattern, str) or not pattern:
        return {"ok": False, "problems": ["invalid regex"]}
    try:
        rx = u.js_re(pattern)
    except ValueError:
        return {"ok": False, "problems": ["invalid regex"]}
    for x in must_match:
        if not rx.search(x):
            problems.append(f"does not match detail page {x}")
    for x in must_not_match:
        stripped: str | None = None
        p = u.try_url(x)
        if p:
            u.clear_search(p)
            u.clear_hash(p)
            stripped = p.href
        if rx.search(x) or (stripped is not None and rx.search(stripped)):
            problems.append(f"also matches non-detail page {x}")
    return {"ok": not problems, "problems": problems}


# ---- P0 candidate ranking (2026-10-05) ----------------------------------------------------------
MAP_DETAIL_TRIES = 6
MAP_TEMPLATE_FIRST_PASS = 2
LINK_CANDIDATE_CAP = 300
DIRECTORY_MIN_LINKS = 5
GENERIC_PERSON_TOKENS = ["profile", "profiles", "bio", "bios", "people", "staff", "member",
                         "members"]
GENERIC_PLACE_TOKENS = ["location", "locations", "store", "stores", "office", "offices", "branch",
                        "branches"]
UTILITY_NEGATIVE = [
    "account", "login", "logon", "signin", "signon", "signup", "register", "cart", "checkout",
    "saved", "dashboard", "password", "faq", "calculator",
]
TERM_STOPWORDS = {
    "near", "how", "the", "for", "and", "with", "from", "your", "you", "our", "best", "free",
    "cost", "what", "who", "when", "become", "about", "find", "sale", "open", "top", "new", "get",
    "buy", "sell", "not", "this", "that",
}
GENERIC_HEAD_WORDS = {
    "group", "company", "firm", "agency", "establishment", "room", "joint", "associate",
    "professional", "specialist", "leader", "coordinator",
}


def url_path_tokens(url: str) -> list[str]:
    x = u.try_url(url)
    if not x:
        return []
    return [t for t in re.split(r"[^a-z0-9]+", x.pathname.lower()) if t]


def tok_eq(a: str, t: str) -> bool:
    """URL token matches word: equal, a plural, or (long words) the singular of a plural."""
    return a == t or a == t + "s" or (len(t) > 4 and a + "s" == t)


def head_tokens(terms: list[str]) -> list[str]:
    """Last word of each taxonomy name ("Real Estate Agent" -> "agent")."""
    out: dict[str, None] = {}
    for t in terms:
        tt = text_tokens(re.sub(r"[®™]", "", t))
        last = tt[-1] if tt else None
        if last and len(last) >= 3 and last not in GENERIC_HEAD_WORDS and last not in TERM_STOPWORDS:
            out[last] = None
    return list(out)


def negative_tokens(negatives: list[str], positive: list[str]) -> list[str]:
    """Words from negative_keyword phrases that never appear in the category's own names."""
    pos: dict[str, None] = {}
    for t in positive:
        for w in text_tokens(t):
            pos[w] = None
    out: dict[str, None] = {}
    for n in negatives:
        for w in text_tokens(n):
            if len(w) < 4 or w in TERM_STOPWORDS or any(tok_eq(w, p) for p in pos):
                continue
            out[w] = None
    return list(out)


def make_candidate_scorer(
    heads: list[str],
    generic: list[str],
    negatives: list[str],
    roster_url: str | None,
    profile_hint: str | None = None,
) -> Callable[[str], int]:
    """URL-shape score: +2 head word (else +1 generic word), +2 under the roster path, +2 same
    shape as the hinted profile page, -3 once for a non-profile word."""
    roster_host = ""
    roster_path = ""
    r = u.try_url(roster_url or "")
    if r:
        roster_host = r.host
        roster_path = re.sub(r"/+$", "", r.pathname)
    hint_tpl = hint_shape(profile_hint) if profile_hint else ""
    neg = [*SITEMAP_NEGATIVE, *UTILITY_NEGATIVE, *negatives]

    def score(url: str) -> int:
        toks = url_path_tokens(url)
        s = 0
        if any(any(tok_eq(a, h) for a in toks) for h in heads):
            s += 2
        elif any(any(tok_eq(a, gw) for a in toks) for gw in generic):
            s += 1
        if roster_path:
            x = u.try_url(url)
            if x and x.host == roster_host and x.pathname.startswith(roster_path + "/"):
                s += 2
        if hint_tpl and hint_shape(url) == hint_tpl:
            s += 2
        if any(any(tok_eq(a, w) for w in neg) for a in toks):
            s -= 3
        return s

    return score


def rank_detail_candidates(
    urls: list[str], score: Callable[[str], float], pinned: list[str] | None = None
) -> list[dict]:
    """Order candidates by score (ties keep the incoming order), in three bands; within each
    band the first pass takes at most MAP_TEMPLATE_FIRST_PASS URLs per URL shape. Pinned first."""
    pinned = pinned or []
    seen: set[str] = set()
    scored: list[dict] = []
    i = 0
    for x in [*pinned, *urls]:
        if not x or x in seen:
            continue
        seen.add(x)
        scored.append({"url": x, "score": 100 if x in pinned else score(x), "i": i})
        i += 1
    scored.sort(key=lambda c: (-c["score"], c["i"]))

    def band(c: dict) -> int:
        return 0 if c["score"] > 0 else 1 if c["score"] == 0 else 2

    out: list[dict] = []
    for b in (0, 1, 2):
        in_band = [c for c in scored if band(c) == b]
        first: list[dict] = []
        rest: list[dict] = []
        per_tpl: dict[str, int] = {}
        for c in in_band:
            t = url_template(c["url"])
            n = per_tpl.get(t, 0)
            if n < MAP_TEMPLATE_FIRST_PASS:
                per_tpl[t] = n + 1
                first.append(c)
            else:
                rest.append(c)
        out.extend({"url": c["url"], "score": c["score"]} for c in [*first, *rest])
    return out


def verify_directory_page(r: dict, domain: str, home_url: str) -> dict:
    """A hinted directory is used only when it loads on the same site, is not the homepage, and
    links to enough deeper pages."""
    if not r.get("ok"):
        ne = f" {r['networkError']}" if r.get("networkError") else ""
        return {"ok": False, "reason": f"fetch failed ({r.get('status')}{ne})"}
    if not is_same_site(r["url"], domain):
        return {"ok": False, "reason": f"redirected off site to {r['url']}"}

    def strip(s: str) -> str:
        return re.sub(r"/+$", "", re.sub(r"[?#].*$", "", s))

    if strip(r["url"]) == strip(home_url):
        return {"ok": False, "reason": "redirected to the homepage"}
    n = len(collect_detail_urls(r["body"], r["url"], LINK_CANDIDATE_CAP))
    if n < DIRECTORY_MIN_LINKS:
        return {"ok": False, "reason": f"only {n} deeper links on the page"}
    return {"ok": True, "reason": f"{n} deeper links on the page"}


def page_key(s: str) -> str:
    """URL without query / fragment / trailing slashes, lowercased."""
    return re.sub(r"/+$", "", re.sub(r"[?#].*$", "", s)).lower()
