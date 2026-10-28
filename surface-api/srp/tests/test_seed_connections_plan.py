"""The pure builder of the Connections mock rows (srp/connections-page-schema, task 3): `surfaces.srp.seat.seed_connections_plan`.

No database. It checks (a) the shape the table enforces, (b) determinism, independence from other seats and the date rule, and (c) -- the lesson of the earlier reviews -- that no
seeded row contradicts a rule the page applies or another page shows: Google Business Profile is connected for every seat and synced within the 7 days before the day, YouTube
and Search Console only with it, LinkedIn wherever the Profile cites LinkedIn, the connected social accounts equal the SRS Connections lane's "you" count (the Home plan is
aligned to it, keeping the gap to the rival text), a seat with a video has YouTube connected, and the Web analytics Indexing source follows Search Console. The expectations
below are written independently of the builder (their own parsers and tables).
"""
from __future__ import annotations

import copy
import dataclasses
import re
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from surfaces.srp.seat import seed_connections_plan as cp
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat import seed_web_plan as wp

AS_OF = datetime(2026, 10, 27, 12, 0)
NOW = datetime(2026, 10, 27, 9, 0)  # the day at 09:00, as the other plans
SEATS = list(range(1, 41))
PROVIDERS = ("google_business", "search_console", "youtube", "facebook", "instagram", "linkedin", "x", "zillow", "yelp", "website_cms", "loan_system")
SOCIAL = ("facebook", "instagram", "linkedin", "x")
STATES = ("connected", "available", "matched", "partial")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
BY_STATE = {"connected": ("From your sign-in", "owner_verified"), "matched": ("Matched by NORA", "platform_observed"),
            "partial": ("Matched by NORA", "platform_observed"), "available": ("Not connected", "self_declared")}
DDL = (Path(__file__).resolve().parents[1] / "db" / "local" / "connections_schema.sql").read_text()


@pytest.fixture(scope="module")
def home():
    return hp.build_home_plan(SEATS, AS_OF)


@pytest.fixture(scope="module")
def profile():
    return pp.build_profile_plan(SEATS, AS_OF)


@pytest.fixture(scope="module")
def plan(home, profile):
    return cp.build_connections_plan(home, profile, AS_OF)


@pytest.fixture(scope="module")
def web(home, profile):
    return wp.build_web_plan(home, profile, {s: s % 6 for s in SEATS})


def accounts(seat) -> dict:
    return {a.provider: a for a in seat.accounts}


def gap(home_seat, lane):
    return next(g for g in home_seat.gaps if g.lane == lane)


def n_of(text: str) -> int:
    """The leading number of a gap text ("3", "4 connected accounts")."""
    m = re.match(r"\d+", text)
    assert m, text
    return int(m.group())


# --- shape -----------------------------------------------------------------------------------------------

def test_every_seat_of_the_home_plan_has_the_eleven_accounts_in_the_pages_order(plan, home):
    assert [s.seat_id for s in plan.seats] == SEATS == [s.seat_id for s in home.seats]
    for s in plan.seats:
        assert [a.provider for a in s.accounts] == list(PROVIDERS)


def test_rows_have_the_shape_the_table_enforces(plan):
    for s in plan.seats:
        for a in s.accounts:
            assert a.state in STATES and a.trust_tier in TIERS
            assert (a.synced_at is None) == (a.state == "available"), (s.seat_id, a.provider)
            assert (a.source, a.trust_tier) == BY_STATE[a.state], (s.seat_id, a.provider)
            if a.state == "matched":
                assert a.provider in ("zillow", "yelp")
            if a.state == "partial":
                assert a.provider == "yelp", "the partial status line names Yelp's partner access"


def test_texts_fit_the_columns(plan):
    limit = int(re.search(r"source varchar\((\d+)\)", DDL).group(1))
    assert all(0 < len(a.source) <= limit for s in plan.seats for a in s.accounts)


def test_every_state_occurs_and_every_variable_account_varies(plan):
    assert {a.state for s in plan.seats for a in s.accounts} == set(STATES)
    for p in ("search_console", "youtube", "facebook", "instagram", "x", "zillow", "yelp", "website_cms", "loan_system"):
        assert len({accounts(s)[p].state == "connected" for s in plan.seats}) == 2 or p in ("zillow", "yelp"), p
    for p in ("zillow", "yelp"):
        assert {accounts(s)[p].state for s in plan.seats} >= {"matched", "available"}, p
    assert "partial" in {accounts(s)["yelp"].state for s in plan.seats}


# --- Google, LinkedIn, videos ----------------------------------------------------------------------------

def test_google_business_profile_is_connected_for_every_seat_synced_within_the_week(plan):
    for s in plan.seats:
        g = accounts(s)["google_business"]
        assert g.state == "connected"
        assert NOW - timedelta(days=7) < g.synced_at <= NOW, (s.seat_id, g.synced_at)


def test_every_connected_account_was_synced_within_the_week(plan):
    for s in plan.seats:
        for a in s.accounts:
            if a.state != "available":
                assert NOW - timedelta(days=7) < a.synced_at <= NOW, (s.seat_id, a.provider)


def test_youtube_and_search_console_are_connected_only_with_google(plan):
    for s in plan.seats:
        a = accounts(s)
        for p in ("youtube", "search_console"):
            assert a[p].state != "connected" or a["google_business"].state == "connected"


def test_linkedin_is_connected_wherever_the_profile_cites_it(plan, profile):
    cited = 0
    for s, prof in zip(plan.seats, profile.seats, strict=True):
        if any(f.source == "From LinkedIn" for f in prof.facts):
            cited += 1
            assert accounts(s)["linkedin"].state == "connected", s.seat_id
    assert cited >= 30, "the check is not vacuous"


def test_a_seat_with_a_video_has_youtube_connected(plan, home):
    seen = 0
    for s, h in zip(plan.seats, home.seats, strict=True):
        if gap(h, "videos").you_text != "No videos":
            seen += 1
            assert accounts(s)["youtube"].state == "connected", s.seat_id
    assert 5 <= seen < len(SEATS), "both kinds of seat exist"


# --- the SRS Connections lane ----------------------------------------------------------------------------

def test_the_connected_socials_equal_the_srs_connections_count_after_align_home(plan, home):
    aligned = cp.align_home(home, plan)
    for s, h in zip(plan.seats, aligned.seats, strict=True):
        socials = sum(accounts(s)[p].state == "connected" for p in SOCIAL)
        assert n_of(gap(h, "connections").you_text) == socials, s.seat_id


def test_the_count_is_the_old_count_but_at_least_one_and_the_gap_to_the_rival_is_kept(plan, home):
    aligned = cp.align_home(home, plan)
    changed = 0
    for h, h2 in zip(home.seats, aligned.seats, strict=True):
        old, new = gap(h, "connections"), gap(h2, "connections")
        assert n_of(new.you_text) == max(n_of(old.you_text), 1)
        assert n_of(new.rival_text) - n_of(new.you_text) == n_of(old.rival_text) - n_of(old.you_text)
        assert new.rival_text.endswith(" connected accounts") and (new.lane, new.action_label, new.action_target) == (old.lane, old.action_label, old.action_target)
        changed += old.you_text != new.you_text
    assert changed, "some seats said 0 before"


def test_align_home_changes_nothing_but_the_connections_gap_and_the_facebook_event(plan, home):
    aligned = cp.align_home(home, plan)
    for h, h2 in zip(home.seats, aligned.seats, strict=True):
        a = dataclasses.replace(h2, gaps=[g for g in h2.gaps if g.lane != "connections"])
        b = dataclasses.replace(h, gaps=[g for g in h.gaps if g.lane != "connections"], events=[e for e in h.events if e.kind != "facebook"] + [e for e in h2.events if e.kind == "facebook"])
        assert a == b
    assert aligned.reference == home.reference


def test_align_home_is_idempotent_and_does_not_mutate_its_input(plan, home):
    before = copy.deepcopy(home)
    once = cp.align_home(home, plan)
    assert home == before
    assert cp.align_home(once, plan) == once


def test_a_connections_gap_the_builder_cannot_read_stops_the_plan(home, profile):
    bad = dataclasses.replace(home, seats=[dataclasses.replace(s, gaps=[dataclasses.replace(g, you_text="none") if g.lane == "connections" else g for g in s.gaps])
                                           if s.seat_id == 3 else s for s in home.seats])
    with pytest.raises(ValueError, match="seat 3"):
        cp.build_connections_plan(bad, profile, AS_OF)


# --- the Web analytics Indexing source --------------------------------------------------------------------

def test_the_indexing_source_follows_search_console(plan, web):
    aligned = cp.align_web(web, plan)
    seen = set()
    for s, w in zip(plan.seats, aligned.seats, strict=True):
        idx = next(c for c in w.checks if c.key == "indexing")
        sc = accounts(s)["search_console"].state == "connected"
        seen.add(sc)
        assert (idx.source, idx.trust_tier) == (("From Google Search Console", "imported") if sc else ("From your site scan", "platform_observed")), s.seat_id
    assert seen == {True, False}


def test_align_web_changes_only_the_indexing_source_and_tier(plan, web):
    aligned = cp.align_web(web, plan)
    for w, w2 in zip(web.seats, aligned.seats, strict=True):
        assert (w2.seat_id, w2.lane_points) == (w.seat_id, w.lane_points)
        for c, c2 in zip(w.checks, w2.checks, strict=True):
            if c.key == "indexing":
                assert dataclasses.replace(c2, source=c.source, trust_tier=c.trust_tier) == c
            else:
                assert c2 == c


def test_align_web_is_idempotent_and_does_not_mutate_its_input(plan, web):
    before = copy.deepcopy(web)
    once = cp.align_web(web, plan)
    assert web == before
    assert cp.align_web(once, plan) == once


# --- determinism, independence, dates ---------------------------------------------------------------------

def test_same_input_same_output_and_inputs_are_not_mutated(home, profile):
    h, p = copy.deepcopy(home), copy.deepcopy(profile)
    a = cp.build_connections_plan(home, profile, AS_OF)
    assert a == cp.build_connections_plan(home, profile, AS_OF)
    assert home == h and profile == p


def test_a_seat_does_not_depend_on_the_other_seats(plan):
    ids = [5, 6, 7]
    sub = cp.build_connections_plan(hp.build_home_plan(ids, AS_OF), pp.build_profile_plan(ids, AS_OF), AS_OF)
    assert sub.seats == [s for s in plan.seats if s.seat_id in ids]


def test_a_later_day_moves_only_the_sync_times(plan, home, profile):
    later = datetime(2026, 11, 3, 12, 0)
    other = cp.build_connections_plan(hp.build_home_plan(SEATS, later), pp.build_profile_plan(SEATS, later), later)
    moved = 0
    for s, s2 in zip(plan.seats, other.seats, strict=True):
        for a, a2 in zip(s.accounts, s2.accounts, strict=True):
            assert dataclasses.replace(a2, synced_at=a.synced_at) == a, (s.seat_id, a.provider)
            moved += a.synced_at != a2.synced_at
    assert moved
    assert all(later - timedelta(days=7) < a.synced_at <= later.replace(hour=9) for s in other.seats for a in s.accounts if a.synced_at)


def test_a_date_and_a_datetime_for_the_same_day_agree(home, profile):
    d = AS_OF.date()
    assert cp.build_connections_plan(home, profile, d) == cp.build_connections_plan(home, profile, AS_OF)


def test_no_person_is_named_in_the_module():
    text = (Path(cp.__file__)).read_text()
    assert not re.search(r"\b(Anandhu|Lovable|Claude)\b", text)


def test_a_facebook_connection_event_exists_only_for_a_seat_whose_facebook_is_connected(plan, home):
    """The Home event "Your Facebook connection expires Friday" cannot be about an account the Connections page shows as not connected (second review, finding 1)."""
    aligned = cp.align_home(home, plan)
    kept = dropped = 0
    for s, h, h2 in zip(plan.seats, home.seats, aligned.seats, strict=True):
        before = [e for e in h.events if e.kind == "facebook"]
        after = [e for e in h2.events if e.kind == "facebook"]
        connected = accounts(s)["facebook"].state == "connected"
        assert after == (before if connected else []), s.seat_id
        assert [e for e in h2.events if e.kind != "facebook"] == [e for e in h.events if e.kind != "facebook"], s.seat_id
        kept += bool(after)
        dropped += bool(before) and not after
    assert kept and dropped, "both outcomes occur, so the check is not vacuous"
