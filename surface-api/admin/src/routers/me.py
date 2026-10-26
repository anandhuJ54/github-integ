"""The signed-in user's own console context — replaces the direct supabase-js calls in
surface-ui/_base/src/lib/roles.tsx (RoleProvider, mounted on every console page).

Reads run as the user (role `authenticated`); RLS and the SECURITY DEFINER bootstrap function
decide, as they did for the browser. A signed-out caller gets no grants: anon has no read policy
on exp_control_grants, so the browser got none either.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from _base.auth import current_user
from _base.db import session as db
from _base.server_fn import optional_user
from surfaces.admin.queries import me as q

router = APIRouter(prefix="/admin/me", tags=["admin"])


@router.get("/grants")
def my_grants(claims: dict | None = Depends(optional_user)) -> dict[str, list[dict[str, Any]]]:
    """load()'s exp_control_grants read and resolveScopeLabels()' name lookups, one round trip:
    {grants, entities: [{entity_id, display_name}], nodes: [{node_id, name}]}."""
    if claims is None:
        return {k: [] for k in q.EMPTY}
    with db.role_connection("authenticated", claims) as conn:
        return q.my_grants(conn, claims["sub"])


@router.post("/bootstrap")
def bootstrap(claims: dict = Depends(current_user)) -> dict[str, list[dict[str, Any]]]:
    """No grants yet: rpc("bootstrap_control_super_admin") (the function decides; its result
    and error are ignored as in the TS), then the same read as GET /grants on the primary."""
    with db.role_connection("authenticated", claims, write=True) as conn:
        q.bootstrap(conn)
        return q.my_grants(conn, claims["sub"])


class AdminMeAuditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(min_length=1, max_length=200)
    acting_role: str | None = Field(default=None, max_length=60)
    target: str | None = Field(default=None, max_length=500)
    details: dict[str, Any] = Field(default_factory=dict)


@router.post("/audit")
def log_audit(body: AdminMeAuditIn, claims: dict = Depends(current_user)) -> dict[str, bool]:
    """logAudit(): one exp_admin_audit row. user_id is the token's `sub` (the UI used to send its
    session user id, the same value); RLS requires user_id = auth.uid()."""
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            q.log_audit(conn, claims["sub"], body.model_dump(exclude_unset=True))
        return {"ok": True}
    except psycopg.Error as exc:
        msg = (exc.diag.message_primary if exc.diag else None) or "audit insert failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or "row-level security" in msg
        raise HTTPException(status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST,
                            msg) from exc
