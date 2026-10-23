"""Tests for etl.statefarm (pure parser)."""
from __future__ import annotations

import json

from etl import statefarm as sf

LD = {
    "@type": ["InsuranceAgency"],
    "name": "Jane Doe - State Farm Insurance Agent",
    "description": "Auto &amp; home insurance in <b>Austin</b>.",
    "telephone": "(512) 555-0100",
    "url": "https://www.statefarm.com/agent/us/tx/austin/jane-doe",
    "sameAs": [
        "https://www.facebook.com/janedoe",
        "https://maps.google.com/?placeid=ChIJabc_123",
        "janedoeinsurance.com",
        "",
    ],
    "address": {"streetAddress": "1 Main St", "addressLocality": "Austin",
                "addressRegion": "TX", "postalCode": "78701"},
    "geo": {"latitude": 30.2, "longitude": True},
    "areaServed": [{"name": "Austin"}, "Round Rock", 5],
    "founder": {"name": "Jane Doe"},
}
OFFER = {"@type": "Offer", "name": "Auto Insurance", "url": "https://sf.com/auto",
         "description": "Cars"}

HTML = f"""<html><head>
<script type="application/ld+json">{json.dumps(LD)}</script>
<script type='application/ld+json'>[{json.dumps(OFFER)}, {{"@type":"Offer","name":""}}]</script>
<script type="application/ld+json">{{broken</script>
</head><body>
<section id="credentials-section">
<span class="credential-value" data-credential-type="primary">TX-1234567</span>
<span class="credential-value" data-credential-type="other">9876</span>
</section>
<div id="about-me-section"></div>
<span data-language-title="English"></span><span data-language-title="Spanish"></span>
<span data-language-title="English"></span>
<div class="x-hours-section" data-abbr="CST"><span class="-oneX-body--primary">Mon 9-5</span>
<span class="-oneX-body--primary"> </span></div><div class="x-phone-section"></div>
<a data-phone-number-type="fax">(512) 555-0199</a>
<ul class="about-me-list"><li>Licensed since 2001</li><li>Eagle&nbsp;Scout</li></ul>
<ul class="about-me-list"><li>Licensed since 2001</li></ul>
<img src="https://cdn.sf.com/associate-photos/x/ABC123/formalColorFull.jpg">
<img src="https://cdn.sf.com/associate-photos/x/ABC123/informalColorFull.jpg">
<div id="our-team-section">
<div id="team-member-1" data-alias="bob"><span class="team-member__name">Bob Roe</span>
<span class="team-member__job-title">Office Manager</span>
<span class="team-member__credential">TX-7</span>
<img class="team-member__photo" src="https://x/bob.jpg"></div>
<div id="team-member-2"><span class="team-member__name">bob roe</span></div>
</div>
<footer></footer>
</body></html>"""


def test_parse_full_page():
    f = sf.parse_state_farm_agent(HTML, "https://www.statefarm.com/agent/us/tx/austin/jane-doe")
    assert f["name"] == "Jane Doe"
    assert f["legal_name"] == "Jane Doe - State Farm Insurance Agent"
    assert f["short_bio"] == "Auto & home insurance in Austin ."
    assert f["about_me"] == ["Licensed since 2001", "Eagle Scout"]
    assert f["bio"] == "Licensed since 2001 · Eagle Scout"
    assert f["phone"] == "(512) 555-0100"
    assert f["fax"] == "(512) 555-0199"
    assert f["toll_free"] is None
    assert f["website_url"] == "https://janedoeinsurance.com"
    assert (f["street"], f["city"], f["state"], f["postal_code"]) == (
        "1 Main St", "Austin", "TX", "78701")
    assert f["latitude"] == 30.2 and f["longitude"] is None
    assert f["area_served"] == ["Austin", "Round Rock"]
    assert f["brand"] == "State Farm"
    assert f["licenses"] == [
        {"raw": "TX-1234567", "state": "TX", "number": "1234567", "primary": True},
        {"raw": "9876", "state": None, "number": "9876", "primary": False},
    ]
    assert f["languages"] == ["English", "Spanish"]
    assert f["office_hours"] == ["Mon 9-5"] and f["office_hours_tz"] == "CST"
    assert f["photo_url"].endswith("formalColorFull.jpg")
    assert f["cover_photo_url"].endswith("informalColorFull.jpg")
    assert f["associate_id"] == "ABC123"
    assert f["gbp_place_id"] == "ChIJabc_123"
    assert f["products"] == [{"name": "Auto Insurance", "url": "https://sf.com/auto",
                              "description": "Cars"}]
    assert f["social"] == [
        {"platform": "Facebook", "url": "https://www.facebook.com/janedoe"},
        {"platform": "Google", "url": "https://maps.google.com/?placeid=ChIJabc_123"},
    ]
    assert f["team"] == [{"name": "Bob Roe", "role": "Office Manager", "license": "TX-7",
                          "description": None, "photo_url": "https://x/bob.jpg",
                          "alias": "bob"}]
    assert f["field_count"] == sf.count_fields(f)
    assert sf.parse_ok(f)


def test_empty_page():
    f = sf.parse_state_farm_agent("<html></html>", "u")
    assert f["name"] is None and f["brand"] == "State Farm"
    assert f["field_count"] == 1  # brand only
    assert not sf.parse_ok(f)


def test_social_platform_and_count():
    assert sf.social_platform("https://x.com/a") == "X"
    assert sf.social_platform("https://yelp.com/a") == "Yelp"
    assert sf.social_platform("https://example.com") == "Website"
    assert sf.count_fields({"latitude": 0, "name": "", "team": []}) == 1


def test_redirect_url_wins():
    html = '<a href="https://agent.example.com" class="btn redirect-url">site</a>'
    assert sf.parse_state_farm_agent(html, "u")["website_url"] == "https://agent.example.com"
