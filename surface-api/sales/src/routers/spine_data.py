"""sales spine (S4) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/sales-spine.ts (loadScopeDashboard, loadWorklist, loadProfileMeta).

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser.
Read-only (graph_nodes included: read, never written). The browser keeps the call order (its
other loaders run beside these, as before), the scope filters, claim buckets and money rollups.
The id-list reads are POST so a long list fits.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from _base.auth import current_user
from surfaces.sales.queries import spine as q
from surfaces.sales.routers.cpq_data import _Body, _read_with

router = APIRouter(prefix="/sales/spine", tags=["sales"])


@router.get("/scope")
def load_scope(group_key: str | None = Query(None, max_length=200),
               claims: dict = Depends(current_user)) -> dict:
    """loadScopeDashboard's reads: `{ claims, territories, metrics, contracts, pipeline }`
    (claims: the oldest 1000 claim events; territories / metrics of the group when given)."""
    return _read_with(claims, q.load_scope, group_key)


class SalesSpineIds(_Body):
    ids: list[str] = Field(min_length=1, max_length=5000)


@router.post("/scope-logos")
def scope_logos(body: SalesSpineIds, claims: dict = Depends(current_user)) -> list:
    """loadScopeDashboard's logo read: `[{id, name, logo_url}]` of the ids."""
    return _read_with(claims, q.logos, body.ids, False)


@router.get("/worklist")
def load_worklist_rows(claims: dict = Depends(current_user)) -> dict:
    """loadWorklist's own reads: `{ claims, opportunities }` (claims: the newest 1000 claim
    events; opportunities: the 500 most recently updated open ones)."""
    return _read_with(claims, q.load_worklist_rows)


@router.get("/reps/{rep_id}/territory-brands")
def territory_brands(rep_id: str, claims: dict = Depends(current_user)) -> dict:
    """loadWorklist's seat logos: `{ seats, owned, brands }` (the rep's seat and owned
    territories, then their brands' org ids)."""
    return _read_with(claims, q.territory_brands, rep_id)


@router.post("/worklist-logos")
def worklist_logos(body: SalesSpineIds, claims: dict = Depends(current_user)) -> list:
    """loadWorklist's logo read: `[{id, name, logo_url, parent_org_id}]` of the ids."""
    return _read_with(claims, q.logos, body.ids, True)


@router.post("/location-counts")
def location_counts(body: SalesSpineIds, claims: dict = Depends(current_user)) -> dict:
    """loadWorklist's per-logo location counts: `{ <org id>: count | null }` (null where the
    count failed)."""
    return _read_with(claims, q.location_counts, body.ids)


class SalesSpineEntityIds(_Body):
    ids: list[str] = Field(min_length=1, max_length=20000)


@router.post("/profile-meta")
def profile_meta(body: SalesSpineEntityIds, claims: dict = Depends(current_user)) -> dict:
    """loadProfileMeta's reads: `{ scores, nodes }` — per 200-id chunk the search_rank_scores
    rows and the active graph_nodes rows, each chunk's read capped at 1000 on its own."""
    return _read_with(claims, q.profile_meta, body.ids)
