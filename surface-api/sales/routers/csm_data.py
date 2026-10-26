"""sales CSM assignments (S2) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/csm.ts.

Every endpoint runs as the signed-in user, so RLS (and list_control_users' own super_admin
check) decide exactly as they did for the browser. `assigned_by` is the caller's email, else
their id, from the verified token (the browser sent the signed-in user's `email ?? id`).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from _base.auth import current_user
from sales.queries import csm as q
from sales.routers.cpq_data import _Body, _read_with, _write_with

router = APIRouter(prefix="/sales/csm", tags=["sales"])


@router.get("/assignments")
def list_active(claims: dict = Depends(current_user)) -> list:
    """listActiveCsms: every active organization assignment (the browser keys them)."""
    return _read_with(claims, q.list_active)


@router.get("/assignments/{org_id}")
def account_csm(org_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """getAccountCsm: the org's active assignment, or null."""
    return _read_with(claims, q.account_csm, org_id)


class SalesCsmAssign(_Body):
    """assignCsm's CsmUser."""
    user_ref: str
    name: str | None
    email: str | None


@router.put("/assignments/{org_id}")
def assign(org_id: str, body: SalesCsmAssign, claims: dict = Depends(current_user)) -> dict:
    """assignCsm: clear the org's active assignment, then insert the new one."""
    email = claims.get("email")
    assigned_by = email if email is not None else claims.get("sub")
    return _write_with(claims, q.assign, org_id, body.model_dump(), assigned_by)


@router.delete("/assignments/{org_id}")
def clear(org_id: str, claims: dict = Depends(current_user)) -> dict:
    """clearCsm: deactivate the org's active assignment."""
    return _write_with(claims, q.clear, org_id)


@router.get("/candidates")
def candidates(claims: dict = Depends(current_user)) -> list:
    """listCsmCandidates: list_control_users() {user_id, email} rows (super_admin only)."""
    return _read_with(claims, q.control_users)
