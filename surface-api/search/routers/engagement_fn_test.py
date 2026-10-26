"""Tests for the engagement function port (DB faked)."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from search.routers.engagement_fn import (
    address_of,
    build_compare,
    merge_card_actions,
    related_terms,
    trim,
)

UID = "11111111-1111-1111-1111-111111111111"


class FakeDB:
    """Records (role, claims, write, sql, params) and answers each query from a responder."""

    def __init__(self, responder: Callable[[str, Any], list[dict]]):
        self.responder = responder
        self.log: list[tuple[str, dict | None, bool, str, Any]] = []

    def role_connection(self, role, jwt_claims=None, *, write=False, fresh=False):
        db = self

        class _Cur:
            def __init__(self):
                self.rows: list[dict] = []

            def execute(self, sql, params=None):
                db.log.append((role, jwt_claims, write, sql, params))
                self.rows = list(db.responder(sql, params))

            def fetchall(self):
                return self.rows

            def fetchone(self):
                return self.rows[0] if self.rows else None

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        class _Conn:
            def cursor(self):
                return _Cur()

        @contextmanager
        def _cm():
            yield _Conn()

        return _cm()


@pytest.fixture
def fake_db(monkeypatch):
    def install(responder: Callable[[str, Any], list[dict]]) -> FakeDB:
        db = FakeDB(responder)
        from search.routers import _sql

        monkeypatch.setattr(_sql, "role_connection", db.role_connection)
        return db

    return install


@pytest.fixture
def client():
    from search.router import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: {"sub": "user-1", "role": "authenticated"}
    return TestClient(app)


def test_trim_and_address():
    assert trim("  a ") == "a"
    assert trim("   ") is None
    assert trim(5) is None
    assert address_of({"address_city": " Austin", "address_state": "TX", "address_zip": ""}) == (
        "Austin, TX"
    )
    assert address_of({}) is None


def test_merge_card_actions_table_first_then_nodes_fill():
    rows = [{"id": UID, "phone": " 555 ", "website_url": None, "email": "", "address_city": "X"}]
    nodes = [
        {"entity_id": UID, "node_type": "contact_phone", "title": "999"},  # table wins
        {"entity_id": UID, "node_type": "website", "title": "Site", "url": " https://a.co "},
        {"entity_id": UID, "node_type": "contact_email", "title": None, "url": "m@a.co"},
        {"entity_id": "other", "node_type": "address", "title": "", "url": ""},  # no value
    ]
    out = merge_card_actions(rows, nodes)
    assert out == {
        UID: {"phone": "555", "website": "https://a.co", "email": "m@a.co", "address": "X"}
    }


def test_get_card_actions_route(client, fake_db):
    def responder(sql, params):
        if "from professionals" in sql:
            return [{"id": UID, "phone": "1", "email": None, "website_url": None}]
        if "from organizations" in sql:
            raise RuntimeError("boom")  # a failed read yields no rows
        return []

    db = fake_db(responder)
    res = client.post(
        "/search/fn/getCardActions", json={"data": {"entityIds": [UID, "", None]}}
    )
    assert res.status_code == 200
    assert res.json() == {UID: {"phone": "1", "website": None, "email": None, "address": None}}
    assert {r[0] for r in db.log} == {"anon"}
    node_q = next(r for r in db.log if "graph_nodes" in r[3])
    assert node_q[4] == ([UID], ["contact_phone", "website", "contact_email", "address"])
    assert "limit 400" in node_q[3]


def test_get_card_actions_empty_and_cap(client, fake_db):
    db = fake_db(lambda sql, params: [])
    assert client.post("/search/fn/getCardActions", json={"data": None}).json() == {}
    ids = [f"id{i}" for i in range(50)]
    client.post("/search/fn/getCardActions", json={"data": {"entityIds": ids}})
    assert len(db.log[0][4][0]) == 40


def test_build_compare_shape():
    docs = [
        {
            "id": "d1", "entity_id": UID, "entity_type": "professional", "slug": "jane",
            "gcid": "gcid:real_estate_agent", "name": "Jane", "city": "Austin", "state": " TX ",
            "rating": Decimal("4.5"), "review_count": 12, "rank_score": None, "photo_url": None,
        }
    ]
    scores = [{"entity_id": UID, "score": Decimal(700), "band": "A",
               "components": {"review_strength": 1.0, "ok": True, "note": "x", "obj": {}}}]
    nodes = [
        {"entity_id": UID, "node_type": "specialty", "title": "Luxury", "extracted_data": None},
        {"entity_id": UID, "node_type": "language", "title": "t",
         "extracted_data": {"language": "Spanish"}},
        {"entity_id": UID, "node_type": "credential", "title": "CRS", "extracted_data": {}},
    ]
    creds = [{"professional_id": UID, "credential_type": "license", "credential_name": "CRS"},
             {"professional_id": UID, "credential_type": "ABR", "credential_name": " "}]
    cats = [{"gcid": "gcid:real_estate_agent", "display_name": "Real estate agent"}]
    out = build_compare(docs, scores, nodes, creds, cats, {})
    assert out == [
        {
            "id": "d1", "entityId": UID, "name": "Jane", "slug": "jane",
            "entityType": "professional", "photoUrl": None,
            "categoryLabel": "Real estate agent", "location": "Austin, TX",
            "rating": 4.5, "reviewCount": 12, "rankScore": None, "score": 700, "band": "A",
            "components": [{"label": "review strength", "value": "1"},
                           {"label": "note", "value": "x"}],
            "specialties": ["Luxury"], "languages": ["Spanish"], "credentials": ["CRS", "ABR"],
            "actions": {"phone": None, "website": None, "email": None, "address": None},
        }
    ]


def test_get_compare_entities_route(client, fake_db):
    def responder(sql, params):
        if "from search_documents" in sql:
            return [{"id": "d1", "entity_id": UID, "name": "Jane", "gcid": None,
                     "rating": None, "review_count": None, "rank_score": None}]
        if "from professionals" in sql:
            return [{"id": UID, "phone": "555"}]
        return []

    db = fake_db(responder)
    res = client.post(
        "/search/fn/getCompareEntities", json={"data": {"docIds": ["d1", "d2", "d3", "d4"]}}
    )
    body = res.json()
    assert res.status_code == 200 and len(body) == 1
    assert body[0]["actions"]["phone"] == "555" and body[0]["categoryLabel"] is None
    assert db.log[0][4] == (["d1", "d2", "d3"],)
    assert not any("gbp_categories" in r[3] for r in db.log)  # no gcids, no category read


def test_related_terms_and_route(client, fake_db):
    rows = [
        {"term_display": "Buyer agent", "term": "buyer_agent", "use_srp": False, "use_search": False},
        {"term_display": " ", "term": "listing agent", "use_srp": None, "use_search": False},
        {"term_display": "Listing agent", "term": "x", "use_srp": True},
        {"term_display": None, "term": None},
    ] + [{"term_display": f"t{i}"} for i in range(20)]
    assert related_terms(rows)[:2] == ["listing agent", "Listing agent"]
    assert len(related_terms(rows)) == 10

    db = fake_db(lambda sql, params: rows)
    assert client.post("/search/fn/getRelatedSearches", json={}).json() == {"terms": []}
    res = client.post(
        "/search/fn/getRelatedSearches", json={"data": {"gcid": "gcid:plumber"}}
    )
    assert len(res.json()["terms"]) == 10
    assert db.log[0][4] == ("gcid:plumber",)
    assert "desc nulls last limit 40" in db.log[0][3]
