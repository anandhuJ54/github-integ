"""GET /srp/seat/professional/{id}/website (srp/web-analytics-page-schema, task 6): who may call it, what it returns, and its contract."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import psycopg
import pytest
from pydantic import ValidationError

from _base import auth
from _base.config import get_settings
from surfaces.srp.seat import web_analytics
from surfaces.srp.seat.schemas import WebAnalyticsResponse

SECRET = "L" * 32
SEAT = 42
USER = 7
KEYS = {"as_of", "data", "ready", "site", "health", "checks", "counts", "tiles", "top_fix", "notes", "facts"}
CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "srp" / "openapi.json"
SCAN = ("From your site scan", "platform_observed")


def check(key, state, result, points=None, maximum=None, headline=None):
    return {"check_key": key, "state": state, "result": result, "headline": headline, "points": points, "points_max": maximum, "source": SCAN[0], "trust_tier": SCAN[1], "is_mock": True}


class Rows:
    """A small database behind web_analytics.connection: the owner exists for seat 42 and user 7, everything else is plain."""

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
        if "from srp_cleanup.web_checks" in low:
            if not self.ready:
                return []
            return [check("entity_markup", "fail", "No structured data on the page", 0, 42), check("nap", "pass", "Matches the profile", 30, 30),
                    check("speed", "warn", "LCP 3.1 s (needs work), INP 180 ms, CLS 0.02", headline="LCP 3.1 s"),
                    check("ai_readiness", "fail", "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content built by scripts; missing title or description tags", headline="0 of 5"),
                    check("security", "pass", "HTTPS")]
        if "from srp_cleanup.home_snapshots" in low:
            return [{"id": 9}]
        if "from srp_cleanup.home_snapshot_lanes" in low:
            return [{"points": 30, "max_points": 102}]
        if "from srp_cleanup.website_analytics_data" in low:
            return [{"website_url": "https://example.test/seat-42", "last_refreshed_time": datetime(2026, 10, 16, 9, 0)}]
        if "from srp_cleanup.profile_facts" in low:
            return [{"field": "address", "value": "100 Main St, Davenport, IA 52801"}]
        if "from srp_cleanup.tier_agents where" in low:
            return [{"phone_number": "+15635550100"}]
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
    monkeypatch.setattr(web_analytics, "connection", lambda: rec.role_connection("service"))
    r.rec = rec
    yield r
    get_settings.cache_clear()


def _token(user: int = USER) -> dict:
    token, _ = auth.issue_local_token(user, "mock.users@example.test", hours=1)
    return {"authorization": f"Bearer {token}"}


def _url(seat: int | str = SEAT) -> str:
    return f"/srp/seat/professional/{seat}/website"


# --- who may call it ---------------------------------------------------------------------------------


def test_a_local_session_gets_its_own_seats_web_analytics(anon_client, rows):
    r = anon_client.get(_url(), headers=_token())
    assert r.status_code == 200
    body = r.json()
    assert set(body) == KEYS and body["ready"] is True and body["data"] == "mock"
    assert body["site"] == {"url": "example.test/seat-42", "last_checked": "2026-10-16T09:00:00Z"} and body["health"] == {"earned": 30, "max": 102, "open": 72}
    assert [c["key"] for c in body["checks"]] == ["entity_markup", "nap", "speed", "ai_readiness", "security"] and body["counts"] == {"all": 5, "fail": 2, "warn": 1, "pass": 2}
    assert [t["key"] for t in body["tiles"]] == ["speed", "markup", "ai_readiness"] and body["top_fix"]["open"] == 42 and "Pat Example" in body["top_fix"]["snippet"]
    assert [n["cta"] for n in body["notes"]] == ["Send to my webmaster", "See the checks"] and body["facts"]["phone"] == "+15635550100"


def test_the_response_matches_the_published_schema_exactly(anon_client, rows):
    body = anon_client.get(_url(), headers=_token()).json()
    assert WebAnalyticsResponse.model_validate(body).model_dump(by_alias=True) == body  # nothing added, dropped or reshaped
    assert "pass" in body["counts"] and "pass_" not in body["counts"]


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

    monkeypatch.setattr(web_analytics, "connection", boom)
    r = anon_client.get(_url(), headers=_token())
    assert r.status_code == 503 and r.json() == {"detail": "database_unavailable"} and "10.0.0.9" not in r.text


# --- the schema and the contract ---------------------------------------------------------------------


def test_a_seat_that_is_not_ready_returns_all_sections_null(anon_client, rows):
    rows.ready = False
    body = anon_client.get(_url(), headers=_token()).json()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(KEYS - {"as_of", "ready", "data"})
    assert WebAnalyticsResponse.model_validate(body).model_dump(by_alias=True) == body


def test_a_key_state_tier_or_action_outside_the_vocabulary_is_refused_by_the_schema(anon_client, rows):
    for mutate in (lambda b: b["checks"][0].update(key="markup"), lambda b: b["checks"][0].update(state="ok"), lambda b: b["checks"][0].update(trust_tier="verified"),
                   lambda b: b["tiles"][0].update(key="other"), lambda b: b["notes"][0].update(action="email")):
        body = anon_client.get(_url(), headers=_token()).json()
        mutate(body)
        with pytest.raises(ValidationError):
            WebAnalyticsResponse.model_validate(body)


def test_the_published_contract_has_the_path_and_its_schema():
    spec = json.loads(CONTRACT.read_text())
    op = spec["paths"]["/srp/seat/professional/{pro_id}/website"]["get"]
    ref = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/WebAnalyticsResponse")
    assert set(spec["components"]["schemas"]["WebAnalyticsResponse"]["properties"]) == KEYS
    assert {"403", "501"} <= set(op["responses"])
    assert spec["components"]["schemas"]["WebCheck"]["properties"]["key"]["enum"] == [
        "entity_markup", "nap", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion", "reviews_on_site", "security"]
    assert set(spec["components"]["schemas"]["WebCounts"]["properties"]) == {"all", "fail", "warn", "pass"}
    for other in ("/home", "/srs", "/profile", "/insights"):
        assert f"/srp/seat/professional/{{pro_id}}{other}" in spec["paths"], "the earlier paths are still published"
