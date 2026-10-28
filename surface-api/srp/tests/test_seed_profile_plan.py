"""The pure builder of the Profile mock rows (srp/profile-page-schema, task 3): `surfaces.srp.seat.seed_profile_plan`.

No database. It checks (a) the shape the tables enforce, (b) determinism, and (c) -- the lesson of the SRS review -- that no seeded fact contradicts a rule the
page applies: a fact the page counts as present has its row, a thin bio is under the thin limit, the source label, tier and date agree, the address, the
licensed states and the service areas agree with the seat's market, and the graph adds up.
"""
from __future__ import annotations

import dataclasses
import random
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp

AS_OF = datetime(2026, 10, 27, 12, 0)
SEATS = list(range(1, 41))
EXISTING = ("name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email")
OWN = ("address", "hours", "nmls", "licensed_in", "products", "service_areas", "designations", "awards", "education", "company")
FIELDS = EXISTING + OWN
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
GROUPS = ("identity", "contact", "licence", "products", "reviews", "presence")
PRODUCTS = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "Rate-and-term", "Cash-out", "HELOC", "Pre-approval"]
STATE = {"Davenport": ("IA", "Iowa"), "Bettendorf": ("IA", "Iowa"), "Rock Island": ("IL", "Illinois"), "Moline": ("IL", "Illinois")}


@pytest.fixture(scope="module")
def plan():
    return pp.build_profile_plan(SEATS, AS_OF)


def city_of(zipcode: str) -> str:
    return hp.CITIES[int(zipcode) % len(hp.CITIES)]


def facts(seat) -> dict:
    return {f.field: f for f in seat.facts}


# --- the vocabulary and the shapes ---------------------------------------------------------------------------------

def test_the_vocabulary_is_the_eighteen_facts_the_ten_own_ones_and_the_five_tiers():
    assert pp.EXISTING_FIELDS == EXISTING and pp.OWN_FIELDS == OWN
    assert pp.TIERS == TIERS and pp.GROUP_KEYS == GROUPS and pp.PRODUCTS == PRODUCTS
    assert pp.THIN_BIO == 60


def test_every_seat_has_facts_and_six_groups_in_order(plan):
    assert [s.seat_id for s in plan.seats] == SEATS
    for seat in plan.seats:
        assert [g.key for g in seat.groups] == list(GROUPS), seat.seat_id
        assert len({f.field for f in seat.facts}) == len(seat.facts), "one row per field"
        assert all(f.field in FIELDS for f in seat.facts), seat.seat_id


def test_a_value_is_stored_exactly_for_the_ten_own_fields(plan):
    for seat in plan.seats:
        for f in seat.facts:
            assert (f.value is None) == (f.field in EXISTING), (seat.seat_id, f.field)


def test_values_are_non_blank_strings_or_a_non_empty_list_of_strings(plan):
    for seat in plan.seats:
        for f in seat.facts:
            if f.value is None:
                continue
            if f.field == "products":
                assert isinstance(f.value, list) and f.value and all(isinstance(x, str) and x.strip() for x in f.value), seat.seat_id
            else:
                assert isinstance(f.value, str) and f.value.strip(), (seat.seat_id, f.field)


def test_every_source_and_tier_is_valid_and_agrees(plan):
    for seat in plan.seats:
        for f in seat.facts:
            assert f.source.strip() and f.trust_tier in TIERS, (seat.seat_id, f)
            assert f.trust_tier == pp.tier_of(f.source), (seat.seat_id, f.field, f.source, f.trust_tier)


def test_the_label_to_tier_mapping():
    assert [pp.tier_of(s) for s in ("From LinkedIn", "From Google", "From NMLS", "Confirmed by you", "Approved by you", "Added by you")] == [
        "imported", "imported", "authority_verified", "owner_verified", "owner_verified", "self_declared"]
    with pytest.raises(KeyError):
        pp.tier_of("From a friend")


def test_a_date_goes_with_the_labels_that_have_one_and_only_those(plan):
    for seat in plan.seats:
        for f in seat.facts:
            dated = f.source.startswith(("Confirmed", "Approved", "Added"))  # written independently of DATED_SOURCES
            assert (f.confirmed_at is not None) == dated, (seat.seat_id, f.field, f.source)
            if f.confirmed_at:
                assert AS_OF - timedelta(days=365) <= f.confirmed_at <= AS_OF, (seat.seat_id, f.field)


# --- determinism ------------------------------------------------------------------------------------------------------

def test_the_same_input_gives_the_same_plan(plan):
    assert pp.build_profile_plan(SEATS, AS_OF) == plan


def test_seat_order_and_duplicates_do_not_matter(plan):
    shuffled = SEATS * 2
    random.Random(5).shuffle(shuffled)
    assert pp.build_profile_plan(shuffled, AS_OF) == plan


def test_a_seat_keeps_its_rows_when_other_seats_come_and_go(plan):
    small = pp.build_profile_plan([5, 17], AS_OF)
    by_id = {s.seat_id: s for s in plan.seats}
    assert small.seats == [by_id[5], by_id[17]]


def test_a_later_date_moves_dates_and_nothing_else(plan):
    shift = timedelta(days=3)
    later = pp.build_profile_plan(SEATS, AS_OF + shift)

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
    assert pp.build_profile_plan([3, 4], datetime(2026, 10, 27, 0, 5)) == pp.build_profile_plan([3, 4], date(2026, 10, 27))
    assert pp.build_profile_plan([3, 4], datetime(2026, 10, 27, 23, 55)) == pp.build_profile_plan([3, 4], date(2026, 10, 27))


# --- variety: the page's every state shows up ------------------------------------------------------------------------

def test_the_seats_cover_every_state_the_page_can_be_in(plan):
    thin = [s for s in plan.seats if s.columns.description and len(s.columns.description.strip()) < pp.THIN_BIO]
    none = [s for s in plan.seats if s.columns.description is None]
    full = [s for s in plan.seats if s.columns.description and len(s.columns.description.strip()) >= pp.THIN_BIO]
    assert thin and none and full, "thin, missing and full bios all exist"
    assert any(s.columns.mobile_number is None for s in plan.seats) and any(s.columns.mobile_number for s in plan.seats)
    for field in OWN:
        have = [field in facts(s) for s in plan.seats]
        assert any(have) and (field in ("company", "nmls") or not all(have)), field + " is missing for some seats and present for some"
    credentials = {sum(f in facts(s) for f in ("designations", "awards", "education")) for s in plan.seats}
    assert credentials == {0, 1, 2, 3}


def test_a_thin_bio_is_always_under_the_limit_and_a_full_one_never_is(plan):
    assert all(len(t) < pp.THIN_BIO for t in pp._THIN)
    for seat in plan.seats:
        d = seat.columns.description
        if d is None:
            continue
        assert (d in pp._THIN) == (len(d) < pp.THIN_BIO), (seat.seat_id, d)
        assert d in pp._THIN or d.startswith("Helps "), (seat.seat_id, d)


def test_the_bio_limits_are_exact_for_the_seats_that_have_one(plan):
    for seat in plan.seats:
        d = seat.columns.description
        if d is not None:
            assert d == d.strip() and d, seat.seat_id


# --- no seeded fact contradicts a rule the page applies --------------------------------------------------------------

def test_a_fact_row_exists_for_an_existing_table_field_exactly_when_its_column_is_present(plan):
    for seat in plan.seats:
        c, f = seat.columns, facts(seat)
        present = {
            "name": True, "email": True, "year_started": True,
            "title": bool(c.title and c.title.strip()), "photo": bool(c.profile_photo and c.profile_photo.strip()),
            "bio": bool(c.description and c.description.strip()), "office_phone": bool(c.phone_number and c.phone_number.strip()),
            "mobile_phone": bool(c.mobile_number and c.mobile_number.strip()),
        }
        assert {k for k in EXISTING if k in f} == {k for k, v in present.items() if v}, seat.seat_id


def test_the_corrected_columns_are_plain_and_not_the_legacy_junk(plan):
    for seat in plan.seats:
        c = seat.columns
        assert c.title and "Mock tier agents" not in c.title
        for text in (c.description, c.title):
            assert text is None or ("Mock description" not in text and "Synthetic" not in text)
        for phone in (c.phone_number, c.mobile_number):
            assert phone is None or re.fullmatch(r"\+1\d{10}", phone), (seat.seat_id, phone)
        assert c.profile_photo is None, "the Home seed keeps every photo null (initials); the Profile seed does too"


def test_the_products_are_known_unique_and_in_the_pages_order(plan):
    for seat in plan.seats:
        value = facts(seat).get("products")
        if value is None:
            continue
        assert set(value.value) <= set(PRODUCTS) and len(set(value.value)) == len(value.value), seat.seat_id
        assert value.value == [p for p in PRODUCTS if p in value.value], seat.seat_id
        assert 4 <= len(value.value) <= 9, seat.seat_id


def test_the_address_the_licensed_states_and_the_service_areas_agree_with_the_seats_market(plan):
    markets = {s.seat_id: "52801" for s in plan.seats}
    for seat in plan.seats:
        city = city_of(markets[seat.seat_id])
        abbr, name = STATE[city]
        f = facts(seat)
        if "address" in f:
            assert re.fullmatch(rf"\d{{2,4}} Main St, {city}, {abbr} {markets[seat.seat_id]}", f["address"].value), (seat.seat_id, f["address"].value)
        if "licensed_in" in f:
            assert name in f["licensed_in"].value and f["licensed_in"].value in (name, "Iowa and Illinois"), (seat.seat_id, f["licensed_in"].value)
        if "service_areas" in f:
            assert city in f["service_areas"].value.split(", "), seat.seat_id


def test_a_seats_market_follows_the_zipcode_it_is_given():
    markets = {1: "52801", 2: "52802", 3: "52803", 4: "52804"}
    plan = pp.build_profile_plan([1, 2, 3, 4], AS_OF, markets)
    for seat in plan.seats:
        city = city_of(markets[seat.seat_id])
        f = facts(seat)
        if "address" in f:
            assert f"{city}, {STATE[city][0]} {markets[seat.seat_id]}" in f["address"].value


def test_nmls_is_a_plain_number_and_the_company_is_generic(plan):
    for seat in plan.seats:
        f = facts(seat)
        if "nmls" in f:
            assert re.fullmatch(r"\d{6,7}", f["nmls"].value), seat.seat_id
        assert f["company"].value in pp.COMPANIES


def test_hours_are_one_of_the_known_shapes(plan):
    for seat in plan.seats:
        f = facts(seat)
        if "hours" in f:
            assert f["hours"].value in pp.HOURS


def test_the_graph_has_six_groups_of_plausible_counts_that_add_up(plan):
    for seat in plan.seats:
        for g in seat.groups:
            lo, hi = pp.GROUP_RANGE[g.key]
            assert g.facts == 0 or lo <= g.facts <= hi, (seat.seat_id, g)
        assert sum(g.facts for g in seat.groups) >= 20, seat.seat_id


def test_the_year_started_in_the_plan_is_not_invented_here(plan):
    """The Home seed writes year_started; the Profile plan must not carry a competing value."""
    assert not any(hasattr(s.columns, "year_started") for s in plan.seats)


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
    assert "Example" in text or "example" in text


def _varchar_limits() -> dict[str, int]:
    db = Path(__file__).resolve().parents[1] / "db" / "local"
    sql = (db / "profile_schema.sql").read_text()
    return {c: int(n) for c, n in re.findall(r"^\s+(\w+) varchar\((\d+)\)", sql, flags=re.MULTILINE)}


def test_every_text_value_fits_its_column(plan):
    limits = _varchar_limits()
    assert limits["source"] == 60 and limits["field"] == 20 and limits["trust_tier"] == 20 and limits["group_key"] == 12
    for seat in plan.seats:
        for f in seat.facts:
            assert len(f.source) <= limits["source"] and len(f.field) <= limits["field"] and len(f.trust_tier) <= limits["trust_tier"]
        assert all(len(g.key) <= limits["group_key"] for g in seat.groups)
        c = seat.columns
        assert len(c.title) <= 300 and all(v is None or len(v) <= 255 for v in (c.phone_number, c.mobile_number))


# --- second review: the seeded facts agree with each other (srp/profile-page-schema) -----------------------------------

def test_a_full_bio_names_no_loan_product_so_it_cannot_contradict_the_products_list(plan):
    for seat in plan.seats:
        d = seat.columns.description
        if d and len(d) >= pp.THIN_BIO:
            assert not any(p.lower() in d.lower() for p in PRODUCTS) and "FHA" not in d and " VA " not in d, (seat.seat_id, d)


def test_a_licensed_state_goes_with_an_nmls_number_and_the_other_way_round(plan):
    for seat in plan.seats:
        f = facts(seat)
        assert ("nmls" in f) == ("licensed_in" in f), seat.seat_id
    assert any("nmls" in facts(s) for s in plan.seats) and any("nmls" not in facts(s) for s in plan.seats)


def test_the_graph_groups_agree_with_the_facts_the_seat_has(plan):
    for seat in plan.seats:
        f, g = facts(seat), {x.key: x.facts for x in seat.groups}
        assert (g["products"] > 0) == ("products" in f), seat.seat_id
        assert (g["licence"] > 0) == ("nmls" in f or "licensed_in" in f), seat.seat_id


def test_a_thin_bio_never_carries_the_approved_by_you_source(plan):
    """The page hides a thin bio's source behind NORA's draft, and 'Approved by you' only makes sense for a bio the person approved."""
    seen = set()
    for seat in plan.seats:
        d, f = seat.columns.description, facts(seat)
        if d and len(d) < pp.THIN_BIO:
            assert f["bio"].source != "Approved by you", seat.seat_id
        if d and len(d) >= pp.THIN_BIO:
            seen.add(f["bio"].source)
    assert "Approved by you" in seen, "a full bio can be approved"


def test_the_market_rules_hold_for_every_one_of_the_four_markets(plan):
    markets = {s: str(52801 + s % 4) for s in SEATS}
    spread = pp.build_profile_plan(SEATS, AS_OF, markets)
    cities = set()
    for seat in spread.seats:
        city = city_of(markets[seat.seat_id])
        abbr, name = STATE[city]
        cities.add(city)
        f = facts(seat)
        if "address" in f:
            assert f"{city}, {abbr} {markets[seat.seat_id]}" in f["address"].value, seat.seat_id
        if "licensed_in" in f:
            assert name in f["licensed_in"].value, seat.seat_id
        if "service_areas" in f:
            assert city in f["service_areas"].value.split(", "), seat.seat_id
    assert cities == set(hp.CITIES)
