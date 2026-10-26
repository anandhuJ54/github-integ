"""Port of tests/nora-extract.test.ts (+ exact parity with the TS extractor's output)."""
from __future__ import annotations

import json

from surfaces.nora_os.category_brief import compile_category_brief, entity_brief
from surfaces.nora_os.jsutil import js_numbers
from surfaces.nora_os.nora.extract.haiku import build_prompt, haiku_extractor, output_schema
from surfaces.nora_os.nora.extract.index import extract_facts, graph_entity_type, validate_llm_items
from surfaces.nora_os.nora.extract.match import host_tokens, match_vocabulary, normalize_value
from surfaces.nora_os.nora.graph_upsert import to_upsert_payload
from surfaces.nora_os.testing import fixture

RINGS = fixture("exp_rings.json")
GOLDEN = fixture("golden.ts-output.json")


def _brief(name, gcid):
    return compile_category_brief({**fixture(name), "gcid": gcid, "rings": RINGS})


INSURANCE = _brief("category-brief.insurance_agency.json", "gcid:insurance_agency")
MEXICAN = _brief("category-brief.mexican_restaurant.json", "gcid:mexican_restaurant")
AGENT = fixture("candidate-facts.insurance_agent.json")
RESTAURANT = fixture("candidate-facts.mexican_restaurant.json")


def _item(name, evidence, vocabulary_term=None):
    return {
        "name": name,
        "detail": None,
        "price": None,
        "section": "Products offered",
        "vocabulary_term": vocabulary_term,
        "evidence": evidence,
    }


def fake_haiku(args):
    """Stand-in for Haiku: answers from the page's product list, plus one invented item."""
    out = {c["key"]: [] for c in args["collections"]}
    if any(c["key"] == "offers" for c in args["collections"]):
        lines = [
            b["text"]
            for b in args["page"]["text"]
            if b["kind"] == "paragraph" and b["text"].endswith("Insurance")
        ]
        out["offers"] = [_item(x, x, "pet insurance" if x == "Pet Insurance" else None) for x in lines]
        out["offers"].append(_item("Umbrella Insurance", "Umbrella Insurance"))  # not on the page
    return out


def test_deterministic_output_matches_the_ts():
    r = extract_facts(brief=INSURANCE, entity_type="professional", pages=[AGENT])
    assert js_numbers(r) == GOLDEN["extract:agent"]
    r2 = extract_facts(brief=MEXICAN, entity_type="location", pages=[RESTAURANT])
    assert js_numbers(r2) == GOLDEN["extract:restaurant"]


def test_agent_deterministic_pass():
    r = extract_facts(brief=INSURANCE, entity_type="professional", pages=[AGENT])
    assert r["entity_type"] == "professional"
    assert r["stats"]["llm_calls"] == 0

    def by_slug(s):
        return [n for n in r["nodes"] if n["registry_node_slug"] == s]

    assert by_slug("url_linkedin")[0]["cardinality_group"]["collection"] == "profiles"
    assert by_slug("url_twitter")[0]["value"] == "https://x.com/janedoesf"
    cred = next(n for n in r["nodes"] if n["node_type"] == "credential" and n["schema_property"] == "hasCredential")
    assert cred["cardinality_group"]["collection"] == "credentials"
    assert any(
        n["schema_property"] == "hasCredential.identifier" and n["value"] == "1234567" for n in r["nodes"]
    )
    assert all(n["evidence"] for n in r["nodes"])


def test_two_phones_become_a_conflict():
    r = extract_facts(brief=INSURANCE, entity_type="professional", pages=[AGENT])
    phone = next(c for c in r["conflicts"] if c["schema_property"] == "telephone")
    assert sorted(normalize_value("telephone", c["value"]) for c in phone["candidates"]) == [
        "5125550142",
        "5125550199",
    ]
    assert not any(n["schema_property"] == "telephone" for n in r["nodes"])


def test_products_land_in_one_few_collection():
    r = extract_facts(brief=INSURANCE, entity_type="professional", pages=[AGENT], llm=fake_haiku)
    assert "offers" in r["llm_requested"]
    assert "credentials" not in r["llm_requested"]
    assert r["stats"]["llm_calls"] == 1
    products = [n for n in r["nodes"] if n["method"] == "haiku"]
    assert len(products) == 7
    assert {p["cardinality_group"]["collection"] for p in products} == {"offers"}
    assert {p["cardinality_group"]["cardinality"] for p in products} == {"few"}

    def term(name):
        p = next((p for p in products if p["value"] == name), None)
        return p["cardinality_group"]["vocabulary_term"] if p else None

    assert term("Pet Insurance") == "pet insurance"
    assert term("Boat Insurance") == "boat and marine insurance"
    assert term("Motorcycle Insurance") == "motorcycle and powersports insurance"
    assert term("Flood Insurance") == "flood insurance policies"
    assert term("Auto Insurance") is None
    assert all(p["node_type"] == "product_service" for p in products)
    assert [x["name"] for x in r["rejected"]] == ["Umbrella Insurance"]


def test_blocked_page_never_goes_to_the_model():
    called = []
    r = extract_facts(
        brief=INSURANCE,
        entity_type="professional",
        pages=[{**AGENT, "blocked": True}],
        llm=lambda a: called.append(1) or {},
    )
    assert called == []
    assert r["stats"]["llm_calls"] == 0


def test_menu_items_land_in_one_many_collection():
    calls = []

    def spy(a):
        calls.append([c["key"] for c in a["collections"]])
        return {}

    r = extract_facts(brief=MEXICAN, entity_type="location", pages=[RESTAURANT], llm=spy)
    menu = [n for n in r["nodes"] if n["node_type"] == "menu_item"]
    assert len(menu) == 7
    assert {m["cardinality_group"]["collection"] for m in menu} == {"offers"}
    assert {m["cardinality_group"]["cardinality"] for m in menu} == {"many"}
    assert len({m["registry_node_slug"] for m in menu}) == 1
    tacos = next(m for m in menu if m["value"] == "Carne Asada Tacos")
    assert tacos["extracted_data"]["price"] == "$14.00"
    assert tacos["extracted_data"]["section"] == "Tacos"
    assert tacos["method"] == "deterministic"
    assert "offers" not in r["llm_requested"]
    for keys in calls:
        assert "offers" not in keys


def test_identity_agrees_and_presence_by_host():
    r = extract_facts(brief=MEXICAN, entity_type="location", pages=[RESTAURANT])
    assert r["conflicts"] == []
    name = next(n for n in r["nodes"] if n["schema_property"] == "name")
    assert name["value"] == "La Casita Cocina Mexicana"
    assert name["cardinality_group"]["cardinality"] == "one"
    assert next(n for n in r["nodes"] if "instagram.com" in n["value"])["registry_node_slug"] == "instagram_profile"
    assert next(n for n in r["nodes"] if "yelp.com" in n["value"])["registry_node_slug"] == "yelp_profile"


def _menu_req():
    menu = next(c for c in entity_brief(MEXICAN, "location")["collections"] if c["key"] == "offers")
    return [
        {
            "key": menu["key"],
            "label": menu["label"],
            "cardinality": menu["cardinality"],
            "expected": menu["expectedCount"],
            "vocabulary": menu["vocabulary"],
        }
    ]


def test_prompt_and_schema_ask_only_for_requested_keys():
    req = _menu_req()
    schema = output_schema(req)
    assert list(schema["properties"]["collections"]["properties"]) == ["offers"]
    p = build_prompt({"page": RESTAURANT, "categoryName": MEXICAN["displayName"], "collections": req})
    assert 'offers ("Menu"): cardinality many' in p["user"]
    assert "Taco Tuesday specials" in p["user"]


def test_llm_items_need_verbatim_evidence():
    offers = next(c for c in entity_brief(INSURANCE, "professional")["collections"] if c["key"] == "offers")
    kept, rejected = validate_llm_items(
        AGENT,
        offers,
        [
            {"name": "Pet Insurance", "evidence": "Pet Insurance", "price": "$20/mo", "detail": None,
             "section": None, "vocabulary_term": "not a term"},
            {"name": "Renters Insurance", "evidence": "Pet Insurance", "price": None, "detail": None,
             "section": None, "vocabulary_term": None},
            {"name": "Earthquake Insurance", "evidence": "Earthquake Insurance", "price": None,
             "detail": None, "section": None, "vocabulary_term": None},
        ],
    )
    assert [k["name"] for k in kept] == ["Pet Insurance"]
    assert kept[0]["price"] is None
    assert kept[0]["vocabulary_term"] is None
    assert [r["reason"] for r in rejected] == ["name not inside its evidence", "evidence not found in page text"]


class _Res:
    def __init__(self, body, status=200):
        self._body = body
        self.status_code = status
        self.text = json.dumps(body)

    def json(self):
        return self._body


def test_haiku_extractor_sends_a_raw_messages_request():
    sent = {}

    def fake_post(url, *, headers, content, timeout):
        sent.update(url=url, headers=headers, body=json.loads(content))
        answer = {"collections": {"offers": [{"name": "Pet Insurance", "detail": None, "price": None,
                                              "section": None, "vocabulary_term": "pet insurance",
                                              "evidence": "Pet Insurance"}]}}
        return _Res({"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(answer)}]})

    llm = haiku_extractor(api_key="test-key", post=fake_post)
    out = llm(
        {
            "page": AGENT,
            "categoryName": INSURANCE["displayName"],
            "collections": [{"key": "offers", "label": "Coverage & products", "cardinality": "few",
                             "expected": {"min": 1, "max": 12}, "vocabulary": ["pet insurance"]}],
        }
    )
    assert sent["url"] == "https://api.anthropic.com/v1/messages"
    assert sent["headers"] == {"x-api-key": "test-key", "anthropic-version": "2023-06-01",
                               "content-type": "application/json"}
    assert sent["body"]["model"] == "claude-haiku-5-5"
    assert sent["body"]["max_tokens"] == 16000
    assert sent["body"]["output_config"]["effort"] == "low"
    assert sent["body"]["output_config"]["format"]["type"] == "json_schema"
    assert list(sent["body"]["output_config"]["format"]["schema"]["properties"]["collections"]["properties"]) == ["offers"]
    assert out["offers"][0]["name"] == "Pet Insurance"


def test_haiku_refusal_and_http_errors():
    import pytest

    def refusal(*a, **k):
        return _Res({"stop_reason": "refusal", "content": []})

    llm = haiku_extractor(api_key="k", post=refusal)
    args = {"page": AGENT, "categoryName": "x", "collections": [{"key": "o", "label": "O", "cardinality": "few",
                                                               "expected": {"min": 1, "max": 2}, "vocabulary": []}]}
    with pytest.raises(RuntimeError, match="declined"):
        llm(args)
    llm2 = haiku_extractor(api_key="k", post=lambda *a, **k: _Res({"error": "x"}, 529))
    with pytest.raises(RuntimeError, match="^anthropic 529: "):
        llm2(args)
    assert haiku_extractor(api_key="k", post=refusal)({**args, "collections": []}) == {}


def test_haiku_extractor_needs_a_key(monkeypatch):
    import pytest

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY not configured"):
        haiku_extractor()


def test_helpers():
    v = ["boat and marine insurance", "pet insurance", "travel insurance"]
    assert match_vocabulary("Boat Insurance", v) == "boat and marine insurance"
    assert match_vocabulary("Insurance", v) is not None
    assert match_vocabulary("Auto Insurance", v) is None
    assert host_tokens("https://www.facebook.com/x") == ["facebook"]
    assert host_tokens("https://x.com/abc") == ["twitter"]
    assert graph_entity_type("professional") == "professional"
    assert graph_entity_type("location") == "organization"
    assert graph_entity_type("brand") == "organization"


def test_upsert_payload_carries_provenance():
    r = extract_facts(brief=MEXICAN, entity_type="location", pages=[RESTAURANT])
    for p in to_upsert_payload(r["nodes"], MEXICAN["gcid"]):
        assert p["value"] and p["node_type"] and p["evidence"]
        assert p["source_url"] == RESTAURANT["source_url"]
        assert p["gcid"] == "gcid:mexican_restaurant"
