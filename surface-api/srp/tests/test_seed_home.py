"""Home-page mock-data seed, pure parts (srp/home-page-data, task 1): the deterministic plan, the backup file, the CLI.

The SQL that applies the plan is tested on real Postgres in test_seed_home_integration.py.
"""
from __future__ import annotations

import json
import os
import stat
from collections import Counter
from datetime import date, datetime

import pytest

from _base.config import get_settings
from surfaces.srp.seat import seed_home as sh

SEATS = list(range(1, 41))
CATS = [sh.Category(id=i, max=m) for i, m in [(1, 5), (2, 7), (3, None), (4, 6), (5, 10), (6, 8)]]


def _plan(seats=SEATS, cats=CATS):
    return sh.build_plan(seats, cats)


def test_the_plan_is_deterministic():
    assert _plan() == _plan()


def test_a_seat_s_plan_does_not_change_with_the_order_the_seats_are_given_in():
    forward = {p.seat_id: p for p in _plan(SEATS)}
    backward = {p.seat_id: p for p in _plan(list(reversed(SEATS)))}
    assert forward == backward


def test_every_seat_has_a_score_for_every_category_and_stays_under_the_maximum():
    for p in _plan():
        assert [c for c, _ in p.scores] == [c.id for c in CATS]
        for (cid, score), cat in zip(p.scores, CATS, strict=True):
            if cat.max is None:
                assert score is None  # an unknown maximum stays unknown
            else:
                assert 0 <= score <= cat.max


def test_scores_differ_between_seats_so_ranks_spread():
    totals = {p.seat_id: sum(s for _, s in p.scores if s is not None) for p in _plan()}
    assert len(set(totals.values())) >= 8


def test_with_enough_seats_every_peer_group_has_at_least_ten():
    groups = Counter((p.zipcode, p.vertical_id) for p in _plan())
    assert len(groups) >= 2
    assert min(groups.values()) >= sh.PEER_GROUP_MIN


def test_with_too_few_seats_there_is_one_group_below_the_minimum():
    groups = Counter((p.zipcode, p.vertical_id) for p in _plan(seats=[1, 2, 3, 4, 5]))
    assert len(groups) == 1 and next(iter(groups.values())) == 5


def test_every_seat_has_a_zipcode_and_a_vertical():
    for p in _plan():
        assert p.zipcode and p.zipcode.isdigit() and len(p.zipcode) == 5
        assert isinstance(p.vertical_id, int)


def test_articles_range_from_none_to_five_and_at_most_one_is_archived():
    plans = _plan()
    counts = [len(p.articles) for p in plans]
    assert min(counts) == 0 and max(counts) == 5
    for p in plans:
        assert sum(1 for a in p.articles if a["archived"]) <= 1
        assert all(a["article_id"].startswith(f"seed-home-{p.seat_id}-") for a in p.articles)
        assert all(a["published"] or a["published_at"] is None for a in p.articles)


def test_some_seat_has_an_archived_article_and_it_is_not_the_only_one():
    plans = _plan()
    assert any(a["archived"] for p in plans for a in p.articles)
    assert any(len(p.articles) >= 2 and not any(a["archived"] for a in p.articles) for p in plans)


def test_most_seats_have_an_ai_row_and_a_few_have_none():
    plans = _plan()
    without = [p for p in plans if p.ai is None]
    assert 1 <= len(without) <= len(plans) // 3
    for p in plans:
        if p.ai:
            assert p.ai["ai_authority_score"] >= 0 and p.ai["total_answer"] >= 1
            assert 1 <= len(p.ai["ai_topics"]) <= 3


def test_every_seat_has_a_website_row_with_a_score_between_0_and_100():
    for p in _plan():
        assert 0 <= p.website["total_score"] <= 100
        assert p.website["website_url"] == f"https://example.test/seat-{p.seat_id}"


def test_credentials_and_year_started():
    plans = _plan()
    assert {len(p.certifications) for p in plans} >= {0, 1, 2, 3}
    for p in plans:
        assert 2003 <= int(p.year_started) <= 2022


def test_every_text_value_is_labelled_mock_and_names_nobody():
    for p in _plan():
        texts = [a["title"] for a in p.articles] + list(p.certifications) + (p.ai["ai_topics"] if p.ai else [])
        assert all(t.startswith("Mock ") for t in texts)


def test_timestamps_are_fixed_not_the_clock():
    for p in _plan():
        assert p.website["last_refreshed_at"].year == 2026
        assert all(isinstance(a["created_at"], datetime) and a["created_at"].year == 2026 for a in p.articles)


# --- backup file --------------------------------------------------------------------------------


def test_the_backup_is_one_json_line_per_row_private_and_never_overwritten(tmp_path):
    path = tmp_path / "backup.jsonl"
    rows = {"voce_articles": [{"id": 1, "title": "x", "created_at": datetime(2026, 1, 2, 3, 4, 5)}], "tier_agents": [{"id": 7, "year_started": "1999"}]}
    sh.write_backup(path, rows)
    lines = [json.loads(line) for line in path.read_text().splitlines()]
    assert lines == [
        {"table": "voce_articles", "row": {"id": 1, "title": "x", "created_at": "2026-01-02 03:04:05"}},
        {"table": "tier_agents", "row": {"id": 7, "year_started": "1999"}},
    ]
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    with pytest.raises(FileExistsError):
        sh.write_backup(path, rows)
    assert len(path.read_text().splitlines()) == 2


# --- command line -------------------------------------------------------------------------------


def test_main_dry_run_prints_counts_only_and_writes_nothing(monkeypatch, capsys):
    monkeypatch.setattr(sh, "seed", lambda **kw: sh.Report(seats=40, planned={"user_search_rank_scores": 240}, changed={}, dry_run=kw["dry_run"]))
    assert sh.main(["--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "40 seats" in out and "dry run" in out.lower()
    assert "example.test" not in out and "Mock " not in out


def test_main_refuses_an_existing_backup_file(monkeypatch, capsys, tmp_path):
    path = tmp_path / "b.jsonl"
    path.write_text("keep")

    def boom(**kw):
        raise FileExistsError(str(path))

    monkeypatch.setattr(sh, "seed", boom)
    assert sh.main(["--backup-to", str(path)]) == 2
    assert "already exists" in capsys.readouterr().err


def test_main_always_closes_the_connection_pool(monkeypatch):
    closed = []
    monkeypatch.setattr(sh, "close_pools", lambda: closed.append(True))
    monkeypatch.setattr(sh, "seed", lambda **kw: sh.Report(seats=0, planned={}, changed={}, dry_run=True))
    sh.main(["--dry-run"])
    assert closed == [True]


# --- second-model review fixes: a backup is mandatory, the target is guarded and shown, one snapshot, a warning for rank-less seats -------


def _stub_seed(monkeypatch, **report):
    calls = []

    def fake(**kw):
        calls.append(kw)
        return sh.Report(seats=40, planned={"user_search_rank_scores": 400}, changed={"inserted": 0, "updated": 0, "deleted": 0}, dry_run=kw["dry_run"], **report)

    monkeypatch.setattr(sh, "seed", fake)
    monkeypatch.setattr(sh, "close_pools", lambda: None)
    return calls


def test_a_real_run_without_a_backup_is_refused_before_anything_is_touched(monkeypatch, capsys):
    calls = _stub_seed(monkeypatch)
    assert sh.main([]) == 2
    assert "--backup-to" in capsys.readouterr().err
    assert calls == []


def test_a_dry_run_needs_no_backup(monkeypatch):
    calls = _stub_seed(monkeypatch)
    assert sh.main(["--dry-run"]) == 0
    assert calls and calls[0]["dry_run"] is True


def test_a_real_run_with_a_backup_goes_ahead(monkeypatch, tmp_path):
    calls = _stub_seed(monkeypatch)
    assert sh.main(["--backup-to", str(tmp_path / "b.jsonl")]) == 0
    assert calls and calls[0]["dry_run"] is False


def test_a_schema_other_than_the_local_one_is_refused_unless_named_on_the_command_line(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("SRP_LOCAL_SCHEMA", "public")
    get_settings.cache_clear()
    calls = _stub_seed(monkeypatch)
    try:
        assert sh.main(["--backup-to", str(tmp_path / "b.jsonl")]) == 2
        assert "public" in capsys.readouterr().err and calls == []
        assert sh.main(["--backup-to", str(tmp_path / "b2.jsonl"), "--schema", "other"]) == 2   # naming a different schema is not a confirmation
        assert calls == []
        assert sh.main(["--backup-to", str(tmp_path / "b3.jsonl"), "--schema", "public"]) == 0    # naming the same schema is
        assert len(calls) == 1
    finally:
        get_settings.cache_clear()


def test_the_default_schema_needs_no_confirmation(monkeypatch, tmp_path):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    calls = _stub_seed(monkeypatch)
    assert sh.main(["--backup-to", str(tmp_path / "b.jsonl")]) == 0 and len(calls) == 1


def test_the_target_is_printed_without_the_user_or_the_password(monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://alice:s3cret@dbhost.example:5432/mydb")
    _stub_seed(monkeypatch)
    sh.main(["--dry-run"])
    out = capsys.readouterr().out
    assert "dbhost.example" in out and "mydb" in out and "srp_cleanup" in out
    assert "alice" not in out and "s3cret" not in out


def test_the_whole_run_reads_one_snapshot(monkeypatch):
    seen = []

    class Cur:
        def fetchall(self):
            return []

        def fetchone(self):
            return None

    class Conn:
        def execute(self, sql, params=None):
            seen.append(" ".join(sql.lower().split()))
            return Cur()

    from contextlib import contextmanager

    @contextmanager
    def fake_connection():
        yield Conn()

    monkeypatch.setattr(sh, "connection", fake_connection)
    sh.seed(dry_run=True)
    assert seen[0] == "set transaction isolation level repeatable read"  # first, so the backup and the changes see the same rows


def test_seats_that_will_have_no_rank_are_counted():
    assert sh.rankless_count(_plan()) == 0
    assert sh.rankless_count(_plan(seats=[1, 2, 3, 4, 5])) == 5                       # fewer than 10 seats: nobody can be ranked
    assert sh.rankless_count(_plan(cats=[sh.Category(1, None), sh.Category(2, None)])) == 40   # no known maximum: every total is unknown


def test_the_run_warns_when_seats_will_have_no_rank(monkeypatch, capsys):
    _stub_seed(monkeypatch, rankless=5)
    sh.main(["--dry-run"])
    assert "5 seats will have no rank" in capsys.readouterr().out


def test_there_is_no_warning_when_every_seat_can_be_ranked(monkeypatch, capsys):
    _stub_seed(monkeypatch, rankless=0)
    sh.main(["--dry-run"])
    assert "no rank" not in capsys.readouterr().out


# --- the Home tables: --as-of (srp/home-page-schema, task 4) ---------------------------------------------------------------


def test_the_default_date_is_today_in_utc():
    from datetime import UTC
    from datetime import datetime as dt
    assert sh._today() == dt.now(UTC).date()


def test_main_passes_the_date_given_and_prints_it(monkeypatch, capsys, tmp_path):
    calls = _stub_seed(monkeypatch)
    assert sh.main(["--backup-to", str(tmp_path / "b.jsonl"), "--as-of", "2026-10-27"]) == 0
    assert calls[0]["as_of"] == date(2026, 10, 27)
    assert "as of: 2026-10-27" in capsys.readouterr().out


def test_main_uses_today_when_no_date_is_given_and_says_so(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(sh, "_today", lambda: date(2026, 12, 1))
    calls = _stub_seed(monkeypatch)
    assert sh.main(["--dry-run"]) == 0
    assert calls[0]["as_of"] == date(2026, 12, 1)
    assert "as of: 2026-12-01" in capsys.readouterr().out


def test_a_date_that_is_not_a_date_is_refused_before_anything_is_touched(monkeypatch, capsys):
    calls = _stub_seed(monkeypatch)
    with pytest.raises(SystemExit) as exc:
        sh.main(["--dry-run", "--as-of", "next tuesday"])
    assert exc.value.code == 2 and calls == []
    assert "--as-of" in capsys.readouterr().err


def test_a_dry_run_counts_the_home_rows_without_touching_the_database(monkeypatch):
    seen = []

    class Cur:
        def __init__(self, rows):
            self.rows = rows

        def fetchall(self):
            return self.rows

        def fetchone(self):
            return None

    class Conn:
        def execute(self, sql, params=None):
            text = " ".join(sql.lower().split())
            seen.append(text)
            if "from srp_cleanup.tier_agents ta join" in text:
                return Cur([{"id": i} for i in range(1, 41)])
            if "srs_config_categories" in text:
                return Cur([{"id": 1, "score": 5}])
            return Cur([])

    from contextlib import contextmanager

    @contextmanager
    def fake_connection():
        yield Conn()

    monkeypatch.setattr(sh, "connection", fake_connection)
    report = sh.seed(dry_run=True, as_of=date(2026, 10, 27))
    assert report.dry_run and report.planned["home_score_lanes"] == 10 and report.planned["home_seat_state"] == 40
    assert report.planned["home_competitors"] == 200 and report.planned["home_map_cells"] == 49 * 40
    assert report.planned["srs_lane_gaps"] == 10 * 40
    assert report.planned["profile_graph_groups"] == 6 * 40 and report.planned["profile_facts"] > 40 * 8
    assert report.planned["insights_ai_engines"] == 3 * 40 and report.planned["insights_competitor_positions"] == 5 * 40
    assert report.planned["web_checks"] == 10 * 40 and report.planned["connected_accounts"] == 11 * 40
    assert report.planned["network_partners"] > 40 and report.planned["network_referrals"] > 40
    assert report.planned["insights_spot_leaders"] == 147 * 40 and 5 * 40 <= report.planned["insights_visibility"] <= 6 * 40
    assert not [q for q in seen if q.startswith(("insert", "update", "delete"))]
