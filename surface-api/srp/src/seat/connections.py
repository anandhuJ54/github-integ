"""The Connections page's data for a local sign-in (srp/connections-page-schema): the eleven accounts with their state, status line and what each powers, the summary, the
unconnected suggestions, NORA's notes and the locked directories card.

Reads `<schema>.*` (default `srp_cleanup`) for the signed-in user's OWN seat only (a `tier_agents.id`; anything else is 403, whether or not it exists), on the API's own
database login, in one connection, with `SELECT` only and no lock. The transaction is declared READ ONLY, so the database itself refuses a write. The ownership check comes
first (`home.owner_of`, as every other page).

Stored: one `connected_accounts` row per account (state and last sync). Read from the other pages' tables, not copied: the Google Business Profile line carries the seat's `gbp`
lane in its newest snapshot (so it equals the SRS page) and the directories card follows the seat's plan. Computed here, never stored: the names, status lines, powers lines,
summary, suggestions, notes and the card. A lane with no snapshot is left out of the line, never 0. A seat with no `connected_accounts` row is `ready: false` and every other
section is None. Nothing is signed in, fetched or written, and no token is kept anywhere.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from _base.config import get_settings
from _base.db.session import connection  # tests replace this name
from surfaces.srp.seat import home

PROVIDERS = ("google_business", "search_console", "youtube", "facebook", "instagram", "linkedin", "x", "zillow", "yelp", "website_cms", "loan_system")
NAMES = {"google_business": "Google Business Profile", "search_console": "Search Console", "youtube": "YouTube", "facebook": "Facebook", "instagram": "Instagram",
         "linkedin": "LinkedIn", "x": "X", "zillow": "Zillow", "yelp": "Yelp", "website_cms": "Website / CMS", "loan_system": "Loan system (Encompass)"}
_POWERS = {"search_console": "Indexing and search queries for Website Analytics", "youtube": "Videos lane", "facebook": "Connections lane, posting",
           "instagram": "Connections lane, posting", "linkedin": "Connections lane, photo, credentials hints", "x": "Connections lane", "zillow": "Reviews shown on the profile",
           "yelp": "Listing check", "website_cms": "Lets NORA apply website fixes", "loan_system": "Review requests after each closing"}
_NOTES = {"search_console": ("Search Console is one tap away.", "It's part of your Google sign-in. It shows me which searches find your page."),
          "website_cms": ("Your Website / CMS would let me apply fixes.", "Right now I can only hand them to your webmaster.")}
_LOCKED = {"title": "Publish your details to Apple Maps, Bing and 28 directories.", "text": "Unlock with Engage, included in Amplify."}
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_SECTIONS = ("accounts", "summary", "suggest", "notes", "locked")


def _status(r: dict) -> str:
    state, key = r["state"], r["provider"]
    if state == "connected":
        if key == "google_business" and r["synced_at"]:
            return f"Connected · synced {_MONTHS[r['synced_at'].month - 1]} {r['synced_at'].day}"  # not strftime: %b follows the server's locale
        return "Connected through Google" if key == "youtube" else "Connected"
    if state == "available":
        return "Part of the Google sign-in, not yet granted" if key == "search_console" else ""
    return "Matched, no sign-in needed" if state == "matched" else "Match found · replies need Yelp's partner access"


def _powers(key: str, lane: dict | None) -> str:
    if key != "google_business":
        return _POWERS[key]
    if lane and lane["points"] is not None and lane["max_points"] is not None:
        return f"GBP lane ({lane['points']} of {lane['max_points']}), hours, photos, reviews"
    return "GBP lane, hours, photos, reviews"


def connections(claims: dict, pro_id: str) -> dict[str, Any]:
    """The Connections page data for the signed-in user's own seat; 403 for any other id."""
    seat, user = home.parse_ids(claims, pro_id)
    s = get_settings().srp_local_schema
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with connection() as conn:
        conn.execute("set transaction read only")  # the first statement: the database refuses any write from here on
        home.owner_of(conn, s, seat, user)
        rows = conn.execute(f"select provider, state, synced_at, is_mock from {s}.connected_accounts where tier_agent_id = %s", (seat,)).fetchall()
        rows = [r for r in rows if r["provider"] in NAMES]
        if not rows:
            return {"as_of": now, "data": None, "ready": False, **dict.fromkeys(_SECTIONS)}
        snap = conn.execute(f"select id from {s}.home_snapshots where tier_agent_id = %s order by as_of desc, id desc limit 1", (seat,)).fetchone()
        lane = conn.execute(
            f"""select sl.points, l.max_points from {s}.home_snapshot_lanes sl join {s}.home_score_lanes l on l.id = sl.lane_id
                where sl.snapshot_id = %s and l.key = 'gbp'""", (snap["id"],)).fetchone() if snap else None
        plan = conn.execute(
            f"""select p.key as plan_key from {s}.home_seat_state st join {s}.home_plans p on p.id = st.plan_id where st.tier_agent_id = %s""", (seat,)).fetchone()
    by_key = {r["provider"]: r for r in rows}
    ordered = [by_key[k] for k in PROVIDERS if k in by_key]
    suggest = [k for k in ("search_console", "website_cms") if k in by_key and by_key[k]["state"] == "available"]
    return {
        "as_of": now, "data": "mock" if any(r["is_mock"] for r in rows) else "live", "ready": True,
        "accounts": [{"key": r["provider"], "name": NAMES[r["provider"]], "state": r["state"], "status": _status(r), "powers": _powers(r["provider"], lane),
                      "synced_at": home._iso(r["synced_at"])} for r in ordered],
        "summary": {"connected": sum(r["state"] == "connected" for r in ordered), "matched": sum(r["state"] in ("matched", "partial") for r in ordered)},
        "suggest": [{"key": k, "name": NAMES[k]} for k in suggest],
        "notes": [{"title": _NOTES[k][0], "body": _NOTES[k][1], "cta": "Connect it", "connect": k} for k in suggest],
        "locked": dict(_LOCKED) if plan and plan["plan_key"] == "core" else None,
    }
