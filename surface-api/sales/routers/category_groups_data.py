"""sales category groups (S4) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/category-groups.ts and loadAdminGroups / loadHydration in
surface-ui/sales/src/lib/territory-admin.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. A
function that made several reads gets them in one response, raw; the browser still joins and
rolls up. The two writes (add / remove a member category) are the browser's statements. The
group's territory slots come from GET /sales/territories/slots?group_key=…; the group territory
generator is the allow-listed POST /sales/territories/rpc/exp_generate_group_territories.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from _base.auth import current_user
from sales.queries import category_groups as q
from sales.routers.cpq_data import _Body, _read_with, _write_with

router = APIRouter(prefix="/sales/category-groups", tags=["sales"])

# Static paths first: /{group_key}/... has two segments, so nothing below collides.


@router.get("")
def list_groups(claims: dict = Depends(current_user)) -> list:
    """loadCategoryGroups: every group, by label."""
    return _read_with(claims, q.list_groups)


@router.get("/admin")
def admin_groups(claims: dict = Depends(current_user)) -> list:
    """loadAdminGroups: [{group_key, label, is_catchall}] by label (the browser drops catch-alls)."""
    return _read_with(claims, q.admin_groups)


@router.get("/members")
def group_members(group_key: str | None = Query(None), claims: dict = Depends(current_user)) -> dict:
    """loadGroupMembers(groupKey): `{ members, cats }` (the browser labels them)."""
    return _read_with(claims, q.group_members, group_key)


@router.get("/quotas")
def group_quotas(group_key: str | None = Query(None), claims: dict = Depends(current_user)) -> list:
    """loadGroupQuotas(groupKey): newest period first."""
    return _read_with(claims, q.group_quotas, group_key)


@router.get("/metrics")
def group_metrics(group_key: str | None = Query(None), claims: dict = Depends(current_user)) -> list:
    """loadGroupMetrics(groupKey): newest period first."""
    return _read_with(claims, q.group_metrics, group_key)


@router.get("/search")
def search_categories(term: str = Query(...), claims: dict = Depends(current_user)) -> list:
    """searchCategories: up to 25 categories whose name or gcid contains `term`."""
    return _read_with(claims, q.search_categories, term)


@router.delete("/members/{member_id}")
def remove_member(member_id: str, claims: dict = Depends(current_user)) -> dict:
    """removeGroupMember."""
    return _write_with(claims, q.remove_member, member_id)


@router.get("/{group_key}/scorecard")
def scorecard(group_key: str, claims: dict = Depends(current_user)) -> dict:
    """loadGroupScorecard: `{ quotas, metrics, territories, reps, pipeline }` (the browser builds
    the cards)."""
    return _read_with(claims, q.scorecard, group_key)


@router.get("/{group_key}/hydration")
def hydration(group_key: str, claims: dict = Depends(current_user)) -> dict:
    """loadHydration: `{ members, total, deep }` (counts null when not read or failed)."""
    return _read_with(claims, q.hydration, group_key)


class SalesCategoryGroupMemberNew(_Body):
    gcid: str


@router.post("/{group_key}/members")
def add_member(group_key: str, body: SalesCategoryGroupMemberNew,
               claims: dict = Depends(current_user)) -> dict:
    """addGroupMember: insert({ group_key, gcid })."""
    return _write_with(claims, q.add_member, group_key, body.gcid)
