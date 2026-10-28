"""Home-page seed on real Postgres (srp/home-page-data task 1, srp/home-page-schema task 4): idempotence, in-place updates, backup,
cleanup of old rows, and the 17 `home_*` tables.

Skipped unless SRP_TEST_DATABASE_URL is set to a database with the `srp_cleanup` schema (it copies those tables' shapes into a
scratch schema that is created and dropped here, and runs `srp/db/local/home_schema.sql` into it, so the script itself is what is tested):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/v3_local uv run pytest srp/tests/test_seed_home_integration.py
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import date, datetime, time, timedelta
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from _base.config import get_settings
from _base.db import session as db_session
from surfaces.srp.seat import seed_connections_plan as cpn
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_insights_plan as ip
from surfaces.srp.seat import seed_network_plan as npl
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat import seed_web_plan as wpn

URL = os.environ.get("SRP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="SRP_TEST_DATABASE_URL is not set")

TABLES = ["users", "tier_agents", "srs_config_categories", "user_search_rank_scores", "voce_articles",
          "website_analytics_data", "ai_authority_stats", "tier_agent_details"]
HOME_TABLES = [
    "home_score_lanes", "home_score_bands", "home_plans", "home_peer_benchmarks", "home_snapshots", "home_snapshot_lanes",
    "home_map_cells", "home_seat_state", "home_competitors", "home_activity", "home_next_moves", "home_locked_features",
    "home_weekly_briefs", "home_weekly_brief_items", "home_review_drafts", "home_events", "home_nora_insights", "srs_lane_gaps", "profile_facts", "profile_graph_groups",
    "insights_visibility", "insights_ai_engines", "insights_competitor_positions", "insights_spot_leaders", "web_checks", "connected_accounts", "network_partners", "network_referrals",
]  # the tables the seed writes for the pages: the 17 Home tables and the SRS page's lane gaps
SCRIPT = Path(__file__).resolve().parents[1] / "db" / "local" / "home_schema.sql"
HARDENING = SCRIPT.with_name("home_schema_hardening.sql")
SRS = SCRIPT.with_name("srs_schema.sql")
PROFILE = SCRIPT.with_name("profile_schema.sql")
INSIGHTS = SCRIPT.with_name("insights_schema.sql")
WEB = SCRIPT.with_name("web_analytics_schema.sql")
CONNECTIONS = SCRIPT.with_name("connections_schema.sql")
NETWORK = SCRIPT.with_name("network_schema.sql")
AS_OF = date(2026, 10, 27)
N_SEATS = 26


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
        c.execute(re.sub(r"\bsrp_cleanup\b", name, SRS.read_text()))         # and the SRS page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, PROFILE.read_text()))     # and the Profile page's tables
        c.execute(re.sub(r"\bsrp_cleanup\b", name, INSIGHTS.read_text()))    # and the Insights page's tables
        c.execute(re.sub(r"\bsrp_cleanup\b", name, WEB.read_text()))         # and the Web analytics page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, CONNECTIONS.read_text()))  # and the Connections page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, NETWORK.read_text()))  # and the Network page's tables
        for i in range(1, N_SEATS + 1):
            c.execute(f"insert into {name}.users (id, email, first_name, password_digest, organization_id, created_at, updated_at) "
                      f"overriding system value values (%s, %s, 'U', 'x', 1, now(), now())", (i, f"it{i}@example.test"))
            c.execute(f"insert into {name}.tier_agents (id, tier_id, user_id, year_started, zipcode, profile_photo, created_at, updated_at) "
                      f"overriding system value values (%s, 1, %s, '1990', '00000', 'https://example.test/old.jpg', now(), now())", (i, i))
        for cid, mx in [(1, 5), (2, 7), (3, None), (4, 6)]:
            c.execute(f"insert into {name}.srs_config_categories (id, name, score, created_at, updated_at) overriding system value "
                      f"values (%s, %s, %s, now(), now())", (cid, f"Mock category {cid}", mx))
        # old random mock rows that the seed must replace (and back up): duplicates, junk, and rows for a seat
        for seat in (1, 2, 3):
            c.execute(f"insert into {name}.user_search_rank_scores (tier_agent_id, srs_config_category_id, srs_category_score, created_at, updated_at) "
                      f"values (%s, 99, 1, now(), now()), (%s, 1, 3, now(), now()), (%s, 1, 4, now(), now())", (seat, seat, seat))
            c.execute(f"insert into {name}.voce_articles (tier_agent_id, article_id, title, published, created_at, updated_at) "
                      f"values (%s, 'old-1', 'Old', true, now(), now())", (seat,))
            c.execute(f"insert into {name}.website_analytics_data (tier_agent_id, total_score, created_at, updated_at) "
                      f"values (%s, 5, now(), now()), (%s, 6, now(), now())", (seat, seat))
            c.execute(f"insert into {name}.ai_authority_stats (agent_id, ai_authority_score, created_at, updated_at) values (%s, 9, now(), now())", (seat,))
    monkeypatch.setattr(sh, "_today", lambda: AS_OF)  # the default date is fixed, so runs are comparable
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SRP_LOCAL_SCHEMA", name)
    get_settings.cache_clear()
    db_session.close_pools()
    yield name
    db_session.close_pools()
    get_settings.cache_clear()
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"drop schema {name} cascade")


def _q(schema, sql, *params):
    with psycopg.connect(URL, autocommit=True, row_factory=dict_row) as c:
        return c.execute(sql.replace("{s}", schema), params).fetchall()


def _snapshot(schema):
    """Every row of the five seeded tables and the three seat columns, ids included."""
    return {
        t: _q(schema, f"select * from {{s}}.{t} order by id")
        for t in ["user_search_rank_scores", "voce_articles", "website_analytics_data", "ai_authority_stats", "tier_agent_details", "tier_agents"]
    }


def test_after_the_seed_every_seat_has_scores_peers_a_website_and_credentials(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.seats == N_SEATS
    cats = _q(schema, "select id, score from {s}.srs_config_categories order by id")
    scores = _q(schema, "select tier_agent_id, srs_config_category_id c, srs_category_score s, zipcode, vertical_id from {s}.user_search_rank_scores")
    for seat in range(1, N_SEATS + 1):
        mine = {r["c"]: r for r in scores if r["tier_agent_id"] == seat}
        assert set(mine) == {c["id"] for c in cats}, seat  # exactly one row per category, the junk category 99 is gone
        for c in cats:
            if c["score"] is None:
                assert mine[c["id"]]["s"] is None
            else:
                assert 0 <= mine[c["id"]]["s"] <= c["score"]
    groups = {}
    for r in scores:
        groups.setdefault((r["zipcode"], r["vertical_id"]), set()).add(r["tier_agent_id"])
    assert all(len(v) >= sh.PEER_GROUP_MIN for v in groups.values())
    web = _q(schema, "select tier_agent_id, count(*) n from {s}.website_analytics_data group by 1")
    assert {r["tier_agent_id"]: r["n"] for r in web} == {s: 1 for s in range(1, N_SEATS + 1)}
    assert len(_q(schema, "select 1 from {s}.tier_agent_details")) == N_SEATS
    assert any(r["ai"] == 0 for r in _q(schema, "select ta.id, (select count(*) from {s}.ai_authority_stats a where a.agent_id = ta.id) ai from {s}.tier_agents ta"))
    seat = _q(schema, "select year_started, zipcode, profile_photo from {s}.tier_agents where id = 1")[0]
    assert 2003 <= int(seat["year_started"]) <= 2022 and seat["zipcode"].isdigit() and seat["profile_photo"] is None


def test_old_rows_are_replaced_and_old_articles_are_gone(schema):
    sh.seed(dry_run=False, backup_path=None)
    assert _q(schema, "select 1 from {s}.voce_articles where article_id = 'old-1'") == []
    assert _q(schema, "select 1 from {s}.voce_articles where left(article_id, 10) <> 'seed-home-'") == []


def test_running_it_twice_changes_nothing_not_even_ids(schema):
    sh.seed(dry_run=False, backup_path=None)
    first = _snapshot(schema)
    second_report = sh.seed(dry_run=False, backup_path=None)
    assert _snapshot(schema) == first
    assert second_report.changed.get("inserted", 0) == 0 and second_report.changed.get("deleted", 0) == 0


def test_the_backup_holds_every_old_row_that_was_changed_or_removed(schema, tmp_path):
    path = tmp_path / "home-backup.jsonl"
    sh.seed(dry_run=False, backup_path=path)
    lines = [json.loads(line) for line in path.read_text().splitlines()]
    by_table = {}
    for line in lines:
        by_table.setdefault(line["table"], []).append(line["row"])
    assert len(by_table["user_search_rank_scores"]) == 9          # the 3 old rows for each of 3 seats
    assert {r["article_id"] for r in by_table["voce_articles"]} == {"old-1"}
    assert len(by_table["website_analytics_data"]) == 6
    assert len(by_table["ai_authority_stats"]) == 3
    assert {r["year_started"] for r in by_table["tier_agents"]} == {"1990"}  # the previous value of a column it overwrites
    assert (path.stat().st_mode & 0o777) == 0o600


def test_a_dry_run_writes_nothing(schema):
    before = _snapshot(schema)
    report = sh.seed(dry_run=True, backup_path=None)
    assert report.dry_run and report.seats == N_SEATS
    assert _snapshot(schema) == before


def test_an_existing_backup_file_stops_the_run_before_any_change(schema, tmp_path):
    path = tmp_path / "exists.jsonl"
    path.write_text("keep")
    before = _snapshot(schema)
    with pytest.raises(FileExistsError):
        sh.seed(dry_run=False, backup_path=path)
    assert path.read_text() == "keep" and _snapshot(schema) == before


def test_users_who_are_deactivated_get_no_seed_rows(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.users set deactivated_at = now() where id = 5")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.seats == N_SEATS - 1
    assert _q(schema, "select 1 from {s}.user_search_rank_scores where tier_agent_id = 5") == []


# --- the Home tables (srp/home-page-schema, task 4) ------------------------------------------------------------

def _home_snapshot(schema):
    return {t: _q(schema, f"select * from {{s}}.{t} order by id") for t in HOME_TABLES}


def _count(schema, table, where="true"):
    return _q(schema, f"select count(*) n from {{s}}.{table} where {where}")[0]["n"]


def test_the_reference_rows_are_written(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    lanes = _q(schema, "select key, max_points from {s}.home_score_lanes order by position")
    assert len(lanes) == 10 and sum(r["max_points"] for r in lanes) == 850
    assert [(r["name"], r["min_points"]) for r in _q(schema, "select name, min_points from {s}.home_score_bands order by position")] == [
        ("Building", 0), ("Established", 400), ("Leading", 600), ("Elite", 750)]
    assert [r["key"] for r in _q(schema, "select key from {s}.home_plans order by position")] == ["core", "engage", "amplify"]
    bench = _q(schema, "select b.name, p.median_gain, p.cohort_of from {s}.home_peer_benchmarks p join {s}.home_score_bands b on b.id = p.band_id order by b.position")
    assert [r["name"] for r in bench] == ["Building", "Established", "Leading"] and bench[0]["median_gain"] == 61
    assert report.planned["home_score_lanes"] == 10 and report.planned["home_plans"] == 3


def test_every_seat_gets_a_complete_set_of_home_rows(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    n = N_SEATS
    assert _count(schema, "home_seat_state") == n and _count(schema, "home_seat_state", "is_mock") == n
    per_seat = _q(schema, "select tier_agent_id, count(*) c from {s}.home_snapshots group by 1")
    assert len(per_seat) == n and all(2 <= r["c"] <= 4 for r in per_seat)
    snaps = _count(schema, "home_snapshots")
    assert _count(schema, "home_snapshot_lanes") == 10 * snaps
    assert _count(schema, "home_map_cells") == 49 * n
    assert _count(schema, "home_competitors") == 5 * n and _count(schema, "home_competitors", "is_market_leader") == n
    assert _count(schema, "home_next_moves") == 3 * n and _count(schema, "home_locked_features") == 3 * n
    assert _count(schema, "home_nora_insights") == 3 * n and _count(schema, "home_weekly_briefs") == n
    assert _q(schema, "select 1 from (select tier_agent_id, count(*) c from {s}.home_activity where status = 'done' group by 1) x where c < 4") == []
    for table, planned in report.planned.items():
        if table.startswith("home_"):
            assert _count(schema, table) == planned, table


def test_the_stored_rows_keep_the_invariants_the_page_relies_on(schema):
    sh.seed(dry_run=False, backup_path=None)
    # lane points add up to every snapshot's total, and never pass a lane's maximum
    assert _q(schema, "select s.id from {s}.home_snapshots s join (select snapshot_id, sum(points) p from {s}.home_snapshot_lanes group by 1) l "
                      "on l.snapshot_id = s.id where l.p <> s.total") == []
    assert _q(schema, "select 1 from {s}.home_snapshot_lanes sl join {s}.home_score_lanes l on l.id = sl.lane_id where sl.points > l.max_points") == []
    # the claim pointer is each seat's earliest snapshot
    assert _count(schema, "home_seat_state st join {s}.home_snapshots s on s.id = st.claim_snapshot_id",
                  "s.as_of = (select min(as_of) from {s}.home_snapshots x where x.tier_agent_id = st.tier_agent_id)".replace("{s}", schema)) == N_SEATS
    # the leader outscores the seat's newest total
    assert _q(schema, "select 1 from {s}.home_competitors c join {s}.home_snapshots s on s.tier_agent_id = c.tier_agent_id "
                      "where c.is_market_leader and s.as_of = (select max(as_of) from {s}.home_snapshots where tier_agent_id = c.tier_agent_id) and c.score <= s.total") == []
    # done activities add up to the gain since the claim
    assert _q(schema, "select a.tier_agent_id from (select tier_agent_id, sum(points) p from {s}.home_activity where status = 'done' group by 1) a "
                      "join (select tier_agent_id, max(total) - min(total) g from {s}.home_snapshots group by 1) g on g.tier_agent_id = a.tier_agent_id where a.p <> g.g") == []
    # one 49-cell map, on the newest snapshot only
    assert _q(schema, "select 1 from {s}.home_map_cells m join {s}.home_snapshots s on s.id = m.snapshot_id "
                      "where s.as_of <> (select max(as_of) from {s}.home_snapshots where tier_agent_id = s.tier_agent_id)") == []


def test_seats_land_on_all_three_layouts_by_their_trial_dates(schema):
    sh.seed(dry_run=False, backup_path=None)
    days = [(AS_OF - r["trial_started_at"].date()).days + 1 for r in _q(schema, "select trial_started_at from {s}.home_seat_state")]
    layouts = {"day1" if n < 7 else "day7" if n < 24 else "day24" for n in days}
    assert layouts == {"day1", "day7", "day24"} and all(1 <= n <= 30 for n in days)


def test_running_it_twice_with_the_same_date_changes_nothing_ids_included(schema):
    sh.seed(dry_run=False, backup_path=None)
    first, first_old = _home_snapshot(schema), _snapshot(schema)
    report = sh.seed(dry_run=False, backup_path=None)
    assert _home_snapshot(schema) == first and _snapshot(schema) == first_old
    assert report.changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_a_later_date_moves_the_dates_and_keeps_the_per_seat_rows(schema):
    sh.seed(dry_run=False, backup_path=None)
    before = _home_snapshot(schema)
    shift = timedelta(days=3)
    sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + shift)
    after = _home_snapshot(schema)
    assert {t: len(rows) for t, rows in after.items()} == {t: len(rows) for t, rows in before.items()}
    old = {(r["tier_agent_id"]): r for r in before["home_seat_state"]}
    for row in after["home_seat_state"]:
        assert row["trial_started_at"] - old[row["tier_agent_id"]]["trial_started_at"] == shift
        assert row["id"] == old[row["tier_agent_id"]]["id"]          # updated in place, not replaced
    assert [r["id"] for r in after["home_competitors"]] == [r["id"] for r in before["home_competitors"]]
    assert _count(schema, "home_snapshot_lanes") == 10 * _count(schema, "home_snapshots")      # the old snapshots' children went with them
    assert _count(schema, "home_seat_state", "claim_snapshot_id is null") == 0
    third = sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + shift)
    assert third.changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_the_backup_holds_the_old_home_rows_that_a_later_run_changes(schema, tmp_path):
    sh.seed(dry_run=False, backup_path=None)
    old_snaps = _count(schema, "home_snapshots")
    path = tmp_path / "later.jsonl"
    sh.seed(dry_run=False, backup_path=path, as_of=AS_OF + timedelta(days=3))
    by_table = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        by_table.setdefault(row["table"], []).append(row["row"])
    assert len(by_table["home_snapshots"]) == old_snaps and len(by_table["home_seat_state"]) == N_SEATS
    assert len(by_table["home_score_lanes"]) == 10 and len(by_table["home_snapshot_lanes"]) == 10 * old_snaps
    assert (path.stat().st_mode & 0o777) == 0o600


def test_a_dry_run_writes_no_home_rows_and_reports_them(schema):
    before = _home_snapshot(schema)
    report = sh.seed(dry_run=True, backup_path=None)
    assert _home_snapshot(schema) == before == {t: [] for t in HOME_TABLES}
    assert report.planned["home_snapshots"] > 0 and report.planned["home_map_cells"] == 49 * N_SEATS


def test_changed_or_extra_home_rows_are_put_right_and_the_rest_is_untouched(schema):
    sh.seed(dry_run=False, backup_path=None)
    expected = _home_snapshot(schema)
    with psycopg.connect(URL, autocommit=True) as c:
        # the hardening script refuses these two changes; switch its triggers off to make the drift the seed must put right
        c.execute(f"alter table {schema}.home_score_lanes disable trigger user")
        c.execute(f"alter table {schema}.home_snapshots disable trigger user")
        c.execute(f"update {schema}.home_score_lanes set max_points = 1 where key = 'reviews'")
        c.execute(f"update {schema}.home_snapshots set total = total - 1 where id = (select min(id) from {schema}.home_snapshots)")
        c.execute(f"alter table {schema}.home_score_lanes enable trigger user")
        c.execute(f"alter table {schema}.home_snapshots enable trigger user")
        # the rival's Insights position goes first: the database refuses to delete a rival that a position still names
        c.execute(f"delete from {schema}.insights_competitor_positions where competitor_id in (select id from {schema}.home_competitors where position = 5 and tier_agent_id = 1)")
        c.execute(f"delete from {schema}.home_competitors where position = 5 and tier_agent_id = 1")
        c.execute(f"insert into {schema}.home_activity (tier_agent_id, label, status) values (1, 'Junk', 'done')")
        c.execute(f"insert into {schema}.home_review_drafts (tier_agent_id, reviewer_label, rating, review_text, draft_text, compliance_status) "
                  f"values (2, 'Reviewer Z. (mock)', 3, 'x', 'y', 'passed')")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed["updated"] >= 2 and report.changed["inserted"] >= 1 and report.changed["deleted"] >= 2
    after = _home_snapshot(schema)
    for t in HOME_TABLES:
        if t != "home_competitors":                       # the deleted competitor comes back as a new row with a new id (and its position with it)
            skip = {"id", "competitor_id"} if t == "insights_competitor_positions" else {"id"}
            def rows(snap, t=t, skip=skip):  # the restored row has the highest id: compare as sets
                return sorted(({k: v for k, v in r.items() if k not in skip} for r in snap[t]), key=repr)

            assert rows(after) == rows(expected), t
    assert _count(schema, "home_competitors", "tier_agent_id = 1") == 5


def test_users_who_are_deactivated_get_no_home_rows_and_their_old_rows_are_left_alone(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.users set deactivated_at = now() where id = 5")
        c.execute(f"insert into {schema}.home_activity (tier_agent_id, label, status) values (5, 'Left alone', 'done')")
    sh.seed(dry_run=False, backup_path=None)
    for table in ("home_seat_state", "home_snapshots", "home_competitors", "home_next_moves", "home_locked_features", "home_weekly_briefs", "home_nora_insights", "srs_lane_gaps", "profile_facts", "profile_graph_groups", "insights_visibility", "insights_ai_engines", "insights_competitor_positions"):
        assert _count(schema, table, "tier_agent_id = 5") == 0, table
    assert _count(schema, "home_activity", "tier_agent_id = 5") == 1


def test_the_default_date_is_today_in_utc(schema, monkeypatch):
    monkeypatch.setattr(sh, "_today", lambda: date(2026, 11, 20))
    sh.seed(dry_run=False, backup_path=None)
    newest = _q(schema, "select max(as_of) m from {s}.home_snapshots")[0]["m"]
    assert newest == datetime.combine(date(2026, 11, 20), time(12, 0))


def test_the_rows_stored_are_the_rows_planned(schema):
    sh.seed(dry_run=False, backup_path=None)
    home_plan = hp.build_home_plan(list(range(1, N_SEATS + 1)), AS_OF)
    seats = list(range(1, N_SEATS + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    published = {p.seat_id: sum(1 for a in p.articles if a["published"] and not a["archived"]) for p in plans}
    web = wpn.build_web_plan(home_plan, pp.build_profile_plan(seats, AS_OF), published, {p.seat_id: p.website["website_url"] for p in plans})
    home_plan = wpn.align_home(home_plan, web)   # as the seed writes it (the website texts, move points and brief item follow the markup state)
    conns = cpn.build_connections_plan(home_plan, pp.build_profile_plan(seats, AS_OF), AS_OF)
    plan = {s.seat_id: s for s in cpn.align_home(home_plan, conns).seats}   # and the Connections count and the Facebook event follow the connected accounts
    for seat, expected in plan.items():
        state = _q(schema, "select p.key plan, st.trial_started_at, st.moves_done, st.streak_weeks, st.nora_text_day from {s}.home_seat_state st "
                           "join {s}.home_plans p on p.id = st.plan_id where st.tier_agent_id = %s", seat)[0]
        assert (state["plan"], state["trial_started_at"], state["moves_done"], state["streak_weeks"], state["nora_text_day"]) == (
            expected.state.plan, expected.state.trial_started_at, expected.state.moves_done, expected.state.streak_weeks, expected.state.nora_text_day)
        snaps = _q(schema, "select s.as_of, s.total, b.name band, s.profile_strength_pct, s.review_count, s.ai_cited, s.review_avg from {s}.home_snapshots s "
                           "join {s}.home_score_bands b on b.id = s.band_id where s.tier_agent_id = %s order by s.as_of", seat)
        assert [(r["as_of"], r["total"], r["band"], r["profile_strength_pct"], r["review_count"], r["ai_cited"], float(r["review_avg"])) for r in snaps] == [
            (x.as_of, x.total, x.band, x.profile_strength_pct, x.review_count, x.ai_cited, x.review_avg) for x in expected.snapshots]
        lanes = _q(schema, "select l.key, sl.points from {s}.home_snapshot_lanes sl join {s}.home_score_lanes l on l.id = sl.lane_id "
                           "join {s}.home_snapshots s on s.id = sl.snapshot_id where s.tier_agent_id = %s and s.as_of = %s", seat, expected.snapshots[-1].as_of)
        assert {r["key"]: r["points"] for r in lanes} == expected.snapshots[-1].lanes
        cells = _q(schema, "select m.row_no, m.col_no, m.rank from {s}.home_map_cells m join {s}.home_snapshots s on s.id = m.snapshot_id "
                           "where s.tier_agent_id = %s order by m.row_no, m.col_no", seat)
        assert [(r["row_no"], r["col_no"], r["rank"]) for r in cells] == [(c.row, c.col, c.rank) for c in expected.snapshots[-1].cells]
        comps = _q(schema, "select position, name, score, is_market_leader from {s}.home_competitors where tier_agent_id = %s order by position", seat)
        assert [(r["position"], r["name"], r["score"], r["is_market_leader"]) for r in comps] == [(c.position, c.name, c.score, c.is_market_leader) for c in expected.competitors]
        locked = _q(schema, "select f.feature_key, l.key lane, p.key plan from {s}.home_locked_features f left join {s}.home_score_lanes l on l.id = f.lane_id "
                            "join {s}.home_plans p on p.id = f.plan_id where f.tier_agent_id = %s order by f.feature_key", seat)
        assert [(r["feature_key"], r["lane"], r["plan"]) for r in locked] == sorted((f.feature_key, f.lane, f.plan) for f in expected.locked)
        items = _q(schema, "select i.position, i.label, i.points from {s}.home_weekly_brief_items i join {s}.home_weekly_briefs b on b.id = i.brief_id "
                           "where b.tier_agent_id = %s order by i.position", seat)
        assert [(r["position"], r["label"], r["points"]) for r in items] == [(i.position, i.label, i.points) for i in expected.brief.items]
        drafts = _q(schema, "select reviewer_label, rating, status, compliance_status from {s}.home_review_drafts where tier_agent_id = %s order by reviewer_label", seat)
        assert [(r["reviewer_label"], r["rating"], r["status"], r["compliance_status"]) for r in drafts] == sorted(
            (d.reviewer_label, d.rating, d.status, d.compliance_status) for d in expected.drafts)
        events = _q(schema, "select kind, expires_at from {s}.home_events where tier_agent_id = %s order by kind", seat)
        assert [(r["kind"], r["expires_at"]) for r in events] == sorted((e.kind, e.expires_at) for e in expected.events)
        acts = _q(schema, "select label, points, status from {s}.home_activity where tier_agent_id = %s order by label", seat)
        assert [(r["label"], r["points"], r["status"]) for r in acts] == sorted((a.label, a.points, a.status) for a in expected.activities)


# --- the SRS page's lane gaps and short names (srp/srs-page-schema, task 4) -------------------------------------------------

SHORT = {"reviews": "Reviews", "completeness": "Completeness", "website": "Website", "articles": "Articles", "gbp": "GBP",
         "directories": "Directories", "qa": "Q&A", "connections": "Connections", "videos": "Videos", "audio": "Audio"}


def test_the_lane_short_names_are_written(schema):
    sh.seed(dry_run=False, backup_path=None)
    assert {r["key"]: r["short_name"] for r in _q(schema, "select key, short_name from {s}.home_score_lanes")} == SHORT


def test_every_seat_gets_one_gap_row_per_lane_and_the_count_is_planned(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    assert _count(schema, "srs_lane_gaps") == 10 * N_SEATS == report.planned["srs_lane_gaps"]
    assert _q(schema, "select tier_agent_id from {s}.srs_lane_gaps group by 1 having count(*) <> 10") == []
    assert _count(schema, "srs_lane_gaps", "is_mock") == 10 * N_SEATS
    assert _q(schema, "select 1 from {s}.srs_lane_gaps g left join {s}.home_score_lanes l on l.id = g.lane_id where l.id is null") == []


def test_the_stored_gap_rows_are_the_planned_ones(schema):
    """The Home plan with its website text aligned with the Web analytics checks (spec W4): every other column and row is the Home plan's own."""
    sh.seed(dry_run=False, backup_path=None)
    plan = _web_plan()[1]
    stored = {(r["tier_agent_id"], r["key"]): r for r in _q(
        schema, "select g.*, l.key from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id")}
    for seat in plan.seats:
        for g in seat.gaps:
            row = stored[(seat.seat_id, g.lane)]
            assert (row["you_text"], row["rival_text"], row["note"], row["is_missing"], row["action_label"], row["action_target"]) == (
                g.you_text, g.rival_text, g.note, g.is_missing, g.action_label, g.action_target), (seat.seat_id, g.lane)


def test_the_reviews_and_articles_texts_agree_with_the_stored_home_counts(schema):
    sh.seed(dry_run=False, backup_path=None)
    rows = _q(schema, "select g.you_text, g.rival_text, g.note, s.review_count, c.review_count rival_reviews from {s}.srs_lane_gaps g "
                      "join {s}.home_score_lanes l on l.id = g.lane_id and l.key = 'reviews' "
                      "join {s}.home_snapshots s on s.tier_agent_id = g.tier_agent_id and s.as_of = (select max(as_of) from {s}.home_snapshots where tier_agent_id = g.tier_agent_id) "
                      "join {s}.home_competitors c on c.tier_agent_id = g.tier_agent_id and c.is_market_leader")
    assert len(rows) == N_SEATS
    for r in rows:
        assert r["you_text"] == str(r["review_count"]) and r["rival_text"] == f"{r['rival_reviews']} reviews"
        assert 1 <= int(r["note"].split()[0]) <= r["review_count"]
    rows = _q(schema, "select g.rival_text, c.article_count from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id and l.key = 'articles' "
                      "join {s}.home_competitors c on c.tier_agent_id = g.tier_agent_id and c.is_market_leader")
    assert len(rows) == N_SEATS and all(r["rival_text"] == f"{r['article_count']} articles" for r in rows)


def test_the_backup_holds_the_old_gap_rows_and_short_names_that_a_later_run_changes(schema, tmp_path):
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.srs_lane_gaps set you_text = 'Edited by hand' where tier_agent_id = 3")
        c.execute(f"update {schema}.home_score_lanes set short_name = 'Old' where key = 'gbp'")
    path = tmp_path / "gaps.jsonl"
    report = sh.seed(dry_run=False, backup_path=path)
    by_table = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        by_table.setdefault(row["table"], []).append(row["row"])
    assert len(by_table["srs_lane_gaps"]) == 10 * N_SEATS
    assert {r["you_text"] for r in by_table["srs_lane_gaps"] if r["tier_agent_id"] == 3} >= {"Edited by hand"}
    assert {r["key"]: r["short_name"] for r in by_table["home_score_lanes"]}["gbp"] == "Old"
    assert report.changed["updated"] >= 2 and report.changed["inserted"] == 0 and report.changed["deleted"] == 0
    assert _count(schema, "srs_lane_gaps", "you_text = 'Edited by hand'") == 0
    assert _q(schema, "select short_name from {s}.home_score_lanes where key = 'gbp'")[0]["short_name"] == "GBP"


def test_a_lane_gap_row_that_went_missing_comes_back_and_a_second_run_changes_nothing(schema):
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"delete from {schema}.srs_lane_gaps where tier_agent_id = 2 and lane_id = (select id from {schema}.home_score_lanes where key = 'qa')")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed == {"inserted": 1, "updated": 0, "deleted": 0}
    assert _count(schema, "srs_lane_gaps", "tier_agent_id = 2") == 10
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}


# --- the Profile page's facts, graph groups and corrected seat columns (srp/profile-page-schema, task 4) ---------------------


def _profile_plan():
    seats = list(range(1, N_SEATS + 1))
    markets = {p.seat_id: p.zipcode for p in sh.build_plan(seats, [sh.Category(1, 5)])}
    return {s.seat_id: s for s in pp.build_profile_plan(seats, datetime.combine(AS_OF, time(12, 0)), markets).seats}


def test_the_profile_tables_hold_exactly_the_planned_rows(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    plan = _profile_plan()
    stored = {(r["tier_agent_id"], r["field"]): r for r in _q(schema, "select * from {s}.profile_facts")}
    assert len(stored) == sum(len(p.facts) for p in plan.values()) == report.planned["profile_facts"]
    for seat, p in plan.items():
        for f in p.facts:
            row = stored[(seat, f.field)]
            assert (row["value"], row["source"], row["trust_tier"], row["confirmed_at"], row["is_mock"]) == (
                f.value, f.source, f.trust_tier, f.confirmed_at, True), (seat, f.field)
    groups = {(r["tier_agent_id"], r["group_key"]): r["facts"] for r in _q(schema, "select * from {s}.profile_graph_groups")}
    assert groups == {(seat, g.key): g.facts for seat, p in plan.items() for g in p.groups}
    assert report.planned["profile_graph_groups"] == 6 * N_SEATS


def test_a_string_value_is_stored_as_a_json_string_and_products_as_a_list(schema):
    sh.seed(dry_run=False, backup_path=None)
    kinds = {r["field"]: r["t"] for r in _q(schema, "select field, jsonb_typeof(value) t from {s}.profile_facts where value is not null group by 1, 2")}
    assert kinds["nmls"] == "string" and kinds["address"] == "string" and kinds["products"] == "array"
    assert _count(schema, "profile_facts", "value is null and field not in ('name','title','photo','bio','year_started','office_phone','mobile_phone','email')") == 0
    assert _count(schema, "profile_facts", "value is not null and field in ('name','title','photo','bio','year_started','office_phone','mobile_phone','email')") == 0


def test_the_seat_columns_are_corrected_and_nothing_else_of_the_seat_changes(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.tier_agents set title = 'Mock tier agents ' || id, description = 'Mock description', mobile_number = 'mobile_number 1', slug = 'keep-me'")
    sh.seed(dry_run=False, backup_path=None)
    plan = _profile_plan()
    for row in _q(schema, "select id, title, description, phone_number, mobile_number, profile_photo, slug from {s}.tier_agents where id <= %s", N_SEATS):
        c = plan[row["id"]].columns
        assert (row["title"], row["description"], row["phone_number"], row["mobile_number"], row["profile_photo"]) == (
            c.title, c.description, c.phone_number, c.mobile_number, c.profile_photo), row["id"]
        assert row["slug"] == "keep-me", "other columns of the seat are untouched"


def test_a_second_profile_run_changes_nothing_and_a_later_date_moves_dates_only(schema):
    sh.seed(dry_run=False, backup_path=None)
    before = {t: _q(schema, f"select * from {{s}}.{t} order by id") for t in ("profile_facts", "profile_graph_groups")}
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}
    later = sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + timedelta(days=3))
    after = {t: _q(schema, f"select * from {{s}}.{t} order by id") for t in ("profile_facts", "profile_graph_groups")}
    assert later.changed["updated"] > 0
    assert after["profile_graph_groups"] == before["profile_graph_groups"]
    strip = lambda rows: [{k: v for k, v in r.items() if k != "confirmed_at"} for r in rows]
    assert strip(after["profile_facts"]) == strip(before["profile_facts"])
    moved = [(b["confirmed_at"], a["confirmed_at"]) for b, a in zip(before["profile_facts"], after["profile_facts"]) if b["confirmed_at"]]
    assert moved and all(a - b == timedelta(days=3) for b, a in moved)


def test_the_backup_holds_the_old_profile_rows_and_old_seat_column_values(schema, tmp_path):
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.profile_facts set source = 'Edited by hand' where tier_agent_id = 3 and field = 'company'")
        c.execute(f"update {schema}.tier_agents set title = 'Old title', description = 'Old bio' where id = 3")
    path = tmp_path / "profile.jsonl"
    sh.seed(dry_run=False, backup_path=path)
    by_table = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        by_table.setdefault(row["table"], []).append(row["row"])
    assert len(by_table["profile_facts"]) == sum(len(p.facts) for p in _profile_plan().values())
    assert any(r["source"] == "Edited by hand" for r in by_table["profile_facts"])
    assert len(by_table["profile_graph_groups"]) == 6 * N_SEATS
    old = {r["id"]: r for r in by_table["tier_agents"]}[3]
    assert (old["title"], old["description"]) == ("Old title", "Old bio") and {"phone_number", "mobile_number"} <= set(old)
    assert _q(schema, "select title from {s}.tier_agents where id = 3")[0]["title"] == _profile_plan()[3].columns.title


def test_changed_extra_or_missing_profile_rows_are_put_right(schema):
    sh.seed(dry_run=False, backup_path=None)
    plan = _profile_plan()
    seat = next(s for s, p in plan.items() if "address" in {f.field for f in p.facts})
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.profile_facts set trust_tier = 'self_declared', value = to_jsonb('Edited'::text) where tier_agent_id = {seat} and field = 'address'")
        c.execute(f"delete from {schema}.profile_facts where tier_agent_id = {seat} and field = 'company'")
        c.execute(f"update {schema}.profile_graph_groups set facts = facts + 1 where tier_agent_id = {seat} and group_key = 'reviews'")
        # a fact the plan does not have for this seat
        missing = next((f for f in pp.OWN_FIELDS if f not in {x.field for x in plan[seat].facts}), None)
        if missing:
            c.execute(f"insert into {schema}.profile_facts (tier_agent_id, field, value, source, trust_tier) values ({seat}, '{missing}', to_jsonb('Extra'::text), 'Added by you', 'self_declared')")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed["updated"] >= 2 and report.changed["inserted"] >= 1
    want = {f.field: f for f in plan[seat].facts}
    got = {r["field"]: r for r in _q(schema, "select * from {s}.profile_facts where tier_agent_id = %s", seat)}
    assert set(got) == set(want) and got["address"]["value"] == want["address"].value and got["address"]["trust_tier"] == want["address"].trust_tier
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_no_seeded_fact_contradicts_a_rule_the_page_applies_in_the_database(schema):
    """The SRS review's lesson, checked on the written rows: presence and thin-bio rules hold in the tables, not only in the plan."""
    sh.seed(dry_run=False, backup_path=None)
    # an existing-table fact has a row exactly when its column is present
    for field, col in (("title", "title"), ("bio", "description"), ("office_phone", "phone_number"), ("mobile_phone", "mobile_number")):
        rows = _q(schema, f"select ta.id from {{s}}.tier_agents ta where ta.id <= %s and (ta.{col} is not null and btrim(ta.{col}) <> '') <> exists "
                          f"(select 1 from {{s}}.profile_facts f where f.tier_agent_id = ta.id and f.field = %s)", N_SEATS, field)
        assert rows == [], (field, rows)
    # a dated source has a date, an undated one has none
    assert _q(schema, "select 1 from {s}.profile_facts where (source in ('Confirmed by you','Approved by you','Added by you')) <> (confirmed_at is not null)") == []
    # the seat has no legacy junk left in the columns the page reads
    assert _q(schema, "select 1 from {s}.tier_agents where id <= %s and (title like 'Mock tier agents%%' or description like 'Mock description%%')", N_SEATS) == []


# --- the Insights page's four tables (srp/insights-page-schema, task 4) -----------------------------------------------------


def _insights_plan():
    seats = list(range(1, N_SEATS + 1))
    markets = {p.seat_id: p.zipcode for p in sh.build_plan(seats, [sh.Category(1, 5)])}
    return {s.seat_id: s for s in ip.build_insights_plan(hp.build_home_plan(seats, datetime.combine(AS_OF, time(12, 0)), markets)).seats}


def test_the_insights_tables_hold_exactly_the_planned_rows(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    plan = _insights_plan()
    assert report.planned["insights_visibility"] == sum(len(s.visibility) for s in plan.values()) == _count(schema, "insights_visibility")
    assert report.planned["insights_ai_engines"] == 3 * N_SEATS == _count(schema, "insights_ai_engines")
    assert report.planned["insights_competitor_positions"] == 5 * N_SEATS == _count(schema, "insights_competitor_positions")
    assert report.planned["insights_spot_leaders"] == 147 * N_SEATS == _count(schema, "insights_spot_leaders")
    vis = {(r["tier_agent_id"], r["metric"]): r for r in _q(schema, "select * from {s}.insights_visibility")}
    assert vis.keys() == {(s.seat_id, v.metric) for s in plan.values() for v in s.visibility}
    for s in plan.values():
        for v in s.visibility:
            r = vis[(s.seat_id, v.metric)]
            assert (r["value"], r["period_days"], r["source"], r["trust_tier"], r["is_mock"]) == (v.value, v.period_days, v.source, v.trust_tier, True)
    eng = {(r["tier_agent_id"], r["engine"]): r for r in _q(schema, "select * from {s}.insights_ai_engines")}
    for s in plan.values():
        for e in s.engines:
            r = eng[(s.seat_id, e.engine)]
            assert (r["cited"], r["checked"], r["note"]) == (e.cited, e.checked, e.note)
    pos = {(r["tier_agent_id"], r["position"]): r for r in _q(
        schema, "select p.tier_agent_id, c.position, c.name, p.avg_position from {s}.insights_competitor_positions p join {s}.home_competitors c on c.id = p.competitor_id")}
    for s in plan.values():
        for p in s.positions:
            r = pos[(s.seat_id, p.competitor_position)]
            assert (r["name"], float(r["avg_position"])) == (p.name, p.avg_position)
    leaders = {(r["tier_agent_id"], r["row_no"], r["col_no"], r["position"]): (r["name"], r["is_you"]) for r in _q(
        schema, "select s.tier_agent_id, c.row_no, c.col_no, l.position, l.name, l.is_you from {s}.insights_spot_leaders l "
                "join {s}.home_map_cells c on c.id = l.cell_id join {s}.home_snapshots s on s.id = c.snapshot_id")}
    assert leaders == {(s.seat_id, l.row, l.col, l.position): (l.name, l.is_you) for s in plan.values() for l in s.leaders}


def test_the_stored_insights_agree_with_home_by_join(schema):
    sh.seed(dry_run=False, backup_path=None)
    assert _q(schema, "select 1 from {s}.home_snapshots s where s.as_of = (select max(as_of) from {s}.home_snapshots m where m.tier_agent_id = s.tier_agent_id) "
                      "and (s.ai_cited, s.ai_checked) is distinct from "
                      "(select (coalesce(sum(cited), 0)::int, coalesce(sum(checked), 0)::int) from {s}.insights_ai_engines e where e.tier_agent_id = s.tier_agent_id)") == []
    # every cell has three leaders at 1, 2, 3; "You" exactly when the stored rank is 1 to 3, at that place
    assert _q(schema, "select 1 from {s}.home_map_cells c where (select count(*) from {s}.insights_spot_leaders l where l.cell_id = c.id) <> 3") == []
    assert _q(schema, "select 1 from {s}.insights_spot_leaders l join {s}.home_map_cells c on c.id = l.cell_id where l.is_you and (c.rank is null or c.rank > 3 or c.rank <> l.position)") == []
    assert _q(schema, "select 1 from {s}.home_map_cells c where c.rank between 1 and 3 and not exists (select 1 from {s}.insights_spot_leaders l where l.cell_id = c.id and l.is_you)") == []
    # a rival never appears twice in a spot, and each named leader is a rival of the same seat
    assert _q(schema, "select 1 from {s}.insights_spot_leaders where name is not null group by cell_id, name having count(*) > 1") == []
    assert _q(schema, "select 1 from {s}.insights_spot_leaders l join {s}.home_map_cells c on c.id = l.cell_id join {s}.home_snapshots s on s.id = c.snapshot_id "
                      "where l.name is not null and not exists (select 1 from {s}.home_competitors k where k.tier_agent_id = s.tier_agent_id and k.name = l.name)") == []
    # the market leader has the lowest average of its seat
    assert _q(schema, "select 1 from {s}.insights_competitor_positions p join {s}.home_competitors c on c.id = p.competitor_id where c.is_market_leader and p.avg_position > "
                      "(select min(avg_position) from {s}.insights_competitor_positions q where q.tier_agent_id = p.tier_agent_id)") == []


def test_a_second_insights_run_changes_nothing_ids_included_and_a_later_date_keeps_the_seat_rows(schema):
    sh.seed(dry_run=False, backup_path=None)
    tables = ("insights_visibility", "insights_ai_engines", "insights_competitor_positions")
    before = {t: _q(schema, f"select * from {{s}}.{t} order by id") for t in tables}
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}
    assert {t: _q(schema, f"select * from {{s}}.{t} order by id") for t in tables} == before
    later = sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + timedelta(days=3))
    assert {t: _q(schema, f"select * from {{s}}.{t} order by id") for t in tables} == before, "no date in these rows"
    assert _count(schema, "insights_spot_leaders") == 147 * N_SEATS, "the leaders followed their new map cells"
    assert later.changed["deleted"] > 0
    assert sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + timedelta(days=3)).changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_the_backup_holds_the_old_insights_rows(schema, tmp_path):
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.insights_visibility set source = 'Edited by hand' where tier_agent_id = 3 and metric = 'calls'")
        c.execute(f"update {schema}.insights_spot_leaders set name = 'Edited by hand' where id = (select min(id) from {schema}.insights_spot_leaders where name is not null)")
    path = tmp_path / "insights.jsonl"
    sh.seed(dry_run=False, backup_path=path)
    by_table = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        by_table.setdefault(row["table"], []).append(row["row"])
    assert len(by_table["insights_visibility"]) == _count(schema, "insights_visibility")
    assert any(r["source"] == "Edited by hand" for r in by_table["insights_visibility"])
    assert len(by_table["insights_ai_engines"]) == 3 * N_SEATS and len(by_table["insights_competitor_positions"]) == 5 * N_SEATS
    assert len(by_table["insights_spot_leaders"]) == 147 * N_SEATS
    assert any(r["name"] == "Edited by hand" for r in by_table["insights_spot_leaders"])
    assert _count(schema, "insights_spot_leaders", "name = 'Edited by hand'") == 0, "and the seed put it right"


def test_changed_extra_or_missing_insights_rows_are_put_right(schema):
    sh.seed(dry_run=False, backup_path=None)
    plan = _insights_plan()
    seat = next(s for s in plan.values() if len(s.visibility) == 5)
    absent = next(m for m in ip.METRICS if m not in {v.metric for v in seat.visibility})
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.insights_visibility set value = value + 1, trust_tier = 'self_declared' where tier_agent_id = 2 and metric = 'calls'")
        c.execute(f"delete from {schema}.insights_ai_engines where tier_agent_id = 2 and engine = 'gemini'")
        c.execute(f"update {schema}.insights_competitor_positions set avg_position = 20 where tier_agent_id = 2 and competitor_id = (select id from {schema}.home_competitors where tier_agent_id = 2 and position = 1)")
        c.execute(f"insert into {schema}.insights_visibility (tier_agent_id, metric, value, source, trust_tier) values ({seat.seat_id}, '{absent}', 5, 'Added by hand', 'self_declared')")
        c.execute(f"delete from {schema}.insights_spot_leaders where id = (select min(l.id) from {schema}.insights_spot_leaders l join {schema}.home_map_cells c on c.id = l.cell_id join {schema}.home_snapshots s on s.id = c.snapshot_id where s.tier_agent_id = 2)")
        c.execute(f"update {schema}.insights_spot_leaders set name = 'Wrong' where id = (select max(l.id) from {schema}.insights_spot_leaders l join {schema}.home_map_cells c on c.id = l.cell_id join {schema}.home_snapshots s on s.id = c.snapshot_id where s.tier_agent_id = 2 and not l.is_you)")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed["inserted"] >= 2 and report.changed["updated"] >= 3 and report.changed["deleted"] == 1
    assert _count(schema, "insights_visibility", f"tier_agent_id = {seat.seat_id} and metric = '{absent}'") == 0
    assert _count(schema, "insights_ai_engines", "tier_agent_id = 2") == 3
    assert _count(schema, "insights_spot_leaders", "name = 'Wrong'") == 0
    assert _count(schema, "insights_spot_leaders") == 147 * N_SEATS
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}
    assert _plan_equals_database(schema)


def _plan_equals_database(schema) -> bool:
    plan = _insights_plan()
    vis = {(r["tier_agent_id"], r["metric"]): r["value"] for r in _q(schema, "select * from {s}.insights_visibility")}
    return vis == {(s.seat_id, v.metric): v.value for s in plan.values() for v in s.visibility}


def test_deactivated_users_keep_their_old_insights_rows_and_get_no_new_ones(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.users set deactivated_at = now() where id = 5")
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"insert into {schema}.insights_visibility (tier_agent_id, metric, value, source, trust_tier) values (5, 'calls', 1, 'Left alone', 'imported')")
    sh.seed(dry_run=False, backup_path=None)
    assert _count(schema, "insights_visibility", "tier_agent_id = 5") == 1
    for table in ("insights_ai_engines", "insights_competitor_positions"):
        assert _count(schema, table, "tier_agent_id = 5") == 0, table
    assert _count(schema, "insights_spot_leaders", "cell_id in (select c.id from " + schema + ".home_map_cells c join " + schema + ".home_snapshots s on s.id = c.snapshot_id where s.tier_agent_id = 5)") == 0


# --- the Web analytics page's web_checks and the three corrections (srp/web-analytics-page-schema, task 4) --------------------------------


def _web_plan():
    """The planned checks of every seat, and the aligned Home plan, built as the seed builds them."""
    seats = list(range(1, N_SEATS + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    markets = {p.seat_id: p.zipcode for p in plans}
    now = datetime.combine(AS_OF, time(12, 0))
    home = hp.build_home_plan(seats, now, markets)
    profile = pp.build_profile_plan(seats, now, markets)
    published = {p.seat_id: sum(1 for a in p.articles if a["published"] and not a["archived"]) for p in plans}
    web = wpn.build_web_plan(home, profile, published, {p.seat_id: p.website["website_url"] for p in plans})
    home = wpn.align_home(home, web)
    conns = cpn.build_connections_plan(home, profile, AS_OF)
    return cpn.align_web(web, conns), cpn.align_home(home, conns), published


def _lane_points(schema):
    return {r["tier_agent_id"]: r["points"] for r in _q(
        schema, "select s.tier_agent_id, sl.points from {s}.home_snapshots s join {s}.home_snapshot_lanes sl on sl.snapshot_id = s.id "
                "join {s}.home_score_lanes l on l.id = sl.lane_id and l.key = 'website' "
                "where s.as_of = (select max(as_of) from {s}.home_snapshots m where m.tier_agent_id = s.tier_agent_id)")}


def test_web_checks_hold_exactly_the_planned_rows(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    web, _, _ = _web_plan()
    assert report.planned["web_checks"] == 10 * N_SEATS == _count(schema, "web_checks")
    stored = {(r["tier_agent_id"], r["check_key"]): r for r in _q(schema, "select * from {s}.web_checks")}
    assert stored.keys() == {(s.seat_id, c.key) for s in web.seats for c in s.checks}
    for s in web.seats:
        for c in s.checks:
            r = stored[(s.seat_id, c.key)]
            assert (r["state"], r["result"], r["headline"], r["points"], r["points_max"], r["source"], r["trust_tier"], r["is_mock"]) == (
                c.state, c.result, c.headline, c.points, c.points_max, c.source, c.trust_tier, True), (s.seat_id, c.key)


def test_the_stored_web_rows_agree_with_the_other_pages_by_join(schema):
    sh.seed(dry_run=False, backup_path=None)
    lane = _lane_points(schema)
    # the four scored checks add up to the SRS website lane, and their maxima to its 102
    sums = {r["tier_agent_id"]: (r["p"], r["m"]) for r in _q(schema, "select tier_agent_id, sum(points)::int p, sum(points_max)::int m from {s}.web_checks group by 1")}
    assert all(sums[seat] == (lane[seat], 102) for seat in lane) and len(sums) == N_SEATS
    # Home's Website tile column is the lane
    assert {r["tier_agent_id"]: r["total_score"] for r in _q(schema, "select tier_agent_id, total_score from {s}.website_analytics_data")} == lane
    # the SRS gap text and Home's move text follow the markup points
    kinds = {r["tier_agent_id"]: ("none" if r["points"] == 0 else "full" if r["points"] == 42 else "partial") for r in _q(schema, "select tier_agent_id, points from {s}.web_checks where check_key = 'entity_markup'")}
    gaps = {r["tier_agent_id"]: r["you_text"] for r in _q(schema, "select g.tier_agent_id, g.you_text from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id and l.key = 'website'")}
    moves = {r["tier_agent_id"]: r["subtitle"] for r in _q(schema, "select tier_agent_id, subtitle from {s}.home_next_moves where target = 'website'")}
    assert gaps == {s: wpn.GAP_TEXT[k] for s, k in kinds.items()} and moves == {s: wpn.MOVE_TEXT[k] for s, k in kinds.items()}
    # name, address, phone is 10 per element the Profile has
    prof = {r["tier_agent_id"]: r["n"] for r in _q(
        schema, "select t.id tier_agent_id, 1 + (exists(select 1 from {s}.profile_facts f where f.tier_agent_id = t.id and f.field = 'address'))::int "
                "+ (t.phone_number is not null and btrim(t.phone_number) <> '')::int n from {s}.tier_agents t where t.id <= %s", N_SEATS)}
    nap = {r["tier_agent_id"]: r["points"] for r in _q(schema, "select tier_agent_id, points from {s}.web_checks where check_key = 'nap'")}
    assert nap == {s: 10 * n for s, n in prof.items()}
    # the content check follows the published articles Home counts
    published = {r["tier_agent_id"]: r["n"] for r in _q(schema, "select tier_agent_id, count(*)::int n from {s}.voce_articles where published and article_archived_at is null group by 1")}
    for r in _q(schema, "select tier_agent_id, state, result from {s}.web_checks where check_key = 'content'"):
        n = published.get(r["tier_agent_id"], 0)
        assert (r["state"], r["result"]) == (("fail", "No blog") if n == 0 else ("warn" if n < 3 else "pass", f"Blog with {n} post{'' if n == 1 else 's'}")), r["tier_agent_id"]
    # a failing service-pages result names only the seat's own products
    for r in _q(schema, "select w.tier_agent_id, w.result, f.value from {s}.web_checks w left join {s}.profile_facts f on f.tier_agent_id = w.tier_agent_id and f.field = 'products' "
                        "where w.check_key = 'service_pages' and w.state = 'fail'"):
        assert r["result"] == ("No pages for " + " or ".join(r["value"][:2]) + " loans" if r["value"] else "No service pages"), r["tier_agent_id"]


def test_every_stored_gap_and_move_text_is_the_aligned_plans(schema):
    """Every gap and move text in the database is the aligned Home plan's (so the only differences from the unaligned plan are the website ones, which the unit tests pin)."""
    sh.seed(dry_run=False, backup_path=None)
    _, aligned, _ = _web_plan()
    stored_gaps = {(r["tier_agent_id"], r["key"]): r["you_text"] for r in _q(
        schema, "select g.tier_agent_id, l.key, g.you_text from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id")}
    for s in aligned.seats:
        for g in s.gaps:
            assert stored_gaps[(s.seat_id, g.lane)] == g.you_text, (s.seat_id, g.lane)
    moves = {(r["tier_agent_id"], r["position"]): r["subtitle"] for r in _q(schema, "select tier_agent_id, position, subtitle from {s}.home_next_moves")}
    for s in aligned.seats:
        for m in s.moves:
            assert moves[(s.seat_id, m.position)] == m.subtitle, (s.seat_id, m.position)


def test_a_second_web_run_changes_nothing_ids_included_and_a_later_date_changes_no_check(schema):
    sh.seed(dry_run=False, backup_path=None)
    before = _q(schema, "select * from {s}.web_checks order by id")
    totals = _q(schema, "select * from {s}.website_analytics_data order by id")
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}
    assert _q(schema, "select * from {s}.web_checks order by id") == before
    sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + timedelta(days=3))
    assert _q(schema, "select * from {s}.web_checks order by id") == before, "nothing in a check is dated"
    assert [r["total_score"] for r in _q(schema, "select * from {s}.website_analytics_data order by id")] == [r["total_score"] for r in totals]
    assert sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + timedelta(days=3)).changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_the_backup_holds_the_old_web_rows_and_the_old_values_that_are_corrected(schema, tmp_path):
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.web_checks set result = 'Edited by hand' where tier_agent_id = 3 and check_key = 'security'")
        c.execute(f"update {schema}.website_analytics_data set total_score = 7 where tier_agent_id = 3")
        c.execute(f"update {schema}.srs_lane_gaps set you_text = 'Edited gap' where tier_agent_id = 3 and lane_id = (select id from {schema}.home_score_lanes where key = 'website')")
        c.execute(f"update {schema}.home_next_moves set subtitle = 'Edited move' where tier_agent_id = 3 and target = 'website'")
    path = tmp_path / "web.jsonl"
    sh.seed(dry_run=False, backup_path=path)
    by_table = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        by_table.setdefault(row["table"], []).append(row["row"])
    assert len(by_table["web_checks"]) == 10 * N_SEATS and any(r["result"] == "Edited by hand" for r in by_table["web_checks"])
    assert any(r["total_score"] == 7 for r in by_table["website_analytics_data"])
    assert any(r["you_text"] == "Edited gap" for r in by_table["srs_lane_gaps"]) and any(r["subtitle"] == "Edited move" for r in by_table["home_next_moves"])
    assert _count(schema, "web_checks", "result = 'Edited by hand'") == 0 and _count(schema, "website_analytics_data", "total_score = 7") == 0


def test_changed_or_missing_web_rows_are_put_right(schema):
    sh.seed(dry_run=False, backup_path=None)
    expected = _q(schema, "select tier_agent_id, check_key, state, result, headline, points, points_max, source, trust_tier from {s}.web_checks order by tier_agent_id, check_key")
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.web_checks set result = 'Wrong', trust_tier = 'self_declared' where tier_agent_id = 2 and check_key = 'speed'")
        c.execute(f"delete from {schema}.web_checks where tier_agent_id = 2 and check_key = 'content'")
        c.execute(f"update {schema}.web_checks set points = points_max, state = 'pass' where tier_agent_id = 4 and check_key = 'indexing'")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed["inserted"] == 1 and report.changed["updated"] >= 2
    assert _q(schema, "select tier_agent_id, check_key, state, result, headline, points, points_max, source, trust_tier from {s}.web_checks order by tier_agent_id, check_key") == expected
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_deactivated_users_keep_their_old_web_rows_and_get_no_new_ones(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.users set deactivated_at = now() where id = 5")
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"insert into {schema}.web_checks (tier_agent_id, check_key, state, result, source, trust_tier) values (5, 'security', 'pass', 'Left alone', 'x', 'imported')")
    sh.seed(dry_run=False, backup_path=None)
    assert _count(schema, "web_checks", "tier_agent_id = 5") == 1


def test_a_seat_whose_lane_cannot_be_split_stops_the_seed_before_anything_is_written(schema, monkeypatch, capsys):
    before = _home_snapshot(schema)

    def refuse(*a, **k):
        raise ValueError("seat 9: the website lane of 100 points cannot be split")

    monkeypatch.setattr(sh.wpn, "build_web_plan", refuse)
    with pytest.raises(ValueError, match="cannot be split"):
        sh.seed(dry_run=False, backup_path=None)
    assert _home_snapshot(schema) == before == {t: [] for t in HOME_TABLES}
    assert sh.main(["--dry-run", "--schema", schema]) == 2  # the scratch schema is named again, so the refusal is the lane's, not the schema guard's
    assert "cannot be split" in capsys.readouterr().err


def test_the_second_reviews_cross_page_rules_hold_on_the_stored_rows(schema):
    """Security follows the site's address; the Home move and the weekly brief agree with the markup the Web analytics page shows; the speed tile names the metric that sets its state."""
    sh.seed(dry_run=False, backup_path=None)
    # finding 1: https never fails with "served over HTTP", http never passes
    assert _q(schema, "select 1 from {s}.web_checks w join {s}.website_analytics_data d on d.tier_agent_id = w.tier_agent_id where w.check_key = 'security' and "
                      "((d.website_url ilike 'https://%%' and w.state <> 'pass') or (d.website_url ilike 'http://%%' and w.state <> 'fail'))") == []
    # finding 3: the Home move and the brief's next move are worth the markup's open points
    open_ = {r["tier_agent_id"]: r["o"] for r in _q(schema, "select tier_agent_id, points_max - points o from {s}.web_checks where check_key = 'entity_markup'")}
    assert {r["tier_agent_id"]: r["points"] for r in _q(schema, "select tier_agent_id, points from {s}.home_next_moves where target = 'website'")} == open_
    assert {r["tier_agent_id"]: r["next_move_points"] for r in _q(schema, "select tier_agent_id, next_move_points from {s}.home_weekly_briefs")} == {s: max(1, o) for s, o in open_.items()}
    # finding 2: "Website markup fixed" only beside complete markup, "improved" beside partial markup, none beside no markup
    for r in _q(schema, "select b.tier_agent_id, i.label, w.points from {s}.home_weekly_briefs b join {s}.home_weekly_brief_items i on i.brief_id = b.id "
                        "join {s}.web_checks w on w.tier_agent_id = b.tier_agent_id and w.check_key = 'entity_markup' where i.label like 'Website markup%%'"):
        assert (r["label"] == "Website markup fixed") == (r["points"] == 42) and (r["label"] == "Website markup improved") == (0 < r["points"] < 42), r
    assert _q(schema, "select 1 from {s}.home_weekly_brief_items where label like 'Website markup%%'") != []
    # the brief's items still add up per seat as the plan says (a dropped item gives its points to the first one left)
    assert _q(schema, "select 1 from {s}.home_weekly_briefs b where (select count(*) from {s}.home_weekly_brief_items i where i.brief_id = b.id) < 2") == []
    # finding 6: the speed tile's headline is the metric that sets the state
    for r in _q(schema, "select tier_agent_id, state, result, headline from {s}.web_checks where check_key = 'speed'"):
        assert r["headline"] in r["result"].replace(" (needs work)", "").replace(" (poor)", "").split(", "), r
        if r["state"] == "fail":
            assert "(poor)" in r["result"] and any(m in r["headline"] for m in ("LCP", "INP", "CLS")) and r["headline"] + " (poor)" in r["result"], r
        if r["state"] == "warn":
            assert r["headline"] + " (needs work)" in r["result"] or r["headline"] + " (poor)" not in r["result"], r


# --- the Connections page's connected_accounts and the corrections (srp/connections-page-schema, task 4) ---------------------------------------


def _conns_plan():
    """The planned accounts of every seat, as the seed builds them (from the unaligned Home plan and the Profile plan)."""
    seats = list(range(1, N_SEATS + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    markets = {p.seat_id: p.zipcode for p in plans}
    home = hp.build_home_plan(seats, AS_OF, markets)
    return cpn.build_connections_plan(home, pp.build_profile_plan(seats, AS_OF, markets), AS_OF)


def _accounts(schema, where="true"):
    return _q(schema, f"select tier_agent_id, provider, state, synced_at, source, trust_tier, is_mock from {{s}}.connected_accounts where {where} order by tier_agent_id, provider")


def test_connected_accounts_hold_exactly_the_planned_rows(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    plan = _conns_plan()
    assert report.planned["connected_accounts"] == 11 * N_SEATS == _count(schema, "connected_accounts")
    stored = {(r["tier_agent_id"], r["provider"]): r for r in _accounts(schema)}
    assert stored.keys() == {(s.seat_id, a.provider) for s in plan.seats for a in s.accounts}
    for s in plan.seats:
        for a in s.accounts:
            r = stored[(s.seat_id, a.provider)]
            assert (r["state"], r["synced_at"], r["source"], r["trust_tier"], r["is_mock"]) == (a.state, a.synced_at, a.source, a.trust_tier, True), (s.seat_id, a.provider)


def test_the_stored_accounts_agree_with_the_other_pages_by_join(schema):
    sh.seed(dry_run=False, backup_path=None)
    # the connected social accounts equal the SRS Connections lane's "you" count
    social = {r["tier_agent_id"]: r["n"] for r in _q(schema, "select tier_agent_id, count(*)::int n from {s}.connected_accounts "
                                                             "where state = 'connected' and provider in ('facebook', 'instagram', 'linkedin', 'x') group by 1")}
    lane = {r["tier_agent_id"]: r["you_text"] for r in _q(schema, "select g.tier_agent_id, g.you_text from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id and l.key = 'connections'")}
    assert len(lane) == N_SEATS and {s: int(t) for s, t in lane.items()} == {s: social.get(s, 0) for s in lane}
    # the gap to the rival text is still 1 to 4
    for r in _q(schema, "select g.tier_agent_id, g.you_text, g.rival_text from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id and l.key = 'connections'"):
        assert 1 <= int(r["rival_text"].split()[0]) - int(r["you_text"]) <= 4 and r["rival_text"].endswith(" connected accounts"), r
    # LinkedIn is connected wherever the Profile cites it
    assert _q(schema, "select 1 from {s}.profile_facts f left join {s}.connected_accounts a on a.tier_agent_id = f.tier_agent_id and a.provider = 'linkedin' "
                      "where f.source = 'From LinkedIn' and a.state is distinct from 'connected'") == []
    # Google Business Profile is connected for every seat that has a Google-sourced fact, and every account was synced in the week before the day
    assert _q(schema, "select 1 from {s}.profile_facts f left join {s}.connected_accounts a on a.tier_agent_id = f.tier_agent_id and a.provider = 'google_business' "
                      "where f.source = 'From Google' and a.state is distinct from 'connected'") == []
    assert _count(schema, "connected_accounts", "provider = 'google_business' and state = 'connected'") == N_SEATS
    week_ago, now = datetime.combine(AS_OF - timedelta(days=7), time(9, 0)), datetime.combine(AS_OF, time(9, 0))
    assert _q(schema, "select 1 from {s}.connected_accounts where state <> 'available' and (synced_at <= %s or synced_at > %s)", week_ago, now) == []
    # YouTube and Search Console only beside Google; a seat with a video has YouTube connected
    assert _q(schema, "select 1 from {s}.connected_accounts a where a.provider in ('youtube', 'search_console') and a.state = 'connected' and not exists "
                      "(select 1 from {s}.connected_accounts g where g.tier_agent_id = a.tier_agent_id and g.provider = 'google_business' and g.state = 'connected')") == []
    assert _q(schema, "select 1 from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id and l.key = 'videos' "
                      "left join {s}.connected_accounts a on a.tier_agent_id = g.tier_agent_id and a.provider = 'youtube' "
                      "where g.you_text <> 'No videos' and a.state is distinct from 'connected'") == []
    # the Indexing source follows Search Console
    got = {r["tier_agent_id"]: (r["source"], r["trust_tier"]) for r in _q(schema, "select tier_agent_id, source, trust_tier from {s}.web_checks where check_key = 'indexing'")}
    sc = {r["tier_agent_id"]: r["state"] == "connected" for r in _q(schema, "select tier_agent_id, state from {s}.connected_accounts where provider = 'search_console'")}
    assert got == {s: cpn.INDEXING_SOURCE[c] for s, c in sc.items()} and set(sc.values()) == {True, False}


def test_a_second_connections_run_changes_nothing_and_a_later_date_moves_only_the_sync_times(schema):
    sh.seed(dry_run=False, backup_path=None)
    before = _q(schema, "select * from {s}.connected_accounts order by id")
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}
    assert _q(schema, "select * from {s}.connected_accounts order by id") == before
    sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + timedelta(days=3))
    after = _q(schema, "select * from {s}.connected_accounts order by id")
    assert [r["id"] for r in after] == [r["id"] for r in before]
    assert [{k: v for k, v in r.items() if k != "synced_at"} for r in after] == [{k: v for k, v in r.items() if k != "synced_at"} for r in before]
    assert [r["synced_at"] for r in after] != [r["synced_at"] for r in before]


def test_the_backup_holds_the_old_account_rows_and_the_old_values_that_are_corrected(schema, tmp_path):
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.connected_accounts set state = 'available', synced_at = null, source = 'Edited source', trust_tier = 'self_declared' where tier_agent_id = 3 and provider = 'google_business'")
        c.execute(f"update {schema}.web_checks set source = 'Edited indexing source' where tier_agent_id = 3 and check_key = 'indexing'")
        c.execute(f"update {schema}.srs_lane_gaps set you_text = 'Edited count' where tier_agent_id = 3 and lane_id = (select id from {schema}.home_score_lanes where key = 'connections')")
    path = tmp_path / "conns.jsonl"
    sh.seed(dry_run=False, backup_path=path)
    by_table = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        by_table.setdefault(row["table"], []).append(row["row"])
    assert len(by_table["connected_accounts"]) == 11 * N_SEATS and any(r["source"] == "Edited source" for r in by_table["connected_accounts"])
    assert any(r["source"] == "Edited indexing source" for r in by_table["web_checks"]) and any(r["you_text"] == "Edited count" for r in by_table["srs_lane_gaps"])
    assert _count(schema, "connected_accounts", "source = 'Edited source'") == 0 and _count(schema, "web_checks", "source = 'Edited indexing source'") == 0
    assert _count(schema, "srs_lane_gaps", "you_text = 'Edited count'") == 0


def test_changed_or_missing_account_rows_are_put_right(schema):
    sh.seed(dry_run=False, backup_path=None)
    expected = _accounts(schema)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.connected_accounts set state = 'available', synced_at = null, source = 'Wrong' where tier_agent_id = 2 and provider = 'google_business'")
        c.execute(f"delete from {schema}.connected_accounts where tier_agent_id = 2 and provider = 'x'")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed["inserted"] == 1 and report.changed["updated"] >= 1
    assert _accounts(schema) == expected
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_deactivated_users_keep_their_old_account_rows_and_get_no_new_ones(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.users set deactivated_at = now() where id = 5")
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"insert into {schema}.connected_accounts (tier_agent_id, provider, state, source, trust_tier) values (5, 'zillow', 'available', 'Left alone', 'self_declared')")
    sh.seed(dry_run=False, backup_path=None)
    assert _count(schema, "connected_accounts", "tier_agent_id = 5") == 1


def test_a_connections_text_the_builder_cannot_read_stops_the_seed_before_anything_is_written(schema, monkeypatch):
    before = _home_snapshot(schema)

    def refuse(*a, **k):
        raise ValueError("seat 9: the Connections lane text 'x' is not a count")

    monkeypatch.setattr(sh.cpn, "build_connections_plan", refuse)
    with pytest.raises(ValueError, match="not a count"):
        sh.seed(dry_run=False, backup_path=None)
    assert _home_snapshot(schema) == before == {t: [] for t in HOME_TABLES}


def test_a_home_facebook_event_exists_only_beside_a_connected_facebook(schema):
    """Second review, finding 1: "Your Facebook connection expires" cannot be on Home for a seat whose Connections page shows Facebook as not connected."""
    sh.seed(dry_run=False, backup_path=None)
    assert _q(schema, "select 1 from {s}.home_events e left join {s}.connected_accounts a on a.tier_agent_id = e.tier_agent_id and a.provider = 'facebook' "
                      "where e.kind = 'facebook' and a.state is distinct from 'connected'") == []
    assert _count(schema, "home_events", "kind = 'facebook'") > 0, "some seat keeps the event, so the check is not vacuous"


# --- the Network page's network_partners and network_referrals (srp/network-page-schema, task 4) --------------------------------------------


def _net_plan():
    """The planned partners and referrals of every seat, as the seed builds them (from the Home and Connections plans)."""
    seats = list(range(1, N_SEATS + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    markets = {p.seat_id: p.zipcode for p in plans}
    home = hp.build_home_plan(seats, AS_OF, markets)
    conns = cpn.build_connections_plan(home, pp.build_profile_plan(seats, AS_OF, markets), AS_OF)
    return npl.build_network_plan(home, conns, AS_OF)


def _partners(schema, where="true"):
    return _q(schema, f"select id, tier_agent_id, position, name, company, role, state, reason_kind, reason_count, reason_on, source, trust_tier, is_mock from {{s}}.network_partners where {where} order by tier_agent_id, position")


def _referrals(schema, where="true"):
    return _q(schema, "select r.id, r.tier_agent_id, r.list_key, r.position, r.name, r.detail, p.name as partner_name, r.status, r.occurred_on, r.source, r.trust_tier, r.is_mock "
                      f"from {{s}}.network_referrals r left join {{s}}.network_partners p on p.id = r.partner_id where {where} order by r.tier_agent_id, r.list_key, r.position")


def _expected(plan):
    partners = [(s.seat_id, p.position, p.name, p.company, p.role, p.state, p.reason_kind, p.reason_count, p.reason_on, p.source, p.trust_tier, True) for s in plan.seats for p in s.partners]
    referrals = [(s.seat_id, r.list_key, r.position, r.name, r.detail, r.partner_name, r.status, r.occurred_on, r.source, r.trust_tier, True) for s in plan.seats for r in s.referrals]
    return sorted(partners, key=lambda t: (t[0], t[1])), sorted(referrals, key=lambda t: (t[0], t[1], t[2]))


def _stored_partners(schema):
    return [(r["tier_agent_id"], r["position"], r["name"], r["company"], r["role"], r["state"], r["reason_kind"], r["reason_count"], r["reason_on"], r["source"], r["trust_tier"], r["is_mock"])
            for r in _partners(schema)]


def _stored_referrals(schema):
    return [(r["tier_agent_id"], r["list_key"], r["position"], r["name"], r["detail"], r["partner_name"], r["status"], r["occurred_on"], r["source"], r["trust_tier"], r["is_mock"])
            for r in _referrals(schema)]


def test_the_network_tables_hold_exactly_the_planned_rows(schema):
    report = sh.seed(dry_run=False, backup_path=None)
    plan = _net_plan()
    partners, referrals = _expected(plan)
    assert report.planned["network_partners"] == len(partners) == _count(schema, "network_partners")
    assert report.planned["network_referrals"] == len(referrals) == _count(schema, "network_referrals")
    assert _stored_partners(schema) == partners and _stored_referrals(schema) == referrals
    assert partners and referrals


def test_the_stored_network_rows_agree_with_the_other_pages_by_join(schema):
    sh.seed(dry_run=False, backup_path=None)
    # N9: a Zillow reason only where Zillow is matched, and never above the seat's newest review count
    assert _q(schema, "select 1 from {s}.network_partners p left join {s}.connected_accounts a on a.tier_agent_id = p.tier_agent_id and a.provider = 'zillow' "
                      "where p.reason_kind = 'zillow' and a.state is distinct from 'matched'") == []
    assert _q(schema, "select 1 from {s}.network_partners p where p.reason_kind = 'zillow' and p.reason_count > (select s.review_count from {s}.home_snapshots s "
                      "where s.tier_agent_id = p.tier_agent_id order by s.as_of desc, s.id desc limit 1)") == []
    assert _count(schema, "network_partners", "reason_kind = 'zillow'") > 0
    # N10: a closing claim only where the Loan system is connected
    loan = "not exists (select 1 from {s}.connected_accounts a where a.tier_agent_id = {t}.tier_agent_id and a.provider = 'loan_system' and a.state = 'connected')"
    assert _q(schema, "select 1 from {s}.network_partners p where p.reason_kind = 'closings' and " + loan.replace("{t}", "p")) == []
    assert _q(schema, "select 1 from {s}.network_referrals r where (r.status = 'closed' or r.detail ~* 'closed|closing') and " + loan.replace("{t}", "r")) == []
    assert _count(schema, "network_partners", "reason_kind = 'closings'") > 0 and _count(schema, "network_referrals", "status = 'closed'") > 0
    # N11: a given referral, and a received one that names a partner, point to a promoted partner of the same seat; nothing else is referenced
    assert _q(schema, "select 1 from {s}.network_referrals r join {s}.network_partners p on p.id = r.partner_id where p.state <> 'promoted' or p.tier_agent_id <> r.tier_agent_id") == []
    assert _q(schema, "select 1 from {s}.network_referrals r where r.list_key = 'given' and r.partner_id is null") == []
    assert _count(schema, "network_referrals", "list_key = 'given'") > 0
    # at most 8 promoted per seat, dates one to 120 days before the day
    assert _q(schema, "select tier_agent_id from {s}.network_partners where state = 'promoted' group by 1 having count(*) > 8") == []
    low, high = AS_OF - timedelta(days=120), AS_OF - timedelta(days=1)
    assert _q(schema, "select 1 from {s}.network_referrals where occurred_on < %s or occurred_on > %s", low, high) == []
    assert _q(schema, "select 1 from {s}.network_partners where reason_on is not null and (reason_on < %s or reason_on > %s)", low, high) == []
    # no seat's page is empty
    assert _q(schema, "select t.id from {s}.tier_agents t where t.id <= %s and not exists (select 1 from {s}.network_partners p where p.tier_agent_id = t.id) "
                      "and not exists (select 1 from {s}.network_referrals r where r.tier_agent_id = t.id)", N_SEATS) == []


def test_a_second_network_run_changes_nothing_ids_included_and_a_later_date_moves_only_dates(schema):
    sh.seed(dry_run=False, backup_path=None)
    before_p, before_r = _partners(schema), _referrals(schema)
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}
    assert _partners(schema) == before_p and _referrals(schema) == before_r
    sh.seed(dry_run=False, backup_path=None, as_of=AS_OF + timedelta(days=3))
    after_p, after_r = _partners(schema), _referrals(schema)
    assert [r["id"] for r in after_p] == [r["id"] for r in before_p] and [r["id"] for r in after_r] == [r["id"] for r in before_r], "the rows keep their ids"
    strip = lambda rows, col: [{k: v for k, v in r.items() if k != col} for r in rows]
    assert strip(after_p, "reason_on") == strip(before_p, "reason_on") and strip(after_r, "occurred_on") == strip(before_r, "occurred_on")
    assert [r["occurred_on"] for r in after_r] != [r["occurred_on"] for r in before_r]
    assert all(b["occurred_on"] + timedelta(days=3) == a["occurred_on"] for b, a in zip(before_r, after_r, strict=True))


def test_the_backup_holds_the_old_network_rows(schema, tmp_path):
    sh.seed(dry_run=False, backup_path=None)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.network_partners set company = 'Edited Co' where id = (select min(id) from {schema}.network_partners where tier_agent_id = 2)")
        c.execute(f"update {schema}.network_referrals set detail = 'Edited detail' where id = (select min(id) from {schema}.network_referrals where tier_agent_id = 2)")
    path = tmp_path / "net.jsonl"
    sh.seed(dry_run=False, backup_path=path)
    by_table = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        by_table.setdefault(row["table"], []).append(row["row"])
    assert len(by_table["network_partners"]) == _count(schema, "network_partners") and any(r["company"] == "Edited Co" for r in by_table["network_partners"])
    assert len(by_table["network_referrals"]) == _count(schema, "network_referrals") and any(r["detail"] == "Edited detail" for r in by_table["network_referrals"])
    assert _count(schema, "network_partners", "company = 'Edited Co'") == 0 and _count(schema, "network_referrals", "detail = 'Edited detail'") == 0


def test_changed_or_missing_network_rows_are_put_right_even_a_partner_a_referral_points_to(schema):
    sh.seed(dry_run=False, backup_path=None)
    expected = (_stored_partners(schema), _stored_referrals(schema))
    pointed = _q(schema, "select p.tier_agent_id seat, p.id from {s}.network_partners p join {s}.network_referrals r on r.partner_id = p.id order by 1 limit 1")[0]
    lone = _q(schema, "select p.id from {s}.network_partners p where p.state <> 'promoted' and p.tier_agent_id <> %s order by id limit 1", pointed["seat"])[0]
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.network_partners set name = 'Renamed Person' where id = %s", (pointed["id"],))  # a partner a referral points to
        c.execute(f"delete from {schema}.network_partners where id = %s", (lone["id"],))                            # one nothing points to
        c.execute(f"delete from {schema}.network_referrals where id = (select max(id) from {schema}.network_referrals)")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed["inserted"] >= 1
    assert (_stored_partners(schema), _stored_referrals(schema)) == expected
    assert sh.seed(dry_run=False, backup_path=None).changed == {"inserted": 0, "updated": 0, "deleted": 0}


def test_deactivated_users_keep_their_old_network_rows_and_get_no_new_ones(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.users set deactivated_at = now() where id = 5")
    sh.seed(dry_run=False, backup_path=None)
    assert _count(schema, "network_partners", "tier_agent_id = 5") == 0
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"insert into {schema}.network_partners (tier_agent_id, position, name, company, role, state, source, trust_tier) values (5, 1, 'Left Alone', 'Left Co', 'Agent', 'promoted', 'x', 'imported')")
    sh.seed(dry_run=False, backup_path=None)
    assert _count(schema, "network_partners", "tier_agent_id = 5") == 1


def test_a_network_plan_that_cannot_be_built_stops_the_seed_before_anything_is_written(schema, monkeypatch):
    before = _home_snapshot(schema)

    def refuse(*a, **k):
        raise ValueError("seat 9: the Connections plan has no accounts for it")

    monkeypatch.setattr(sh.npl, "build_network_plan", refuse)
    with pytest.raises(ValueError, match="no accounts"):
        sh.seed(dry_run=False, backup_path=None)
    assert _home_snapshot(schema) == before == {t: [] for t in HOME_TABLES}


def test_the_seed_names_no_legacy_partner_or_referral_table():
    text = Path(sh.__file__).read_text()
    for legacy in ("pin_partner_profiles", "referral_sents", "referral_requests", "referral_histories", "referral_emails", "invite_partners", "invite_signups", "invite_members"):
        assert legacy not in text, legacy
