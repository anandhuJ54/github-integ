"""GET /srp/seat/professional/{id}/insights (srp/insights-page-schema, task 6): who may call it, what it returns, and its contract."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import psycopg
import pytest
from pydantic import ValidationError

from _base import auth
from _base.config import get_settings
from surfaces.srp.seat import insights
from surfaces.srp.seat.schemas import InsightsResponse

SECRET = "L" * 32
SEAT = 42
USER = 7
KEYS = {"as_of", "data", "ready", "visibility", "map", "ai", "competitors", "target", "locked", "notes"}
CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "srp" / "openapi.json"


class Rows:
    """A small database behind insights.connection: the owner exists for seat 42 and user 7, everything else is plain."""

    def __init__(self):
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
            return [{"id": SEAT, "first_name": "Pat", "last_name": "Example"}] if int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.insights_visibility" in low:
            return [{"metric": "calls", "value": 41, "period_days": 30, "source": "From Google", "trust_tier": "imported", "is_mock": True}] if self.ready else []
        if "from srp_cleanup.insights_ai_engines" in low:
            return [{"engine": "chatgpt", "cited": 1, "checked": 3, "note": "Names you for refinance questions.", "is_mock": True}] if self.ready else []
        if "from srp_cleanup.insights_competitor_positions" in low:
            return [{"competitor_id": 11, "avg_position": 2.1, "is_mock": True}] if self.ready else []
        if "from srp_cleanup.insights_spot_leaders" in low:
            return [{"cell_id": 5, "position": 1, "name": "Riverbend Bank & Trust", "is_you": False, "is_mock": True}] if self.ready else []
        if "from srp_cleanup.home_snapshots" in low:
            return [{"id": 9, "review_avg": 4.9, "review_count": 128, "map_scanned_at": datetime(2026, 10, 16, 9, 0)}]
        if "from srp_cleanup.home_map_cells" in low:
            return [{"id": 5, "row_no": 3, "col_no": 3, "rank": 2}]
        if "from srp_cleanup.home_competitors" in low:
            return [{"id": 11, "name": "Riverbend Bank & Trust", "score": 500, "is_market_leader": True, "review_count": 412, "review_avg": 4.7,
                     "article_count": 14, "position": 1}]
        if "from srp_cleanup.profile_facts" in low:
            return [{"value": "100 Main St, Davenport, IA 52801"}]
        if "from srp_cleanup.home_seat_state" in low:
            return [{"plan_position": 1, "top_position": 3}]
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
    monkeypatch.setattr(insights, "connection", lambda: rec.role_connection("service"))
    r.rec = rec
    yield r
    get_settings.cache_clear()


def _token(user: int = USER) -> dict:
    token, _ = auth.issue_local_token(user, "mock.users@example.test", hours=1)
    return {"authorization": f"Bearer {token}"}


def _url(seat: int | str = SEAT) -> str:
    return f"/srp/seat/professional/{seat}/insights"


# --- who may call it ---------------------------------------------------------------------------------


def test_a_local_session_gets_its_own_seats_insights(anon_client, rows):
    r = anon_client.get(_url(), headers=_token())
    assert r.status_code == 200
    body = r.json()
    assert set(body) == KEYS and body["ready"] is True and body["data"] == "mock"
    assert body["visibility"][0]["metric"] == "calls" and body["visibility"][0]["source_line"] == "Last 30 days · From Google"
    assert body["map"]["address"] == "100 Main St, Davenport, IA 52801" and body["map"]["spots"] == 1 and body["map"]["cells"][0]["leaders"][0]["name"] == "Riverbend Bank & Trust"
    assert body["ai"] == {"cited": 1, "checked": 3, "engines": [{"engine": "chatgpt", "cited": 1, "checked": 3, "note": "Names you for refinance questions."}]}
    assert [c["name"] for c in body["competitors"]] == ["Pat Example", "Riverbend Bank & Trust"]  # the one cell is ranked 2, so the seat averages 2.0 < 2.1 and body["target"] == {"name": "Riverbend Bank & Trust"}
    assert [x["key"] for x in body["locked"]] == ["map_rank_tracking", "ai_citation_monitoring"] and len(body["notes"]) == 2


def test_the_response_matches_the_published_schema_exactly(anon_client, rows):
    body = anon_client.get(_url(), headers=_token()).json()
    assert InsightsResponse.model_validate(body).model_dump() == body  # nothing added, dropped or reshaped


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

    monkeypatch.setattr(insights, "connection", boom)
    r = anon_client.get(_url(), headers=_token())
    assert r.status_code == 503 and r.json() == {"detail": "database_unavailable"} and "10.0.0.9" not in r.text


# --- the schema and the contract ---------------------------------------------------------------------


def test_a_seat_that_is_not_ready_returns_all_sections_null(anon_client, rows):
    rows.ready = False
    body = anon_client.get(_url(), headers=_token()).json()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(KEYS - {"as_of", "ready", "data"})
    assert InsightsResponse.model_validate(body).model_dump() == body


def test_a_metric_engine_or_tier_outside_the_vocabulary_is_refused_by_the_schema(anon_client, rows):
    for mutate in (lambda b: b["visibility"][0].update(metric="views"), lambda b: b["visibility"][0].update(trust_tier="verified"),
                   lambda b: b["ai"]["engines"][0].update(engine="bing"), lambda b: b["locked"][0].update(key="other")):
        body = anon_client.get(_url(), headers=_token()).json()
        mutate(body)
        with pytest.raises(ValidationError):
            InsightsResponse.model_validate(body)


def test_the_published_contract_has_the_path_and_its_schema():
    spec = json.loads(CONTRACT.read_text())
    op = spec["paths"]["/srp/seat/professional/{pro_id}/insights"]["get"]
    ref = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/InsightsResponse")
    assert set(spec["components"]["schemas"]["InsightsResponse"]["properties"]) == KEYS
    assert {"403", "501"} <= set(op["responses"])
    assert spec["components"]["schemas"]["InsightsVisibility"]["properties"]["metric"]["enum"] == [
        "search_views", "maps_views", "calls", "directions", "website_clicks", "profile_views"]
    for other in ("/home", "/srs", "/profile"):
        assert f"/srp/seat/professional/{{pro_id}}{other}" in spec["paths"], "the earlier paths are still published"
