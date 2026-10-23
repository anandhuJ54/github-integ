"""Tests for _base.disco.network_route (pure helpers)."""
from __future__ import annotations

import base64
import json
import re

from _base.disco import network_route as nr


def matches(u: str) -> bool:
    return bool(re.match(r"^https://ex\.com/agent/[^/?#]+/?$", u))


def test_normalize_captured_calls():
    content = {"xhr": [
        {"url": "https://ex.com/api", "method": "post", "status_code": 200,
         "request_headers": {"X-Key": "k", "N": 3, "bad": {"x": 1}},
         "request_payload": {"page": 2}, "response_body": {"items": []}},
        {"url": "ftp://x"}, "junk",
    ]}
    calls = nr.normalize_captured_calls(json.dumps(content))
    assert calls == [{
        "url": "https://ex.com/api", "method": "POST", "status_code": 200,
        "request_headers": {"x-key": "k", "n": "3"}, "request_payload": '{"page":2}',
        "response_body": '{"items":[]}',
    }]
    assert nr.normalize_captured_calls("not json") == []


def test_parse_json_loose():
    assert nr.parse_json_loose(")]}',\n{\"a\":1}") == {"a": 1}
    assert nr.parse_json_loose("for(;;);[1]") == [1]
    assert nr.parse_json_loose(base64.b64encode(b'{"b":2}').decode()) == {"b": 2}
    assert nr.parse_json_loose("<html>") is None
    assert nr.parse_json_loose(None) is None


def test_profile_urls_in_json():
    js = {"data": [{"link": "/agent/a?ref=1"}, {"link": "https://ex.com/agent/b"},
                   {"link": "https://ex.com/blog/x"}], "self": "/agent/c"}
    out = nr.profile_urls_in_json(js, "https://ex.com/search", matches)
    assert out["urls"] == ["https://ex.com/agent/a", "https://ex.com/agent/b",
                           "https://ex.com/agent/c"]
    assert out["path"] == "$.data[].link"


def test_id_template_hits_and_urls():
    js = {"results": [{"slug": s, "n": "x"} for s in ("jane-doe", "bob-roe", "al-poe")]}
    hit = nr.id_template_hits(js, ["https://ex.com/agent/jane-doe"], matches)
    assert hit == {"field_path": "$.results[].slug", "template": "https://ex.com/agent/{v}",
                   "urls": ["https://ex.com/agent/jane-doe", "https://ex.com/agent/bob-roe",
                            "https://ex.com/agent/al-poe"], "known_match": True}
    assert nr.id_urls_at(js, hit["field_path"], hit["template"], matches) == hit["urls"]


def test_record_template_hits():
    js = {"hits": [{"id": 100 + i, "name": n} for i, n in enumerate(["Jane Doe", "Bob Roe",
                                                                       "Al Poe"])]}
    known = ["https://ex.com/agent/jane-doe/100", "https://ex.com/agent/x/1"]

    def m(u: str) -> bool:
        return bool(re.match(r"^https://ex\.com/agent/[a-z-]+/\d+$", u))

    hit = nr.record_template_hits(js, known, m)
    assert hit["label"] == "https://ex.com/agent/{slug:name}/{id}"
    assert hit["urls"][1] == "https://ex.com/agent/bob-roe/101"
    assert nr.record_urls_at(js, hit["array_path"], hit["template"], m) == hit["urls"]
    assert nr.slugify("Zoë O'Brien") == "zoe-obrien"
    assert nr.slugify("Zoë O'Brien", False) == "zoe-o-brien"


def call(url: str, payload: str | None = None, method: str = "GET") -> dict:
    return {"url": url, "method": method, "status_code": 200, "request_headers": {},
            "request_payload": payload, "response_body": None}


def test_paging_from_two_calls():
    a = call("https://ex.com/api?q=x&page=1&size=20")
    b = call("https://ex.com/api?q=x&page=2&size=20")
    p = nr.paging_from_two_calls(a, b)
    assert p == {"kind": "page", "key": {"where": "query", "path": ["page"]}, "key_name": "page",
                 "current": 2, "step": 1, "page_size": 20, "found_by": "two_captured_calls"}
    g1 = call("https://ex.com/graphql", '{"variables":{"first":12,"after":0}}', "POST")
    g2 = call("https://ex.com/graphql", '{"variables":{"first":12,"after":12}}', "POST")
    p2 = nr.paging_from_two_calls(g1, g2)
    assert p2["kind"] == "offset" and p2["key"] == {"where": "body_json",
                                                     "path": ["variables", "after"]}
    op1 = call("https://ex.com/graphql", '{"operationName":"A","page":1}', "POST")
    op2 = call("https://ex.com/graphql", '{"operationName":"B","page":2}', "POST")
    assert nr.paging_from_two_calls(op1, op2) is None
    # page key only in the second call
    assert nr.paging_from_two_calls(call("https://ex.com/api?q=x"),
                                    call("https://ex.com/api?q=x&page=2"))["current"] == 2


def test_paging_from_params_totals_and_call_with_page():
    c = call("https://ex.com/api?filter=%7B%22from%22%3A0%2C%22size%22%3A25%7D")
    p = nr.paging_from_params(c, 25)
    assert p["kind"] == "offset" and p["key"] == {"where": "query_json", "param": "filter",
                                                   "path": ["from"]}
    assert p["step"] == 25
    nxt = nr.call_with_page(c, p["key"], 25)
    assert json.loads(nr.parse_form(nxt["url"].split("?")[1])[0][1]) == {"from": 25, "size": 25}
    form = call("https://ex.com/s", "pg=1&q=a+b", "POST")
    pf = nr.paging_from_params(form, 10)
    assert pf["key"] == {"where": "body_form", "path": ["pg"]}
    assert nr.call_with_page(form, pf["key"], 2)["body"] == "pg=2&q=a+b"
    q = call("https://ex.com/api?page=3")
    assert nr.call_with_page(q, {"where": "query", "path": ["page"]}, 4)["url"] == (
        "https://ex.com/api?page=4")
    js = {"meta": {"total": {"value": 500}, "totalPages": 20}, "items": [{"total": 9999}]}
    assert nr.totals_in_json(js, 25) == {"total": 500, "total_key": "$.meta.total.value",
                                         "total_pages": 20}


def test_replay_headers_and_noise():
    h = {"Cookie": "x", "X-Api-Key": "k", "x-csrf-token": "t", "Accept": "json",
         ":authority": "a", "sec-fetch-mode": "cors", "User-Agent": "u"}
    assert nr.replay_headers(h) == {"x-api-key": "k", "accept": "json"}
    assert nr.noise_reason("https://www.google-analytics.com/g/collect") == (
        "tracker / third-party service")
    assert nr.noise_reason("https://ex.com/static/app.js?v=1") == "static asset"
    assert nr.noise_reason("https://ex.com/api/events") == "tracking-style path"
    assert nr.noise_reason("nope") == "bad url"
    assert not nr.is_noise_call("https://ex.com/api/agents?page=2")
    assert nr.endpoint_key(call("https://ex.com/a?x=1")) == "GET https://ex.com/a"
