"""The pure builder of the Home mock rows (srp/home-page-schema, task 3): `surfaces.srp.seat.seed_home_plan`.

No database. It checks the invariants the Home read and the page rely on (spec criteria 5 and 6): lane points sum to the total,
totals never fall, the leader outscores the seat, the done activities add up to what the seat gained since the claim, every
seat lands on one of the three layouts, and a re-run with the same date gives the same rows.
"""
from __future__ import annotations

import dataclasses
import random
import re
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pytest

from surfaces.srp.seat import seed_home_plan as hp

AS_OF = datetime(2026, 10, 27, 12, 0)
SEATS = list(range(1, 41))
LANE_KEYS = ["reviews", "completeness", "website", "articles", "gbp", "directories", "qa", "connections", "videos", "audio"]
TARGETS = {"voce", "website", "profile"}


@pytest.fixture(scope="module")
def plan():
    return hp.build_home_plan(SEATS, AS_OF)


def band_for(ref, total):
    return [b for b in ref.bands if b.min_points <= total][-1].name


def layout_of(n):
    return "day1" if n < 7 else "day7" if n < 24 else "day24"


# --- reference data ---------------------------------------------------------------------------------------

def test_the_lanes_are_the_ten_srs_v5_lanes_and_sum_to_850(plan):
    lanes = plan.reference.lanes
    assert [l.key for l in lanes] == LANE_KEYS
    assert {l.key: l.max_points for l in lanes} == {
        "reviews": 187, "completeness": 182, "website": 102, "articles": 103, "gbp": 68,
        "directories": 90, "qa": 34, "connections": 51, "videos": 27, "audio": 6}
    assert sum(l.max_points for l in lanes) == 850
    assert [l.position for l in lanes] == list(range(1, 11))


def test_the_bands_are_the_confirmed_mock_thresholds(plan):
    assert [(b.name, b.min_points) for b in plan.reference.bands] == [("Building", 0), ("Established", 400), ("Leading", 600), ("Elite", 750)]
    assert [b.position for b in plan.reference.bands] == [1, 2, 3, 4]


def test_three_plans_ordered_from_free_with_one_highlighted(plan):
    plans = plan.reference.plans
    assert [(p.key, p.position) for p in plans] == [("core", 1), ("engage", 2), ("amplify", 3)]
    assert [p.highlight for p in plans] == [False, False, True]
    assert all(p.name and p.tag and p.items for p in plans)


def test_one_peer_benchmark_per_band_except_the_top(plan):
    ref = plan.reference
    assert [b.band for b in ref.benchmarks] == ["Building", "Established", "Leading"]
    building = ref.benchmarks[0]
    assert (building.median_gain, building.horizon_days, building.cohort_size, building.cohort_period,
            building.reached_next_band, building.cohort_of) == (61, 90, 34, "Jan–Sep 2026", 3, 5)
    assert all(b.reached_next_band <= b.cohort_of and b.horizon_days > 0 and b.cohort_size > 0 for b in ref.benchmarks)


# --- determinism ------------------------------------------------------------------------------------------

def test_the_same_input_gives_the_same_plan(plan):
    assert hp.build_home_plan(SEATS, AS_OF) == plan


def test_seat_order_and_duplicates_do_not_matter(plan):
    shuffled = SEATS * 2
    random.Random(7).shuffle(shuffled)
    assert hp.build_home_plan(shuffled, AS_OF) == plan


def test_a_seat_keeps_its_rows_when_other_seats_come_and_go(plan):
    small = hp.build_home_plan([5, 17, 33], AS_OF)
    by_id = {s.seat_id: s for s in plan.seats}
    assert [s for s in small.seats] == [by_id[5], by_id[17], by_id[33]]


def test_a_later_date_moves_dates_and_nothing_else(plan):
    shift = timedelta(days=3)
    later = hp.build_home_plan(SEATS, AS_OF + shift)

    def unshift(value):
        if isinstance(value, datetime):
            return value - shift
        if isinstance(value, dict):
            return {k: unshift(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [unshift(v) for v in value]
        return value

    assert unshift(dataclasses.asdict(later)) == dataclasses.asdict(plan)


def test_a_date_in_the_morning_or_the_evening_is_the_same_day():
    morning = hp.build_home_plan(SEATS[:6], datetime(2026, 10, 27, 0, 5))
    evening = hp.build_home_plan(SEATS[:6], datetime(2026, 10, 27, 23, 55))
    assert morning == evening
    assert hp.build_home_plan(SEATS[:6], date(2026, 10, 27)) == morning


# --- layouts and trial dates --------------------------------------------------------------------------------

def test_seats_land_on_all_three_layouts(plan):
    assert {s.layout for s in plan.seats} == {"day1", "day7", "day24"}
    for layout in ("day1", "day7", "day24"):
        assert sum(1 for s in plan.seats if s.layout == layout) >= 6, layout


def test_the_day_number_follows_the_trial_start_and_the_layout_rule(plan):
    for s in plan.seats:
        started = s.state.trial_started_at
        assert started.time() == time(9, 0)
        assert (AS_OF.date() - started.date()).days + 1 == s.day_n
        assert layout_of(s.day_n) == s.layout
        assert 1 <= s.day_n <= 30
        if s.layout == "day7":
            assert 8 <= s.day_n <= 23  # at least a week of history, so "this week" has a baseline


def test_the_trial_day_of_any_seat_stays_inside_its_layout_range():
    ranges = {"day1": (1, 6), "day7": (8, 23), "day24": (24, 30)}
    for seat in range(1, 2001):
        for layout, (lo, hi) in ranges.items():
            n = hp._trial_day(seat, layout)
            assert lo <= n <= hi and hp.layout_of_day(n) == layout, (seat, layout, n)


# --- snapshots ----------------------------------------------------------------------------------------------

def test_snapshots_are_two_to_four_oldest_first_from_the_claim_to_now(plan):
    for s in plan.seats:
        snaps = s.snapshots
        assert 2 <= len(snaps) <= 4, s.seat_id
        times = [x.as_of for x in snaps]
        assert times == sorted(set(times)), s.seat_id
        assert snaps[0].as_of == s.state.trial_started_at
        assert snaps[-1].as_of == datetime.combine(AS_OF.date(), time(12, 0))


def test_a_week_old_snapshot_exists_once_the_seat_has_a_week_of_history(plan):
    for s in plan.seats:
        now = s.snapshots[-1].as_of
        if s.day_n >= 8:
            assert any(x.as_of == now - timedelta(days=7) for x in s.snapshots), s.seat_id


def test_totals_are_in_range_never_fall_and_match_their_band(plan):
    for s in plan.seats:
        totals = [x.total for x in s.snapshots]
        assert all(0 <= t <= 850 for t in totals) and totals == sorted(totals), s.seat_id
        assert totals[-1] > totals[0], s.seat_id
        for x in s.snapshots:
            assert x.band == band_for(plan.reference, x.total)
        latest_band = s.snapshots[-1].band
        assert (latest_band == "Building") == (s.layout == "day1"), (s.seat_id, s.layout, latest_band)


def test_lane_points_sum_to_the_total_and_respect_each_lane_maximum(plan):
    maxima = {l.key: l.max_points for l in plan.reference.lanes}
    for s in plan.seats:
        for x in s.snapshots:
            assert set(x.lanes) == set(LANE_KEYS)
            assert sum(x.lanes.values()) == x.total, (s.seat_id, x.as_of)
            assert all(0 <= p <= maxima[k] for k, p in x.lanes.items())


def test_rank_is_inside_the_market_and_only_improves(plan):
    for s in plan.seats:
        ofs = {x.rank_of for x in s.snapshots}
        assert len(ofs) == 1 and 30 <= ofs.pop() <= 50
        positions = [x.rank_position for x in s.snapshots]
        assert positions == sorted(positions, reverse=True), s.seat_id
        assert all(2 <= p <= x.rank_of for p, x in zip(positions, s.snapshots, strict=True)), s.seat_id
        assert all(x.rank_city for x in s.snapshots)


def test_markets_and_cities_follow_the_zipcode_given(plan):
    markets = {1: "52801", 2: "52801", 3: "52802"}
    custom = hp.build_home_plan([1, 2, 3], AS_OF, markets)
    cities = {s.seat_id: s.snapshots[-1].rank_city for s in custom.seats}
    ofs = {s.seat_id: s.snapshots[-1].rank_of for s in custom.seats}
    assert cities[1] == cities[2] and ofs[1] == ofs[2]


def test_profile_reviews_and_ai_figures_are_plausible_and_never_fall(plan):
    for s in plan.seats:
        for series in ([x.profile_strength_pct for x in s.snapshots], [x.review_count for x in s.snapshots],
                       [x.ai_cited for x in s.snapshots]):
            assert series == sorted(series), s.seat_id
        for x in s.snapshots:
            assert 0 <= x.profile_strength_pct <= 100
            assert 3.5 <= x.review_avg <= 5.0 and round(x.review_avg, 1) == x.review_avg
            assert x.ai_checked == 7 and 0 <= x.ai_cited <= 7
            assert x.ai_checked_at is not None and x.ai_checked_at <= x.as_of


def test_only_the_newest_snapshot_has_a_map_of_49_distinct_cells(plan):
    for s in plan.seats:
        for x in s.snapshots[:-1]:
            assert x.cells == [] and x.map_scanned_at is None
        newest = s.snapshots[-1]
        assert len(newest.cells) == 49 and newest.map_scanned_at is not None and newest.map_scanned_at <= newest.as_of
        assert len({(c.row, c.col) for c in newest.cells}) == 49
        assert all(0 <= c.row <= 6 and 0 <= c.col <= 6 and (c.rank is None or c.rank >= 1) for c in newest.cells)
        top3 = sum(1 for c in newest.cells if c.rank is not None and c.rank <= 3)
        assert 3 <= top3 <= 20, s.seat_id


# --- competitors ----------------------------------------------------------------------------------------------

def test_five_competitors_and_one_leader_who_outscores_the_seat(plan):
    for s in plan.seats:
        comps = s.competitors
        total, position = s.snapshots[-1].total, s.snapshots[-1].rank_position
        assert len(comps) == 5 and [c.position for c in comps] == [1, 2, 3, 4, 5]
        assert [c.score for c in comps] == sorted((c.score for c in comps), reverse=True)
        leaders = [c for c in comps if c.is_market_leader]
        assert len(leaders) == 1 and leaders[0] is comps[0] and leaders[0].score > total, s.seat_id
        assert all(0 <= c.score <= 850 for c in comps)
        assert sum(1 for c in comps if c.score > total) <= position - 1, s.seat_id
        assert len({c.name for c in comps}) == 5
        assert all(c.review_count >= 0 and 3.5 <= c.review_avg <= 5.0 and c.article_count >= 0 for c in comps)


# --- activity, moves, locked features ------------------------------------------------------------------------

def test_done_activities_add_up_to_what_the_seat_gained_since_the_claim(plan):
    for s in plan.seats:
        done = [a for a in s.activities if a.status == "done"]
        gained = s.snapshots[-1].total - s.snapshots[0].total
        assert sum(a.points or 0 for a in done) == gained, s.seat_id
        assert 4 <= len(done) <= 12, s.seat_id
        assert all(a.completed_at is not None and a.started_at is not None and a.started_at <= a.completed_at for a in done)


def test_activity_times_are_distinct_and_inside_the_trial_and_there_is_a_single_latest(plan):
    for s in plan.seats:
        claim, now = s.snapshots[0].as_of, s.snapshots[-1].as_of
        stamps = [a.completed_at or a.started_at for a in s.activities]
        assert len(stamps) == len(set(stamps)), s.seat_id
        assert all(claim <= t <= now for t in stamps), s.seat_id
        latest = max(s.activities, key=lambda a: a.completed_at or a.started_at)
        if latest.status == "done":
            assert 1 <= (latest.points or 0) <= s.snapshots[-1].total - s.snapshots[0].total
        else:
            assert latest.status == "doing" and latest.completed_at is None
        assert all(a.status in {"doing", "done"} for a in s.activities)


def test_some_seats_are_in_the_middle_of_a_task_and_most_have_just_finished_one(plan):
    latest_status = [max(s.activities, key=lambda a: a.completed_at or a.started_at).status for s in plan.seats]
    assert "doing" in latest_status and latest_status.count("done") > latest_status.count("doing")


def test_three_next_moves_one_recommended_with_known_targets(plan):
    for s in plan.seats:
        assert [m.position for m in s.moves] == [1, 2, 3]
        assert sum(1 for m in s.moves if m.recommended) == 1
        assert {m.target for m in s.moves} == TARGETS
        assert all(m.icon and m.title and m.subtitle for m in s.moves)


def test_three_locked_features_with_their_lane_and_plan(plan):
    for s in plan.seats:
        feats = {f.feature_key: f for f in s.locked}
        assert set(feats) == {"listings", "voce", "map_rank"} and len(s.locked) == 3
        assert (feats["listings"].lane, feats["listings"].plan) == ("directories", "engage")
        assert (feats["voce"].lane, feats["voce"].plan) == ("articles", "engage")
        assert (feats["map_rank"].lane, feats["map_rank"].plan) == (None, "amplify")
        assert all(f.title and f.description for f in s.locked)


def test_seats_are_on_each_plan_and_most_are_on_the_free_one(plan):
    plans = [s.state.plan for s in plan.seats]
    assert set(plans) == {"core", "engage", "amplify"} and plans.count("core") > len(plans) / 2


def test_state_defaults_and_weekly_moves(plan):
    for s in plan.seats:
        st = s.state
        assert st.is_mock is True and st.trial_days == 30 and st.moves_goal == 3 and st.nora_text_day
        assert 0 <= st.moves_done <= st.moves_goal and st.streak_weeks >= 0
        if s.layout == "day1":
            assert st.moves_done == 0 and st.streak_weeks == 0


# --- brief, drafts, events, insights --------------------------------------------------------------------------

def test_the_brief_items_add_up_to_the_week_and_point_at_a_known_target(plan):
    for s in plan.seats:
        b = s.brief
        base = next((x for x in reversed(s.snapshots[:-1]) if x.as_of <= s.snapshots[-1].as_of - timedelta(days=7)), s.snapshots[0])
        assert 3 <= len(b.items) <= 5 and [i.position for i in b.items] == list(range(1, len(b.items) + 1))
        assert sum(i.points for i in b.items) == s.snapshots[-1].total - base.total, s.seat_id
        assert b.next_move_target in TARGETS and b.next_move_label and b.next_move_points > 0
        assert b.away_new_reviews >= 0 and isinstance(b.away_bio_live, bool) and isinstance(b.away_first_article, bool)
        assert b.week_start <= s.snapshots[-1].as_of


def test_review_drafts_are_generic_and_marked_mock(plan):
    seen = []
    for s in plan.seats:
        if s.layout == "day1":
            assert [d for d in s.drafts if d.status == "draft"] == []
        assert len(s.drafts) <= 6
        for d in s.drafts:
            assert d.reviewer_label.startswith("Reviewer ") and d.reviewer_label.endswith("(mock)")
            assert 1 <= d.rating <= 5 and d.review_text and d.draft_text
            assert d.compliance_status in {"passed", "needs_edit"} and d.status in {"draft", "approved", "posted"}
            seen.append(d)
    assert {d.status for d in seen} >= {"draft", "posted"} and {d.compliance_status for d in seen} == {"passed", "needs_edit"}


def test_events_are_known_kinds_and_expire_in_the_future(plan):
    kinds = set()
    for s in plan.seats:
        assert len(s.events) <= 2
        for e in s.events:
            kinds.add(e.kind)
            assert e.kind in {"review", "facebook"} and e.title and e.action_label
            assert e.expires_at is None or e.expires_at > s.snapshots[-1].as_of
    assert kinds == {"review", "facebook"}


def test_three_insights_quote_the_leader(plan):
    for s in plan.seats:
        assert [i.position for i in s.insights] == [1, 2, 3]
        assert {i.action for i in s.insights} <= {"voce", "reviews", "insights"} and len({i.action for i in s.insights}) == 3
        assert s.competitors[0].name in " ".join(i.title + " " + i.body for i in s.insights)


def test_no_person_is_named_anywhere(plan):
    def strings(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for v in value.values():
                yield from strings(v)
        elif isinstance(value, (list, tuple)):
            for v in value:
                yield from strings(v)

    text = " ".join(strings(dataclasses.asdict(plan)))
    for name in ("Maria", "Kevin", "James", "Alex", "Anitha", "Davenport Dan"):
        assert name not in text, name
    assert "Mock" in text or "mock" in text


def _varchar_limits() -> dict[str, int]:
    """The smallest varchar(n) of each column name across the Home tables in the DDL script (the script has been applied, so it is the limit)."""
    db = Path(__file__).resolve().parents[1] / "db" / "local"
    sql = (db / "home_schema.sql").read_text() + (db / "srs_schema.sql").read_text()
    limits: dict[str, int] = {}
    pairs = re.findall(r"^\s+(\w+) varchar\((\d+)\)", sql, flags=re.MULTILINE) + re.findall(r"add column if not exists (\w+) varchar\((\d+)\)", sql)
    for column, n in pairs:
        limits[column] = min(int(n), limits.get(column, 10**9))
    return limits


def test_every_text_value_fits_its_column_in_the_applied_schema(plan):
    limits = _varchar_limits()
    assert limits["tag"] == 40 and limits["reviewer_label"] == 80
    assert limits["you_text"] == 200 and limits["action_target"] == 16 and limits["short_name"] == 24 and limits["action_label"] <= 60  # (the smallest across tables)

    def walk(obj):
        if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
            for f in dataclasses.fields(obj):
                value = getattr(obj, f.name)
                if isinstance(value, str) and f.name in limits:
                    assert len(value) <= limits[f.name], (type(obj).__name__, f.name, value, len(value), limits[f.name])
                walk(value)
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                walk(item)

    walk(plan)


# --- the SRS page's lane gaps and short names (srp/srs-page-schema, task 3) -----------------------------------

GAP_TARGETS = {"profile", "voce", "website", "connections", "reviews", "chat", "billing"}
MISSABLE = {"articles", "qa", "videos", "audio"}
SHORT = {"reviews": "Reviews", "completeness": "Completeness", "website": "Website", "articles": "Articles", "gbp": "GBP",
         "directories": "Directories", "qa": "Q&A", "connections": "Connections", "videos": "Videos", "audio": "Audio"}


def gaps_of(seat):
    return {g.lane: g for g in seat.gaps}


def test_every_lane_has_a_short_name(plan):
    assert {l.key: l.short_name for l in plan.reference.lanes} == SHORT


def test_every_seat_has_one_gap_per_lane_in_lane_order(plan):
    for seat in plan.seats:
        assert [g.lane for g in seat.gaps] == LANE_KEYS, seat.seat_id


def test_every_gap_has_texts_a_label_and_a_known_target(plan):
    for seat in plan.seats:
        for g in seat.gaps:
            assert g.you_text.strip() and g.rival_text.strip() and g.action_label.strip(), (seat.seat_id, g.lane)
            assert g.action_target in GAP_TARGETS, (seat.seat_id, g)
            assert g.note is None or g.note.strip()


def test_only_lanes_that_can_be_absent_are_ever_missing(plan):
    seen = set()
    for seat in plan.seats:
        for g in seat.gaps:
            if g.is_missing:
                assert g.lane in MISSABLE, (seat.seat_id, g.lane)
                seen.add(g.lane)
    assert seen == MISSABLE, "every absent-able lane is missing for some seat"
    assert any(not g.is_missing for seat in plan.seats for g in seat.gaps if g.lane in MISSABLE)


def test_the_reviews_gap_repeats_the_snapshot_and_leader_counts(plan):
    for seat in plan.seats:
        g, snap, leader = gaps_of(seat)["reviews"], seat.snapshots[-1], seat.competitors[0]
        assert g.you_text == str(snap.review_count), seat.seat_id
        assert g.rival_text == f"{leader.review_count} reviews", seat.seat_id
        m = re.fullmatch(r"(\d+) in the last 12 months", g.note or "")
        assert m and 1 <= int(m.group(1)) <= snap.review_count, (seat.seat_id, g.note)
        assert g.action_target == "reviews"


def test_the_articles_gap_repeats_the_leader_count_and_the_first_article_flag(plan):
    for seat in plan.seats:
        g, leader = gaps_of(seat)["articles"], seat.competitors[0]
        assert g.rival_text == f"{leader.article_count} articles", seat.seat_id
        assert (g.you_text == "0") == (not seat.brief.away_first_article), seat.seat_id
        assert g.is_missing == (g.you_text == "0"), seat.seat_id
        assert g.action_target == "voce"


def test_the_completeness_gap_quotes_the_profile_strength(plan):
    for seat in plan.seats:
        g = gaps_of(seat)["completeness"]
        assert f"{seat.snapshots[-1].profile_strength_pct}%" in g.you_text, seat.seat_id
        assert g.action_target == "profile"


def test_the_directories_action_follows_the_plan(plan):
    plans = set()
    for seat in plan.seats:
        g = gaps_of(seat)["directories"]
        plans.add(seat.state.plan)
        if seat.state.plan == "core":
            assert (g.action_label, g.action_target) == ("Unlock Listings", "billing"), seat.seat_id
        else:
            assert (g.action_label, g.action_target) == ("Fix my listings", "chat"), seat.seat_id
    assert plans == {"core", "engage", "amplify"}


def test_absent_qa_videos_and_audio_say_so(plan):
    absent = {"qa": "0", "videos": "No videos", "audio": "No audio"}
    for seat in plan.seats:
        for lane, text in absent.items():
            g = gaps_of(seat)[lane]
            assert g.is_missing == (g.you_text == text), (seat.seat_id, lane, g)


def test_the_connections_and_gbp_gaps_point_at_connections(plan):
    for seat in plan.seats:
        by = gaps_of(seat)
        assert by["connections"].action_target == "connections" and by["gbp"].action_target == "connections"
        assert re.fullmatch(r"\d+", by["connections"].you_text)
        assert re.fullmatch(r"\d+ connected accounts", by["connections"].rival_text)
        assert int(by["connections"].rival_text.split()[0]) > int(by["connections"].you_text)


def test_gaps_of_a_seat_do_not_depend_on_the_other_seats(plan):
    small = hp.build_home_plan([5, 17], AS_OF)
    by_id = {s.seat_id: s for s in plan.seats}
    assert [s.gaps for s in small.seats] == [by_id[5].gaps, by_id[17].gaps]


def test_a_lane_the_seat_has_none_of_earns_no_points_in_any_snapshot(plan):
    """Second review finding 1: a Missing lane used to earn up to its full budget, so the page showed it as Strong."""
    seen = set()
    for seat in plan.seats:
        for g in seat.gaps:
            if g.is_missing:
                seen.add(g.lane)
                assert all(snap.lanes[g.lane] == 0 for snap in seat.snapshots), (seat.seat_id, g.lane)
    assert seen == MISSABLE


def test_a_lane_with_a_measure_is_never_flagged_missing_and_the_points_still_add_up(plan):
    for seat in plan.seats:
        missing = {g.lane for g in seat.gaps if g.is_missing}
        for snap in seat.snapshots:
            assert sum(snap.lanes.values()) == snap.total, seat.seat_id
            assert all(points <= next(x.max_points for x in plan.reference.lanes if x.key == k) for k, points in snap.lanes.items())
            assert all(snap.lanes[k] == 0 for k in missing)
