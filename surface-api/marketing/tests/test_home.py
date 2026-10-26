"""getHomeData and the search-document helpers it uses (moved from srp, surface audit 2026-10-25)."""
from __future__ import annotations

from surfaces.marketing.home.router import build_home
from surfaces.marketing.internal.search_docs import decode_name, jitter, with_coordinates

CF = {
    "cf-ipcity": "San%20Ramon",
    "cf-region-code": "CA",
    "cf-timezone": "America/Los_Angeles",
    "cf-iplatitude": "37.78",
    "cf-iplongitude": "-121.97",
}


def test_decode_name():
    assert decode_name("Bob&#39;s &amp; Sons &quot;Best&quot; &lt;1&gt;") == "Bob's & Sons \"Best\" <1>"
    assert decode_name(None) == ""


def test_jitter_matches_legacy_js():
    # Values computed with the legacy JS jitter() under node.
    assert jitter("3f2a9c1e-0000-4000-8000-1234567890ab", 0) == 0.006941176470588235
    assert jitter("3f2a9c1e-0000-4000-8000-1234567890ab", 1) == -0.009294117647058824
    assert jitter("abc", 0) == -0.009058823529411765
    assert jitter("x", 1) == -0.0037254901960784314


def test_with_coordinates_fills_city_centroid():
    class Conn:
        def execute(self, sql, params):
            self.sql = sql
            self.params = params
            return type("R", (), {"fetchall": lambda s: [
                {"city": "Austin", "state_abbr": "TX", "lat": 30.0, "lng": -97.0}]})()

        def transaction(self):
            from contextlib import nullcontext
            return nullcontext()

    docs = [
        {"id": "abc", "city": "Austin", "state": "TX", "lat": None, "lng": None},
        {"id": "b", "city": "Austin", "state": "TX", "lat": 1.0, "lng": 2.0},
        {"id": "c", "city": "Nowhere", "state": "ZZ", "lat": None, "lng": None},
    ]
    conn = Conn()
    out = with_coordinates(conn, docs)
    assert conn.params == [["Austin", "Nowhere"]]
    assert out[0]["coord_approx"] is True
    assert out[0]["lat"] == 30.0 + jitter("abc", 0)
    assert out[1] == docs[1]
    assert out[2] == docs[2]


def test_build_home_shapes_payload():
    facets = {
        "categories": [
            {"gcid": "gcid:plumber", "label": "Plumber", "count": 3},
            {"gcid": "gcid:dentist", "label": "Dentist", "count": 9},
            {"gcid": "", "label": "x", "count": 1},
        ],
        "cities": [{"city": "Austin", "state": "TX", "count": 4}, {"city": "", "count": 1}],
        "kinds": [{"entity_type": "professional", "count": 5}, {"entity_type": "brand", "count": 2}],
    }
    out = build_home(
        facets,
        [{"gcid": "gcid:dentist", "display_name": "Dentist"}],
        [{"id": 1, "title": None, "slug": "g"}],
        [{"id": "t", "title": "T", "body_excerpt": "ex"}],
        [{"id": "r", "name": "A &amp; B"}],
        "Austin, TX",
    )
    assert [c["gcid"] for c in out["categories"]] == ["gcid:dentist", "gcid:plumber"]
    assert out["shortcutCategories"] == [{"gcid": "gcid:dentist", "label": "Dentist", "count": 9}]
    assert out["trending"] == [
        {"label": "Dentist in Austin, TX", "gcid": "gcid:dentist", "loc": "Austin, TX", "count": 4}
    ]
    assert out["authorityCount"] == 7
    assert out["totals"] == {"professionals": 5, "locations": 0, "brands": 2}
    assert out["guides"][0]["id"] == "1" and out["guides"][0]["title"] == ""
    assert out["topics"][0]["excerpt"] == "ex"
    assert out["results"][0]["name"] == "A & B"
    assert out["detectedLocation"] == "Austin, TX"


def test_home_fn_wiring(fake_db, anon_client):
    def responder(sql, params):
        if "search_docs_facets" in sql:
            return [{"f": {"categories": [], "cities": [], "kinds": []}}]
        if "search_docs(" in sql:
            return [{"id": "r", "name": "X"}]
        return []

    db = fake_db(responder)
    res = anon_client.post("/marketing/fn/getHomeData", json={"data": None}, headers=CF)
    body = res.json()
    assert res.status_code == 200
    assert body["detectedLocation"] == "San Ramon, CA"
    assert body["results"] == [{"id": "r", "name": "X"}]
    _r, _w, sql, params = db.find("search_docs(")[0]
    assert "p_loc := %s::text" in sql and params[0] == "San Ramon, CA"
    assert all(entry[0] == "anon" for entry in db.log)
