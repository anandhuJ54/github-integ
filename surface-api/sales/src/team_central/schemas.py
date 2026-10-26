"""Request models for the sales team_central endpoints (moved out of team_central/router.py)."""
from __future__ import annotations

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesTeamFamilyIn(_Body):
    family_key: str | None = None
    territory_ids: list[str] = Field(default_factory=list, max_length=1000)
    year: int
