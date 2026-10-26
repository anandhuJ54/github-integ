"""getCityHome / getCityMapPins wiring and the pure pieces they use."""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from surfaces.marketing.city_home.router import (
    build_collections,
    pick_sponsored,
    split_area,
    weekend_in,
)

CATS = [
    {"gcid": "gcid:restaurant", "label": "Restaurant", "count": 10},
    {"gcid": "gcid:plumber", "label": "Plumber", "count": 4},
    {"gcid": "gcid:roofing_contractor", "label": "Roofing contractor", "count": 2},
    {"gcid": "gcid:park", "label": "Park", "count": 1},
]


def test_split_area():
    assert split_area("Austin, TX") == ("Austin", "TX")
    assert split_area("Austin") == ("Austin", None)
    assert split_area("") == ("", None)


def test_weekend_in():
    friday = datetime(2026, 10, 23, 12, tzinfo=UTC)
    monday = datetime(2026, 10, 26, 12, tzinfo=UTC)
    assert weekend_in(None, friday) is True
    assert weekend_in("America/Los_Angeles", monday) is False
    # Monday 03:00 UTC is still Sunday in Los Angeles.
    assert weekend_in("America/Los_Angeles", datetime(2026, 10, 26, 3, tzinfo=UTC)) is True
    assert weekend_in("Not/AZone", friday) is True


def test_collections_with_experts_second():
    facets = {"kinds": [{"entity_type": "professional", "count": 7}]}
    out = build_collections(CATS, facets, is_weekend=True)
    assert [c["key"] for c in out] == ["eat", "experts", "home", "todo"]
    assert out[0] == {
        "key": "eat",
        "title": "Great Places to Eat Near You",
        "q": "best restaurant near me",
        "gcid": "gcid:restaurant",
        "count": 10,
    }
    assert out[2]["gcid"] == "" and out[2]["count"] == 6
    assert out[3]["title"] == "Things to Do This Weekend"
    assert build_collections([], {}, False) == []


def test_pick_sponsored_matches_zip_and_dedupes():
    slots = [
        {"gcid": "gcid:plumber", "geo_type": "zip", "geo_value": "78701", "advertiser_name": "A&amp;B"},
        {"gcid": "gcid:plumber", "geo_type": "city", "geo_value": None, "advertiser_name": None},
    ]
    docs = [
        {"id": "1", "gcid": "gcid:plumber", "zip": "78702", "name": "One"},
        {"id": "2", "gcid": "gcid:plumber", "zip": "78701", "name": "Two"},
    ]
    out = pick_sponsored(slots, docs, {"gcid:plumber": "Plumber"})
    assert [d["id"] for d in out] == ["2", "1"]
    assert out[0]["advertiserName"] == "A&B" and out[0]["categoryLabel"] == "Plumber"
    assert out[1]["advertiserName"] is None and out[0]["nodeCount"] == 0


def _responder(own_count=5):
    def responder(sql, params):
        if "search_docs_count" in sql:
            return [{"n": own_count}]
        if "search_docs_facets" in sql:
            return [{"f": {"categories": CATS, "kinds": [{"entity_type": "professional", "count": 2}]}}]
        if "search_docs(" in sql:
            limit = params[-2]
            if limit == 10:
                return [
                    {"id": "a", "entity_id": "e1", "gcid": "gcid:plumber", "name": "A", "rank_score": 5},
                    {"id": "b", "entity_id": "e2", "gcid": None, "name": "B", "rank_score": 5},
                    {"id": "c", "entity_id": "e3", "gcid": None, "name": "C", "rank_score": 9},
                ]
            return [{"id": "m", "entity_id": "e9", "gcid": None, "name": "M", "lat": 1.0, "lng": 2.0}]
        if "graph_nodes" in sql:
            return [{"entity_id": "e2"}, {"entity_id": "e2"}, {"entity_id": "e1"}]
        if "nearby_cities" in sql:
            return [{"label": "Round Rock, TX", "profile_count": 3}]
        if "exp_voce_article" in sql:
            return [{"id": 1, "title": "T", "slug": None, "topic": "x", "body_excerpt": "e",
                     "author_name": "N", "published_on": "2026-10-01"}]
        if "content_items" in sql:
            return [{"id": "g", "title": "G", "slug": "g", "excerpt": None}]
        return []

    return responder


def test_city_home_wiring(fake_db, anon_client):
    db = fake_db(_responder())
    res = anon_client.post(
        "/marketing/fn/getCityHome",
        json={"data": {"area": "Austin, TX", "page": 2, "rating": 4.5, "claimed": "yes"}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["context"]["scopeCity"] == "Austin"
    assert body["page"] == 2 and body["pageSize"] == 10 and body["total"] == 5
    # rank_score desc, then node count desc.
    assert [r["id"] for r in body["results"]] == ["c", "b", "a"]
    assert body["results"][1]["nodeCount"] == 2
    assert body["results"][2]["categoryLabel"] == "Plumber"
    assert body["nearby"] == [{"label": "Round Rock, TX", "count": 3}]
    assert body["articles"][0]["authorName"] == "N"
    assert body["guides"] == [{"id": "g", "title": "G", "slug": "g", "excerpt": None}]
    assert body["popular"][0] == "best restaurant in Austin"
    assert body["sponsored"] == []
    rows_call = next(e for e in db.find("search_docs(") if e[3][-2] == 10)
    sql, params = rows_call[2], rows_call[3]
    assert "p_min_rating := %s::numeric" in sql and "p_claimed := %s::boolean" in sql
    assert params == ["Austin", Decimal("4.5"), True, "rank", 10, 10]
    assert all(e[0] == "anon" and not e[1] for e in db.log)


def test_city_home_falls_back_to_nearest_inventory(fake_db, anon_client):
    fake_db(_responder(own_count=0))
    body = anon_client.post("/marketing/fn/getCityHome", json={"data": {"area": "Camino Tassajara, CA"}}).json()
    assert body["context"]["label"] == "Camino Tassajara, CA"
    assert body["context"]["scopeCity"] == "Round Rock"
    assert body["context"]["scopeLabel"] == "Round Rock, TX"


def test_city_home_survives_db_errors(fake_db, anon_client):
    import psycopg

    fake_db(lambda sql, p: psycopg.errors.UndefinedTable("nope"))
    res = anon_client.post("/marketing/fn/getCityHome", json={"data": None})
    assert res.status_code == 200
    body = res.json()
    assert body["results"] == [] and body["total"] == 0
    assert body["facets"]["ratings"] == {"r45": 0, "r40": 0, "r30": 0}


def test_map_pins_keep_only_located(fake_db, anon_client):
    def responder(sql, params):
        if "search_docs_count" in sql:
            return [{"n": 1}]
        if "search_docs_facets" in sql:
            return [{"f": {"categories": [{"gcid": "gcid:park", "label": "Park"}]}}]
        if "search_docs(" in sql:
            return [
                {"id": "a", "gcid": "gcid:park", "name": "P", "lat": 1.0, "lng": 2.0, "city": None},
                {"id": "b", "gcid": None, "name": "Q", "lat": None, "lng": None, "city": None},
            ]
        return []

    fake_db(responder)
    body = anon_client.post("/marketing/fn/getCityMapPins", json={"data": {"area": "Austin, TX"}}).json()
    assert body == {
        "pins": [
            {"id": "a", "gcid": "gcid:park", "name": "P", "lat": 1.0, "lng": 2.0, "city": None,
             "categoryLabel": "Park"}
        ]
    }
