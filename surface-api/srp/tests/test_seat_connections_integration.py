"""The Connections read on real Postgres (srp/connections-page-schema, task 7): the seeded rows, the computed parts, ownership, read-only, and that the page agrees with the
SRS page, Web analytics and the Profile for the same seat (spec criteria 3 to 8).

Skipped unless SRP_TEST_DATABASE_URL points at a database with the `srp_cleanup` schema (its table shapes are copied into a scratch schema, the Home, SRS, Profile, Insights and Web
analytics tables are created there by their scripts, and the seed fills them; the scratch schema is dropped afterwards):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/v3_local uv run pytest srp/tests/test_seat_connections_integration.py
"""
from __future__ import annotations

import os
import re
import uuid
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import psycopg
import pytest
from fastapi import HTTPException
from psycopg import errors
from psycopg.rows import dict_row

from _base.config import get_settings
from _base.db import session as db_session
from surfaces.srp.seat import connections, profile, srs, web_analytics
from surfaces.srp.seat import seed_connections_plan as cpn
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat.schemas import ConnectionsResponse

URL = os.environ.get("SRP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="SRP_TEST_DATABASE_URL is not set")

TABLES = ["users", "tier_agents", "tier_agent_details", "srs_config_categories", "user_search_rank_scores", "voce_articles",
          "website_analytics_data", "ai_authority_stats"]
SCRIPT = Path(__file__).resolve().parents[1] / "db" / "local" / "home_schema.sql"
HARDENING = SCRIPT.with_name("home_schema_hardening.sql")
TODAY = date(2026, 10, 27)
N = 26
REFUSED = [(3, "deactivated user"), (8, "manually deactivated"), (17, "soft-deleted seat"), (20, "soft-deleted user"), (999, "no such seat")]
LIVE = [s for s in range(1, N + 1) if s not in {3, 8, 17, 20}]


@pytest.fixture
def schema(monkeypatch):
    name = "srp_it_" + uuid.uuid4().hex[:8]
    with psycopg.connect(URL, autocommit=True) as c:
        if not c.execute("select 1 from pg_namespace where nspname = 'srp_cleanup'").fetchone():
            pytest.skip("the database has no srp_cleanup schema to copy table shapes from")
        c.execute(f"create schema {name}")
        for t in TABLES:
            c.execute(f"create table {name}.{t} (like srp_cleanup.{t} including all)")
        c.execute(re.sub(r"\bsrp_cleanup\b", name, SCRIPT.read_text()))
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.read_text()))   # the live database has the hardening too
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("srs_schema.sql").read_text()))   # the seed also writes the SRS page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("profile_schema.sql").read_text()))   # and the Profile page's tables
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("insights_schema.sql").read_text()))   # and the Insights page's tables
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("web_analytics_schema.sql").read_text()))   # and the Web analytics page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("connections_schema.sql").read_text()))   # and the Connections page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("network_schema.sql").read_text()))   # and the Network page's tables
        for i in range(1, N + 1):
            c.execute(f"insert into {name}.users (id, email, first_name, last_name, password_digest, organization_id, created_at, updated_at) "
                      f"overriding system value values (%s, %s, %s, 'Example', 'x', 1, now(), now())", (i, f"it{i}@example.test", f"User{i}"))
            c.execute(f"insert into {name}.tier_agents (id, tier_id, user_id, title, year_started, created_at, updated_at) "
                      f"overriding system value values (%s, 1, %s, 'Loan officer', %s, now(), now())", (i, i, "2010" if i != 2 else "n/a"))
        c.execute(f"insert into {name}.srs_config_categories (id, name, score, created_at, updated_at) overriding system value values (1, 'Mock', 5, now(), now())")
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SRP_LOCAL_SCHEMA", name)
    monkeypatch.setattr(sh, "_today", lambda: TODAY)
    get_settings.cache_clear()
    db_session.close_pools()
    sh.seed(dry_run=False, backup_path=None)
    # two seats that must not be readable or counted
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {name}.users set deactivated_at = now() where id = 3")
        c.execute(f"update {name}.users set is_manual_deactivated = true where id = 8")
        c.execute(f"update {name}.users set deleted_at = now() where id = 20")
        c.execute(f"update {name}.tier_agents set deleted_at = now() where id = 17")
    yield name
    db_session.close_pools()
    get_settings.cache_clear()
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"drop schema {name} cascade")



def q(schema, sql, *params):
    with psycopg.connect(URL, autocommit=True, row_factory=dict_row) as c:
        return c.execute(sql.replace("{s}", schema), params).fetchall()


def run(schema, sql, *params):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(sql.replace("{s}", schema), params)


def get(seat):
    return connections.connections({"sub": str(seat)}, str(seat))


def planned():
    """The planned accounts of every seat, built as the seed builds them."""
    seats = list(range(1, N + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    markets = {p.seat_id: p.zipcode for p in plans}
    h = hp.build_home_plan(seats, TODAY, markets)
    return {s.seat_id: s for s in cpn.build_connections_plan(h, pp.build_profile_plan(seats, TODAY, markets), TODAY).seats}


SOCIAL = ("facebook", "instagram", "linkedin", "x")
KEYS = ("google_business", "search_console", "youtube", "facebook", "instagram", "linkedin", "x", "zillow", "yelp", "website_cms", "loan_system")


def acct(body):
    return {a["key"]: a for a in body["accounts"]}


def lane(seat, key):
    return next(l for l in srs.srs({"sub": str(seat)}, str(seat))["lanes"] if l["key"] == key)


# --- every value is the stored one -------------------------------------------------------------------------------

def test_every_seat_gets_its_planned_accounts_summary_and_suggestions(schema):
    plan = planned()
    for seat in LIVE:
        body = get(seat)
        assert ConnectionsResponse.model_validate(body).model_dump() == body and body["ready"] is True and body["data"] == "mock"
        rows = plan[seat].accounts
        assert [(a["key"], a["state"]) for a in body["accounts"]] == [(r.provider, r.state) for r in rows], seat
        assert [a["synced_at"] for a in body["accounts"]] == [r.synced_at.strftime("%Y-%m-%dT%H:%M:%SZ") if r.synced_at else None for r in rows], seat
        assert body["summary"] == {"connected": sum(r.state == "connected" for r in rows), "matched": sum(r.state in ("matched", "partial") for r in rows)}, seat
        off = [r.provider for r in rows if r.provider in ("search_console", "website_cms") and r.state == "available"]
        assert [s["key"] for s in body["suggest"]] == off == [n["connect"] for n in body["notes"]], seat


def test_the_states_the_seeded_seats_include_are_all_there(schema):
    seen = {a["state"] for seat in LIVE for a in get(seat)["accounts"]}
    assert seen == {"connected", "available", "matched", "partial"}
    assert {a["status"] for seat in LIVE for a in get(seat)["accounts"] if a["state"] == "partial"} == {"Match found · replies need Yelp's partner access"}
    assert any(get(seat)["locked"] for seat in LIVE) and any(get(seat)["locked"] is None for seat in LIVE)


# --- the page agrees with the other pages ---------------------------------------------------------------------------

def test_the_gbp_powers_line_equals_the_srs_gbp_lane_for_every_seat(schema):
    for seat in LIVE:
        g = lane(seat, "gbp")
        assert acct(get(seat))["google_business"]["powers"] == f"GBP lane ({g['earned']} of {g['max']}), hours, photos, reviews", seat


def test_the_connected_socials_equal_the_srs_connections_lane_for_every_seat(schema):
    for seat in LIVE:
        socials = sum(acct(get(seat))[k]["state"] == "connected" for k in SOCIAL)
        assert int(lane(seat, "connections")["you_text"]) == socials, seat


def test_a_seat_with_a_video_has_youtube_connected_and_the_srs_gbp_gap_says_connected(schema):
    seen = set()
    for seat in LIVE:
        a = acct(get(seat))
        v = lane(seat, "videos")["you_text"]
        seen.add(v == "No videos")
        assert v == "No videos" or a["youtube"]["state"] == "connected", seat
        assert a["google_business"]["state"] == "connected" and lane(seat, "gbp")["you_text"] == "Connected", seat
    assert seen == {True, False}


def test_linkedin_is_connected_wherever_the_profile_cites_it(schema):
    for seat in LIVE:
        facts = profile.profile({"sub": str(seat)}, str(seat))["facts"]
        if any(f["source"] == "From LinkedIn" for f in facts):
            assert acct(get(seat))["linkedin"]["state"] == "connected", seat


def test_the_indexing_source_on_web_analytics_follows_search_console(schema):
    seen = set()
    for seat in LIVE:
        idx = next(c for c in web_analytics.web_analytics({"sub": str(seat)}, str(seat))["checks"] if c["key"] == "indexing")
        sc = acct(get(seat))["search_console"]["state"] == "connected"
        seen.add(sc)
        assert idx["source"] == ("From Google Search Console" if sc else "From your site scan"), seat
    assert seen == {True, False}


# --- unknown stays unknown, edits show -------------------------------------------------------------------------------

def test_with_no_snapshot_the_gbp_numbers_are_unknown_never_zero(schema):
    run(schema, "alter table {s}.home_snapshot_lanes disable trigger user")
    run(schema, "delete from {s}.home_snapshot_lanes where snapshot_id in (select id from {s}.home_snapshots where tier_agent_id = 2) and lane_id = (select id from {s}.home_score_lanes where key = 'gbp')")
    run(schema, "alter table {s}.home_snapshot_lanes enable trigger user")
    body = get(2)
    assert acct(body)["google_business"]["powers"] == "GBP lane, hours, photos, reviews" and body["ready"] is True


def test_a_seat_with_no_account_rows_is_not_ready(schema):
    run(schema, "delete from {s}.connected_accounts where tier_agent_id = 2")
    body = get(2)
    assert body["ready"] is False and body["accounts"] is None and body["locked"] is None


def test_a_missing_account_is_absent_never_invented(schema):
    run(schema, "delete from {s}.connected_accounts where tier_agent_id = 1 and provider = 'x'")
    assert "x" not in acct(get(1)) and len(get(1)["accounts"]) == 10


def test_each_seat_sees_only_its_own_rows(schema):
    run(schema, "update {s}.connected_accounts set state = 'available', synced_at = null where tier_agent_id = 1 and provider = 'google_business'")
    assert acct(get(1))["google_business"]["state"] == "available" and acct(get(2))["google_business"]["state"] == "connected"


def test_a_stored_state_that_changes_moves_the_summary_suggestions_and_status(schema):
    run(schema, "update {s}.connected_accounts set state = 'available', synced_at = null where tier_agent_id = 1 and provider = 'search_console'")
    body = get(1)
    assert body["suggest"][0] == {"key": "search_console", "name": "Search Console"} and acct(body)["search_console"]["status"] == "Part of the Google sign-in, not yet granted"
    run(schema, "update {s}.connected_accounts set state = 'connected', synced_at = now() where tier_agent_id = 1 and provider = 'search_console'")
    assert all(s["key"] != "search_console" for s in get(1)["suggest"]) and acct(get(1))["search_console"]["status"] == "Connected"


@pytest.mark.parametrize("plan, shown", [("core", True), ("engage", False), ("amplify", False)])
def test_the_directories_card_follows_the_seats_plan(schema, plan, shown):
    run(schema, "update {s}.home_seat_state set plan_id = (select id from {s}.home_plans where key = %s) where tier_agent_id = 1", plan)
    assert (get(1)["locked"] is not None) == shown


# --- ownership, read only ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("seat,why", REFUSED)
def test_a_seat_that_is_not_the_callers_or_not_active_is_403(schema, seat, why):
    user = seat if seat not in (17, 999) else 1
    with pytest.raises(HTTPException) as e:
        connections.connections({"sub": str(user)}, str(seat))
    assert e.value.status_code == 403, why


def test_one_user_cannot_read_another_users_seat(schema):
    with pytest.raises(HTTPException):
        connections.connections({"sub": "1"}, "2")


def test_the_read_runs_in_a_read_only_transaction_and_writes_nothing(schema, monkeypatch):
    seen = {}
    real = connections.connection

    class Spy:
        def __init__(self, conn):
            self.conn = conn

        def execute(self, sql, *a, **k):
            cur = self.conn.execute(sql, *a, **k)
            if "read" not in seen:
                seen["read"] = self.conn.execute("show transaction_read_only").fetchone()["transaction_read_only"]
            return cur

    @contextmanager
    def spy():
        with real() as conn:
            yield Spy(conn)

    monkeypatch.setattr(connections, "connection", spy)
    counts = lambda: q(schema, "select (select count(*) from {s}.connected_accounts) c, (select count(*) from {s}.web_checks) w, (select count(*) from {s}.srs_lane_gaps) g")
    before = counts()
    get(1)
    assert seen["read"] == "on" and counts() == before


def test_the_database_refuses_a_write_inside_that_transaction(schema):
    with db_session.connection() as conn:
        conn.execute("set transaction read only")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute(f"update {schema}.connected_accounts set source = 'x'")


# --- what the database enforces on the seeded rows (criterion 8) ----------------------------------------------------------------

def test_the_seeded_database_keeps_its_rules(schema):
    assert q(schema, "select count(*) n from {s}.connected_accounts")[0]["n"] == 11 * N
    with pytest.raises(errors.CheckViolation):  # a sync time exactly when the account is not available
        run(schema, "update {s}.connected_accounts set synced_at = null where id = (select min(id) from {s}.connected_accounts where state = 'connected')")
    with pytest.raises(errors.CheckViolation):  # matched only for the two directories
        run(schema, "update {s}.connected_accounts set state = 'matched' where id = (select min(id) from {s}.connected_accounts where provider = 'x' and state = 'connected')")
    with pytest.raises(errors.UniqueViolation):
        run(schema, "insert into {s}.connected_accounts (tier_agent_id, provider, state, synced_at, source, trust_tier) select tier_agent_id, provider, 'connected', now(), 'x', 'imported' from {s}.connected_accounts limit 1")
    with pytest.raises(errors.ForeignKeyViolation):
        run(schema, "insert into {s}.connected_accounts (tier_agent_id, provider, state, source, trust_tier) values (9999, 'x', 'available', 'x', 'imported')")
