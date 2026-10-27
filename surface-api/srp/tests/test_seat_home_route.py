"""GET /srp/seat/professional/{id}/home (srp/home-page-data, task 3): who may call it, what it returns, and its contract."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import psycopg
import pytest
from pydantic import ValidationError

from _base import auth
from _base.config import get_settings
from surfaces.srp.seat import home
from surfaces.srp.seat.schemas import HomeResponse

SECRET = "L" * 32
SEAT = 42
USER = 7
T1 = datetime(2026, 10, 27, 12, 0, 0)
KEYS = {"as_of", "data", "ready", "day", "person", "trial", "score", "rank", "rival", "competitors", "board", "tiles", "locked", "peers",
        "brief", "drafts", "events", "insights", "recap", "plans"}
CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "srp" / "openapi.json"


class Rows:
    """A small database behind home.connection: the owner exists for seat 42 and user 7, everything else is plain."""

    def __init__(self):
        self.owner = {"id": SEAT, "title": None, "profile_photo": None, "year_started": "2014", "first_name": "Pat", "last_name": "Example", "credentials": 1}
        self.fail = False
        self.ready = True

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if self.fail:
            raise psycopg.OperationalError("connection to host 10.0.0.9 failed: secret detail")
        if low.startswith("set transaction"):
            return []
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            return [self.owner] if int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.home_seat_state" in low:
            return [{"trial_started_at": datetime(2026, 10, 20, 9, 0), "trial_days": 30, "nora_text_day": "Tuesday early morning", "is_mock": True,
                     "claim_snapshot_id": 1, "moves_done": 0, "moves_goal": 3, "streak_weeks": 0, "plan_key": "core", "plan_name": "Core", "plan_tag": None, "plan_position": 1}] if self.ready else []
        if "from srp_cleanup.home_snapshots" in low:
            return [{"id": 1, "as_of": datetime(2026, 10, 20, 9, 0), "total": 300, "band_name": "Building", "rank_position": 12, "rank_of": 41,
                     "rank_city": "Davenport", "profile_strength_pct": 64, "review_avg": 4.9, "review_count": 128, "map_scanned_at": None, "ai_cited": 1, "ai_checked": 7, "ai_checked_at": None},
                    {"id": 2, "as_of": T1, "total": 420, "band_name": "Established", "rank_position": 6, "rank_of": 41, "rank_city": "Davenport", "profile_strength_pct": 64, "review_avg": 4.9, "review_count": 128, "map_scanned_at": None, "ai_cited": 1, "ai_checked": 7, "ai_checked_at": None}]
        if "from srp_cleanup.home_score_lanes" in low:
            return [{"key": "reviews", "name": "Reviews", "max_points": 187, "points": 100}]
        if "from srp_cleanup.home_score_bands" in low:
            return [{"name": "Building", "min_points": 0}, {"name": "Established", "min_points": 400}]
        if "from srp_cleanup.home_competitors" in low:
            return [{"name": "Riverbend Bank & Trust", "score": 571, "is_market_leader": True, "review_count": 412, "review_avg": 4.7,
                     "article_count": 14, "position": 1}]
        for table, answer in {
            "home_activity": [{"label": "Fixed 4 places", "points": 19, "status": "done", "started_at": T1, "completed_at": T1}],
            "home_next_moves": [{"position": 1, "icon": "pen", "title": "Start publishing", "subtitle": None, "recommended": True, "target": "voce", "points": 85}],
            "home_locked_features": [{"feature_key": "listings", "title": "Listings", "description": None, "lane_key": "reviews", "plan_key": "engage", "plan_position": 2}],
            "home_peer_benchmarks": [], "home_weekly_briefs": [], "home_weekly_brief_items": [],
            "home_review_drafts": [{"id": 1, "reviewer_label": "Reviewer A. (mock)", "rating": 5, "review_text": "t", "draft_text": "d", "compliance_status": "passed", "status": "draft"}],
            "home_events": [], "home_nora_insights": [{"position": 1, "title": "t", "body": "b", "cta": None, "action": "voce"}],
            "home_plans": [{"key": "core", "name": "Core", "tag": None, "highlight": False, "items": ["Your profile"]}],
            "home_map_cells": [{"row_no": 0, "col_no": 0, "rank": 2}],
            "voce_articles": [{"published": 1, "total": 2}], "website_analytics_data": [],
        }.items():
            if f"from srp_cleanup.{table}" in low:
                return answer
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.fixture
def rows(monkeypatch, fake_db_for):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", "1")
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", SECRET)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    r = Rows()
    rec = fake_db_for([])(r.responder)
    monkeypatch.setattr(home, "connection", lambda: rec.role_connection("service"))
    r.rec = rec
    yield r
    get_settings.cache_clear()


def _token(user: int = USER) -> dict:
    token, _ = auth.issue_local_token(user, "mock.users@example.test", hours=1)
    return {"authorization": f"Bearer {token}"}


def _url(seat: int | str = SEAT) -> str:
    return f"/srp/seat/professional/{seat}/home"


# --- who may call it ---------------------------------------------------------------------------------


def test_a_local_session_gets_its_own_seats_home(anon_client, rows):
    r = anon_client.get(_url(), headers=_token())
    assert r.status_code == 200
    body = r.json()
    assert set(body) == KEYS and body["ready"] is True and body["data"] == "mock"
    assert body["score"]["total"] == 420 and body["rank"]["position"] == 6 and body["rival"]["points_to_first"] == 151
    assert body["person"]["year_started"] == 2014 and body["score"]["band"]["name"] == "Established"


def test_the_response_matches_the_published_schema_exactly(anon_client, rows):
    body = anon_client.get(_url(), headers=_token()).json()
    assert HomeResponse.model_validate(body).model_dump() == body  # nothing added, dropped or reshaped


def test_another_seat_is_403_and_only_the_ownership_query_ran(anon_client, rows):
    r = anon_client.get(_url(43), headers=_token())
    assert r.status_code == 403 and r.json() == {"detail": "not_your_seat"}
    assert len([q for q in rows.rec.sql() if not q.lower().startswith("set transaction")]) == 1


def test_another_user_on_this_seat_is_403(anon_client, rows):
    assert anon_client.get(_url(), headers=_token(user=8)).status_code == 403


@pytest.mark.parametrize("seat", ["abc", "4 2", "-1", "42.0"])
def test_a_malformed_seat_id_is_403_without_a_query(anon_client, rows, seat):
    assert anon_client.get(_url(seat), headers=_token()).status_code == 403
    assert rows.rec.log == []


def test_a_supabase_session_gets_501_not_implemented_and_no_query(client, rows):
    r = client.get(_url())
    assert r.status_code == 501 and r.json()["detail"].startswith("not_implemented")
    assert rows.rec.log == []


def test_no_token_is_refused(anon_client, rows):
    assert anon_client.get(_url()).status_code in (401, 403)
    assert rows.rec.log == []


def test_a_local_token_is_401_when_local_sign_in_is_off(anon_client, rows, monkeypatch):
    headers = _token()
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    get_settings.cache_clear()
    assert anon_client.get(_url(), headers=headers).status_code == 401
    assert rows.rec.log == []


def test_a_garbage_token_is_401(anon_client, rows):
    assert anon_client.get(_url(), headers={"authorization": "Bearer not.a.jwt"}).status_code == 401


def test_a_database_failure_is_a_clean_503_that_leaks_nothing(anon_client, rows):
    rows.fail = True
    r = anon_client.get(_url(), headers=_token())
    assert r.status_code == 503 and r.json() == {"detail": "database_unavailable"}
    assert "secret" not in r.text and "10.0.0.9" not in r.text


def test_a_connection_pool_timeout_is_also_a_clean_503(anon_client, rows, monkeypatch):
    from psycopg_pool import PoolTimeout

    def boom(*a, **k):
        raise PoolTimeout("couldn't get a connection after 30 sec at host 10.0.0.9")

    monkeypatch.setattr(home, "connection", boom)
    r = anon_client.get(_url(), headers=_token())
    assert r.status_code == 503 and r.json() == {"detail": "database_unavailable"} and "10.0.0.9" not in r.text


# --- the schema and the contract ---------------------------------------------------------------------


def test_a_seat_that_is_not_ready_returns_all_sections_null(anon_client, rows):
    rows.ready = False
    body = anon_client.get(_url(), headers=_token()).json()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(KEYS - {"as_of", "ready", "data"})
    assert HomeResponse.model_validate(body).model_dump() == body


def test_a_layout_outside_the_three_is_refused_by_the_schema():
    base = {k: None for k in KEYS}
    base.update(as_of="x", ready=True, data="mock", day={"n": 1, "trial_days": 30, "layout": "day9", "over": False})
    with pytest.raises(ValidationError):
        HomeResponse.model_validate(base)


def test_the_published_contract_has_the_path_and_its_schema():
    spec = json.loads(CONTRACT.read_text())
    op = spec["paths"]["/srp/seat/professional/{pro_id}/home"]["get"]
    ref = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/HomeResponse")
    props = spec["components"]["schemas"]["HomeResponse"]["properties"]
    assert set(props) == KEYS
    assert {"403", "501"} <= set(op["responses"])
    assert spec["components"]["schemas"]["HomeDay"]["properties"]["layout"]["enum"] == ["day1", "day7", "day24"]


def test_a_day_24_response_keeps_the_word_from_in_the_recap_tiles(anon_client, rows, monkeypatch):
    monkeypatch.setattr(home, "_today", lambda: datetime(2026, 11, 20).date())      # day 32: the last trial day, the day 24 layout
    body = anon_client.get(_url(), headers=_token()).json()
    assert body["day"]["layout"] == "day24" and body["recap"]["tiles"][0] == {"label": "Score", "from": 300, "to": 420, "delta": 120}
    assert HomeResponse.model_validate(body).model_dump(by_alias=True) == body
