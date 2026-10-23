"""Route tests for the disco list / harvest / detail-api / staging-backfill / webscraper workers.

DB, network and the shared site-contract library are faked; no live services.
"""
from __future__ import annotations

import json
import sys
import types
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from etl.disco import contract_row as cr
from etl.routers import (
    disco_detail_api_worker,
    disco_harvest_worker,
    disco_list_worker,
    disco_staging_backfill,
    disco_webscraper_worker,
)

KEY = {"x-disco-worker-key": "k"}


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._rows: list = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.conn.log.append((sql, params))
        self._rows = []
        for needle, rows in self.conn.canned:
            if needle in sql:
                self._rows = rows
                break

    def executemany(self, sql, seq):
        self.conn.log.append((sql, list(seq)))

    def fetchall(self):
        return [dict(r) for r in self._rows]


class FakeConn:
    def __init__(self, canned):
        self.canned = canned
        self.log: list = []

    def cursor(self):
        return FakeCursor(self)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DISCO_WORKER_KEY", "k")
    app = FastAPI()
    for m in (disco_list_worker, disco_harvest_worker, disco_detail_api_worker,
              disco_staging_backfill, disco_webscraper_worker):
        app.include_router(m.router)
    disco_harvest_worker._rows.clear()
    disco_harvest_worker._names.clear()
    disco_detail_api_worker._rows.clear()
    disco_detail_api_worker._names.clear()
    return TestClient(app)


def fake_db(monkeypatch, canned, *modules):
    conn = FakeConn(canned)
    roles: list = []

    @contextmanager
    def role_connection(role, claims=None, *, write=False, fresh=False):
        roles.append((role, write))
        yield conn

    for m in (cr, *modules):
        monkeypatch.setattr(m, "role_connection", role_connection)
    conn.roles = roles
    return conn


@pytest.fixture
def fake_sc(monkeypatch):
    """A stand-in for _base.disco.site_contract recording what the workers call."""
    lib = types.ModuleType("_base.disco.site_contract")
    lib.calls = []
    lib.HELPER_IDS = {"person.helper"}
    lib.TAX_PREFIX = "tax."
    lib.ACTION_SEP = "␟"

    def apply_site_contract(html, url, contract, names, opts):
        lib.calls.append(("apply", url, sorted(names), sorted(opts["firmSignatures"])))
        return {"values": {"person.name": "Jane Doe", "person.phone": ""},
                "firmRelabelled": ["x"]}

    lib.apply_site_contract = apply_site_contract
    lib.apply_address_owner = lambda values, contract: dict(values)
    lib.apply_value_rules = lambda values, contract, url: {**values, "ruled": True}
    lib.looks_not_found = lambda html, values: "404 page" in html
    lib.apply_extra_fields = lambda html, url, contract, names, opts: {"extra.k": "v"}
    lib.collect_site_entity_names = lambda html: {"Big Firm"}
    lib.build_harvest_record = lambda args: {"payload": {"_contract": {"v": 3}}, "args": args}
    lib.filter_taxonomy_rows = lambda rows: rows
    lib.resolve_taxonomy_keys = lambda rows, primary: [r["node_slug"] for r in rows]
    lib.build_static_routes = lambda args: {"routes": {
        "person.bio": [{"kind": "taxonomy", "key": "bio"}, {"kind": "other"}],
        "person.languages": [{"kind": "taxonomy", "key": "langs"}]}}
    lib.is_mergeable_id = lambda sid: sid.endswith("languages")
    lib.is_identity_id = lambda fid: fid.startswith("person.") and fid != "person.helper"
    lib.boilerplate_key = lambda t: t.lower()[:300]

    def build_staging_static(args):
        lib.calls.append(("staging", args))
        vals = args["values"]
        uni = {k: v for k, v in vals.items() if k.startswith("person.")}
        uni["person.credentials"] = [{"name": "CFP"}, {"name": "CPA"}]
        return {"universal": uni, "extras": {}, "sources": {"person.name": "page"}}

    lib.build_staging_static = build_staging_static
    monkeypatch.setitem(sys.modules, "_base.disco.site_contract", lib)
    return lib


CONTRACT = {"version": 3, "learned_at": "2026-10-01", "own_page_key": "own_page",
            "firm_signatures": ["sig"], "primary_subject": "person",
            "taxonomy_fields": {"bio": {}}, "static_routes": {"person.x": [{"kind": "saved"}]}}


def contract_rows(contract=CONTRACT, source_type="brand_site"):
    return [
        ("from disco_site_contract", [{
            "domain": "ex.com", "category_slug": "gcid:agent", "detail_pattern": r"/agent/\d+$",
            "field_floor": 5, "detail_entity_type": "person", "learned_at": "t",
            "extraction": {"site_contract": contract}}]),
        ("from exp_etl_sources", [{"source_type": source_type, "source_id": "src-1",
                                   "min_delay_seconds": 0}]),
        ("from exp_vertical_node_registry", [{"node_slug": "bio"}]),
    ]


# ---- auth / validation ------------------------------------------------------------------------
@pytest.mark.parametrize("path", ["/public/disco-list-worker", "/public/disco-harvest-worker",
                                  "/public/disco-detail-api-worker",
                                  "/public/disco-staging-backfill"])
def test_auth_and_bad_json(client, path, monkeypatch):
    assert client.post(path, json={}).status_code == 401
    assert client.post(path, json={}, headers={"x-disco-worker-key": "no"}).status_code == 401
    r = client.post(path, content=b"{bad", headers=KEY)
    assert r.status_code == 400 and r.json() == {"error": "Invalid JSON body"}
    monkeypatch.delenv("DISCO_WORKER_KEY")
    assert client.post(path, json={}, headers={"x-disco-worker-key": ""}).status_code == 401


def test_detail_workers_require_fields(client):
    for path in ("/public/disco-harvest-worker", "/public/disco-detail-api-worker"):
        r = client.post(path, json={"url": "u"}, headers=KEY)
        assert r.status_code == 400
        assert r.json() == {"error": "url, domain, gcid and crawl_method are required"}
        r = client.post(path, json={"url": "u", "domain": "d", "gcid": "g", "crawl_method": "x"},
                        headers=KEY)
        assert r.json()["error"].startswith("crawl_method must be one of server_crawl")


# ---- list worker ------------------------------------------------------------------------------
def test_list_unit_encoding():
    u = {"s": 0, "k": "combo", "c": {"st": "tx"}, "p": 6}
    enc = disco_list_worker.encode_list_unit("https://ex.com/agents#old", u)
    assert enc.startswith("https://ex.com/agents#list=%7B%22s%22%3A0")
    assert disco_list_worker.decode_list_unit(enc) == u
    assert disco_list_worker.decode_list_unit("https://ex.com/#list=root:2") == {"s": 2,
                                                                                 "k": "root"}
    assert disco_list_worker.decode_list_unit("https://ex.com/#list=%zz") is None
    assert disco_list_worker.decode_list_unit("https://ex.com/") is None


def page(ids):
    return json.dumps({"items": [{"url": f"https://ex.com/agent/{i}"} for i in ids]})


def test_list_worker_dry_run_with_config(client, monkeypatch):
    sent = []

    def oxy(r):
        sent.append(r)
        text = page([1, 2]) if r["url"].endswith("p=1") else page([])
        return {"url": r["url"], "status": 200, "text": text, "blocked": False,
                "truncated": False, "ms": 1}

    monkeypatch.setattr(disco_list_worker, "_oxy_fetch", oxy)
    monkeypatch.setattr(disco_list_worker.time, "sleep", lambda s: None)
    config = {"start_url": "https://ex.com/agents", "sources": [{
        "name": "api", "type": "listing",
        "listing": {"request": {"url": "https://ex.com/api", "params": {"p": "{page}"}}},
        "pagination": {"type": "page"}, "items": {"source": "json", "path": "$.items[*].url"}}]}
    r = client.post("/public/disco-list-worker", headers=KEY, json={
        "dry_run": True, "domain": "EX.com", "gcid": "gcid:agent", "config": config})
    body = r.json()
    assert r.status_code == 200 and body["unit"] == {"s": 0, "k": "root"}
    assert body["reason"] == "no seeds: one list from the first page" and body["dry_run"] is True
    combo = body["next_units"][0]
    assert combo.startswith("https://ex.com/agents#list=")
    r2 = client.post("/public/disco-list-worker", headers=KEY, json={
        "dry_run": True, "domain": "ex.com", "gcid": "gcid:agent", "config": config,
        "url": combo, "frontier_id": 7}).json()
    assert r2["ok"] is True and r2["frontier_id"] == 7
    assert r2["profile_urls"] == ["https://ex.com/agent/1", "https://ex.com/agent/2"]
    assert r2["reason"] == "page 2 returned no items" and r2["next_units"] == []
    assert r2["stats"] == {"requests": 2, "found": 2, "rejected": 0, "errors": []}
    full = client.post("/public/disco-list-worker", headers=KEY, json={
        "dry_run": True, "full": True, "domain": "ex.com", "gcid": "g", "config": config}).json()
    assert full["profile_urls"] == 2 and full["sources"][0]["source"] == "api"


def test_list_worker_saved_route(client, monkeypatch):
    lr = {"start_url": "https://ex.com/dir", "render": False, "sources": [
        {"name": "lc", "type": "link_crawl", "start_urls": ["https://ex.com/dir"]}]}
    contract = {**CONTRACT, "list_route": lr}
    conn = fake_db(monkeypatch, contract_rows(contract), disco_list_worker)
    r = client.post("/public/disco-list-worker", headers=KEY, json={
        "url": "https://ex.com/dir#list=root:0", "domain": "ex.com", "gcid": "gcid:agent"}).json()
    assert r["reason"] == "start pages" and "dry_run" not in r
    assert r["next_units"][0] == disco_list_worker.encode_list_unit(
        "https://ex.com/dir", {"s": 0, "k": "url", "u": "https://ex.com/dir", "d": 0})
    sql, params = conn.log[0]
    assert "order by learned_at desc limit 1" in sql and params == ("ex.com", "gcid:agent")
    assert conn.roles == [("service_role", False)]
    # not a list unit / no route / missing ids
    r = client.post("/public/disco-list-worker", headers=KEY, json={
        "url": "https://ex.com/agent/1", "domain": "ex.com", "gcid": "gcid:agent"}).json()
    assert r["reason"] == "not_list_unit"
    fake_db(monkeypatch, [], disco_list_worker)
    r = client.post("/public/disco-list-worker", headers=KEY, json={
        "url": "x", "domain": "ex.com", "gcid": "g"}).json()
    assert r == {"ok": False, "frontier_id": None, "url": "x", "reason": "no_list_route"}
    r = client.post("/public/disco-list-worker", headers=KEY, json={"domain": "ex.com"})
    assert r.status_code == 400 and r.json()["reason"] == "domain and gcid are required"


# ---- harvest worker ---------------------------------------------------------------------------
def scrape_ok(content="<html>Jane</html>", status=200):
    def scrape(req):
        return {"ok": True, "content": content, "status_code": status,
                "resolved_url": req["url"] + "?r=1"}
    return scrape


def harvest_body(url="https://ex.com/agent/12"):
    return {"url": url, "domain": "ex.com", "gcid": "gcid:agent", "crawl_method": "server_crawl",
            "frontier_id": 3}


def test_harvest_worker_success(client, monkeypatch, fake_sc):
    conn = fake_db(monkeypatch, contract_rows())
    monkeypatch.setattr(disco_harvest_worker.webscraper, "scrape_website", scrape_ok())
    monkeypatch.setattr(disco_harvest_worker.webscraper, "looks_blocked", lambda s, c: False)
    import _base.disco.webscraper as ws
    monkeypatch.setattr(ws, "scrape_website", scrape_ok("<html>home</html>"))
    r = client.post("/public/disco-harvest-worker", headers=KEY, json=harvest_body()).json()
    assert r["ok"] is True and r["frontier_id"] == 3 and r["contract_version"] == 3
    args = r["record"]["args"]
    assert args["values"]["tax.own_page"] == "https://ex.com/agent/12"  # brand site own page
    assert args["firmRelabelled"] == ["x"] and args["extras"] == {"extra.k": "v"}
    # saved routes + generic single-value taxonomy routes (lists keep the contract's own)
    assert args["contract"]["static_routes"] == {
        "person.x": [{"kind": "saved"}], "person.bio": [{"kind": "taxonomy", "key": "bio"}]}
    assert fake_sc.calls[0] == ("apply", "https://ex.com/agent/12", ["Big Firm"], ["sig"])
    assert any("exp_vertical_node_registry" in s for s, _ in conn.log)


def test_harvest_worker_reasons(client, monkeypatch, fake_sc):
    fake_db(monkeypatch, contract_rows())
    monkeypatch.setattr(disco_harvest_worker.webscraper, "scrape_website", scrape_ok())
    r = client.post("/public/disco-harvest-worker", headers=KEY,
                    json=harvest_body("https://ex.com/blog/x")).json()
    assert r == {"ok": False, "frontier_id": 3, "url": "https://ex.com/blog/x",
                 "reason": "not_detail_page"}
    monkeypatch.setattr(disco_harvest_worker.webscraper, "scrape_website",
                        lambda req: {"ok": False, "content": "Access denied", "status_code": 403,
                                     "error": "blocked"})
    monkeypatch.setattr(disco_harvest_worker.webscraper, "looks_blocked", lambda s, c: True)
    r = client.post("/public/disco-harvest-worker", headers=KEY, json=harvest_body()).json()
    assert r["reason"] == "blocked" and r["status_code"] == 403
    monkeypatch.setattr(disco_harvest_worker.webscraper, "looks_blocked", lambda s, c: False)
    monkeypatch.setattr(disco_harvest_worker.webscraper, "scrape_website",
                        scrape_ok("<p>404 page</p>"))
    r = client.post("/public/disco-harvest-worker", headers=KEY, json=harvest_body()).json()
    assert r["reason"] == "not_detail_page" and r["detail"] == "not_found"
    disco_harvest_worker._rows.clear()
    fake_db(monkeypatch, contract_rows({**CONTRACT, "version": 2}))
    r = client.post("/public/disco-harvest-worker", headers=KEY, json=harvest_body()).json()
    assert r["reason"] == "no_contract"


def test_harvest_worker_error_is_json_500(client, monkeypatch, fake_sc):
    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(cr, "load_contract_row", boom)
    r = client.post("/public/disco-harvest-worker", headers=KEY, json=harvest_body())
    assert r.status_code == 500 and r.json()["reason"] == "error"
    assert "db down" in r.json()["error"]


# ---- detail-api worker ------------------------------------------------------------------------
def test_detail_api_worker_api_mode_dry_run(client, monkeypatch, fake_sc):
    contract = {**CONTRACT, "site_entity_names": ["Big Firm"], "detail_route": {
        "record_source": "api", "api": {"url": "x"}, "json_fields": {"person.name": "$.n"}}}
    monkeypatch.setattr(disco_detail_api_worker.detail_api, "fetch_detail_for",
                        lambda api, url, t: {"json": {"n": "Jane"}, "why": "ok",
                                             "api_url": "https://ex.com/api/12"})
    monkeypatch.setattr(disco_detail_api_worker.detail_api, "json_values",
                        lambda js, fields: {"person.name": js["n"], "person.title": ""})

    def no_scrape(req):
        raise AssertionError("api mode never fetches the page")

    monkeypatch.setattr(disco_detail_api_worker.webscraper, "scrape_website", no_scrape)
    r = client.post("/public/disco-detail-api-worker", headers=KEY, json={
        **harvest_body(), "dry_run": True, "contract": contract, "detail_pattern": "/agent/",
        "field_floor": "4"}).json()
    assert r["ok"] is True and r["detail_source"] == "api" and r["status_code"] == 200
    assert r["api_url"] == "https://ex.com/api/12" and r["dry_run"] is True
    assert r["api_values"] == {"person.name": "Jane", "person.title": ""}
    assert r["page_fields"] == 0
    assert r["record"]["payload"]["_contract"] == {"v": 3, "detail_source": "api"}
    args = r["record"]["args"]
    assert args["values"] == {"person.name": "Jane", "ruled": True}
    assert args["fieldFloor"] == 4


def test_detail_api_worker_page_fallback(client, monkeypatch, fake_sc):
    contract = {**CONTRACT, "detail_route": {
        "record_source": "api+page", "api": {"url": "x"}, "json_fields": {"person.name": "$.n"}}}
    fake_db(monkeypatch, contract_rows(contract, source_type="directory"))
    monkeypatch.setattr(disco_detail_api_worker.detail_api, "fetch_detail_for",
                        lambda api, url, t: {"why": "api call failed (500)", "api_url": "u"})
    monkeypatch.setattr(disco_detail_api_worker.webscraper, "scrape_website", scrape_ok())
    monkeypatch.setattr(disco_detail_api_worker.webscraper, "looks_blocked", lambda s, c: False)
    import _base.disco.webscraper as ws
    monkeypatch.setattr(ws, "scrape_website", scrape_ok("<html>home</html>"))
    r = client.post("/public/disco-detail-api-worker", headers=KEY, json=harvest_body()).json()
    assert r["detail_source"] == "page_fallback" and "dry_run" not in r
    assert r["resolved_url"] == "https://ex.com/agent/12?r=1"
    assert r["record"]["payload"]["_contract"]["api_issue"] == "api call failed (500)"
    assert "tax.own_page" not in r["record"]["args"]["values"]


# ---- staging backfill -------------------------------------------------------------------------
def test_staging_backfill_dry_run_and_write(client, monkeypatch, fake_sc):
    rows = [{
        "stage_id": "s1", "source_id": "src-1", "gcid": "gcid:agent", "entity_type": "person",
        "detail_url": "https://ex.com/agent/1", "resolution_status": "staged",
        "payload": {"bio": "Hello", "_subjects": {"bio": "person"}, "_extra": {"a": 1, "b": 2},
                    "_static_sources": {"x": 1}},
        "identity_candidates": {"url": "u", "universal": {
            "person.name": "Jane", "person.actions": [{"label": "Call", "url": "tel:1"}],
            "person.credentials": [{"name": "CFP", "number": "9"}], "person.helper": "h",
            "other": "x"}},
    }]
    canned = [*contract_rows(), ("from exp_etl_staging", rows)]
    conn = fake_db(monkeypatch, canned, disco_staging_backfill)
    body = {"domain": "ex.com", "gcid": "gcid:agent", "after_stage_id": "s0", "limit": 1,
            "routes": {"person.y": [{"kind": "body"}]}, "boilerplate_texts": {"person.bio": ["X"]}}
    r = client.post("/public/disco-staging-backfill", headers=KEY, json=body).json()
    assert r["ok"] is True and r["dry_run"] is True and r["written"] == 0 and r["done"] is False
    assert r["rows"] == 1 and r["statuses"] == {"staged": 1} and r["last_stage_id"] == "s1"
    assert r["extras_removed"] == 2
    assert r["routes_used"] == ["person.bio", "person.languages", "person.x", "person.y"]
    st_args = next(c[1] for c in fake_sc.calls if c[0] == "staging")
    assert st_args["values"]["person.actions"] == ["Call␟tel:1"]
    assert st_args["values"]["tax.bio"] == "Hello" and st_args["values"]["person.helper"] == "h"
    assert "other" not in st_args["values"]
    assert st_args["contract"]["boilerplate_values"] == {"person.bio": ["x"]}
    # stored credentials kept, rebuilt ones added by name
    assert r["examples"][0]["after"]["person.credentials"] == [
        {"name": "CFP", "number": "9"}, {"name": "CPA"}]
    assert r["changed"]["person.credentials"] == 1 and "person.name" not in r["changed"]
    sql, params = next(x for x in conn.log if "from exp_etl_staging" in x[0])
    assert "stage_id > %s" in sql and params == ["src-1", "gcid:agent", "s0", 1]
    r = client.post("/public/disco-staging-backfill", headers=KEY,
                    json={**body, "dry_run": False}).json()
    assert r["written"] == 1
    sql, seq = conn.log[-1]
    assert sql.startswith("insert into exp_etl_staging") and "on conflict (stage_id)" in sql
    payload = seq[0][4].obj
    assert "_extra" not in payload and payload["_static_sources"] == {"person.name": "page"}
    assert ("service_role", True) in conn.roles


def test_staging_backfill_no_contract_and_required(client, monkeypatch, fake_sc):
    fake_db(monkeypatch, [], disco_staging_backfill)
    r = client.post("/public/disco-staging-backfill", headers=KEY,
                    json={"domain": "ex.com", "gcid": "g"})
    assert r.json() == {"ok": False, "reason": "no_contract"}
    r = client.post("/public/disco-staging-backfill", headers=KEY, json={"gcid": "g"})
    assert r.status_code == 400 and r.json() == {"error": "domain and gcid are required"}


# ---- webscraper wiring ------------------------------------------------------------------------
def test_webscraper_worker_route(client, monkeypatch):
    seen = {}

    def handle(raw, key, method):
        seen.update(raw=raw, key=key, method=method)
        return 502, {"ok": False}

    monkeypatch.setattr(disco_webscraper_worker, "handle_webscraper_request", handle)
    r = client.post("/public/disco-webscraper-worker", content=b'{"url":"x"}', headers=KEY)
    assert r.status_code == 502 and r.json() == {"ok": False}
    assert seen == {"raw": b'{"url":"x"}', "key": "k", "method": "POST"}
