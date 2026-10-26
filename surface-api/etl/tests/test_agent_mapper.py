"""Tests for surfaces.etl.disco.agent_mapper (fake fetch, fake model; no network)."""
from __future__ import annotations

import re

import pytest

from surfaces.etl.disco import agent_mapper as am


def page(n: int) -> str:
    if n > 3:
        return "<html><body>no results</body></html>"
    links = "".join(f'<a class="agent" href="/agent/jane-{n}-{i}">J</a>' for i in range(5))
    return f"<html><body>{links}</body></html>"


@pytest.fixture
def site(monkeypatch):
    calls: list[dict] = []

    def fetch(r):
        calls.append(r)
        url = r["url"]
        m = re.search(r"[?&]page=(\d+)", url)
        if m:
            return {"url": url, "status": 200, "text": page(int(m.group(1))), "blocked": False,
                    "truncated": False, "ms": 5}
        if url.endswith("/robots.txt"):
            return {"url": url, "status": 200, "text": "Sitemap: https://www.ex.com/sm.xml\n"
                    "Disallow: /admin", "blocked": False, "truncated": False, "ms": 1}
        if url.endswith("/sm.xml"):
            locs = "".join(f"<url><loc>https://www.ex.com/agent/a-{i}</loc></url>"
                           for i in range(3))
            return {"url": url, "status": 200, "text": f"<urlset>{locs}</urlset>",
                    "blocked": False, "truncated": False, "ms": 1}
        if "/agent/" in url:
            return {"url": url, "status": 200, "text": "<html><title>Jane</title></html>",
                    "blocked": False, "truncated": False, "ms": 1}
        return {"url": url, "status": 404, "text": "", "blocked": False, "truncated": False,
                "ms": 1}

    monkeypatch.setattr(am, "oxy_fetch", fetch)
    return calls


def state(**kw):
    return am.new_state({"domain": "https://www.ex.com/x", "category": "gcid:real_estate_agent",
                         "no_browser": True, **kw})


LISTING = {"type": "listing",
           "listing": {"request": {"url": "https://www.ex.com/agents?page={page}"}},
           "pagination": {"type": "page", "start": 1, "max_pages": 10},
           "items": {"source": "html", "css": "a.agent::attr(href)"}}
SETTINGS = {"profile_url_pattern": r"^https://www\.ex\.com/agent/[^/]+$"}


def test_new_state_clamps_and_defaults():
    st = am.new_state({"domain": "HTTPS://WWW.EX.COM/path", "budget": 99, "minutes": 0,
                       "max_fetches": "abc", "category": "gcid:financial_advisor"})
    assert st["domain"] == "www.ex.com" and st["start_url"] == "https://www.ex.com/"
    assert st["budget"] == 5 and st["minutes"] == 8 and st["max_fetches"] == 40
    assert st["category_label"] == "financial advisor" and st["effort"] == "high"
    assert st["model"] == am.DEFAULT_MODEL and st["use_browser"] is True
    assert am.new_state({"domain": "x.com", "effort": None})["effort"] is None
    assert am.new_state({"domain": "x.com", "minutes": 1})["minutes"] == 2


def test_spread_profile_urls_round_robin():
    urls = [f"https://x.com/tx/austin/a{i}/p" for i in range(6)] + [
        f"https://x.com/ca/la/b{i}/p" for i in range(2)]
    out = am.spread_profile_urls(urls + ["bad url"], 4)
    assert out == ["https://x.com/tx/austin/a0/p", "https://x.com/ca/la/b0/p",
                   "https://x.com/tx/austin/a3/p", "https://x.com/ca/la/b1/p"]


def test_on_site_and_other_domains():
    ex = am.Explorer(state())
    assert ex.site() == "ex.com" and ex.on_site("https://api.ex.com/x")
    assert not ex.on_site("https://ex.com.evil.io/")
    msg = ex.site_fetch({"method": "GET", "url": "https://vendor.io/api", "timeoutMs": 1})["error"]
    assert "outside ex.com" in msg
    ex.note_other("https://exadvisors.com/a", "sister")
    flags = ex.other_domain_flags()["other_domains"]
    assert [f["host"] for f in flags] == ["vendor.io", "exadvisors.com"]
    assert all(f["kind"] == "third_party" for f in flags)  # 'ex' shares < 5 letters
    ex2 = am.Explorer(am.new_state({"domain": "ameriprise.com", "no_browser": True}))
    ex2.note_other("ameripriseadvisors.com", "why")
    assert ex2.st["other_domains"]["ameripriseadvisors.com"]["kind"] == "sister_domain"


def test_test_source_proves_and_remembers(site):
    ex = am.Explorer(state())
    out = ex.t_test_source({"source": LISTING, "settings": SETTINGS})
    assert out["new_unique"] == 10 and out["requests"] == 2  # 2 pages sample
    assert out["stop_reasons"] == {"max pages (N) reached": 1}
    assert len(ex.st["proven"]) == 1


def test_sitemap_probe(site):
    ex = am.Explorer(state())
    out = ex.t_sitemap_probe({})
    assert out["robots_sitemaps"] == ["https://www.ex.com/sm.xml"]
    assert out["robots_disallow_sample"] == ["/admin"]
    assert out["sitemaps"][0]["type"] == "url set" and out["sitemaps"][0]["locs_in_sample"] == 3
    assert ex.st["fetches"] == 2


def test_inspect_and_call_tool_errors(site):
    ex = am.Explorer(state())
    r = ex.t_http_fetch({"url": "https://www.ex.com/agents?page=1"})
    assert r["ref"] == "r1" and r["status"] == 200 and r["summary"]["kind"] == "html"
    got = ex.t_inspect({"ref": "r1", "css": "a.agent::attr(href)", "limit": 2})
    assert got == {"count": 5, "values": ["/agent/jane-1-0", "/agent/jane-1-1"]}
    assert ex.t_inspect({"ref": "r1", "regex": r"jane-(\d)-0"})["values"] == ["1"]
    text, err = ex.call_tool("inspect", {"ref": "r9"})
    assert err and text == "Error: unknown ref r9"
    text, err = ex.call_tool("nope", {})
    assert err and text == "unknown tool nope"
    ex.st["fetches"] = ex.st["max_fetches"]
    text, err = ex.call_tool("http_fetch", {"url": "https://www.ex.com/"})
    assert err and text.startswith("Limit: research fetch budget used up")


def test_submit_refuses_hand_picked_lists(site):
    ex = am.Explorer(state())
    src = {**LISTING, "name": "l", "seeds": {"city": {"type": "list", "values": ["a", "b"]}}}
    out, err = ex.t_submit_config({"config": {**SETTINGS, "sources": [src]},
                                   "report_markdown": "r"})
    assert err and any("hand-picked list of 2 values" in p for p in out["validation_failed"])
    assert any("run coverage_check first" in p for p in out["validation_failed"])


class FakeModel:
    def __init__(self, turns):
        self.turns = list(turns)
        self.seen: list[list] = []

    def __call__(self, ex, api_key, timeout_ms):
        self.seen.append(list(ex.st["messages"]))
        content = self.turns.pop(0)
        return {"content": content, "stop_reason": "tool_use",
                "usage": {"input_tokens": 1000, "output_tokens": 100}}


def tool(i, name, inp):
    return {"type": "tool_use", "id": f"t{i}", "name": name, "input": inp}


def test_run_to_accepted_config(site, monkeypatch):
    probes = [f"https://www.ex.com/agent/jane-{n}-{i}" for n in (1, 2) for i in range(5)]
    model = FakeModel([
        [{"type": "text", "text": "plan"}, tool(1, "test_source", {"source": LISTING,
                                                                   "settings": SETTINGS})],
        [tool(2, "coverage_check", {"source": LISTING, "probe_urls": probes})],
        [tool(3, "submit_config", {"config": {**SETTINGS, "sources": [{**LISTING,
                                                                        "name": "l"}]},
                                   "report_markdown": "# done"})],
    ])
    monkeypatch.setattr(am.Explorer, "call_model", lambda self, k, t: model(self, k, t))
    monkeypatch.setattr(am.Explorer, "page_kind",
                        lambda self, u, h, k: {"kind": "person", "reason": "one agent"})
    st = state()
    ex = am.Explorer(st)
    ex.run("key")
    assert st["result"]["outcome"] == "config", st["log"]
    assert st["coverage"] == {"coverage": 100}
    assert st["result"]["validation"][0]["reused_from_earlier_test"] is True
    assert st["turns"] == 3 and st["calls"] == 1 and st["tokens"]["input"] == 3000
    assert st["cost"] > 0
    # tool results go back as one user message per turn
    assert model.seen[1][-1]["content"][0]["type"] == "tool_result"
    assert model.seen[1][-1]["content"][0]["is_error"] is False
    res = am.finish_research(st, ex, None, "x")
    assert res["outcome"] == "config" and len(res["profile_urls"]) == 8


def test_run_v2_step_continues_when_call_time_is_short(site, monkeypatch):
    monkeypatch.setattr(am, "V2_STEP_MS", 30_000)
    called = []
    monkeypatch.setattr(am.Explorer, "call_model", lambda *a: called.append(1))
    out = am.run_v2_step("k", {"domain": "ex.com", "category": "gcid:x"})
    assert out["status"] == "continue" and not called
    assert out["state"]["messages"][0]["role"] == "user"
    assert out["state"]["calls"] == 1


def test_oxy_fetch(monkeypatch):
    from _base.disco import webscraper

    got = {}

    def fake(req):
        got.update(req)
        return {"ok": True, "status_code": 403, "content": "x" * 50}

    monkeypatch.setattr(webscraper, "fetch_api_call", fake)
    r = am.oxy_fetch({"method": "GET", "url": "https://x.com/", "headers": {
        "User-Agent": "a", "x-api-key": "k", ":path": "/"}, "maxBytes": 10, "timeoutMs": 1000})
    assert got["headers"] == {"x-api-key": "k"} and got["crawl_method"] == "server_crawl"
    assert r["status"] == 403 and r["blocked"] and r["truncated"] and r["text"] == "x" * 10
    r = am.oxy_fetch({"method": "GET", "url": "https://x.com/", "headers": {"x-a": "1"},
                      "render": True, "timeoutMs": 1000})
    assert r["status"] == 0 and r["error"].startswith("render works for GET")
    monkeypatch.setattr(webscraper, "scrape_website", lambda req: (_ for _ in ()).throw(
        RuntimeError("boom")))
    r = am.oxy_fetch({"method": "GET", "url": "https://x.com/", "render": True,
                      "timeoutMs": 1000})
    assert r["error"] == "timed out after 1 s"


def test_handle_request_errors(monkeypatch):
    monkeypatch.setenv("DISCO_WORKER_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a")
    assert am.handle_request(b"{}", "bad", "http://h/") == (401, "Unauthorized")
    assert am.handle_request(b"{", "k", "http://h/") == (400, {"error": "invalid JSON body"})
    assert am.handle_request(b"{}", "k", "http://h/")[0] == 400
    assert am.handle_request(b'{"dry_run": true}', "k", "http://h/") == (
        400, {"error": "domain (or state) is required"})
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert am.handle_request(b"{}", "k", "http://h/") == (
        500, {"error": "ANTHROPIC_API_KEY not configured"})
