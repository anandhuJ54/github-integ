"""Port of tests/nora-organize.test.ts.

The organize step leans on the shared disco library (`_base.disco.*`, ported in parallel). The
pure arrangement logic here is tested against a small fake of that library; the fixture-page
assertions from the legacy test run against the real library once it exists (skipped until then).
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import pytest
from surfaces.nora_os import disco
from surfaces.nora_os.nora.organize import costs, handlers, parse, web_sweep
from surfaces.nora_os.nora.organize.costs import scrape_cost, sum_costs
from surfaces.nora_os.nora.organize.fetch_site import hop2, owned_urls
from surfaces.nora_os.nora.organize.gbp import gbp_lookup, to_gbp_candidate
from surfaces.nora_os.nora.organize.handlers import organize_handlers
from surfaces.nora_os.nora.organize.parse import (
    absolute_url,
    parse_candidate_facts,
    registrable_domain,
)
from surfaces.nora_os.nora.organize.web_sweep import (
    build_candidates,
    dedupe_key,
    organic_rows,
    sweep_queries,
)
from surfaces.nora_os.runner import (
    CapabilityHandler,
    HandlerContext,
    RunEntity,
    dispatch_capabilities,
)

FIX = Path(__file__).resolve().parent / "fixtures" / "organize"
SF_URL = "https://www.statefarm.com/agent/us/ks/lenexa/greg-aldridge-1mky83ky000"


def html(name: str) -> str:
    return (FIX / name).read_text()


# ── a small fake of the disco library (shapes as the TS returned them) ─────

_LD = re.compile(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", re.DOTALL | re.IGNORECASE)


def _blocks(h: str) -> list:
    out = []
    for m in _LD.finditer(h or ""):
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            continue
    return out


def _flatten(v, out):
    if isinstance(v, list):
        for x in v:
            _flatten(x, out)
    elif isinstance(v, dict):
        if "@type" in v:
            out.append(v)
        for x in v.values():
            if isinstance(x, (dict, list)):
                _flatten(x, out)


def _objs(h, page):
    out: list = []
    _flatten(_blocks(h), out)
    return out


def _same_as(blocks):
    out = []

    def walk(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if k == "sameAs":
                    out.extend(s for s in (x if isinstance(x, list) else [x]) if isinstance(s, str))
                else:
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(blocks)
    return out


def _format_url(raw, page):
    u = urlsplit(urljoin(page, raw))
    q = urlencode([(k, v) for k, v in parse_qsl(u.query) if not k.startswith("utm_")], safe=":")
    return urlunsplit((u.scheme, u.netloc, u.path, q, u.fragment))


def _e164(s):
    d = re.sub(r"\D", "", str(s or ""))
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    return None


def _address(raw):
    if isinstance(raw, dict):
        parts = [raw.get(k) for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode")]
        keep = {k: raw[k] for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode") if raw.get(k)}
        return {**keep, "text": ", ".join(p for p in parts if p)}
    if isinstance(raw, str) and raw.strip():
        return {"text": raw.strip()}
    return None


def _credential(text, hint):
    m = re.search(r"(\d{6,})", text)
    return {"type": hint or "license", "number": m.group(1)} if m else None


@pytest.fixture
def fake_disco(monkeypatch):
    fns = {
        "to_e164": _e164,
        "to_place_id": lambda url: (re.search(r"place_?id[:=]([A-Za-z0-9_-]+)", url) or [None, None])[1],
        "to_credential": _credential,
        "format_url": _format_url,
        "collect_all_same_as_urls": _same_as,
        "collect_all_credential_texts": lambda objs: [],
        "entity_type_re": lambda: re.compile(r"person|organization|localbusiness|insurance|restaurant", re.IGNORECASE),
        "extract_json_ld_blocks": _blocks,
        "json_ld_types": lambda o: [t for t in ([o.get("@type")] if isinstance(o.get("@type"), str)
                                                else o.get("@type") or []) if isinstance(t, str)],
        "normalize_address": _address,
        "validate_value": lambda t, raw, page: raw,
        "parse_document_objs": _objs,
        "same_as_platform_rules": lambda: [
            ("Facebook", re.compile(r"facebook\.com", re.IGNORECASE)),
            ("Instagram", re.compile(r"instagram\.com", re.IGNORECASE)),
            ("X / Twitter", re.compile(r"(twitter|x)\.com", re.IGNORECASE)),
            ("Yelp", re.compile(r"yelp\.com", re.IGNORECASE)),
        ],
        "classify_credential": lambda slug, texts: {"recognized": False, "value": None, "label": None},
        "looks_blocked": lambda status, content: not content,
    }
    for name, fn in fns.items():
        monkeypatch.setattr(disco, name, fn)
    return fns


def test_state_farm_page_arrangement(fake_disco):
    c = parse_candidate_facts(html("statefarm-agent.html"), source_url=SF_URL, fetched_at="2026-10-11T00:00:00.000Z")
    assert c["source_url"] == SF_URL
    assert c["fetched_at"] == "2026-10-11T00:00:00.000Z"
    assert c["blocked"] is False
    assert "Greg Aldridge" in c["nap"]["name"]
    assert c["nap"]["phone"] == "+19134926080"
    assert c["nap"]["address"]["addressLocality"] == "Lenexa"
    assert c["nap"]["source"] == {"name": "jsonld", "address": "jsonld", "phone": "jsonld"}
    assert c["place_id"] == "ChIJXXLAuKaUwIcR2Lc1I2HRjEg"
    by_url = {s["url"]: s["platform"] for s in c["sameAs"]}
    assert by_url["https://www.facebook.com/247375755421060"] == "Facebook"
    assert by_url["https://www.gregaldridgesf.com/"] is None
    # owned: the agent's own site; NOT statefarm.com sibling subdomains (hosted profile)
    assert c["links"]["ownedCandidates"] == [{"url": "https://www.gregaldridgesf.com/", "reason": "jsonld_sameAs"}]
    assert len(c["links"]["internal"]) > 5
    assert all(urlsplit(u).netloc == "www.statefarm.com" for u in c["links"]["internal"])
    lic = next(x for x in c["credentials"] if "16956419" in x["text"])
    assert lic["via"] == "page_text"
    assert lic["parsed"]["number"] == "16956419"
    assert c["text"][0] == {"kind": "title", "text": "Greg Aldridge - State Farm Insurance Agent in Lenexa, KS"}
    assert any(t["kind"] == "heading" and t["text"] == "Greg Aldridge" for t in c["text"])


def test_restaurant_page_arrangement(fake_disco):
    c = parse_candidate_facts(
        html("mexican-restaurant.html"),
        source_url="https://www.lupetortilla.com/",
        resolved_url="https://tex-mex.com/",
    )
    assert c["resolved_url"] == "https://tex-mex.com/"
    assert c["nap"]["name"] == "Lupe Tortilla"
    assert c["nap"]["source"]["name"] == "jsonld"
    platforms = {s["platform"] for s in c["sameAs"]}
    assert {"Facebook", "Instagram", "X / Twitter", "Yelp"} <= platforms
    assert all(s["via"] == "page_link" for s in c["sameAs"])
    owned = {o["url"]: o["reason"] for o in c["links"]["ownedCandidates"]}
    assert owned["https://order.lupetortilla.com/"] == "brand_domain_match"
    assert owned["https://lupetortilla.myguestaccount.com/en-us/guest/card-sales"] == "name_domain_match"
    assert c["credentials"] == []
    assert len(c["text"]) > 5


_REAL = importlib.util.find_spec("_base.disco.site_contract") is not None


@pytest.mark.skipif(not _REAL, reason="_base.disco.site_contract not ported yet")
def test_state_farm_page_with_the_real_disco_library():
    """The legacy assertions verbatim, against the shared library (parity check)."""
    c = parse_candidate_facts(html("statefarm-agent.html"), source_url=SF_URL, fetched_at="2026-10-11T00:00:00.000Z")
    assert "Greg Aldridge" in c["nap"]["name"]
    assert c["nap"]["phone"] == "+19134926080"
    assert {k: c["nap"]["address"][k] for k in ("streetAddress", "addressLocality", "addressRegion")} == {
        "streetAddress": "13501 W 87th St Pkwy",
        "addressLocality": "Lenexa",
        "addressRegion": "KS",
    }
    assert any("InsuranceAgency" in json.dumps(o.get("@type")) for o in c["jsonld"])
    assert c["place_id"] == "ChIJXXLAuKaUwIcR2Lc1I2HRjEg"
    assert c["links"]["ownedCandidates"] == [{"url": "https://www.gregaldridgesf.com/", "reason": "jsonld_sameAs"}]
    lic = next(x for x in c["credentials"] if "16956419" in x["text"])
    assert lic["parsed"]["type"] == "license" and lic["parsed"]["number"] == "16956419"


def test_url_helpers(fake_disco):
    assert registrable_domain("order.lupetortilla.com") == "lupetortilla.com"
    assert registrable_domain("shop.example.co.uk") == "example.co.uk"
    assert absolute_url("www.gregaldridgesf.com", SF_URL) == "https://www.gregaldridgesf.com/"
    assert absolute_url("tel:9134926080", SF_URL) is None
    assert absolute_url("/agent?utm_source=x#top", SF_URL) == "https://www.statefarm.com/agent"
    assert owned_urls(["https://a.com", {"url": "https://b.com", "reason": "jsonld_sameAs"}, "nope"]) == [
        "https://a.com",
        "https://b.com",
    ]
    assert parse.host_of("https://WWW.Example.com:443/x") == "example.com"
    assert parse.host_of("not a url") is None


def test_web_sweep_queries_and_dedupe(fake_disco):
    q = sweep_queries(category_name="Mexican restaurant", entity_name="Lupe Tortilla", geo="Houston, TX")
    assert q == ['"Lupe Tortilla" Houston, TX', "Lupe Tortilla Mexican restaurant Houston, TX"]
    body = {
        "results": [
            {
                "content": {
                    "results": {
                        "organic": [
                            {"pos": 1, "url": "https://tex-mex.com/", "title": "Lupe Tortilla", "desc": "Tex Mex in Houston"},
                            {"pos": 2, "url": "https://www.yelp.com/biz/lupe-tortilla-houston",
                             "title": "Lupe Tortilla - Houston - Yelp", "desc": "Call (713) 555-0100"},
                        ]
                    }
                }
            }
        ]
    }
    rows = organic_rows(body)
    c = build_candidates(
        [
            {"query": q[0], "rows": rows},
            {"query": q[1], "rows": [{"pos": 1, "url": "https://www.yelp.com/biz/lupe-tortilla-houston/", "title": "dup"}]},
        ],
        {
            "categoryName": "Mexican restaurant",
            "entityName": "Lupe Tortilla",
            "geo": "Houston, TX",
            "siteUrl": "https://tex-mex.com/",
            "phone": "713-555-0100",
            "knownUrls": ["https://tex-mex.com"],
        },
    )
    assert len(c) == 3
    h0 = c[0]["hints"]
    assert (h0["same_site"], h0["already_known"], h0["name_match"], h0["geo_match"], h0["duplicate_of"]) == (
        True, True, 1, True, None,
    )
    assert (c[1]["hints"]["platform"], c[1]["hints"]["phone_match"], c[1]["hints"]["same_site"]) == ("Yelp", True, False)
    assert c[2]["hints"]["duplicate_of"] == 1
    assert dedupe_key("https://WWW.Yelp.com/biz/x/") == "yelp.com/biz/x"
    assert organic_rows(None) == [] and organic_rows({"results": []}) == []


def test_web_sweep_live_path(fake_disco, monkeypatch):
    monkeypatch.setenv("OXYLABS_USERNAME", "u")
    monkeypatch.setenv("OXYLABS_PASSWORD", "p")
    sent = []

    def raw(payload, timeout_ms):
        sent.append((payload, timeout_ms))
        return {"httpStatus": 200, "body": {"results": [{"content": {"results": {"organic": [
            {"pos": 1, "url": "https://a.com/x", "title": "Lupe", "desc": ""}]}}}]}}

    monkeypatch.setattr(disco, "oxylabs_raw", raw)
    r = web_sweep.web_sweep({"categoryName": None, "entityName": "Lupe", "geo": None})
    assert r["ok"] is True and r["status"] == "live"
    assert sent == [({"source": "google_search", "query": '"Lupe"', "parse": True, "limit": 10}, 12_000)]
    assert r["data"]["cost"] == {"provider": "oxylabs", "requests": 1, "est_cost_usd": 0.0018}
    monkeypatch.setattr(disco, "oxylabs_raw", lambda p, t: {"httpStatus": 500, "body": None})
    with pytest.raises(RuntimeError, match="Oxylabs google_search HTTP 500"):
        web_sweep.web_sweep({"categoryName": None, "entityName": "Lupe", "geo": None})


def test_gbp_candidate_hints(fake_disco):
    g = to_gbp_candidate(
        {"id": "ChIJX", "displayName": {"text": "Greg Aldridge - State Farm"}, "internationalPhoneNumber": "+1 913-492-6080"},
        {"name": "Greg Aldridge", "phone": "(913) 492-6080", "placeId": "ChIJX"},
    )
    assert g["hints"] == {"name_match": 1, "phone_match": True, "place_id_match": True}
    assert g["phone"] == "+19134926080"


def test_stubs_return_not_configured():
    r = gbp_lookup({"name": "Greg Aldridge"})
    assert r["ok"] is False
    assert r["status"] == "not_configured"
    assert r["integration"] == "google_places"
    assert r["missing"] == ["GOOGLE_PLACES_API_KEY"]


def test_costs(monkeypatch):
    monkeypatch.delenv("FORCE_PROXY", raising=False)
    one = scrape_cost({"crawl_method": "direct", "rendered": False, "attempted_render_fallback": False, "oxylabs": {}, "ok": True})
    assert (one["provider"], one["requests"]) == ("oxylabs", 1)
    two = scrape_cost({"crawl_method": "direct", "rendered": True, "attempted_render_fallback": True, "oxylabs": {}, "ok": True})
    assert (two["provider"], two["requests"]) == ("oxylabs", 2)
    monkeypatch.setenv("FORCE_PROXY", "false")
    direct = scrape_cost({"crawl_method": "direct", "rendered": False, "attempted_render_fallback": False, "ok": True})
    assert direct == {"provider": "direct", "requests": 1, "est_cost_usd": 0}
    # an empty oxylabs block is truthy in JS — still a proxied fetch
    assert scrape_cost({"crawl_method": "direct", "rendered": False, "attempted_render_fallback": False,
                        "oxylabs": {}, "ok": True})["provider"] == "oxylabs"
    s = sum_costs([
        {"provider": "oxylabs", "requests": 1, "est_cost_usd": 0.0015},
        {"provider": "oxylabs", "requests": 2, "est_cost_usd": 0.0045},
    ])
    assert s["lines"] == [{"provider": "oxylabs", "requests": 3, "est_cost_usd": 0.006}]
    assert s["total_est_cost_usd"] == 0.006
    assert costs.proxy_forced() is False


def test_handlers_registered_read_only_and_run_in_a_dry_run():
    h = organize_handlers(None)
    assert sorted(h) == ["geocode", "page_fetch", "serp_fetch", "source_crawl"]
    assert all(x.read_only for x in h.values())
    caps = [{"key": "geocode", "status": "draft", "entitlement_required": None, "side_effects": [], "dry_run": True}]
    d = dispatch_capabilities(
        mode="dry_run", capability_keys=["geocode"], capabilities=caps, handlers=h,
        entity=RunEntity(ref="x", type=None, name="Greg Aldridge"), inputs={}, trace=lambda *_: None,
    )
    assert d["error"] is None
    assert d["steps"][0]["ran"] is True
    out = d["outputs"]["geocode"]
    assert (out["ok"], out["status"]) == (False, "not_configured")
    assert out["telemetry"] == {"mode": "dry_run", "total_est_cost_usd": 0, "lines": []}
    d2 = dispatch_capabilities(
        mode="dry_run", capability_keys=["geocode"], capabilities=[{**caps[0], "side_effects": ["writes_graph"]}],
        handlers=h, entity=None, inputs={}, trace=lambda *_: None,
    )
    assert d2["steps"][0]["ran"] is False


def test_serp_fetch_without_oxylabs_creds(monkeypatch):
    monkeypatch.delenv("OXYLABS_USERNAME", raising=False)
    monkeypatch.delenv("OXYLABS_PASSWORD", raising=False)
    h = organize_handlers(None)
    r = h["serp_fetch"].run(
        HandlerContext(
            mode="dry_run",
            entity=RunEntity(ref="x", type=None, name="Lupe Tortilla"),
            inputs={"category_name": "Mexican restaurant", "geo": "Houston, TX"},
            prior={},
        )
    )
    out = r["outputs"]
    assert (out["ok"], out["status"], out["integration"]) == (False, "not_configured", "oxylabs")


def test_page_fetch_and_source_crawl(fake_disco, monkeypatch):
    fetched = []

    def scrape(req):
        fetched.append(req)
        return {"ok": True, "url": req["url"], "resolved_url": None, "crawl_method": req["crawl_method"],
                "rendered": False, "attempted_render_fallback": False, "status_code": 200,
                "content": html("statefarm-agent.html"), "oxylabs": {"job_id": "j"}}

    monkeypatch.setattr(disco, "scrape_website", scrape)
    h = organize_handlers(None)
    ctx = HandlerContext(mode="dry_run", entity=None, inputs={"url": SF_URL, "crawl_method": "needs_proxy"})
    pf = h["page_fetch"].run(ctx)["outputs"]
    assert fetched[0] == {"url": SF_URL, "crawl_method": "needs_proxy"}
    assert pf["ok"] is True and pf["facts"]["source_url"] == SF_URL
    assert pf["telemetry"]["lines"] == [{"provider": "oxylabs", "requests": 1, "est_cost_usd": 0.0015}]
    with pytest.raises(ValueError, match="page_fetch needs inputs.url"):
        h["page_fetch"].run(HandlerContext(mode="dry_run", entity=None, inputs={}))
    sc = h["source_crawl"].run(HandlerContext(mode="dry_run", entity=None, inputs={}, prior={"page_fetch": pf}))
    out = sc["outputs"]
    assert out["followed"] == 1 and out["skipped"] == []
    assert out["pages"][0]["url"] == "https://www.gregaldridgesf.com/"
    assert "cost" not in out["pages"][0]


def test_hop2_caps_and_isolates_failures(monkeypatch, fake_disco):
    def scrape(req):
        if "bad" in req["url"]:
            raise RuntimeError("fetch blew up")
        return {"ok": False, "url": req["url"], "resolved_url": None, "crawl_method": "direct",
                "rendered": False, "attempted_render_fallback": False, "status_code": 404, "content": None}

    monkeypatch.setattr(disco, "scrape_website", scrape)
    urls = [f"https://s{i}.com/" for i in range(5)] + ["https://bad.com/"]
    r = hop2(["https://bad.com/", *urls])
    assert [p["url"] for p in r["pages"]] == ["https://bad.com/", *urls[:3]]
    assert r["pages"][0]["error"] == "fetch blew up"
    assert r["pages"][0]["cost"] == {"provider": "oxylabs", "requests": 0, "est_cost_usd": 0}
    assert r["skipped"] == urls[3:5]


def test_serp_category_name_comes_from_gbp_categories(monkeypatch):
    from surfaces.nora_os.testing import FakeDb

    seen = {}
    monkeypatch.setattr(handlers, "web_sweep", lambda i: seen.update(i) or {"ok": False, "status": "not_configured"})
    db = FakeDb([("from gbp_categories", [{"display_name": " Insurance agency "}])])
    organize_handlers(db)["serp_fetch"].run(
        HandlerContext(mode="live", entity=RunEntity(ref="x", type=None, name="Greg", gcid="gcid:insurance_agency",
                                                     market="Lenexa, KS"), inputs={}, prior={})
    )
    assert seen["categoryName"] == "Insurance agency"
    assert seen["geo"] == "Lenexa, KS"
    assert db.calls[0][1] == ("gcid:insurance_agency",)


def test_capability_handler_type():
    assert isinstance(organize_handlers(None)["geocode"], CapabilityHandler)
