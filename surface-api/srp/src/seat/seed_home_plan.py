"""The mock rows behind the Home page, as plain values (srp/home-page-schema, task 3). Pure: no database, no clock.

`build_home_plan(seat_ids, as_of, markets)` returns, for every seat, the rows of the `home_*` tables (see
`surface-api/srp/db/local/home_schema.sql`), referring to lanes, bands and plans by key or name; `seed_home` turns them into ids and writes them.

Deterministic: a seat's rows depend only on its id, its market and the date, never on the other seats, their order or the
time of day, so adding a seat changes nothing for the others. Dates are relative to `as_of` (the day, at 12:00): moving the date moves every
date by the same amount and changes nothing else. Everything is labelled mock and names nobody (reviewer labels are generic;
competitor names are business names).

The invariants the Home depends on hold by construction (and are tested): lane points sum to the snapshot total; totals,
profile strength, review and AI counts never fall; the market leader outscores the seat; the done activities add up to what the seat
gained since the claim; the weekly brief adds up to the week's gain.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

SEED_TAG = "home-schema-v1"
LAYOUTS = ("day1", "day7", "day24")
DEFAULT_ZIPCODE = "52801"
CITIES = ("Davenport", "Bettendorf", "Rock Island", "Moline")
COMPETITOR_NAMES = (
    "Riverbend Bank & Trust", "Prairie Home Lending", "Bluff City Mortgage", "Mississippi Valley Loans", "Heartland Credit Union",
)
_LANES = (("reviews", "Reviews", 187), ("completeness", "Completeness", 182), ("website", "Website", 102), ("articles", "Articles", 103),
          ("gbp", "Google Business Profile", 68), ("directories", "Directories", 90), ("qa", "Q&A", 34),
          ("connections", "Connections", 51), ("videos", "Videos", 27), ("audio", "Audio", 6))
_BANDS = (("Building", 0), ("Established", 400), ("Leading", 600), ("Elite", 750))
_ACTIVITY_LABELS = (
    "Adding your Google category and services", "Fixed 4 places", "Kept 9 loan products", "Built your profile · 67 facts",
    "Mapped 5 competitors", "Wrote your service-area text", "Checked your hours", "Matched your photo to your profile",
    "Linked your website", "Added your licence number", "Fixed a duplicate listing", "Set up your review link",
)
_BRIEF_LABELS = ("Service areas added", "Bio approved", "First article published (VOCE free credits)", "2 replies posted",
                 "Website markup fixed", "Photo added")
_REVIEW_TEXTS = {1: "Slow to respond and the process felt confusing.", 2: "It took longer than promised, but we got there.",
                 3: "Fine overall. Communication could have been better.", 4: "Helpful and clear from start to finish.",
                 5: "Made the whole process easy. Highly recommend."}
_DRAFT_TEXTS = {low: "Thank you for the feedback. I'm sorry the experience fell short, and I'd like to make it right. Please call my office." for low in (1, 2, 3)}
_DRAFT_TEXTS.update({4: "Thank you for taking the time to share this. It was a pleasure to help.",
                     5: "Thank you so much for the kind words. It was a pleasure to work with you."})
_NORA_TEXT_DAYS = ("Tuesday early morning", "Thursday early morning", "Monday early morning")
_ICONS = {"voce": "pen", "website": "wrench", "profile": "award"}


# --- the rows ---------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Lane:
    key: str
    name: str
    max_points: int
    position: int


@dataclass(frozen=True)
class Band:
    name: str
    min_points: int
    position: int


@dataclass(frozen=True)
class Plan:
    key: str
    name: str
    tag: str
    position: int
    highlight: bool
    items: list[str]


@dataclass(frozen=True)
class Benchmark:
    band: str
    median_gain: int
    horizon_days: int
    cohort_size: int
    cohort_period: str
    reached_next_band: int
    cohort_of: int


@dataclass(frozen=True)
class Reference:
    lanes: list[Lane]
    bands: list[Band]
    plans: list[Plan]
    benchmarks: list[Benchmark]


@dataclass(frozen=True)
class State:
    plan: str
    trial_started_at: datetime
    trial_days: int
    moves_done: int
    moves_goal: int
    streak_weeks: int
    nora_text_day: str
    is_mock: bool


@dataclass(frozen=True)
class Cell:
    row: int
    col: int
    rank: int | None


@dataclass(frozen=True)
class Snapshot:
    as_of: datetime
    total: int
    band: str
    rank_position: int
    rank_of: int
    rank_city: str
    profile_strength_pct: int
    review_avg: float
    review_count: int
    map_scanned_at: datetime | None
    ai_cited: int
    ai_checked: int
    ai_checked_at: datetime
    lanes: dict[str, int]
    cells: list[Cell] = field(default_factory=list)


@dataclass(frozen=True)
class Competitor:
    name: str
    score: int
    is_market_leader: bool
    review_count: int
    review_avg: float
    article_count: int
    position: int


@dataclass(frozen=True)
class Activity:
    label: str
    points: int | None
    status: str
    started_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True)
class Move:
    position: int
    icon: str
    title: str
    subtitle: str
    recommended: bool
    target: str
    points: int | None


@dataclass(frozen=True)
class Locked:
    feature_key: str
    title: str
    description: str
    lane: str | None
    plan: str


@dataclass(frozen=True)
class BriefItem:
    position: int
    label: str
    points: int


@dataclass(frozen=True)
class Brief:
    week_start: datetime
    next_move_label: str
    next_move_points: int
    next_move_target: str
    away_new_reviews: int
    away_bio_live: bool
    away_first_article: bool
    items: list[BriefItem]


@dataclass(frozen=True)
class Draft:
    reviewer_label: str
    rating: int
    review_text: str
    draft_text: str
    compliance_status: str
    status: str
    created_at: datetime


@dataclass(frozen=True)
class Event:
    kind: str
    title: str
    body: str
    action_label: str
    expires_at: datetime | None


@dataclass(frozen=True)
class Insight:
    position: int
    title: str
    body: str
    cta: str
    action: str


@dataclass(frozen=True)
class SeatHome:
    seat_id: int
    layout: str
    day_n: int
    state: State
    snapshots: list[Snapshot]
    competitors: list[Competitor]
    activities: list[Activity]
    moves: list[Move]
    locked: list[Locked]
    brief: Brief
    drafts: list[Draft]
    events: list[Event]
    insights: list[Insight]


@dataclass(frozen=True)
class HomePlan:
    reference: Reference
    seats: list[SeatHome]


# --- deterministic helpers ------------------------------------------------------------------------------------

def _h(*parts: object) -> int:
    return int.from_bytes(hashlib.sha256((SEED_TAG + ":" + ":".join(str(p) for p in parts)).encode()).digest()[:8], "big")


def _frac(*parts: object) -> float:
    return _h(*parts) / 2**64


def _between(lo: int, hi: int, *parts: object) -> int:
    """An integer from lo to hi, both included."""
    return lo + _h(*parts) % (hi - lo + 1)


def _split(total: int, parts: int, *key: object) -> list[int]:
    """`parts` positive integers (each at least 1) that add up to `total`; total >= parts."""
    weights = [1 + _h(*key, i) % 5 for i in range(parts)]
    spare = total - parts
    out = [1 + spare * w // sum(weights) for w in weights]
    out[-1] += total - sum(out)
    return out


def _allocate(total: int, weights: dict[str, float], caps: dict[str, int]) -> dict[str, int]:
    """Spread `total` over the lanes in proportion to the weights, never past a lane's cap; the points add up to exactly `total`."""
    alloc = dict.fromkeys(caps, 0)
    remaining = total
    active = set(caps)
    while remaining > 0 and active:
        weight_sum = sum(weights[k] for k in active)
        spent = 0
        for k in sorted(active):
            give = min(caps[k] - alloc[k], int(remaining * weights[k] / weight_sum))
            alloc[k] += give
            spent += give
        remaining -= spent
        active = {k for k in active if alloc[k] < caps[k]}
        if spent == 0:  # what is left is smaller than a share: hand it out one point at a time
            for k in sorted(active, key=lambda k: (-(caps[k] - alloc[k]), k)):
                if remaining == 0:
                    break
                alloc[k] += 1
                remaining -= 1
    return alloc


def band_of(bands: list[Band], total: int) -> str:
    return [b for b in bands if b.min_points <= total][-1].name


def layout_of_day(n: int) -> str:
    return "day1" if n < 7 else "day7" if n < 24 else "day24"


# --- reference data ---------------------------------------------------------------------------------------------

def reference() -> Reference:
    lanes = [Lane(k, name, mx, i + 1) for i, (k, name, mx) in enumerate(_LANES)]
    bands = [Band(name, lo, i + 1) for i, (name, lo) in enumerate(_BANDS)]
    plans = [
        Plan("core", "Core", "Free after your 30-day trial", 1, False,
             ["Your profile", "Reviews", "Referral network", "Single social posts", "Chat with NORA"]),
        Plan("engage", "Engage", "Listings", 2, False,
             ["Everything in Core", "Publish your details to Apple Maps, Bing and 28 directories",
              "Correct the directories that miss you or show your old phone"]),
        Plan("amplify", "Amplify", "Includes Engage", 3, True,
             ["Everything in Engage", "VOCE articles", "Map Rank tracking · see the week you pass the leader",
              "AI-citation monitoring", "NORA's drafts, fixes and weekly brief", "Website audits"]),
    ]
    benchmarks = [
        Benchmark("Building", 61, 90, 34, "Jan–Sep 2026", 3, 5),
        Benchmark("Established", 48, 90, 29, "Jan–Sep 2026", 2, 5),
        Benchmark("Leading", 35, 90, 22, "Jan–Sep 2026", 1, 5),
    ]
    return Reference(lanes, bands, plans, benchmarks)


# --- one seat ---------------------------------------------------------------------------------------------------

def _trial_day(seat: int, layout: str) -> int:
    return {"day1": _between(1, 6, seat, "day"), "day7": _between(8, 23, seat, "day"), "day24": _between(24, 30, seat, "day")}[layout]


def _totals(seat: int, layout: str, n: int) -> list[int]:
    """Total at each snapshot, oldest first: claim, [two weeks ago,] [a week ago,] now. Never falls."""
    claim = _between(240, 339, seat, "claim")
    latest = {"day1": min(399, claim + 50 + _h(seat, "gain") % 60), "day7": _between(410, 520, seat, "latest"),
              "day24": _between(460, 650, seat, "latest")}[layout]
    totals = [claim]
    if n >= 24:
        week = claim + round((latest - claim) * (0.5 + 0.3 * _frac(seat, "week")))
        totals += [claim + (week - claim) // 2, week]
    elif n >= 8:
        totals.append(claim + round((latest - claim) * (0.4 + 0.4 * _frac(seat, "week"))))
    return totals + [latest]


def _times(started: datetime, now: datetime, n: int) -> list[datetime]:
    times = [started]
    if n >= 24:
        times += [now - timedelta(days=14), now - timedelta(days=7)]
    elif n >= 8:
        times.append(now - timedelta(days=7))
    return times + [now]


def _cells(seat: int) -> list[Cell]:
    order = sorted(((r, c) for r in range(7) for c in range(7)), key=lambda rc: ((rc[0] - 3) ** 2 + (rc[1] - 3) ** 2 + (rc[0] * 7 + rc[1]) % 5 * 0.07, rc))
    top = _between(4, 17, seat, "top3")
    mid = round((49 - top) * 0.5)
    low = round((49 - top - mid) * 0.6)
    cells = []
    for k, (r, c) in enumerate(order):
        if k < top:
            rank = (2, 1, 3)[k % 3]
        elif k < top + mid:
            rank = 4 + k % 7
        elif k < top + mid + low:
            rank = 11 + k % 10
        else:
            rank = None
        cells.append(Cell(r, c, rank))
    return sorted(cells, key=lambda x: (x.row, x.col))


def _competitors(seat: int, total: int, position: int) -> list[Competitor]:
    leader_score = total + 40 + _h(seat, "leader") % 120
    above = min(1 + _h(seat, "above") % 3, position - 1)  # the leader plus (above - 1) others who also outscore the seat
    scores = [leader_score]
    scores += [total + 1 + int((leader_score - total - 1) * _frac(seat, "ab", i)) for i in range(above - 1)]
    scores += [max(0, total - 10 - _h(seat, "be", i) % 90) for i in range(5 - above)]
    scores.sort(reverse=True)
    start = _h(seat, "names") % 5
    names = [COMPETITOR_NAMES[(start + i) % 5] for i in range(5)]
    return [
        Competitor(names[i], score, i == 0, _between(60, 500, seat, "rc", i), round(4.0 + _between(0, 9, seat, "ra", i) / 10, 1),
                   _between(0, 30, seat, "art", i), i + 1)
        for i, score in enumerate(scores)
    ]


def _activities(seat: int, claim: datetime, now: datetime, gained: int) -> list[Activity]:
    done = _between(4, 12, seat, "done")
    labels = [_ACTIVITY_LABELS[0]] + sorted(_ACTIVITY_LABELS[1:], key=lambda s: _h(seat, "label", s))[: done - 1]
    labels = labels[1:] + labels[:1]  # the latest, which feeds 'Just finished', is the first label and the last item
    unpointed = _between(0, done - 2, seat, "nopts") if done >= 6 else None
    pointed = [i for i in range(done) if i != unpointed]
    last = min(_between(3, 6, seat, "last"), gained - (len(pointed) - 1))
    rest = _split(gained - last, len(pointed) - 1, seat, "pts")
    points = iter(rest)
    span = (now - claim) / (done + 1)
    out = []
    for i in range(done):
        finished = claim + span * (i + 1)
        finished = finished.replace(second=0, microsecond=0)
        started = max(claim, finished - timedelta(minutes=_between(15, 55, seat, "dur", i)))
        pts = None if i == unpointed else (last if i == done - 1 else next(points))
        out.append(Activity(labels[i], pts, "done", started, finished))
    if _h(seat, "doing") % 6 == 0:
        out.append(Activity("Writing your first article", None, "doing", now - timedelta(minutes=4), None))
    return out


def _moves(seat: int, leader: Competitor, lanes: dict[str, int], maxima: dict[str, int]) -> list[Move]:
    voce = maxima["articles"] - lanes["articles"]
    site = maxima["website"] - lanes["website"]
    return [
        Move(1, _ICONS["voce"], "Start publishing", f"Your biggest gap: articles. {leader.name} has {leader.article_count}. Free VOCE credits.",
             True, "voce", voce),
        Move(2, _ICONS["website"], "Fix my website", "Markup is missing on your site", False, "website", site),
        Move(3, _ICONS["profile"], "Add your credentials", "Certifications and awards for your profile", False, "profile", _between(4, 14, seat, "cred")),
    ]


def _locked(seat: int) -> list[Locked]:
    return [
        Locked("listings", "Listings", f"{_between(14, 30, seat, 'dirs')} directories are missing you or show your old phone.", "directories", "engage"),
        Locked("voce", "VOCE", "Points are waiting in Articles.", "articles", "engage"),
        Locked("map_rank", "Map Rank tracking", "See the week you pass the leader.", None, "amplify"),
    ]


def _brief(seat: int, snaps: list[Snapshot], maxima: dict[str, int]) -> Brief:
    now = snaps[-1].as_of
    base = next((s for s in reversed(snaps[:-1]) if s.as_of <= now - timedelta(days=7)), snaps[0])
    gained = snaps[-1].total - base.total
    count = _between(3, 5, seat, "items")
    labels = sorted(_BRIEF_LABELS, key=lambda s: _h(seat, "bl", s))[:count]
    items = [BriefItem(i + 1, labels[i], p) for i, p in enumerate(_split(gained, count, seat, "bp"))]
    site_gap = maxima["website"] - snaps[-1].lanes["website"]
    return Brief(datetime.combine((now - timedelta(days=7)).date(), time(0)), "Fix my website", max(1, site_gap), "website",
                 _between(0, 3, seat, "away"), _h(seat, "bio") % 2 == 0, _h(seat, "first") % 3 != 0, items)


def _drafts(seat: int, layout: str, now: datetime) -> list[Draft]:
    if layout == "day1":
        return []
    open_, posted = ((_between(1, 3, seat, "open"), _between(0, 2, seat, "posted")) if layout == "day7"
                     else (_between(0, 2, seat, "open"), _between(2, 4, seat, "posted")))
    drafts = []
    for i in range(open_ + posted):
        is_open = i < open_
        rating = _between(1, 5, seat, "rating", i)
        needs_edit = is_open and _h(seat, "comp", i) % 5 == 0
        drafts.append(Draft(f"Reviewer {chr(65 + i)}. (mock)", rating, _REVIEW_TEXTS[rating], _DRAFT_TEXTS[rating],
                            "needs_edit" if needs_edit else "passed", "draft" if is_open else "posted",
                            now - timedelta(days=i, hours=_between(1, 8, seat, "dh", i))))
    return drafts


def _events(seat: int, layout: str, now: datetime) -> list[Event]:
    if layout == "day1":
        return []
    review_every, fb_every = (2, 3) if layout == "day7" else (4, 5)
    events = []
    if _h(seat, "evr") % review_every == 0:
        events.append(Event("review", "A 2★ review needs you today", "I drafted a calm, compliant reply.", "Review the draft", None))
    if _h(seat, "evf") % fb_every == 0:
        events.append(Event("facebook", "Your Facebook connection expires Friday", "Reconnect to keep your posts going out.", "Reconnect",
                            now + timedelta(days=3)))
    return events


def _insights(leader: Competitor, snap: Snapshot) -> list[Insight]:
    return [
        Insight(1, f"{leader.name}'s lead is mostly content.",
                f"They have {leader.article_count} articles. Publishing is the fastest way to close the gap.", "Start publishing", "voce"),
        Insight(2, f"Your reviews next to {leader.name}'s",
                f"Yours average {snap.review_avg:.1f} from {snap.review_count} reviews; they average {leader.review_avg:.1f} from {leader.review_count}.",
                "See reviews", "reviews"),
        Insight(3, "AI is starting to know you.", f"ChatGPT names you in {snap.ai_cited} of {snap.ai_checked} answers.", "Want to see why?", "insights"),
    ]


def _seat(seat: int, zipcode: str, now: datetime, ref: Reference) -> SeatHome:
    layout = LAYOUTS[_h(seat, "layout") % 3]
    n = _trial_day(seat, layout)
    started = datetime.combine(now.date() - timedelta(days=n - 1), time(9, 0))
    totals, times = _totals(seat, layout, n), _times(started, now, n)
    claim_total, latest_total = totals[0], totals[-1]
    city = CITIES[int(zipcode) % len(CITIES) if zipcode.isdigit() else 0]
    rank_of = _between(30, 50, "market", zipcode)
    maxima = {lane.key: lane.max_points for lane in ref.lanes}
    weights = {lane.key: 0.5 + _frac(seat, "lane", lane.key) for lane in ref.lanes}
    profile = (_between(35, 59, seat, "pc0"), {"day1": _between(60, 69, seat, "pc1"), "day7": _between(70, 82, seat, "pc1"),
                                              "day24": _between(82, 95, seat, "pc1")}[layout])
    reviews = (_between(15, 74, seat, "rv0"), 0)
    reviews = (reviews[0], reviews[0] + _between(5, 80, seat, "rv1"))
    avg_latest = round(4.0 + _between(0, 9, seat, "avg") / 10, 1)
    avg_claim = max(3.5, round(avg_latest - 0.2, 1))
    ai = (_between(0, 2, seat, "ai0"), 0)
    ai = (ai[0], min(7, ai[0] + _between(0, 4, seat, "ai1")))
    jitter = _h(seat, "rankj") % 3
    span = max(1, latest_total - claim_total)
    snaps = []
    for i, (total, at) in enumerate(zip(totals, times, strict=True)):
        progress = (total - claim_total) / span
        newest = i == len(totals) - 1
        position = min(rank_of, 2 + int((rank_of - 2) * ((850 - total) / 850) ** 2) + jitter)
        snaps.append(Snapshot(
            as_of=at, total=total, band=band_of(ref.bands, total), rank_position=position, rank_of=rank_of, rank_city=city,
            profile_strength_pct=round(profile[0] + (profile[1] - profile[0]) * progress),
            review_avg=round(avg_claim + (avg_latest - avg_claim) * progress, 1),
            review_count=round(reviews[0] + (reviews[1] - reviews[0]) * progress),
            map_scanned_at=now - timedelta(days=_between(1, 9, seat, "scan")) if newest else None,
            ai_cited=round(ai[0] + (ai[1] - ai[0]) * progress), ai_checked=7, ai_checked_at=at - timedelta(hours=2),
            lanes=_allocate(total, weights, maxima), cells=_cells(seat) if newest else [],
        ))
    leader_comps = _competitors(seat, latest_total, snaps[-1].rank_position)
    pick = _h(seat, "plan") % 10
    plan = "amplify" if pick == 0 else "engage" if pick <= 2 else "core"
    moves_done, streak = ((0, 0) if layout == "day1" else (_between(0, 3, seat, "moves"), 1 if layout == "day7" else _between(2, 4, seat, "streak")))
    state = State(plan, started, 30, moves_done, 3, streak, _NORA_TEXT_DAYS[_h(seat, "nora") % 3], True)
    return SeatHome(
        seat_id=seat, layout=layout, day_n=n, state=state, snapshots=snaps, competitors=leader_comps,
        activities=_activities(seat, started, now, latest_total - claim_total),
        moves=_moves(seat, leader_comps[0], snaps[-1].lanes, maxima), locked=_locked(seat),
        brief=_brief(seat, snaps, maxima), drafts=_drafts(seat, layout, now), events=_events(seat, layout, now),
        insights=_insights(leader_comps[0], snaps[-1]),
    )


def build_home_plan(seat_ids: list[int], as_of: date | datetime, markets: dict[int, str] | None = None) -> HomePlan:
    """The rows every seat should have, relative to `as_of` (the day, at 12:00). `markets` maps a seat to its zipcode (default 52801)."""
    day = as_of.date() if isinstance(as_of, datetime) else as_of
    now = datetime.combine(day, time(12, 0))
    ref = reference()
    seats = [_seat(s, (markets or {}).get(s, DEFAULT_ZIPCODE), now, ref) for s in sorted(set(seat_ids))]
    return HomePlan(ref, seats)
