"""The SRS page's data for a local sign-in (srp/srs-page-schema): score, band, rank, rival, the ten SRS v5 lanes, the filter counts and NORA's notes.

Reads `<schema>.*` (default `srp_cleanup`) for the signed-in user's OWN seat only (a `tier_agents.id`; anything else is 403, whether or not it
exists), on the API's own database login, in one connection, with `SELECT` only and no lock. The transaction is declared READ ONLY, so the
database itself refuses a write. The ownership check comes first (the same one the Home read applies: `home.owner_of`).

The score, band, rank and rival come from the same functions the Home read uses (`home._band`, `_rank`, `_rival`), so the two pages cannot
disagree for a seat. The lanes are the SRS v5 lanes in `home_score_lanes` (850 points); the stored "you vs rival" text and action of each lane are in
`srs_lane_gaps`. Earned and open points are never stored: earned is the lane's points in the newest snapshot, open is the budget minus earned.
The legacy `srs_config_*`, `user_search_rank_scores` and `ai_authority_stats` are not read. A seat with no seat state or no snapshot is
`ready: false` and every other section is `None`; a lane with no points in the snapshot is unknown (None), never zero.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from _base.config import get_settings
from _base.db.session import connection  # tests replace this name
from surfaces.srp.seat import home

STRONG_SHARE = (3, 4)  # a lane is Strong from 3/4 of its budget (a mock rule, decision N3; integers, so there is no rounding)
_SECTIONS = ("score", "rank", "rival", "lanes", "counts", "notes")


def _status(lane: dict, gap: dict | None, locked: set[str]) -> str | None:
    """Strong from three quarters of the budget; else Missing when the seat has none of what the lane measures; else locked behind a higher
    plan; else Fix. None when the lane's points are unknown."""
    earned, budget = lane["points"], lane["max_points"]
    if earned is None:
        return None
    if budget > 0 and earned * STRONG_SHARE[1] >= budget * STRONG_SHARE[0]:
        return "Strong"
    if gap and gap["is_missing"]:
        return "Missing"
    return "Fix · locked" if lane["key"] in locked else "Fix"


def _lanes(lanes: list[dict], gaps: dict[str, dict], locked: set[str]) -> list[dict[str, Any]]:
    out = []
    for lane in lanes:
        gap = gaps.get(lane["key"])
        earned = lane["points"]
        out.append({
            "key": lane["key"], "name": lane["name"], "short_name": lane["short_name"], "earned": earned, "max": lane["max_points"],
            "open": None if earned is None else lane["max_points"] - earned, "status": _status(lane, gap, locked),
            "you_text": gap["you_text"] if gap else None, "rival_text": gap["rival_text"] if gap else None, "note": gap["note"] if gap else None,
            "action_label": gap["action_label"] if gap else None, "action_target": gap["action_target"] if gap else None,
            "_position": lane["position"],
        })
    # most open points first, ties in lane order; a lane with unknown points goes last
    out.sort(key=lambda l: (l["open"] is None, -(l["open"] or 0), l["_position"]))
    return out


def _counts(lanes: list[dict]) -> dict[str, int]:
    status = [l["status"] for l in lanes]
    return {"all": len(lanes), "missing": status.count("Missing"), "fix": status.count("Fix") + status.count("Fix · locked"), "strong": status.count("Strong")}


def _points(n: int) -> str:
    return f"{n} point" if n == 1 else f"{n} points"


def _name(lane: dict) -> str:
    return lane["short_name"] or lane["name"]


def _notes(lanes: list[dict], band: dict | None, rival: dict | None) -> list[dict[str, Any]]:
    """NORA's notes (decision N1): templates over the lane and rival rows, authoritative numbers only. Up to three, in a fixed order."""
    notes: list[dict[str, Any]] = []
    open_lanes = [l for l in lanes if (l["open"] or 0) > 0]
    top = open_lanes[0] if open_lanes else None
    if top:
        nxt = band["next"] if band else None
        if nxt and top["open"] >= nxt["points_needed"]:
            title = f"{_name(top)} gets you to {nxt['name']}."
            body = f"It's {_points(top['open'])} open, and you only need {nxt['points_needed']} to cross {nxt['min_points']}."
        else:
            title, body = f"{_name(top)} is your biggest gap.", f"It's {_points(top['open'])} open."
        notes.append({"title": title, "body": body, "cta": top["action_label"], "action": top["action_target"]})
    second = next((l for l in open_lanes if l is not top and l["rival_text"] is not None), None)
    if second and rival:
        notes.append({"title": f"Your {_name(second)} is costing you {_points(second['open'])}.",
                      "body": f"{rival['name']}: {second['rival_text']}. You: {second['you_text']}.",
                      "cta": second["action_label"], "action": second["action_target"]})
    strong = [l for l in lanes if l["status"] == "Strong" and l["max"] > 0]
    best = max(strong, key=lambda l: (l["earned"] / l["max"], -l["_position"]), default=None)
    if best:
        notes.append({"title": f"{_name(best)} is already strong.",
                      "body": best["note"] or best["you_text"] or f"{best['earned']} of {best['max']} points earned.",
                      "cta": best["action_label"], "action": best["action_target"]})
    return notes


def srs(claims: dict, pro_id: str) -> dict[str, Any]:
    """The SRS page data for the signed-in user's own seat; 403 for any other id."""
    seat, user = home.parse_ids(claims, pro_id)
    s = get_settings().srp_local_schema
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with connection() as conn:
        conn.execute("set transaction read only")  # the first statement: the database refuses any write from here on
        home.owner_of(conn, s, seat, user)
        state = conn.execute(
            f"""select st.is_mock, p.key as plan_key, p.position as plan_position
                from {s}.home_seat_state st join {s}.home_plans p on p.id = st.plan_id
                where st.tier_agent_id = %s""", (seat,)).fetchone()
        snaps = conn.execute(
            f"""select sn.*, b.name as band_name from {s}.home_snapshots sn
                left join {s}.home_score_bands b on b.id = sn.band_id
                where sn.tier_agent_id = %s order by sn.as_of desc, sn.id desc limit 1""", (seat,)).fetchall() if state else []
        if not state or not snaps:
            return {"as_of": now, "data": None, "ready": False, **dict.fromkeys(_SECTIONS)}
        newest = snaps[0]
        lanes = conn.execute(
            f"""select l.key, l.name, l.short_name, l.max_points, l.position, sl.points
                from {s}.home_score_lanes l
                left join {s}.home_snapshot_lanes sl on sl.lane_id = l.id and sl.snapshot_id = %s
                order by l.position, l.id""", (newest["id"],)).fetchall()
        bands = conn.execute(f"select name, min_points from {s}.home_score_bands order by min_points").fetchall()
        comps = conn.execute(
            f"""select name, score, is_market_leader, review_count, review_avg, article_count, position
                from {s}.home_competitors where tier_agent_id = %s order by position, id""", (seat,)).fetchall()
        gaps = conn.execute(
            f"""select l.key, g.you_text, g.rival_text, g.note, g.is_missing, g.action_label, g.action_target
                from {s}.srs_lane_gaps g join {s}.home_score_lanes l on l.id = g.lane_id
                where g.tier_agent_id = %s order by l.position, g.id""", (seat,)).fetchall()
        features = conn.execute(
            f"""select l.key as lane_key, p.position as plan_position
                from {s}.home_locked_features f
                left join {s}.home_score_lanes l on l.id = f.lane_id
                join {s}.home_plans p on p.id = f.plan_id
                where f.tier_agent_id = %s order by f.id""", (seat,)).fetchall()
    total = newest["total"]
    budget = sum(l["max_points"] for l in lanes) if lanes else None
    band = home._band(bands, total)
    if band and band["next"]:
        band["next"] = {**band["next"], "points_needed": band["next"]["min_points"] - total}
    rank = home._rank([newest])
    rival = home._rival(comps, total)
    locked = {f["lane_key"] for f in features if f["lane_key"] and f["plan_position"] > state["plan_position"]}
    lane_rows = _lanes(lanes, {g["key"]: g for g in gaps}, locked)
    return {
        "as_of": now, "data": "mock" if state["is_mock"] else "live", "ready": True,
        "score": {"total": total, "max": budget, "open_total": None if budget is None else budget - total, "as_of": home._iso(newest["as_of"]), "band": band},
        "rank": {"position": rank["position"], "of": rank["of"], "city": rank["city"]} if rank else None,
        "rival": {k: rival[k] for k in ("name", "score", "points_to_first", "review_count", "review_avg")} if rival else None,
        "lanes": [{k: v for k, v in l.items() if k != "_position"} for l in lane_rows],
        "counts": _counts(lane_rows),
        "notes": _notes(lane_rows, band, rival),
    }
