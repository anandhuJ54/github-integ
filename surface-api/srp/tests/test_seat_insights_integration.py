"""The Insights read on real Postgres (srp/insights-page-schema, task 7): the seeded rows, the computed parts, ownership, read-only, and that the Insights
page agrees with the Home and Profile pages for the same seat (spec criteria 3, 4, 5, 6, 8, 9 and 13).

Skipped unless SRP_TEST_DATABASE_URL points at a database with the `srp_cleanup` schema (its table shapes are copied into a scratch schema, the Home, SRS,
Profile and Insights tables are created there by their scripts, and the seed fills them; the scratch schema is dropped afterwards):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/v3_local uv run pytest srp/tests/test_seat_insights_integration.py
"""
from __future__ import annotations

import os
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import psycopg
import pytest
from fastapi import HTTPException
from psycopg import errors
from psycopg.rows import dict_row

from _base.config import get_settings
from _base.db import session as db_session
from surfaces.srp.seat import home, insights, profile
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_insights_plan as ip
from surfaces.srp.seat.schemas import InsightsResponse

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




def get(seat):
    return insights.insights({"sub": str(seat)}, str(seat))


def planned():
    seats = list(range(1, N + 1))
    markets = {p.seat_id: p.zipcode for p in sh.build_plan(seats, [sh.Category(1, 5)])}
    home_plan = hp.build_home_plan(seats, datetime.combine(TODAY, time(12, 0)), markets)
    return {s.seat_id: s for s in home_plan.seats}, {s.seat_id: s for s in ip.build_insights_plan(home_plan).seats}


def one_decimal(x):
    return float(Decimal(str(x)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def seat_average(cells):
    return one_decimal(Decimal(sum(c.rank if c.rank is not None else 21 for c in cells)) / Decimal(len(cells)))


# --- every value is the stored one -------------------------------------------------------------------------------


def test_every_seat_gets_its_planned_rows(schema):
    homes, plans = planned()
    for seat in LIVE:
        body, h, p = get(seat), homes[seat], plans[seat]
        assert InsightsResponse.model_validate(body).model_dump() == body, seat
        assert body["ready"] is True and body["data"] == "mock", seat
        assert [(v["metric"], v["value"], v["source"], v["trust_tier"]) for v in body["visibility"]] == [(v.metric, v.value, v.source, v.trust_tier) for v in p.visibility], seat
        assert all(v["source_line"] == f"Last 30 days · {v['source']}" for v in body["visibility"])
        assert [(e["engine"], e["cited"], e["checked"], e["note"]) for e in body["ai"]["engines"]] == [(e.engine, e.cited, e.checked, e.note) for e in p.engines], seat
        cells = h.snapshots[-1].cells
        assert [(c["row"], c["col"], c["rank"]) for c in body["map"]["cells"]] == [(c.row, c.col, c.rank) for c in sorted(cells, key=lambda c: (c.row, c.col))], seat
        want = {}
        for l in p.leaders:
            want.setdefault((l.row, l.col), []).append((l.position, l.name, l.is_you))
        assert {(c["row"], c["col"]): [(l["position"], l["name"], l["is_you"]) for l in c["leaders"]] for c in body["map"]["cells"]} == want, seat


def test_the_competitor_table_is_the_plans_rivals_and_the_seat_in_the_computed_order(schema):
    homes, plans = planned()
    for seat in LIVE:
        body, h, p = get(seat), homes[seat], plans[seat]
        avg = {x.name: x.avg_position for x in p.positions}
        avg_you = seat_average(h.snapshots[-1].cells)
        expected = sorted([(avg[c.name], 0, c.position, c.name, False) for c in h.competitors] + [(avg_you, 1, 0, f"User{seat} Example", True)])
        assert [(c["name"], c["is_you"], c["avg_position"]) for c in body["competitors"]] == [(e[3], e[4], e[0]) for e in expected], seat
        assert [c["place"] for c in body["competitors"]] == list(range(1, 7)), seat
        leader = next(c for c in h.competitors if c.is_market_leader)
        assert body["target"] == {"name": leader.name} and [c["name"] for c in body["competitors"] if c["is_leader"]] == [leader.name], seat
        by_name = {c["name"]: c for c in body["competitors"]}
        for c in h.competitors:
            assert (by_name[c.name]["rating"], by_name[c.name]["reviews"]) == (c.review_avg, c.review_count), seat


def test_the_market_leader_is_ahead_of_every_rival_in_the_table(schema):
    for seat in LIVE:
        rivals = [c for c in get(seat)["competitors"] if not c["is_you"]]
        assert rivals[0]["is_leader"] is True, seat


# --- Insights = Home = Profile for the same seat -----------------------------------------------------------------------


def test_the_map_the_ai_totals_and_the_rating_equal_the_home_pages_for_every_seat(schema):
    for seat in LIVE:
        body, h = get(seat), home.home({"sub": str(seat)}, str(seat))
        assert body["map"]["spots"] == h["tiles"]["map"]["total"] == 49 and body["map"]["top3"] == h["tiles"]["map"]["top3"], seat
        assert body["map"]["scanned_at"] == h["tiles"]["map"]["scanned_at"], seat
        assert [(c["row"], c["col"], c["rank"]) for c in body["map"]["cells"]] == [(c["row"], c["col"], c["rank"]) for c in h["tiles"]["map"]["cells"]], seat
        assert (body["ai"]["cited"], body["ai"]["checked"]) == (h["tiles"]["ai"]["cited"], h["tiles"]["ai"]["checked"]), seat
        you = next(c for c in body["competitors"] if c["is_you"])
        assert (you["rating"], you["reviews"]) == (h["tiles"]["reviews"]["avg"], h["tiles"]["reviews"]["count"]), seat
        assert len(body["competitors"]) - 1 == h["competitors"]["count"], seat


def test_the_map_address_is_the_profiles_address_fact(schema):
    seen_none = seen_some = False
    for seat in LIVE:
        address = next((f for f in profile.profile({"sub": str(seat)}, str(seat))["facts"] if f["field"] == "address"), None)
        value = address["value"] if address and address["present"] else None
        assert get(seat)["map"]["address"] == value, seat
        seen_none |= value is None
        seen_some |= value is not None
    assert seen_some and seen_none, "the seeded seats include some with and some without an address"


def test_a_seat_that_is_in_a_spots_top_three_is_shown_as_you_there_and_nowhere_else(schema):
    for seat in LIVE:
        for c in get(seat)["map"]["cells"]:
            yous = [l for l in c["leaders"] if l["is_you"]]
            if c["rank"] is not None and c["rank"] <= 3:
                assert len(yous) == 1 and yous[0]["position"] == c["rank"] and yous[0]["name"] is None, (seat, c["row"], c["col"])
            else:
                assert yous == [], (seat, c["row"], c["col"])
            assert len({l["name"] for l in c["leaders"]}) == 3


def test_the_two_notes_follow_the_stored_numbers_for_every_seat(schema):
    homes, plans = planned()
    for seat in LIVE:
        notes, h, p = get(seat)["notes"], homes[seat], plans[seat]
        leader = next(c for c in h.competitors if c.is_market_leader)
        short = leader.name.split()[0]
        volume = leader.review_count > h.snapshots[-1].review_count  # the claim only when the leader really has more reviews
        assert notes[0]["title"] == (f"{short} wins on volume." if volume else f"{short} is your top rival."), seat
        rv = f"{leader.review_count} review{'' if leader.review_count == 1 else 's'}"
        ar = f"{leader.article_count} article{'' if leader.article_count == 1 else 's'}"
        assert f"{rv} and {ar}." in notes[0]["body"], seat
        assert notes[1]["cta"] == "Write an article", seat
        shares = [(e.cited / e.checked, i, e) for i, e in enumerate(p.engines) if e.checked]
        _, _, e = min(shares, key=lambda x: (x[0], x[1]))
        names = {"chatgpt": "ChatGPT", "gemini": "Gemini", "perplexity": "Perplexity"}
        assert notes[1]["title"] == (f"{names[e.engine]} never names you." if e.cited == 0 else f"{names[e.engine]} names you in {e.cited} of {e.checked}."), seat
        assert notes[1]["body"] == e.note, seat


def test_the_locked_cards_follow_the_seats_plan(schema):
    homes, _ = planned()
    seen = set()
    for seat in LIVE:
        locked = get(seat)["locked"]
        top = homes[seat].state.plan == "amplify"
        assert (locked == []) == top, seat
        seen.add(top)
    assert seen == {True, False}, "the seeded seats include some at the top plan and some below"


# --- missing and not ready --------------------------------------------------------------------------------------------


def test_a_seat_with_a_missing_metric_shows_five_figures_and_never_a_zero(schema):
    _, plans = planned()
    seat = next(s for s in LIVE if len(plans[s].visibility) == 5)
    got = [v["metric"] for v in get(seat)["visibility"]]
    assert len(got) == 5 and set(ip.METRICS) - set(got)


def test_deleting_a_seats_map_cells_removes_its_map_and_its_leaders_but_nothing_else(schema):
    run(schema, "delete from {s}.home_map_cells where snapshot_id = (select id from {s}.home_snapshots where tier_agent_id = 1 order by as_of desc, id desc limit 1)")
    body = get(1)
    assert body["map"] is None and body["ready"] is True and body["ai"] is not None and len(body["competitors"]) == 6
    assert next(c for c in body["competitors"] if c["is_you"])["avg_position"] is None
    assert q(schema, "select count(*) n from {s}.insights_spot_leaders l join {s}.home_map_cells c on c.id = l.cell_id join {s}.home_snapshots s on s.id = c.snapshot_id where s.tier_agent_id = 1")[0]["n"] == 0


def test_with_no_snapshot_the_seats_figures_are_unknown_and_the_rest_still_shows(schema):
    run(schema, "update {s}.home_seat_state set claim_snapshot_id = null where tier_agent_id = 2")
    run(schema, "delete from {s}.home_snapshots where tier_agent_id = 2")
    body = get(2)
    you = next(c for c in body["competitors"] if c["is_you"])
    assert body["map"] is None and (you["rating"], you["reviews"], you["avg_position"]) == (None, None, None)
    assert body["ready"] is True and body["ai"] is not None and len(body["visibility"]) >= 5


def test_a_seat_with_no_insights_rows_is_not_ready(schema):
    run(schema, "delete from {s}.insights_visibility where tier_agent_id = 2")
    run(schema, "delete from {s}.insights_ai_engines where tier_agent_id = 2")
    run(schema, "delete from {s}.insights_competitor_positions where tier_agent_id = 2")
    run(schema, "delete from {s}.insights_spot_leaders where cell_id in (select c.id from {s}.home_map_cells c join {s}.home_snapshots s on s.id = c.snapshot_id where s.tier_agent_id = 2)")
    body = get(2)
    assert body["ready"] is False and body["visibility"] is None and body["map"] is None and body["competitors"] is None and body["notes"] is None
    assert get(1)["ready"] is True


def test_each_seat_sees_only_its_own_rows(schema):
    a, b = LIVE[0], LIVE[1]
    run(schema, "update {s}.insights_visibility set value = 987654 where tier_agent_id = %s and metric = 'calls'", a)
    run(schema, "update {s}.insights_ai_engines set note = 'Only seat A' where tier_agent_id = %s and engine = 'gemini'", a)
    assert next(v["value"] for v in get(a)["visibility"] if v["metric"] == "calls") == 987654
    assert all(v["value"] != 987654 for v in get(b)["visibility"])
    assert {e["note"] for e in get(a)["ai"]["engines"]} >= {"Only seat A"} and "Only seat A" not in {e["note"] for e in get(b)["ai"]["engines"]}


def test_a_stored_position_that_changes_moves_the_rival_in_the_table(schema):
    leader = next(c["name"] for c in get(1)["competitors"] if c["is_leader"])
    run(schema, "update {s}.insights_competitor_positions set avg_position = 20.9 where competitor_id = (select id from {s}.home_competitors where tier_agent_id = 1 and is_market_leader)")
    rows = get(1)["competitors"]
    moved = next(c for c in rows if c["name"] == leader)
    assert moved["avg_position"] == 20.9 and all(c["place"] < moved["place"] for c in rows if not c["is_you"] and c["name"] != leader)


# --- ownership, read only ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("seat,why", REFUSED)
def test_a_seat_that_is_not_the_callers_or_not_active_is_403(schema, seat, why):
    user = seat if seat not in (17, 999) else 1
    with pytest.raises(HTTPException) as e:
        insights.insights({"sub": str(user)}, str(seat))
    assert e.value.status_code == 403, why


def test_one_user_cannot_read_another_users_seat(schema):
    with pytest.raises(HTTPException):
        insights.insights({"sub": "1"}, "2")


def test_the_read_runs_in_a_read_only_transaction_and_writes_nothing(schema, monkeypatch):
    seen = {}
    real = insights.connection

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

    monkeypatch.setattr(insights, "connection", spy)
    counts = lambda: q(schema, "select (select count(*) from {s}.insights_visibility) v, (select count(*) from {s}.insights_ai_engines) e, "
                               "(select count(*) from {s}.insights_competitor_positions) p, (select count(*) from {s}.insights_spot_leaders) l")
    before = counts()
    get(1)
    assert seen["read"] == "on" and counts() == before


def test_the_database_refuses_a_write_inside_that_transaction(schema):
    with db_session.connection() as conn:
        conn.execute("set transaction read only")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute(f"update {schema}.insights_visibility set source = 'x'")


# --- what the database enforces (criterion 9) ----------------------------------------------------------------------------


def test_the_seeded_database_keeps_its_rules(schema):
    assert q(schema, "select count(*) n from {s}.insights_ai_engines")[0]["n"] == 3 * N
    with pytest.raises(errors.CheckViolation):
        run(schema, "update {s}.insights_ai_engines set cited = checked + 1 where id = (select min(id) from {s}.insights_ai_engines)")
    with pytest.raises(errors.CheckViolation):
        run(schema, "update {s}.insights_visibility set trust_tier = 'verified' where id = (select min(id) from {s}.insights_visibility)")
    with pytest.raises(errors.UniqueViolation):
        run(schema, "insert into {s}.insights_visibility (tier_agent_id, metric, value, source, trust_tier) select tier_agent_id, metric, 1, 'x', 'imported' from {s}.insights_visibility limit 1")
    with pytest.raises(errors.ForeignKeyViolation):  # a position naming another seat's rival
        run(schema, "update {s}.insights_competitor_positions set tier_agent_id = tier_agent_id + 1 where id = (select min(id) from {s}.insights_competitor_positions)")
    with pytest.raises(errors.CheckViolation):  # "You" with a name
        run(schema, "update {s}.insights_spot_leaders set is_you = true where id = (select min(id) from {s}.insights_spot_leaders where name is not null)")
