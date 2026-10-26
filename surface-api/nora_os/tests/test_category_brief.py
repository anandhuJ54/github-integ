"""compile_category_brief parity with the TS compiler (golden output captured from
lib/category-brief.ts on the same fixtures) + the legacy category-brief.test.ts cases."""
from __future__ import annotations

import pytest

from surfaces.nora_os.category_brief import (
    compile_category_brief,
    entity_brief,
    entity_brief_for_office,
    load_category_brief_rows,
)
from surfaces.nora_os.jsutil import js_numbers
from surfaces.nora_os.testing import FakeDb, fixture

RINGS = fixture("exp_rings.json")
GOLDEN = fixture("golden.ts-output.json")
CASES = [
    ("category-brief.insurance_agency.json", "gcid:insurance_agency"),
    ("category-brief.mexican_restaurant.json", "gcid:mexican_restaurant"),
    ("category-brief.mortgage_lender.json", "gcid:mortgage_lender"),
]


def rows(name, gcid):
    return {**fixture(name), "gcid": gcid, "rings": RINGS}


def _reduced(brief: dict) -> dict:
    """The golden keeps entityTypes[].nodes and vocabulary lists as counts (size)."""
    b = js_numbers(brief)
    for e in b["entityTypes"]:
        e["nodes"] = len(e["nodes"])
    b["vocabulary"] = {k: len(v) for k, v in b["vocabulary"].items()}
    return b


@pytest.mark.parametrize(("name", "gcid"), CASES)
def test_matches_the_ts_compiler(name, gcid):
    brief = compile_category_brief(rows(name, gcid))
    assert _reduced(brief) == GOLDEN[f"brief:{gcid}"]
    # key order too (JSON shape identical to what the TS produced)
    assert list(brief) == list(GOLDEN[f"brief:{gcid}"])
    office = js_numbers(entity_brief_for_office(brief, "single_pro", "location"))
    assert office == GOLDEN[f"office:{gcid}"]


MORTGAGE = compile_category_brief(rows("category-brief.mortgage_lender.json", "gcid:mortgage_lender"))


def test_mortgage_professional():
    pro = entity_brief(MORTGAGE, "professional")
    assert pro["required"] is True and pro["scopeFallback"] is False
    assert MORTGAGE["primaryEntityType"] == "professional"
    products = next(c for c in pro["collections"] if c["key"] == "offers")
    assert products["label"] == "Products"
    assert products["cardinality"] == "few"
    assert products["vocabulary"]
    cred = next(k for k in pro["identityKeys"] if k["key"] == "credential_id")
    assert cred["label"] == "NMLS #"
    assert "guaranteed approval" in MORTGAGE["compliance"]["prohibitedPhrases"]
    assert MORTGAGE["compliance"]["flags"]["glba"] is True


def test_registry_cardinality_wins_over_fallback():
    r = rows("category-brief.mortgage_lender.json", "gcid:mortgage_lender")
    r["nodes"] = [
        {**n, "cardinality": "many", "expected_count_min": 5, "expected_count_max": 40}
        if n.get("schema_property") == "hasOfferCatalog"
        else n
        for n in r["nodes"]
    ]
    offers = next(
        c for c in entity_brief(compile_category_brief(r), "professional")["collections"]
        if c["key"] == "offers"
    )
    assert offers["cardinality"] == "many"
    assert offers["cardinalitySource"] == "registry"
    assert offers["expectedCount"] == {"min": 5, "max": 40}


def test_shape_identity_keys_win():
    r = rows("category-brief.mexican_restaurant.json", "gcid:mexican_restaurant")
    r["shape"] = {
        **r["shape"],
        "identity_keys": {"location": ["name", {"key": "phone", "schemaProperty": "telephone"}]},
    }
    keys = entity_brief(compile_category_brief(r), "location")["identityKeys"]
    assert [k["key"] for k in keys] == ["name", "phone"]
    assert all(k["source"] == "shape" for k in keys)


def test_office_view_without_single_pro_is_the_requested_type():
    ob = entity_brief_for_office(MORTGAGE, "multi_pro", "professional")
    assert ob["singlePro"] is False and ob["actAs"] == ob["listAs"] == "professional"
    assert entity_brief_for_office(MORTGAGE, None, "nonexistent") is None


def test_loader_reads_every_table_by_gcid():
    db = FakeDb(
        [
            ("from exp_vertical_node_registry", [{"node_slug": "a"}]),
            ("from exp_taxonomy", [{"level": "alias", "term": "x"}]),
            ("from exp_rings", RuntimeError("boom")),
            ("from gbp_categories", [{"gcid": "gcid:x", "display_name": "X"}]),
            ("from ", []),
        ]
    )
    out = load_category_brief_rows(db, "gcid:x")
    assert out["gcid"] == "gcid:x"
    assert out["category"] == {"gcid": "gcid:x", "display_name": "X"}
    assert out["shape"] is None and out["rings"] is None  # soft reads → null
    assert out["nodes"] == [{"node_slug": "a"}]
    tax = db.sql("from exp_taxonomy")[0]
    assert tax[1][0] == "gcid:x"
    assert tax[1][1] == ["product_service", "specialization", "profession_title", "alias", "industry_term"]
    assert "order by level, priority, term" in tax[0]
