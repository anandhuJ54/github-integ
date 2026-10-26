"""Control-graph claims endpoints — the "Control graph claims" tab on /claims
(surface-ui/admin/src/components/claims/claims-tab.tsx).

Moved from the graph Surface (/graph/control/claims, /graph/control/entities-lite,
/graph/control/users, POST /graph/control/rpc/exp_claim_adjudicate in
graph/routers/entities_data.py), surface audit 2026-10-25. Same SQL, roles and responses.

Everything runs as the signed-in user; RLS and the role-checked functions decide, as they did for
the browser.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from _base.db.sql import fetch_all
from surfaces.admin.control_claim import services as q
from surfaces.admin.control_claim.schemas import RpcArgs

router = APIRouter(prefix="/admin/control-claims", tags=["admin"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _guard(fn, *args):
    try:
        return fn(*args)
    except psycopg.Error as exc:  # the function's / database's message reaches the page
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "insufficient_privilege" in msg or "forbidden" in msg.lower() or "row-level security" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _rows(claims: dict, stmt: Any) -> list[dict[str, Any]]:
    with _read(claims) as conn:
        return _guard(fetch_all, conn, stmt)


@router.get("")
def control_claims(claims: dict = Depends(current_user)) -> list:
    return _rows(claims, q.claims_stmt())


@router.get("/entities-lite")
def control_entities_lite(claims: dict = Depends(current_user)) -> list:
    return _rows(claims, q.entities_lite_stmt())


@router.get("/users")
def control_users(claims: dict = Depends(current_user)) -> list:
    """claims-tab.tsx: list_control_users() (the page shows no emails when refused)."""
    with _read(claims) as conn:
        return _guard(q.control_users, conn)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: RpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed governed write (q.ADMIN_CONTROL_RPCS): claim adjudication.
    The role-checked function decides, as it did for the browser."""
    try:
        q.rpc_sql(name, body.args)  # refuse before leasing a connection
    except q.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args)
