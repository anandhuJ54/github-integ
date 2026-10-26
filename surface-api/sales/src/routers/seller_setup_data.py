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

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from _base.auth import current_user
from surfaces.sales.queries import seller_setup as q
from surfaces.sales.routers.cpq_data import _Body, _read_with, _write_with

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

class SalesSellerSetupRep(_Body):
    """saveSellerSetup's repPayload (the browser sends every key)."""
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    title: str | None = None
    photo_url: str | None = None
    hire_date: date | None = None
    on_duty: bool | None = None
    backup_rep_id: str | None = None
    role: str | None = None
    group_key: str | None = None
    team_name: str | None = None
    attribution_target: Decimal | None = None
    sdrcloud_url: str | None = None


@router.post("/reps")
def insert_rep(body: SalesSellerSetupRep, claims: dict = Depends(current_user)) -> dict:
    """A new rep: insert(...).select("id").single(). Returns {id}."""
    return _write_with(claims, q.insert_rep, body.sent())


@router.patch("/reps/{rep_id}")
def update_rep(rep_id: str, body: SalesSellerSetupRep, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_rep, rep_id, body.sent())


class SalesSellerSetupVerticalsNew(_Body):
    group_keys: list[str] = Field(default_factory=list)


@router.post("/reps/{rep_id}/verticals")
def insert_verticals(rep_id: str, body: SalesSellerSetupVerticalsNew,
                     claims: dict = Depends(current_user)) -> dict:
    """One row per group key, in one insert."""
    return _write_with(claims, q.insert_verticals, rep_id, body.group_keys)


@router.delete("/verticals/{vertical_id}")
def delete_vertical(vertical_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete_vertical, vertical_id)


class SalesSellerSetupQuotaPatch(_Body):
    target: Decimal | None = None
    actual: Decimal | None = None


@router.patch("/quotas/{quota_id}")
def update_quota(quota_id: str, body: SalesSellerSetupQuotaPatch,
                 claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_quota, quota_id, body.sent())


class SalesSellerSetupQuotaNew(_Body):
    """A quarter quota (period_type "quarter" is set by the server)."""
    rep_id: str
    group_key: str
    period_start: date
    target: Decimal | None = None
    actual: Decimal | None = None


@router.post("/quotas")
def insert_quota(body: SalesSellerSetupQuotaNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.insert_quarter_quota, body.sent())
