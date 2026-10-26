"""Trust Center CMS reads (legacy public-site.functions.ts)."""
from __future__ import annotations

import psycopg
import pytest

from surfaces.search.public_site.router import blocks_of

PAGE = {"id": "p1", "slug": "about", "title": "About", "page_type": "page", "status": "published",
        "body": {"markdown": "# Hi"}}


def test_blocks_of():
    assert blocks_of([{"type": "hero"}]) == [{"type": "hero"}]
    assert blocks_of({"blocks": [{"type": "faq"}]}) == [{"type": "faq"}]
    assert blocks_of({"markdown": "x"}) == [{"type": "rich_text", "markdown": "x"}]
    assert blocks_of("text") == []
    assert blocks_of(None) == []


def test_get_public_page(fake_db, anon_client):
    db = fake_db(lambda sql, p: [PAGE])
    res = anon_client.post(
        "/search/fn/getPublicPage", json={"data": {"slug": "about" * 50, "pageType": "page"}}
    )
    assert res.json()["body"] == [{"type": "rich_text", "markdown": "# Hi"}]
    role, _w, sql, params = db.log[0]
    assert role == "anon" and "exp_web_pages" in sql
    assert len(params[0]) == 200 and params[1] == "page"


def test_trust_docs(fake_db, anon_client):
    db = fake_db(lambda sql, p: [PAGE, {**PAGE, "id": "p2", "body": None}])
    docs = anon_client.post("/search/fn/getPublicTrustDocs", json={}).json()
    assert [d["body"] for d in docs] == [[{"type": "rich_text", "markdown": "# Hi"}], []]
    assert "page_type = 'trust'" in db.log[0][2] and "order by title asc" in db.log[0][2]


def test_db_error_propagates(fake_db, anon_client):
    fake_db(lambda sql, p: psycopg.errors.UndefinedTable("gone"))
    with pytest.raises(psycopg.errors.UndefinedTable):
        anon_client.post("/search/fn/getPublicPage", json={"data": {"slug": "x", "pageType": "trust"}})
