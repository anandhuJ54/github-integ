"""Pure compiler tests — cases from legacy tests/category-brief.test.ts.

Fixtures are the live rows captured for the TS tests (legacy tree); skipped if it is gone.
Parity with the TS compiler was also checked field-by-field on all four fixtures.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from surfaces.graph.category_brief.category_brief import (
    brief_failures,
    compile_category_brief,
    entity_brief,
    entity_brief_for_office,
    humanize,
    next_gaps,
    to_num,
)

FIX = Path(__file__).resolve().parents[3] / "legacy/experiencesrp-clone/tests/fixtures"
needs_fixtures = pytest.mark.skipif(not FIX.exists(), reason="legacy fixtures not present")


def _rows(name: str, gcid: str) -> dict:
    r = json.loads((FIX / f"category-brief.{name}.json").read_text())
    return {**r, "gcid": gcid, "rings": json.loads((FIX / "exp_rings.json").read_text())}


@pytest.fixture(scope="module")
def restaurant():
    return compile_category_brief(_rows("restaurant", "gcid:restaurant"))


@pytest.fixture(scope="module")
def mortgage():
    return compile_category_brief(_rows("mortgage_lender", "gcid:mortgage_lender"))


@needs_fixtures
def test_restaurant_is_location_first_with_menu(restaurant):
    assert restaurant["shape"] == "location_first"
    assert restaurant["primaryEntityType"] == "location"
    assert [e["type"] for e in restaurant["entityTypes"]] == ["brand", "location"]
    menu = next(c for c in entity_brief(restaurant)["collections"] if c["key"] == "offers")
    assert menu["label"] == "Menu"
    assert (menu["cardinality"], menu["cardinalitySource"]) == ("many", "derived")
    assert any(p in ("hasMenu", "menu") for p in menu["schemaProperties"])
    assert menu["expectedCount"]["max"] >= 100


@needs_fixtures
def test_restaurant_nap_keys_gate_and_rings(restaurant):
    loc = entity_brief(restaurant, "location")
    assert [k["schemaProperty"] for k in loc["identityKeys"]] == ["name", "address", "telephone"]
    assert all(f["source"] == "identity_key" for f in loc["formFields"][:3])
    assert loc["claim"]["claimable"] and len(loc["claim"]["keys"]) == 3
    assert brief_failures(restaurant) == []
    keys = {r["key"] for r in restaurant["rings"]}
    assert len(keys) == 10
    assert all(n["ring"] in keys for e in restaurant["entityTypes"] for n in e["nodes"])


@needs_fixtures
def test_mortgage_professional(mortgage):
    pro = entity_brief(mortgage, "professional")
    assert pro["required"] and not pro["scopeFallback"]
    assert mortgage["primaryEntityType"] == "professional"
    products = next(c for c in pro["collections"] if c["key"] == "offers")
    assert (products["label"], products["cardinality"]) == ("Products", "few")
    assert products["vocabulary"]
    cred = next(k for k in pro["identityKeys"] if k["key"] == "credential_id")
    assert cred["label"] == "NMLS #"
    assert pro["claim"]["verifiableNodes"]
    assert "guaranteed approval" in mortgage["compliance"]["prohibitedPhrases"]
    assert mortgage["compliance"]["flags"]["glba"] is True
    assert brief_failures(mortgage) == []


@needs_fixtures
def test_next_gaps(mortgage):
    gaps = next_gaps(mortgage, [], "professional")
    first_opt = next(i for i, g in enumerate(gaps) if not g["requiredForScore"])
    assert all(g["requiredForScore"] for g in gaps[:first_opt])
    assert not any(g["requiredForScore"] for g in gaps[first_opt:])
    filled = [g["nodeSlug"] for g in gaps[:3]]
    after = next_gaps(mortgage, filled, "professional")
    assert len(after) == len(gaps) - 3
    assert not any(g["nodeSlug"] in filled for g in after)
    assert all(g["entityScope"] in ("professional", "shared") for g in gaps)
    assert next_gaps(mortgage, [], "nonexistent") == []


@needs_fixtures
def test_registry_cardinality_and_shape_keys_win():
    r = _rows("mortgage_lender", "gcid:mortgage_lender")
    r["nodes"] = [
        {**n, "cardinality": "many", "expected_count_min": 5, "expected_count_max": 40}
        if n["schema_property"] == "hasOfferCatalog" else n
        for n in r["nodes"]
    ]
    b = compile_category_brief(r)
    offers = next(c for c in entity_brief(b, "professional")["collections"]
                  if c["key"] == "offers")
    assert (offers["cardinality"], offers["cardinalitySource"]) == ("many", "registry")
    assert offers["expectedCount"] == {"min": 5, "max": 40}

    r2 = _rows("restaurant", "gcid:restaurant")
    r2["shape"] = {**copy.deepcopy(r2["shape"]), "identity_keys": {
        "location": ["name", {"key": "phone", "schemaProperty": "telephone"}]}}
    keys = entity_brief(compile_category_brief(r2), "location")["identityKeys"]
    assert [k["key"] for k in keys] == ["name", "phone"]
    assert all(k["source"] == "shape" for k in keys)


def test_empty_rows_fallbacks():
    b = compile_category_brief({"gcid": "gcid:dentist", "category": None, "shape": None,
                                "profileConfig": None, "nodes": None})
    assert b["displayName"] == "dentist"
    assert b["labels"]["source"] == "fallback" and b["labels"]["credentialIdLabel"] == "License #"
    assert len(b["rings"]) == 10 and b["rings"][9]["name"] == "Entity graph"
    assert brief_failures(b) == ["no_gbp_join", "no_entity_type", "no_collections", "no_labels"]
    assert entity_brief_for_office(b, "single_pro") is None


def test_helpers_match_js():
    assert humanize("entity_graph") == "Entity graph"
    assert humanize("hasCredential.identifier") == "Has credential identifier"
    assert to_num("12") == 12 and to_num("1.5") == 1.5 and to_num("x") is None
    assert to_num("") is None and to_num(None) is None
