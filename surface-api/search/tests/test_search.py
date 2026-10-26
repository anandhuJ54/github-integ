"""Search presentation, the site-indexing read and the search-assistant route (setSiteIndexing
moved to admin, surface audit 2026-10-25)."""
from __future__ import annotations

import psycopg

from surfaces.search import internal as site_indexing
from surfaces.search.search_presentation.presentation import collect_tags, group_facets, strings


def doc(i, entity_type="professional"):
    return {
        "id": f"d{i}", "entity_type": entity_type, "entity_id": f"e{i}", "slug": None, "gcid": None,
        "name": "N", "title": None, "city": None, "state": None, "zip": None, "lat": None,
        "lng": None, "rating": 4.5, "review_count": 3, "claimed": None, "rank_score": None,
        "completeness_pct": None, "photo_url": None,
    }


def test_strings():
    assert strings(["a", 2, {"label": "L"}, {"x": 1}, " ", True]) == ["a", "2", "L"]
    assert strings({"k1": {"name": "Named"}, "k2": "v", "k3": {}}) == ["Named", "v", "k3"]
    assert strings(None) == []
    assert strings(list("abcdefghij")) == list("abcdefgh")


def test_group_facets_and_tags():
    groups = group_facets([
        {"attribute_id": "a1", "facet_group": None, "facet_label": " ", "value_options": ["x"]},
        {"attribute_id": "a2", "facet_group": "Price", "facet_label": "Budget", "value_options": None},
        {"attribute_id": "a3", "facet_group": None, "facet_label": "L3", "value_options": []},
    ])
    assert groups == [
        {"name": "More filters", "facets": [
            {"attributeId": "a1", "label": "a1", "options": ["x"]},
            {"attributeId": "a3", "label": "L3", "options": []}]},
        {"name": "Price", "facets": [{"attributeId": "a2", "label": "Budget", "options": []}]},
    ]
    tags = collect_tags([{"entity_id": "e1", "title": t} for t in ["A", "a", "B", "C", "D", "E", " "]])
    assert tags == {"e1": ["A", "B", "C", "D"]}


def test_presentation_fn(fake_db, anon_client):
    def responder(sql, params):
        if "exp_search_facets_v" in sql:
            return [{"attribute_id": "a1", "facet_group": "G", "facet_label": "F", "value_options": ["o"]}]
        if "from reviews" in sql:
            return [{"body": "  Loved it "}] if params[1] == "e1" else []
        if "exp_registry_attribute_map" in sql:
            return [{"attribute_id": "a1", "node_slug": "s1"}, {"attribute_id": "zz", "node_slug": "s2"}]
        if "exp_vertical_node_registry" in sql:
            assert params == ["gcid:plumber", ["s1"]]
            return [{"id": "n1", "node_slug": "s1"}]
        if "graph_nodes" in sql:
            return [{"entity_id": "e2", "node_registry_id": "n1", "title": "Licensed"}]
        return []

    db = fake_db(responder)
    res = anon_client.post(
        "/search/fn/getSearchPresentation",
        json={"data": {"gcid": "gcid:plumber", "results": [doc(1), doc(2, "location")]}},
    )
    assert res.status_code == 200
    assert res.json() == {
        "facetGroups": [{"name": "G", "facets": [{"attributeId": "a1", "label": "F", "options": ["o"]}]}],
        "enrichments": {
            "d1": {"reviewQuote": "Loved it", "tags": []},
            "d2": {"reviewQuote": None, "tags": ["Licensed"]},
        },
    }
    review_params = [e[3] for e in db.find("from reviews")]
    assert review_params == [["professional", "e1"], ["organization", "e2"]]
    assert all(e[0] == "anon" and not e[1] for e in db.log)


def test_presentation_validation(anon_client):
    bad = anon_client.post("/search/fn/getSearchPresentation",
                           json={"data": {"gcid": None, "results": [doc(i) for i in range(21)]}})
    assert bad.status_code == 400
    bad = anon_client.post("/search/fn/getSearchPresentation",
                           json={"data": {"gcid": None, "results": [{**doc(1), "entity_type": "x"}]}})
    assert bad.status_code == 400
    bad = anon_client.post("/search/fn/getSearchPresentation", json={"data": {"results": []}})
    assert bad.status_code == 400


def test_presentation_without_gcid_skips_facets(fake_db, anon_client):
    db = fake_db(lambda sql, p: [])
    res = anon_client.post("/search/fn/getSearchPresentation", json={"data": {"gcid": None, "results": []}})
    assert res.json() == {"facetGroups": [], "enrichments": {}}
    assert db.log == []


def test_get_site_indexing_defaults_off(fake_db, anon_client):
    fake_db(lambda sql, p: psycopg.OperationalError("down"))
    assert anon_client.post("/search/fn/getSiteIndexing", json={}).json() == {"enabled": False}
    site_indexing.reset_site_indexing_cache()
    fake_db(lambda sql, p: [{"enabled": True}])
    assert anon_client.post("/search/fn/getSiteIndexing", json={}).json() == {"enabled": True}


def test_search_assistant(anon_client):
    ok = anon_client.post("/search-assistant", json={"question": "  best plumber?  "})
    assert ok.status_code == 200
    assert ok.json() == {"status": "coming_soon", "message": "AI answers coming soon"}
    for body in ({"question": " a "}, {"question": "x" * 301}, {}, None):
        res = anon_client.post("/search-assistant", json=body)
        assert res.status_code == 400 and res.json() == {"error": "Please enter a question."}
    res = anon_client.post("/search-assistant", content=b"not json")
    assert res.status_code == 400
