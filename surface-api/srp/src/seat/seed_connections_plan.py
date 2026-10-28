"""The mock rows behind the Connections page, as plain values (srp/connections-page-schema, task 3). Pure: no database, no clock.

`build_connections_plan(home, profile, as_of)` returns for every seat of the Home plan its eleven `connected_accounts` rows; `align_home(home, conns)` returns the Home plan with the
SRS Connections lane's "you" count following the connected social accounts (and the Home Facebook connection event following Facebook), and `align_web(web, conns)` the Web analytics plan with the Indexing source following Search Console.
`seed_home` turns them into writes. Deterministic: a seat's rows depend only on its own Home and Profile rows and the day, never on the other seats. Everything is labelled mock
and names nobody. Nothing here is a token, a secret or an account identifier.

The rules the page applies, and the other pages show, hold by construction (and are tested):
  * Google Business Profile is connected for every seat (the SRS gap says so), synced within the 7 days before the day; YouTube and Search Console are part of the Google sign-in
    and can be connected only then; a seat whose Videos lane has a video has YouTube connected;
  * LinkedIn is connected wherever the Profile has a fact "From LinkedIn"; the connected social accounts (Facebook, Instagram, LinkedIn, X) equal the Connections lane's "you"
    count, which is the Home plan's own count but at least one when LinkedIn is cited (the gap to the rival text is kept);
  * "matched" (and "partial", Yelp only: its replies need partner access) is for the two directories; the sync time is null exactly for an account that is only available.
"""
import dataclasses
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat import seed_web_plan as wp

SEED_TAG = "connections-v1"
PROVIDERS = ("google_business", "search_console", "youtube", "facebook", "instagram", "linkedin", "x", "zillow", "yelp", "website_cms", "loan_system")
SOCIAL = ("facebook", "instagram", "linkedin", "x")
BY_STATE = {"connected": ("From your sign-in", "owner_verified"), "matched": ("Matched by NORA", "platform_observed"),
            "partial": ("Matched by NORA", "platform_observed"), "available": ("Not connected", "self_declared")}
INDEXING_SOURCE = {True: ("From Google Search Console", "imported"), False: ("From your site scan", "platform_observed")}
_CONNECTED_PERCENT = {"search_console": 60, "youtube": 40, "website_cms": 25, "loan_system": 30}  # of the seats that can have it


@dataclass(frozen=True)
class Account:
    provider: str
    state: str
    synced_at: datetime | None
    source: str
    trust_tier: str


@dataclass(frozen=True)
class SeatConnections:
    seat_id: int
    accounts: list[Account]


@dataclass(frozen=True)
class ConnectionsPlan:
    seats: list[SeatConnections]


def _h(*parts: object) -> int:
    return hp._h(SEED_TAG, *parts)


def _between(lo: int, hi: int, *parts: object) -> int:
    return lo + _h(*parts) % (hi - lo + 1)


def _count(seat: int, text: str) -> int:
    m = re.match(r"\d+$", text.strip()) or re.match(r"(\d+) connected accounts$", text.strip())
    if not m:
        raise ValueError(f"seat {seat}: the Connections lane text {text!r} is not a count")
    return int(m.group(1) if m.lastindex else m.group())


def _gap(home_seat: hp.SeatHome, lane: str) -> hp.Gap:
    return next(g for g in home_seat.gaps if g.lane == lane)


def _accounts(home_seat: hp.SeatHome, profile: pp.SeatProfile, now: datetime) -> list[Account]:
    seat = home_seat.seat_id
    state = {p: "available" for p in PROVIDERS}
    state["google_business"] = "connected"
    for p in ("search_console", "youtube", "website_cms", "loan_system"):
        if _h(seat, p) % 100 < _CONNECTED_PERCENT[p]:
            state[p] = "connected"
    if _gap(home_seat, "videos").you_text != "No videos":
        state["youtube"] = "connected"
    # the social accounts: the Home plan's own count, at least one when the Profile cites LinkedIn, and LinkedIn first
    cited = any(f.source == "From LinkedIn" for f in profile.facts)
    count = min(len(SOCIAL), max(_count(seat, _gap(home_seat, "connections").you_text), 1 if cited else 0))
    order = sorted(SOCIAL, key=lambda p: _h(seat, "social", p))
    if cited:
        order.remove("linkedin")
        order.insert(0, "linkedin")
    for p in order[:count]:
        state[p] = "connected"
    # the directories are found without a sign-in
    z, y = _h(seat, "zillow") % 100, _h(seat, "yelp") % 100
    state["zillow"] = "matched" if z < 55 else "available"
    state["yelp"] = "partial" if y < 50 else "matched" if y < 70 else "available"
    rows = []
    for p in PROVIDERS:
        source, tier = BY_STATE[state[p]]
        synced = now - timedelta(days=_between(0, 6, seat, p, "day"), hours=_between(0, 8, seat, p, "hour")) if state[p] != "available" else None
        rows.append(Account(p, state[p], synced, source, tier))
    return rows


def build_connections_plan(home: hp.HomePlan, profile: pp.ProfilePlan, as_of: date | datetime) -> ConnectionsPlan:
    """The eleven accounts of every seat of the Home plan, relative to `as_of` (the day, at 09:00, as the other plans)."""
    day = as_of.date() if isinstance(as_of, datetime) else as_of
    now = datetime.combine(day, time(9, 0))
    by_profile = {s.seat_id: s for s in profile.seats}
    return ConnectionsPlan([SeatConnections(s.seat_id, _accounts(s, by_profile[s.seat_id], now)) for s in sorted(home.seats, key=lambda s: s.seat_id)])


def _connected(conns: SeatConnections, provider: str) -> bool:
    return next(a for a in conns.accounts if a.provider == provider).state == "connected"


def align_home(home: hp.HomePlan, conns: ConnectionsPlan) -> hp.HomePlan:
    """The Home plan with the Connections lane's "you" count equal to the seat's connected social accounts (the gap to the rival text is kept), and the Facebook connection event kept only for a seat whose Facebook is connected. Nothing else changes."""
    by_seat = {c.seat_id: c for c in conns.seats}
    seats = []
    for s in home.seats:
        old = _gap(s, "connections")
        you = sum(_connected(by_seat[s.seat_id], p) for p in SOCIAL)
        rival = _count(s.seat_id, old.rival_text) - _count(s.seat_id, old.you_text) + you
        new = dataclasses.replace(old, you_text=str(you), rival_text=f"{rival} connected accounts")
        events = [e for e in s.events if e.kind != "facebook" or _connected(by_seat[s.seat_id], "facebook")]  # "Your Facebook connection expires" needs a connection
        seats.append(dataclasses.replace(s, gaps=[new if g.lane == "connections" else g for g in s.gaps], events=events))
    return dataclasses.replace(home, seats=seats)


def align_web(web: wp.WebPlan, conns: ConnectionsPlan) -> wp.WebPlan:
    """The Web analytics plan with the Indexing check's source and tier following Search Console; nothing else changes."""
    by_seat = {c.seat_id: c for c in conns.seats}
    seats = []
    for w in web.seats:
        source, tier = INDEXING_SOURCE[_connected(by_seat[w.seat_id], "search_console")]
        seats.append(dataclasses.replace(w, checks=[dataclasses.replace(c, source=source, trust_tier=tier) if c.key == "indexing" else c for c in w.checks]))
    return dataclasses.replace(web, seats=seats)
