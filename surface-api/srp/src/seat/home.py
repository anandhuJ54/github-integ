"""The Home page's data for a local sign-in (srp/home-page-schema): day and layout, person, trial, score, rank, rival (part 1), board, tiles, locked
features, peers, brief, drafts, events, insights, recap and plans (part 2).

Reads `<schema>.*` (default `srp_cleanup`) for the signed-in user's OWN seat only (a `tier_agents.id`; anything else is 403,
whether or not it exists), on the API's own database login, in one connection, with `SELECT` only and no lock. The transaction is
declared READ ONLY, so the database itself refuses a write. The ownership check comes first: nothing else is read for a seat that is not theirs.

Stored rows come from the `home_*` tables (see `srp/db/local/home_schema.sql`); everything the page derives from them is computed here,
deterministically (spec step 3): the day number and layout, the band, since you claimed, this week's change, points to #1. A seat with no
`home_seat_state` row or no snapshot is `ready: false` and every other section is `None`: unknown, never zero.
"""
from __future__ import annotations

import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException, status

from _base.config import get_settings
from _base.db.session import connection  # tests replace this name

_ID = re.compile(r"[0-9]{1,18}")
_YEAR = re.compile(r"[0-9]{4}")
_SECTIONS = ("day", "person", "trial", "score", "rank", "rival", "competitors", "board", "tiles", "locked", "peers", "brief", "drafts",
             "events", "insights", "recap", "plans")


def _forbidden() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, "not_your_seat")


def _today() -> date:
    return datetime.now(UTC).date()


def _iso(value: Any) -> str | None:
    """An ISO time stamp. The columns are `timestamp without time zone` holding UTC, so a naive value gets the `Z` that `as_of` already has;
    otherwise the browser would read it as local time."""
    if isinstance(value, datetime):
        return value.isoformat() + ("Z" if value.tzinfo is None else "")
    return str(value) if value is not None else None


def _year(raw: Any) -> int | None:
    text = str(raw).strip() if raw is not None else ""
    return int(text) if _YEAR.fullmatch(text) else None


def _float(value: Any) -> float | None:
    return float(value) if value is not None else None


# --- computed values (spec step 3) -----------------------------------------------------------------------------

def _day(state: dict, today: date) -> dict[str, Any]:
    """Whole days from the trial start to today, plus 1 (at least 1). After the trial it stays on the last day and `over` is true."""
    trial_days = int(state["trial_days"])
    n = max(1, (today - state["trial_started_at"].date()).days + 1)
    shown = min(n, trial_days)
    return {"n": shown, "trial_days": trial_days, "layout": "day1" if shown < 7 else "day7" if shown < 24 else "day24", "over": n > trial_days}


def _band(bands: list[dict], total: int) -> dict[str, Any] | None:
    """The band with the highest minimum not above the total, and the next one up."""
    ordered = sorted(bands, key=lambda b: b["min_points"])
    mine = [b for b in ordered if b["min_points"] <= total]
    if not mine:
        return None
    nxt = next((b for b in ordered if b["min_points"] > total), None)
    return {"name": mine[-1]["name"], "min_points": mine[-1]["min_points"],
            "next": {"name": nxt["name"], "min_points": nxt["min_points"]} if nxt else None}


def _score(snaps: list[dict], lanes: list[dict], bands: list[dict], claim_id: Any) -> dict[str, Any]:
    newest = snaps[-1]
    claim = next((s for s in snaps if s["id"] == claim_id), None)
    cutoff = newest["as_of"] - timedelta(days=7)
    week = next((s for s in reversed(snaps[:-1]) if s["as_of"] <= cutoff), None)
    return {
        "total": newest["total"],
        "max": sum(l["max_points"] for l in lanes) if lanes else None,
        "band": _band(bands, newest["total"]),
        "as_of": _iso(newest["as_of"]),
        "since_claim": newest["total"] - claim["total"] if claim else None,
        "week_delta": newest["total"] - week["total"] if week else None,
        "lanes": [{"key": l["key"], "name": l["name"], "points": l["points"], "max": l["max_points"]} for l in lanes],
    }


def _rank(snaps: list[dict]) -> dict[str, Any] | None:
    newest = snaps[-1]
    if newest["rank_position"] is None or newest["rank_of"] is None:
        return None
    return {"position": newest["rank_position"], "of": newest["rank_of"], "city": newest["rank_city"], "first_position": snaps[0]["rank_position"]}


def _rival(comps: list[dict], total: int) -> dict[str, Any] | None:
    """The best-scoring competitor, when they outscore the seat."""
    best = max(comps, key=lambda c: (c["score"], -c["position"]), default=None)
    if best is None or best["score"] <= total:
        return None
    return {"name": best["name"], "initial": (best["name"] or "?")[:1].upper(), "score": best["score"], "points_to_first": best["score"] - total,
            "review_count": best["review_count"], "review_avg": _float(best["review_avg"]), "article_count": best["article_count"]}


def _person(owner: dict) -> dict[str, Any]:
    first, last = (owner.get("first_name") or "").strip(), (owner.get("last_name") or "").strip()
    return {"first_name": first or None, "full_name": " ".join(p for p in (first, last) if p) or None, "title": owner.get("title"),
            "photo_url": owner.get("profile_photo"), "year_started": _year(owner.get("year_started")), "credentials": int(owner.get("credentials") or 0)}


def _since(snaps: list[dict]) -> dict | None:
    """The newest snapshot at least a week older than the newest, else the earliest one (when it is not the newest itself)."""
    cutoff = snaps[-1]["as_of"] - timedelta(days=7)
    week = next((x for x in reversed(snaps[:-1]) if x["as_of"] <= cutoff), None)
    return week or (snaps[0] if len(snaps) > 1 else None)


def _board(state: dict, acts: list[dict], moves: list[dict], drafts: list[dict]) -> dict[str, Any]:
    stamp = lambda a: a["completed_at"] or a["started_at"] or datetime.min  # both times may be null: such a row sorts first
    ordered = sorted(acts, key=stamp)
    done = [a for a in ordered if a["status"] == "done"]
    latest = ordered[-1] if ordered else None
    return {
        "latest": None if latest is None else {"label": latest["label"], "points": latest["points"], "status": latest["status"],
                                               "started_at": _iso(latest["started_at"]), "completed_at": _iso(latest["completed_at"])},
        "done": [{"label": a["label"], "points": a["points"]} for a in reversed(done)],
        "done_count": len(done),
        "since_claim_points": sum(a["points"] or 0 for a in done),
        "next_moves": [{"icon": m["icon"], "title": m["title"], "subtitle": m["subtitle"], "recommended": m["recommended"], "target": m["target"],
                        "points": m["points"]} for m in moves],
        "moves": {"done": state["moves_done"], "goal": state["moves_goal"]},
        "streak_weeks": state["streak_weeks"],
        "needs_you_count": sum(1 for d in drafts if d["status"] == "draft"),
    }


def _tiles(snaps: list[dict], cells: list[dict], articles: dict, web: dict | None, lanes: list[dict]) -> dict[str, Any]:
    newest, before = snaps[-1], _since(snaps)
    website_max = next((l["max_points"] for l in lanes if l["key"] == "website"), None)
    return {
        "map": None if not cells else {
            "scanned_at": _iso(newest["map_scanned_at"]), "total": len(cells),
            "top3": sum(1 for c in cells if c["rank"] is not None and c["rank"] <= 3),
            "cells": [{"row": c["row_no"], "col": c["col_no"], "rank": c["rank"]} for c in cells]},
        "ai": None if newest["ai_checked"] is None else {"cited": newest["ai_cited"], "checked": newest["ai_checked"], "checked_at": _iso(newest["ai_checked_at"])},
        "reviews": {"avg": _float(newest["review_avg"]), "count": newest["review_count"], "as_of": _iso(newest["as_of"])},
        "profile_strength": {"pct": newest["profile_strength_pct"], "previous_pct": before["profile_strength_pct"] if before else None},
        "website": None if not web else {"score": web["total_score"], "max": website_max, "url": web["website_url"]},
        "articles": {"published": int(articles["published"] or 0), "total": int(articles["total"] or 0)},
    }


def _locked(state: dict, features: list[dict], lanes: list[dict]) -> dict[str, Any]:
    """Features whose plan is above the seat's; the points waiting are the lane's unearned points (None when there is no lane or no known points)."""
    points = {l["key"]: l["points"] for l in lanes}
    maxima = {l["key"]: l["max_points"] for l in lanes}
    out = []
    for f in features:
        if f["plan_position"] <= state["plan_position"]:
            continue
        lane = f["lane_key"]
        waiting = max(0, maxima[lane] - points[lane]) if lane in maxima and points.get(lane) is not None else None
        out.append({"key": f["feature_key"], "title": f["title"], "description": f["description"], "points_waiting": waiting, "plan": f["plan_key"]})
    return {"features": out, "points_waiting": sum(f["points_waiting"] or 0 for f in out)}


def _peers(snaps: list[dict], bands: list[dict], benchmarks: list[dict]) -> dict[str, Any] | None:
    started = _band(bands, snaps[0]["total"])
    b = next((x for x in benchmarks if started and x["band_name"] == started["name"]), None)
    if b is None:
        return None
    return {"band_from": b["band_name"], "median_gain": b["median_gain"], "horizon_days": b["horizon_days"], "cohort_size": b["cohort_size"],
            "cohort_period": b["cohort_period"], "reached_next_band": b["reached_next_band"], "of": b["cohort_of"]}


def _brief(row: dict | None, items: list[dict]) -> dict[str, Any] | None:
    if row is None:
        return None
    return {"week_start": _iso(row["week_start"]), "points_total": sum(i["points"] or 0 for i in items),
            "items": [{"label": i["label"], "points": i["points"]} for i in items],
            "next_move": {"label": row["next_move_label"], "points": row["next_move_points"], "target": row["next_move_target"]},
            "away": {"new_reviews": row["away_new_reviews"], "bio_live": row["away_bio_live"], "first_article": row["away_first_article"]}}


def _recap(day: dict, snaps: list[dict], board: dict, tiles: dict, drafts: list[dict]) -> dict[str, Any] | None:
    if day["layout"] != "day24":
        return None
    first, last = snaps[0], snaps[-1]
    tile = lambda label, a, b: {"label": label, "from": a, "to": b, "delta": a - b if label == "Rank" else b - a}  # a lower rank number is better
    tiles_out = [tile("Score", first["total"], last["total"])]
    if first["rank_position"] is not None and last["rank_position"] is not None:
        tiles_out.append(tile("Rank", first["rank_position"], last["rank_position"]))
    if first["profile_strength_pct"] is not None and last["profile_strength_pct"] is not None:
        tiles_out.append(tile("Profile strength", first["profile_strength_pct"], last["profile_strength_pct"]))
    return {"days": day["n"], "things_done": board["done_count"], "tiles": tiles_out, "articles": tiles["articles"]["published"],
            "replies": sum(1 for d in drafts if d["status"] == "posted")}


# --- the read ----------------------------------------------------------------------------------------------

def home(claims: dict, pro_id: str) -> dict[str, Any]:
    """The Home data for the signed-in user's own seat; 403 for any other id."""
    sub = str(claims.get("sub") or "")
    if not _ID.fullmatch(pro_id) or not _ID.fullmatch(sub):
        raise _forbidden()
    seat, user = int(pro_id), int(sub)
    s = get_settings().srp_local_schema
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with connection() as conn:
        conn.execute("set transaction read only")  # the first statement: the database refuses any write from here on
        owner = conn.execute(
            f"""select ta.id, ta.title, ta.profile_photo, ta.year_started, u.first_name, u.last_name,
                       case when jsonb_typeof(d.certifications) = 'array'
                            then jsonb_array_length(d.certifications) else 0 end as credentials
                from {s}.tier_agents ta
                join {s}.users u on u.id = ta.user_id
                left join lateral (
                    select certifications from {s}.tier_agent_details
                    where tier_agent_id = ta.id order by id limit 1
                ) d on true
                where ta.id = %s and ta.user_id = %s and ta.deleted_at is null
                  and u.deleted_at is null and u.deactivated_at is null
                  and not coalesce(u.is_manual_deactivated, false)""",
            (seat, user),
        ).fetchone()
        if owner is None:  # the ownership check comes first: nothing else is read for a seat that is not theirs
            raise _forbidden()
        state = conn.execute(
            f"""select st.trial_started_at, st.trial_days, st.nora_text_day, st.is_mock, st.claim_snapshot_id, st.moves_done, st.moves_goal, st.streak_weeks,
                       p.key as plan_key, p.name as plan_name, p.tag as plan_tag, p.position as plan_position
                from {s}.home_seat_state st join {s}.home_plans p on p.id = st.plan_id
                where st.tier_agent_id = %s""",
            (seat,),
        ).fetchone()
        snaps = conn.execute(
            f"""select sn.*, b.name as band_name from {s}.home_snapshots sn
                left join {s}.home_score_bands b on b.id = sn.band_id
                where sn.tier_agent_id = %s order by sn.as_of, sn.id""",
            (seat,),
        ).fetchall() if state else []
        if not state or not snaps:
            return {"as_of": now, "data": None, "ready": False, **dict.fromkeys(_SECTIONS)}
        lanes = conn.execute(
            f"""select l.key, l.name, l.max_points, sl.points
                from {s}.home_score_lanes l
                left join {s}.home_snapshot_lanes sl on sl.lane_id = l.id and sl.snapshot_id = %s
                order by l.position, l.id""",
            (snaps[-1]["id"],),
        ).fetchall()
        bands = conn.execute(f"select name, min_points from {s}.home_score_bands order by min_points").fetchall()
        comps = conn.execute(
            f"""select name, score, is_market_leader, review_count, review_avg, article_count, position
                from {s}.home_competitors where tier_agent_id = %s order by position, id""",
            (seat,),
        ).fetchall()
        acts = conn.execute(
            f"""select label, points, status, started_at, completed_at from {s}.home_activity
                where tier_agent_id = %s order by coalesce(completed_at, started_at), id""", (seat,)).fetchall()
        moves = conn.execute(
            f"""select position, icon, title, subtitle, recommended, target, points from {s}.home_next_moves
                where tier_agent_id = %s order by position, id""", (seat,)).fetchall()
        features = conn.execute(
            f"""select f.feature_key, f.title, f.description, l.key as lane_key, p.key as plan_key, p.position as plan_position
                from {s}.home_locked_features f
                left join {s}.home_score_lanes l on l.id = f.lane_id
                join {s}.home_plans p on p.id = f.plan_id
                where f.tier_agent_id = %s order by f.id""", (seat,)).fetchall()
        benchmarks = conn.execute(
            f"""select b.name as band_name, pb.median_gain, pb.horizon_days, pb.cohort_size, pb.cohort_period, pb.reached_next_band, pb.cohort_of
                from {s}.home_peer_benchmarks pb join {s}.home_score_bands b on b.id = pb.band_id order by b.min_points""").fetchall()
        brief = conn.execute(
            f"""select id, week_start, next_move_label, next_move_points, next_move_target, away_new_reviews, away_bio_live, away_first_article
                from {s}.home_weekly_briefs where tier_agent_id = %s order by week_start desc, id desc limit 1""", (seat,)).fetchone()
        brief_items = conn.execute(
            f"select position, label, points from {s}.home_weekly_brief_items where brief_id = %s order by position, id", (brief["id"],)
        ).fetchall() if brief else []
        drafts = conn.execute(
            f"""select id, reviewer_label, rating, review_text, draft_text, compliance_status, status from {s}.home_review_drafts
                where tier_agent_id = %s order by created_at desc, id""", (seat,)).fetchall()
        events = conn.execute(
            f"""select kind, title, body, action_label, expires_at from {s}.home_events
                where tier_agent_id = %s order by created_at, id""", (seat,)).fetchall()
        insights = conn.execute(
            f"""select position, title, body, cta, action from {s}.home_nora_insights where tier_agent_id = %s order by position, id""", (seat,)).fetchall()
        plans = conn.execute(f"select key, name, tag, highlight, items from {s}.home_plans order by position, id").fetchall()
        cells = conn.execute(
            f"select row_no, col_no, rank from {s}.home_map_cells where snapshot_id = %s order by row_no, col_no", (snaps[-1]["id"],)).fetchall()
        articles = conn.execute(
            f"""select count(*) filter (where published and article_archived_at is null) as published,
                       count(*) filter (where article_archived_at is null) as total
                from {s}.voce_articles where tier_agent_id = %s""", (seat,)).fetchone()
        web = conn.execute(
            f"""select total_score, website_url from {s}.website_analytics_data where tier_agent_id = %s
                order by last_refreshed_time desc nulls last, id desc limit 1""", (seat,)).fetchone()
    today = _today()
    day = _day(state, today)
    live_events = [e for e in events if e["expires_at"] is None or e["expires_at"] >= datetime.combine(today, time.min)]
    open_drafts = [d for d in drafts if d["status"] == "draft"]
    board = _board(state, acts, moves, drafts)
    tiles = _tiles(snaps, cells, articles, web, lanes)
    sections = dict.fromkeys(_SECTIONS)
    sections.update(
        day=day,
        person=_person(owner),
        trial={"plan": {"key": state["plan_key"], "name": state["plan_name"], "tag": state["plan_tag"]},
               "started_at": _iso(state["trial_started_at"]), "nora_text_day": state["nora_text_day"]},
        score=_score(snaps, lanes, bands, state["claim_snapshot_id"]),
        rank=_rank(snaps),
        rival=_rival(comps, snaps[-1]["total"]),
        competitors={"count": len(comps)},
        board=board,
        tiles=tiles,
        locked=_locked(state, features, lanes),
        peers=_peers(snaps, bands, benchmarks),
        brief=_brief(brief, brief_items),
        drafts=[{k: d[k] for k in ("id", "reviewer_label", "rating", "review_text", "draft_text", "compliance_status", "status")} for d in open_drafts],
        events=[{"kind": e["kind"], "title": e["title"], "body": e["body"], "action_label": e["action_label"], "expires_at": _iso(e["expires_at"])} for e in live_events],
        insights=[{"position": i["position"], "title": i["title"], "body": i["body"], "cta": i["cta"], "action": i["action"]} for i in insights],
        recap=_recap(day, snaps, board, tiles, drafts),
        plans=[{"key": p["key"], "name": p["name"], "tag": p["tag"], "highlight": p["highlight"], "items": list(p["items"]) if isinstance(p["items"], list) else []} for p in plans],
    )
    return {"as_of": now, "data": "mock" if state["is_mock"] else "live", "ready": True, **sections}
