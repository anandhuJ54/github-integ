"""Geo detection, nearby cities and the geo server functions."""
from __future__ import annotations

import pytest

from search import geo

CF = {
    "cf-ipcity": "San%20Ramon",
    "cf-region-code": "CA",
    "cf-timezone": "America/Los_Angeles",
    "cf-iplatitude": "37.78",
    "cf-iplongitude": "-121.97",
}


def test_detect_from_edge_headers():
    area = geo.detect_area(CF)
    assert area == {
        "city": "San Ramon",
        "region": "CA",
        "label": "San Ramon, CA",
        "timezone": "America/Los_Angeles",
        "latitude": 37.78,
        "longitude": -121.97,
    }


def test_private_ip_is_not_looked_up(monkeypatch):
    monkeypatch.setattr(geo.httpx, "get", lambda *a, **k: pytest.fail("no lookup"))
    for ip in ("127.0.0.1", "10.1.2.3", "192.168.0.4", "::1"):
        assert geo.detect_area({"x-forwarded-for": ip}) is None
    assert geo.detect_area({}) is None


def test_ip_lookup_is_cached_and_city_level(monkeypatch):
    calls = []

    class Res:
        is_success = True

        def json(self):
            return {"city": "Austin", "region_code": "TX", "timezone": "America/Chicago",
                    "latitude": 30.27, "longitude": -97.74}

    def fake_get(url, headers=None):
        calls.append(url)
        return Res()

    geo._ip_cache.clear()
    monkeypatch.setattr(geo.httpx, "get", fake_get)
    hdrs = {"x-forwarded-for": "203.0.113.9, 10.0.0.1"}
    assert geo.detect_area(hdrs)["label"] == "Austin, TX"
    assert geo.detect_area(hdrs)["latitude"] == 30.27
    assert calls == ["https://ipapi.co/203.0.113.9/json/"]
    assert all("203.0.113.9" not in k for k in geo._ip_cache)  # raw IP never kept


def test_detected_area_fn(anon_client):
    res = anon_client.post("/search/fn/getDetectedArea", json={"data": None}, headers=CF)
    assert res.json() == {"label": "San Ramon, CA", "city": "San Ramon", "region": "CA"}
    res = anon_client.post("/search/fn/getDetectedArea", json={"data": None})
    assert res.json() == {"label": "", "city": "", "region": None}


def test_nearby_areas_fn_uses_city_centroid(fake_db, anon_client):
    def responder(sql, params):
        if "exp_us_cities" in sql:
            return [{"lat": 30.2, "lng": -97.7, "state_abbr": "TX"}]
        if "nearby_cities" in sql:
            return [{"label": "Round Rock, TX", "profile_count": 12}]
        return []

    db = fake_db(responder)
    res = anon_client.post("/search/fn/getNearbyAreas", json={"data": {"city": " Austin ", "region": "TX"}})
    assert res.json() == [{"label": "Round Rock, TX", "count": 12}]
    role, _w, sql, params = db.find("nearby_cities")[0]
    assert role == "anon"
    assert "p_lat := %s::double precision" in sql
    assert params == [30.2, -97.7, 6, "Austin", "TX"]


def test_resolve_area_from_coords(fake_db, anon_client):
    db = fake_db(lambda sql, p: [{"label": "Dublin, CA"}])
    res = anon_client.post("/search/fn/resolveAreaFromCoords", json={"data": {"lat": "37.7", "lng": -121.9}})
    assert res.json() == {"label": "Dublin, CA"}
    assert db.log[0][3] == [37.7, -121.9, 1]
    res = anon_client.post("/search/fn/resolveAreaFromCoords", json={"data": {"lat": "x", "lng": 1}})
    assert res.json() == {"label": ""}
