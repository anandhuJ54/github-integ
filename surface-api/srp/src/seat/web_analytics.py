"""The Web analytics page's data for a local sign-in (srp/web-analytics-page-schema): the site, the SRS website lane as the gauge, the ten audit checks with their
points text, the filter counts, the three tiles, the top fix with its ready-made JSON-LD snippet, NORA's two notes and the Profile facts behind the snippet.

Reads `<schema>.*` (default `srp_cleanup`) for the signed-in user's OWN seat only (a `tier_agents.id`; anything else is 403, whether or not it exists), on the API's own
database login, in one connection, with `SELECT` only and no lock. The transaction is declared READ ONLY, so the database itself refuses a write. The ownership check comes
first (the one the Home, SRS, Profile and Insights reads apply: `home.owner_of`).

Stored: the ten check rows (state, result line, optional points, source and tier). Read from the other pages' tables, not copied: the gauge is the seat's `website` lane
in its newest snapshot (so it equals the SRS page), the address and the last scan are the seat's `website_analytics_data` row, and the snippet is built from the Profile's
name, company, phone and address. Computed here, never stored: the points text, the counts, the tiles, the top fix, the notes and the snippet. A gauge with no snapshot or
no lane row is None, never 0. A seat with no `web_checks` row is `ready: false` and every other section is None.
"""
from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from _base.config import get_settings
from _base.db.session import connection  # tests replace this name
from surfaces.srp.seat import home

KEYS = ("entity_markup", "nap", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion", "reviews_on_site", "security")
GROUPS = {"entity_markup": "Entity and markup", "nap": "Name, address, phone", "indexing": "Indexing", "service_pages": "Service pages", "speed": "Speed",
          "ai_readiness": "AI readiness", "content": "Content", "conversion": "Conversion", "reviews_on_site": "Reviews on site", "security": "Security"}
_STATE_LABEL = {"fail": "Failing", "warn": "Needs work", "pass": "Passing"}
_MARKUP_VALUE = {"fail": "Missing", "warn": "Partial", "pass": "Complete"}
_SECTIONS = ("site", "health", "checks", "counts", "tiles", "top_fix", "notes", "facts")
_PHONE = re.compile(r"^(?:\+1|1)?(\d{10})$")


def _text(value: Any) -> str | None:
    """A trimmed string, or None when there is nothing in it (a value that is not text is nothing)."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _url(raw: Any) -> str | None:
    text = _text(raw)
    if text is None:
        return None
    return re.sub(r"^https?://", "", text, flags=re.IGNORECASE).rstrip("/") or None


def _phone(raw: str) -> str:
    """(563) 555-0100 from +15635550100 or 5635550100, as the Profile shows it; anything else as it is."""
    m = _PHONE.match(re.sub(r"[\s().-]", "", raw))
    return f"({m[1][:3]}) {m[1][3:6]}-{m[1][6:]}" if m else raw


def _script_safe(json_text: str) -> str:
    """JSON text that is safe inside a script element: a closing tag is broken up and an HTML comment opener is written as a unicode escape (both stay valid JSON with the same meaning)."""
    return json_text.replace("</", "<" + chr(92) + "/").replace("<!--", "<" + chr(92) + "u0021--")


def _snippet(facts: dict[str, str | None]) -> str | None:
    """The JSON-LD block for the page, built from the Profile's facts only: every value JSON-escaped (and a closing script tag inside a value broken up), a missing part left out."""
    if facts["name"] is None:
        return None
    parts = {"name": f"{facts['name']} – {facts['company']}" if facts["company"] else facts["name"], "telephone": _phone(facts["phone"]) if facts["phone"] else None,
             "address": facts["address"]}
    lines = [f'"{k}": {_script_safe(json.dumps(v, ensure_ascii=False))}' for k, v in parts.items() if v]
    body = '{ "@type": "FinancialService"' + "".join(",\n  " + line for line in lines) + " }"
    return f'<script type="application/ld+json">\n{body}\n</script>'


def _points_text(r: dict) -> str:
    if r["points_max"] is not None:
        open_ = r["points_max"] - r["points"]
        return f"+{open_} open" if r["check_key"] == "entity_markup" and open_ > 0 else f"{r['points']} of {r['points_max']}"
    return "Pass" if r["state"] == "pass" else "—"


def _check(r: dict) -> dict[str, Any]:
    return {"key": r["check_key"], "group": GROUPS[r["check_key"]], "state": r["state"], "result": r["result"], "points": r["points"], "max": r["points_max"],
            "points_text": _points_text(r), "source": r["source"], "trust_tier": r["trust_tier"]}


def _tiles(by: dict[str, dict]) -> list[dict[str, Any]]:
    out = []
    if "speed" in by:
        s = by["speed"]
        out.append({"key": "speed", "label": "Speed", "value": s["headline"] or "", "note": _STATE_LABEL[s["state"]], "state": s["state"], "check": "speed"})
    if "entity_markup" in by:
        m = by["entity_markup"]
        open_ = m["points_max"] - m["points"]
        out.append({"key": "markup", "label": "Markup", "value": _MARKUP_VALUE[m["state"]], "note": f"+{open_} open" if open_ > 0 else "Passing", "state": m["state"],
                    "check": "entity_markup"})
    if "ai_readiness" in by:
        a = by["ai_readiness"]
        out.append({"key": "ai_readiness", "label": "AI readiness", "value": a["headline"] or "", "note": _STATE_LABEL[a["state"]], "state": a["state"], "check": "ai_readiness"})
    return out


def _notes(top_fix: dict | None, by: dict[str, dict]) -> list[dict[str, str]]:
    notes = []
    if top_fix:
        notes.append({"title": f"Markup is worth {top_fix['open']} points.", "body": "I've written the code — your webmaster only needs to paste it in.",
                      "cta": "Send to my webmaster", "action": "send"})
    ai = by.get("ai_readiness")
    if ai and ai["state"] != "pass":
        title = "AI can't read your page yet." if ai["state"] == "fail" else "AI can only partly read your page."  # a check that still reads part of it cannot say "can't"
        notes.append({"title": title, "body": f"{ai['result']}.", "cta": "See the checks", "action": "close"})
    return notes


def web_analytics(claims: dict, pro_id: str) -> dict[str, Any]:
    """The Web analytics page data for the signed-in user's own seat; 403 for any other id."""
    seat, user = home.parse_ids(claims, pro_id)
    s = get_settings().srp_local_schema
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with connection() as conn:
        conn.execute("set transaction read only")  # the first statement: the database refuses any write from here on
        owner = home.owner_of(conn, s, seat, user)
        rows = conn.execute(
            f"""select check_key, state, result, headline, points, points_max, source, trust_tier, is_mock from {s}.web_checks where tier_agent_id = %s""", (seat,)).fetchall()
        if not rows:
            return {"as_of": now, "data": None, "ready": False, **dict.fromkeys(_SECTIONS)}
        snap = conn.execute(f"select id from {s}.home_snapshots where tier_agent_id = %s order by as_of desc, id desc limit 1", (seat,)).fetchone()
        lane = conn.execute(
            f"""select sl.points, l.max_points from {s}.home_snapshot_lanes sl join {s}.home_score_lanes l on l.id = sl.lane_id
                where sl.snapshot_id = %s and l.key = 'website'""", (snap["id"],)).fetchone() if snap else None
        site = conn.execute(
            f"""select website_url, last_refreshed_time from {s}.website_analytics_data where tier_agent_id = %s
                order by last_refreshed_time desc nulls last, id desc limit 1""", (seat,)).fetchone()
        facts = conn.execute(f"select field, value from {s}.profile_facts where tier_agent_id = %s and field in ('address', 'company')", (seat,)).fetchall()
        phone = conn.execute(f"select phone_number from {s}.tier_agents where id = %s", (seat,)).fetchone()
    by_key = {r["check_key"]: r for r in rows}
    ordered = [by_key[k] for k in KEYS if k in by_key]
    stored = {f["field"]: _text(f["value"]) for f in facts}
    fact = {"name": " ".join(p for p in (_text(owner.get("first_name")), _text(owner.get("last_name"))) if p) or None, "company": stored.get("company"),
            "phone": _text((phone or {}).get("phone_number")), "address": stored.get("address")}
    markup = by_key.get("entity_markup")
    top_fix = {"open": markup["points_max"] - markup["points"], "snippet": _snippet(fact)} if markup and markup["state"] != "pass" else None
    health = {"earned": lane["points"], "max": lane["max_points"], "open": lane["max_points"] - lane["points"]} if lane and lane["points"] is not None and lane["max_points"] is not None else None
    return {
        "as_of": now, "data": "mock" if any(r["is_mock"] for r in rows) else "live", "ready": True,
        "site": {"url": _url((site or {}).get("website_url")), "last_checked": home._iso((site or {}).get("last_refreshed_time"))},
        "health": health,
        "checks": [_check(r) for r in ordered],
        "counts": {"all": len(ordered), "fail": sum(r["state"] == "fail" for r in ordered), "warn": sum(r["state"] == "warn" for r in ordered), "pass": sum(r["state"] == "pass" for r in ordered)},
        "tiles": _tiles(by_key),
        "top_fix": top_fix,
        "notes": _notes(top_fix, by_key),
        "facts": fact,
    }
