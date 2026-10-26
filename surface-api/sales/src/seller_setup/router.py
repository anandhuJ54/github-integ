"""sales seller setup (S4) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/seller-setup.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
form's reads come back in one response, raw; the browser still maps and joins them. saveSellerSetup
stays orchestrated by the browser, one endpoint per supabase-js call, in its order; the territory
assignment, the logo moves and the recount go through the /sales/teams endpoints (as the browser
reused teams.ts). Each request model allow-lists the columns the page sends and only the keys sent
are written. Quota and attribution values are `Decimal` (never float, never rounded). No column
takes the clock or the signed-in user: the rep id is the form's.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from _base.auth import current_user
from surfaces.sales.internal import _read_with, _write_with
from surfaces.sales.seller_setup import services as q
from surfaces.sales.seller_setup.schemas import (
    SalesSellerSetupQuotaNew,
    SalesSellerSetupQuotaPatch,
    SalesSellerSetupRep,
    SalesSellerSetupVerticalsNew,
)

router = APIRouter(prefix="/sales/seller-setup", tags=["sales"])


@router.get("")
def load_setup(year: int = Query(...), rep_id: str | None = Query(None),
               claims: dict = Depends(current_user)) -> dict:
    """loadSellerSetup's reads: `{ reps, territories, rep, verticals, quotas, links, orgs }`
    (the rep's rows only with `rep_id`; quotas are the year's quarters). Errors ignored."""
    return _read_with(claims, q.load_setup, rep_id or None, year)


# --- reads during the save -------------------------------------------------------------------

@router.get("/reps/{rep_id}/verticals")
def rep_verticals(rep_id: str, claims: dict = Depends(current_user)) -> list:
    """The rep's vertical rows (id, group_key). Errors ignored: []."""
    return _read_with(claims, q.rep_verticals, rep_id)


@router.get("/reps/{rep_id}/territories")
def rep_territories(rep_id: str, claims: dict = Depends(current_user)) -> list:
    """The ids of the territories the rep holds. Errors ignored: []."""
    return _read_with(claims, q.rep_territories, rep_id)


@router.get("/reps/{rep_id}/quota-ids")
def quota_ids(rep_id: str, year: int = Query(...), claims: dict = Depends(current_user)) -> list:
    """The rep's quarter quotas of the year (id, period_start). Errors ignored: []."""
    return _read_with(claims, q.quota_ids, rep_id, year)


@router.get("/brand-links")
def all_links(claims: dict = Depends(current_user)) -> list:
    """Every territory-brand link (id, territory_id, org_id, lane). Errors ignored: []."""
    return _read_with(claims, q.all_links)


@router.get("/slots")
def slots(group_key: str = Query(...), tier: str = Query(...),
          claims: dict = Depends(current_user)) -> list:
    """The territories of a group and tier (id, group_key, tier, seller_id), to park removed
    logos on. Errors ignored: []."""
    return _read_with(claims, q.slots, group_key, tier)


# --- writes ----------------------------------------------------------------------------------

@router.post("/reps")
def insert_rep(body: SalesSellerSetupRep, claims: dict = Depends(current_user)) -> dict:
    """A new rep: insert(...).select("id").single(). Returns {id}."""
    return _write_with(claims, q.insert_rep, body.sent())


@router.patch("/reps/{rep_id}")
def update_rep(rep_id: str, body: SalesSellerSetupRep, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_rep, rep_id, body.sent())


@router.post("/reps/{rep_id}/verticals")
def insert_verticals(rep_id: str, body: SalesSellerSetupVerticalsNew,
                     claims: dict = Depends(current_user)) -> dict:
    """One row per group key, in one insert."""
    return _write_with(claims, q.insert_verticals, rep_id, body.group_keys)


@router.delete("/verticals/{vertical_id}")
def delete_vertical(vertical_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete_vertical, vertical_id)


@router.patch("/quotas/{quota_id}")
def update_quota(quota_id: str, body: SalesSellerSetupQuotaPatch,
                 claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_quota, quota_id, body.sent())


@router.post("/quotas")
def insert_quota(body: SalesSellerSetupQuotaNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.insert_quarter_quota, body.sent())
