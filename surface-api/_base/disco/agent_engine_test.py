"""Tests for _base.disco.agent_engine (fake fetch; no network)."""
from __future__ import annotations

import json

import pytest

from _base.disco import agent_engine as E


# ---- JS helpers -----------------------------------------------------------------------------
def test_js_url_normalisation_and_params():
    u = E.JsUrl("HTTPS://WWW.Ex.com:443/a/./b/../c d?x=1#frag")
    assert u.href == "https://www.ex.com/a/c%20d?x=1#frag"
    assert u.origin == "https://www.ex.com" and u.pathname == "/a/c%20d"
    u.hash = ""
    u.set_param("page", "2")
    assert u.href == "https://www.ex.com/a/c%20d?x=1&page=2"
    u.search = ""
    assert u.href == "https://www.ex.com/a/c%20d"
    assert E.JsUrl("/p?q=1", "https://ex.com/a/b").href == "https://ex.com/p?q=1"
    assert E.JsUrl("c", "https://ex.com/a/b").href == "https://ex.com/a/c"
    assert E.JsUrl("//cdn.ex.com/x", "https://ex.com/").href == "https://cdn.ex.com/x"
    assert E.JsUrl("https://ex.com").href == "https://ex.com/"
    assert E.try_url("not a url") is None
    assert E.try_url("mailto:a@b.com").hostname == ""


def test_form_encoding_and_js_str():
    assert E.url_search_params({"a": "x y", "b": 2}) == "a=x+y&b=2"
    assert E.parse_form("?a=1&b=x%20y+z") == [("a", "1"), ("b", "x y z")]
    assert E.js_str(2.0) == "2" and E.js_str(None) == "null" and E.js_str(True) == "true"
    assert E.encode_uri_component("a b/é") == "a%20b%2F%C3%A9"
    with pytest.raises(ValueError):
        E.decode_uri_component("%zz")


def test_js_re_named_groups():
    assert E.js_re(r"(?<id>\d+)").search("ab12").group("id") == "12"


# ---- helpers --------------------------------------------------------------------------------
def test_site_domain_host_clip():
    assert E.site_domain("www.agents.kw.com") == "kw.com"
    assert E.site_domain("foo.co.uk") == "foo.co.uk"
    assert E.host_of("https://Sub.Ex.com/x") == "sub.ex.com"
    assert E.host_of("nope") == ""
    assert E.clip("abcdef", 3) == "abc… [3 more chars]"
    assert E.clip(None, 3) is None


def test_jsonpath_subset():
    data = {"a": {"items": [{"u": "1"}, {"u": "2"}, {"u": "3"}]}, "b": [1, 2, 3, 4]}
    assert E.jsonpath(data, "$.a.items[*].u") == ["1", "2", "3"]
    assert E.jsonpath(data, "a.items[-1].u") == ["3"]
    assert E.jsonpath(data, "$..u") == ["1", "2", "3"]
    assert E.jsonpath(data, "$.b[1:3]") == [2, 3]
    assert E.jsonpath(data, "$['a']['items'][0]") == [{"u": "1"}]
    assert E.jsonpath(data, "$.b.*") == [1, 2, 3, 4]
    with pytest.raises(ValueError, match="Unsupported JSONPath"):
        E.jsonpath(data, "$.a?x")


def test_render_template_and_unresolved():
    vars_ = {"page": 2, "q": "x"}
    assert E.render_template("{page}", vars_) == 2
    assert E.render_template({"u": "https://x/{q}/{page}?z={zz}"}, vars_) == {
        "u": "https://x/x/2?z={zz}"}
    assert E.unresolved(["{a}", {"b": "{c}"}, None]) == ["a", "c"]


def test_extract_html_json_embedded_header():
    html = ('<html><body><a class="card" href="/agent/1">A</a><a class="card" href="/agent/2">B'
            '</a><script id="__NEXT_DATA__" type="application/json">{"p":{"list":[{"slug":"x"},'
            '{"slug":"y"}]}}</script></body></html>')
    assert E.extract({"css": "a.card::attr(href)"}, html, "https://ex.com/dir") == [
        "https://ex.com/agent/1", "https://ex.com/agent/2"]
    assert E.extract({"css": "a.card::text"}, html) == ["A", "B"]
    assert E.extract({"source": "embedded_json", "path": "$.p.list[*].slug",
                      "url_template": "https://ex.com/a/{value}"}, html) == [
        "https://ex.com/a/x", "https://ex.com/a/y"]
    js = json.dumps({"r": [{"id": 5, "n": None}, {"id": 6.0}]})
    assert E.extract({"source": "json", "path": "$.r[*].id"}, js) == ["5", "6"]
    assert E.extract({"source": "json", "path": "$.r[*].id", "regex": r"(\d)"}, js) == ["5", "6"]
    assert E.extract({"source": "header", "name": "X-Total"}, "", None, {"x-total": "9"}) == ["9"]
    with pytest.raises(E.ConfigError):
        E.extract({"xpath": "//a"}, html)


def test_find_lists_url_pattern_summaries():
    data = {"data": {"total": 99, "items": [{"id": i, "url": f"/a/{i}"} for i in range(4)]}}
    lists = E.find_lists(data)
    assert lists[0]["path"] == "$.data.items[*]" and lists[0]["length"] == 4
    assert lists[0]["numeric_siblings"] == {"total": 99}
    assert E.url_pattern("https://ex.com/agents/page-3/123456?b=1&a=2") == (
        "ex.com/agents/page-{n}/{id}?a=&b=")
    s = E.summarize_body("https://ex.com/", "", json.dumps(data))
    assert s["kind"] == "json" and s["lists"]
    x = E.summarize_body("https://ex.com/s.xml", "", "<urlset><loc>https://ex.com/a</loc></urlset>")
    assert x == {"kind": "xml", "loc_count": 1, "first_locs": ["https://ex.com/a"]}
    html = ('<html><title> T </title><body><nav><a href="/agents/1">x</a><a href="/agents/2">y</a>'
            '<a rel="next" href="/agents?page=2">Next</a><a href="https://other.com/">o</a>'
            '</nav></body></html>')
    h = E.summarize_body("https://ex.com/", "text/html", html)
    assert h["kind"] == "html" and h["title"] == "T"
    assert h["link_patterns"][0]["css_hints"] == ["nav > a"]
    assert h["pagination_links"][0]["href"] == "https://ex.com/agents?page=2"


def test_normalize_config_problems():
    _cfg, problems = E.normalize_config({"sources": [
        {"name": "a", "type": "listing"}, {"name": "a", "type": "bogus"},
        {"type": "sitemap", "url_filter": "("}]})
    assert "domain is missing" in problems
    assert "source a (listing): 'listing' is required" in problems
    assert "duplicate source name 'a'" in problems
    assert any("unknown type 'bogus'" in p for p in problems)
    assert any(p.startswith("source #3: url_filter is not a valid regex") for p in problems)
    assert E.normalize_config({"domain": "x"})[1] == ["no sources defined"]


def test_seeds():
    assert E.seed_values({"type": "range", "start": 8, "end": 11, "width": 3}) == [
        "008", "009", "010", "011"]
    assert E.seed_values({"type": "alphabet", "chars": "ab", "depth": 2}) == [
        "aa", "ab", "ba", "bb"]
    assert E.seed_values({"type": "us_states", "format": "slug"})[8] == "district-of-columbia"
    assert E.seed_values({"type": "list", "values": [1, "2"], "pad": 2}) == ["01", "02"]
    with pytest.raises(E.ConfigError):
        E.seed_values({"type": "extract"})
    calls = []

    def extractor(spec, combo):
        calls.append(combo)
        return [f"{combo.get('st', '')}-c1", f"{combo.get('st', '')}-c2"]

    combos = E.seed_combinations({
        "st": {"type": "list", "values": ["tx", "ca"]},
        "city": {"type": "extract", "request": {"url": "https://x/{st}"}},
    }, extractor)
    assert combos == [{"st": "tx", "city": "tx-c1"}, {"st": "tx", "city": "tx-c2"},
                      {"st": "ca", "city": "ca-c1"}, {"st": "ca", "city": "ca-c2"}]
    assert calls == [{"st": "tx"}, {"st": "ca"}]
    kids = E.adaptive_children({"q": {"type": "alphabet", "chars": "ab", "expand_at": 10}},
                               {"q": "a"}, 10)
    assert kids == [{"q": "aa"}, {"q": "ab"}]


# ---- engine with a fake site ----------------------------------------------------------------
def make_fetch(pages: dict[str, str], log: list | None = None):
    def fetch(r: dict) -> dict:
        if log is not None:
            log.append(r)
        text = pages.get(r["url"])
        if text is None:
            return {"url": r["url"], "status": 404, "text": "", "blocked": False,
                    "truncated": False, "ms": 5}
        mb = r.get("maxBytes")
        return {"url": r["url"], "status": 200, "text": text[:mb] if mb else text,
                "blocked": False, "truncated": bool(mb and len(text) > mb), "ms": 5}
    return fetch


def listing_page(ids):
    return json.dumps({"items": [{"url": f"https://ex.com/agent/{i}"} for i in ids], "total": 5})


def test_run_config_listing_paging_and_collector():
    pages = {
        "https://ex.com/api?page=1": listing_page([1, 2]),
        "https://ex.com/api?page=2": listing_page([3, 4]),
        "https://ex.com/api?page=3": listing_page([5]),
    }
    log: list = []
    cfg = {"domain": "ex.com", "profile_url_pattern": r"^https://ex\.com/agent/\d+$",
           "sources": [{"name": "api", "type": "listing",
                        "listing": {"request": {"url": "https://ex.com/api",
                                                "params": {"page": "{page}"}}},
                        "pagination": {"type": "page",
                                       "total_items": {"source": "json", "path": "$.total"}},
                        "items": {"source": "json", "path": "$.items[*].url"}}]}
    col = E.Collector(cfg)
    stats = E.run_config(cfg, col, {"workers": 2}, make_fetch(pages, log))
    s = stats[0].summary()
    assert s["new_unique"] == 5 and s["requests"] == 3
    assert s["stop_reasons"] == {"reached total of N items": 1}
    assert next(iter(col.seen)) == "https://ex.com/agent/1"
    assert log[0]["method"] == "GET" and log[0]["timeoutMs"] == 45_000


def test_run_config_sitemap_index_and_filter():
    pages = {
        "https://www.ex.com/robots.txt": "User-agent: *\nSitemap: https://www.ex.com/sm.xml\n",
        "https://www.ex.com/sm.xml": "<sitemapindex><sitemap><loc>https://www.ex.com/a.xml</loc>"
                                     "</sitemap><sitemap><loc>https://www.ex.com/b.xml</loc>"
                                     "</sitemap></sitemapindex>",
        "https://www.ex.com/a.xml": "<urlset><url><loc>https://www.ex.com/agent/1?x=1&amp;y=2"
                                    "</loc></url><url><loc>https://www.ex.com/blog/x</loc></url>"
                                    "</urlset>",
    }
    cfg = {"domain": "ex.com", "strip_query": True,
           "sources": [{"name": "sm", "type": "sitemap", "include": "a\\.xml",
                        "url_filter": "/agent/"}]}
    col = E.Collector(cfg)
    s = E.run_config(cfg, col, {"workers": 1}, make_fetch(pages))[0].summary()
    assert list(col.seen) == ["https://www.ex.com/agent/1"]
    assert s["stop_reasons"] == {"sitemap index": 1, "url set": 1}


def test_run_config_link_crawl_and_errors():
    pages = {
        "https://ex.com/dir": '<a href="/dir/tx">TX</a><a href="/agent/9">A</a>',
        "https://ex.com/dir/tx": '<a href="/agent/10">B</a><a href="https://x.com/agent/11">C</a>',
    }
    cfg = {"domain": "ex.com", "profile_url_pattern": "/agent/",
           "sources": [{"name": "lc", "type": "link_crawl", "start_urls": ["https://ex.com/dir"],
                        "follow": "/dir/"}]}
    col = E.Collector(cfg)
    s = E.run_config(cfg, col, {"workers": 2}, make_fetch(pages))[0].summary()
    assert set(col.seen) == {"https://ex.com/agent/9", "https://ex.com/agent/10",
                             "https://x.com/agent/11"}
    assert s["rejected_by_profile_pattern"] == 1  # the /dir/tx hub link
    with pytest.raises(E.ConfigError):
        E.run_config({"sources": []}, col, {"workers": 1}, make_fetch({}))


def test_unfilled_placeholder_is_recorded_as_error():
    cfg = {"domain": "ex.com", "sources": [{"name": "l", "type": "listing",
                                            "listing": {"request": {"url": "https://ex.com/{zip}"}},
                                            "pagination": {"type": "page"},
                                            "items": {"css": "a::attr(href)"}}]}
    s = E.run_config(cfg, E.Collector(cfg), {"workers": 1}, make_fetch({}))[0].summary()
    assert "unfilled placeholders" in s["errors"][0]


def test_post_json_and_form_bodies():
    log: list = []
    cfg = {"domain": "ex.com", "sources": [{"name": "l", "type": "listing",
                                            "listing": {"request": {
                                                "method": "post", "url": "https://ex.com/s",
                                                "json": {"page": "{page}", "q": "a"}}},
                                            "pagination": {"type": "none"},
                                            "items": {"source": "json", "path": "$.items[*].url"}}]}
    E.run_config(cfg, E.Collector(cfg), {"workers": 1},
                 make_fetch({"https://ex.com/s": listing_page([1])}, log))
    assert log[0]["method"] == "POST" and log[0]["body"] == '{"page":1,"q":"a"}'
    assert log[0]["headers"]["content-type"] == "application/json"


def test_run_list_unit_listing_resumes():
    pages = {f"https://ex.com/api?p={i}": listing_page([2 * i, 2 * i + 1]) for i in range(1, 9)}
    cfg = {"domain": "ex.com", "sources": [{"name": "l", "type": "listing",
                                            "listing": {"request": {"url": "https://ex.com/api",
                                                                    "params": {"p": "{page}"}}},
                                            "pagination": {"type": "page", "max_pages": 7},
                                            "items": {"source": "json",
                                                      "path": "$.items[*].url"}}]}
    root = E.run_list_unit(cfg, {"s": 0, "k": "root"}, E.Collector(cfg), make_fetch(pages),
                           {"pagesPerUnit": 5, "deadline": E.now_ms() + 60_000})
    assert root["next"] == [{"s": 0, "k": "combo", "c": {}, "p": 1}]
    col = E.Collector(cfg)
    res = E.run_list_unit(cfg, root["next"][0], col, make_fetch(pages),
                          {"pagesPerUnit": 5, "deadline": E.now_ms() + 60_000})
    assert res["reason"] == "max pages (5) reached" and len(col.seen) == 10
    assert res["next"] == [{"s": 0, "k": "combo", "c": {}, "p": 6}]
    res2 = E.run_list_unit(cfg, res["next"][0], E.Collector(cfg), make_fetch(pages),
                           {"pagesPerUnit": 5, "deadline": E.now_ms() + 60_000})
    assert res2["next"] == []  # 5 + 5 pages >= max_pages 7
    with pytest.raises(E.ConfigError, match="source #3"):
        E.run_list_unit(cfg, {"s": 3, "k": "root"}, col, make_fetch(pages),
                        {"pagesPerUnit": 5, "deadline": E.now_ms() + 1000})


def test_run_list_unit_autocomplete_and_sitemap():
    cfg = {"domain": "ex.com", "sources": [
        {"name": "ac", "type": "autocomplete", "chars": "ab", "expand_threshold": 2,
         "request": {"url": "https://ex.com/ac?q={prefix}"},
         "items": {"source": "json", "path": "$.items[*].url"}},
        {"name": "sm", "type": "sitemap"}]}
    root = E.run_list_unit(cfg, {"s": 0, "k": "root"}, E.Collector(cfg), make_fetch({}),
                           {"pagesPerUnit": 5, "deadline": E.now_ms() + 1000})
    assert [u["x"] for u in root["next"]] == ["a", "b"]
    res = E.run_list_unit(cfg, {"s": 0, "k": "prefix", "x": "a"}, E.Collector(cfg),
                          make_fetch({"https://ex.com/ac?q=a": listing_page([1, 2])}),
                          {"pagesPerUnit": 5, "deadline": E.now_ms() + 1000})
    assert res["reason"] == "2 values" and [u["x"] for u in res["next"]] == ["aa", "ab"]
    sm = E.run_list_unit(cfg, {"s": -1, "k": "root"}, E.Collector(cfg), make_fetch({}),
                         {"pagesPerUnit": 5, "deadline": E.now_ms() + 1000})
    assert sm["reason"] == "sitemap sources are seeded as sitemap queue rows"


def test_pool_time_limit():
    cfg = {"domain": "ex.com", "sources": [{"name": "lc", "type": "link_crawl",
                                            "start_urls": ["https://ex.com/a", "https://ex.com/b"]}]}
    s = E.run_config(cfg, E.Collector(cfg), {"workers": 1, "deadline": E.now_ms() - 1},
                     make_fetch({}))[0].summary()
    assert s["stop_reasons"] == {"time limit": 1} and s["requests"] == 0
