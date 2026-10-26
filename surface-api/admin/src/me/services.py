"""The signed-in user's own control grants, their scope names, the one-time super-admin bootstrap
and the workspace audit insert — port of the supabase-js calls in
surface-ui/_base/src/lib/roles.tsx (RoleProvider, on every console page).

RLS decides, as it did for the browser: exp_control_grants "users read own grants",
exp_entity / exp_control_nodes "read for app roles", exp_admin_audit
"authenticated insert own audit" (user_id = auth.uid()). bootstrap_control_super_admin is a
SECURITY DEFINER function that decides for itself.
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import Uuid, case, cast, insert, select

from _base.db import tables as T
from _base.db.sql import compile_sql, fetch_many

grants_t, entity_t, nodes_t, audit_t = (T.t_exp_control_grants, T.t_exp_entity,
                                        T.t_exp_control_nodes, T.t_exp_admin_audit)

_UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


def _scope_ids(user_id: str, scope_type: str) -> Any:
    """The user's grant scope_ids of one type, as uuids (text scope_ids that aren't uuids are
    skipped instead of failing the whole read)."""
    g = grants_t.alias("g").c
    as_uuid = case((g.scope_id.op("~*")(_UUID_RE), cast(g.scope_id, Uuid)))
    return select(as_uuid).where(g.user_id == user_id, g.scope_type == scope_type)


def grants_stmts(user_id: str) -> dict[str, Any]:
    """load() + resolveScopeLabels(): the grants and the names of their entity / control-node
    scopes, keyed off the grants in SQL so the three reads go out in one round trip."""
    g, e, n = grants_t.c, entity_t.c, nodes_t.c
    return {
        "grants": select(g.id, g.role, g.scope_type, g.scope_id, g.is_primary)
        .where(g.user_id == user_id),
        "entities": select(e.entity_id, e.display_name)
        .where(e.entity_id.in_(_scope_ids(user_id, "entity"))),
        "nodes": select(n.node_id, n.name).where(n.node_id.in_(_scope_ids(user_id, "control_node"))),
    }


EMPTY: dict[str, list] = {"grants": [], "entities": [], "nodes": []}


def my_grants(conn: psycopg.Connection, user_id: str) -> dict[str, list[dict[str, Any]]]:
    """A failed read is no rows (the TS ignored every error here: `data ?? []`)."""
    return fetch_many(conn, grants_stmts(user_id), tolerant=True)


BOOTSTRAP_SQL = "select public.bootstrap_control_super_admin() as v"


def bootstrap(conn: psycopg.Connection) -> None:
    """rpc("bootstrap_control_super_admin"), its result and error ignored as in the TS. Runs in
    a savepoint so a refusal leaves the transaction usable for the re-read."""
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(BOOTSTRAP_SQL)
    except psycopg.Error:
        pass


def audit_stmt(user_id: str, fields: dict[str, Any]) -> Any:
    """logAudit(): the exp_admin_audit row, user_id from the verified token."""
    v = dict(fields)
    if "details" in v:
        v["details"] = Jsonb(v["details"])
    return insert(audit_t).inline().values(user_id=user_id, **v)


def log_audit(conn: psycopg.Connection, user_id: str, fields: dict[str, Any]) -> None:
    sql, params = compile_sql(audit_stmt(user_id, fields))
    with conn.cursor() as cur:
        cur.execute(sql, params)
