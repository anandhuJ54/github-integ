"""The mock rows behind the Profile page, as plain values (srp/profile-page-schema, task 3). Pure: no database, no clock.

`build_profile_plan(seat_ids, as_of, markets)` returns, for every seat, (a) its `profile_facts` rows (a source, a trust tier, a date, and the value only for the
ten facts that live there), (b) its six `profile_graph_groups` rows, and (c) the corrected mock values of the `tier_agents` columns the page reads (title,
description, phone_number, mobile_number, profile_photo); `seed_home` turns them into writes. `year_started` is not here: the Home seed writes it.

Deterministic: a seat's rows depend only on its id, its market and the date, never on the other seats, their order or the time of day. Dates are relative to
`as_of` (the day, at 09:00). Everything is labelled mock and names nobody (companies, addresses and universities are generic).

The rules the page applies hold by construction (and are tested, the lesson of the SRS review): a fact the page counts as present has its row, an existing-table
fact has a row exactly when its column is present, a thin bio is under THIN_BIO characters, a source label, its tier and its date agree, and the address, the
licensed states and the service areas agree with the seat's market.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from surfaces.srp.seat import seed_home_plan as hp

SEED_TAG = "profile-v1"
EXISTING_FIELDS = ("name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email")
OWN_FIELDS = ("address", "hours", "nmls", "licensed_in", "products", "service_areas", "designations", "awards", "education", "company")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
GROUP_KEYS = ("identity", "contact", "licence", "products", "reviews", "presence")
PRODUCTS = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "Rate-and-term", "Cash-out", "HELOC", "Pre-approval"]
THIN_BIO = 60  # a bio under this many characters is thin and shows NORA's draft (decision N5; a mock rule)
GROUP_RANGE = {"identity": (6, 14), "contact": (5, 11), "licence": (3, 8), "products": (6, 13), "reviews": (8, 18), "presence": (8, 16)}

SOURCE_TIER = {"From LinkedIn": "imported", "From Google": "imported", "From NMLS": "authority_verified", "Confirmed by you": "owner_verified",
               "Approved by you": "owner_verified", "Added by you": "self_declared"}
DATED_SOURCES = ("Confirmed by you", "Approved by you", "Added by you")  # the labels that carry a date ("Confirmed by you · Oct 16")
_SOURCES = {
    "name": ("From LinkedIn", "Confirmed by you"), "title": ("From LinkedIn", "Confirmed by you"), "photo": ("From LinkedIn",),
    "bio": ("Approved by you", "From LinkedIn"), "year_started": ("Confirmed by you", "From LinkedIn"), "office_phone": ("Confirmed by you", "From Google"),
    "mobile_phone": ("Confirmed by you",), "email": ("Confirmed by you",), "address": ("Confirmed by you", "From Google"),
    "hours": ("From Google", "Added by you"), "nmls": ("Confirmed by you", "From NMLS"), "licensed_in": ("From NMLS", "Confirmed by you"),
    "products": ("From Google", "Added by you"), "service_areas": ("Added by you", "From Google"), "designations": ("From LinkedIn", "Added by you"),
    "awards": ("From LinkedIn", "Added by you"), "education": ("From LinkedIn", "Added by you"), "company": ("From LinkedIn", "Confirmed by you"),
}
# the share of seats (out of 100) that have each fact whose value lives in profile_facts; the rest of the seats are missing it
_THIN_BIO_SOURCES = ("From LinkedIn", "Added by you")
_PRESENT = {"address": 90, "hours": 75, "nmls": 95, "licensed_in": 90, "products": 90, "service_areas": 55, "designations": 50, "awards": 40,
            "education": 50, "company": 100}
STATE = {"Davenport": ("IA", "Iowa"), "Bettendorf": ("IA", "Iowa"), "Rock Island": ("IL", "Illinois"), "Moline": ("IL", "Illinois")}
COMPANIES = ("Example Lending Co", "Example Home Loans", "Example Mortgage Group")
HOURS = ("Mon–Fri 9:00–5:00", "Mon–Fri 8:30–5:30", "Mon–Sat 9:00–4:00")
TITLES = ("Loan Officer", "Senior Loan Officer", "Mortgage Loan Originator", "Branch Manager")
_DESIGNATIONS = ("CMA", "CMA, CRMS", "Certified Mortgage Advisor")
_AWARDS = ("Top Producer 2025", "Five-Star Lender 2025")
_EDUCATION = ("B.A. Business, Example University", "B.S. Finance, Example State University")
_THIN = ("Loan officer.", "Mortgage help in the Quad Cities.", "Helping buyers.")


# --- the rows ---------------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Fact:
    field: str
    value: str | list[str] | None
    source: str
    trust_tier: str
    confirmed_at: datetime | None


@dataclass(frozen=True)
class Group:
    key: str
    facts: int


@dataclass(frozen=True)
class Columns:
    """The corrected mock values of the `tier_agents` columns the page reads."""
    title: str
    description: str | None
    phone_number: str | None
    mobile_number: str | None
    profile_photo: str | None


@dataclass(frozen=True)
class SeatProfile:
    seat_id: int
    columns: Columns
    facts: list[Fact]
    groups: list[Group]


@dataclass(frozen=True)
class ProfilePlan:
    seats: list[SeatProfile]


def tier_of(source: str) -> str:
    """The trust tier a source label earns (a mock mapping, decision N8). KeyError for a label this plan does not know."""
    return SOURCE_TIER[source]


# --- deterministic helpers ------------------------------------------------------------------------------------------

def _h(*parts: object) -> int:
    return int.from_bytes(hashlib.sha256((SEED_TAG + ":" + ":".join(str(p) for p in parts)).encode()).digest()[:8], "big")


def _between(lo: int, hi: int, *parts: object) -> int:
    """An integer from lo to hi, both included."""
    return lo + _h(*parts) % (hi - lo + 1)


def _pick(options: tuple, *parts: object):
    return options[_h(*parts) % len(options)]


def _phone(seat: int, key: str) -> str:
    return f"+1{_pick(('563', '309'), seat, key, 'area')}555{_between(0, 9999, seat, key):04d}"


# --- one seat -----------------------------------------------------------------------------------------------------------

def _columns(seat: int, city: str) -> Columns:
    r = _h(seat, "bio") % 10
    description = None if r < 2 else _pick(_THIN, seat, "thin") if r < 5 else (
        f"Helps {city}-area families buy and refinance homes, with a focus on first-time buyers.")  # names no loan product: it must not contradict the products fact
    return Columns(
        title=_pick(TITLES, seat, "title"),
        description=description,
        phone_number=_phone(seat, "office"),
        mobile_number=None if _h(seat, "mobile") % 10 < 3 else _phone(seat, "mobile"),
        profile_photo=None,
    )


def _value(field: str, seat: int, city: str, zipcode: str) -> str | list[str]:
    abbr, state = STATE[city]
    other = "Illinois" if state == "Iowa" else "Iowa"
    if field == "address":
        return f"{_between(100, 9999, seat, 'street')} Main St, {city}, {abbr} {zipcode}"
    if field == "hours":
        return _pick(HOURS, seat, "hours")
    if field == "nmls":
        return str(_between(100000, 9999999, seat, "nmls"))
    if field == "licensed_in":
        return state if _h(seat, "states") % 2 else (f"{state} and {other}" if state == "Iowa" else f"{other} and {state}")
    if field == "products":
        count = _between(4, 9, seat, "products")
        chosen = sorted(range(len(PRODUCTS)), key=lambda i: _h(seat, "product", i))[:count]
        return [PRODUCTS[i] for i in sorted(chosen)]
    if field == "service_areas":
        extra = sorted((c for c in hp.CITIES if c != city), key=lambda c: _h(seat, "area", c))[: _between(1, 3, seat, "areas")]
        return ", ".join(c for c in hp.CITIES if c == city or c in extra)
    if field == "designations":
        return _pick(_DESIGNATIONS, seat, "designations")
    if field == "awards":
        return _pick(_AWARDS, seat, "awards")
    if field == "education":
        return _pick(_EDUCATION, seat, "education")
    return _pick(COMPANIES, seat, "company")  # company


def _seat(seat: int, zipcode: str, now: datetime) -> SeatProfile:
    city = hp.CITIES[int(zipcode) % len(hp.CITIES)] if zipcode.isdigit() else hp.CITIES[0]
    columns = _columns(seat, city)

    def fact(field: str, value: str | list[str] | None, thin: bool = False) -> Fact:
        # a thin bio was never approved by the person: only a full bio can carry "Approved by you"
        source = _pick(_THIN_BIO_SOURCES if field == "bio" and thin else _SOURCES[field], seat, field, "source")
        when = now - timedelta(days=_between(1, 120, seat, field, "days"), hours=_between(0, 6, seat, field, "hours")) if source in DATED_SOURCES else None
        return Fact(field, value, source, tier_of(source), when)

    present = {
        "name": True, "year_started": True, "email": True, "title": bool(columns.title.strip()), "photo": bool(columns.profile_photo),
        "bio": bool(columns.description), "office_phone": bool(columns.phone_number), "mobile_phone": bool(columns.mobile_number),
    }
    thin = bool(columns.description) and len(columns.description) < THIN_BIO
    facts = [fact(f, None, thin) for f in EXISTING_FIELDS if present[f]]
    # a licensed state goes with the NMLS number (the page shows both on one card, and the mortgage rule is to display the NMLS ID)
    own = [f for f in OWN_FIELDS if _h(seat, "nmls" if f == "licensed_in" else f, "present") % 100 < _PRESENT["nmls" if f == "licensed_in" else f]]
    facts += [fact(f, _value(f, seat, city, zipcode)) for f in own]
    have = {f.field for f in facts}
    # the graph follows the facts the seat has: no products fact, no products group; no licence fact, no licence group
    groups = [Group(k, 0 if (k == "products" and "products" not in have) or (k == "licence" and not {"nmls", "licensed_in"} & have)
                    else _between(*GROUP_RANGE[k], seat, "group", k)) for k in GROUP_KEYS]
    return SeatProfile(seat, columns, facts, groups)


def build_profile_plan(seat_ids: list[int], as_of: date | datetime, markets: dict[int, str] | None = None) -> ProfilePlan:
    """The rows every seat should have, relative to `as_of` (the day, at 09:00). `markets` maps a seat to its zipcode (default 52801, as the Home plan)."""
    day = as_of.date() if isinstance(as_of, datetime) else as_of
    now = datetime.combine(day, time(9, 0))
    return ProfilePlan([_seat(s, (markets or {}).get(s, hp.DEFAULT_ZIPCODE), now) for s in sorted(set(seat_ids))])
