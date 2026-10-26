"""sales Team Central — replaces the direct supabase-js calls in surface-ui/sales/src/lib/insurance-team.ts.

Moved from xmp (/xmp/team/*, xmp/routers/enterprise_data.py), surface audit 2026-10-25 (§9 row E):
it reads sales tables (reps, territories, revenue, quotas, category groups). Same SQL, same answers.
No page uses it today (only the parity run).

Everything runs as the signed-in user, so RLS decides as it did for the browser; any error is
thrown, as the page did.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import Field

from _base.auth import current_user
from surfaces.sales.queries import team_central as q
from surfaces.sales.routers.cpq_data import _Body, _read_with

router = APIRouter(prefix="/sales/team-central", tags=["sales"])


@router.get("/{group_key}")
def team_base(group_key: str, claims: dict = Depends(current_user)) -> dict:
    """loadTeamCentral()'s first reads: {reps, territories, revenue, quotas, groups}."""
    return _read_with(claims, q.team_base, group_key)


class SalesTeamFamilyIn(_Body):
    family_key: str | None = None
    territory_ids: list[str] = Field(default_factory=list, max_length=1000)
    year: int


@router.post("/family")
def team_family(body: SalesTeamFamilyIn, claims: dict = Depends(current_user)) -> dict:
    """The family-dependent reads (a read; POST carries the territory ids):
    {links, orgs, sellers, expansion, months}."""
    return _read_with(claims, q.team_family, body.family_key, body.territory_ids, body.year)
