"""The mock rows behind the Insights page, as plain values (srp/insights-page-schema, task 3). Pure: no database, no clock.

`build_insights_plan(home)` reads the Home plan (`seed_home_plan.build_home_plan`) and returns, for every seat in it, (a) its `insights_visibility` rows,
(b) its three `insights_ai_engines` rows, (c) one `insights_competitor_positions` row per rival and (d) the top 3 of each of its 49 map spots
(`insights_spot_leaders`); `seed_home` turns them into writes. A competitor is named by its Home `position` and a spot by its (row, col): the seed maps both
to ids. Nothing here carries a date, so the same Home plan always gives the same rows.

Deterministic: a seat's rows depend only on its Home rows, never on the other seats, their order or the time of day. Everything is labelled mock and names
nobody (the rivals are the generic business names of the Home plan).

The rules the page applies hold by construction (and are tested, the lesson of the SRS and Profile reviews): the three engine rows add up to the seat's
`ai_cited` and `ai_checked` of Home; a note agrees with its counts; "You" is in a spot's top 3 exactly when the seat's stored rank for that spot is 1 to 3,
at that place; a rival never appears twice in a spot; the market leader has the lowest average position and a better competitor never averages worse;
a call, a direction request or a website click is below the Maps views of the same seat.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

from surfaces.srp.seat import seed_home_plan as hp

SEED_TAG = "insights-v1"
METRICS = ("search_views", "maps_views", "calls", "directions", "website_clicks", "profile_views")
ENGINES = ("chatgpt", "gemini", "perplexity")
PERIOD_DAYS = 30
# source label -> trust tier (a mock mapping, decision N7: Google's figures are imported, the platform's own are platform-observed)
SOURCE_TIER = {"From Google": "imported", "From Experience.com": "platform_observed"}
_SOURCE = {"profile_views": "From Experience.com"}
_RANGE = {"search_views": (800, 3200), "maps_views": (400, 1800), "calls": (5, 60), "directions": (10, 90), "website_clicks": (20, 200),
          "profile_views": (30, 400)}
NOTES_NONE = ("Does not mention you yet.", "Names other lenders in your area, not you.", "Gives no answer that mentions you.")
NOTES_SOME = ("Names you for refinance questions.", "Names you for first-time buyer questions.", "Names you for local lender questions.")
_MISS_ONE = 6  # one seat in this many has no figure for one of the six metrics (so "unknown" shows)


@dataclass(frozen=True)
class Visibility:
    metric: str
    value: int
    period_days: int
    source: str
    trust_tier: str


@dataclass(frozen=True)
class Engine:
    engine: str
    cited: int
    checked: int
    note: str


@dataclass(frozen=True)
class Position:
    competitor_position: int  # home_competitors.position of the rival
    name: str
    avg_position: float


@dataclass(frozen=True)
class Leader:
    row: int
    col: int
    position: int
    name: str | None  # None exactly for "You"
    is_you: bool


@dataclass(frozen=True)
class SeatInsights:
    seat_id: int
    visibility: list[Visibility]
    engines: list[Engine]
    positions: list[Position]
    leaders: list[Leader]


@dataclass(frozen=True)
class InsightsPlan:
    seats: list[SeatInsights]


# --- deterministic helpers ------------------------------------------------------------------------------------------

def _h(*parts: object) -> int:
    return int.from_bytes(hashlib.sha256((SEED_TAG + ":" + ":".join(str(p) for p in parts)).encode()).digest()[:8], "big")


def _between(lo: int, hi: int, *parts: object) -> int:
    """An integer from lo to hi, both included."""
    return lo + _h(*parts) % (hi - lo + 1)


# --- one seat -----------------------------------------------------------------------------------------------------------

def _visibility(seat: int) -> list[Visibility]:
    missing = METRICS[_h(seat, "miss") % len(METRICS)] if _h(seat, "missing") % _MISS_ONE == 0 else None
    values = {m: _between(*_RANGE[m], seat, m) for m in METRICS}
    # an action starts from a view: the ranges keep each below the Maps views of the same seat (a test checks the ranges)
    out = []
    for m in METRICS:
        if m == missing:
            continue
        source = _SOURCE.get(m, "From Google")
        out.append(Visibility(m, values[m], PERIOD_DAYS, source, SOURCE_TIER[source]))
    return out


def _engines(seat: int, cited: int, checked: int) -> list[Engine]:
    order = sorted(range(len(ENGINES)), key=lambda i: _h(seat, "engine", i))  # who gets the extra answers first
    checks = [checked // 3] * 3
    for k in range(checked % 3):
        checks[order[k]] += 1
    cites = [0, 0, 0]
    left = cited
    while left > 0:  # one at a time, in a seat-specific order, never above what the engine checked
        moved = False
        for i in order:
            if left > 0 and cites[i] < checks[i]:
                cites[i] += 1
                left -= 1
                moved = True
        if not moved:
            break
    return [Engine(e, cites[i], checks[i], (NOTES_SOME if cites[i] else NOTES_NONE)[_h(seat, "note", e) % 3]) for i, e in enumerate(ENGINES)]


def _positions(seat: int, rivals: list[hp.Competitor]) -> list[Position]:
    """Strictly better places for better competitors: the market leader first, then each rival a little further out."""
    avg = _between(15, 30, seat, "leader") / 10
    out = []
    for c in sorted(rivals, key=lambda c: c.position):
        out.append(Position(c.position, c.name, round(avg, 1)))
        avg += _between(4, 30, seat, "step", c.position) / 10
    return out


def _leaders(seat: int, cells: list[hp.Cell], positions: list[Position]) -> list[Leader]:
    avg = {p.name: p.avg_position for p in positions}
    out = []
    for cell in cells:
        # three different rivals, the better averages seen more often
        picked = sorted(avg, key=lambda n: (_h(seat, "spot", cell.row, cell.col, n) % 100) + avg[n] * 6)[:3]
        rank = cell.rank if cell.rank is not None and cell.rank <= 3 else None
        rest = iter(picked)
        for place in (1, 2, 3):
            if rank == place:
                out.append(Leader(cell.row, cell.col, place, None, True))
            else:
                out.append(Leader(cell.row, cell.col, place, next(rest), False))
    return out


def _seat(h: hp.SeatHome) -> SeatInsights:
    newest = h.snapshots[-1]
    positions = _positions(h.seat_id, h.competitors)
    return SeatInsights(h.seat_id, _visibility(h.seat_id), _engines(h.seat_id, newest.ai_cited, newest.ai_checked), positions,
                        _leaders(h.seat_id, sorted(newest.cells, key=lambda c: (c.row, c.col)), positions))


def build_insights_plan(home: hp.HomePlan) -> InsightsPlan:
    """The rows every seat of the Home plan should have. A seat whose newest snapshot has no map cells gets no leaders."""
    return InsightsPlan([_seat(s) for s in sorted(home.seats, key=lambda s: s.seat_id)])
