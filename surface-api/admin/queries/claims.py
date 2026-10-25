"""Claims queue reads + adjudication — port of the supabase-js calls in
surface-ui/admin/src/routes/_authenticated/claims.tsx.

Every call runs as the signed-in user (role `authenticated`), so claim_queue / professionals /
organizations RLS decides what is visible, as it did for the browser.
"""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from sqlalchemy import func, select

from _base.core.sql import fetch_all, fetch_one
from _base.schema.tables import t_claim_queue as cq_t
from _base.schema.tables import t_organizations as org_t
from _base.schema.tables import t_professionals as pro_t

log = logging.getLogger(__name__)

# The page's tabs → claim_queue.status filter (None = every status).
TABS: dict[str, tuple[str, ...] | None] = {
    "pending": ("pending",),
    "manual_review": ("manual_review",),
    "auto_approved": ("auto_approved", "approved"),
    "conflict": ("conflict",),
    "all": None,
}


def claim_stats(conn: psycopg.Connection) -> dict[str, int]:
    """The four tiles (four `count=exact, head=true` requests in the TS, one query here)."""
    s = cq_t.c.status
    stmt = select(
        func.count().filter(s == "pending").label("pending"),
        func.count().filter(s.in_(("auto_approved", "approved"))).label("approved"),
        func.count().filter(s == "manual_review").label("manual"),
        func.count().filter(s == "conflict").label("conflict"),
    )
    return fetch_one(conn, stmt) or {"pending": 0, "approved": 0, "manual": 0, "conflict": 0}


def claims_for_tab(conn: psycopg.Connection, tab: str) -> list[dict[str, Any]]:
    """`select *`, newest first, at most 200, filtered by the tab's statuses."""
    stmt = select(cq_t).order_by(cq_t.c.created_at.desc()).limit(200)
    statuses = TABS[tab]
    if statuses:
        stmt = stmt.where(cq_t.c.status.in_(statuses))
    return fetch_all(conn, stmt)


def _safe(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    """A read whose failure yields no rows, as `(pros.data ?? [])` did in the TS."""
    try:
        with conn.transaction():  # savepoint: a failed read must not abort the other
            return fetch_all(conn, stmt)
    except psycopg.Error as exc:
        log.warning("claim entity read failed: %s", type(exc).__name__)
        return []


def claim_entities(
    conn: psycopg.Connection, professional_ids: list[str], organization_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Display name / category / image for the claimed entities, keyed by entity id."""
    out: dict[str, dict[str, Any]] = {}
    if professional_ids:
        p = pro_t.c
        rows = _safe(conn, select(p.id, p.display_name, p.first_name, p.last_name, p.gcid,
                                  p.photo_url).where(p.id.in_(professional_ids)))
        for r in rows:
            full = " ".join(x for x in (r["first_name"], r["last_name"]) if x)
            out[r["id"]] = {
                "name": r["display_name"] or full or "Unnamed",
                "gcid": r["gcid"],
                "imageUrl": r["photo_url"],
                "kind": "professional",
            }
    if organization_ids:
        o = org_t.c
        rows = _safe(conn, select(o.id, o.name, o.gcid, o.logo_url)
                     .where(o.id.in_(organization_ids)))
        for r in rows:
            out[r["id"]] = {
                "name": r["name"],
                "gcid": r["gcid"],
                "imageUrl": r["logo_url"],
                "kind": "organization",
            }
    return out


def adjudicate(conn: psycopg.Connection, queue_id: str, approve: bool, note: str | None) -> None:
    """Governed adjudication: approve binds both sides (exp_claim + professionals.claimed +
    owner grant); reject closes the claim. The function writes the audit."""
    with conn.cursor() as cur:
        cur.execute(
            "select public.exp_claim_queue_adjudicate("
            "p_queue => %(q)s, p_approve => %(a)s, p_note => %(n)s)",
            {"q": queue_id, "a": approve, "n": note},
        )
