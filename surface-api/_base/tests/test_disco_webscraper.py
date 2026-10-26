"""Tests for _base.disco.webscraper (httpx monkeypatched; no network)."""
from __future__ import annotations

import base64
import json

import httpx
import pytest

from _base.disco import webscraper as ws


class Resp:
    def __init__(self, status: int, body, url: str = ""):
        self.status_code = status
        self.text = body if isinstance(body, str) else json.dumps(body)
        self.url = url

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300


def ox(content, status_code=200, url=None):
    r = {"content": content, "status_code": status_code}
    if url:
        r["url"] = url
    return {"results": [r], "job_id": "j1", "status": "done"}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("OXYLABS_USERNAME", "u")
    monkeypatch.setenv("OXYLABS_PASSWORD", "p")
    for k in ("OXYLABS_GEO_LOCATION", "OXYLABS_USER_AGENT_TYPE", "FORCE_PROXY",
              "OXYLABS_ENDPOINT"):
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def posts(monkeypatch):
    """Queue Oxylabs replies; records each POST payload."""
    sent: list[dict] = []
    replies: list = []

    def fake_post(url, headers=None, content=None, timeout=None):
        sent.append({"url": url, "headers": headers, "payload": json.loads(content),
                     "timeout": timeout})
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(ws.httpx, "post", fake_post)
    return sent, replies


GOOD = "<html><title>Jane Doe CPA</title><body>" + "real content " * 400 + "</body></html>"


def test_looks_blocked():
    assert ws.looks_blocked(403, GOOD)
    assert ws.looks_blocked(200, "  ")
    assert ws.looks_blocked(200, None)
    assert ws.looks_blocked(200, "<title>Attention Required! | Cloudflare</title>")
    assert ws.looks_blocked(200, "<p>Please verify you are human</p>")
    # big page embedding a reCAPTCHA script is not blocked
    page = GOOD.replace("</body>", "<script>grecaptcha captcha</script></body>")
    assert not ws.looks_blocked(200, page)
    # small JSON is fine
    assert not ws.looks_blocked(200, '{"ok":1}')


def test_scrape_ok_payload_and_auth(posts, monkeypatch):
    sent, replies = posts
    monkeypatch.setenv("OXYLABS_GEO_LOCATION", "United States")
    replies.append(Resp(200, ox(GOOD, url="https://ex.com/final")))
    out = ws.scrape_website({"url": "https://ex.com", "crawl_method": "server_crawl"})
    assert out["ok"] and out["rendered"] is False and out["attempted_render_fallback"] is False
    assert out["resolved_url"] == "https://ex.com/final"
    assert out["oxylabs"] == {"job_id": "j1", "status": "done", "raw": ox(GOOD, url="https://ex.com/final")}
    assert "error" not in out
    p = sent[0]
    assert p["url"] == "https://realtime.oxylabs.io/v1/queries"
    assert p["payload"] == {"source": "universal", "url": "https://ex.com",
                            "geo_location": "United States"}
    assert p["headers"]["Authorization"] == "Basic " + base64.b64encode(b"u:p").decode()
    assert p["timeout"].read == 60.0


def test_scrape_blocked_then_render_fallback(posts):
    sent, replies = posts
    replies += [Resp(200, ox("<title>Access Denied</title>")), Resp(200, ox(GOOD))]
    out = ws.scrape_website({"url": "https://ex.com", "crawl_method": "needs_proxy"})
    assert out["ok"] and out["rendered"] and out["attempted_render_fallback"]
    assert sent[1]["payload"]["render"] == "html"
    assert sent[1]["timeout"].read == 180.0


def test_scrape_blocked_without_fallback(posts):
    _, replies = posts
    replies.append(Resp(200, ox("<title>Access Denied</title>")))
    out = ws.scrape_website({"url": "https://ex.com", "crawl_method": "server_crawl",
                             "fallback_render": False})
    assert not out["ok"] and out["error"] == "Target returned blocked/unusable content"


def test_scrape_errors_both_attempts(posts):
    _, replies = posts
    replies += [Resp(500, {"message": "x"}), Resp(200, "not json")]
    out = ws.scrape_website({"url": "https://ex.com", "crawl_method": "server_crawl"})
    assert out["ok"] is False and out["rendered"] and out["attempted_render_fallback"]
    assert out["error"] == (
        'normal=Error: Oxylabs HTTP 500: {"message":"x"}; '
        "render=Error: Oxylabs returned non-JSON HTTP 200"
    )


def test_scrape_needs_js_api_renders_first_and_no_fallback(posts):
    sent, replies = posts
    replies.append(httpx.ReadTimeout("slow"))
    out = ws.scrape_website({"url": "https://ex.com", "crawl_method": "needs_js_api"})
    assert sent[0]["payload"]["render"] == "html"
    assert out == {
        "ok": False, "url": "https://ex.com", "resolved_url": None,
        "crawl_method": "needs_js_api", "rendered": True, "attempted_render_fallback": False,
        "status_code": None, "content": None, "error": "AbortError: This operation was aborted",
    }


def test_direct_only_when_force_proxy_false(posts, monkeypatch):
    sent, replies = posts
    got: list[str] = []

    def fake_get(url, follow_redirects=None, timeout=None):
        got.append(url)
        return Resp(200, GOOD, url="https://ex.com/")

    monkeypatch.setattr(ws.httpx, "get", fake_get)
    replies.append(Resp(200, ox(GOOD)))
    ws.scrape_website({"url": "https://ex.com", "crawl_method": "direct"})
    assert got == [] and len(sent) == 1  # proxied by default
    monkeypatch.setenv("FORCE_PROXY", "false")
    out = ws.scrape_website({"url": "https://ex.com", "crawl_method": "direct"})
    assert got == ["https://ex.com"] and out["ok"] and "oxylabs" not in out


def test_validate_url():
    with pytest.raises(ValueError, match="Only http"):
        ws.scrape_website({"url": "ftp://ex.com", "crawl_method": "server_crawl"})


def test_fetch_api_call_post_context(posts):
    sent, replies = posts
    replies.append(Resp(200, ox({"a": 1}, status_code=200)))
    out = ws.fetch_api_call({"url": "https://ex.com/api", "method": "post",
                             "headers": {"x-a": "1"}, "body": '{"id":5}',
                             "crawl_method": "server_crawl", "timeoutMs": 5000})
    assert out["ok"] and out["content"] == '{"a":1}' and out["status_code"] == 200
    assert sent[0]["payload"]["context"] == [
        {"key": "http_method", "value": "post"},
        {"key": "content", "value": base64.b64encode(b'{"id":5}').decode()},
        {"key": "force_headers", "value": True},
        {"key": "headers", "value": {"x-a": "1"}},
    ]
    assert ws.fetch_api_call(url="https://ex.com", method="PUT", crawl_method="server_crawl",
                             timeout_ms=1)["error"] == "method PUT not supported"


def test_fetch_api_call_upstream_failure(posts):
    _, replies = posts
    replies.append(Resp(200, ox(None, status_code=404)))
    out = ws.fetch_api_call(url="https://ex.com/api", method="GET", crawl_method="server_crawl",
                            timeout_ms=5000)
    assert out["ok"] is False and out["status_code"] == 404 and "error" not in out


def test_capture_ladder_falls_back(posts):
    sent, replies = posts
    replies += [Resp(400, {"error": "bad instructions"}), Resp(200, ox([{"url": "https://x"}]))]
    out = ws.capture_network_calls("https://ex.com/p", {"timeoutMs": 100_000})
    assert out["ok"] and out["actions"] == "scroll" and out["scrolled"]
    assert out["failed_attempts"][0]["actions"] == "scroll+clicks"
    assert sent[0]["payload"]["browser_instructions"][1]["selector"]["value"] == ws.MORE_XPATH
    assert sent[0]["payload"]["xhr"] is True and sent[0]["payload"]["render"] == "html"
    assert out["content"] == [{"url": "https://x"}]


def test_capture_no_scroll_and_type_input(posts):
    sent, replies = posts
    replies.append(Resp(200, ox("[]")))
    ws.capture_network_calls("https://ex.com/p", timeout_ms=50_000, scroll=False)
    assert "browser_instructions" not in sent[0]["payload"]
    replies.append(Resp(200, ox("[]")))
    out = ws.capture_network_calls(
        "https://ex.com/p", timeout_ms=50_000,
        type_input={"xpath": "//input", "value": "90210", "submitXpath": "//button"},
    )
    steps = sent[1]["payload"]["browser_instructions"]
    assert out["actions"] == "type+submit"
    assert steps[0] == {"type": "input", "selector": {"type": "xpath", "value": "//input"},
                        "value": "90210", "timeout_s": 8}
    assert {"type": "click", "selector": {"type": "xpath", "value": "//button"},
            "timeout_s": 5, "on_error": "skip"} in steps


def test_capture_all_fail(posts):
    _, replies = posts
    replies += [RuntimeError("down")] * 3
    out = ws.capture_network_calls("https://ex.com/p", timeout_ms=100_000)
    assert out["ok"] is False and len(out["failed_attempts"]) == 3
    assert out["error"] == "Error: down"


def test_handler(posts, monkeypatch):
    _, replies = posts
    monkeypatch.setenv("DISCO_WORKER_KEY", "k")
    assert ws.handle_webscraper_request(b"{}", "k", method="GET") == (
        405, {"error": "POST required"})
    assert ws.handle_webscraper_request(b"{}", "wrong") == (401, {"error": "unauthorized"})
    assert ws.handle_webscraper_request(b"{", "k") == (400, {"error": "Invalid JSON body"})
    assert ws.handle_webscraper_request(b'{"url":"https://e.com"}', "k")[0] == 400
    status, body = ws.handle_webscraper_request(
        b'{"url":"https://e.com","crawl_method":"x"}', "k")
    assert status == 400 and body["error"].startswith("crawl_method must be one of server_crawl")
    replies.append(Resp(200, ox(GOOD)))
    status, body = ws.handle_webscraper_request(
        b'{"url":"https://e.com","crawl_method":"server_crawl"}', "k")
    assert status == 200 and body["ok"]
    replies += [Resp(200, ox("")), Resp(200, ox(""))]
    status, body = ws.handle_webscraper_request(
        b'{"url":"https://e.com","crawl_method":"server_crawl"}', "k")
    assert status == 502 and body["error"] == "Rendered response still blocked/unusable"
    status, body = ws.handle_webscraper_request(
        b'{"url":"mailto:a@b","crawl_method":"server_crawl"}', "k")
    assert status == 400 and body["ok"] is False
