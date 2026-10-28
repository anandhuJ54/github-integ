"""The Profile page's data for a local sign-in (srp/profile-page-schema): the 18 facts with their sources, the preview, the credentials count and the
expertise-graph counts.

Reads `<schema>.*` (default `srp_cleanup`) for the signed-in user's OWN seat only (a `tier_agents.id`; anything else is 403, whether or not it exists), on the
API's own database login, in one connection, with `SELECT` only and no lock. The transaction is declared READ ONLY, so the database itself refuses a write. The
ownership check comes first (the one the Home and SRS reads apply: `home.owner_of`).

Eight facts are read from the existing tables as they are (name, title, photo, bio, year started, both phones, email); the other ten live in `profile_facts`, which
also holds the source, the trust tier and the date of every fact. A fact is present when its value is non-blank: an existing-table fact whose column is blank is
missing even if a source row exists, and an own fact with no row is missing. The preview's rating, reviews, strength and city are the newest Home snapshot's (so the
two pages agree); with no snapshot they are None, never 0. A seat with no `profile_facts` row is `ready: false` and every other section is None.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from _base.config import get_settings
from _base.db.session import connection  # tests replace this name
from surfaces.srp.seat import home

FIELDS = ("name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email", "address", "hours", "nmls", "licensed_in", "products",
          "service_areas", "designations", "awards", "education", "company")
GROUP_KEYS = ("identity", "contact", "licence", "products", "reviews", "presence")
CREDENTIALS = ("designations", "awards", "education")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_SECTIONS = ("facts", "preview", "credentials", "graph")


def _text(value: Any) -> str | None:
    """A trimmed string, or None when there is nothing in it."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _month_day(when: datetime) -> str:
    return f"{_MONTHS[when.month - 1]} {when.day}"


def _existing_values(person: dict) -> dict[str, str | None]:
    """The facts whose value is read from `tier_agents` and `users` as they are."""
    name = " ".join(p for p in (_text(person.get("first_name")), _text(person.get("last_name"))) if p)
    return {"name": name or None, "title": _text(person.get("title")), "photo": _text(person.get("profile_photo")), "bio": _text(person.get("description")),
            "year_started": _text(person.get("year_started")), "office_phone": _text(person.get("phone_number")),
            "mobile_phone": _text(person.get("mobile_number")), "email": _text(person.get("email"))}


def _own_value(value: Any) -> str | list[str] | None:
    if isinstance(value, list):
        items = [t for t in (_text(v) for v in value) if t]
        return items or None
    return _text(value)


def _fact(field: str, value: str | list[str] | None, row: dict | None) -> dict[str, Any]:
    if value is None:
        return {"field": field, "present": False, "value": None, "source": None, "trust_tier": None, "confirmed_at": None, "source_line": None}
    when = row["confirmed_at"] if row else None
    source = row["source"] if row else None
    line = None if source is None else f"{source} · {_month_day(when)}" if when else source
    return {"field": field, "present": True, "value": value, "source": source, "trust_tier": row["trust_tier"] if row else None,
            "confirmed_at": home._iso(when), "source_line": line}


def _graph(rows: list[dict]) -> dict[str, Any]:
    by_key = {r["group_key"]: int(r["facts"]) for r in rows}
    groups = [{"key": k, "facts": by_key[k]} for k in GROUP_KEYS if k in by_key]
    return {"groups": groups, "facts_total": sum(g["facts"] for g in groups), "sources": sum(1 for g in groups if g["facts"] > 0)}


def profile(claims: dict, pro_id: str) -> dict[str, Any]:
    """The Profile page data for the signed-in user's own seat; 403 for any other id."""
    seat, user = home.parse_ids(claims, pro_id)
    s = get_settings().srp_local_schema
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with connection() as conn:
        conn.execute("set transaction read only")  # the first statement: the database refuses any write from here on
        home.owner_of(conn, s, seat, user)
        person = conn.execute(
            f"""select u.first_name, u.last_name, u.email, ta.title, ta.profile_photo, ta.description, ta.year_started, ta.phone_number, ta.mobile_number
                from {s}.tier_agents ta join {s}.users u on u.id = ta.user_id where ta.id = %s""", (seat,)).fetchone()
        rows = conn.execute(
            f"""select field, value, source, trust_tier, confirmed_at, is_mock from {s}.profile_facts where tier_agent_id = %s order by id""", (seat,)).fetchall()
        if not rows or person is None:
            return {"as_of": now, "data": None, "ready": False, **dict.fromkeys(_SECTIONS)}
        groups = conn.execute(f"select group_key, facts from {s}.profile_graph_groups where tier_agent_id = %s", (seat,)).fetchall()
        snap = conn.execute(
            f"""select review_avg, review_count, profile_strength_pct, rank_city from {s}.home_snapshots where tier_agent_id = %s
                order by as_of desc, id desc limit 1""", (seat,)).fetchone()
    by_field = {r["field"]: r for r in rows}
    existing = _existing_values(person)
    facts = [_fact(f, existing[f] if f in existing else _own_value(by_field[f]["value"]) if f in by_field else None, by_field.get(f)) for f in FIELDS]
    value = {f["field"]: f["value"] for f in facts}
    snap = snap or {}
    return {
        "as_of": now, "data": "mock" if any(r["is_mock"] for r in rows) else "live", "ready": True,
        "facts": facts,
        "preview": {"title": value["title"], "company": value["company"], "city": snap.get("rank_city"),
                    "rating": home._float(snap.get("review_avg")), "reviews": snap.get("review_count"), "nmls": value["nmls"],
                    "strength_pct": snap.get("profile_strength_pct"), "photo_url": value["photo"]},
        "credentials": {"added": sum(1 for f in CREDENTIALS if value[f] is not None), "of": len(CREDENTIALS)},
        "graph": _graph(groups),
    }
