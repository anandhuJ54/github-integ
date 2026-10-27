"""Seat reads for a local sign-in (srp/local-login-srp-home): the professional's own seat, answered
from `<schema>.*` (default `srp_cleanup`) in the shape `GET /srp/seat/professional/{id}` already has.

Used only for a local sign-in session (a token issued by `/srp/auth/login`); Supabase sessions keep the
existing reads. The seat id is a `tier_agents.id`, and a session may read only its own seat, so any other
id gets 403 whether or not it exists. Runs on the API's own database login, like the sign-in itself.

Nothing is invented: ratings, reviews and nodes are empty, the office is the professional's tier and
its first location, and the score is the sum of the stored category scores, read by `score_query` (shared with the
Home read; the lane breakdown and the maximum are not derivable here, so they stay null).
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status

from _base.auth import LOCAL_ISSUER
from _base.config import get_settings
from _base.db.session import connection  # tests replace this name
from _base.server_fn import not_implemented
from surfaces.srp.seat import score_query

_ID = re.compile(r"[0-9]{1,18}")


def is_local_session(claims: dict) -> bool:
    return claims.get("iss") == LOCAL_ISSUER


def _forbidden() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, "not_your_seat")


def professional_seat(claims: dict, pro_id: str) -> dict[str, Any]:
    """The signed-in user's own professional seat; 403 for any other id."""
    sub = str(claims.get("sub") or "")
    if not _ID.fullmatch(pro_id) or not _ID.fullmatch(sub):
        raise _forbidden()
    s = get_settings().srp_local_schema
    with connection() as conn:
        row = conn.execute(
            f"""select ta.id, ta.title, ta.slug, ta.tag_line, ta.description, ta.profile_photo,
                       ta.phone_number, ta.tier_id, u.first_name, u.last_name, u.email,
                       t.name as tier_name, l.city as city, st.code as state_code
                from {s}.tier_agents ta
                join {s}.users u on u.id = ta.user_id
                left join {s}.tiers t on t.id = ta.tier_id
                left join lateral (
                    select tl.location_id from {s}.tier_locations tl
                    where tl.tier_id = ta.tier_id and tl.deleted_at is null
                    order by tl.id limit 1
                ) tl on true
                left join {s}.locations l on l.id = tl.location_id
                left join {s}.states st on st.id = l.state_id
                where ta.id = %s and ta.user_id = %s and ta.deleted_at is null
                  and u.deleted_at is null and u.deactivated_at is null
                  and not coalesce(u.is_manual_deactivated, false)""",
            (int(pro_id), int(sub)),
        ).fetchone()
        if row is None:
            raise _forbidden()
        score_rows = score_query.fetch_scores(conn, s, int(pro_id))
    return _shape(row, score_rows)


def _shape(row: dict[str, Any], score_rows: list[dict[str, Any]]) -> dict[str, Any]:
    first, last = row.get("first_name"), row.get("last_name")
    office_id = str(row["tier_id"]) if row.get("tier_id") is not None else None
    pro = {
        "id": str(row["id"]),
        "display_name": " ".join(p for p in (first, last) if p) or None,
        "first_name": first,
        "last_name": last,
        "slug": row.get("slug"),
        "photo_url": row.get("profile_photo"),
        "bio": row.get("description"),
        "headline": row.get("tag_line"),
        "job_title": row.get("title"),
        "email": row.get("email"),
        "phone": row.get("phone_number"),
        "gcid": None,
        "address_city": row.get("city"),
        "address_state": row.get("state_code"),
        "search_rank_score": None,
        "claimed": None,
        "is_demo": True,  # mock data
        "primary_org_id": office_id,
    }
    office = (
        {
            "id": office_id,
            "name": row.get("tier_name"),
            "slug": None,
            "logo_url": None,
            "address_city": row.get("city"),
            "address_state": row.get("state_code"),
            "parent_org_id": None,
        }
        if office_id is not None
        else None
    )
    score = None
    if score_rows:
        calculated = score_query.latest_update(score_rows)
        score = {
            "total_score": score_query.total_of(score_rows),
            "max_possible": None,
            "score_pct": None,
            "score_reviews": None,
            "score_profile": None,
            "score_listings": None,
            "score_content": None,
            "score_web_analytics": None,
            "score_connections": None,
            "gaps": None,
            "next_milestone": None,
            "next_milestone_gap": None,
            "calculated_at": str(calculated) if calculated is not None else None,
        }
    return {"pro": pro, "office": office, "brand": None, "score": score,
            "ratings": [], "reviews": None, "nodes": None}


def office_mode() -> None:
    """exp_office_mode for a local session: no mode, which the page reads as "keep the professional's rows"."""
    return


def listings() -> list:
    return []


def other_rpc(name: str) -> HTTPException:
    return not_implemented(f"rpc {name} for a local sign-in session")
