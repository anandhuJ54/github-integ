"""sales navigation (S4) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/sales-nav.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. Each
returns the rows of one loader, raw; the browser keeps the overview math, the browse mapping and
the drill-down rollups. Read-only.

The Directory drill-downs' professional and organization rows moved to srp
(/srp/directory/professionals/{id}, /srp/directory/organizations/{id}) and the brand rollup to
xmp (/xmp/directory/brands/{id}/rollup), surface audit 2026-10-25; the pages stay here.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.auth import current_user
from surfaces.sales.internal import _read_with
from surfaces.sales.nav import services as q
from surfaces.sales.nav.schemas import (
    SalesNavAccountIds,
)

router = APIRouter(prefix="/sales/nav", tags=["sales"])


@router.get("/overview")
def load_overview(period: str = Query(..., max_length=20), since: dt.date = Query(...),
                  claims: dict = Depends(current_user)) -> dict:
    """loadOverview's rows: `{ reps, quotas, contracts, cats, proClaims, orgClaims, events,
    assignments }` for the period starting `since` (the page's periodStart)."""
    return _read_with(claims, q.load_overview, period, since)


@router.get("/browse")
def browse(tab: str = Query(..., pattern="^(" + "|".join(q.TABS) + ")$"),
           q_: str = Query("", alias="q", max_length=500), page: int = Query(1, ge=1),
           page_size: int = Query(..., ge=1, le=1000), gcid: str | None = Query(None, max_length=200),
           include_demo: bool = Query(False), claims: dict = Depends(current_user)) -> dict:
    """browse's read: `{ rows, count }` (teams / sellers: every rep, count null)."""
    try:
        return _read_with(claims, q.browse, tab, q_, page, page_size, gcid, include_demo)
    except q.RangeNotSatisfiable as exc:
        raise HTTPException(status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, str(exc)) from exc


@router.get("/scores/{entity_id}")
def load_score(entity_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadScore: the entity's newest search_rank_scores row, or null."""
    return _read_with(claims, q.load_score, entity_id)


@router.get("/events")
def load_events_for(subject_id: str | None = Query(None), account_id: str | None = Query(None),
                    logo: str | None = Query(None), location: str | None = Query(None),
                    claims: dict = Depends(current_user)) -> list:
    """loadEventsFor: the 200 newest activity events of the first filter given."""
    return _read_with(claims, q.load_events_for, subject_id, account_id, logo, location)


@router.get("/sellers/{rep_id}")
def load_seller(rep_id: str, claims: dict = Depends(current_user)) -> dict:
    """loadSeller: `{ rep, quotas, assignments }` (rep null when there is none)."""
    return _read_with(claims, q.load_seller, rep_id)


@router.post("/seller-book")
def load_seller_book(body: SalesNavAccountIds, claims: dict = Depends(current_user)) -> dict:
    """loadSellerBook: `{ contracts, events }` of the accounts (a read; POST so a long id list
    fits)."""
    return _read_with(claims, q.load_seller_book, body.account_ids)


@router.get("/category-dashboard")
def load_category_dashboard(gcid: str = Query(..., max_length=200),
                            claims: dict = Depends(current_user)) -> dict:
    """loadCategoryDashboard: `{ category, orgCount, proCount, sampleOrgs }`."""
    return _read_with(claims, q.load_category_dashboard, gcid)


@router.get("/teams/{group_key}")
def load_team(group_key: str, claims: dict = Depends(current_user)) -> dict:
    """loadTeam: `{ reps, quotas, tiers }` of the group."""
    return _read_with(claims, q.load_team, group_key)
