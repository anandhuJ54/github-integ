"""map_site end to end on a fake site: real site-contract library, faked fetch / AI / DB."""
from __future__ import annotations

import json

import pytest

from etl.disco import ai_worker_map as mp
from etl.disco import ai_worker_util as u

NAMES = ["jane-doe", "john-smith", "ann-lee", "bob-ray", "cara-moss", "dan-oak"]
PLACES = [("Austin", "TX"), ("Denver", "CO"), ("Boston", "MA"), ("Miami", "FL"),
          ("Reno", "NV"), ("Tulsa", "OK")]


def _profile(slug: str) -> str:
    name = slug.replace("-", " ").title()
    city, st = PLACES[NAMES.index(slug)]
    phone = f"+1 512 555 01{NAMES.index(slug):02d}"
    ld = {"@context": "https://schema.org", "@type": "Person", "name": name,
          "url": f"https://ex.com/agents/{slug}", "jobTitle": "Real Estate Agent",
          "telephone": phone, "email": f"{slug}@ex.com",
          "address": {"@type": "PostalAddress", "streetAddress": "1 Main St",
                      "addressLocality": city, "addressRegion": st, "postalCode": "78701"}}
    return (f"<html><head><title>{name}</title><script type=\"application/ld+json\">"
            f"{json.dumps(ld)}</script></head><body><h1>{name}</h1>"
            f"<p class=\"bio\">{name} helps buyers and sellers in {city}.</p>"
            f"<div class=\"office\"><span class=\"city\">{city}</span>, "
            f"<span class=\"st\">{st}</span></div>"
            f"<a href=\"tel:+15125550100\">Call</a></body></html>")


SITE = {
    "https://ex.com/": '<html><body><a href="/agents">Our agents</a><a href="/about">About</a>'
                       "</body></html>",
    "https://ex.com/agents": "<html><body>" + "".join(
        f'<a href="/agents/{s}">{s}</a>' for s in NAMES) + "</body></html>",
    **{f"https://ex.com/agents/{s}": _profile(s) for s in NAMES},
}


class FakeDb:
    def __init__(self):
        self.sql: list[str] = []

    def _hit(self, sql: str):
        self.sql.append(sql)
        if "from gbp_categories" in sql:
            return [{"display_name": "Real estate agent", "entity_type": "both"}]
        return []

    def rows(self, sql, params=()):
        return self._hit(sql)

    def rows_or_none(self, sql, params=()):
        return self._hit(sql)

    def row(self, sql, params=()):
        rs = self._hit(sql)
        return rs[0] if rs else None

    def row_or_none(self, sql, params=()):
        return self.row(sql, params)


@pytest.fixture
def site(monkeypatch):
    fetched: list[str] = []
    asked: list[str] = []

    def fetch(url, method="server_crawl"):
        fetched.append(url)
        body = SITE.get(url)
        return {"ok": body is not None, "status": 200 if body else 404, "body": body or "",
                "url": url}

    def claude(api_key, model, prompt, tool, max_tokens=4096, temperature=None):
        asked.append(tool["name"])
        return {
            "return_entity_page": {"is_entity_page": True, "fits_category": True,
                                   "entity_kind": "person", "reason": "one agent"},
            "return_site_contract": {"roster_pattern": "x", "detail_pattern": "^bad",
                                     "field_floor": 6, "extraction": {"list_source": "jsonld"}},
            "return_locator_rules": {"rules": [{"id": "person.bio", "strategy": "css",
                                                "css": "p.bio"},
                                               {"id": "location.city", "strategy": "css",
                                                "css": ".office .city"},
                                               {"id": "location.state", "strategy": "css",
                                                "css": ".office .st"}], "unkeyed": []},
        }.get(tool["name"], {})

    db = FakeDb()
    monkeypatch.setattr(u, "fetch_page", fetch)
    monkeypatch.setattr(u, "call_claude", claude)
    monkeypatch.setattr(u, "db", lambda: db)
    return {"fetched": fetched, "asked": asked, "db": db}


def test_map_site_learns_contract(site):
    progress: dict = {}
    c = mp.map_site("k", "m", "gcid:real_estate_agent", "ex.com", None, "server_crawl", None,
                    {"progress": progress})
    assert c["sample_detail_url"].startswith("https://ex.com/agents/")
    assert c["sample_roster_url"] == "https://ex.com/agents"
    # the profile rule is code-built from the directory links, not the AI's "^bad"
    assert c["detail_pattern"] == "^https?://ex\\.com/agents/[a-z0-9\\-]+/?$"
    assert c["site_contract_summary"]["samples"] == 6
    assert c["route_report"]["profile_rule"]["source"] == "code"
    sc = c["extraction"]["site_contract"]
    assert sc["must_have"]["ok"] is True
    assert c["extraction"]["list_source"] == "jsonld"
    assert c["field_floor"] >= 5
    assert c["detail_entity_type"] == "professional"
    assert c["extraction"]["best_route"]["route"] == "listing"
    assert c["roster_pattern"] == "^(?:https?://ex\\.com/agents/?(?:[?#].*)?)$"
    assert progress["step"] == "report"
    assert "return_entity_page" in site["asked"] and "return_site_contract" in site["asked"]
    json.dumps(u.to_json(c))  # storable


def test_map_site_homepage_failure(site, monkeypatch):
    monkeypatch.setattr(u, "fetch_page", lambda url, m="x": {
        "ok": False, "status": 503, "body": "", "url": url, "networkError": None})
    with pytest.raises(RuntimeError, match=r"homepage fetch failed \(503\)"):
        mp.map_site("k", "m", "c", "ex.com", None)


def test_map_site_no_detail_raises_with_diagnostics(site, monkeypatch):
    monkeypatch.setattr(u, "call_claude", lambda *a, **k: {
        "is_entity_page": False, "reason": "a directory page"})
    with pytest.raises(u.MapSiteError) as ei:
        mp.map_site("k", "m", "c", "ex.com", None)
    d = ei.value.diagnostics
    assert str(ei.value).startswith("no fetchable entity detail page found from "
                                    "https://ex.com/agents (6 candidates; tried 6: ")
    assert d["roster_url"] == "https://ex.com/agents"
    assert len(d["tried"]) == 6
