"""Tests for the site-contract port (cases derived from the TS behaviour)."""

from __future__ import annotations

import json

import pytest

import _base.disco.site_contract as sc
from _base.disco.site_contract import apply as apply_mod
from _base.disco.site_contract._js import JsURL, js_number, json_stringify, num_str


# ---------------------------------------------------------------------------
# JS compatibility
# ---------------------------------------------------------------------------
def test_js_url_resolution_and_normalisation():
    u = JsURL("../b/./c?x=1#f", "https://Example.COM:443/a/d/e")
    assert u.href == "https://example.com/a/b/c?x=1#f"
    assert u.host == "example.com" and u.pathname == "/a/b/c"
    assert JsURL("http://x.com").href == "http://x.com/"
    assert JsURL("//cdn.x.com/v.mp4", "https://a.com/p").href == "https://cdn.x.com/v.mp4"
    assert JsURL("a b", "https://a.com/").href == "https://a.com/a%20b"
    with pytest.raises(ValueError):
        JsURL("/rel")  # no base
    with pytest.raises(ValueError):
        JsURL("https://a.com/", "")  # an empty base is invalid, as in JS
    m = JsURL("mailto:a@b.com?subject=x")
    assert m.protocol == "mailto:" and not m.special


def test_js_number_and_strings():
    assert js_number("") == 0 and js_number(" 12 ") == 12
    assert js_number(None) != js_number(None)  # NaN
    assert num_str(40.0) == "40" and num_str(-73.5) == "-73.5"
    assert json_stringify({"a": 1.0, "b": [None, "é"]}) == '{"a":1,"b":[null,"é"]}'


# ---------------------------------------------------------------------------
# Phones, place ids, URLs
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("raw,e164,us10", [
    ("(860) 570-4059", "+18605704059", "8605704059"),
    ("tel:+1 860.570.4059", "+18605704059", "8605704059"),
    ("860-570-4059 ext. 12", "+18605704059", "8605704059"),
    ("+90 212 555 1234", "+902125551234", None),
    ("555-1234", None, None),
    ("123-456-7890", "+11234567890", None),
    ("(212) 555-0123", "+12125550123", None),  # fictional 555-01xx
    (["(860) 570-4059", "x"], "+18605704059", "8605704059"),
])
def test_phones(raw, e164, us10):
    assert sc.to_e164(raw) == e164
    assert sc.to_us_phone10(raw) == us10


def test_placeholder_phones():
    assert sc.is_placeholder_phone("000-000-0000")
    assert sc.is_placeholder_phone("1 (111) 111-1111")
    assert sc.is_placeholder_phone("9876543210")
    assert not sc.is_placeholder_phone("860-570-4059")
    assert not sc.is_placeholder_phone("12345")  # too short to judge
    out = sc.drop_placeholder_phones(
        {"person.phone": "000-000-0000", "location.fax": ["123-456-7890", "860-570-4059"],
         "tax.office_line": "1111111111", "tax.other": "1111111111", "person.name": "Jo"},
        {"office_line": {"type": "phone"}})
    assert out == {"location.fax": ["860-570-4059"], "tax.other": "1111111111",
                   "person.name": "Jo"}


def test_place_id_and_format_url():
    pid = "ChIJN1t_tDeuEmsRUsoyG83frY4"
    assert sc.to_place_id(pid) == pid
    assert sc.to_place_id(f"https://www.google.com/maps/place/?q=place_id:{pid}") == pid
    assert sc.to_place_id("https://maps.google.com/?cid=123") is None
    assert sc.format_url("http://x.com/a?utm_source=g&id=2&gclid=z#h", "https://x.com/") == \
        "https://x.com/a?id=2#h"
    assert sc.format_url("/p", "https://x.com/a/b") == "https://x.com/p"
    assert sc.format_url("mailto:a@b.com", "https://x.com/") is None


def test_video_from_url():
    # Like `new URL(x, "")` in JS, an empty page URL is an invalid base: no value.
    assert sc.video_from_url("https://youtu.be/dQw4w9WgXcQ", "") is None
    assert sc.video_from_url("https://youtu.be/dQw4w9WgXcQ", "https://a.com/") == {
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "platform": "youtube"}
    assert sc.video_from_url("//www.youtube.com/embed/dQw4w9WgXcQ?rel=0", "https://a.com/")[
        "url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert sc.video_from_url("https://player.vimeo.com/video/123456789", "https://a.com/")["url"] == \
        "https://vimeo.com/123456789"
    assert sc.video_from_url("/media/intro.mp4", "http://a.com/x") == {
        "url": "https://a.com/media/intro.mp4", "platform": "file"}
    assert sc.video_from_url("https://example.com/page", "https://a.com/") is None


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------
def test_parse_address_variants():
    assert sc.parse_address("Hartford, CT 06103") == {"city": "Hartford", "state": "CT",
                                                      "zip": "06103"}
    assert sc.parse_address("Hartford CT 06103-1234")["zip"] == "06103-1234"
    assert sc.parse_address("Hartford\nConnecticut 06103") == {
        "city": "Hartford", "state": "CT", "zip": "06103"}
    assert sc.parse_address("New York, New York 10001")["state"] == "NY"
    assert sc.parse_address("Somewhere ZZ 12345") is None


def test_validate_value_by_key():
    assert sc.validate_value("text", "Hartford, CT 06103", "", "location.city") == "Hartford"
    assert sc.validate_value("text", "Hartford, CT 06103", "", "location.state") == "CT"
    assert sc.validate_value("text", "Hartford, CT 06103", "", "location.postal_code") == "06103"
    assert sc.validate_value("text", "Jane 2 Doe", "", "person.name") is None
    assert sc.validate_value("phone", "tel:860-570-4059", "", "person.phone") == "860-570-4059"
    assert sc.validate_value("email", "mailto:Jo@X.com?subject=hi", "", "person.email") == \
        "Jo@X.com"
    assert sc.validate_value("url", "/about", "https://x.com/a/", "person.website") == \
        "https://x.com/about"
    assert sc.validate_value("year", "Since 1998", "", "person.year_started") == 1998
    assert sc.validate_value("year", "1700", "", "person.year_started") is None
    assert sc.validate_value("list", ["A,", "a", "(", "B"], "", "person.services") == ["A", "B"]
    assert sc.validate_value("text", "Services:", "", "person.headline") == "Services"
    assert sc.validate_value("text", "Call (", "", "person.headline") is None


def test_validate_taxonomy_urls_and_toll_free():
    assert sc.validate_value("url", "#top", "https://x.com/", "tax.book_url") is None
    assert sc.validate_value("url", "book now", "https://x.com/", "tax.book_url") is None
    assert sc.validate_value("url", "tel:8605704059", "https://x.com/", "tax.call") is None
    assert sc.validate_value("url", "tel:8605704059", "https://x.com/", "tax.call",
                             {"action": True}) == "tel:8605704059"
    assert sc.validate_value("phone", "860-570-4059", "", "tax.toll_free_number") is None
    assert sc.validate_value("phone", "1-800-570-4059", "", "tax.toll_free_number") == \
        "1-800-570-4059"
    assert sc.is_toll_free_number("(888) 111-2222")


def test_normalize_address_and_geo():
    a = sc.normalize_address("123 Main St, Suite 4\nHartford, CT 06103\n(860) 570-4059")
    assert a == {"streetAddress": "123 Main St, Suite 4", "addressLocality": "Hartford",
                 "addressRegion": "CT", "postalCode": "06103",
                 "text": "123 Main St, Suite 4, Hartford, CT 06103"}
    o = sc.normalize_address({"@type": "PostalAddress", "streetAddress": "1 Elm St",
                              "addressLocality": "Austin", "addressRegion": "Texas",
                              "postalCode": "78701"})
    assert o == {"streetAddress": "1 Elm St", "addressLocality": "Austin",
                 "addressRegion": "TX", "postalCode": "78701",
                 "text": "1 Elm St, Austin, Texas 78701"}
    assert sc.normalize_address("abc") is None
    assert sc.normalize_geo({"latitude": "41.76", "longitude": -72.67}) == {
        "latitude": 41.76, "longitude": -72.67}
    assert sc.normalize_geo("41.76, -72.67") == {"latitude": 41.76, "longitude": -72.67}
    assert sc.normalize_geo({"latitude": 41.76}) is None
    assert sc.normalize_geo("95, 10") is None


def test_derive_parts_and_office_block():
    block = "Main Office\n123 Main St\nHartford, CT 06103"
    assert sc.derive_address_part(block, "street") == "123 Main St"
    assert sc.derive_address_part(block, "city") == "Hartford"
    assert sc.strip_trailing_phone("Hartford, CT 06103 Phone: (860) 570-4059") == \
        "Hartford, CT 06103"
    assert sc.parse_office_block(
        "Hartford 123 Main St Suite 200 Hartford CT 06103 (860) 570-4059") == {
        "street": "123 Main St Suite 200", "city": "Hartford", "state": "CT",
        "postal_code": "06103", "phone": "8605704059"}
    assert sc.parse_office_block("123 Main St, Hartford, CT 06103") is None  # no phone
    assert sc.parse_office_block(
        "123 Main St Hartford CT 06103 860-570-4059 860-570-4060") is None


def test_separators_and_cut_off():
    assert sc.strip_trailing_separator("Buyers, Sellers, ") == "Buyers, Sellers"
    assert sc.join_parts(["Buyers,", "Sellers &", "Investors", "Other"]) == \
        "Buyers, Sellers & Investors"
    assert sc.is_cut_off_text("Licensed in (")
    assert sc.is_cut_off_text("— !")
    assert not sc.is_cut_off_text("ok")


# ---------------------------------------------------------------------------
# JSON-LD
# ---------------------------------------------------------------------------
PERSON_LD = {
    "@context": "https://schema.org",
    "@graph": [
        {"@type": "ProfilePage", "mainEntity": {
            "@type": "Person", "name": "Jane Doe", "telephone": "(860) 570-4059",
            "url": "https://ex.com/agents/jane",
            "address": {"@type": "PostalAddress", "addressLocality": "Hartford",
                        "addressRegion": "CT", "postalCode": "06103"}}},
        {"@type": "Organization", "name": "Acme Realty", "sameAs": ["https://fb.com/acme"]},
        {"@type": "Person", "name": "John Roe", "url": "https://ex.com/agents/john"},
    ],
}


def _page(ld, body="", head=""):
    return (f'<html><head>{head}<script type="application/ld+json">{json.dumps(ld)}</script>'
            f"</head><body>{body}</body></html>")


def test_json_ld_readers():
    html = _page(PERSON_LD) + '<script type=application/ld+json>{bad json</script>'
    blocks = sc.extract_json_ld_blocks(html)
    assert len(blocks) == 1
    assert sc.collect_site_entity_names(html) == {"jane doe", "acme realty", "john roe"}
    assert sc.has_page_specific_entity_json_ld(html, {"jane doe", "acme realty", "john roe"}) \
        is False
    assert sc.collect_all_same_as_urls(blocks) == ["https://fb.com/acme"]
    assert sc.deep_find_key(blocks, "postalCode")["value"] == "06103"
    objs = sc.collect_json_ld_objects(html)
    assert [o.get("name") for o in objs] == [None, "Jane Doe", "Acme Realty", "John Roe"]


def test_page_entity_evidence_and_tie_order():
    html = _page(PERSON_LD)
    ev = sc.page_entity_evidence(html, "https://ex.com/agents/jane/", set(), "person")
    assert ev == {"kind": "profile", "entities": 2, "tied": 1, "tie": "url", "name": "jane doe"}
    listing = sc.page_entity_evidence(html, "https://ex.com/agents/", set(), "person")
    assert listing["kind"] in ("profile", "listing")
    ld = {"@graph": [{"@type": "Person", "name": "A Person"}, {"@type": "Person", "name": "B P"}]}
    assert sc.page_entity_evidence(_page(ld), "https://ex.com/x", set(), "person")["kind"] == \
        "listing"
    objs = [{"@type": "Person", "name": "John Roe"}, {"@type": "Person", "name": "Jane Doe"}]
    ordered = sc.order_by_page_tie(objs, html, "https://ex.com/agents/jane", "person")
    assert ordered[0]["name"] == "Jane Doe"


def test_embedded_entities():
    state = {"props": {"agent": {"firstName": "Jane", "lastName": "Doe",
                                 "phone": "860-570-4059", "profileUrl": "/agents/jane"},
                       "nav": [{"name": "Home", "url": "/"}]}}
    html = f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(state)}</script>'
    ents = sc.collect_embedded_entities(html)
    assert ents == [{"@type": "Person", "@embedded": True, "name": "Jane Doe",
                     "telephone": "860-570-4059", "url": "/agents/jane"}]
    assert sc.embedded_entity_urls(html, "https://www.ex.com/") == [
        "https://www.ex.com/agents/jane"]
    html2 = "<script>window.__INITIAL_STATE__ = {\"a\": {\"name\": \"Bo's Grill\", " \
            "\"phone\": \"860-570-4059\", \"hours\": \"9-5\", \"city\": \"Hartford\"}};</script>"
    ents2 = sc.collect_embedded_entities(html2)
    assert ents2[0]["@type"] == "LocalBusiness" and ents2[0]["openingHours"] == "9-5"


def test_fnv_and_signature():
    assert sc.fnv1a64("") == "cbf29ce484222325"
    assert sc.fnv1a64("a") == "af63dc4c8601ec8c"
    assert sc.json_ld_signature({"a": 1}) == sc.fnv1a64('{"a":1}')


def test_classify_subject():
    assert sc.classify_subject({"@type": "Person", "name": "X"}, set()) == "person"
    assert sc.classify_subject({"@type": "RealEstateAgent", "name": "Acme"}, {"acme"}) == "firm"
    assert sc.classify_subject({"@type": "RealEstateAgent"}, set()) == "location"
    assert sc.classify_subject({"@type": "WebPage"}, set()) is None
    o = {"@type": "LocalBusiness", "name": "Y"}
    assert sc.classify_subject(o, set(), {"firmSignatures": {sc.json_ld_signature(o)}}) == "firm"


def test_looks_not_found():
    assert sc.looks_not_found("<title>Page Not Found</title>", {})
    assert sc.looks_not_found("<h1>404</h1>", {})
    assert not sc.looks_not_found("<h1>Suite 4040</h1>", {})
    assert sc.looks_not_found("<h1>Hi</h1>", {"person.name": "Sorry, this page no longer exists"})


# ---------------------------------------------------------------------------
# Applying contracts (CSS / label / JSON-LD / derived / alias)
# ---------------------------------------------------------------------------
PROFILE_HTML = """
<html><head><title>Jane Doe</title></head><body>
<header class="site-header"><a href="tel:8005551212">Call HQ</a></header>
<main>
  <h1>Jane Doe, CFP®, CEPA</h1>
  <div class="title">Senior Advisor</div>
  <p class="phone">Phone: <a href="tel:8605704059">(860) 570-4059</a></p>
  <p class="fax">Fax: (860) 570-4000</p>
  <div class="addr">123 Main St<br>Hartford, CT 06103</div>
  <dl><dt>Languages</dt><dd><ul><li>English</li><li>Spanish</li></ul></dd></dl>
  <ul class="svc"><li>Retirement,</li><li>Estate planning</li></ul>
  <span class="lic">License #: CA-0M62418</span>
  <a class="cta" href="/book">Book a meeting</a>
  <a class="cta" href="mailto:jane@ex.com">Email Jane</a>
  <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Intro"></iframe>
  <div class="gal"><img srcset="/s.jpg 300w, /l.jpg 1200w" src="/m.jpg"></div>
</main></body></html>
"""

CONTRACT = {
    "primary_subject": "person",
    "media_scan": True,
    "fields": {
        "person.name": {"tier": "css", "type": "text", "hits": 1, "samples": 1,
                        "locator": {"tier": "css", "strategy": "css", "css": "h1"}},
        "person.job_title": {"tier": "css", "type": "text", "hits": 1, "samples": 1,
                             "locator": {"tier": "css", "strategy": "css", "css": ".title"}},
        "person.phone": {"tier": "css", "type": "phone", "hits": 1, "samples": 1,
                         "locator": {"tier": "css", "strategy": "css", "css": "p"}},
        "person.fax": {"tier": "css", "type": "phone", "hits": 1, "samples": 1,
                       "locator": {"tier": "css", "strategy": "label", "label": "Fax"}},
        "location.address_block": {"tier": "css", "type": "text", "hits": 1, "samples": 1,
                                   "locator": {"tier": "css", "strategy": "css",
                                               "css": ".addr"}},
        "location.city": {"tier": "css", "type": "text", "hits": 1, "samples": 1,
                          "locator": {"tier": "css", "derived_from": "location.address_block",
                                      "part": "city"}},
        "location.street": {"tier": "css", "type": "text", "hits": 1, "samples": 1,
                            "locator": {"tier": "css", "derived_from": "location.address_block",
                                        "part": "street"}},
        "person.languages": {"tier": "css", "type": "list", "hits": 1, "samples": 1,
                             "locator": {"tier": "css", "strategy": "label",
                                         "label": "Languages"}},
        "person.services": {"tier": "css", "type": "list", "hits": 1, "samples": 1,
                            "locator": {"tier": "css", "strategy": "css", "css": ".svc li"}},
        "person.licenses": {"tier": "css", "type": "list", "hits": 1, "samples": 1,
                            "locator": {"tier": "css", "strategy": "css", "css": ".lic"}},
        "person.actions": {"tier": "css", "type": "list", "hits": 1, "samples": 1,
                           "locator": {"tier": "css", "strategy": "css", "css": "a.cta",
                                       "multi": True}},
        "person.gallery": {"tier": "css", "type": "list", "hits": 1, "samples": 1,
                           "locator": {"tier": "css", "strategy": "css", "css": ".gal img"}},
    },
    "taxonomy_fields": {
        "full_legal_name": {"tier": "alias", "type": "text", "hits": 1, "samples": 1,
                            "subject": "person",
                            "locator": {"tier": "alias", "from": "person.name"}},
    },
}


def test_apply_site_contract_css_label_derived_alias():
    res = sc.apply_site_contract(PROFILE_HTML, "https://ex.com/agents/jane", CONTRACT, set())
    v = res["values"]
    assert v["person.name"] == "Jane Doe, CFP®, CEPA"
    assert v["person.job_title"] == "Senior Advisor"
    assert v["person.phone"] == "Phone: (860) 570-4059"
    assert v["person.fax"] == "(860) 570-4000"
    assert v["location.address_block"] == "123 Main St\nHartford, CT 06103"
    assert v["location.city"] == "Hartford" and v["location.street"] == "123 Main St"
    assert v["person.languages"] == ["English", "Spanish"]
    assert v["person.services"] == ["Retirement", "Estate planning"]
    assert v["person.actions"] == [
        sc.encode_action("Book a meeting", "https://ex.com/book"),
        sc.encode_action("Email Jane", "mailto:jane@ex.com")]
    assert v["person.gallery"] == ["https://ex.com/l.jpg"]
    assert v["person.videos"] == [{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                                   "platform": "youtube", "title": "Intro"}]
    assert v["tax.full_legal_name"] == v["person.name"]
    assert res["missing"] == []
    # A parsed document gives the same result.
    doc = sc.parse_document(PROFILE_HTML, "https://ex.com/agents/jane")
    assert sc.apply_site_contract(doc, "https://ex.com/agents/jane", CONTRACT, set())[
        "values"] == v


def test_apply_value_rules_on_api_record():
    out = sc.apply_value_rules(
        {"person.name": "Jane Doe", "location.address_block": "1 Elm St\nAustin, TX 78701"},
        CONTRACT, "https://ex.com/x")
    assert out["location.city"] == "Austin" and out["location.street"] == "1 Elm St"
    assert out["tax.full_legal_name"] == "Jane Doe"


def test_classifier_locator_uses_sibling_classifiers(monkeypatch):
    calls = {}

    def fake_sameas(text, urls):
        calls["sameas"] = (text, urls)
        return {"recognized": True, "url": urls[0] if urls else None, "platform": "facebook"}

    monkeypatch.setattr(apply_mod, "classify_same_as", fake_sameas)
    contract = {"fields": {}, "taxonomy_fields": {"facebook_url": {
        "tier": "classifier", "type": "url", "hits": 1, "samples": 1, "subject": "firm",
        "locator": {"tier": "classifier", "classifier": "sameas", "label": "facebook",
                    "match_text": "facebook_url Facebook"}}}}
    res = sc.apply_site_contract(_page(PERSON_LD), "https://ex.com/agents/jane", contract, set())
    assert res["values"]["tax.facebook_url"] == "https://fb.com/acme"
    assert calls["sameas"][0] == "facebook_url Facebook"


# ---------------------------------------------------------------------------
# Learning: JSON-LD fields, CSS rule merge, finalisation
# ---------------------------------------------------------------------------
def _sample(i, name, phone, city, zip_):
    ld = {"@type": "Person", "name": name, "telephone": phone,
          "address": {"@type": "PostalAddress", "addressLocality": city, "addressRegion": "CT",
                      "postalCode": zip_}}
    body = (f'<header><nav>Acme Realty</nav></header><main><h1>{name}</h1>'
            f'<div class="bio">{name} has helped families for years. She loves Hartford.</div>'
            f'<div class="email">e{i}@ex.com</div></main>'
            f'<footer class="footer">© Acme Realty</footer>')
    return {"url": f"https://ex.com/agents/{i}", "html": _page(ld, body), "primary": "person"}


SAMPLES = [_sample(1, "Jane Doe", "860-570-4059", "Hartford", "06103"),
           _sample(2, "Mary Major", "860-570-4060", "Avon", "06001"),
           _sample(3, "Rita Roe", "860-570-4061", "Hartford", "06105")]


def test_learning_round_trip():
    jl = sc.build_json_ld_fields(SAMPLES, "person", set())
    f = jl["fields"]
    assert f["person.name"]["locator"] == {"tier": "jsonld", "subject": "person",
                                           "types": ["Person"], "path": ["name"]}
    assert f["person.city"]["hits"] == 3
    rules = [
        {"id": "person.email", "strategy": "css", "css": ".email"},
        {"id": "person.bio", "strategy": "css", "css": ".bio"},
        {"id": "person.job_title", "strategy": "css", "css": "footer"},  # chrome, same text
        {"id": "person.headline", "strategy": "css", "css": "h1:contains('Jane')"},
        {"id": "person.website", "strategy": "label", "label": "Acme Realty"},
        {"id": "person.fax", "strategy": "css"},
    ]
    merged = sc.merge_css_rules(f, rules, SAMPLES, "person", {"acme realty"})
    assert merged["fields"]["person.email"]["hits"] == 3
    assert merged["fields"]["person.bio"]["tier"] == "css"
    assert merged["rejected"]["person.job_title"]["why"] == "site_chrome"
    assert merged["rejected"]["person.headline"]["why"] == "anchored_on_value"
    assert merged["rejected"]["person.website"]["why"] == "label_is_brand_name"
    assert merged["rejected"]["person.fax"]["why"] == "incomplete_rule"
    contract = sc.finalize_site_contract(
        fields=merged["fields"], failed=merged["failed"], samples=SAMPLES, primary="person",
        site_entity_names={"acme realty"}, unkeyed=[], rejected_rules=merged["rejected"])
    assert contract["version"] == 3
    assert contract["must_have"] == {"required": ["name", "phone|email", "city", "state"],
                                     "ok": True, "missing": []}
    # state CT is identical on every sample, but the postal code varies: not site-wide.
    assert "person.state" in contract["fields"]
    um = {u["id"]: u for u in contract["unmapped"]}
    assert um["person.job_title"]["reason"] == "rule_failed_validation"
    assert um["person.job_title"]["why"] == "site_chrome"
    assert contract["samples"] == [s["url"] for s in SAMPLES]
    rec = sc.apply_site_contract(SAMPLES[1]["html"], SAMPLES[1]["url"], contract, set())
    assert rec["values"]["person.email"] == "e2@ex.com"


def test_extras_finalisation_and_keys():
    assert sc.normalize_extra_key("  Years in Business! ") == "years_in_business"
    assert sc.extra_key_words("Office_Locations_list") == "list_location_office"
    assert sc.is_static_extra_key("person_services", {"services"})
    assert sc.shares_meaningful_word("Areas Served", "service areas")
    assert sc.extra_sample_items("Buyers, Sellers…") == ["buyers", "sellers"]
    assert sc.extra_sample_agrees("Buyers, Sellers", ["We help buyers"])
    fields = {"extra.cuisine": {"tier": "css", "type": "text", "hits": 3, "samples": 3,
                                "locator": {"tier": "css", "strategy": "css", "css": ".c"}},
              "extra.motto": {"tier": "css", "type": "text", "hits": 1, "samples": 3,
                              "locator": {"tier": "css", "strategy": "css", "css": ".m"}},
              "person.name": {"tier": "jsonld"}}
    per = [{"cuisine": "Thai", "motto": "x"}, {"cuisine": "Sushi"}, {"cuisine": "Thai"}]
    out = sc.finalize_extra_fields(fields, {"cuisine": {"label": "Cuisine",
                                                        "key_source": "new"}}, per, 3)
    assert list(out["fields"]) == ["person.name"]
    assert out["extra_fields"]["cuisine"]["examples"] == ["Thai", "Sushi"]
    assert out["dropped"] == [{"label": "motto", "key": "motto", "reason": "low_support",
                               "rule": {"strategy": "css", "css": ".m"}, "found": 1,
                               "samples": 3}]


# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------
def test_taxonomy_keys(monkeypatch):
    monkeypatch.setattr(apply_mod, "classify_same_as",
                        lambda t, u: {"recognized": "linkedin" in t, "url": None,
                                      "platform": "linkedin"})
    import _base.disco.site_contract.taxonomy as tx

    monkeypatch.setattr(tx, "classify_same_as", apply_mod.classify_same_as)
    rows = [
        {"node_slug": "linkedin_url", "node_name": "LinkedIn", "schema_property": "sameAs"},
        {"node_slug": "cuisine_thai", "node_name": "Thai", "schema_property": "servesCuisine",
         "schema_type": "Restaurant"},
        {"node_slug": "cuisine_sushi", "node_name": "Sushi", "schema_property": "servesCuisine"},
        {"node_slug": "faq", "schema_type": "Question"},
        {"node_slug": "reviews", "owns_lane": "reviews", "schema_property": "review"},
        {"node_slug": "logo", "schema_property": "logo", "entity_scope": "brand"},
    ]
    keys = sc.resolve_taxonomy_keys(rows, "location")
    by = {k["slug"]: k for k in keys}
    assert set(by) == {"linkedin_url", "cuisine_thai", "cuisine_sushi", "logo"}
    assert by["linkedin_url"]["classifier"]["kind"] == "sameas"
    assert by["linkedin_url"]["path"] is None
    assert by["cuisine_thai"]["item_words"] == ["thai"]
    assert by["cuisine_thai"]["subjects"] == ["location"]
    assert by["logo"]["subjects"] == ["firm"] and by["logo"]["type"] == "url"
    assert sc.taxonomy_logo_ids(keys) == {"tax.logo"}
    roles = sc.apply_taxonomy_roles(keys, [{"id": "tax.cuisine_sushi", "role": "firm"}],
                                    "location")
    assert roles["roles"] == {"cuisine_sushi": "firm"} and roles["changed"] == ["tax.cuisine_sushi"]
    ld = {"@type": "Restaurant", "name": "Bo's", "servesCuisine": "Asian, Thai, Sushi"}
    samples = [{"url": f"https://r.com/{i}", "html": _page(ld)} for i in range(2)]
    out = sc.build_taxonomy_json_ld_fields({}, keys, samples, set())
    assert out["tax.cuisine_thai"]["locator"]["item_words"] == ["thai"]
    v = sc.apply_site_contract(samples[0]["html"], samples[0]["url"],
                               {"fields": {}, "taxonomy_fields": {
                                   "cuisine_thai": {**out["tax.cuisine_thai"],
                                                    "subject": "location"}}}, set())
    assert v["values"]["tax.cuisine_thai"] == "Thai"


def test_static_routes():
    routes = sc.build_static_routes(
        fields={}, taxonomy_fields={"office_phone": {"subject": "location",
                                                     "locator": {"tier": "jsonld"}}},
        tax_keys=[{"id": "tax.office_phone", "path": ["telephone"], "type": "phone"}],
        primary="person", extra_fields={"services_offered": {}},
        extra_candidates={"services_offered": {"static_id": "person.services",
                                               "source": "name"}},
        extra_values=[{"services_offered": "A; B"}, {"services_offered": "C"}],
        sample_urls=["https://x.com/1", "https://x.com/2"])
    assert routes["routes"]["location.phone"] == [{"kind": "taxonomy",
                                                   "from": ["tax.office_phone"]}]
    assert routes["routes"]["person.services"] == [{"kind": "extra", "from": "services_offered",
                                                    "source": "name"}]


def test_clean_html_for_prompt_and_chrome():
    html = ('<html><body><header id="top">Menu</header><nav>x</nav><main>'
            '<h1 style="c">Jane</h1><!-- c --><script>1</script><p onclick="x" class="a">Bio</p>'
            '</main><footer>F</footer></body></html>')
    assert sc.clean_html_for_prompt(html) == '<main><h1>Jane</h1><p class="a">Bio</p></main>'
    assert sc.chrome_html_for_prompt(html) == \
        '<header id="top">Menu</header> <nav>x</nav> <footer>F</footer>'


# ---------------------------------------------------------------------------
# Staging formats and records
# ---------------------------------------------------------------------------
def test_split_post_nominals_and_credentials():
    assert sc.split_post_nominals("Jane Doe, CFP®, CEPA") == {
        "name": "Jane Doe", "designations": ["CFP®", "CEPA"]}
    assert sc.split_post_nominals("Jane Q Doe CFP® CRPC") == {
        "name": "Jane Q Doe", "designations": ["CFP®", "CRPC"]}
    assert sc.split_post_nominals("Richard Roe, First Vice President") == {
        "name": "Richard Roe", "designations": [], "trailing": "First Vice President"}
    assert sc.split_post_nominals("Doe, Jane") == {"name": "Doe, Jane", "designations": []}
    assert sc.to_credential("CFP®") == {"type": "designation", "name": "CFP"}
    assert sc.to_credential("NMLS #123456") == {"type": "registration", "number": "123456",
                                                "issuer": "NMLS", "name": "NMLS"}
    assert sc.to_credential("CA: 0M62418", "license") == {"type": "license",
                                                          "number": "0M62418", "state": "CA"}
    assert sc.to_credential("Texas Real Estate License 0654321") == {
        "type": "license", "number": "0654321", "state": "TX",
        "name": "Texas Real Estate License"}


def test_bio_hours_actions():
    assert sc.is_real_bio("Jane has served clients in Hartford since 2001 with care.", "Jane Doe")
    assert not sc.is_real_bio("The firm offers many services to the community today.", "Jo Li")
    assert sc.is_hours_text("Mon 9:00 AM - 5 PM Tue 9:00AM Wed Closed Thu by appointment")
    assert sc.is_hours_text("Phone: 1 Fax: 2 Email: x")
    assert sc.action_type("Get a quote", "https://x.com/q") == "quote"
    assert sc.action_type("Schedule", "https://calendly.com/x") == "book"
    assert sc.action_type("Call", "tel:1") == "call"
    assert sc.action_key("Book Now!", "https://www.x.com/book/") == "booknow|x.com/book"


def test_build_staging_static_and_harvest_record():
    values = {
        "person.name": "Jane Doe, CFP®",
        "person.phone": "Phone: (860) 570-4059",
        "person.email": "mailto:Jane@Ex.com",
        "person.bio": "Jane has 12 years of experience helping families. She is great.",
        "person.licenses": ["License #: CA-0M62418"],
        "person.website": "https://ex.com/agents/jane",
        "person.social_links": ["https://www.linkedin.com/in/jane", "https://ex.com/x",
                                ("https://www.google.com/maps?query_place_id="
                                "ChIJN1t_tDeuEmsRUsoyG83frY4")],
        "person.actions": [sc.encode_action("Book a meeting", "https://ex.com/book"),
                           sc.encode_action("Email Jane", "mailto:jane@ex.com"),
                           sc.encode_action("Login", "https://ex.com/login")],
        "person.street": "Main Office, 12 Oak AveSuite 3",
        "location.state": "Connecticut",
        "location.postal_code": "Hartford, CT 06103",
        "location.hours": ["Mon-Fri 9-5", "Sat: Closed", "By appointment"],
        "location.latitude": 41.7, "location.longitude": 72.6,
        "tax.office_phone": "860-570-4060",
    }
    extras = {"branch_info": "Hartford 123 Main St Suite 200 Hartford CT 06103 (860) 570-4070",
              "motto": "We care"}
    contract = {"primary_subject": "person", "version": 3, "learned_at": "t",
                "static_routes": {"location.phone": [{"kind": "taxonomy",
                                                      "from": ["tax.office_phone"]}]},
                "taxonomy_fields": {"office_phone": {"subject": "location", "type": "phone"}}}
    st = sc.build_staging_static(contract=contract, values=values, extras=extras,
                                 page_url="https://ex.com/agents/jane")
    u = st["universal"]
    assert u["person.name"] == "Jane Doe"
    assert u["person.phone"] == "8605704059"
    assert u["person.email"] == "jane@ex.com"
    assert u["person.profile_url"] == "https://ex.com/agents/jane"
    assert "person.website" not in u  # the page itself
    assert u["person.year_started"] == sc.staging.utc_year() - 12
    assert u["person.credentials"] == [
        {"type": "designation", "name": "CFP"},
        {"type": "license", "number": "CA-0M62418", "state": "CA", "name": "License"}]
    assert u["person.license_number"] == "CA-0M62418"
    assert u["person.gbp_place_id"] == "ChIJN1t_tDeuEmsRUsoyG83frY4"
    assert u["person.social_links"] == [
        {"platform": "linkedin", "url": "https://www.linkedin.com/in/jane"},
        {"platform": "google", "url": "https://www.google.com/maps?query_place_id="
                                      "ChIJN1t_tDeuEmsRUsoyG83frY4"}]
    assert u["person.actions"] == [{"label": "Book a meeting", "url": "https://ex.com/book",
                                    "type": "book"}]  # mailto of the known email dropped
    assert u["person.booking_url"] == "https://ex.com/book"
    assert u["person.street"] == "12 Oak Ave Suite 3"
    assert u["location.street"] == "123 Main St Suite 200"  # office block
    assert u["location.state"] == "CT" and u["location.postal_code"] == "06103"
    assert u["location.phone"] == "8605704060"  # category route
    assert u["location.city"] == "Hartford"  # office block
    assert u["location.hours"] == [
        {"day": d, "opens": "09:00", "closes": "17:00"}
        for d in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
    ] + [{"day": "Saturday"}, "By appointment"]
    assert u["location.latitude"] == 41.7 and u["location.longitude"] == -72.6
    assert st["extras"] == {"motto": "We care"}
    assert st["sources"]["location.phone"] == "taxonomy"

    rec = sc.build_harvest_record(contract=contract, values=values,
                                  detail_url="https://ex.com/agents/jane", field_floor=10,
                                  extras=extras, firm_relabelled=[])
    assert rec["entity_type"] == "professional"
    assert rec["payload"]["office_phone"] == "860-570-4060"
    assert rec["payload"]["_subjects"] == {"office_phone": "branch"}
    assert rec["payload"]["_extra"] == {"motto": "We care"}
    assert rec["identity_candidates"]["name"] == "Jane Doe, CFP®"
    assert rec["must_have"] == {"ok": False, "missing": ["city"]}
    assert rec["floor_needed"] == 7 and rec["shallow"] is True
    # TS-style args object works too.
    rec2 = sc.build_harvest_record({"contract": contract, "values": values,
                                    "detailUrl": "https://ex.com/agents/jane", "fieldFloor": 10,
                                    "extras": extras})
    assert rec2["filled"] == rec["filled"] > 10


def test_count_staging_fields():
    assert sc.count_staging_fields(
        {"a": "8605704059", "b": ["(860) 570-4059", "x"], "c": ["x"], "d": "Y"},
        {"tax.k": "y", "tax.e": "", "person.name": "zz"}) == 2


def test_record_must_have_and_address_owner():
    vals = sc.apply_address_owner({"location.city": "Avon", "person.city": ""},
                                  {"address_owner": "location"})
    assert vals["person.city"] == "Avon"
    assert sc.record_must_have({"location.business_name": "Bo", "location.phone": "1",
                                "location.city": "A", "location.state": "CT"},
                               "person", "location")["ok"] is True


def test_previous_rules_and_kept_fields():
    prev = {"version": 3, "fields": {
        "person.email": {"locator": {"tier": "css", "strategy": "css", "css": ".e"},
                         "backup": {"tier": "css", "strategy": "label", "label": "Email"}},
        "person.city": {"locator": {"tier": "css", "derived_from": "person.address_block",
                                    "part": "city"}}},
        "extra_fields": {"motto": {"locator": {"tier": "css", "strategy": "css", "css": ".m",
                                               "multi": True}}}}
    r = sc.previous_contract_rules(prev)
    assert r["rules"] == [{"id": "person.email", "strategy": "css", "css": ".e"},
                          {"id": "extra.motto", "strategy": "css", "css": ".m", "multi": True}]
    assert sc.previous_contract_rules({"version": 2, "fields": prev["fields"]})["rules"] == []
    kept = sc.mark_kept_fields({"person.email": {"tier": "css"}}, ["person.email"],
                               r["backups"])
    assert kept["person.email"]["kept_from_previous"] is True
    assert kept["person.email"]["backup"]["label"] == "Email"


def test_firm_rules_and_profile():
    def page(i, phone):
        return {"url": f"https://ex.com/{i}",
                "html": f'<html><body><footer><span class="tel">{phone}</span></footer>'
                        f'<main><h1>P{i}</h1><span class="pp">860-570-40{i}{i}</span></main>'
                        "</body></html>"}

    home = page(0, "800-555-1212")
    samples = [page(1, "800-555-1212"), page(2, "800-555-1212")]
    res = sc.merge_firm_rules({}, [{"id": "firm.phone_main", "strategy": "css", "css": ".tel"}],
                              home, samples, set(), {}, ["firm.phone_main"])
    assert res["fields"]["firm.phone_main"]["hits"] == 2
    assert res["diagnostics"][0]["outcome"] == "accepted"
    prof = sc.build_firm_profile({"fields": res["fields"]}, home, samples, set())
    assert prof["values"] == {"firm.phone_main": "800-555-1212"}
    assert prof["sources"] == {"firm.phone_main": "chrome"}
