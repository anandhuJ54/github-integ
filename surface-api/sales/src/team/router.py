"""sales teams (S4) — replaces the direct supabase-js calls in surface-ui/sales/src/lib/teams.ts
(territory management) and the rep-name read in routes/_authenticated/sales.promos.tsx.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads
come back raw; the browser still joins them (brands to territories, sellers, quota sums). Writes
are the browser's statements, one endpoint per supabase-js call, in the browser's order; each
request model allow-lists the columns the page sends and only the keys sent are written. Quota
targets are `Decimal` (never float, never rounded); integer counts take whole numbers only, as
Postgres did. No column takes the clock or the signed-in user.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from _base.auth import current_user
from surfaces.sales.internal import _read_with, _write_with
from surfaces.sales.team import services as q
from surfaces.sales.team.schemas import (
    SalesTeamsMonthQuotaNew,
    SalesTeamsMoveTo,
    SalesTeamsProfessionalsMove,
    SalesTeamsQuotaTarget,
    SalesTeamsTerritoryIds,
    SalesTeamsTerritoryPatch,
)

router = APIRouter(prefix="/sales/teams", tags=["sales"])


# --- reads -----------------------------------------------------------------------------------

@router.get("/reps")
def list_reps(claims: dict = Depends(current_user)) -> list:
    """loadReps: id, name, role, group_key, on_duty, is_demo, photo_url by name."""
    return _read_with(claims, q.list_reps)


@router.get("/rep-names")
def rep_names(claims: dict = Depends(current_user)) -> list:
    """sales.promos.tsx: every rep's id and name (no order)."""
    return _read_with(claims, q.rep_names)


@router.get("/territories")
def list_territories(group_key: str | None = Query(None),
                     claims: dict = Depends(current_user)) -> list:
    """Every territory (or one group's: `group_key`, "" included) by tier, seq."""
    return _read_with(claims, q.list_territories, group_key)


@router.get("/territories/all")
def all_territories(claims: dict = Depends(current_user)) -> list:
    """loadAllBrandLinks: every territory, no order."""
    return _read_with(claims, q.all_territories)


@router.get("/territories/{territory_id}")
def get_territory(territory_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadTeamDetail: the territory, or null (406 for two)."""
    return _read_with(claims, q.get_territory, territory_id)


@router.get("/territories/{territory_id}/counts")
def territory_counts(territory_id: str, brands: bool = Query(False),
                     claims: dict = Depends(current_user)) -> dict:
    """The territory's exact counts, null where a count failed: `{ profiles, offices }`
    (loadTeamDetail), or with `brands=true` `{ brands, offices, profiles }`
    (recountTerritories)."""
    return _read_with(claims, q.territory_counts, territory_id, brands)


@router.post("/brands")
def brands_for_territories(body: SalesTeamsTerritoryIds,
                           claims: dict = Depends(current_user)) -> dict:
    """brandsForTerritories' reads: `{ links, orgs, offices, profiles }` — the open links of the
    territories, their organizations, one office count per distinct org (link order) and one
    professional count per link (null where a count failed). A POST only to carry the id list."""
    return _read_with(claims, q.brands_for_territories, body.territory_ids)


@router.get("/quotas")
def group_quotas(group_key: str = Query(...), claims: dict = Depends(current_user)) -> list:
    """loadGroupTeams: the group's quotas for the current period (the first of this UTC month by
    the server's clock; the browser used its own). Errors ignored: []."""
    return _read_with(claims, q.group_quotas, group_key)


@router.get("/quotas/lookup")
def quota_lookup(rep_id: str = Query(...), group_key: str = Query(...),
                 claims: dict = Depends(current_user)) -> dict | None:
    """assignSeller: {id} of the rep's quota for the group in the current period, or null (also
    for two rows or an error, which the browser ignored)."""
    return _read_with(claims, q.quota_lookup, rep_id, group_key)


@router.get("/organizations/{org_id}/offices")
def office_ids(org_id: str, claims: dict = Depends(current_user)) -> list:
    """moveBrandTerritory, step 4: the brand's child offices' ids, at most 1000 (the browser's
    limit(50000) was cut to 1000 by PostgREST; ported as it is: follow-up 1j in
    docs/BROWSER_TO_API_FOLLOWUPS.md). Errors ignored: []."""
    return _read_with(claims, q.office_ids, org_id)


# --- writes ----------------------------------------------------------------------------------

@router.patch("/territories/{territory_id}")
def update_territory(territory_id: str, body: SalesTeamsTerritoryPatch,
                     claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_territory, territory_id, body.sent())


@router.patch("/brand-links/{link_id}")
def move_link(link_id: str, body: SalesTeamsMoveTo, claims: dict = Depends(current_user)) -> dict:
    """moveBrandTerritory, step 1: the link's territory."""
    return _write_with(claims, q.move_link, link_id, body.territory_id)


@router.patch("/organizations/{org_id}/territory")
def stamp_org(org_id: str, body: SalesTeamsMoveTo, claims: dict = Depends(current_user)) -> dict:
    """moveBrandTerritory, step 2: the brand organization's territory."""
    return _write_with(claims, q.stamp_org, org_id, body.territory_id)


@router.patch("/organizations/{org_id}/offices/territory")
def stamp_offices(org_id: str, body: SalesTeamsMoveTo,
                  claims: dict = Depends(current_user)) -> dict:
    """moveBrandTerritory, step 3: every child office's territory (parent_org_id)."""
    return _write_with(claims, q.stamp_offices, org_id, body.territory_id)


@router.patch("/professionals/territory")
def stamp_professionals(body: SalesTeamsProfessionalsMove,
                        claims: dict = Depends(current_user)) -> dict:
    """moveBrandTerritory, step 5: the professionals whose primary_org_id is in the chunk. Which
    orgs are in it is the browser's (the brand + the ≤1000 offices of step 4: follow-up 1j)."""
    return _write_with(claims, q.stamp_professionals, body.org_ids, body.territory_id)


@router.patch("/quotas/{quota_id}")
def update_quota_target(quota_id: str, body: SalesTeamsQuotaTarget,
                        claims: dict = Depends(current_user)) -> dict:
    """assignSeller: the existing quota's target."""
    return _write_with(claims, q.update_quota_target, quota_id, body.sent())


@router.post("/quotas")
def insert_month_quota(body: SalesTeamsMonthQuotaNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.insert_month_quota, body.sent())
