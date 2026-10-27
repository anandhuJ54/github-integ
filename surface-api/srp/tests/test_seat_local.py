"""Local seat read (srp/local-login-srp-home, task 7): a local sign-in's own professional seat,
answered from `srp_cleanup` in the shape `GET /srp/seat/professional/{id}` already has."""
from __future__ import annotations

import pytest

from _base import auth
from _base.config import get_settings
from surfaces.srp.seat import local
from surfaces.srp.seat import router as seat_router

SECRET = "L" * 32
USER_ID = 7
SEAT_ID = 42
SEAT_KEYS = {"pro", "office", "brand", "score", "ratings", "reviews", "nodes"}
# the UI's SeatPro type (surface-ui/srp/src/utils/seat.ts)
PRO_KEYS = {
    "id", "display_name", "first_name", "last_name", "slug", "photo_url", "bio", "headline", "job_title",
    "email", "phone", "gcid", "address_city", "address_state", "search_rank_score", "claimed", "is_demo",
    "primary_org_id",
}
OFFICE_KEYS = {"id", "name", "slug", "logo_url", "address_city", "address_state", "parent_org_id"}

SEAT_ROW = {
    "id": SEAT_ID, "title": "Senior Advisor", "slug": "riley-okafor", "tag_line": "Local, always",
    "description": "Mock bio.", "profile_photo": "https://example.test/p.jpg", "phone_number": "+15550001111",
    "tier_id": 5, "first_name": "Riley", "last_name": "Okafor", "email": "mock.users.7@example.test",
    "tier_name": "Mock Tier 5", "city": "Austin", "state_code": "TX",
}


class SeatDB:
    def __init__(self):
        self.seat = dict(SEAT_ROW)
        self.score_rows = [
            {"category_id": 1, "name": "Cat one", "score": 100, "max": 150, "zipcode": "52801", "vertical_id": 1, "updated_at": "2026-09-01 10:00:00"},
            {"category_id": 2, "name": "Cat two", "score": 310, "max": 400, "zipcode": "52801", "vertical_id": 1, "updated_at": "2026-08-01 10:00:00"},
        ]

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            ok = self.seat is not None and int(seat_id) == self.seat["id"] and int(user_id) == USER_ID
            return [self.seat] if ok else []
        if low.startswith("select distinct on (s.srs_config_category_id)"):  # the score helper shared with the Home read
            return list(self.score_rows)
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.fixture
def seat_db(monkeypatch, fake_db_for):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", "1")
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", SECRET)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    get_settings.cache_clear()
    s = SeatDB()
    db = fake_db_for([])(s.responder)
    monkeypatch.setattr(local, "connection", lambda: db.role_connection("service"))
    s.db = db
    yield s
    get_settings.cache_clear()


def _auth(user_id: int = USER_ID) -> dict:
    token, _ = auth.issue_local_token(user_id, "mock.users.7@example.test", hours=1)
    return {"authorization": f"Bearer {token}"}


# --- the professional seat (criterion 13) ------------------------------------------------------


def test_own_seat_has_the_same_keys_as_the_existing_endpoint(anon_client, seat_db):
    r = anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert set(body) == SEAT_KEYS
    assert set(body["pro"]) == PRO_KEYS
    assert set(body["office"]) == OFFICE_KEYS


def test_the_professional_is_mapped_from_the_mock_tables(anon_client, seat_db):
    pro = anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth()).json()["pro"]
    assert pro["id"] == str(SEAT_ID)
    assert pro["display_name"] == "Riley Okafor"
    assert (pro["first_name"], pro["last_name"]) == ("Riley", "Okafor")
    assert pro["slug"] == "riley-okafor"
    assert pro["photo_url"] == "https://example.test/p.jpg"
    assert pro["bio"] == "Mock bio." and pro["headline"] == "Local, always"
    assert pro["job_title"] == "Senior Advisor"
    assert pro["email"] == "mock.users.7@example.test" and pro["phone"] == "+15550001111"
    assert (pro["address_city"], pro["address_state"]) == ("Austin", "TX")
    assert pro["is_demo"] is True  # it is mock data
    assert pro["gcid"] is None and pro["claimed"] is None  # nothing in srp_cleanup says otherwise


def test_the_office_is_the_tier_and_its_first_location(anon_client, seat_db):
    body = anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth()).json()
    assert body["pro"]["primary_org_id"] == "5"
    assert body["office"] == {
        "id": "5", "name": "Mock Tier 5", "slug": None, "logo_url": None,
        "address_city": "Austin", "address_state": "TX", "parent_org_id": None,
    }
    assert body["brand"] is None


def test_ratings_reviews_and_nodes_are_empty_not_invented(anon_client, seat_db):
    body = anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth()).json()
    assert body["ratings"] == [] and body["reviews"] is None and body["nodes"] is None


def test_the_score_is_the_sum_of_the_stored_category_scores(anon_client, seat_db):
    score = anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth()).json()["score"]
    assert score["total_score"] == 410
    assert score["calculated_at"] is not None
    assert score["max_possible"] is None and score["score_pct"] is None  # not derivable from the tables


def test_no_stored_scores_means_no_score(anon_client, seat_db):
    seat_db.score_rows = []
    assert anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth()).json()["score"] is None


def test_scores_that_are_all_null_give_an_unknown_total_not_zero(anon_client, seat_db):
    for r in seat_db.score_rows:
        r["score"] = None
    score = anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth()).json()["score"]
    assert score is not None and score["total_score"] is None


def test_the_seat_and_the_home_read_use_the_same_score_query(anon_client, seat_db):
    anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth())
    sql = " ".join(next(q for q in seat_db.db.sql() if "user_search_rank_scores" in q).lower().split())
    from surfaces.srp.seat import score_query

    assert sql == " ".join(score_query.scores_sql("srp_cleanup").lower().split())


def test_the_seat_query_is_limited_to_the_users_own_active_seat(anon_client, seat_db):
    anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth())
    sql = " ".join(seat_db.db.find("tier_agents")[0][2].lower().split())
    assert "ta.user_id = %s" in sql and "ta.deleted_at is null" in sql
    for guard in ("u.deleted_at is null", "u.deactivated_at is null", "is_manual_deactivated"):
        assert guard in sql
    assert seat_db.db.find("tier_agents")[0][3] == (SEAT_ID, USER_ID)


def test_another_users_seat_is_403(anon_client, seat_db):
    r = anon_client.get("/srp/seat/professional/43", headers=_auth())
    assert r.status_code == 403


def test_another_user_signed_in_cannot_read_this_seat(anon_client, seat_db):
    assert anon_client.get(f"/srp/seat/professional/{SEAT_ID}", headers=_auth(user_id=8)).status_code == 403


@pytest.mark.parametrize("pro_id", ["abc", "4 2", "-1", "42.0", "1" * 40])
def test_a_non_numeric_id_is_403_without_a_database_call(anon_client, seat_db, pro_id):
    assert anon_client.get(f"/srp/seat/professional/{pro_id}", headers=_auth()).status_code == 403
    assert seat_db.db.log == []


# --- the other two loaders the layout calls ----------------------------------------------------


def test_office_mode_is_null_for_a_local_session(anon_client, seat_db):
    r = anon_client.post(
        "/srp/rpc/exp_office_mode",
        json={"args": {"p_entity_type": "professional", "p_entity_id": str(SEAT_ID)}},
        headers=_auth(),
    )
    assert r.status_code == 200 and r.json() is None
    assert seat_db.db.log == []


def test_any_other_rpc_is_not_implemented_for_a_local_session(anon_client, seat_db):
    r = anon_client.post("/srp/rpc/some_other_rpc", json={"args": {}}, headers=_auth())
    assert r.status_code == 501
    assert r.json()["detail"].startswith("not_implemented")


def test_listings_are_empty_for_a_local_session(anon_client, seat_db):
    r = anon_client.get(
        "/srp/seat/listings", params={"entity_type": "professional", "entity_id": str(SEAT_ID)}, headers=_auth()
    )
    assert r.status_code == 200 and r.json() == []
    assert seat_db.db.log == []


# --- everyone else keeps today's behaviour ------------------------------------------------------


def test_a_supabase_session_never_takes_the_local_path(client, monkeypatch, seat_db):
    def boom(*a, **k):
        raise AssertionError("local path used for a non-local session")

    monkeypatch.setattr(local, "professional_seat", boom)
    monkeypatch.setattr(local, "office_mode", boom)
    monkeypatch.setattr(local, "listings", boom)
    monkeypatch.setattr(
        seat_router,
        "_read_with",
        lambda claims, fn, *a: {"existing": True} if fn.__name__ == "professional_seat" else ["existing"],
    )
    assert client.get("/srp/seat/professional/x").json() == {"existing": True}
    listed = client.get("/srp/seat/listings", params={"entity_type": "professional", "entity_id": "x"})
    assert listed.json() == ["existing"]
