"""Deterministic parts of the disco AI worker port (no network, no DB)."""
from __future__ import annotations

import json
import time

import pytest

from surfaces.etl.disco import ai_worker_discover as dc
from surfaces.etl.disco import ai_worker_links as lk
from surfaces.etl.disco import ai_worker_routes as rt
from surfaces.etl.disco import ai_worker_util as u
from surfaces.etl.disco import ai_worker_v2 as v2m


# ---- util -------------------------------------------------------------------------------------
def test_no_nul_and_json():
    assert u.no_nul({"a\u0000": ["x\u0000y", 1, {"k": "\u0000"}]}) == {"a": ["xy", 1, {"k": ""}]}
    assert u.js_json({"a": 1.0, "b": [2.5, None], "c": {"z"}}) == '{"a":1,"b":[2.5,null],"c":["z"]}'


def test_regexp_source_and_re_esc():
    assert u.regexp_source("^https?://a\\.com/[^/?#]+/?$") == "^https?:\\/\\/a\\.com\\/[^/?#]+\\/?$"
    assert u.re_esc("a.b/{n}") == "a\\.b/\\{n\\}"
    assert u.js_re("(?<id>\\d+)").search("x12").group("id") == "12"
    with pytest.raises(ValueError):
        u.js_re("(")


def test_url_helpers():
    x = u.url_of("https://Ex.com/list?page=2&q=a%20b#top")
    u.set_search_param(x, "page", "__N__")
    assert x.href == "https://ex.com/list?page=__N__&q=a+b#top"
    u.clear_hash(x)
    u.clear_search(x)
    assert x.href == "https://ex.com/list"
    assert u.decode_uri("https://ex.com/a/%7Bn%7D/%2F") == "https://ex.com/a/{n}/%2F"
    assert u.search_params_string({"a": "x y", "b": "é"}) == "a=x+y&b=%C3%A9"
    assert u.absolutize("../p", "https://ex.com/a/b/") == "https://ex.com/a/p"
    assert u.absolutize("http://[bad", "https://ex.com/") is None


def test_with_timeout_parallel_start():
    assert u.with_timeout(lambda: 1, 1000, 0) == 1
    assert u.with_timeout(lambda: time.sleep(0.5) or 1, 50, "fb") == "fb"
    with pytest.raises(RuntimeError):
        u.with_timeout(lambda: (_ for _ in ()).throw(RuntimeError("x")), 1000, None)
    assert u.parallel([lambda: 1, lambda: 2]) == [1, 2]
    w = u.start(lambda: 3)
    assert w() == 3


def test_call_opts_dict_or_kwargs():
    def takes_dict(api_key, opts=None, **kw):
        return ("dict", opts)

    def takes_kw(api_key, *, domain, call_ms=1):
        return ("kw", domain, call_ms)

    assert u.call_opts(takes_dict, "k", opts={"domain": "a"}) == ("dict", {"domain": "a"})
    assert u.call_opts(takes_kw, "k", opts={"domain": "a", "callMs": 5, "state": None}) == (
        "kw", "a", 5)


def test_err_string_and_map_site_error():
    e = u.MapSiteError("boom", {"x": 1})
    assert u.err_string(e) == "MapSiteError: boom"
    assert u.err_string(RuntimeError("no")) == "Error: no"
    assert u.diagnostics_of(e) == {"x": 1}


def test_call_claude(monkeypatch):
    sent = {}

    class Resp:
        is_success = True
        status_code = 200
        text = ""

        def json(self):
            return {"model": "claude-sonnet-4-6", "usage": {"input_tokens": 3},
                    "content": [{"type": "text"}, {"type": "tool_use", "input": {"found": True}}]}

    def post(url, headers, content, timeout):
        sent.update(url=url, headers=headers, body=json.loads(content))
        return Resp()

    monkeypatch.setattr(u.httpx, "post", post)
    out = u.call_claude("key", "m", "hello", {"name": "t", "input_schema": {}}, 256)
    assert out == {"found": True}
    assert sent["url"] == "https://api.anthropic.com/v1/messages"
    assert sent["headers"]["x-api-key"] == "key"
    assert sent["headers"]["anthropic-version"] == "2023-06-01"
    assert sent["body"] == {"model": "m", "max_tokens": 256,
                            "tools": [{"name": "t", "input_schema": {}}],
                            "tool_choice": {"type": "tool", "name": "t"},
                            "messages": [{"role": "user", "content": "hello"}]}

    class Bad(Resp):
        is_success = False
        status_code = 529
        text = "overloaded"

    monkeypatch.setattr(u.httpx, "post", lambda *a, **k: Bad())
    with pytest.raises(RuntimeError, match="anthropic 529: overloaded"):
        u.call_claude("key", "m", "p", {"name": "t"})


# ---- §1 discovery -------------------------------------------------------------------------------
def test_normalize_domain_and_same_site():
    assert dc.normalize_domain(" HTTPS://www.Example.com/agents?x ") == "example.com"
    assert dc.is_source_domain("example.com") and not dc.is_source_domain("example")
    assert dc.same_site_url("https://agents.example.com/find", "example.com") == \
        "https://agents.example.com/find"
    assert dc.same_site_url("https://other.com/x", "example.com") is None
    assert dc.same_site_url("ftp://example.com/x", "example.com") is None


def _src(**kw):
    base = {"name": "Acme Realty", "domain": "acme.com", "group": "brand_site",
            "source_type": "brand_site", "authority_rank": 1, "profiles_hosted_estimate": 500,
            "evidence": "large"}
    return {**base, **kw}


def test_validate_discovered_sources():
    raw = [
        _src(authority_rank=2),
        _src(name="Beta", domain="https://www.beta.com/", authority_rank=1,
             directory_url="https://beta.com/agents", profile_url_example="https://x.com/p"),
        _src(name="Dir", domain="dir.com", group="directory", source_type="directory"),
        *[_src(name=f"Reg{i}", domain=f"reg{i}.gov", group="directory",
               source_type="license_registry", authority_rank=i) for i in range(1, 5)],
        _src(name="Bad (excluded, x.com already listed)", domain="bad.com"),
        _src(name="Zero", domain="zero.com", profiles_hosted_estimate=0),
        _src(name="Wrong", domain="wrong.com", group="directory", source_type="brand_site"),
        _src(name="Seen", domain="seen.com"),
        _src(name="Dup", domain="acme.com"),
    ]
    out = dc.validate_discovered_sources(raw, {"seen.com"})
    assert out["rejected"] == 3
    doms = [s["domain"] for s in out["sources"]]
    assert doms == ["beta.com", "acme.com", "dir.com", "reg1.gov", "reg2.gov", "reg3.gov"]
    assert [s["authority_rank"] for s in out["sources"]] == [1, 2, 3, 4, 5, 6]
    beta = out["sources"][0]
    assert beta["directory_url"] == "https://beta.com/agents"
    assert "profile_url_example" not in beta


def test_build_discover_prompt():
    ctx = {"category": "gcid:real_estate_agent", "displayName": "Real estate agent",
           "unit": "person", "complexity": "high",
           "boundary": {"definition": "Licensed agents", "includes": ["buyers agents"],
                        "excludes": [{"type": "Brokerage", "goes_to": "gcid:real_estate_agency"}],
                        "subtypes": [{"name": "Buyer", "criteria": "works with buyers"}]},
           "excludeDomains": ["a.com", "b.com"], "terms": ["Realtor"], "negatives": ["jobs"]}
    p = dc.build_discover_prompt(ctx)
    assert p.startswith("You are finding data sources for a professional-profile graph.\n\n"
                        'CATEGORY: "Real estate agent" [gcid:real_estate_agent] (high complexity)')
    assert "  • Brokerage → gcid:real_estate_agency  (can be a source)" in p
    assert "PROFILE SUB-TYPES: Buyer (works with buyers)" in p
    assert "ALSO CALLED: Realtor" in p
    assert "ALREADY FOUND — do NOT repeat these domains; return only sites not in this list:\n" \
           "a.com, b.com" in p
    assert p.endswith("Use the return_top_sources tool.")


def test_discover_sources_retries_once(monkeypatch):
    answers = [{"sources": []}, {"sources": [_src()]}]
    monkeypatch.setattr(u, "call_claude", lambda *a, **k: answers.pop(0))
    ctx = {"category": "c", "displayName": "C", "unit": "place", "excludeDomains": []}
    assert [s["domain"] for s in dc.discover_sources("k", "m", ctx)] == ["acme.com"]
    monkeypatch.setattr(u, "call_claude", lambda *a, **k: {"sources": []})
    with pytest.raises(RuntimeError, match="no valid sources"):
        dc.discover_sources("k", "m", ctx)


# ---- links / page helpers -----------------------------------------------------------------------
HOME = """
<a href="/careers">Careers</a>
<a href="/find-an-agent">Find an Agent</a>
<a href="https://agents.ex.com/directory"><svg>x</svg>Our team</a>
<a href="https://other.com/agents">Agents elsewhere</a>
<a href="/about">About</a>
"""


def test_rank_roster_links():
    ranked = lk.rank_roster_links(HOME, "https://www.ex.com/", ["real estate agent"])
    # equal scores keep document order
    assert [(r["href"], r["score"]) for r in ranked[:2]] == [
        ("https://www.ex.com/find-an-agent", 1), ("https://agents.ex.com/directory", 1)]
    assert [r["href"] for r in ranked][-1] == "https://www.ex.com/careers"
    assert all("other.com" not in r["href"] for r in ranked)
    assert lk.find_roster_link(HOME, "https://www.ex.com/") == "https://www.ex.com/find-an-agent"
    links = lk.extract_all_links(HOME, "https://www.ex.com/")
    assert [x["text"] for x in links] == ["Careers", "Find an Agent", "x Our team", "About"]


def test_collect_detail_urls_deepest_first():
    html = ('<a href="/a/b">1</a><a href="/a/b/c">2</a><a href="/x">3</a>'
            '<a href="/a/b/c">dup</a><a href="/p/q.pdf">pdf</a><a href="https://o.com/a/b">o</a>')
    assert lk.collect_detail_urls(html, "https://ex.com/") == [
        "https://ex.com/a/b/c", "https://ex.com/a/b"]


def test_page_template_and_page_links():
    assert lk.page_template("https://ex.com/agents?page=2&sort=a", "https://ex.com/agents") == \
        "https://ex.com/agents?page={n}&sort=a"
    assert lk.page_template("https://ex.com/agents/page/3/", "https://ex.com/agents") == \
        "https://ex.com/agents/page/{n}/"
    assert lk.page_template("https://ex.com/agents?page=1", "https://ex.com/agents") is None
    assert lk.page_template("https://o.com/agents?page=2", "https://ex.com/agents") is None
    html = ('<link rel="next" href="/agents?page=2"><a href="/agents/jane-doe#x">Jane</a>'
            '<a class="pagination-next" href="/agents?page=2&amp;s=1">&raquo;</a>'
            '<a href="mailto:x@y.com">mail</a>')
    links = lk.collect_page_links(html, "https://ex.com/agents")
    assert [x["href"] for x in links] == ["https://ex.com/agents?page=2",
                                          "https://ex.com/agents/jane-doe",
                                          "https://ex.com/agents?page=2&s=1"]
    assert links[2]["label"] == "»" and "pagination-next" in links[2]["cls"]
    rx = u.js_re(r"/agents/[a-z-]+$")
    assert lk.detail_link_set(links, rx) == ["https://ex.com/agents/jane-doe"]


def test_sitemap_helpers():
    xml = "<urlset><loc> https://ex.com/a </loc><loc>https://ex.com/a</loc><loc>https://ex.com/b</loc>"
    assert lk.extract_locs(xml, 5) == ["https://ex.com/a", "https://ex.com/b"]
    assert lk.is_sitemap_index("<sitemapindex xmlns='x'>")
    assert lk.sitemap_relevance("https://ex.com/sitemaps/real-estate-agents.xml",
                                ["real estate agent"]) == 2
    assert lk.sitemap_relevance("https://ex.com/sitemap-blog.xml", ["agent"]) == -3
    assert lk.host_relevance("https://advisors.ex.com/x", "ex.com", ["financial advisor"]) == 1
    assert lk.host_relevance("https://news.ex.com/x", "ex.com", ["advisor"]) == -3
    assert lk.host_relevance("https://www.ex.com/x", "ex.com", ["advisor"]) == 0
    assert lk.extract_robots_sitemaps("User-agent: *\nSitemap: https://ex.com/s.xml\r\n"
                                      "sitemap:https://ex.com/s.xml") == ["https://ex.com/s.xml"]
    assert lk.is_shard_sitemap("https://ex.com/sitemap-3.xml")
    assert lk.is_shard_sitemap("https://ex.com/sitemap.xml.0")
    assert not lk.is_shard_sitemap("https://ex.com/sitemap.xml")


def test_build_profile_rule_code_built():
    pool = [f"https://www.ex.com/agent/name-{c}{c}" for c in "abcdefg"] + [
        "https://www.ex.com/agent/12345", "https://www.ex.com/agent/23456",
        "https://www.ex.com/agent/34567", "https://www.ex.com/office/main",
    ]
    rule = lk.build_profile_rule("https://www.ex.com/agent/jane-doe", pool)
    assert rule["pattern"] == "^https?://www\\.ex\\.com/agent/[a-z0-9\\-]+/?$"
    assert rule["fixed"] == ["agent", None]
    assert rule["otherForms"] == [{"pos": 1, "form": "digits", "urls": pool[7:10]}]
    assert not rule["thin"]
    with_digits = lk.build_profile_rule("https://www.ex.com/agent/jane-doe", pool,
                                        extra_forms={"1:digits"})
    assert with_digits["forms"]["1"] == ["word", "digits"]
    failed = lk.build_profile_rule("https://www.ex.com/agent/jane-doe", pool,
                                   failed_forms={"1:digits"})
    assert failed["pattern"].startswith("^https?://www\\.ex\\.com/agent/(?!\\d+(?:/|$))")


def test_check_detail_pattern_and_combine():
    ok = lk.check_detail_pattern(r"^https://ex\.com/agent/[a-z-]+$",
                                 ["https://ex.com/agent/jane"], ["https://ex.com/agent/search?x=1"])
    assert ok == {"ok": False,
                  "problems": ["also matches non-detail page https://ex.com/agent/search?x=1"]}
    assert lk.check_detail_pattern("(", [], [])["problems"] == ["invalid regex"]
    assert lk.combine_rules(["^a$", "^b$", "^a$"]) == "^(?:a|b)$"
    assert lk.combine_rules(["", "^a$"]) == "^a$"
    assert lk.pattern_coverage("^x", ["x1", "y"])["ratio"] == 0.5


def test_candidate_scoring_and_ranking():
    score = lk.make_candidate_scorer(heads=["agent"], generic=lk.GENERIC_PERSON_TOKENS,
                                     negatives=["jobs"], roster_url="https://ex.com/agents/")
    assert score("https://ex.com/agents/jane") == 4
    assert score("https://ex.com/people/x") == 1
    assert score("https://ex.com/agents/login") == 1
    assert score("https://ex.com/blog/post") == -3
    ranked = lk.rank_detail_candidates(
        ["https://ex.com/agents/a", "https://ex.com/agents/b", "https://ex.com/agents/c",
         "https://ex.com/agents/1/x", "https://ex.com/blog/z"],
        score, pinned=["https://ex.com/p"])
    assert [r["url"] for r in ranked] == [
        "https://ex.com/p", "https://ex.com/agents/a", "https://ex.com/agents/b",
        "https://ex.com/agents/1/x", "https://ex.com/agents/c", "https://ex.com/blog/z"]
    assert lk.head_tokens(["Real Estate Agent", "Agency", "Top", "Tax Preparer"]) == [
        "agent", "preparer"]
    assert lk.negative_tokens(["real estate jobs", "mortgage lender"], ["real estate agent"]) == [
        "jobs", "mortgage", "lender"]


def test_page_shape_checks():
    assert lk.has_entity_data('<script type="application/ld+json">{}</script>')
    assert lk.is_js_shell('<div id="root"></div>')
    assert lk.is_empty_shell("<p>short</p>") and not lk.is_empty_shell("<p>" + "x" * 600 + "</p>")
    assert lk.normalize_page_ref("https://WWW.Ex.com/a/?q#h") == "ex.com/a"


def test_detect_page_entity_kind():
    def page(obj):
        return f'<script type="application/ld+json">{json.dumps(obj)}</script>'

    assert lk.detect_page_entity_kind(page({"@type": "ProfilePage"}), set()) == "professional"
    assert lk.detect_page_entity_kind(page({"@type": "WebPage", "mainEntity": {
        "@type": "LocalBusiness", "name": "Jane"}}), set()) == "location"
    mixed = {"@graph": [{"@type": "Person", "name": "Jane", "url": "https://ex.com/jane"},
                        {"@type": "Organization", "name": "Acme"}]}
    assert lk.detect_page_entity_kind(page(mixed), set(), "https://ex.com/jane/") == "professional"
    assert lk.detect_page_entity_kind(page(mixed), set()) is None
    assert lk.detect_page_entity_kind(page(mixed), {"acme"}) == "professional"


def test_verify_directory_page():
    links = "".join(f'<a href="/agents/a{i}">x</a>' for i in range(6))
    r = {"ok": True, "status": 200, "body": links, "url": "https://ex.com/agents"}
    assert lk.verify_directory_page(r, "ex.com", "https://ex.com/") == {
        "ok": True, "reason": "6 deeper links on the page"}
    assert lk.verify_directory_page({**r, "url": "https://ex.com/"}, "ex.com",
                                    "https://ex.com")["reason"] == "redirected to the homepage"


# ---- navigation ---------------------------------------------------------------------------------
def test_learn_navigation(monkeypatch):
    page1 = "".join(f'<a href="/agents/p{i}">p</a>' for i in range(4)) + (
        '<a href="/agents?page=2">2</a><a href="/agents?page=9">9</a>')
    page2 = "".join(f'<a href="/agents/q{i}">q</a>' for i in range(5))
    monkeypatch.setattr(u, "fetch_page", lambda url, m="server_crawl": {
        "ok": True, "status": 200, "body": page2, "url": url})
    nav = rt.learn_navigation({"ok": True, "body": page1, "url": "https://ex.com/agents"},
                              "https://ex.com/", u.js_re(r"/agents/[a-z0-9]+$"), None,
                              "server_crawl")
    assert nav["page1_detail_links"] == 4
    assert nav["next_page"] == {"how": "url_number", "example_url": "https://ex.com/agents?page=2",
                                "template": "https://ex.com/agents?page={n}", "max_page_seen": 9,
                                "new_detail_links": 5, "verified": True}
    assert len(nav["profile_links"]) == 5


# ---- version 2 / detail route ---------------------------------------------------------------------
V2 = {
    "outcome": "config", "reason": None, "profile_urls": ["https://ex.com/agent/a",
                                                          "https://ex.com/agent/b"],
    "sample_pool": 2, "cost_usd": 1.5, "active_seconds": 60, "coverage": {"x": 1},
    "coverage_justification": "ok", "flags": None, "error": None, "log": ["l"] * 20,
    "config": {"profile_url_pattern": r"^https://ex\.com/agent/[a-z]+$", "summary": "s",
               "start_url": "https://ex.com/", "estimate": {"expected_profiles": 1200,
                                                           "basis": "sitemaps"},
               "sources": [{"type": "sitemap", "name": "sm",
                            "sitemaps": ["https://ex.com/sm.xml", "not-a-url"]}]},
}


def test_apply_v2_and_summary():
    contract = {"detail_pattern": "^nomatch$", "profile_sitemaps": ["https://ex.com/old.xml"],
                "extraction": {"best_route": {"route": "none", "reach_estimate": 0}}}
    v2m.apply_v2(contract, V2)
    assert contract["detail_pattern"] == V2["config"]["profile_url_pattern"]
    assert contract["profile_sitemaps"] == ["https://ex.com/sm.xml", "https://ex.com/old.xml"]
    br = contract["extraction"]["best_route"]
    assert br == {"route": "sitemap", "reach_estimate": 1200,
                  "basis": "version 2 list route: sitemaps", "from": "v2"}
    lr = contract["extraction"]["site_contract"]["list_route"]
    assert lr["detail_pattern_from"] == "v2" and lr["harvestable"] is True
    s = v2m.v2_summary(V2)
    assert s["profile_urls_given"] == 2 and len(s["log"]) == 15
    assert s["sources"] == [{"name": "sm", "type": "sitemap"}]


def _detail(must_have=1.0, fields=None, median=8):
    fields = fields or {f"person.f{i}": f"$.f{i}" for i in range(6)}
    return {"probe": {"status": "proven", "reason": "ok", "api": {"url_template": "u"},
                      "proven_on": [], "checked": [], "captures": 1, "ms": 5},
            "json": {"fields": fields, "median": median, "per_item": [median],
                     "must_have_share": must_have, "items": 3, "fill": {}, "dropped": [],
                     "sample": {"a": 1}}}


def test_attach_detail_route_sources():
    c = {"site_contract_summary": {"field_floor_per_sample": [5, 9, 7]},
         "extraction": {"site_contract": {"fields": {}}}}
    v2m.attach_detail_route(c, _detail())
    dr = c["extraction"]["site_contract"]["detail_route"]
    assert dr["record_source"] == "api"
    assert dr["reason"] == "profile API median 8 fields, page median 7"
    assert dr["json_sample"] == {"a": 1}
    c["extraction"]["site_contract"]["fields"] = {"location.phone": {"hits": 3, "locator": {}}}
    v2m.attach_detail_route(c, _detail())
    assert c["extraction"]["site_contract"]["detail_route"]["record_source"] == "api+page"
    v2m.attach_detail_route(c, _detail(must_have=0.5))
    assert "on 50% of 3 profiles (under 80%)" in \
        c["extraction"]["site_contract"]["detail_route"]["reason"]
    v2m.attach_detail_route(c, {"probe": {"status": "none_found", "reason": "no call"}})
    assert c["extraction"]["site_contract"]["detail_route"]["reason"] == "no profile API: no call"


def test_api_built_contract():
    built = v2m.api_built_contract("c", V2, _detail(), RuntimeError("page has only a name"))
    assert built["detail_pattern"] == V2["config"]["profile_url_pattern"]
    assert built["detail_entity_type"] == "professional"
    assert built["route_report"]["fields_only"]["page_error"] == "page has only a name"
    assert v2m.api_built_contract("c", V2, _detail(median=4), RuntimeError()) is None


def test_map_site_with_limit_stops(monkeypatch):
    def slow(*a, **k):
        a[7]["progress"]["step"] = "sitemaps"
        time.sleep(0.5)
        return {}

    monkeypatch.setattr(v2m.mp, "map_site", slow)
    with pytest.raises(u.MapSiteError) as ei:
        v2m.map_site_with_limit("k", "m", "c", "ex.com", None, "server_crawl", {"limitMs": 50})
    assert str(ei.value) == ("run stopped at 0.05 s, before the worker limit (last step: "
                             "sitemaps)")
    assert ei.value.diagnostics == {"stopped": True, "progress": {"step": "sitemaps"}}


def test_map_with_v2_runs_research_then_v1(monkeypatch):
    calls = {}

    class Mapper:
        @staticmethod
        def run_v2_research(api_key, opts=None, **kw):
            calls["v2"] = opts
            return json.loads(json.dumps(V2))

    monkeypatch.setattr(u, "mapper", lambda: Mapper)
    monkeypatch.setattr(v2m, "resolve_sitemap_includes", lambda v2: None)

    def fake_map(api_key, model, category, domain, boundary, cm, opts):
        calls["v1"] = opts
        return {"detail_pattern": V2["config"]["profile_url_pattern"], "extraction": {}}

    monkeypatch.setattr(v2m, "map_site_with_limit", fake_map)
    out = v2m.map_with_v2("k", "m", "c", "ex.com", None, "server_crawl")
    assert calls["v2"] == {"domain": "ex.com", "category": "c", "start_url": None, "budget": 3,
                           "callMs": 480_000}
    assert calls["v1"]["profileUrls"] == V2["profile_urls"]
    assert calls["v1"]["v2Led"] == {"pattern": V2["config"]["profile_url_pattern"]}
    assert out["contract"]["v2_research"]["outcome"] == "config"
    assert out["contract"]["extraction"]["site_contract"]["list_route"]["version"] == 2


class FakeDb:
    def __init__(self, row=None):
        self.row = row
        self.sql = []

    def row_or_none(self, sql, params=()):
        self.sql.append((sql, params))
        return self.row


def test_saved_contract_check(monkeypatch):
    fresh = {"field_floor": 8, "extraction": {"site_contract": {"must_have": {"ok": True}},
                                              "best_route": {"reach_estimate": 100}}}
    assert v2m.saved_contract_check(FakeDb(None), "Ex.com", "c", fresh, "server_crawl")[
        "reason"] == "no saved contract"
    saved = {"detail_pattern": r"/agent/", "field_floor": 10, "extraction": {
        "site_contract": {"samples": ["https://ex.com/agent/a", "https://ex.com/agent/b"],
                          "must_have": {"ok": True}}, "best_route": {"reach_estimate": 50}}}

    class SC:
        @staticmethod
        def apply_site_contract(*a):
            return {"values": {"name": "x"}}

        @staticmethod
        def record_must_have(values, primary, owner):
            return {"ok": True, "missing": []}

    monkeypatch.setattr(u, "sc", lambda: SC)
    monkeypatch.setattr(u, "fetch_page", lambda url, m: {"ok": True, "status": 200,
                                                        "body": "<p>x</p>", "url": url})
    db = FakeDb(saved)
    res = v2m.saved_contract_check(db, "Ex.com", "c", fresh, "server_crawl")
    assert db.sql[0][1] == ("ex.com", "c")
    assert res["save"] is False
    assert res["reason"] == ("saved contract still works and the new one is worse: "
                             "field floor 8 < 10")
    monkeypatch.setattr(u, "fetch_page", lambda url, m: {"ok": False, "status": 404, "body": "",
                                                        "url": url})
    res = v2m.saved_contract_check(FakeDb(saved), "ex.com", "c", fresh, "server_crawl")
    assert res["save"] is True and res["reason"].startswith("saved contract no longer works (2 of")


def test_merge_saved_list_route():
    saved = {"profile_sitemaps": ["https://ex.com/a.xml"], "extraction": {
        "site_contract": {"list_route": {"sources": [{"type": "listing"}],
                                         "estimate": {"expected_profiles": 38000},
                                         "learned_at": "t"}},
        "best_route": {"route": "listing", "reach_estimate": 38000, "basis": "api"}}}
    contract = {"profile_sitemaps": ["https://ex.com/b.xml"], "extraction": {
        "site_contract": {"list_route": {"sources": [{"type": "sitemap", "sitemaps": ["x"]}],
                                         "estimate": {"expected_profiles": 14000}}},
        "best_route": {"reach_estimate": 14000}}}
    v2m.merge_saved_list_route(FakeDb(saved), "ex.com", "c", contract)
    lr = contract["extraction"]["site_contract"]["list_route"]
    assert len(lr["sources"]) == 2 and lr["estimate"] == {"expected_profiles": 38000}
    assert lr["combined_with_saved"] == {"sources_added": 1, "saved_learned_at": "t"}
    assert contract["profile_sitemaps"] == ["https://ex.com/b.xml", "https://ex.com/a.xml"]
    assert contract["extraction"]["best_route"]["reach_estimate"] == 38000
