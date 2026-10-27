"""The Home read on real Postgres (srp/home-page-schema, task 6): the seeded rows, the computed values and their edges, ownership, read-only.

Skipped unless SRP_TEST_DATABASE_URL points at a database with the `srp_cleanup` schema (its table shapes are copied into a scratch schema, the
Home tables are created there by `srp/db/local/home_schema.sql`, and the seed fills them; the scratch schema is dropped afterwards):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/v3_local uv run pytest srp/tests/test_seat_home_integration.py
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg
import pytest
from fastapi import HTTPException
from psycopg.rows import dict_row

from _base.config import get_settings
from _base.db import session as db_session
from surfaces.srp.seat import home
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_home_plan as hp

URL = os.environ.get("SRP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="SRP_TEST_DATABASE_URL is not set")

TABLES = ["users", "tier_agents", "tier_agent_details", "srs_config_categories", "user_search_rank_scores", "voce_articles",
          "website_analytics_data", "ai_authority_stats"]
SCRIPT = Path(__file__).resolve().parents[1] / "db" / "local" / "home_schema.sql"
HARDENING = SCRIPT.with_name("home_schema_hardening.sql")
TODAY = date(2026, 10, 27)
N = 26
REFUSED = [(3, "deactivated user"), (8, "manually deactivated"), (17, "soft-deleted seat"), (20, "soft-deleted user"), (999, "no such seat")]


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
    return home.home({"sub": str(seat)}, str(seat))


def planned():
    seats = list(range(1, N + 1))
    markets = {p.seat_id: p.zipcode for p in sh.build_plan(seats, [sh.Category(1, 5)])}   # the markets the seed gave them
    return {s.seat_id: s for s in hp.build_home_plan(seats, TODAY, markets).seats}


def with_a_week_of_history():
    return next(seat for seat in LIVE if len(planned()[seat].snapshots) >= 3)


LIVE = [s for s in range(1, N + 1) if s not in {3, 8, 17, 20}]


@pytest.mark.parametrize("seat", LIVE)
def test_every_value_is_the_stored_or_computed_one(schema, seat):
    body, exp = get(seat), planned()[seat]
    snaps = exp.snapshots
    newest = snaps[-1]
    week = next((x for x in reversed(snaps[:-1]) if x.as_of <= newest.as_of - timedelta(days=7)), None)
    n = (TODAY - exp.state.trial_started_at.date()).days + 1
    assert body["ready"] is True and body["data"] == "mock"
    assert body["day"] == {"n": n, "trial_days": 30, "layout": exp.layout, "over": False}
    assert body["person"]["first_name"] == f"User{seat}" and body["person"]["full_name"] == f"User{seat} Example" and body["person"]["title"] == "Loan officer"
    assert body["person"]["year_started"] == int(q(schema, "select year_started from {s}.tier_agents where id = %s", seat)[0]["year_started"])
    assert body["trial"]["plan"]["key"] == exp.state.plan and body["trial"]["started_at"] == exp.state.trial_started_at.isoformat() + "Z"
    sc = body["score"]
    assert (sc["total"], sc["max"], sc["band"]["name"]) == (newest.total, 850, newest.band)
    assert sc["since_claim"] == newest.total - snaps[0].total
    assert sc["week_delta"] == (newest.total - week.total if week else None)
    assert {l["key"]: l["points"] for l in sc["lanes"]} == newest.lanes and [l["key"] for l in sc["lanes"]] == [x.key for x in hp.reference().lanes]
    assert body["rank"]["position"] == newest.rank_position and body["rank"]["of"] == newest.rank_of and body["rank"]["first_position"] == snaps[0].rank_position
    leader = exp.competitors[0]
    assert body["rival"]["name"] == leader.name and body["rival"]["points_to_first"] == leader.score - newest.total
    assert body["rival"]["initial"] == leader.name[0] and body["competitors"] == {"count": 5}


@pytest.mark.parametrize("seat,why", REFUSED)
def test_a_seat_that_is_not_the_callers_or_not_active_is_403(schema, seat, why):
    user = seat if seat not in (17, 999) else 1
    with pytest.raises(HTTPException) as e:
        home.home({"sub": str(user)}, str(seat))
    assert e.value.status_code == 403, why


def test_one_user_cannot_read_another_users_seat(schema):
    with pytest.raises(HTTPException):
        home.home({"sub": "1"}, "2")


@pytest.mark.parametrize("started_days_ago,n,layout,over", [
    (0, 1, "day1", False), (5, 6, "day1", False), (6, 7, "day7", False), (22, 23, "day7", False), (23, 24, "day24", False),
    (29, 30, "day24", False), (30, 30, "day24", True), (90, 30, "day24", True), (-2, 1, "day1", False),
])
def test_the_layout_boundaries_on_real_rows(schema, started_days_ago, n, layout, over):
    started = datetime.combine(TODAY - timedelta(days=started_days_ago), datetime.min.time()).replace(hour=9)
    run(schema, "update {s}.home_seat_state set trial_started_at = %s where tier_agent_id = 1", started)
    assert get(1)["day"] == {"n": n, "trial_days": 30, "layout": layout, "over": over}


def test_a_seat_with_no_home_state_is_not_ready(schema):
    run(schema, "delete from {s}.home_seat_state where tier_agent_id = 2")
    body = get(2)
    assert body["ready"] is False and body["day"] is None and body["score"] is None and body["person"] is None


def test_a_seat_with_no_snapshot_is_not_ready(schema):
    run(schema, "delete from {s}.home_snapshots where tier_agent_id = 2")
    assert get(2)["ready"] is False


def test_since_claim_is_null_when_the_claim_pointer_is_cleared(schema):
    run(schema, "update {s}.home_seat_state set claim_snapshot_id = null where tier_agent_id = 1")
    assert get(1)["score"]["since_claim"] is None


def test_week_delta_is_null_when_only_recent_snapshots_exist(schema):
    seat = with_a_week_of_history()
    ids = [r["id"] for r in q(schema, "select id from {s}.home_snapshots where tier_agent_id = %s order by as_of, id", seat)]
    newest = q(schema, "select max(as_of) m from {s}.home_snapshots where tier_agent_id = %s", seat)[0]["m"]
    assert get(seat)["score"]["week_delta"] is not None
    for i, sid in enumerate(ids[:-1]):          # every older snapshot moves to just under two days before the newest
        run(schema, "update {s}.home_snapshots set as_of = %s where id = %s", newest - timedelta(days=2, hours=i), sid)
    assert get(seat)["score"]["week_delta"] is None


def test_there_is_no_rival_when_no_competitor_outscores_the_seat(schema):
    run(schema, "update {s}.home_competitors set score = 0 where tier_agent_id = 1")
    body = get(1)
    assert body["rival"] is None and body["competitors"] == {"count": 5}


def test_a_competitor_tied_with_the_seat_is_not_a_rival(schema):
    total = get(1)["score"]["total"]
    run(schema, "update {s}.home_competitors set score = %s where tier_agent_id = 1", total)
    assert get(1)["rival"] is None


def test_a_snapshot_without_lane_rows_has_unknown_points_but_a_known_maximum(schema):
    run(schema, "delete from {s}.home_snapshot_lanes where snapshot_id = (select id from {s}.home_snapshots where tier_agent_id = 1 order by as_of desc limit 1)")
    sc = get(1)["score"]
    assert sc["max"] == 850 and all(l["points"] is None for l in sc["lanes"]) and len(sc["lanes"]) == 10


def test_other_seats_rows_never_leak_into_a_response(schema):
    run(schema, "update {s}.home_competitors set name = 'Seat Two Only' where tier_agent_id = 2")
    assert get(1)["rival"]["name"] != "Seat Two Only"
    # the hardening script refuses a total its lanes do not add up to; switch its triggers off to make the drift this test is about
    run(schema, "alter table {s}.home_snapshots disable trigger user")
    run(schema, "update {s}.home_snapshots set total = 1 where tier_agent_id = 2")
    run(schema, "alter table {s}.home_snapshots enable trigger user")
    assert get(1)["score"]["total"] == planned()[1].snapshots[-1].total


def test_a_text_year_is_no_year_and_credentials_count_the_array(schema):
    run(schema, "update {s}.tier_agents set year_started = 'n/a' where id = 2")
    assert get(2)["person"]["year_started"] is None
    run(schema, "update {s}.tier_agent_details set certifications = '[\"a\",\"b\",\"c\"]'::jsonb where tier_agent_id = 1")
    assert get(1)["person"]["credentials"] == 3
    run(schema, "update {s}.tier_agent_details set certifications = '{\"x\": 1}'::jsonb where tier_agent_id = 1")
    assert get(1)["person"]["credentials"] == 0


def test_the_read_runs_in_a_read_only_transaction(schema):
    with home.connection() as conn:
        conn.execute("set transaction read only")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute(f"update {schema}.home_snapshots set total = 0")


def test_a_read_changes_nothing(schema):
    def snapshot():
        return {t: q(schema, f"select * from {{s}}.{t} order by id") for t in ("home_seat_state", "home_snapshots", "home_snapshot_lanes", "home_competitors", "tier_agents")}

    before = snapshot()
    for seat in LIVE[:5]:
        get(seat)
    assert snapshot() == before


# --- part 2 (task 7): board, tiles, locked, peers, brief, drafts, events, insights, recap, plans ---------------------


@pytest.mark.parametrize("seat", LIVE)
def test_the_rest_of_the_page_is_the_stored_or_computed_rows(schema, seat):
    body, exp = get(seat), planned()[seat]
    ref = hp.reference()
    snaps, newest = exp.snapshots, exp.snapshots[-1]
    # board
    done = sorted((a for a in exp.activities if a.status == "done"), key=lambda a: a.completed_at, reverse=True)
    b = body["board"]
    assert [d["label"] for d in b["done"]] == [a.label for a in done] and b["done_count"] == len(done)
    assert b["since_claim_points"] == body["score"]["since_claim"] == newest.total - snaps[0].total      # the done list adds up to the gain
    latest = max(exp.activities, key=lambda a: a.completed_at or a.started_at)
    assert (b["latest"]["label"], b["latest"]["status"]) == (latest.label, latest.status)
    assert b["moves"] == {"done": exp.state.moves_done, "goal": 3} and b["streak_weeks"] == exp.state.streak_weeks
    assert [(m["title"], m["target"], m["points"]) for m in b["next_moves"]] == [(m.title, m.target, m.points) for m in exp.moves]
    assert b["needs_you_count"] == sum(1 for d in exp.drafts if d.status == "draft")
    # tiles
    t = body["tiles"]
    assert [(c["row"], c["col"], c["rank"]) for c in t["map"]["cells"]] == [(c.row, c.col, c.rank) for c in newest.cells]
    assert t["map"]["total"] == 49 and t["map"]["top3"] == sum(1 for c in newest.cells if c.rank is not None and c.rank <= 3)
    assert t["ai"] == {"cited": newest.ai_cited, "checked": 7, "checked_at": newest.ai_checked_at.isoformat() + "Z"}
    assert t["reviews"]["count"] == newest.review_count and t["reviews"]["avg"] == newest.review_avg
    week = next((x for x in reversed(snaps[:-1]) if x.as_of <= newest.as_of - timedelta(days=7)), None)
    baseline = week or snaps[0]
    assert t["profile_strength"] == {"pct": newest.profile_strength_pct, "previous_pct": baseline.profile_strength_pct}
    arts = q(schema, "select count(*) filter (where published and article_archived_at is null) p, count(*) filter (where article_archived_at is null) t "
                     "from {s}.voce_articles where tier_agent_id = %s", seat)[0]
    assert t["articles"] == {"published": arts["p"], "total": arts["t"]}
    site = q(schema, "select total_score, website_url from {s}.website_analytics_data where tier_agent_id = %s", seat)[0]
    assert t["website"] == {"score": site["total_score"], "max": 102, "url": site["website_url"]}
    # locked features, peers, brief
    rank = {p.key: p.position for p in ref.plans}
    waiting = {f.feature_key: (None if f.lane is None else newest_gap(ref, newest, f.lane)) for f in exp.locked if rank[f.plan] > rank[exp.state.plan]}
    assert {f["key"]: f["points_waiting"] for f in body["locked"]["features"]} == waiting
    assert body["locked"]["points_waiting"] == sum(v or 0 for v in waiting.values())
    assert body["peers"]["band_from"] == "Building" and body["peers"]["median_gain"] == 61 and body["peers"]["of"] == 5
    assert [(i["label"], i["points"]) for i in body["brief"]["items"]] == [(i.label, i.points) for i in exp.brief.items]
    assert body["brief"]["points_total"] == (body["score"]["week_delta"] if body["score"]["week_delta"] is not None else body["score"]["since_claim"])
    assert body["brief"]["next_move"]["target"] == exp.brief.next_move_target and body["brief"]["away"]["new_reviews"] == exp.brief.away_new_reviews
    # drafts, events, insights, plans
    open_ = [d for d in exp.drafts if d.status == "draft"]
    assert sorted((d["reviewer_label"], d["rating"], d["compliance_status"]) for d in body["drafts"]) == sorted((d.reviewer_label, d.rating, d.compliance_status) for d in open_)
    assert [e["kind"] for e in body["events"]] == [e.kind for e in exp.events]
    assert [(i["position"], i["action"]) for i in body["insights"]] == [(i.position, i.action) for i in exp.insights]
    assert [p["key"] for p in body["plans"]] == ["core", "engage", "amplify"] and body["plans"][0]["items"] == ref.plans[0].items
    # recap
    if exp.layout != "day24":
        assert body["recap"] is None
    else:
        r = body["recap"]
        assert r["days"] == body["day"]["n"] and r["things_done"] == len(done) and r["articles"] == arts["p"]
        assert r["replies"] == sum(1 for d in exp.drafts if d.status == "posted")
        assert r["tiles"][0] == {"label": "Score", "from": snaps[0].total, "to": newest.total, "delta": newest.total - snaps[0].total}
        assert r["tiles"][1] == {"label": "Rank", "from": snaps[0].rank_position, "to": newest.rank_position, "delta": snaps[0].rank_position - newest.rank_position}


def newest_gap(ref, newest, lane_key):
    return max(0, next(l.max_points for l in ref.lanes if l.key == lane_key) - newest.lanes[lane_key])


def test_a_higher_plan_unlocks_features_on_real_rows(schema):
    run(schema, "update {s}.home_seat_state set plan_id = (select id from {s}.home_plans where key = 'engage') where tier_agent_id = 1")
    assert [f["key"] for f in get(1)["locked"]["features"]] == ["map_rank"]
    run(schema, "update {s}.home_seat_state set plan_id = (select id from {s}.home_plans where key = 'amplify') where tier_agent_id = 1")
    assert get(1)["locked"] == {"features": [], "points_waiting": 0}


def test_expired_events_and_posted_drafts_do_not_show(schema):
    seat = next(s for s in LIVE if planned()[s].events and any(d.status == "draft" for d in planned()[s].drafts))
    run(schema, "update {s}.home_events set expires_at = %s where tier_agent_id = %s and kind = 'facebook'", datetime(2026, 10, 1, 0, 0), seat)
    run(schema, "update {s}.home_review_drafts set status = 'posted' where tier_agent_id = %s", seat)
    body = get(seat)
    assert all(e["kind"] != "facebook" for e in body["events"]) and body["drafts"] == [] and body["board"]["needs_you_count"] == 0


def test_a_seat_with_no_brief_has_a_null_brief(schema):
    run(schema, "delete from {s}.home_weekly_briefs where tier_agent_id = 1")
    assert get(1)["brief"] is None


def test_no_benchmark_for_the_starting_band_means_no_peers(schema):
    run(schema, "delete from {s}.home_peer_benchmarks")
    assert get(1)["peers"] is None


def test_a_published_article_counts_and_an_archived_one_does_not(schema):
    before = get(1)["tiles"]["articles"]
    run(schema, "insert into {s}.voce_articles (tier_agent_id, article_id, title, published, created_at, updated_at) values (1, 'it-new', 'x', true, now(), now())")
    run(schema, "insert into {s}.voce_articles (tier_agent_id, article_id, title, published, article_archived_at, created_at, updated_at) values (1, 'it-arch', 'x', true, now(), now(), now())")
    after = get(1)["tiles"]["articles"]
    assert after == {"published": before["published"] + 1, "total": before["total"] + 1}


def test_the_newest_website_row_is_the_one_shown(schema):
    run(schema, "insert into {s}.website_analytics_data (tier_agent_id, total_score, website_url, last_refreshed_time, created_at, updated_at) "
                "values (1, 7, 'https://example.test/newest', '2999-01-01', now(), now())")
    assert get(1)["tiles"]["website"] == {"score": 7, "max": 102, "url": "https://example.test/newest"}
