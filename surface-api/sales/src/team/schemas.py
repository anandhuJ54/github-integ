"""Request models for the sales team endpoints (moved out of team/router.py)."""
from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesTeamsTerritoryIds(_Body):
    territory_ids: list[str] = Field(default_factory=list)


class SalesTeamsTerritoryPatch(_Body):
    """assignSeller / unassignSeller {seller_id, status}; recountTerritories {brand_count,
    office_count, agent_count}."""
    seller_id: str | None = None
    status: str | None = None
    brand_count: int | None = None
    office_count: int | None = None
    agent_count: int | None = None


class SalesTeamsMoveTo(_Body):
    territory_id: str


class SalesTeamsProfessionalsMove(_Body):
    """One chunk of moveBrandTerritory's org ids (the browser sends at most 500)."""
    org_ids: list[str] = Field(max_length=500)
    territory_id: str


class SalesTeamsQuotaTarget(_Body):
    target: Decimal | None = None


class SalesTeamsMonthQuotaNew(_Body):
    """assignSeller's new quota (period_type "month", actual 0 and period_start — the current
    period by the server's clock — are set by the server)."""
    rep_id: str
    group_key: str
    target: Decimal | None = None
