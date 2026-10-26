"""sales CSM assignments — port of the supabase-js calls in surface-ui/sales/src/lib/csm.ts:
exp_csm_assignments (one active row per subject; subject_id = the org id as text) and the
console users a CSM can be picked from (list_control_users, super_admin only: the function
refuses anyone else with 'forbidden').

Runs as the signed-in user, so RLS and the function decide as they did for the browser.
`assigned_by` (the browser's signed-in user's email, else id) comes from the verified token.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db import tables as T
from _base.db.sql import MAX_ROWS, fetch_all, jsonish
from sales.queries.cpq import execute, maybe_single

csm = T.t_exp_csm_assignments

SUBJECT = "organization"


def active_stmt() -> Any:
    """listActiveCsms: .eq("subject_type", "organization").eq("active", true)."""
    return select(csm).where(csm.c.subject_type == SUBJECT, csm.c.active.is_(True))


def list_active(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, active_stmt())


def account_stmt(org_id: str) -> Any:
    """getAccountCsm: … .eq("subject_id", orgId).eq("active", true).maybeSingle() (limit 2:
    enough to see a second row)."""
    return (select(csm).where(csm.c.subject_type == SUBJECT, csm.c.subject_id == org_id,
                              csm.c.active.is_(True)).limit(2))


def account_csm(conn: psycopg.Connection, org_id: str) -> dict[str, Any] | None:
    return maybe_single(fetch_all(conn, account_stmt(org_id)))


def clear_stmt(org_id: str) -> Any:
    """clearCsm: update({ active: false }) where subject_type, subject_id and active."""
    return (csm.update()
            .where(csm.c.subject_type == SUBJECT, csm.c.subject_id == org_id,
                   csm.c.active.is_(True))
            .values(active=False))


def clear(conn: psycopg.Connection, org_id: str) -> None:
    execute(conn, clear_stmt(org_id))


def assign(conn: psycopg.Connection, org_id: str, user: dict[str, Any],
           assigned_by: str | None) -> None:
    """assignCsm: clearCsm, then insert the active row (one transaction; the browser sent the
    two statements one after the other)."""
    clear(conn, org_id)
    execute(conn, csm.insert().inline().values(
        subject_type=SUBJECT, subject_id=org_id, csm_user_ref=user["user_ref"],
        csm_name=user["name"], csm_email=user["email"], assigned_by=assigned_by, active=True))


# the function orders by created_at; PostgREST capped an RPC's rows at max-rows too
CONTROL_USERS_SQL = f"select user_id, email from public.list_control_users() limit {MAX_ROWS}"


def control_users(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """listCsmCandidates: rpc("list_control_users"), the two columns the page maps."""
    with conn.cursor() as cur:
        cur.execute(CONTROL_USERS_SQL)
        return [jsonish(dict(r)) for r in cur.fetchall()]
