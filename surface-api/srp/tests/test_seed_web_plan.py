"""The pure builder of the Web analytics mock rows (srp/web-analytics-page-schema, task 3): `surfaces.srp.seat.seed_web_plan`.

No database. It checks (a) the shape the table enforces, (b) determinism and independence from other seats, and (c) -- the lesson of the earlier reviews -- that no seeded row
contradicts a rule the page applies or another page shows: the four scored checks add up to the seat's SRS v5 website lane, `nap` follows the Profile, markup agrees with the
SRS gap text and Home's move text, speed follows the web-vitals thresholds, AI readiness counts its signals, content follows the published articles, a failing service-pages
result names only the seat's own products. The expectations below are written independently of the builder (their own parsers and thresholds).
"""
from __future__ import annotations

import dataclasses
import re
from datetime import datetime
from pathlib import Path

import pytest

from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat import seed_web_plan as wp

AS_OF = datetime(2026, 10, 27, 12, 0)
SEATS = list(range(1, 41))  # the seeded seat set; a seat whose lane cannot be split (e.g. a full lane without an address, as seat 50 of a 60-seat set) stops the plan, see below
KEYS = ("entity_markup", "nap", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion", "reviews_on_site", "security")
SCORED = {"entity_markup": 42, "nap": 30, "indexing": 20, "service_pages": 10}
HEADLINED = ("speed", "ai_readiness")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")


def published_of(seat: int) -> int:
    return seat % 6  # 0 to 5 published articles, so every content state occurs


@pytest.fixture(scope="module")
def home():
    return hp.build_home_plan(SEATS, AS_OF)


@pytest.fixture(scope="module")
def profile():
    return pp.build_profile_plan(SEATS, AS_OF)


@pytest.fixture(scope="module")
def plan(home, profile):
    return wp.build_web_plan(home, profile, {s: published_of(s) for s in SEATS})


def wpn_plan(home, profile, urls=None):
    return wp.build_web_plan(home, profile, {s: published_of(s) for s in SEATS}, urls)


def lane_of(home, seat_id):
    s = next(x for x in home.seats if x.seat_id == seat_id)
    return s.snapshots[-1].lanes["website"]


def checks(seat):
    return {c.key: c for c in seat.checks}


def profile_of(profile, seat_id):
    return next(s for s in profile.seats if s.seat_id == seat_id)


def has(profile, seat_id, field):
    return field in {f.field for f in profile_of(profile, seat_id).facts}


# --- the vocabulary and the shapes ---------------------------------------------------------------------------------

def test_the_vocabulary_matches_the_table():
    assert wp.KEYS == KEYS and wp.SCORED == SCORED and wp.HEADLINED == HEADLINED
    assert sum(SCORED.values()) == 102
    assert {t for _, t in wp.SOURCES.values()} <= set(TIERS)


def test_every_seat_of_the_home_plan_has_ten_checks_in_order(plan, home):
    assert [s.seat_id for s in plan.seats] == [s.seat_id for s in home.seats]
    for seat in plan.seats:
        assert [c.key for c in seat.checks] == list(KEYS), seat.seat_id


def test_scored_checks_have_points_and_the_others_do_not_and_the_state_follows_the_points(plan):
    for seat in plan.seats:
        for c in seat.checks:
            assert c.state in ("fail", "warn", "pass") and c.result.strip(), (seat.seat_id, c.key)
            if c.key in SCORED:
                assert c.points_max == SCORED[c.key] and 0 <= c.points <= c.points_max, (seat.seat_id, c.key)
                assert c.state == ("pass" if c.points == c.points_max else "fail" if c.points == 0 else "warn"), (seat.seat_id, c.key)
            else:
                assert c.points is None and c.points_max is None, (seat.seat_id, c.key)
            assert (c.headline is not None) == (c.key in HEADLINED), (seat.seat_id, c.key)


def test_source_and_tier_agree_for_every_check(plan):
    for seat in plan.seats:
        for c in seat.checks:
            assert c.trust_tier in TIERS and (c.source, c.trust_tier) == wp.SOURCES[c.key], (seat.seat_id, c.key)


def test_the_source_labels_and_tiers_are_the_specs_mapping(plan):
    scan = ("From your site scan", "platform_observed")
    want = {"indexing": ("From Google Search Console", "imported"), "speed": ("From PageSpeed", "imported")}
    for seat in plan.seats:
        for c in seat.checks:
            assert (c.source, c.trust_tier) == want.get(c.key, scan), (seat.seat_id, c.key)


# --- the four scored checks add up to the SRS v5 website lane -------------------------------------------------------------

def test_the_scored_points_add_up_to_the_seats_website_lane_and_the_maxima_to_102(plan, home):
    for seat in plan.seats:
        c = checks(seat)
        assert sum(c[k].points for k in SCORED) == lane_of(home, seat.seat_id) == seat.lane_points, seat.seat_id
        assert sum(c[k].points_max for k in SCORED) == 102


def test_the_lane_is_the_plans_own_maximum(home):
    assert next(l.max_points for l in home.reference.lanes if l.key == "website") == 102


def test_nap_is_ten_points_for_each_of_name_address_and_phone_in_the_profile(plan, profile):
    seen = set()
    for seat in plan.seats:
        p = profile_of(profile, seat.seat_id)
        present = 1 + int("address" in {f.field for f in p.facts}) + int(bool(p.columns.phone_number))
        c = checks(seat)["nap"]
        assert c.points == 10 * present, seat.seat_id
        assert c.state == ("pass" if present == 3 else "warn"), seat.seat_id
        seen.add(present)
    assert seen == {2, 3}, "the seeded seats include some with and some without an address"


def test_the_nap_result_names_what_the_profile_lacks_and_nothing_else(plan, profile):
    for seat in plan.seats:
        p = profile_of(profile, seat.seat_id)
        missing = [w for w, ok in (("address", "address" in {f.field for f in p.facts}), ("phone", bool(p.columns.phone_number))) if not ok]
        r = checks(seat)["nap"].result
        if not missing:
            assert r == "Matches the profile", seat.seat_id
        else:
            assert r == f"{' and '.join(m.capitalize() if i == 0 else m for i, m in enumerate(missing))} missing from your profile", (seat.seat_id, r)


# --- markup agrees with the other pages ----------------------------------------------------------------------------------

def test_markup_is_none_partial_or_full_and_full_only_when_everything_else_in_the_lane_is_full(plan, home):
    """Markup is complete only when the lane leaves it no choice: the rest of the lane after nap is the 72 the other three checks can hold at most."""
    kinds = set()
    for seat in plan.seats:
        m = checks(seat)["entity_markup"]
        rest = lane_of(home, seat.seat_id) - checks(seat)["nap"].points
        assert (m.points == 42) == (rest == 72), seat.seat_id
        assert (m.points == 42) == (lane_of(home, seat.seat_id) == 102), "on the seeded data that is the whole lane being full"
        kinds.add("none" if m.points == 0 else "full" if m.points == 42 else "partial")
    assert kinds == {"none", "partial", "full"}


def test_the_markup_result_follows_its_state(plan):
    want = {"fail": "No structured data on the page", "warn": "Structured data is incomplete", "pass": "Complete structured data on the page"}
    for seat in plan.seats:
        m = checks(seat)["entity_markup"]
        assert m.result == want[m.state], seat.seat_id


def test_a_markup_split_exists_for_every_seat_and_the_rest_of_the_lane_fits_indexing_and_service_pages(plan):
    for seat in plan.seats:
        c = checks(seat)
        rest = seat.lane_points - c["nap"].points - c["entity_markup"].points
        assert rest == c["indexing"].points + c["service_pages"].points and 0 <= rest <= 30, seat.seat_id


# --- indexing and service pages ---------------------------------------------------------------------------------------------

def test_the_indexing_result_follows_its_state(plan):
    want = {"fail": "Not indexed", "warn": "Indexed; no sitemap", "pass": "Indexed with a sitemap"}
    for seat in plan.seats:
        c = checks(seat)["indexing"]
        assert c.result == want[c.state], seat.seat_id


def test_a_failing_service_pages_result_names_only_products_the_seat_has(plan, profile):
    named_some = False
    for seat in plan.seats:
        p = profile_of(profile, seat.seat_id)
        products = next((f.value for f in p.facts if f.field == "products"), None) or []
        c = checks(seat)["service_pages"]
        for product in pp.PRODUCTS:
            if product in c.result:
                assert product in products, (seat.seat_id, c.result)
        if c.state == "fail":
            if products:
                assert c.result == "No pages for " + " or ".join(products[:2]) + " loans", (seat.seat_id, c.result)
                named_some = True
            else:
                assert c.result == "No service pages", (seat.seat_id, c.result)
    assert named_some


def test_loan_product_wording_is_used_only_when_the_seat_has_products(plan, profile):
    for seat in plan.seats:
        p = profile_of(profile, seat.seat_id)
        has_products = "products" in {f.field for f in p.facts}
        c = checks(seat)["service_pages"]
        if c.state == "warn":
            assert c.result == ("Service pages for some of your loan products" if has_products else "Some service pages found"), seat.seat_id
        if c.state == "pass":
            assert c.result == ("Pages for each loan product" if has_products else "Service pages found"), seat.seat_id


# --- speed: the state is the worst of the three web vitals --------------------------------------------------------------------

def rate(value, good, poor):
    return "good" if value <= good else "needs" if value <= poor else "poor"


def test_the_speed_state_is_the_worst_of_lcp_inp_and_cls_by_the_web_vitals_thresholds(plan):
    seen = set()
    for seat in plan.seats:
        c = checks(seat)["speed"]
        m = re.fullmatch(r"LCP (\d\.\d) s(?: \([a-z ]+\))?, INP (\d+) ms(?: \([a-z ]+\))?, CLS (\d\.\d\d)(?: \([a-z ]+\))?", c.result)
        assert m, (seat.seat_id, c.result)
        lcp, inp, cls = float(m[1]), int(m[2]), float(m[3])
        ratings = [rate(lcp, 2.5, 4.0), rate(inp, 200, 500), rate(cls, 0.10, 0.25)]
        want = "fail" if "poor" in ratings else "warn" if "needs" in ratings else "pass"
        assert c.state == want, (seat.seat_id, c.result)
        worst = max(range(3), key=lambda i: ({"good": 0, "needs": 1, "poor": 2}[ratings[i]], -i))
        assert c.headline == (f"LCP {m[1]} s", f"INP {m[2]} ms", f"CLS {m[3]}")[worst], (seat.seat_id, c.result, c.headline)
        seen.add(c.state)
    assert seen == {"pass", "warn", "fail"}


def test_the_speed_rule_holds_over_thousands_of_seats_not_just_the_seeded_ones():
    """The numbers are drawn at random inside each rating's band; a band that leaks into the next one would only show on some seats."""
    for seat in range(1, 4001):
        c = wp._speed(seat)
        m = re.fullmatch(r"LCP (\d\.\d) s(?: \([a-z ]+\))?, INP (\d+) ms(?: \([a-z ]+\))?, CLS (\d\.\d\d)(?: \([a-z ]+\))?", c.result)
        ratings = [rate(float(m[1]), 2.5, 4.0), rate(int(m[2]), 200, 500), rate(float(m[3]), 0.10, 0.25)]
        assert c.state == ("fail" if "poor" in ratings else "warn" if "needs" in ratings else "pass"), (seat, c.result)


def test_the_speed_annotations_name_the_metrics_that_are_not_good(plan):
    for seat in plan.seats:
        c = checks(seat)["speed"]
        m = re.fullmatch(r"LCP (\S+) s( \([a-z ]+\))?, INP (\d+) ms( \([a-z ]+\))?, CLS (\S+)( \([a-z ]+\))?", c.result)
        parts = [(float(m[1]), m[2], 2.5, 4.0), (int(m[3]), m[4], 200, 500), (float(m[5]), m[6], 0.10, 0.25)]
        for value, note, good, poor in parts:
            expected = None if value <= good else " (needs work)" if value <= poor else " (poor)"
            assert note == expected, (seat.seat_id, c.result)


# --- AI readiness: five signals -----------------------------------------------------------------------------------------------

POSITIVE = ("GPTBot allowed in robots.txt", "llms.txt present", "FAQ present", "content in the page HTML", "clear title and description tags")
NEGATIVE = ("GPTBot blocked in robots.txt", "no llms.txt", "no FAQ", "content built by scripts", "missing title or description tags")


def test_ai_readiness_names_all_five_signals_and_its_headline_counts_the_present_ones(plan):
    ks = set()
    for seat in plan.seats:
        c = checks(seat)["ai_readiness"]
        parts = c.result.split("; ")
        assert len(parts) == 5, (seat.seat_id, c.result)
        k = 0
        for part, pos, neg in zip(parts, POSITIVE, NEGATIVE, strict=True):
            assert part in (pos, neg), (seat.seat_id, part)
            k += part == pos
        assert c.headline == f"{k} of 5", seat.seat_id
        assert c.state == ("pass" if k == 5 else "warn" if k >= 2 else "fail"), (seat.seat_id, k)
        ks.add(k)
    assert {0, 1, 2, 3, 4, 5} & ks and len({"pass", "warn", "fail"} & {checks(s)["ai_readiness"].state for s in plan.seats}) == 3


# --- content follows the published articles Home shows ------------------------------------------------------------------------

def test_the_content_check_follows_the_published_articles(plan):
    for seat in plan.seats:
        n = published_of(seat.seat_id)
        c = checks(seat)["content"]
        if n == 0:
            assert (c.state, c.result) == ("fail", "No blog"), seat.seat_id
        else:
            assert c.result == f"Blog with {n} post{'' if n == 1 else 's'}", seat.seat_id
            assert c.state == ("warn" if n < 3 else "pass"), seat.seat_id


# --- the other results agree with their state -----------------------------------------------------------------------------------

RESULTS = {
    "conversion": {"pass": {"Click-to-call and a booking link"}, "warn": {"Click-to-call yes; no booking link", "Booking link yes; no click-to-call"},
                   "fail": {"No click-to-call and no booking link"}},
    "reviews_on_site": {"pass": {"Reviews widget installed"}, "fail": {"Widget not installed"}, "warn": set()},
    "security": {"pass": {"HTTPS"}, "fail": {"No HTTPS (the page is served over HTTP)"}, "warn": set()},
}


def test_security_follows_the_sites_address_when_it_is_known(home, profile):
    """A site served over https cannot fail Security with "served over HTTP", and one served over http cannot pass (second review, finding 1)."""
    urls = {s: ("http://example.test/seat-%d" if s % 2 else "https://example.test/seat-%d") % s for s in SEATS}
    web = wpn_plan(home, profile, urls)
    for seat in web.seats:
        c = checks(seat)["security"]
        want = ("fail", "No HTTPS (the page is served over HTTP)") if urls[seat.seat_id].startswith("http://") else ("pass", "HTTPS")
        assert (c.state, c.result) == want, seat.seat_id
    assert {checks(s)["security"].state for s in web.seats} == {"pass", "fail"}


def test_security_is_case_and_space_tolerant_about_the_scheme(home, profile):
    web = wpn_plan(home, profile, {s: "  HTTP://Example.test/x  " if s == 1 else "HTTPS://Example.test/x" for s in SEATS})
    assert checks(web.seats[0])["security"].state == "fail" and checks(web.seats[1])["security"].state == "pass"


@pytest.mark.parametrize("key", list(RESULTS))
def test_results_agree_with_their_state_and_every_allowed_state_occurs(plan, key):
    seen = set()
    for seat in plan.seats:
        c = checks(seat)[key]
        assert c.result in RESULTS[key][c.state], (seat.seat_id, key, c.state, c.result)
        seen.add(c.state)
    assert seen == {s for s, texts in RESULTS[key].items() if texts}


def test_every_state_occurs_for_the_checks_that_can_vary(plan):
    for key in ("entity_markup", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion"):
        assert {checks(s)[key].state for s in plan.seats} >= {"warn", "fail"} or key == "entity_markup", key


# --- determinism and independence ------------------------------------------------------------------------------------------------

def test_same_input_same_output(home, profile):
    pub = {s: published_of(s) for s in SEATS}
    assert wp.build_web_plan(home, profile, pub) == wp.build_web_plan(home, profile, pub)


def test_a_seat_does_not_depend_on_the_other_seats_or_their_order(plan):
    ids = [17, 5, 33]
    h = hp.build_home_plan(ids, AS_OF)
    p = pp.build_profile_plan(ids, AS_OF)
    only = wp.build_web_plan(h, p, {s: published_of(s) for s in ids})
    by = {s.seat_id: s for s in plan.seats}
    assert [s.seat_id for s in only.seats] == [5, 17, 33]
    for s in only.seats:
        assert s == by[s.seat_id]


def test_a_later_date_changes_no_row(plan):
    later = datetime(2026, 11, 3, 12, 0)
    h, p = hp.build_home_plan(SEATS, later), pp.build_profile_plan(SEATS, later)
    assert wp.build_web_plan(h, p, {s: published_of(s) for s in SEATS}) == plan


def test_the_plan_does_not_change_what_it_reads(home, profile):
    before = (dataclasses.asdict(home), dataclasses.asdict(profile))
    wp.build_web_plan(home, profile, {s: published_of(s) for s in SEATS})
    assert (dataclasses.asdict(home), dataclasses.asdict(profile)) == before


def test_a_lane_that_cannot_be_split_stops_the_plan_with_a_plain_message(home, profile):
    """nap is 20 for a seat with no address, so the rest of the lane is at most 72: a lane of 100 cannot be split."""
    no_address = next(s.seat_id for s in profile.seats if "address" not in {f.field for f in s.facts})
    seats = []
    for s in home.seats:
        if s.seat_id == no_address:
            last = dataclasses.replace(s.snapshots[-1], lanes={**s.snapshots[-1].lanes, "website": 100})
            s = dataclasses.replace(s, snapshots=[*s.snapshots[:-1], last])
        seats.append(s)
    with pytest.raises(ValueError, match=f"seat {no_address}.*cannot be split"):
        wp.build_web_plan(dataclasses.replace(home, seats=seats), profile, {s: published_of(s) for s in SEATS})


def test_a_lane_below_nap_stops_the_plan_too(home, profile):
    with_address = next(s.seat_id for s in profile.seats if "address" in {f.field for f in s.facts})
    seats = []
    for s in home.seats:
        if s.seat_id == with_address:
            last = dataclasses.replace(s.snapshots[-1], lanes={**s.snapshots[-1].lanes, "website": 12})
            s = dataclasses.replace(s, snapshots=[*s.snapshots[:-1], last])
        seats.append(s)
    with pytest.raises(ValueError, match=f"seat {with_address}.*cannot be split"):
        wp.build_web_plan(dataclasses.replace(home, seats=seats), profile, {s: published_of(s) for s in SEATS})


# --- align_home: the SRS gap text and Home's move text follow the markup state ---------------------------------------------------

def markup_kind(plan_seat):
    p = checks(plan_seat)["entity_markup"].points
    return "none" if p == 0 else "full" if p == 42 else "partial"


GAP = {"none": "No markup", "partial": "Partial markup", "full": "Full markup"}
MOVE = {"none": "Markup is missing on your site", "partial": "Markup is incomplete on your site", "full": "Your markup is complete"}


def test_after_align_home_the_srs_gap_text_and_the_home_move_text_follow_the_markup_state(home, plan):
    aligned = wp.align_home(home, plan)
    by_web = {s.seat_id: s for s in plan.seats}
    for s in aligned.seats:
        kind = markup_kind(by_web[s.seat_id])
        gap = next(g for g in s.gaps if g.lane == "website")
        move = next(m for m in s.moves if m.target == "website")
        assert gap.you_text == GAP[kind] and gap.rival_text == "full markup", s.seat_id
        assert move.subtitle == MOVE[kind], s.seat_id


def test_align_home_changes_nothing_else(home, plan):
    aligned = wp.align_home(home, plan)
    for old, new in zip(home.seats, aligned.seats, strict=True):
        assert [g for g in old.gaps if g.lane != "website"] == [g for g in new.gaps if g.lane != "website"], old.seat_id
        assert [m for m in old.moves if m.target != "website"] == [m for m in new.moves if m.target != "website"], old.seat_id
        og = next(g for g in old.gaps if g.lane == "website")
        ng = next(g for g in new.gaps if g.lane == "website")
        assert dataclasses.replace(ng, you_text=og.you_text) == og
        om = next(m for m in old.moves if m.target == "website")
        nm = next(m for m in new.moves if m.target == "website")
        assert dataclasses.replace(nm, subtitle=om.subtitle, points=om.points) == om
        assert dataclasses.replace(new, gaps=old.gaps, moves=old.moves, brief=old.brief) == old
    assert aligned.reference == home.reference


def markup_open(plan_seat):
    c = checks(plan_seat)["entity_markup"]
    return c.points_max - c.points


def test_the_website_move_and_the_briefs_next_move_are_worth_what_markup_has_open(home, plan):
    """The move's subtitle names markup, so its points are the markup's open points (second review, finding 3); Home's brief says the same."""
    aligned = wp.align_home(home, plan)
    by_web = {s.seat_id: s for s in plan.seats}
    for s in aligned.seats:
        open_ = markup_open(by_web[s.seat_id])
        assert next(m for m in s.moves if m.target == "website").points == open_, s.seat_id
        assert s.brief.next_move_points == max(1, open_) and s.brief.next_move_label == "Fix my website" and s.brief.next_move_target == "website", s.seat_id


def test_the_weekly_briefs_website_item_follows_the_markup_state(home, plan):
    """"Website markup fixed" done this week cannot sit beside "No structured data on the page" (second review, finding 2)."""
    aligned = wp.align_home(home, plan)
    by_web = {s.seat_id: s for s in plan.seats}
    seen = set()
    for old, new in zip(home.seats, aligned.seats, strict=True):
        kind = markup_kind(by_web[old.seat_id])
        had = any(i.label == "Website markup fixed" for i in old.brief.items)
        labels = [i.label for i in new.brief.items]
        assert sum(i.points for i in new.brief.items) == sum(i.points for i in old.brief.items), old.seat_id
        assert [i.position for i in new.brief.items] == list(range(1, len(new.brief.items) + 1)), old.seat_id
        if not had:
            assert new.brief.items == old.brief.items, old.seat_id
            continue
        seen.add(kind)
        if kind == "none":
            assert "Website markup fixed" not in labels and "Website markup improved" not in labels and len(labels) == len(old.brief.items) - 1, old.seat_id
        elif kind == "partial":
            assert "Website markup improved" in labels and "Website markup fixed" not in labels and len(labels) == len(old.brief.items), old.seat_id
        else:
            assert "Website markup fixed" in labels and len(labels) == len(old.brief.items), old.seat_id
        others_old = [i.label for i in old.brief.items if i.label != "Website markup fixed"]
        assert [x for x in labels if x not in ("Website markup fixed", "Website markup improved")] == others_old, old.seat_id
    assert seen >= {"none", "partial"}


def test_align_home_does_not_mutate_the_plan_it_reads(home, plan):
    before = dataclasses.asdict(home)
    wp.align_home(home, plan)
    assert dataclasses.asdict(home) == before


def test_align_home_keeps_the_old_text_where_it_already_agrees(home, plan):
    """The Home plan said 'No markup' or 'Partial markup' by a coin; only the seats whose lane makes that impossible change."""
    aligned = wp.align_home(home, plan)
    same = changed = 0
    for old, new in zip(home.seats, aligned.seats, strict=True):
        og = next(g for g in old.gaps if g.lane == "website").you_text
        ng = next(g for g in new.gaps if g.lane == "website").you_text
        same += og == ng
        changed += og != ng
    assert same > changed > 0


def test_align_home_refuses_a_seat_the_web_plan_does_not_have(home, plan):
    short = dataclasses.replace(plan, seats=plan.seats[:-1])
    with pytest.raises(KeyError):
        wp.align_home(home, short)


def test_the_markup_state_function_is_the_one_the_texts_use():
    assert [wp.markup_state(p) for p in (0, 1, 41, 42)] == ["none", "partial", "partial", "full"]
    assert wp.GAP_TEXT == GAP and wp.MOVE_TEXT == MOVE


# --- no person is named; the texts fit their columns ----------------------------------------------------------------------------------

def _varchar_limits() -> dict[str, int]:
    sql = (Path(__file__).resolve().parents[1] / "db" / "local" / "web_analytics_schema.sql").read_text()
    return {c: int(n) for c, n in re.findall(r"^\s+(\w+) varchar\((\d+)\)", sql, flags=re.MULTILINE)}


def test_every_text_value_fits_its_column(plan):
    limits = _varchar_limits()
    assert limits["result"] == 240 and limits["headline"] == 40 and limits["source"] == 60 and limits["check_key"] == 20 and limits["state"] == 4
    for seat in plan.seats:
        for c in seat.checks:
            assert len(c.result) <= limits["result"] and len(c.source) <= limits["source"] and len(c.key) <= limits["check_key"] and len(c.state) <= limits["state"], (seat.seat_id, c.key)
            assert c.headline is None or len(c.headline) <= limits["headline"]


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
    src = Path(wp.__file__).read_text()
    for name in ("Maria", "Kevin", "James", "Anitha", "Whitfield", "Harper", "Finley", "Reese"):
        assert name not in src, name
