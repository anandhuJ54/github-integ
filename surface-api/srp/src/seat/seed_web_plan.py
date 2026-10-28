"""The mock rows behind the Web analytics page, as plain values (srp/web-analytics-page-schema, task 3). Pure: no database, no clock.

`build_web_plan(home, profile, published)` reads the Home plan (the seat's SRS v5 website lane points), the Profile plan (the facts the audit compares with) and the number
of published articles per seat, and returns for every seat its ten `web_checks` rows; `align_home(home, web)` returns the Home plan with the `website` row of the SRS lane
gaps and the `website` next move following the markup state. `seed_home` turns them into writes. Nothing here carries a date, so the same plans always give the same rows.

Deterministic: a seat's rows depend only on its Home and Profile rows, never on the other seats, their order or the time of day. Everything is labelled mock and names nobody.

The rules the page applies, and the other pages show, hold by construction (and are tested, the lesson of the earlier reviews):
  * the four scored checks add up to the seat's website lane (and their maxima, 42 + 30 + 20 + 10, to the lane's 102); `nap` is 10 points for each of name, address and
    office phone in the Profile, and the rest of the lane goes to markup, indexing and service pages within their caps; a lane that cannot be split stops the plan;
  * a scored check's state follows its points (the database enforces it too);
  * markup is none, partial or full, the SRS gap text and Home's move text follow it (`align_home`), and it is full only when the lane leaves it no choice;
  * speed is the worst of LCP, INP and CLS by the web-vitals thresholds; AI readiness is five signals named in its result and counted in its headline; content follows the
    published articles Home shows; a failing service-pages result names only products the seat has in its Profile.
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass

from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_profile_plan as pp

SEED_TAG = "web-v1"
KEYS = ("entity_markup", "nap", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion", "reviews_on_site", "security")
SCORED = {"entity_markup": 42, "nap": 30, "indexing": 20, "service_pages": 10}  # the prototype's split of the 102-point lane (mock, unruled)
HEADLINED = ("speed", "ai_readiness")
_SCAN = ("From your site scan", "platform_observed")
SOURCES = {"entity_markup": _SCAN, "nap": _SCAN, "indexing": ("From Google Search Console", "imported"), "service_pages": _SCAN,
           "speed": ("From PageSpeed", "imported"), "ai_readiness": _SCAN, "content": _SCAN, "conversion": _SCAN, "reviews_on_site": _SCAN, "security": _SCAN}
GAP_TEXT = {"none": "No markup", "partial": "Partial markup", "full": "Full markup"}
MOVE_TEXT = {"none": "Markup is missing on your site", "partial": "Markup is incomplete on your site", "full": "Your markup is complete"}
_AI_POSITIVE = ("GPTBot allowed in robots.txt", "llms.txt present", "FAQ present", "content in the page HTML", "clear title and description tags")
_AI_NEGATIVE = ("GPTBot blocked in robots.txt", "no llms.txt", "no FAQ", "content built by scripts", "missing title or description tags")


@dataclass(frozen=True)
class Check:
    key: str
    state: str
    result: str
    headline: str | None
    points: int | None
    points_max: int | None
    source: str
    trust_tier: str


@dataclass(frozen=True)
class SeatWeb:
    seat_id: int
    lane_points: int  # the seat's SRS v5 website lane in its newest snapshot: the four scored checks add up to it, and Home's Website tile shows it
    checks: list[Check]


@dataclass(frozen=True)
class WebPlan:
    seats: list[SeatWeb]


# --- deterministic helpers ------------------------------------------------------------------------------------------

def _h(*parts: object) -> int:
    return hp._h(SEED_TAG, *parts)


def _between(lo: int, hi: int, *parts: object) -> int:
    """An integer from lo to hi, both included."""
    return lo + _h(*parts) % (hi - lo + 1)


def markup_state(points: int) -> str:
    return "none" if points == 0 else "full" if points == SCORED["entity_markup"] else "partial"


def _state(points: int, maximum: int) -> str:
    return "pass" if points == maximum else "fail" if points == 0 else "warn"


def _check(key: str, state: str, result: str, headline: str | None = None, points: int | None = None) -> Check:
    source, tier = SOURCES[key]
    return Check(key, state, result, headline, points, SCORED.get(key) if points is not None else None, source, tier)


# --- the website split ----------------------------------------------------------------------------------------------

def _split(seat: int, lane: int, nap: int) -> dict[str, int]:
    """Points of the four scored checks, adding up to `lane`: nap is given, the rest (at most 72) goes to markup, indexing and service pages."""
    rest = lane - nap
    if rest < 0 or rest > SCORED["entity_markup"] + SCORED["indexing"] + SCORED["service_pages"]:
        raise ValueError(f"seat {seat}: the website lane of {lane} points cannot be split (name, address and phone give {nap}; the other three checks hold 0 to 72)")
    others = SCORED["indexing"] + SCORED["service_pages"]
    lo, hi = max(0, rest - others), min(SCORED["entity_markup"], rest)
    if lo == SCORED["entity_markup"]:
        markup = lo  # the lane leaves markup no choice
    elif hp._h(seat, "markup") % 2 == 1 and lo == 0:
        markup = 0  # "No markup", as the Home plan said by its own coin, wherever the lane allows it
    else:
        markup = _between(max(1, lo), min(SCORED["entity_markup"] - 1, hi), seat, "markup-points") if hi >= 1 else 0
    left = rest - markup
    mode = _h(seat, "split") % 10
    if mode < 4:  # balanced
        spread = hp._allocate(left, {"indexing": 0.5 + hp._frac(SEED_TAG, seat, "w-idx"), "service_pages": 0.5 + hp._frac(SEED_TAG, seat, "w-svc")},
                              {"indexing": SCORED["indexing"], "service_pages": SCORED["service_pages"]})
    elif mode < 7:  # indexing is done first
        spread = {"indexing": min(SCORED["indexing"], left)}
        spread["service_pages"] = left - spread["indexing"]
    else:  # service pages first
        spread = {"service_pages": min(SCORED["service_pages"], left)}
        spread["indexing"] = left - spread["service_pages"]
    return {"entity_markup": markup, "nap": nap, "indexing": spread["indexing"], "service_pages": spread["service_pages"]}


def _nap_result(address: bool, phone: bool, name: bool) -> str:
    missing = [w for w, ok in (("name", name), ("address", address), ("phone", phone)) if not ok]
    if not missing:
        return "Matches the profile"
    words = " and ".join(missing) if len(missing) < 3 else "name, address and phone"
    return f"{words[0].upper()}{words[1:]} missing from your profile"


def _scored(seat: int, points: dict[str, int], profile: pp.SeatProfile) -> list[Check]:
    facts = {f.field: f for f in profile.facts}
    products = facts["products"].value if "products" in facts and facts["products"].value else []
    mk = points["entity_markup"]
    markup_text = {"fail": "No structured data on the page", "warn": "Structured data is incomplete", "pass": "Complete structured data on the page"}
    index_text = {"fail": "Not indexed", "warn": "Indexed; no sitemap", "pass": "Indexed with a sitemap"}
    st = _state(points["service_pages"], SCORED["service_pages"])
    if st == "fail":
        service = "No pages for " + " or ".join(products[:2]) + " loans" if products else "No service pages"
    elif st == "warn":
        service = "Service pages for some of your loan products" if products else "Some service pages found"
    else:
        service = "Pages for each loan product" if products else "Service pages found"
    return [
        _check("entity_markup", _state(mk, 42), markup_text[_state(mk, 42)], points=mk),
        _check("nap", _state(points["nap"], 30), _nap_result("address" in facts, "office_phone" in facts, "name" in facts), points=points["nap"]),
        _check("indexing", _state(points["indexing"], 20), index_text[_state(points["indexing"], 20)], points=points["indexing"]),
        _check("service_pages", st, service, points=points["service_pages"]),
    ]


# --- the unscored checks ---------------------------------------------------------------------------------------------

# web-vitals thresholds: (good up to, needs work up to); beyond the second a metric is poor
_LCP, _INP, _CLS = (2.5, 4.0), (200, 500), (0.10, 0.25)


def _speed(seat: int) -> Check:
    target = ("pass", "warn", "fail")[(0 if _h(seat, "speed") % 100 < 35 else 1 if _h(seat, "speed") % 100 < 75 else 2)]
    worst = _h(seat, "speed-worst") % 3
    kinds = []
    for i in range(3):
        if i == worst:
            kinds.append({"pass": "good", "warn": "needs", "fail": "poor"}[target])
        else:
            kinds.append("good" if target == "pass" else ("good", "needs")[_h(seat, "speed-other", i) % 2])
    lcp = {"good": _between(12, 25, seat, "lcp"), "needs": _between(26, 40, seat, "lcp"), "poor": _between(41, 65, seat, "lcp")}[kinds[0]] / 10
    inp = {"good": _between(60, 200, seat, "inp"), "needs": _between(210, 500, seat, "inp"), "poor": _between(520, 900, seat, "inp")}[kinds[1]]
    cls = {"good": _between(0, 10, seat, "cls"), "needs": _between(11, 25, seat, "cls"), "poor": _between(26, 50, seat, "cls")}[kinds[2]] / 100
    note = {"good": "", "needs": " (needs work)", "poor": " (poor)"}
    shown = (f"LCP {lcp:.1f} s", f"INP {inp} ms", f"CLS {cls:.2f}")
    rank = {"good": 0, "needs": 1, "poor": 2}
    worst_metric = max(range(3), key=lambda i: (rank[kinds[i]], -i))  # the tile shows the metric that sets the state (the LCP when all are good)
    return _check("speed", target, ", ".join(shown[i] + note[kinds[i]] for i in range(3)), headline=shown[worst_metric])


def _ai_readiness(seat: int) -> Check:
    present = [_h(seat, "ai", i) % 100 < 45 for i in range(5)]
    k = sum(present)
    result = "; ".join(p if ok else n for ok, p, n in zip(present, _AI_POSITIVE, _AI_NEGATIVE, strict=True))
    return _check("ai_readiness", "pass" if k == 5 else "warn" if k >= 2 else "fail", result, headline=f"{k} of 5")


def _content(published: int) -> Check:
    if published == 0:
        return _check("content", "fail", "No blog")
    return _check("content", "pass" if published >= 3 else "warn", f"Blog with {published} post{'' if published == 1 else 's'}")


def _conversion(seat: int) -> Check:
    call, booking = _h(seat, "call") % 100 < 75, _h(seat, "booking") % 100 < 40
    if call and booking:
        return _check("conversion", "pass", "Click-to-call and a booking link")
    if call or booking:
        return _check("conversion", "warn", "Click-to-call yes; no booking link" if call else "Booking link yes; no click-to-call")
    return _check("conversion", "fail", "No click-to-call and no booking link")


def _reviews_on_site(seat: int) -> Check:
    return _check("reviews_on_site", "pass", "Reviews widget installed") if _h(seat, "widget") % 2 == 0 else _check("reviews_on_site", "fail", "Widget not installed")


def _security(seat: int, url: str | None) -> Check:
    """Security follows the site's own address when it is known (an https address cannot fail with "served over HTTP"); otherwise a coin."""
    scheme = (url or "").strip().lower()
    https = scheme.startswith("https://") if scheme.startswith(("http://", "https://")) else _h(seat, "https") % 100 < 92
    return _check("security", "pass", "HTTPS") if https else _check("security", "fail", "No HTTPS (the page is served over HTTP)")


# --- the plan ---------------------------------------------------------------------------------------------------------------

def _seat(home_seat: hp.SeatHome, profile: pp.SeatProfile, published: int, url: str | None) -> SeatWeb:
    seat = home_seat.seat_id
    lane = home_seat.snapshots[-1].lanes["website"]
    facts = {f.field for f in profile.facts}
    nap = 10 * (("name" in facts) + ("address" in facts) + ("office_phone" in facts))
    points = _split(seat, lane, nap)
    by = {c.key: c for c in (*_scored(seat, points, profile), _speed(seat), _ai_readiness(seat), _content(published), _conversion(seat), _reviews_on_site(seat), _security(seat, url))}
    return SeatWeb(seat, lane, [by[k] for k in KEYS])


def build_web_plan(home: hp.HomePlan, profile: pp.ProfilePlan, published: dict[int, int], urls: dict[int, str | None] | None = None) -> WebPlan:
    """The ten checks of every seat of the Home plan. `published` maps a seat to its published, not archived, articles (what Home shows) and `urls` to its site address."""
    by_profile = {s.seat_id: s for s in profile.seats}
    return WebPlan([_seat(s, by_profile[s.seat_id], published.get(s.seat_id, 0), (urls or {}).get(s.seat_id)) for s in sorted(home.seats, key=lambda s: s.seat_id)])


def _markup_open(web_seat: SeatWeb) -> int:
    markup = next(c for c in web_seat.checks if c.key == "entity_markup")
    return markup.points_max - markup.points


def _brief_items(items: list[hp.BriefItem], kind: str) -> list[hp.BriefItem]:
    """The weekly brief's "Website markup fixed" follows the markup state: gone when there is no markup (its points go to the first item left, so the week's total is the same),
    "improved" when it is partial, as it was when it is complete."""
    if not any(i.label == "Website markup fixed" for i in items) or kind == "full":
        return items
    if kind == "partial":
        return [dataclasses.replace(i, label="Website markup improved") if i.label == "Website markup fixed" else i for i in items]
    gone = next(i for i in items if i.label == "Website markup fixed")
    rest = [i for i in items if i is not gone]
    rest[0] = dataclasses.replace(rest[0], points=rest[0].points + gone.points)
    return [dataclasses.replace(i, position=n + 1) for n, i in enumerate(rest)]


def align_home(home: hp.HomePlan, web: WebPlan) -> hp.HomePlan:
    """The Home plan with the SRS lane gap, the next move and the weekly brief of the website following the markup state of the seat's checks; nothing else changes.
    The "Fix my website" move (and the brief's next move) is worth what markup has open, as its subtitle says."""
    by_web = {s.seat_id: s for s in web.seats}
    seats = []
    for s in home.seats:
        w = by_web[s.seat_id]
        kind = markup_state(next(c.points for c in w.checks if c.key == "entity_markup"))
        open_ = _markup_open(w)
        gaps = [dataclasses.replace(g, you_text=GAP_TEXT[kind]) if g.lane == "website" else g for g in s.gaps]
        moves = [dataclasses.replace(m, subtitle=MOVE_TEXT[kind], points=open_) if m.target == "website" else m for m in s.moves]
        brief = dataclasses.replace(s.brief, next_move_points=max(1, open_), items=_brief_items(s.brief.items, kind))
        seats.append(dataclasses.replace(s, gaps=gaps, moves=moves, brief=brief))
    return dataclasses.replace(home, seats=seats)
