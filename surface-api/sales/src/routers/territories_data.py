"""sales territories (S4) — replaces the direct supabase-js calls in
surface-ui/_base/src/lib/territories.ts and the territory, proposal, seat and ramp calls in
surface-ui/sales/src/lib/territory-admin.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. A
function that made several reads gets them in one response, raw; the browser still joins them and
still runs the sizing, packing and proposal logic. Writes are the browser's statements, one
endpoint per supabase-js call, in the browser's order; each request model allow-lists the columns
the page sends and only the keys sent are written. The quota upsert and the brand link (each a
find-then-write) run in one request. `reviewed_at` and the quota's `period_start` are the
server's clock; a proposal's `created_by` is the caller's id from the verified token (the browser
sent its own `auth.getUser()` id). The two generate functions are allow-listed RPCs
(q.TERRITORY_RPCS).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import Field

from _base.auth import current_user
from _base.db import session as db
from surfaces.sales.queries import territories as q
from surfaces.sales.queries.contracts import UnknownRpc
from surfaces.sales.routers.cpq_data import _Body, _guard, _read_with, _write_with

router = APIRouter(prefix="/sales/territories", tags=["sales"])

# Static paths first: /slots/{territory_id} and /reps/{rep_id} would otherwise match them.


@router.get("/categories")
def territory_categories(claims: dict = Depends(current_user)) -> dict:
    """loadTerritoryCategories: `{ territories: [{gcid}], cats }` (the browser counts and labels)."""
    return _read_with(claims, q.territory_categories)


@router.get("/slots")
def list_slots(gcid: str | None = Query(None), group_key: str | None = Query(None),
               claims: dict = Depends(current_user)) -> list:
    """loadTerritories(gcid) / loadGroupTerritories(groupKey): the slots by tier, seq."""
    return _read_with(claims, q.list_slots, gcid, group_key)


@router.get("/list")
def all_territories(period_start: date = Query(...), claims: dict = Depends(current_user)) -> dict:
    """loadAllTerritories: `{ territories, groups, reps, assignments, quotas, ramps, brands }`
    (quotas of `period_start`, the browser's currentPeriodStart(); the browser joins them)."""
    return _read_with(claims, q.all_territories, period_start)


@router.get("/rules")
def list_rules(claims: dict = Depends(current_user)) -> list:
    """loadTerritoryRules (the browser sorts by tier)."""
    return _read_with(claims, q.list_rules)


@router.get("/reps")
def list_reps(claims: dict = Depends(current_user)) -> list:
    """loadTerritoryReps."""
    return _read_with(claims, q.list_reps)


@router.get("/reps/nora")
def nora_rep(claims: dict = Depends(current_user)) -> list:
    """loadNoraRep: [{id, name}] of a rep whose role is "nora" (case-insensitive), or []."""
    return _read_with(claims, q.nora_rep)


class SalesTerritoryRepPatch(_Body):
    """setRepDuty / setRepBackup."""
    on_duty: bool | None = None
    backup_rep_id: str | None = None


@router.patch("/reps/{rep_id}")
def update_rep(rep_id: str, body: SalesTerritoryRepPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_rep, rep_id, body.sent())


@router.get("/quotas")
def current_quotas(period_start: date = Query(...), claims: dict = Depends(current_user)) -> list:
    """loadCurrentQuotas: the quotas of `period_start` (the browser's currentPeriodStart())."""
    return _read_with(claims, q.current_quotas, period_start)


class SalesTerritoryQuota(_Body):
    """assignTerritory (no group_key) / saveQuota / assignGroupTerritory (group_key sent)."""
    rep_id: str
    group_key: str | None = None
    target: Decimal


@router.put("/quotas")
def upsert_quota(body: SalesTerritoryQuota, claims: dict = Depends(current_user)) -> dict:
    """This month's quota (server clock) for the rep [and group]: update its target, else insert
    it (period_type "month", actual 0)."""
    sent = body.sent()
    return _write_with(claims, q.upsert_quota, body.rep_id, body.target, body.group_key,
                       "group_key" in sent, q.period_start())


@router.get("/routing-state")
def routing_state(claims: dict = Depends(current_user)) -> list:
    """loadRoutingState."""
    return _read_with(claims, q.routing_state)


class SalesTerritoryIds(_Body):
    territory_ids: list[str]


@router.post("/brands/search")
def territory_brands(body: SalesTerritoryIds, claims: dict = Depends(current_user)) -> list:
    """loadTerritoryBrands(ids): the open brand links of those territories."""
    return _read_with(claims, q.territory_brands, body.territory_ids)


@router.post("/ramps/search")
def ramps_for(body: SalesTerritoryIds, claims: dict = Depends(current_user)) -> list:
    """loadRamps(ids) (territory-admin.ts): by month_offset."""
    return _read_with(claims, q.ramps_for, body.territory_ids)


@router.get("/org-search")
def search_brands(term: str = Query(...), claims: dict = Depends(current_user)) -> list:
    """searchBrands: up to 20 root organizations whose name contains `term`."""
    return _read_with(claims, q.search_brands, term)


@router.get("/next-seq")
def next_seq(group_key: str = Query(...), tier: str = Query(...),
             claims: dict = Depends(current_user)) -> list:
    """nextSeq: [{seq}] of the group × tier's highest slot, or []."""
    return _read_with(claims, q.next_seq, group_key, tier)


@router.get("/group-gcid")
def group_gcid(group_key: str = Query(...), claims: dict = Depends(current_user)) -> list:
    """groupGcid / proposeCategorySplit: [{gcid}] of the group's first member, or []."""
    return _read_with(claims, q.group_gcid, group_key)


@router.get("/groups")
def proposal_groups(claims: dict = Depends(current_user)) -> list:
    """proposeTerritories' groups: [{group_key, label, is_catchall}]."""
    return _read_with(claims, q.proposal_groups)


@router.get("/logo-profiles")
def logo_profiles(claims: dict = Depends(current_user)) -> dict:
    """loadLogoProfiles: `{ profiles, territories }` (exp_territory_logo_profiles() and the stored
    office/agent counts; the browser builds the proxies)."""
    return _read_with(claims, q.logo_profiles)


@router.get("/group-profiles")
def group_profiles(group_key: str = Query(...), claims: dict = Depends(current_user)) -> list:
    """loadCategorySizing: exp_territory_group_profiles(p_group_key)."""
    return _read_with(claims, q.group_profiles, group_key)


# --- proposals -------------------------------------------------------------------------------

@router.get("/proposals")
def list_proposals(state: str | None = Query(None), claims: dict = Depends(current_user)) -> list:
    """loadProposals(state): newest first."""
    return _read_with(claims, q.list_proposals, state)


class SalesTerritoryProposalNew(_Body):
    """One proposal row (created_by is the caller, set by the server)."""
    group_key: str | None = None
    gcid: str | None = None
    lane: str | None = None
    proposed_label: str | None = None
    proposed_tier: str | None = None
    proposed_geo: str | None = None
    rationale: str | None = None
    payload: Any = None
    state: str | None = None


class SalesTerritoryProposalRows(_Body):
    rows: list[SalesTerritoryProposalNew]


@router.post("/proposals")
def insert_proposals(body: SalesTerritoryProposalRows, claims: dict = Depends(current_user)) -> dict:
    """proposeTerritories / proposeCategorySplit: insert(rows)."""
    return _write_with(claims, q.insert_proposals, [r.sent() for r in body.rows],
                       claims.get("sub"))


class SalesTerritoryProposalReview(_Body):
    """approveProposal / rejectProposal (reviewed_at is the server's clock)."""
    state: str
    payload: Any = None


@router.post("/proposals/{proposal_id}/review")
def review_proposal(proposal_id: str, body: SalesTerritoryProposalReview,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.review_proposal, proposal_id, body.sent())


# --- seats -----------------------------------------------------------------------------------

@router.get("/seats")
def list_seats(group_key: str = Query(...), claims: dict = Depends(current_user)) -> list:
    """loadSeats(groupKey): by created_at."""
    return _read_with(claims, q.list_seats, group_key)


class SalesTerritorySeatNew(_Body):
    territory_id: str
    rep_id: str
    group_key: str | None = None
    lane_role: str
    is_nora_default: bool | None = None
    monthly_quota: Decimal | None = None


class SalesTerritorySeatRows(_Body):
    rows: list[SalesTerritorySeatNew]
    ignore_duplicates: bool = False


@router.post("/seats")
def upsert_seats(body: SalesTerritorySeatRows, claims: dict = Depends(current_user)) -> dict:
    """approveWithNora (ignore_duplicates) / addSeat: upsert on territory_id,rep_id,lane_role."""
    return _write_with(claims, q.upsert_seats, [r.sent() for r in body.rows],
                       body.ignore_duplicates)


class SalesTerritorySeatPatch(_Body):
    monthly_quota: Decimal | None = None


@router.patch("/seats/{seat_id}")
def update_seat(seat_id: str, body: SalesTerritorySeatPatch, claims: dict = Depends(current_user)) -> dict:
    """updateSeatQuota."""
    return _write_with(claims, q.update_seat, seat_id, body.sent())


@router.delete("/seats/{seat_id}")
def delete_seat(seat_id: str, claims: dict = Depends(current_user)) -> dict:
    """removeSeat."""
    return _write_with(claims, q.delete_seat, seat_id)


# --- RPCs ------------------------------------------------------------------------------------

class SalesTerritoryRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: SalesTerritoryRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed generate function (q.TERRITORY_RPCS) with the page's arguments; its jsonb."""
    try:
        q.rpc_sql(name, body.args)  # refuse before leasing a connection
    except UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args)


# --- one territory ---------------------------------------------------------------------------

class SalesTerritoryNew(_Body):
    """saveTerritory (new): the insert's columns."""
    group_key: str | None = None
    gcid: str | None = None
    tier: str | None = None
    seq: int | None = None
    label: str | None = None
    geo_scope: str | None = None
    region: str | None = None
    status: str | None = None
    is_catchall: bool | None = None
    brand_count: int | None = None
    office_count: int | None = None
    agent_count: int | None = None


@router.post("/slots")
def insert_slot(body: SalesTerritoryNew, claims: dict = Depends(current_user)) -> dict:
    """saveTerritory (new): insert(...).select("id").single(). Returns {id}."""
    return _write_with(claims, q.insert_slot, body.sent())


@router.get("/slots/{territory_id}/label")
def territory_label(territory_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadTerritoryLabel: {id, label, tier, seller_id}, or null."""
    return _read_with(claims, q.territory_label, territory_id)


class SalesTerritoryPatch(_Body):
    """assignTerritory / unassignTerritory / setLaneOwner (seller_id, status) and saveTerritory
    (edit: group_key, tier, geo_scope, region[, label])."""
    seller_id: str | None = None
    status: str | None = None
    group_key: str | None = None
    tier: str | None = None
    geo_scope: str | None = None
    region: str | None = None
    label: str | None = None


@router.patch("/slots/{territory_id}")
def update_slot(territory_id: str, body: SalesTerritoryPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_slot, territory_id, body.sent())


@router.delete("/slots/{territory_id}")
def delete_slot(territory_id: str, claims: dict = Depends(current_user)) -> list:
    """deleteTerritory, last step: the deleted [{id}] (empty when RLS kept the row)."""
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.delete_slot, conn, territory_id)


class SalesTerritoryBrandLink(_Body):
    org_id: str
    lane: str | None = None


@router.post("/slots/{territory_id}/brands")
def link_brand(territory_id: str, body: SalesTerritoryBrandLink,
               claims: dict = Depends(current_user)) -> dict:
    """saveTerritory's brand link: insert it unless the territory × org link exists."""
    return _write_with(claims, q.link_brand, territory_id, body.org_id, body.lane)


@router.delete("/slots/{territory_id}/brands")
def delete_brands(territory_id: str, claims: dict = Depends(current_user)) -> dict:
    """deleteTerritory: the territory's brand links."""
    return _write_with(claims, q.delete_brands, territory_id)


@router.delete("/slots/{territory_id}/assignments")
def delete_assignments(territory_id: str,
                       types: list[Literal["account", "claims_queue"]] = Query(..., min_length=1),
                       claims: dict = Depends(current_user)) -> dict:
    """deleteTerritory (both lanes) / setLaneOwner (one lane): the lane assignment rows."""
    return _write_with(claims, q.delete_assignments, territory_id, list(dict.fromkeys(types)))


class SalesTerritoryAssignmentNew(_Body):
    rep_id: str | None = None
    group_key: str | None = None
    assignment_type: Literal["account", "claims_queue"]


@router.post("/slots/{territory_id}/assignments")
def insert_assignment(territory_id: str, body: SalesTerritoryAssignmentNew,
                      claims: dict = Depends(current_user)) -> dict:
    """setLaneOwner: the lane's new owner (target_ref = the territory)."""
    return _write_with(claims, q.insert_assignment, territory_id, body.sent())


@router.delete("/slots/{territory_id}/ramps")
def delete_ramps(territory_id: str, rep_id: str | None = Query(None),
                 claims: dict = Depends(current_user)) -> dict:
    """saveRamp (every ramp of the territory) / saveSeatRamp (that rep's only)."""
    return _write_with(claims, q.delete_ramps, territory_id, rep_id)


class SalesTerritoryRampRow(_Body):
    rep_id: str | None = None
    month_offset: int
    ramp_pct: Decimal


class SalesTerritoryRampRows(_Body):
    rows: list[SalesTerritoryRampRow]


@router.post("/slots/{territory_id}/ramps")
def insert_ramps(territory_id: str, body: SalesTerritoryRampRows,
                 claims: dict = Depends(current_user)) -> dict:
    """saveRamp / saveSeatRamp: the new curve (the browser clamps each pct to 0..100)."""
    return _write_with(claims, q.insert_ramps, territory_id, [r.sent() for r in body.rows])
