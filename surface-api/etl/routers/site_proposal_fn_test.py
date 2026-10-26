"""Tests for the site-proposal function port (DB and disco library faked)."""
from __future__ import annotations

import math
import sys
import types
from collections.abc import Callable
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from _base.auth import current_user
from etl.routers.site_proposal_fn import (
    crawl_method_for,
    given_url_problem,
    js_number,
    parse_accept_input,
    parse_preview_input,
    sample_urls,
)

SC_V3 = {
    "version": 3,
    "samples": ["https://acme.com/agents/a", {"url": "https://acme.com/agents/b"}, "ftp://x"],
    "site_entity_names": ["Acme"],
    "firm_signatures": ["acme"],
    "own_page_key": "own_page",
}


class FakeDB:
    """Records (role, claims, write, sql, params) and answers each query from a responder."""

    def __init__(self, responder: Callable[[str, Any], list[dict]]):
        self.responder = responder
        self.log: list[tuple[str, dict | None, bool, str, Any]] = []

    def role_connection(self, role, jwt_claims=None, *, write=False, fresh=False):
        db = self

        class _Cur:
            def __init__(self):
                self.rows: list[dict] = []

            def execute(self, sql, params=None):
                db.log.append((role, jwt_claims, write, sql, params))
                self.rows = list(db.responder(sql, params))

            def fetchall(self):
                return self.rows

            def fetchone(self):
                return self.rows[0] if self.rows else None

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        class _Conn:
            def cursor(self):
                return _Cur()

        @contextmanager
        def _cm():
            yield _Conn()

        return _cm()


@pytest.fixture
def fake_db(monkeypatch):
    def install(responder: Callable[[str, Any], list[dict]]) -> FakeDB:
        db = FakeDB(responder)
        from etl.routers import _sql, site_proposal_fn

        monkeypatch.setattr(_sql, "role_connection", db.role_connection)
        monkeypatch.setattr(site_proposal_fn, "role_connection", db.role_connection)
        return db

    return install


@pytest.fixture
def client():
    from etl.router import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: {"sub": "user-1", "role": "authenticated"}
    return TestClient(app)


def test_js_number():
    assert js_number(None) == 0 and js_number("") == 0 and js_number(" 7 ") == 7
    assert math.isnan(js_number("x")) and math.isnan(js_number({}))


def test_parse_preview_input():
    assert parse_preview_input({"proposalId": "5", "urls": [" a ", "a", "", None]}) == {
        "proposalId": 5, "domain": None, "gcid": None, "urls": ["a"],
    }
    assert parse_preview_input({"domain": " Acme.COM ", "gcid": " gcid:x "})["domain"] == "acme.com"
    with pytest.raises(Exception) as e:
        parse_preview_input({"domain": "acme.com"})
    assert e.value.detail == "proposalId, or domain and gcid, required"
    with pytest.raises(Exception) as e:
        parse_preview_input({"proposalId": 1, "urls": [f"u{i}" for i in range(11)]})
    assert e.value.detail == "at most 10 URLs"


def test_parse_accept_input():
    assert parse_accept_input({"proposalId": 3}) == {"proposalId": 3}
    for bad in (None, {}, {"proposalId": -1}, {"proposalId": "x"}):
        with pytest.raises(HTTPException):
            parse_accept_input(bad)


def test_given_url_problem():
    pat = r"/agents/[a-z]+$"
    assert given_url_problem("https://www.acme.com/agents/jane", "acme.com", pat) is None
    assert given_url_problem("https://acme.com/agents/jane?x=1", "acme.com", pat) is None
    assert given_url_problem("nope", "acme.com", pat) == "not a valid address"
    assert given_url_problem("mailto:a@acme.com", "acme.com", pat) == "not an http(s) address"
    assert given_url_problem("https://evilacme.com/agents/a", "acme.com", pat) == (
        "not on acme.com"
    )
    assert given_url_problem("https://acme.com/about", "acme.com", pat) == (
        "does not match the contract's profile page pattern"
    )
    assert given_url_problem("https://acme.com/about", "acme.com", "(") is None  # bad regex


def test_crawl_method_and_samples():
    assert crawl_method_for({"fetch_tier": "proxy_render", "crawl_method": "x"}) == "needs_js_api"
    assert crawl_method_for({"crawl_method": "blocked_needs_proxy"}) == "needs_proxy"
    assert crawl_method_for(None) == "server_crawl"
    assert sample_urls(SC_V3) == ["https://acme.com/agents/a", "https://acme.com/agents/b"]


@pytest.fixture
def fake_disco(monkeypatch):
    calls: dict[str, list] = {"scrape": [], "api": []}
    pkg = types.ModuleType("_base.disco")
    sc = types.ModuleType("_base.disco.site_contract")
    da = types.ModuleType("_base.disco.detail_api")
    ws = types.ModuleType("_base.disco.webscraper")
    ek = types.ModuleType("_base.disco.extra_keys")

    def scrape_website(req):
        calls["scrape"].append(req)
        if req["url"].endswith("/down"):
            return {"ok": False, "content": None, "status_code": 503}
        return {"ok": True, "content": "<html>page</html>", "status_code": 200}

    ws.scrape_website = scrape_website
    ws.looks_blocked = lambda status, content: False
    sc.apply_site_contract = lambda html, url, c, names, opts: {
        "values": {"name": "Jane", "phone": "1"}, "firm_relabelled": ["tax.x"],
    }
    sc.looks_not_found = lambda html, values: False
    sc.apply_address_owner = lambda values, c: values
    sc.apply_extra_fields = lambda html, url, c, names, opts: {"ext": 1}
    sc.apply_value_rules = lambda values, c, url: dict(values)

    def build_harvest_record(**kw):
        calls["build"] = kw
        calls.setdefault("by_url", {})[kw["detail_url"]] = kw
        return {
            "entity_type": "professional", "filled": len(kw["values"]), "floor_needed": 3,
            "shallow": False, "must_have": {"ok": True, "missing": []},
            "identity_candidates": {"universal": {"name": kw["values"].get("name")}},
            "payload": {"v": kw["values"]},
        }

    sc.build_harvest_record = build_harvest_record

    def fetch_detail_for(api, url, timeout):
        calls["api"].append((api, url, timeout))
        return {"json": {"phone": "2", "name": ""}, "why": ""}

    da.fetch_detail_for = fetch_detail_for
    da.json_values = lambda j, fields: dict(j)

    def refresh_extra_keys(db, gcid, domain, extras):
        calls["refresh"] = (gcid, domain, extras)

    ek.refresh_extra_keys = refresh_extra_keys
    for name, mod in (("site_contract", sc), ("detail_api", da), ("webscraper", ws),
                      ("extra_keys", ek)):
        setattr(pkg, name, mod)
        monkeypatch.setitem(sys.modules, f"_base.disco.{name}", mod)
    monkeypatch.setitem(sys.modules, "_base.disco", pkg)
    return calls


def _responder(contract, allowed=True, src=None):
    def responder(sql, params):
        if "exp_ctrl_has_role" in sql:
            return [{"allowed": allowed}]
        if "from disco_proposals" in sql:
            return [{"proposal_id": 7, "category_slug": "gcid:agent", "kind": "site_map",
                     "payload": {"domain": "acme.com", "extraction": {"site_contract": contract},
                                 "field_floor": 3, "detail_pattern": r"/agents/"}}]
        if "from disco_site_contract" in sql:
            return [{"domain": "acme.com", "extraction": {"site_contract": contract}}]
        if "from exp_etl_sources" in sql:
            return [src] if src else []
        if "disco_accept_site_proposal" in sql:
            return [{"res": {"ok": True, "domain": "acme.com"}}]
        return []

    return responder


def test_preview_requires_admin(client, fake_db, fake_disco):
    fake_db(_responder(SC_V3, allowed=False))
    res = client.post("/etl/fn/previewSiteProposal", json={"data": {"proposalId": 7}})
    assert res.status_code == 403 and res.json()["detail"] == "insufficient_privilege"


def test_preview_samples_page_mode(client, fake_db, fake_disco):
    db = fake_db(_responder(SC_V3, src={"fetch_tier": "proxy", "source_type": "brand_site"}))
    res = client.post("/etl/fn/previewSiteProposal", json={"data": {"proposalId": 7}})
    body = res.json()
    assert res.status_code == 200
    assert body["domain"] == "acme.com" and body["target"] == "proposal #7"
    assert [r["url"] for r in body["records"]] == SC_V3["samples"][:1] + ["https://acme.com/agents/b"]
    rec = body["records"][0]
    assert rec["ok"] and rec["detail_source"] == "page" and rec["universal"] == {"name": "Jane"}
    assert fake_disco["scrape"][0]["crawl_method"] == "server_crawl"
    # brand_site: the own page key is filled with the page URL
    assert fake_disco["build"]["values"]["tax.own_page"] in SC_V3["samples"][:1] + [
        "https://acme.com/agents/b"
    ]
    assert fake_disco["build"]["extras"] == {"ext": 1}
    roles = [(r[0], r[2]) for r in db.log]
    assert roles[0] == ("authenticated", False)
    assert all(not w for _, w in roles)  # read-only


def test_preview_given_urls_and_api_merge(client, fake_db, fake_disco):
    contract = {**SC_V3, "detail_route": {"record_source": "api+page", "api": {"u": 1},
                                          "json_fields": {"phone": "$.phone"}}}
    fake_db(_responder(contract))
    res = client.post(
        "/etl/fn/previewSiteProposal",
        json={"data": {"domain": "acme.com", "gcid": "gcid:agent",
                       "urls": ["https://acme.com/agents/jane", "https://other.com/agents/x",
                                "https://acme.com/agents/down"]}},
    )
    recs = res.json()["records"]
    assert res.json()["target"] == "saved contract"
    assert recs[0]["ok"] and recs[0]["detail_source"] == "api+page"
    assert recs[1] == {"url": "https://other.com/agents/x", "ok": False,
                       "reason": "not fetched: not on acme.com"}
    # API answered, page did not load: still a record, from the API values
    assert recs[2]["ok"] and recs[2]["detail_source"] == "api+page"
    # merge: API value wins where non-empty, page fills the rest
    by_url = fake_disco["by_url"]
    assert by_url["https://acme.com/agents/jane"]["values"] == {"name": "Jane", "phone": "2"}
    assert by_url["https://acme.com/agents/down"]["values"] == {"phone": "2"}
    assert fake_disco["api"][0][2] == 30_000


def test_preview_no_contract(client, fake_db, fake_disco):
    fake_db(_responder({"version": 2}))
    res = client.post("/etl/fn/previewSiteProposal", json={"data": {"proposalId": 7}})
    assert res.status_code == 400 and res.json()["detail"] == "no site contract to preview"


def test_preview_page_failure_reason(client, fake_db, fake_disco):
    fake_db(_responder(SC_V3))
    res = client.post(
        "/etl/fn/previewSiteProposal",
        json={"data": {"proposalId": 7, "urls": ["https://acme.com/agents/down"]}},
    )
    assert res.json()["records"] == [
        {"url": "https://acme.com/agents/down", "ok": False, "reason": "did not load (status 503)"}
    ]


def test_accept(client, fake_db, fake_disco):
    contract = {**SC_V3, "extra_fields": {"hobby": {"label": "Hobby"}}}
    db = fake_db(_responder(contract))
    res = client.post("/etl/fn/acceptSiteProposal", json={"data": {"proposalId": 7}})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "domain": "acme.com", "extra_keys_refreshed": True}
    first = db.log[0]
    assert first[0] == "authenticated" and first[2] is True and first[4] == (7,)
    assert fake_disco["refresh"] == ("gcid:agent", "acme.com", {"hobby": {"label": "Hobby"}})


def test_accept_refresh_failure_is_reported(client, fake_db, fake_disco):
    fake_db(_responder(SC_V3))

    def boom(*a):
        raise RuntimeError("refresh down")

    sys.modules["_base.disco.extra_keys"].refresh_extra_keys = boom
    res = client.post("/etl/fn/acceptSiteProposal", json={"data": {"proposalId": 7}})
    assert res.json()["extra_keys_refreshed"] is False
    assert res.json()["extra_keys_error"] == "refresh down"


def test_accept_bad_input(client, fake_db, fake_disco):
    fake_db(_responder(SC_V3))
    res = client.post("/etl/fn/acceptSiteProposal", json={"data": {}})
    assert res.status_code == 400 and res.json()["detail"] == "proposalId required"
