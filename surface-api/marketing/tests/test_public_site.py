"""Marketing CMS page reads (legacy public-site.functions.ts)."""
from __future__ import annotations

import psycopg
import pytest
from surfaces.marketing.routers.public_site_fn import blocks_of

PAGE = {"id": "p1", "slug": "about", "title": "About", "page_type": "page", "status": "published",
        "body": {"markdown": "# Hi"}}


def test_blocks_of():
    assert blocks_of([{"type": "hero"}]) == [{"type": "hero"}]
    assert blocks_of({"blocks": [{"type": "faq"}]}) == [{"type": "faq"}]
    assert blocks_of({"markdown": "x"}) == [{"type": "rich_text", "markdown": "x"}]
    assert blocks_of("text") == []
    assert blocks_of(None) == []


def test_home_none(fake_db, anon_client):
    db = fake_db(lambda sql, p: [])
    assert anon_client.post("/marketing/fn/getPublicHome", json={}).json() is None
    assert db.log[0][0] == "anon" and "page_type = 'home'" in db.log[0][2]


def test_page_by_slug(fake_db, anon_client):
    db = fake_db(lambda sql, p: [PAGE])
    res = anon_client.post("/marketing/fn/getPublicPageBySlug", json={"data": {"slug": "about"}})
    assert res.json()["body"] == [{"type": "rich_text", "markdown": "# Hi"}]
    assert db.log[0][0] == "anon" and db.log[0][3] == ["about"]


def test_db_error_propagates(fake_db, anon_client):
    fake_db(lambda sql, p: psycopg.errors.UndefinedTable("gone"))
    with pytest.raises(psycopg.errors.UndefinedTable):
        anon_client.post("/marketing/fn/getPublicPageBySlug", json={"data": {"slug": "x"}})
