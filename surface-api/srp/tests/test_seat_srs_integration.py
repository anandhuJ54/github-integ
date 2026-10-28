"""The SRS read on real Postgres (srp/srs-page-schema, task 7): the seeded rows, the computed lanes, statuses and order, ownership, read-only,
and that the SRS page and the Home page agree for the same seat (spec criteria 3, 7, 8 and 9).

Skipped unless SRP_TEST_DATABASE_URL points at a database with the `srp_cleanup` schema (its table shapes are copied into a scratch schema, the
Home and SRS tables are created there by `srp/db/local/home_schema.sql`, `home_schema_hardening.sql` and `srs_schema.sql`, and the seed fills them;
the scratch schema is dropped afterwards):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/v3_local uv run pytest srp/tests/test_seat_srs_integration.py
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import date
from fractions import Fraction
from pathlib import Path

import psycopg
import pytest
from fastapi import HTTPException
from psycopg.rows import dict_row

from _base.config import get_settings
from _base.db import session as db_session
from surfaces.srp.seat import home, srs
from surfaces.srp.seat import seed_connections_plan as cpn
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat import seed_web_plan as wpn
from surfaces.srp.seat.schemas import SrsResponse

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
PLAN_POSITION = {"core": 1, "engage": 2, "amplify": 3}


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
    monkeypatch.setattr(home, "_today", lambda: TODAY)
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


def planned():
    """The Home plan as the seed writes it: its website gap text aligned with the Web analytics checks (srp/web-analytics-page-schema, W4)."""
    seats = list(range(1, N + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    markets = {p.seat_id: p.zipcode for p in plans}   # the markets the seed gave them
    home = hp.build_home_plan(seats, TODAY, markets)
    published = {p.seat_id: sum(1 for a in p.articles if a["published"] and not a["archived"]) for p in plans}
    web = wpn.build_web_plan(home, pp.build_profile_plan(seats, TODAY, markets), published, {p.seat_id: p.website["website_url"] for p in plans})
    home = wpn.align_home(home, web)
    conns = cpn.build_connections_plan(home, pp.build_profile_plan(seats, TODAY, markets), TODAY)
    return {s.seat_id: s for s in cpn.align_home(home, conns).seats}


def get(seat):
    return srs.srs({"sub": str(seat)}, str(seat))


def expected_status(exp, lane, earned, budget):
    """Written independently of srs.py: exact fractions, the plan's own gap and locked rows."""
    gap = next(g for g in exp.gaps if g.lane == lane)
    if budget and Fraction(earned, budget) >= Fraction(3, 4):
        return "Strong"
    if gap.is_missing:
        return "Missing"
    locked = {f.lane for f in exp.locked if f.lane and PLAN_POSITION[f.plan] > PLAN_POSITION[exp.state.plan]}
    return "Fix · locked" if lane in locked else "Fix"


# --- every value is the stored or computed one ---------------------------------------------------------------------


def test_every_seat_gets_its_planned_srs_values(schema):
    ref = hp.reference()
    position = {l.key: l.position for l in ref.lanes}
    for seat in LIVE:
        body, exp = get(seat), planned()[seat]
        newest = exp.snapshots[-1]
        assert SrsResponse.model_validate(body).model_dump() == body, seat
        assert body["ready"] is True and body["data"] == "mock" and body["as_of"].endswith("Z"), seat
        assert body["score"]["total"] == newest.total and body["score"]["max"] == 850 and body["score"]["open_total"] == 850 - newest.total, seat
        assert body["score"]["band"]["name"] == newest.band, seat
        assert body["rank"] == {"position": newest.rank_position, "of": newest.rank_of, "city": newest.rank_city}, seat
        leader = exp.competitors[0]
        assert body["rival"] == {"name": leader.name, "score": leader.score, "points_to_first": leader.score - newest.total,
                                 "review_count": leader.review_count, "review_avg": leader.review_avg}, seat
        lanes = body["lanes"]
        assert len(lanes) == 10 and sum(l["max"] for l in lanes) == 850, seat                       # criterion 3
        assert all(l["earned"] + l["open"] == l["max"] for l in lanes), seat
        assert sum(l["earned"] for l in lanes) == body["score"]["total"], seat
        assert [l["key"] for l in lanes] == sorted(newest.lanes, key=lambda k: (-(next(x.max_points for x in ref.lanes if x.key == k) - newest.lanes[k]), position[k])), seat
        for lane in lanes:
            gap = next(g for g in exp.gaps if g.lane == lane["key"])
            assert lane["earned"] == newest.lanes[lane["key"]], (seat, lane["key"])
            assert (lane["you_text"], lane["rival_text"], lane["note"], lane["action_label"], lane["action_target"]) == (
                gap.you_text, gap.rival_text, gap.note, gap.action_label, gap.action_target), (seat, lane["key"])
            assert lane["status"] == expected_status(exp, lane["key"], lane["earned"], lane["max"]), (seat, lane["key"])
            assert lane["short_name"] == next(x.short_name for x in ref.lanes if x.key == lane["key"])
        statuses = [l["status"] for l in lanes]
        assert body["counts"] == {"all": 10, "missing": statuses.count("Missing"), "fix": statuses.count("Fix") + statuses.count("Fix · locked"),
                                  "strong": statuses.count("Strong")}, seat
        assert 1 <= len(body["notes"]) <= 3 and all(n["title"] and n["body"] for n in body["notes"]), seat


def test_the_first_note_names_the_lane_with_the_most_open_points(schema):
    for seat in LIVE:
        body = get(seat)
        top = body["lanes"][0]
        assert (top["short_name"] or top["name"]) in body["notes"][0]["title"] and f"{top['open']} points open" in body["notes"][0]["body"], seat
        assert body["notes"][0]["action"] == top["action_target"], seat


# --- the SRS page and the Home page agree (criterion 7) -----------------------------------------------------------


def test_srs_and_home_agree_on_total_band_rank_and_rival_for_every_seat(schema):
    for seat in LIVE:
        s, h = get(seat), home.home({"sub": str(seat)}, str(seat))
        assert s["score"]["total"] == h["score"]["total"] and s["score"]["max"] == h["score"]["max"], seat
        assert s["score"]["band"] == {**h["score"]["band"], "next": (None if h["score"]["band"]["next"] is None else
                                                                      {**h["score"]["band"]["next"], "points_needed": h["score"]["band"]["next"]["min_points"] - h["score"]["total"]})}, seat
        assert s["rank"] == {k: h["rank"][k] for k in ("position", "of", "city")}, seat
        assert (s["rival"] is None) == (h["rival"] is None), seat
        if s["rival"]:
            assert s["rival"] == {k: h["rival"][k] for k in ("name", "score", "points_to_first", "review_count", "review_avg")}, seat
        assert {l["key"]: l["earned"] for l in s["lanes"]} == {l["key"]: l["points"] for l in h["score"]["lanes"]}, seat
        assert s["data"] == h["data"], seat


def test_they_still_agree_after_a_newer_snapshot_is_added(schema):
    run(schema, "insert into {s}.home_snapshots (tier_agent_id, as_of, total, band_id, rank_position, rank_of, rank_city) "
                "select tier_agent_id, as_of + interval '1 hour', 100, band_id, 2, rank_of, rank_city from {s}.home_snapshots "
                "where tier_agent_id = 1 order by as_of desc limit 1")
    s, h = get(1), home.home({"sub": "1"}, "1")
    assert s["score"]["total"] == h["score"]["total"] == 100 and s["rank"]["position"] == h["rank"]["position"] == 2
    assert all(l["earned"] is None and l["status"] is None for l in s["lanes"]), "the newer snapshot has no lanes: unknown, not zero"
    assert s["counts"] == {"all": 10, "missing": 0, "fix": 0, "strong": 0} and s["notes"] == []


# --- not ready, missing rows -------------------------------------------------------------------------------------


@pytest.mark.parametrize("table", ["home_seat_state", "home_snapshots"])
def test_a_seat_without_home_rows_is_not_ready(schema, table):
    run(schema, f"delete from {{s}}.{table} where tier_agent_id = 2" if table == "home_snapshots" else "delete from {s}.home_seat_state where tier_agent_id = 2")
    body = get(2)
    assert body["ready"] is False and {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(
        ["score", "rank", "rival", "lanes", "counts", "notes"])
    assert get(1)["ready"] is True


def test_a_lane_without_a_gap_row_has_no_texts_and_the_rest_still_works(schema):
    run(schema, "delete from {s}.srs_lane_gaps where tier_agent_id = 1 and lane_id = (select id from {s}.home_score_lanes where key = 'website')")
    lane = next(l for l in get(1)["lanes"] if l["key"] == "website")
    assert (lane["you_text"], lane["rival_text"], lane["action_target"]) == (None, None, None) and lane["status"] in ("Fix", "Strong")


def test_a_lane_with_no_points_in_the_snapshot_is_unknown(schema):
    run(schema, "alter table {s}.home_snapshot_lanes disable trigger user")
    run(schema, "delete from {s}.home_snapshot_lanes where lane_id = (select id from {s}.home_score_lanes where key = 'website') "
                "and snapshot_id = (select id from {s}.home_snapshots where tier_agent_id = 1 order by as_of desc limit 1)")
    body = get(1)
    lane = next(l for l in body["lanes"] if l["key"] == "website")
    assert (lane["earned"], lane["open"], lane["status"]) == (None, None, None) and body["lanes"][-1]["key"] == "website"
    assert body["counts"]["all"] == 10 and sum(v for k, v in body["counts"].items() if k != "all") == 9


def test_a_plan_upgrade_unlocks_the_lane(schema):
    exp = planned()
    seat = next(s for s in LIVE if exp[s].state.plan == "core")
    assert next(l for l in get(seat)["lanes"] if l["key"] == "directories")["status"] in ("Fix · locked", "Strong")
    run(schema, "update {s}.home_seat_state set plan_id = (select id from {s}.home_plans where key = 'amplify') where tier_agent_id = %s", seat)
    assert all(l["status"] != "Fix · locked" for l in get(seat)["lanes"])


def test_only_the_seats_own_locked_features_lock_a_lane(schema):
    exp = planned()
    seat = next(s for s in LIVE if exp[s].state.plan == "core")
    assert next(l for l in get(seat)["lanes"] if l["key"] == "directories")["status"] != "Fix"   # locked (or already strong)
    run(schema, "delete from {s}.home_locked_features where tier_agent_id = %s and lane_id = (select id from {s}.home_score_lanes where key = 'directories')", seat)
    status = next(l for l in get(seat)["lanes"] if l["key"] == "directories")["status"]
    assert status in ("Fix", "Strong")   # the other seats' locked features do not lock it for this one


# --- ownership, read only ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("seat,why", REFUSED)
def test_a_seat_that_is_not_the_callers_or_not_active_is_403(schema, seat, why):
    user = seat if seat not in (17, 999) else 1
    with pytest.raises(HTTPException) as e:
        srs.srs({"sub": str(user)}, str(seat))
    assert e.value.status_code == 403, why


def test_one_user_cannot_read_another_users_seat(schema):
    with pytest.raises(HTTPException):
        srs.srs({"sub": "1"}, "2")


def test_the_read_runs_in_a_read_only_transaction_and_writes_nothing(schema, monkeypatch):
    seen = {}
    real = srs.connection

    class Spy:
        def __init__(self, conn):
            self.conn = conn

        def execute(self, sql, *a, **k):
            cur = self.conn.execute(sql, *a, **k)
            if "read" not in seen:
                seen["read"] = self.conn.execute("show transaction_read_only").fetchone()["transaction_read_only"]
            return cur

    from contextlib import contextmanager

    @contextmanager
    def spy():
        with real() as conn:
            yield Spy(conn)

    monkeypatch.setattr(srs, "connection", spy)
    counts = lambda: q(schema, "select (select count(*) from {s}.srs_lane_gaps) g, (select count(*) from {s}.home_snapshots) s")
    before = counts()
    get(1)
    assert seen["read"] == "on" and counts() == before


def test_the_database_refuses_a_write_inside_that_transaction(schema):
    with db_session.connection() as conn:
        conn.execute("set transaction read only")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute(f"update {schema}.srs_lane_gaps set note = 'x'")


# --- what the database enforces (criterion 9) -------------------------------------------------------------------


def test_the_seeded_database_keeps_its_rules(schema):
    gaps = q(schema, "select tier_agent_id, count(*) n from {s}.srs_lane_gaps group by 1")
    assert len(gaps) == N and all(r["n"] == 10 for r in gaps)
    with pytest.raises(psycopg.errors.UniqueViolation):
        run(schema, "insert into {s}.srs_lane_gaps (tier_agent_id, lane_id, you_text, rival_text, action_label, action_target) "
                    "select tier_agent_id, lane_id, 'x', 'y', 'z', 'voce' from {s}.srs_lane_gaps limit 1")
    with pytest.raises(psycopg.errors.CheckViolation):
        run(schema, "update {s}.srs_lane_gaps set action_target = 'elsewhere' where id = (select min(id) from {s}.srs_lane_gaps)")
    with pytest.raises(psycopg.errors.CheckViolation):  # a lane cannot hold more than its budget (Home's trigger)
        run(schema, "update {s}.home_snapshot_lanes set points = 9999 where id = (select min(id) from {s}.home_snapshot_lanes)")
