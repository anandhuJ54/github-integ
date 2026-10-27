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
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_home_plan as hp

URL = os.environ.get("SRP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="SRP_TEST_DATABASE_URL is not set")

TABLES = ["users", "tier_agents", "srs_config_categories", "user_search_rank_scores", "voce_articles",
          "website_analytics_data", "ai_authority_stats", "tier_agent_details"]
HOME_TABLES = [
    "home_score_lanes", "home_score_bands", "home_plans", "home_peer_benchmarks", "home_snapshots", "home_snapshot_lanes",
    "home_map_cells", "home_seat_state", "home_competitors", "home_activity", "home_next_moves", "home_locked_features",
    "home_weekly_briefs", "home_weekly_brief_items", "home_review_drafts", "home_events", "home_nora_insights",
]
SCRIPT = Path(__file__).resolve().parents[1] / "db" / "local" / "home_schema.sql"
HARDENING = SCRIPT.with_name("home_schema_hardening.sql")
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
        c.execute(f"delete from {schema}.home_competitors where position = 5 and tier_agent_id = 1")
        c.execute(f"insert into {schema}.home_activity (tier_agent_id, label, status) values (1, 'Junk', 'done')")
        c.execute(f"insert into {schema}.home_review_drafts (tier_agent_id, reviewer_label, rating, review_text, draft_text, compliance_status) "
                  f"values (2, 'Reviewer Z. (mock)', 3, 'x', 'y', 'passed')")
    report = sh.seed(dry_run=False, backup_path=None)
    assert report.changed["updated"] >= 2 and report.changed["inserted"] >= 1 and report.changed["deleted"] >= 2
    after = _home_snapshot(schema)
    for t in HOME_TABLES:
        if t != "home_competitors":                       # the deleted competitor comes back as a new row with a new id
            assert [{k: v for k, v in r.items() if k != "id"} for r in after[t]] == [{k: v for k, v in r.items() if k != "id"} for r in expected[t]], t
    assert _count(schema, "home_competitors", "tier_agent_id = 1") == 5


def test_users_who_are_deactivated_get_no_home_rows_and_their_old_rows_are_left_alone(schema):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {schema}.users set deactivated_at = now() where id = 5")
        c.execute(f"insert into {schema}.home_activity (tier_agent_id, label, status) values (5, 'Left alone', 'done')")
    sh.seed(dry_run=False, backup_path=None)
    for table in ("home_seat_state", "home_snapshots", "home_competitors", "home_next_moves", "home_locked_features", "home_weekly_briefs", "home_nora_insights"):
        assert _count(schema, table, "tier_agent_id = 5") == 0, table
    assert _count(schema, "home_activity", "tier_agent_id = 5") == 1


def test_the_default_date_is_today_in_utc(schema, monkeypatch):
    monkeypatch.setattr(sh, "_today", lambda: date(2026, 11, 20))
    sh.seed(dry_run=False, backup_path=None)
    newest = _q(schema, "select max(as_of) m from {s}.home_snapshots")[0]["m"]
    assert newest == datetime.combine(date(2026, 11, 20), time(12, 0))


def test_the_rows_stored_are_the_rows_planned(schema):
    sh.seed(dry_run=False, backup_path=None)
    plan = {s.seat_id: s for s in hp.build_home_plan(list(range(1, N_SEATS + 1)), AS_OF).seats}
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
