"""The pure builder of the Insights mock rows (srp/insights-page-schema, task 3): `surfaces.srp.seat.seed_insights_plan`.

No database. It checks (a) the shape the tables enforce, (b) determinism and independence from other seats, and (c) -- the lesson of the SRS and Profile
reviews -- that no seeded row contradicts a rule the page applies: the engine rows add up to Home's AI figures, "You" is in a spot's top 3 exactly when the
seat's stored rank is 1 to 3, a rival never appears twice in a spot, the market leader has the lowest average position, a note agrees with its counts.
"""
from __future__ import annotations

import dataclasses
import re
from datetime import datetime
from pathlib import Path

import pytest

from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_insights_plan as ip

AS_OF = datetime(2026, 10, 27, 12, 0)
SEATS = list(range(1, 61))
METRICS = ("search_views", "maps_views", "calls", "directions", "website_clicks", "profile_views")
ENGINES = ("chatgpt", "gemini", "perplexity")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")


@pytest.fixture(scope="module")
def home():
    return hp.build_home_plan(SEATS, AS_OF)


@pytest.fixture(scope="module")
def plan(home):
    return ip.build_insights_plan(home)


def home_of(home, seat_id):
    return next(s for s in home.seats if s.seat_id == seat_id)


def cells_of(h):
    return {(c.row, c.col): c.rank for c in h.snapshots[-1].cells}


# --- the vocabulary and the shapes ---------------------------------------------------------------------------------

def test_the_vocabulary_matches_the_tables():
    assert ip.METRICS == METRICS and ip.ENGINES == ENGINES
    assert set(ip.SOURCE_TIER.values()) <= set(TIERS)


def test_every_seat_of_the_home_plan_has_rows_in_order(plan, home):
    assert [s.seat_id for s in plan.seats] == [s.seat_id for s in home.seats]
    for seat in plan.seats:
        assert len({v.metric for v in seat.visibility}) == len(seat.visibility), "one row per metric"
        assert [v.metric for v in seat.visibility] == [m for m in METRICS if m in {v.metric for v in seat.visibility}], "in the page's order"
        assert [e.engine for e in seat.engines] == list(ENGINES)
        assert all(v.metric in METRICS for v in seat.visibility)


def test_visibility_rows_are_valid_and_the_source_and_tier_agree(plan):
    for seat in plan.seats:
        for v in seat.visibility:
            assert v.value >= 0 and v.period_days == 30, seat.seat_id
            assert v.trust_tier in TIERS and ip.SOURCE_TIER[v.source] == v.trust_tier, (seat.seat_id, v)
            assert (v.source == "From Experience.com") == (v.metric == "profile_views"), (seat.seat_id, v)


def test_some_seats_miss_a_metric_and_most_have_all_six(plan):
    counts = [len(s.visibility) for s in plan.seats]
    assert 6 in counts and min(counts) == 5 and max(counts) == 6
    assert counts.count(6) > counts.count(5)


def test_the_page_rule_that_actions_come_from_views_holds(plan):
    """A call, a direction request or a website click starts from a view, so each is below the Maps views of the same seat."""
    for seat in plan.seats:
        v = {x.metric: x.value for x in seat.visibility}
        if "maps_views" in v:
            for m in ("calls", "directions", "website_clicks"):
                if m in v:
                    assert v[m] < v["maps_views"], (seat.seat_id, m)


def test_the_ranges_themselves_keep_actions_below_maps_views():
    low = ip._RANGE["maps_views"][0]
    assert all(ip._RANGE[m][1] < low for m in ("calls", "directions", "website_clicks"))


# --- the AI engines ---------------------------------------------------------------------------------------------------

def test_the_engine_rows_add_up_to_homes_ai_figures(plan, home):
    for seat in plan.seats:
        s = home_of(home, seat.seat_id).snapshots[-1]
        assert sum(e.cited for e in seat.engines) == s.ai_cited, seat.seat_id
        assert sum(e.checked for e in seat.engines) == s.ai_checked, seat.seat_id


def test_each_engine_is_valid_and_has_a_note_that_agrees_with_its_counts(plan):
    seen_zero = seen_some = False
    for seat in plan.seats:
        for e in seat.engines:
            assert 0 <= e.cited <= e.checked, (seat.seat_id, e)
            assert e.note, (seat.seat_id, e)
            if e.cited == 0:
                seen_zero = True
                assert not e.note.startswith("Names you for"), (seat.seat_id, e)  # no claim of being named when never cited
                assert e.note in ip.NOTES_NONE
            else:
                seen_some = True
                assert e.note.startswith("Names you for") and e.note in ip.NOTES_SOME
    assert seen_zero and seen_some


@pytest.mark.parametrize("checked", range(13))
def test_engines_split_any_count_exactly_and_never_cite_more_than_they_checked(checked):
    for cited in range(checked + 1):
        rows = ip._engines(3, cited, checked)
        assert sum(e.cited for e in rows) == cited and sum(e.checked for e in rows) == checked, (cited, checked)
        assert all(0 <= e.cited <= e.checked for e in rows), (cited, checked, rows)


def test_every_engine_checks_something_when_home_checked_enough(plan, home):
    for seat in plan.seats:
        if home_of(home, seat.seat_id).snapshots[-1].ai_checked >= 3:
            assert all(e.checked >= 1 for e in seat.engines), seat.seat_id


# --- the competitor positions -----------------------------------------------------------------------------------------

def test_every_rival_has_one_position_and_the_market_leader_the_lowest_average(plan, home):
    for seat in plan.seats:
        h = home_of(home, seat.seat_id)
        assert [p.competitor_position for p in seat.positions] == [c.position for c in h.competitors], seat.seat_id
        assert [p.name for p in seat.positions] == [c.name for c in h.competitors]
        leader = next(c for c in h.competitors if c.is_market_leader)
        by_pos = {p.competitor_position: p.avg_position for p in seat.positions}
        assert by_pos[leader.position] == min(by_pos.values()), seat.seat_id
        assert len(set(by_pos.values())) == len(by_pos), "no ties among rivals"


def test_a_better_competitor_never_averages_worse_than_a_lower_one(plan, home):
    for seat in plan.seats:
        scores = {c.position: c.score for c in home_of(home, seat.seat_id).competitors}
        ranked = sorted(seat.positions, key=lambda p: p.avg_position)
        assert [scores[p.competitor_position] for p in ranked] == sorted(scores.values(), reverse=True), seat.seat_id


def test_average_positions_are_one_decimal_in_range(plan):
    for seat in plan.seats:
        for p in seat.positions:
            assert 1.0 <= p.avg_position <= 21.0 and round(p.avg_position, 1) == p.avg_position, (seat.seat_id, p)


# --- the spot leaders -------------------------------------------------------------------------------------------------

def test_every_one_of_the_49_cells_has_exactly_three_leaders_at_positions_1_2_3(plan, home):
    for seat in plan.seats:
        cells = cells_of(home_of(home, seat.seat_id))
        by_cell: dict[tuple, list] = {}
        for l in seat.leaders:
            by_cell.setdefault((l.row, l.col), []).append(l)
        assert set(by_cell) == set(cells) and len(cells) == 49, seat.seat_id
        for key, ls in by_cell.items():
            assert [l.position for l in ls] == [1, 2, 3], (seat.seat_id, key)


def test_you_is_in_a_spots_top_three_exactly_when_the_stored_rank_is_one_to_three_and_at_that_place(plan, home):
    seen_you = seen_not = False
    for seat in plan.seats:
        cells = cells_of(home_of(home, seat.seat_id))
        for l in seat.leaders:
            rank = cells[(l.row, l.col)]
            if l.is_you:
                seen_you = True
                assert rank is not None and rank <= 3 and l.position == rank, (seat.seat_id, l)
            if rank is not None and rank <= 3:
                assert next(x for x in seat.leaders if (x.row, x.col) == (l.row, l.col) and x.is_you).position == rank
        for key, rank in cells.items():
            n = sum(1 for l in seat.leaders if (l.row, l.col) == key and l.is_you)
            assert n == (1 if rank is not None and rank <= 3 else 0), (seat.seat_id, key, rank)
            seen_not = seen_not or n == 0
    assert seen_you and seen_not


def test_a_leader_is_you_with_no_name_or_a_rival_of_the_seat_and_never_repeats_in_a_spot(plan, home):
    for seat in plan.seats:
        rivals = {c.name for c in home_of(home, seat.seat_id).competitors}
        by_cell: dict[tuple, list] = {}
        for l in seat.leaders:
            assert l.is_you == (l.name is None), (seat.seat_id, l)
            if not l.is_you:
                assert l.name in rivals, (seat.seat_id, l)
            by_cell.setdefault((l.row, l.col), []).append(l.name)
        for key, names in by_cell.items():
            assert len(set(names)) == 3, (seat.seat_id, key, names)


def test_the_market_leader_is_seen_in_many_spots_and_every_rival_somewhere(plan, home):
    for seat in plan.seats[:20]:
        h = home_of(home, seat.seat_id)
        leader = next(c for c in h.competitors if c.is_market_leader).name
        count = {c.name: sum(1 for l in seat.leaders if l.name == c.name) for c in h.competitors}
        assert count[leader] >= max(count.values()) * 0.6, (seat.seat_id, count)
        assert all(n > 0 for n in count.values()), (seat.seat_id, count)


# --- determinism and independence ---------------------------------------------------------------------------------------

def test_same_input_same_output(home):
    assert ip.build_insights_plan(home) == ip.build_insights_plan(home)


def test_a_seat_does_not_depend_on_the_other_seats_or_their_order(plan):
    only = ip.build_insights_plan(hp.build_home_plan([17, 5, 33], AS_OF))
    by = {s.seat_id: s for s in plan.seats}
    assert [s.seat_id for s in only.seats] == [5, 17, 33]
    for s in only.seats:
        assert s == by[s.seat_id]


def test_a_later_date_changes_no_row_that_has_no_date(home):
    later = hp.build_home_plan(SEATS, datetime(2026, 11, 3, 12, 0))
    a, b = ip.build_insights_plan(home), ip.build_insights_plan(later)
    for x, y in zip(a.seats, b.seats, strict=True):
        assert (x.visibility, x.engines, x.positions, x.leaders) == (y.visibility, y.engines, y.positions, y.leaders)


def test_the_plan_does_not_change_the_home_plan_it_reads(home):
    before = dataclasses.asdict(home)
    ip.build_insights_plan(home)
    assert dataclasses.asdict(home) == before


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
    for name in ("Maria", "Kevin", "James", "Alex", "Anitha", "Harper", "Finley", "Reese", "Dana", "Whitfield"):
        assert name not in text, name
    src = Path(ip.__file__).read_text()
    for name in ("Maria", "Kevin", "James", "Anitha", "Whitfield"):
        assert name not in src, name


def _varchar_limits() -> dict[str, int]:
    sql = (Path(__file__).resolve().parents[1] / "db" / "local" / "insights_schema.sql").read_text()
    return {c: int(n) for c, n in re.findall(r"^\s+(\w+) varchar\((\d+)\)", sql, flags=re.MULTILINE)}


def test_every_text_value_fits_its_column(plan):
    limits = _varchar_limits()
    assert limits["note"] == 120 and limits["name"] == 160 and limits["source"] == 60 and limits["engine"] == 12 and limits["metric"] == 20
    for seat in plan.seats:
        for v in seat.visibility:
            assert len(v.metric) <= limits["metric"] and len(v.source) <= limits["source"] and len(v.trust_tier) <= limits["trust_tier"]
        for e in seat.engines:
            assert len(e.engine) <= limits["engine"] and len(e.note) <= limits["note"]
        for l in seat.leaders:
            assert l.name is None or len(l.name) <= limits["name"]
