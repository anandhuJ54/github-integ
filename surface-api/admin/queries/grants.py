"""/admin/users reads and writes — port of the supabase-js calls in
surface-ui/admin/src/routes/_authenticated/admin.users.tsx. The database decides who may do this:
list_control_users raises 'forbidden' for anyone but a super_admin, and exp_control_grants RLS
lets only a super_admin insert/delete (others read their own grants)."""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import delete, insert, select

from _base.db.sql import compile_sql, fetch_all, jsonish
from _base.db.tables import t_exp_control_grants as grants_t


def control_users(conn: psycopg.Connection) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute("select * from public.list_control_users()")
        return [jsonish(dict(r)) for r in cur.fetchall()]


def all_grants(conn: psycopg.Connection) -> list[dict[str, Any]]:
    g = grants_t.c
    return fetch_all(conn, select(g.id, g.user_id, g.role, g.scope_type, g.scope_id, g.is_primary))


def _exec(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def assign(conn: psycopg.Connection, user_id: str, role: str) -> None:
    rows = _exec(conn, insert(grants_t).values(user_id=user_id, role=role)
                 .returning(grants_t.c.id))
    if not rows:  # RLS refuses with an error; this is only a guard
        raise PermissionError("grant not created")


def revoke(conn: psycopg.Connection, grant_id: str) -> None:
    # Like the TS: a delete the policy filters out removes nothing and is not an error.
    _exec(conn, delete(grants_t).where(grants_t.c.id == grant_id))
