"""The pure builder of the Network mock rows (srp/network-page-schema, task 3): `surfaces.srp.seat.seed_network_plan`.

No database. It checks (a) the shape the tables enforce, (b) determinism, independence from other seats and the date rule, and (c) -- the lesson of the earlier reviews -- that no
seeded row contradicts a rule the page applies or another page shows: a Zillow reason only where Zillow is matched and never above the seat's review count (N9), a closing claim
only where the Loan system is connected (N10), a referral that names a partner points to a promoted partner of the same seat (N11), dates in range (N12), source and tier by kind
(N13), counts following the Home layout. The expectations below are written independently of the builder (their own tables and parsers).
"""
from __future__ import annotations

import copy
import dataclasses
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from surfaces.srp.seat import seed_connections_plan as cp
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_network_plan as np_
from surfaces.srp.seat import seed_profile_plan as pp

AS_OF = datetime(2026, 10, 27, 12, 0)
TODAY = date(2026, 10, 27)
SEATS = list(range(1, 41))
DDL = (Path(__file__).resolve().parents[1] / "db" / "local" / "network_schema.sql").read_text()
STATES = ("promoted", "request", "suggested", "saved")
ROLES = ("Agent", "Title", "Inspector")
LISTS = {"received": ("new", "followed", "closed"), "requested": ("waiting", "replied"), "given": ("thanked", "done")}
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
# the rows each layout may have: (min, max) promoted, request, suggested, saved, received, requested, given
RANGES = {
    "day1": {"promoted": (0, 1), "request": (0, 1), "suggested": (0, 2), "saved": (0, 1), "received": (0, 1), "requested": (0, 1), "given": (0, 0)},
    "day7": {"promoted": (1, 3), "request": (0, 2), "suggested": (0, 2), "saved": (0, 1), "received": (1, 3), "requested": (0, 2), "given": (0, 1)},
    "day24": {"promoted": (2, 5), "request": (0, 2), "suggested": (0, 2), "saved": (0, 1), "received": (2, 4), "requested": (1, 3), "given": (0, 2)},
}
BY_KIND = {  # source and tier by the kind of row (N13)
    "promoted": ("From your sign-in", "owner_verified"), "request": ("Asked by the partner", "platform_observed"),
    "suggested": ("Suggested by NORA", "platform_observed"), "saved": ("Saved by you", "owner_verified"),
}
REFERRAL_SOURCE = ("From your sign-in", "owner_verified")


@pytest.fixture(scope="module")
def home():
    return hp.build_home_plan(SEATS, AS_OF)


@pytest.fixture(scope="module")
def profile():
    return pp.build_profile_plan(SEATS, AS_OF)


@pytest.fixture(scope="module")
def conns(home, profile):
    return cp.build_connections_plan(home, profile, AS_OF)


@pytest.fixture(scope="module")
def plan(home, conns):
    return np_.build_network_plan(home, conns, AS_OF)


def state_of(conns, seat_id: int, provider: str) -> str:
    s = next(x for x in conns.seats if x.seat_id == seat_id)
    return next(a.state for a in s.accounts if a.provider == provider)


def review_count(home, seat_id: int) -> int:
    s = next(x for x in home.seats if x.seat_id == seat_id)
    return max(s.snapshots, key=lambda sn: sn.as_of).review_count


def layout(home, seat_id: int) -> str:
    return next(x for x in home.seats if x.seat_id == seat_id).layout


def by_state(seat, state):
    return [p for p in seat.partners if p.state == state]


def by_list(seat, key):
    return [r for r in seat.referrals if r.list_key == key]


def limit(column_sql: str) -> int:
    return int(re.search(column_sql + r" varchar\((\d+)\)", DDL).group(1))


CLOSING = re.compile(r"closed|closing", re.IGNORECASE)


# --- shape -----------------------------------------------------------------------------------------------

def test_every_seat_of_the_home_plan_is_planned_and_has_at_least_one_row(plan, home):
    assert [s.seat_id for s in plan.seats] == SEATS == [s.seat_id for s in home.seats]
    assert all(s.partners or s.referrals for s in plan.seats)


def test_counts_follow_the_home_layout(plan, home):
    for s in plan.seats:
        r = RANGES[layout(home, s.seat_id)]
        got = {st: len(by_state(s, st)) for st in STATES} | {k: len(by_list(s, k)) for k in LISTS}
        for k, (lo, hi) in r.items():
            # a seat with no row at all gets one request (so the page is not empty): that is the only way a count leaves its range
            assert lo <= got[k] <= hi or (k == "request" and got[k] == 1 and not any(got[x] for x in got if x != "request")), (s.seat_id, k, got[k])


def test_at_most_eight_promoted_and_ten_partners_with_positions_from_one(plan):
    for s in plan.seats:
        assert len(by_state(s, "promoted")) <= 8 and len(s.partners) <= 10
        assert [p.position for p in s.partners] == list(range(1, len(s.partners) + 1))
        assert [p.state for p in s.partners] == sorted((p.state for p in s.partners), key=STATES.index), "promoted, request, suggested, saved"
        for k in LISTS:
            assert [r.position for r in by_list(s, k)] == list(range(1, len(by_list(s, k)) + 1))


def test_rows_use_the_vocabulary_the_tables_enforce(plan):
    for s in plan.seats:
        for p in s.partners:
            assert p.role in ROLES and p.state in STATES and p.trust_tier in TIERS
            if p.state == "promoted":
                assert (p.reason_kind, p.reason_count, p.reason_on) == (None, None, None)
            elif p.state == "request":
                assert (p.reason_kind, p.reason_count, p.reason_on) == ("asked", None, None)
            elif p.state == "suggested":
                assert p.reason_kind in ("zillow", "closings") and p.reason_count >= 1 and p.reason_on is None
            else:
                assert p.reason_kind == "saved" and p.reason_count is None and isinstance(p.reason_on, date)
        for r in s.referrals:
            assert r.status in LISTS[r.list_key] and r.trust_tier in TIERS
            assert (r.list_key == "given") == (r.partner_name is not None) or r.list_key == "received", (s.seat_id, r)


def test_names_are_unique_within_a_seat_and_texts_fit_the_columns(plan):
    for s in plan.seats:
        names = [p.name for p in s.partners]
        assert len(set(names)) == len(names), s.seat_id
        for p in s.partners:
            assert 0 < len(p.name) <= limit("name") and 0 < len(p.company) <= limit("company") and 0 < len(p.source) <= limit("source")
        for r in s.referrals:
            assert 0 < len(r.name) <= limit("name") and 0 < len(r.detail) <= limit("detail") and 0 < len(r.source) <= limit("source")


def test_every_state_kind_list_and_status_occurs_across_the_seats(plan):
    partners = [p for s in plan.seats for p in s.partners]
    referrals = [r for s in plan.seats for r in s.referrals]
    assert {p.state for p in partners} == set(STATES)
    assert {p.reason_kind for p in partners} == {None, "asked", "zillow", "closings", "saved"}
    assert {p.role for p in partners} == set(ROLES)
    assert {(r.list_key, r.status) for r in referrals} == {(k, st) for k, sts in LISTS.items() for st in sts}


# --- the rules the pages share (N9 to N13) -----------------------------------------------------------------

def test_a_zillow_reason_only_where_zillow_is_matched_and_never_above_the_seats_reviews(plan, home, conns):
    seen = 0
    for s in plan.seats:
        for p in by_state(s, "suggested"):
            if p.reason_kind == "zillow":
                seen += 1
                assert state_of(conns, s.seat_id, "zillow") == "matched", s.seat_id
                assert 1 <= p.reason_count <= review_count(home, s.seat_id), s.seat_id
    assert seen >= 5, "the check is not vacuous"


def test_a_closing_claim_only_where_the_loan_system_is_connected(plan, conns):
    with_claims = without = 0
    for s in plan.seats:
        loan = state_of(conns, s.seat_id, "loan_system") == "connected"
        claims = [p for p in s.partners if p.reason_kind == "closings"] + [r for r in s.referrals if r.status == "closed" or CLOSING.search(r.detail)]
        assert loan or not claims, (s.seat_id, claims)
        with_claims += bool(claims)
        without += not loan
    assert with_claims >= 3 and without >= 10, "both kinds of seat occur"


def test_no_text_outside_the_closing_rule_mentions_a_closing(plan, conns):
    for s in plan.seats:
        if state_of(conns, s.seat_id, "loan_system") != "connected":
            for r in s.referrals:
                assert not CLOSING.search(r.detail), (s.seat_id, r.detail)


def test_a_referral_that_names_a_partner_points_to_a_promoted_partner_of_the_same_seat(plan):
    named = given = 0
    for s in plan.seats:
        promoted = {p.name: p for p in by_state(s, "promoted")}
        referenced = set()
        for r in s.referrals:
            if r.partner_name is not None:
                assert r.partner_name in promoted, (s.seat_id, r.partner_name)
                referenced.add(r.partner_name)
                named += r.list_key == "received"
                given += r.list_key == "given"
                p = promoted[r.partner_name]
                if r.list_key == "given":
                    assert r.name in (p.name, p.company), (s.seat_id, r.name)
            if r.list_key == "given":
                assert r.partner_name is not None
            if r.list_key == "requested":
                assert r.partner_name is None
        assert referenced <= set(promoted), "no request, suggestion or saved partner is referenced"
    assert named >= 5 and given >= 3, "the check is not vacuous"


def test_a_seat_with_no_promoted_partner_has_no_given_referral(plan):
    assert all(not by_list(s, "given") for s in plan.seats if not by_state(s, "promoted"))
    assert any(not by_state(s, "promoted") for s in plan.seats)


def test_dates_are_on_or_before_the_day_and_within_120_days(plan):
    low = TODAY - timedelta(days=120)
    for s in plan.seats:
        for r in s.referrals:
            assert low <= r.occurred_on < TODAY, (s.seat_id, r.occurred_on)
        for p in by_state(s, "saved"):
            assert low <= p.reason_on < TODAY, (s.seat_id, p.reason_on)
        for r in by_list(s, "requested"):
            if r.status == "waiting":
                assert r.occurred_on <= TODAY - timedelta(days=1)


def test_source_and_tier_follow_the_kind_of_row(plan):
    for s in plan.seats:
        for p in s.partners:
            assert (p.source, p.trust_tier) == BY_KIND[p.state], (s.seat_id, p.state)
        for r in s.referrals:
            assert (r.source, r.trust_tier) == REFERRAL_SOURCE, (s.seat_id, r.list_key)


def test_some_seats_have_no_suggestions_because_neither_source_exists(plan, conns):
    for s in plan.seats:
        zillow = state_of(conns, s.seat_id, "zillow") == "matched"
        loan = state_of(conns, s.seat_id, "loan_system") == "connected"
        if not zillow and not loan:
            assert not by_state(s, "suggested"), s.seat_id
    assert any(not by_state(s, "suggested") for s in plan.seats) and any(by_state(s, "suggested") for s in plan.seats)


def test_no_contact_detail_or_message_text_anywhere(plan):
    texts = [t for s in plan.seats for p in s.partners for t in (p.name, p.company, p.source)] + [t for s in plan.seats for r in s.referrals for t in (r.name, r.detail, r.source)]
    for t in texts:
        assert not re.search(r"@|https?:|www\.|\d{3}[-. )]\d{3,4}", t), t


# --- determinism, independence, dates ---------------------------------------------------------------------

def test_same_input_same_output_and_inputs_are_not_mutated(home, conns):
    h, c = copy.deepcopy(home), copy.deepcopy(conns)
    a = np_.build_network_plan(home, conns, AS_OF)
    assert a == np_.build_network_plan(home, conns, AS_OF)
    assert home == h and conns == c


def test_a_seat_does_not_depend_on_the_other_seats(plan):
    ids = [5, 6, 7]
    h = hp.build_home_plan(ids, AS_OF)
    sub = np_.build_network_plan(h, cp.build_connections_plan(h, pp.build_profile_plan(ids, AS_OF), AS_OF), AS_OF)
    assert sub.seats == [s for s in plan.seats if s.seat_id in ids]


def test_a_later_day_moves_only_the_dates_by_the_same_number_of_days(plan):
    later = datetime(2026, 11, 3, 12, 0)
    h = hp.build_home_plan(SEATS, later)
    other = np_.build_network_plan(h, cp.build_connections_plan(h, pp.build_profile_plan(SEATS, later), later), later)
    delta = timedelta(days=7)
    moved = 0
    for s, s2 in zip(plan.seats, other.seats, strict=True):
        assert [dataclasses.replace(p, reason_on=None) for p in s2.partners] == [dataclasses.replace(p, reason_on=None) for p in s.partners]
        assert [dataclasses.replace(r, occurred_on=TODAY) for r in s2.referrals] == [dataclasses.replace(r, occurred_on=TODAY) for r in s.referrals]
        for p, p2 in zip(s.partners, s2.partners, strict=True):
            if p.reason_on:
                assert p2.reason_on - p.reason_on == delta
                moved += 1
        for r, r2 in zip(s.referrals, s2.referrals, strict=True):
            assert r2.occurred_on - r.occurred_on == delta
            moved += 1
    assert moved


def test_a_date_and_a_datetime_for_the_same_day_agree(home, conns):
    assert np_.build_network_plan(home, conns, TODAY) == np_.build_network_plan(home, conns, AS_OF)


def test_a_seat_missing_from_the_connections_plan_stops_the_plan(home, conns):
    short = dataclasses.replace(conns, seats=[s for s in conns.seats if s.seat_id != 3])
    with pytest.raises(ValueError, match="seat 3"):
        np_.build_network_plan(home, short, AS_OF)


def test_no_person_who_works_on_the_project_is_named_in_the_module():
    assert not re.search(r"\b(Anandhu|Lovable|Claude)\b", Path(np_.__file__).read_text())


def test_a_zillow_reason_follows_the_newest_snapshots_review_count_not_an_older_one(home, conns):
    """Review counts forced low on the newest snapshot only (and high on the others): the reason may cite no more than the newest one has."""
    squeezed = dataclasses.replace(home, seats=[
        dataclasses.replace(s, snapshots=[*s.snapshots[:-1], dataclasses.replace(s.snapshots[-1], review_count=2)]) if len(s.snapshots) > 1 else
        dataclasses.replace(s, snapshots=[dataclasses.replace(s.snapshots[0], review_count=2)]) for s in home.seats])
    assert all(max(s.snapshots, key=lambda sn: sn.as_of).review_count == 2 for s in squeezed.seats)
    plan = np_.build_network_plan(squeezed, conns, AS_OF)
    cited = [p.reason_count for s in plan.seats for p in s.partners if p.reason_kind == "zillow"]
    assert cited and max(cited) <= 2


def test_over_many_seats_the_ranges_hold_dates_stay_in_range_and_no_seat_has_an_empty_page():
    ids = list(range(1, 301))
    h = hp.build_home_plan(ids, AS_OF)
    big = np_.build_network_plan(h, cp.build_connections_plan(h, pp.build_profile_plan(ids, AS_OF), AS_OF), AS_OF)
    low = TODAY - timedelta(days=120)
    for s in big.seats:
        assert s.partners or s.referrals, s.seat_id
        assert len(s.partners) <= 10 and len(by_state(s, "promoted")) <= 8
        names = [p.name for p in s.partners] + [r.name for r in s.referrals if r.list_key != "given"]  # a given referral names its partner on purpose
        assert len(set(names)) == len(names), s.seat_id
        for r in s.referrals:
            assert low <= r.occurred_on <= TODAY - timedelta(days=1), (s.seat_id, r)
        for p in by_state(s, "saved"):
            assert low <= p.reason_on <= TODAY - timedelta(days=1)


def test_a_name_already_used_in_the_seat_is_never_returned_again():
    used: set[str] = set()
    names = [np_._person(1, "same-key", used) for _ in range(30)]
    assert len(set(names)) == 30 and used == set(names)


def test_a_seat_the_rules_leave_with_no_row_gets_one_request_so_its_page_is_not_empty(home, conns, monkeypatch):
    zero = dict.fromkeys(("promoted", "request", "suggested", "saved", "received", "requested", "given"), (0, 0))
    for k in ("day1", "day7", "day24"):
        monkeypatch.setitem(np_.RANGES, k, zero)
    plan = np_.build_network_plan(home, conns, AS_OF)
    for s in plan.seats:
        assert len(s.partners) == 1 and not s.referrals, s.seat_id
        p = s.partners[0]
        assert (p.position, p.state, p.reason_kind, p.reason_count, p.reason_on) == (1, "request", "asked", None, None)
        assert (p.source, p.trust_tier) == BY_KIND["request"]
