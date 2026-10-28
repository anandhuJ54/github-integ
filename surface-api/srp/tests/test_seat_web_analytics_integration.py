"""The Web analytics read on real Postgres (srp/web-analytics-page-schema, task 7): the seeded rows, the computed parts, ownership, read-only, and that the page agrees with the
SRS page, Home and the Profile for the same seat (spec criteria 3, 4, 5, 6, 8, 9 and 14).

Skipped unless SRP_TEST_DATABASE_URL points at a database with the `srp_cleanup` schema (its table shapes are copied into a scratch schema, the Home, SRS, Profile, Insights and Web
analytics tables are created there by their scripts, and the seed fills them; the scratch schema is dropped afterwards):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/v3_local uv run pytest srp/tests/test_seat_web_analytics_integration.py
"""
from __future__ import annotations

import os
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time
from pathlib import Path

import psycopg
import pytest
from fastapi import HTTPException
from psycopg import errors
from psycopg.rows import dict_row

from _base.config import get_settings
from _base.db import session as db_session
from surfaces.srp.seat import home, profile, srs, web_analytics
from surfaces.srp.seat import seed_connections_plan as cpn
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat import seed_web_plan as wpn
from surfaces.srp.seat.schemas import WebAnalyticsResponse

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
    return web_analytics.web_analytics({"sub": str(seat)}, str(seat))


def planned():
    """The web plan and the aligned Home plan, built as the seed builds them, and the published counts."""
    seats = list(range(1, N + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    markets = {p.seat_id: p.zipcode for p in plans}
    now = datetime.combine(TODAY, time(12, 0))
    h = hp.build_home_plan(seats, now, markets)
    published = {p.seat_id: sum(1 for a in p.articles if a["published"] and not a["archived"]) for p in plans}
    web = wpn.build_web_plan(h, pp.build_profile_plan(seats, now, markets), published, {p.seat_id: p.website["website_url"] for p in plans})
    conns = cpn.build_connections_plan(wpn.align_home(h, web), pp.build_profile_plan(seats, now, markets), TODAY)
    return {s.seat_id: s for s in cpn.align_web(web, conns).seats}, published


STATE_LABEL = {"fail": "Failing", "warn": "Needs work", "pass": "Passing"}


def points_text(c):
    if c.points_max is not None:
        return f"+{c.points_max - c.points} open" if c.key == "entity_markup" and c.points < c.points_max else f"{c.points} of {c.points_max}"
    return "Pass" if c.state == "pass" else "—"


# --- every value is the stored one -------------------------------------------------------------------------------


def test_every_seat_gets_its_planned_checks_counts_and_tiles(schema):
    web, _ = planned()
    for seat in LIVE:
        body, exp = get(seat), web[seat]
        assert WebAnalyticsResponse.model_validate(body).model_dump(by_alias=True) == body, seat
        assert body["ready"] is True and body["data"] == "mock", seat
        assert [(c["key"], c["state"], c["result"], c["points"], c["max"], c["points_text"], c["source"], c["trust_tier"]) for c in body["checks"]] == [
            (c.key, c.state, c.result, c.points, c.points_max, points_text(c), c.source, c.trust_tier) for c in exp.checks], seat
        states = [c.state for c in exp.checks]
        assert body["counts"] == {"all": 10, "fail": states.count("fail"), "warn": states.count("warn"), "pass": states.count("pass")}, seat
        by = {c.key: c for c in exp.checks}
        assert [(t["key"], t["value"], t["state"]) for t in body["tiles"]] == [
            ("speed", by["speed"].headline, by["speed"].state),
            ("markup", {"fail": "Missing", "warn": "Partial", "pass": "Complete"}[by["entity_markup"].state], by["entity_markup"].state),
            ("ai_readiness", by["ai_readiness"].headline, by["ai_readiness"].state)], seat
        open_ = by["entity_markup"].points_max - by["entity_markup"].points
        assert body["tiles"][1]["note"] == (f"+{open_} open" if open_ else "Passing") and body["tiles"][0]["note"] == STATE_LABEL[by["speed"].state], seat
        assert (body["top_fix"] is None) == (by["entity_markup"].state == "pass"), seat
        if body["top_fix"]:
            assert body["top_fix"]["open"] == open_, seat
        assert [n["cta"] for n in body["notes"]] == (["Send to my webmaster"] if body["top_fix"] else []) + (["See the checks"] if by["ai_readiness"].state != "pass" else []), seat


def test_the_states_the_seeded_seats_include_are_all_there(schema):
    kinds = set()
    for seat in LIVE:
        body = get(seat)
        kinds.add((body["tiles"][1]["value"], body["top_fix"] is None))
    assert {"Missing", "Partial", "Complete"} <= {k[0] for k in kinds}


# --- the gauge equals the SRS page and Home (criterion 3) --------------------------------------------------------------


def test_the_gauge_equals_the_srs_website_lane_and_homes_website_tile_for_every_seat(schema):
    for seat in LIVE:
        body = get(seat)
        lane = next(l for l in srs.srs({"sub": str(seat)}, str(seat))["lanes"] if l["key"] == "website")
        tile = home.home({"sub": str(seat)}, str(seat))["tiles"]["website"]
        assert body["health"] == {"earned": lane["earned"], "max": lane["max"], "open": lane["open"]}, seat
        assert (tile["score"], tile["max"]) == (body["health"]["earned"], body["health"]["max"]), seat
        assert body["health"]["max"] == 102 and sum(c["points"] for c in body["checks"] if c["points"] is not None) == body["health"]["earned"], seat
        assert sum(c["max"] for c in body["checks"] if c["max"] is not None) == 102, seat


def test_homes_website_move_is_worth_the_top_fixs_points_for_every_seat(schema):
    """The move says "Markup is ..." so its points are what markup has open, which is the page's top fix (second review, finding 3)."""
    for seat in LIVE:
        body, h = get(seat), home.home({"sub": str(seat)}, str(seat))
        move = next(m for m in h["board"]["next_moves"] if m["target"] == "website")
        assert move["points"] == (body["top_fix"]["open"] if body["top_fix"] else 0), seat
        assert h["brief"]["next_move"]["points"] == max(1, move["points"]), seat


def test_the_site_equals_homes_website_tile(schema):
    for seat in LIVE:
        site, tile = get(seat)["site"], home.home({"sub": str(seat)}, str(seat))["tiles"]["website"]
        assert site["url"] == re.sub(r"^https?://", "", tile["url"]).rstrip("/"), seat
        stored = q(schema, "select last_refreshed_time from {s}.website_analytics_data where tier_agent_id = %s order by last_refreshed_time desc nulls last, id desc limit 1", seat)[0]
        assert site["last_checked"] == stored["last_refreshed_time"].isoformat() + "Z", seat


def test_the_markup_state_agrees_with_the_srs_gap_text_and_homes_move_text(schema):
    gap = {0: "No markup", 42: "Full markup"}
    move = {0: "Markup is missing on your site", 42: "Your markup is complete"}
    for seat in LIVE:
        markup = next(c for c in get(seat)["checks"] if c["key"] == "entity_markup")["points"]
        lane = next(l for l in srs.srs({"sub": str(seat)}, str(seat))["lanes"] if l["key"] == "website")
        moves = home.home({"sub": str(seat)}, str(seat))["board"]["next_moves"]
        subtitle = next(m for m in moves if m["target"] == "website")["subtitle"]
        assert lane["you_text"] == gap.get(markup, "Partial markup"), seat
        assert subtitle == move.get(markup, "Markup is incomplete on your site"), seat


# --- the other pages' facts the checks use (criteria 4 and 6) -------------------------------------------------------------


def test_name_address_phone_follows_the_profile_for_every_seat(schema):
    for seat in LIVE:
        facts = {f["field"]: f for f in profile.profile({"sub": str(seat)}, str(seat))["facts"]}
        present = sum(facts[f]["present"] for f in ("name", "address", "office_phone"))
        nap = next(c for c in get(seat)["checks"] if c["key"] == "nap")
        assert nap["points"] == 10 * present and (nap["state"] == "pass") == (present == 3), seat


def test_the_content_check_follows_the_published_articles_homes_tile_shows(schema):
    seen = set()
    for seat in LIVE:
        n = home.home({"sub": str(seat)}, str(seat))["tiles"]["articles"]["published"]
        c = next(c for c in get(seat)["checks"] if c["key"] == "content")
        assert (c["state"], c["result"]) == (("fail", "No blog") if n == 0 else ("warn" if n < 3 else "pass", f"Blog with {n} post{'' if n == 1 else 's'}")), seat
        seen.add(c["state"])
    assert seen == {"fail", "warn", "pass"}


def test_the_snippet_facts_are_the_profiles_and_the_snippet_is_built_from_them(schema):
    seen_missing = False
    for seat in LIVE:
        body = get(seat)
        facts = {f["field"]: f for f in profile.profile({"sub": str(seat)}, str(seat))["facts"]}
        want = {"name": facts["name"]["value"], "company": facts["company"]["value"], "address": facts["address"]["value"], "phone": facts["office_phone"]["value"]}
        assert body["facts"] == want, seat
        seen_missing |= want["address"] is None
        if body["top_fix"]:
            snippet = body["top_fix"]["snippet"]
            assert snippet.startswith('<script type="application/ld+json">\n{ "@type": "FinancialService",') and snippet.endswith("\n</script>"), seat
            assert (want["address"] is None) == ('"address"' not in snippet) and (want["company"] is not None) == (" – " in snippet), seat
            if want["phone"]:
                p = re.sub(r"[\s().+-]", "", want["phone"])[-10:]
                assert f'"telephone": "({p[:3]}) {p[3:6]}-{p[6:]}"' in snippet, seat
    assert seen_missing, "the seeded seats include some with no address"


# --- missing and not ready ---------------------------------------------------------------------------------------------------


def test_with_no_snapshot_the_gauge_is_unknown_and_the_checks_still_show(schema):
    run(schema, "update {s}.home_seat_state set claim_snapshot_id = null where tier_agent_id = 2")
    run(schema, "delete from {s}.home_snapshots where tier_agent_id = 2")
    body = get(2)
    assert body["health"] is None and body["ready"] is True and len(body["checks"]) == 10 and body["counts"]["all"] == 10


def test_with_no_website_lane_row_the_gauge_is_unknown(schema):
    run(schema, "alter table {s}.home_snapshot_lanes disable trigger user")  # the hardening script refuses a snapshot whose lanes no longer add up to its total
    run(schema, "delete from {s}.home_snapshot_lanes where snapshot_id in (select id from {s}.home_snapshots where tier_agent_id = 2) "
                "and lane_id = (select id from {s}.home_score_lanes where key = 'website')")
    run(schema, "alter table {s}.home_snapshot_lanes enable trigger user")
    assert get(2)["health"] is None and get(1)["health"] is not None


def test_with_no_website_row_the_site_is_unknown_and_nothing_else_changes(schema):
    before = get(2)
    run(schema, "delete from {s}.website_analytics_data where tier_agent_id = 2")
    body = get(2)
    assert body["site"] == {"url": None, "last_checked": None}
    assert {k: v for k, v in body.items() if k not in ("as_of", "site")} == {k: v for k, v in before.items() if k not in ("as_of", "site")}


def test_the_newest_website_row_is_the_one_shown(schema):
    run(schema, "insert into {s}.website_analytics_data (tier_agent_id, total_score, website_url, last_refreshed_time, created_at, updated_at) "
                "values (1, 5, 'https://example.test/newest/', '2030-01-01 00:00', now(), now())")
    assert get(1)["site"] == {"url": "example.test/newest", "last_checked": "2030-01-01T00:00:00Z"}


def test_a_seat_with_no_check_rows_is_not_ready(schema):
    run(schema, "delete from {s}.web_checks where tier_agent_id = 2")
    body = get(2)
    assert body["ready"] is False and body["checks"] is None and body["health"] is None and body["notes"] is None and body["facts"] is None
    assert get(1)["ready"] is True


def test_each_seat_sees_only_its_own_rows(schema):
    a, b = LIVE[0], LIVE[1]
    run(schema, "update {s}.web_checks set result = 'Only seat A' where tier_agent_id = %s and check_key = 'security'", a)
    assert next(c for c in get(a)["checks"] if c["key"] == "security")["result"] == "Only seat A"
    assert next(c for c in get(b)["checks"] if c["key"] == "security")["result"] != "Only seat A"


def test_a_stored_state_that_changes_moves_the_counts_and_the_tiles(schema):
    before = get(1)
    old = next(c for c in before["checks"] if c["key"] == "security")["state"]
    run(schema, "update {s}.web_checks set state = 'fail', result = 'No HTTPS (the page is served over HTTP)' where tier_agent_id = 1 and check_key = 'security'")
    expected = dict(before["counts"])
    if old != "fail":
        expected[old] -= 1
        expected["fail"] += 1
    assert get(1)["counts"] == expected
    run(schema, "update {s}.web_checks set state = 'fail', headline = 'LCP 9.9 s' where tier_agent_id = 1 and check_key = 'speed'")
    assert get(1)["tiles"][0] == {"key": "speed", "label": "Speed", "value": "LCP 9.9 s", "note": "Failing", "state": "fail", "check": "speed"}


# --- ownership, read only ----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("seat,why", REFUSED)
def test_a_seat_that_is_not_the_callers_or_not_active_is_403(schema, seat, why):
    user = seat if seat not in (17, 999) else 1
    with pytest.raises(HTTPException) as e:
        web_analytics.web_analytics({"sub": str(user)}, str(seat))
    assert e.value.status_code == 403, why


def test_one_user_cannot_read_another_users_seat(schema):
    with pytest.raises(HTTPException):
        web_analytics.web_analytics({"sub": "1"}, "2")


def test_the_read_runs_in_a_read_only_transaction_and_writes_nothing(schema, monkeypatch):
    seen = {}
    real = web_analytics.connection

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

    monkeypatch.setattr(web_analytics, "connection", spy)
    counts = lambda: q(schema, "select (select count(*) from {s}.web_checks) c, (select sum(total_score) from {s}.website_analytics_data) t, (select count(*) from {s}.srs_lane_gaps) g")
    before = counts()
    get(1)
    assert seen["read"] == "on" and counts() == before


def test_the_database_refuses_a_write_inside_that_transaction(schema):
    with db_session.connection() as conn:
        conn.execute("set transaction read only")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute(f"update {schema}.web_checks set source = 'x'")


# --- what the database enforces on the seeded rows (criterion 10) ----------------------------------------------------------------


def test_the_seeded_database_keeps_its_rules(schema):
    assert q(schema, "select count(*) n from {s}.web_checks")[0]["n"] == 10 * N
    with pytest.raises(errors.CheckViolation):  # the state of a scored check follows its points
        run(schema, "update {s}.web_checks set state = case when state = 'pass' then 'fail' else 'pass' end where id = (select min(id) from {s}.web_checks where points is not null)")
    with pytest.raises(errors.CheckViolation):  # points on an unscored check
        run(schema, "update {s}.web_checks set points = 1, points_max = 2, state = 'warn' where id = (select min(id) from {s}.web_checks where check_key = 'security')")
    with pytest.raises(errors.CheckViolation):  # no headline on a speed check
        run(schema, "update {s}.web_checks set headline = null where id = (select min(id) from {s}.web_checks where check_key = 'speed')")
    with pytest.raises(errors.UniqueViolation):
        run(schema, "insert into {s}.web_checks (tier_agent_id, check_key, state, result, source, trust_tier) select tier_agent_id, check_key, 'pass', 'x', 'x', 'imported' from {s}.web_checks where check_key = 'security' limit 1")
    with pytest.raises(errors.ForeignKeyViolation):
        run(schema, "insert into {s}.web_checks (tier_agent_id, check_key, state, result, source, trust_tier) values (9999, 'security', 'pass', 'x', 'x', 'imported')")
