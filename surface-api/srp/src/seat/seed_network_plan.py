"""The mock rows behind the Network page, as plain values (srp/network-page-schema, task 3). Pure: no database, no clock.

`build_network_plan(home, conns, as_of)` reads the Home plan (the seat's layout and newest review count) and the Connections plan (Zillow and the Loan system) and returns for every
seat its `network_partners` and `network_referrals` rows. `seed_home` turns them into writes. Deterministic: a seat's rows depend only on its own Home and Connections rows and
the day, never on the other seats, their order or the time of day. Everything is labelled mock; the people and firms are generated names, and no contact detail or message is made.

The rules the page applies, and the other pages show, hold by construction (and are tested):
  * counts follow the Home layout (a day-1 seat has few rows, a day-24 seat more), at most 8 promoted partners and 10 partners; a seat the rules leave with no row at all gets one
    request, so its page is not empty;
  * a "zillow" reason exists only for a seat whose Zillow is matched and cites between 1 and its newest review count (N9); a closing claim (a "closings" reason, a closed referral,
    a "closed in {Month}" detail) only for a seat whose Loan system is connected (N10); a seat with neither source has no suggestions (the database allows only those two kinds);
  * a given referral, and a received one that names a partner, point to a promoted partner of the same seat; a request, suggestion or saved partner is never referenced (N11);
  * every date is 1 to 120 days before the day, so a waiting referral is at least a day old (N12); source and tier follow the kind of row (N13).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from surfaces.srp.seat import seed_connections_plan as cp
from surfaces.srp.seat import seed_home_plan as hp

SEED_TAG = "network-v1"
STATES = ("promoted", "request", "suggested", "saved")
FIRST = ("Alex", "Avery", "Blake", "Cameron", "Casey", "Dana", "Devon", "Drew", "Elliot", "Emery", "Finley", "Harper", "Hayden", "Jamie", "Jordan", "Kai", "Kendall", "Logan",
         "Morgan", "Noel", "Parker", "Peyton", "Quinn", "Reese", "Riley", "Rowan", "Sage", "Sam", "Skyler", "Sydney", "Taylor", "Tatum", "Toby", "Val", "Wren", "Zion", "Marlo",
         "Lane", "Remy", "Shay")
LAST = ("Adler", "Bishop", "Carver", "Dalton", "Ellis", "Foster", "Gray", "Hale", "Irwin", "Jensen", "Keller", "Lowell", "Marsh", "Nolan", "Osborne", "Pierce", "Quill", "Reyes",
        "Sutton", "Thorne", "Underhill", "Vance", "Walsh", "Yates", "Zeller", "Abbott", "Brandt", "Crane", "Donnelly", "Easton", "Fitch", "Garrick", "Holt", "Ingram", "Joyce",
        "Knox", "Larkin", "Mercer", "Nash", "Ortega")
STEMS = ("Prairie", "Riverbend", "Hawkeye", "Lakeshore", "Cornerstone", "Heartland", "Meadowlark", "Ironwood")
LOANS = ("First-time buyers · FHA", "Refinance", "VA purchase", "Jumbo", "Second home", "Cash-out refinance")
SENT = ("first-time buyer", "refinance", "VA purchase", "jumbo loan", "second-home buyer")
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
# the rows each layout may have: (min, max)
RANGES = {
    "day1": {"promoted": (0, 1), "request": (0, 1), "suggested": (0, 2), "saved": (0, 1), "received": (0, 1), "requested": (0, 1), "given": (0, 0)},
    "day7": {"promoted": (1, 3), "request": (0, 2), "suggested": (0, 2), "saved": (0, 1), "received": (1, 3), "requested": (0, 2), "given": (0, 1)},
    "day24": {"promoted": (2, 5), "request": (0, 2), "suggested": (0, 2), "saved": (0, 1), "received": (2, 4), "requested": (1, 3), "given": (0, 2)},
}
BY_KIND = {"promoted": ("From your sign-in", "owner_verified"), "request": ("Asked by the partner", "platform_observed"),
           "suggested": ("Suggested by NORA", "platform_observed"), "saved": ("Saved by you", "owner_verified")}
REFERRAL_SOURCE = ("From your sign-in", "owner_verified")


@dataclass(frozen=True)
class PartnerRow:
    position: int
    name: str
    company: str
    role: str
    state: str
    reason_kind: str | None
    reason_count: int | None
    reason_on: date | None
    source: str
    trust_tier: str


@dataclass(frozen=True)
class ReferralRow:
    list_key: str
    position: int
    name: str
    detail: str
    partner_name: str | None  # a promoted partner of the same seat, found again by name when written
    status: str
    occurred_on: date
    source: str
    trust_tier: str


@dataclass(frozen=True)
class SeatNetwork:
    seat_id: int
    partners: list[PartnerRow]
    referrals: list[ReferralRow]


@dataclass(frozen=True)
class NetworkPlan:
    seats: list[SeatNetwork]


def _h(*parts: object) -> int:
    return hp._h(SEED_TAG, *parts)


def _between(lo: int, hi: int, *parts: object) -> int:
    return lo + _h(*parts) % (hi - lo + 1)


def _person(seat: int, key: str, used: set[str]) -> str:
    """A generated name not used yet in this seat (partners and clients share one set)."""
    n = 0
    while True:
        name = f"{FIRST[_h(seat, key, 'f', n) % len(FIRST)]} {LAST[_h(seat, key, 'l', n) % len(LAST)]}"
        if name not in used:
            used.add(name)
            return name
        n += 1


def _role(seat: int, key: str) -> str:
    r = _h(seat, key, "role") % 10
    return "Agent" if r < 6 else "Title" if r < 8 else "Inspector"


def _company(seat: int, key: str, role: str) -> str:
    if role == "Agent":
        return f"{STEMS[_h(seat, key, 'stem') % len(STEMS)]} Realty"
    city = hp.CITIES[_h(seat, key, "city") % len(hp.CITIES)]
    return f"{city} Title" if role == "Title" else f"{city} Home Inspections"


def _state(conns: cp.ConnectionsPlan, seat: int, provider: str) -> str:
    for s in conns.seats:
        if s.seat_id == seat:
            return next(a.state for a in s.accounts if a.provider == provider)
    raise ValueError(f"seat {seat}: the Connections plan has no accounts for it")


def _seat(home_seat: hp.SeatHome, conns: cp.ConnectionsPlan, today: date) -> SeatNetwork:
    seat = home_seat.seat_id
    zillow = _state(conns, seat, "zillow") == "matched"
    loan = _state(conns, seat, "loan_system") == "connected"
    reviews = max(home_seat.snapshots, key=lambda s: s.as_of).review_count
    r = RANGES[home_seat.layout]
    n = {k: _between(lo, hi, seat, k) for k, (lo, hi) in r.items()}
    kinds = (["zillow"] if zillow else []) + (["closings"] if loan else [])
    if not kinds:
        n["suggested"] = 0  # the database allows only a Zillow or a closings reason for a suggestion
    used: set[str] = set()
    partners: list[PartnerRow] = []
    for state in STATES:
        for i in range(n[state]):
            key = f"{state}-{i}"
            role = _role(seat, key)
            kind = count = on = None
            if state == "request":
                kind = "asked"
            elif state == "suggested":
                kind = kinds[_h(seat, key, "kind") % len(kinds)]
                count = _between(1, max(1, min(reviews, 5)), seat, key, "n") if kind == "zillow" else _between(1, 6, seat, key, "n")
            elif state == "saved":
                kind, on = "saved", today - timedelta(days=_between(1, 60, seat, key, "on"))
            source, tier = BY_KIND[state]
            partners.append(PartnerRow(len(partners) + 1, _person(seat, key, used), _company(seat, key, role), role, state, kind, count, on, source, tier))
    promoted = [p for p in partners if p.state == "promoted"]
    referrals: list[ReferralRow] = []

    def add(list_key: str, name: str, detail: str, partner: PartnerRow | None, status: str, days: int) -> None:
        position = 1 + sum(1 for x in referrals if x.list_key == list_key)
        referrals.append(ReferralRow(list_key, position, name, detail, partner.name if partner else None, status, today - timedelta(days=days), *REFERRAL_SOURCE))

    for i in range(n["received"]):
        key = f"received-{i}"
        status = ("new", "followed", "closed")[_h(seat, key, "st") % (3 if loan else 2)]  # a closed referral is a closing: only with a Loan system
        partner = promoted[_h(seat, key, "p") % len(promoted)] if promoted and _h(seat, key, "named") % 2 == 0 else None
        add("received", _person(seat, key, used), LOANS[_h(seat, key, "d") % len(LOANS)], partner, status, _between(1, 90, seat, key, "days"))
    for i in range(n["requested"]):
        key = f"requested-{i}"
        days = _between(1, 30, seat, key, "days")
        detail = "Past client"
        if loan and _h(seat, key, "closed") % 2 == 0:
            detail = f"Past client · closed in {MONTHS[(today - timedelta(days=days + _between(20, 200, seat, key, 'ago'))).month - 1]}"
        person = _person(seat, key, used).split()
        add("requested", f"{person[0]} {person[1][0]}.", detail, None, ("waiting", "replied")[_h(seat, key, "st") % 4 == 0], days)
    for i in range(n["given"] if promoted else 0):
        key = f"given-{i}"
        partner = promoted[_h(seat, key, "p") % len(promoted)]
        add("given", partner.company if partner.role == "Title" else partner.name, f"You sent a {SENT[_h(seat, key, 'd') % len(SENT)]}", partner,
            ("thanked", "done")[_h(seat, key, "st") % 2], _between(1, 90, seat, key, "days"))
    if not partners and not referrals:  # the page would be empty: one partner asks to promote the seat
        role = _role(seat, "fallback")
        source, tier = BY_KIND["request"]
        partners.append(PartnerRow(1, _person(seat, "fallback", used), _company(seat, "fallback", role), role, "request", "asked", None, None, source, tier))
    return SeatNetwork(seat, partners, referrals)


def build_network_plan(home: hp.HomePlan, conns: cp.ConnectionsPlan, as_of: date | datetime) -> NetworkPlan:
    """The partners and referrals of every seat of the Home plan, relative to `as_of` (the day)."""
    today = as_of.date() if isinstance(as_of, datetime) else as_of
    return NetworkPlan([_seat(s, conns, today) for s in sorted(home.seats, key=lambda s: s.seat_id)])
