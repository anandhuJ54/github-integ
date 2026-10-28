"""The Insights page's data for a local sign-in (srp/insights-page-schema): the six 30-day visibility figures, the map with the top 3 of every spot, the AI
engines, the competitor table with the seat's own average position, the market leader, the locked cards and NORA's two notes.

Reads `<schema>.*` (default `srp_cleanup`) for the signed-in user's OWN seat only (a `tier_agents.id`; anything else is 403, whether or not it exists), on the
API's own database login, in one connection, with `SELECT` only and no lock. The transaction is declared READ ONLY, so the database itself refuses a write. The
ownership check comes first (the one the Home, SRS and Profile reads apply: `home.owner_of`).

Stored: the visibility figures, the engine rows, the rivals' average positions and the top 3 of each map spot. Computed here, never stored: the AI totals (the sum
of the engine rows), the seat's own average map position (the mean of its 49 stored ranks, a "20+" cell counting as 21, rounded half up to one decimal), the
order of the competitor table (average ascending, an unknown average last, rivals before the seat on a tie), the market leader, the locked cards (shown below
the top plan) and the two notes (templates over the stored numbers). The map, rating and reviews of the seat are the newest Home snapshot's, so the pages
agree; with no snapshot they are None, never 0. A seat with no row in any of the four insights tables is `ready: false` and every other section is None.
"""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Any

from _base.config import get_settings
from _base.db.session import connection  # tests replace this name
from surfaces.srp.seat import home

METRICS = ("search_views", "maps_views", "calls", "directions", "website_clicks", "profile_views")
ENGINES = ("chatgpt", "gemini", "perplexity")
_ENGINE_NAMES = {"chatgpt": "ChatGPT", "gemini": "Gemini", "perplexity": "Perplexity"}
_SECTIONS = ("visibility", "map", "ai", "competitors", "target", "locked", "notes")
_NO_RANK = 21  # a "20+" cell counts as 21 in the seat's average (decision N3)


def _one_decimal(value: float | Decimal) -> float:
    """Rounded half up to one decimal (not Python's banker's rounding)."""
    return float(Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _seat_average(cells: list[dict]) -> float | None:
    if not cells:
        return None
    return _one_decimal(Decimal(sum(c["rank"] if c["rank"] is not None else _NO_RANK for c in cells)) / Decimal(len(cells)))


def _short(name: str) -> str:
    return name.split()[0] if name.split() else name


def _visibility(rows: list[dict]) -> list[dict[str, Any]]:
    by_metric = {r["metric"]: r for r in rows}
    return [{"metric": m, "value": int(by_metric[m]["value"]), "period_days": int(by_metric[m]["period_days"]), "source": by_metric[m]["source"],
             "trust_tier": by_metric[m]["trust_tier"], "source_line": f"Last {by_metric[m]['period_days']} days · {by_metric[m]['source']}"}
            for m in METRICS if m in by_metric]


def _map(cells: list[dict], leaders: list[dict], address: str | None, scanned: Any) -> dict[str, Any] | None:
    if not cells:
        return None
    by_cell: dict[Any, list[dict]] = {}
    for l in sorted(leaders, key=lambda x: x["position"]):
        by_cell.setdefault(l["cell_id"], []).append({"position": int(l["position"]), "name": l["name"], "is_you": bool(l["is_you"])})
    ordered = sorted(cells, key=lambda c: (c["row_no"], c["col_no"]))
    return {"address": address, "scanned_at": home._iso(scanned), "spots": len(ordered),
            "top3": sum(1 for c in ordered if c["rank"] is not None and c["rank"] <= 3),
            "cells": [{"row": c["row_no"], "col": c["col_no"], "rank": c["rank"], "leaders": by_cell.get(c["id"], [])} for c in ordered]}


def _ai(rows: list[dict]) -> dict[str, Any] | None:
    by_engine = {r["engine"]: r for r in rows}
    engines = [{"engine": e, "cited": int(by_engine[e]["cited"]), "checked": int(by_engine[e]["checked"]), "note": by_engine[e]["note"]}
               for e in ENGINES if e in by_engine]
    if not engines:
        return None
    return {"cited": sum(e["cited"] for e in engines), "checked": sum(e["checked"] for e in engines), "engines": engines}


def _competitors(owner: dict, snap: dict | None, rivals: list[dict], positions: dict[Any, float], seat_avg: float | None) -> list[dict[str, Any]]:
    name = " ".join(p for p in ((owner.get("first_name") or "").strip(), (owner.get("last_name") or "").strip()) if p) or "You"
    rows = [{"name": r["name"], "is_you": False, "rating": home._float(r["review_avg"]), "reviews": r["review_count"],
             "avg_position": positions.get(r["id"]), "is_leader": bool(r["is_market_leader"]), "_order": (0, r["position"])} for r in rivals]
    snap = snap or {}
    rows.append({"name": name, "is_you": True, "rating": home._float(snap.get("review_avg")), "reviews": snap.get("review_count"),
                 "avg_position": seat_avg, "is_leader": False, "_order": (1, 0)})
    rows.sort(key=lambda r: (r["avg_position"] is None, r["avg_position"] if r["avg_position"] is not None else 0, r["_order"]))
    return [{"place": i + 1, **{k: v for k, v in r.items() if k != "_order"}} for i, r in enumerate(rows)]


def _locked(state: dict | None, leader: dict | None) -> list[dict[str, str]]:
    if not state or state["plan_position"] >= state["top_position"]:
        return []  # at the top plan nothing is locked; with no plan nothing is claimed
    rival = f"the day you pass {_short(leader['name'])}" if leader else "how your map rank moves"
    return [{"key": "map_rank_tracking", "title": "Map Rank tracking", "text": f"Re-scan every week and see {rival}"},
            {"key": "ai_citation_monitoring", "title": "AI-citation monitoring", "text": "Track every answer that names you"}]


def _leader_note(leader: dict, snap: dict | None) -> dict[str, str]:
    reviews, articles = leader["review_count"], leader["article_count"]
    count = lambda n, noun: f"{n} {noun}" if n == 1 else f"{n} {noun}s"  # "1 review", "2 reviews"
    parts = []
    if reviews is not None and articles is not None:
        parts.append(f"{count(reviews, 'review')} and {count(articles, 'article')}.")
    elif reviews is not None:
        parts.append(f"{count(reviews, 'review')}.")
    elif articles is not None:
        parts.append(f"{count(articles, 'article')}.")
    mine, theirs = home._float((snap or {}).get("review_avg")), home._float(leader["review_avg"])
    if mine is not None and theirs is not None:
        a, b = _one_decimal(mine), _one_decimal(theirs)
        words = "better than" if a > b else "the same as" if a == b else "below"
        parts.append(f"Your {a:.1f} rating is {words} their {b:.1f}.")
    # "wins on volume" is only said when it is true of the numbers beside it: both review counts known and the leader's higher (second review, finding 1)
    seat_reviews = (snap or {}).get("review_count")
    volume = reviews is not None and seat_reviews is not None and reviews > seat_reviews
    title = f"{_short(leader['name'])} wins on volume." if volume else f"{_short(leader['name'])} is your top rival."
    return {"title": title, "body": " ".join(parts), "cta": "Start publishing", "action": "voce"}


def _engine_note(ai: dict | None) -> dict[str, str] | None:
    checked = [(Fraction(e["cited"], e["checked"]), i, e) for i, e in enumerate((ai or {}).get("engines", [])) if e["checked"] > 0]
    if not checked:
        return None
    _, _, e = min(checked, key=lambda x: (x[0], x[1]))
    name = _ENGINE_NAMES[e["engine"]]
    title = f"{name} never names you." if e["cited"] == 0 else f"{name} names you in {e['cited']} of {e['checked']}."
    return {"title": title, "body": e["note"] or "", "cta": "Write an article", "action": "voce"}


def insights(claims: dict, pro_id: str) -> dict[str, Any]:
    """The Insights page data for the signed-in user's own seat; 403 for any other id."""
    seat, user = home.parse_ids(claims, pro_id)
    s = get_settings().srp_local_schema
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with connection() as conn:
        conn.execute("set transaction read only")  # the first statement: the database refuses any write from here on
        owner = home.owner_of(conn, s, seat, user)
        vis = conn.execute(f"select metric, value, period_days, source, trust_tier, is_mock from {s}.insights_visibility where tier_agent_id = %s", (seat,)).fetchall()
        engines = conn.execute(f"select engine, cited, checked, note, is_mock from {s}.insights_ai_engines where tier_agent_id = %s", (seat,)).fetchall()
        positions = conn.execute(f"select competitor_id, avg_position, is_mock from {s}.insights_competitor_positions where tier_agent_id = %s", (seat,)).fetchall()
        snap = conn.execute(
            f"""select id, review_avg, review_count, map_scanned_at from {s}.home_snapshots where tier_agent_id = %s
                order by as_of desc, id desc limit 1""", (seat,)).fetchone()
        cells = conn.execute(f"select id, row_no, col_no, rank from {s}.home_map_cells where snapshot_id = %s order by row_no, col_no", (snap["id"],)).fetchall() if snap else []
        leaders = conn.execute(
            f"""select l.cell_id, l.position, l.name, l.is_you, l.is_mock from {s}.insights_spot_leaders l
                join {s}.home_map_cells c on c.id = l.cell_id where c.snapshot_id = %s order by c.row_no, c.col_no, l.position""", (snap["id"],)).fetchall() if snap else []
        if not (vis or engines or positions or leaders):
            return {"as_of": now, "data": None, "ready": False, **dict.fromkeys(_SECTIONS)}
        rivals = conn.execute(
            f"""select id, name, score, is_market_leader, review_count, review_avg, article_count, position from {s}.home_competitors
                where tier_agent_id = %s order by position""", (seat,)).fetchall()
        fact = conn.execute(f"select value from {s}.profile_facts where tier_agent_id = %s and field = 'address'", (seat,)).fetchone()
        state = conn.execute(
            f"""select p.position as plan_position, (select max(position) from {s}.home_plans) as top_position
                from {s}.home_seat_state st join {s}.home_plans p on p.id = st.plan_id where st.tier_agent_id = %s""", (seat,)).fetchone()
    address = fact["value"].strip() if fact and isinstance(fact["value"], str) and fact["value"].strip() else None
    leader = next((r for r in rivals if r["is_market_leader"]), None)
    ai = _ai(engines)
    seat_avg = _seat_average(cells)
    notes = [n for n in (_leader_note(leader, snap) if leader else None, _engine_note(ai)) if n]
    return {
        "as_of": now, "data": "mock" if any(r["is_mock"] for r in (*vis, *engines, *positions, *leaders)) else "live", "ready": True,
        "visibility": _visibility(vis),
        "map": _map(cells, leaders, address, snap["map_scanned_at"] if snap else None),
        "ai": ai,
        "competitors": _competitors(owner, snap, rivals, {p["competitor_id"]: _one_decimal(p["avg_position"]) for p in positions}, seat_avg),
        "target": {"name": leader["name"]} if leader else None,
        "locked": _locked(state, leader),
        "notes": notes,
    }
