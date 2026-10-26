"""Tests for _base.disco.detail_api (sibling modules stubbed; webscraper monkeypatched)."""
from __future__ import annotations

import json
import re
import sys
import types
from urllib.parse import urlsplit

import pytest

from _base.disco import detail_api as d


def _jsonpath(data, path):
    """Tiny JSONPath subset for tests: $.a.b, [*]."""
    nodes = [data]
    for tok in re.findall(r"\.([A-Za-z_$][\w$]*)|\[(\*)\]", path[1:]):
        key, star = tok
        if star:
            nodes = [x for n in nodes if isinstance(n, list) for x in n]
        elif key:
            nodes = [n[key] for n in nodes if isinstance(n, dict) and key in n]
    if not re.fullmatch(r"\$(\.[A-Za-z_$][\w$]*|\[\*\])*", path):
        raise ValueError("Unsupported JSONPath")
    return nodes


def _parse_json_loose(s):
    if s is None:
        return None
    t = s.strip()
    if not t or t[0] not in "{[":
        return None
    try:
        return json.loads(t)
    except ValueError:
        return None


@pytest.fixture(autouse=True)
def _siblings(monkeypatch):
    ae = types.ModuleType("_base.disco.agent_engine")
    ae.site_domain = lambda h: ".".join(h.lower().split(".")[-2:])
    ae.host_of = lambda u: (urlsplit(u).hostname or "").lower()
    ae.jsonpath = _jsonpath
    nr = types.ModuleType("_base.disco.network_route")
    nr.normalize_captured_calls = lambda content: list(content or [])
    nr.parse_json_loose = _parse_json_loose
    nr.replay_headers = lambda h: {k: v for k, v in h.items() if k != "cookie"}
    nr.is_noise_call = lambda u: "analytics" in u
    sc = types.ModuleType("_base.disco.site_contract")
    sc.field_type = lambda fid: "list" if fid.endswith("languages") else "text"
    for m in (ae, nr, sc):
        monkeypatch.setitem(sys.modules, m.__name__, m)


def test_profile_tokens_and_templates():
    u = "https://www.ex.com/agents/jane-doe/12345"
    assert d.profile_tokens(u) == {"id": "12345", "slug": "jane-doe", "words": ["jane", "doe"]}
    spec = d._token_spec("https://ex.com/p/id-98765-x", "id", "98765")
    assert spec == {"kind": "id", "seg_from_end": 1, "seg_pattern": r"id-(\d+)-x"}
    assert d.token_from("https://ex.com/p/id-111-x", spec) == "111"
    assert d.token_from("https://ex.com", spec) is None
    assert d._re_esc("a.b(c)") == r"a\.b\(c\)"
    api = {"url_template": "https://ex.com/api/{token}", "body_template": None,
           "token": {"kind": "slug", "seg_from_end": 1, "seg_pattern": "([^/]+)"}}
    assert d.build_detail_call(api, "https://ex.com/a/jos%C3%A9 x") == {
        "url": "https://ex.com/api/jos%C3%A9%20x", "body": None}


PROFILES = [
    "https://ex.com/agents/jane-doe/10001",
    "https://ex.com/agents/john-roe/10002",
    "https://ex.com/agents/mary-poe/10003",
    "https://other.com/agents/x-y/10004",
]


def _profile_json(pid, name):
    return json.dumps({"agent": {"id": pid, "name": name, "phone": "555-123-4567",
                                 "email": f"{pid}@ex.com", "languages": ["en", "es"]}})


def test_probe_proves_api(monkeypatch):
    captures = []

    def capture(url, timeout_ms=None, scroll=None):
        captures.append((url, scroll))
        pid = url.rsplit("/", 1)[1]
        return {"ok": True, "content": [
            {"url": "https://ex.com/analytics/x", "response_body": "{}"},
            {"url": "https://cdn.other.com/x", "response_body": "{}"},
            {"url": f"https://api.ex.com/agent?id={pid}", "method": "GET",
             "request_headers": {"accept": "json", "cookie": "s"},
             "response_body": _profile_json(pid, "jane doe")},
        ]}

    fetched = []

    def fetch(**kw):
        fetched.append(kw)
        pid = re.search(r"id=(\d+)", kw["url"]).group(1)
        names = {"10001": "Jane Doe", "10002": "John Roe", "10003": "Mary Poe"}
        return {"ok": True, "status_code": 200, "content": _profile_json(pid, names[pid])}

    monkeypatch.setattr(d.webscraper, "capture_network_calls", capture)
    monkeypatch.setattr(d.webscraper, "fetch_api_call", fetch)
    out = d.probe_detail_api(domain="www.ex.com", profile_urls=PROFILES + PROFILES[:1],
                             deadline_at=d._now_ms() + 300_000)
    assert out["status"] == "proven", out
    assert out["api"] == {
        "method": "GET", "url_template": "https://api.ex.com/agent?id={token}",
        "body_template": None, "headers": {"accept": "json"},
        "token": {"kind": "id", "seg_from_end": 1, "seg_pattern": r"(\d+)"},
    }
    assert out["captures"] == 2 and all(s is False for _, s in captures)
    assert {"url": "https://cdn.other.com/x", "why": "other domain (site-only rule)"} in out[
        "checked"]
    assert len(out["proven_on"]) == 3 and all(c["ok"] for c in out["proven_on"])
    assert fetched[0]["crawl_method"] == "server_crawl"


def test_probe_reasons(monkeypatch):
    out = d.probe_detail_api(domain="ex.com", profile_urls=PROFILES[:2], deadline_at=0)
    assert out["reason"] == "fewer than 3 profile pages with an id or name in the URL (2)"
    out = d.probe_detail_api(domain="ex.com", profile_urls=PROFILES, deadline_at=0)
    assert out["reason"] == "time budget (no capture)" and out["captures"] == 0
    monkeypatch.setattr(d.webscraper, "capture_network_calls",
                        lambda u, **kw: {"ok": False, "error": "Oxylabs HTTP 613"})
    out = d.probe_detail_api(domain="ex.com", profile_urls=PROFILES,
                             deadline_at=d._now_ms() + 300_000)
    assert out["captures"] == 3  # third page tried when both fail
    assert out["reason"] == "capture failed on all 3 profile pages (inconclusive)"


def test_probe_rejects_replay_holding_another_profile(monkeypatch):
    monkeypatch.setattr(d.webscraper, "capture_network_calls", lambda u, **kw: {
        "ok": True, "content": [{"url": f"https://ex.com/api/{u.rsplit('/', 1)[1]}",
                                 "response_body": _profile_json(u.rsplit('/', 1)[1], "x")}]})
    monkeypatch.setattr(d.webscraper, "fetch_api_call", lambda **kw: {
        "ok": True, "content": json.dumps({"ids": ["10001", "10002", "10003"],
                                           "names": "jane doe john roe mary poe"})})
    out = d.probe_detail_api(domain="ex.com", profile_urls=PROFILES,
                             deadline_at=d._now_ms() + 300_000)
    assert out["status"] == "none"
    assert out["reason"] == "a profile call was captured but did not replay for 3 profiles"
    assert out["proven_on"][0]["why"].startswith("replay also holds another profile")


def test_learn_json_fields():
    items = [
        {"profile_url": f"https://ex.com/a/{i}",
         "json": {"agent": {"phone": "555-000-000" + str(i), "email": f"a{i}@x.com",
                            "bio": "Bio" if i < 2 else None, "languages": ["en", "fr"],
                            "nick": "n", "active": True}}}
        for i in range(3)
    ] + [{"profile_url": "https://ex.com/a/none", "json": None}]
    seen = {}

    def ask(prompt):
        seen["prompt"] = prompt
        return {"fields": [
            {"id": "person.phone", "path": "$.agent.phone"},
            {"id": "person.email", "path": "$.agent.nick"},          # implausible
            {"id": "person.bio", "path": "$.agent.bio"},             # 2 of 3: kept
            {"id": "person.languages", "path": "$.agent.languages[*]"},
            {"id": "person.mobile", "path": "$.agent.phone"},        # path reused
            {"id": "person.profile_url", "path": "$.agent.nick"},    # not offered
            {"id": "person.website", "path": "$..bad"},              # unsupported
            "junk",
        ]}

    out = d.learn_json_fields(
        items=items,
        field_ids=["person.phone", "person.email", "person.bio", "person.languages",
                   "person.mobile", "person.profile_url", "person.website",
                   "location.timezone"],
        meanings={"person.bio": "short biography"},
        ask=ask, must_have=lambda v: "person.phone" in v,
    )
    assert "3 single professional profiles" in seen["prompt"]
    assert "person.bio — short biography" in seen["prompt"]
    assert "timezone" not in seen["prompt"].split("KEY PATHS")[0]
    assert "$.agent.active  (3 of 3): true" in seen["prompt"]
    assert out["fields"] == {"person.phone": "$.agent.phone", "person.bio": "$.agent.bio",
                             "person.languages": "$.agent.languages[*]"}
    assert out["fill"] == {"person.phone": 1, "person.bio": 0.67, "person.languages": 1}
    whys = {x["id"]: x["why"] for x in out["dropped"]}
    assert whys == {
        "person.email": "values do not look like this field",
        "person.mobile": "path already used for person.phone",
        "person.profile_url": "unknown field id",
        "person.website": "path not supported",
    }
    assert out["per_item"] == [3, 3, 2] and out["median"] == 3 and out["items"] == 3
    assert out["must_have_share"] == 1
    assert out["sample"]["agent"]["languages"] == ["en", "fr"]
    assert d.json_values(items[0]["json"], out["fields"])["person.languages"] == ["en", "fr"]


def test_fetch_detail_for(monkeypatch):
    api = {"method": "GET", "url_template": "https://ex.com/api/{token}", "body_template": None,
           "headers": {}, "token": {"kind": "id", "seg_from_end": 1, "seg_pattern": r"(\d+)"}}
    replies = iter([
        {"ok": False, "status_code": 404, "content": None},
        {"ok": True, "content": "<html>"},
        {"ok": True, "content": '{"id": "99999"}'},
        {"ok": True, "content": '{"id": "10001"}'},
    ])
    monkeypatch.setattr(d.webscraper, "fetch_api_call", lambda **kw: next(replies))
    u = "https://ex.com/agents/jane-doe/10001"
    assert d.fetch_detail_for(api, "https://ex.com/x", 1000) == {
        "why": "profile id / slug not found in the URL"}
    assert d.fetch_detail_for(api, u, 1000)["why"] == "api call failed (404)"
    assert d.fetch_detail_for(api, u, 1000)["why"] == "api reply is not JSON"
    assert d.fetch_detail_for(api, u, 1000)["why"] == "api reply without this profile's id or name"
    assert d.fetch_detail_for(api, u, 1000) == {
        "json": {"id": "10001"}, "why": "ok", "api_url": "https://ex.com/api/10001"}
