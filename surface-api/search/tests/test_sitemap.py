"""robots.txt, sitemaps and the indexing switch (cases from legacy tests/index-floor.test.ts)."""
from __future__ import annotations

from datetime import UTC, datetime

import psycopg
from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.testclient import TestClient
from surfaces.search import robots, site_indexing, sitemap
from surfaces.search.robots import (
    CONSOLE_PATH_PREFIXES,
    robots_txt,
    site_robots_header,
    site_robots_meta,
)
from surfaces.search.site_indexing import parse_indexing_enabled

PARTS = [
    {"partition_key": "priority-high", "min_score": 650},
    {"partition_key": "priority-mid", "min_score": 450},
    {"partition_key": "priority-low", "min_score": 1},
    {"partition_key": "held-below-floor", "min_score": 0},
]
PART = {
    "partition_key": "priority-high",
    "min_score": 650,
    "max_score": None,
    "changefreq": "daily",
    "priority": 0.9,
    "url_count": 3,
    "last_built_at": "2026-10-11T00:00:00Z",
}
URL_ROWS = [{"url": "/p/jane", "lastmod": None, "submitted_at": None, "created_at": None}]


def switch(enabled, partitions=None, urls=None):
    def responder(sql, params):
        if "exp_index_enabled" in sql:
            return [{"enabled": enabled}]
        if "exp_sitemap_partition" in sql:
            return partitions or []
        if "exp_index_queue" in sql:
            return urls or []
        return []

    return responder


# --- pure helpers ---------------------------------------------------------------------------


def test_robots_off_disallows_everything():
    for body in (robots_txt("https://example.test", False), robots_txt("https://example.test")):
        assert body == "User-agent: *\nDisallow: /\n"
        assert "Sitemap:" not in body


def test_robots_on_points_at_sitemap_and_keeps_console_out():
    body = robots_txt("https://example.test", True)
    assert "Sitemap: https://example.test/api/public/sitemap.xml" in body
    assert "Disallow: /api/" in body
    assert "Allow: /api/public/sitemap.xml" in body
    assert "Allow: /api/public/sitemap/" in body
    assert "Disallow: /" not in body.split("\n")
    for prefix in CONSOLE_PATH_PREFIXES:
        assert f"Disallow: /{prefix}$" in body
        assert f"Disallow: /{prefix}/" in body


def test_switch_parsing_and_headers():
    assert parse_indexing_enabled(True)
    assert parse_indexing_enabled(" TRUE ")
    assert not parse_indexing_enabled("false")
    assert not parse_indexing_enabled(1)
    assert not parse_indexing_enabled(None)
    assert site_robots_meta(False) == {"name": "robots", "content": "noindex,nofollow"}
    assert site_robots_meta(True) is None
    assert site_robots_header(False) == "noindex, nofollow"
    assert site_robots_header(True) is None


def test_band_ranges_open_top_and_bottom():
    ranges = sitemap.band_ranges(PARTS, sitemap.INDEXABLE_PARTITIONS)
    assert ranges["priority-high"] == {"min": 650.0, "maxExclusive": None}
    assert ranges["priority-mid"] == {"min": 450.0, "maxExclusive": 650.0}
    assert ranges["priority-low"] == {"min": None, "maxExclusive": 450.0}
    assert "held-below-floor" not in ranges
    assert sitemap.band_for_score(700, PARTS, sitemap.INDEXABLE_PARTITIONS) == "priority-high"
    assert sitemap.band_for_score(0, PARTS, sitemap.INDEXABLE_PARTITIONS) == "priority-low"


def test_xml_empty_when_off_and_lists_when_on():
    for xml in (sitemap.sitemap_index_xml("https://x.test", [PART], False),
                sitemap.sitemap_index_xml("https://x.test", [PART])):
        assert "<sitemapindex" in xml and "<sitemap>" not in xml
    for xml in (sitemap.url_set_xml("https://x.test", PART, URL_ROWS, False),
                sitemap.url_set_xml("https://x.test", PART, URL_ROWS)):
        assert "<urlset" in xml and "<url>" not in xml
    index = sitemap.sitemap_index_xml("https://x.test", [PART], True)
    assert (
        "  <sitemap><loc>https://x.test/api/public/sitemap/priority-high.xml</loc>"
        "<lastmod>2026-10-11T00:00:00.000Z</lastmod></sitemap>" in index
    )
    urlset = sitemap.url_set_xml("https://x.test", PART, URL_ROWS, True)
    assert (
        "  <url><loc>https://x.test/p/jane</loc><changefreq>daily</changefreq>"
        "<priority>0.9</priority></url>" in urlset
    )


def test_js_iso_and_fixed():
    assert sitemap.js_iso(datetime(2026, 10, 11, 5, 6, 7, 891000, tzinfo=UTC)) == (
        "2026-10-11T05:06:07.891Z"
    )
    assert sitemap.js_iso("2026-10-11T00:00:00+02:00") == "2026-10-10T22:00:00.000Z"
    assert sitemap._fixed1(0.25) == "0.3"  # JS toFixed rounds the exact half up
    assert sitemap._fixed1(1) == "1.0"


def test_site_robots_header_reads_switch_and_fails_closed(fake_db):
    fake_db(switch(False))
    assert site_robots_header() == "noindex, nofollow"
    site_indexing.reset_site_indexing_cache()
    fake_db(lambda sql, p: psycopg.OperationalError("down"))
    assert site_robots_header() == "noindex, nofollow"
    resp = robots.apply_site_robots_header(Response("x"), enabled=False)
    assert resp.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert "X-Robots-Tag" not in robots.apply_site_robots_header(Response("x"), True).headers


def test_switch_is_cached(fake_db):
    db = fake_db(switch(True))
    assert site_indexing.load_site_indexing_enabled() is True
    assert site_indexing.load_site_indexing_enabled() is True
    assert len(db.find("exp_index_enabled")) == 1
    assert db.log[0][0] == "anon"


# --- routes ---------------------------------------------------------------------------------


def _client():
    from surfaces.search.routers.sitemap import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app, base_url="https://example.test")


def test_robots_route_off(fake_db):
    fake_db(switch(False))
    res = _client().get("/robots.txt")
    assert res.status_code == 200
    assert res.text == "User-agent: *\nDisallow: /\n"
    assert res.headers["content-type"] == "text/plain; charset=utf-8"
    assert res.headers["cache-control"] == "public, max-age=300"


def test_robots_route_on(fake_db):
    fake_db(switch("true"))
    res = _client().get("/robots.txt")
    assert "Sitemap: https://example.test/api/public/sitemap.xml" in res.text
    assert res.headers["cache-control"] == "public, max-age=3600"


def test_sitemap_index_off_reads_no_partitions(fake_db):
    db = fake_db(switch(False, [PART]))
    res = _client().get("/public/sitemap.xml")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/xml; charset=utf-8"
    assert res.headers["cache-control"] == "public, max-age=900"
    assert "<sitemap>" not in res.text
    assert not db.find("exp_sitemap_partition")


def test_sitemap_index_on(fake_db):
    fake_db(switch(True, [PART]))
    res = _client().get("/public/sitemap.xml")
    assert "https://example.test/api/public/sitemap/priority-high.xml" in res.text


def test_site_origin_setting_wins_over_the_request_host(fake_db, monkeypatch):
    from _base.config import get_settings

    monkeypatch.setenv("SITE_ORIGIN", "https://site.test/")
    get_settings.cache_clear()
    try:
        fake_db(switch(True, [PART]))
        assert "Sitemap: https://site.test/api/public/sitemap.xml" in _client().get("/robots.txt").text
        assert "https://site.test/api/public/sitemap/priority-high.xml" in _client().get("/public/sitemap.xml").text
    finally:
        monkeypatch.delenv("SITE_ORIGIN")
        get_settings.cache_clear()


def test_partition_unknown_is_404(fake_db):
    fake_db(switch(True))
    res = _client().get("/public/sitemap/held-below-floor.xml")
    assert res.status_code == 404
    assert res.text == "Not found"


def test_partition_off_is_empty_urlset(fake_db):
    db = fake_db(switch(False))
    res = _client().get("/public/sitemap/priority-high.xml")
    assert res.status_code == 200
    assert "<urlset" in res.text and "<url>" not in res.text
    assert not db.find("exp_index_queue")


def test_partition_on_queries_band(fake_db):
    parts = [{**PART}, {**PART, "partition_key": "priority-mid", "min_score": 450}]
    db = fake_db(switch(True, parts, URL_ROWS))
    res = _client().get("/public/sitemap/priority-mid")
    assert "<loc>https://example.test/p/jane</loc>" in res.text
    (_role, _w, sql, params) = db.find("exp_index_queue")[0]
    assert "state <> 'held'" in sql and "nulls last" in sql
    # priority-mid is the lowest indexable band here: open below, capped at 650.
    assert "score >= %s" not in sql and "score < %s" in sql
    assert float(params[0]) == 650.0 and params[-1] == 45000


def test_partition_on_missing_row_is_404(fake_db):
    fake_db(switch(True, []))
    assert _client().get("/public/sitemap/priority-low.xml").status_code == 404
