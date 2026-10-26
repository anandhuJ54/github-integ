"""Request models for the sales territory endpoints (moved out of territory/router.py)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesTerritoryRepPatch(_Body):
    """setRepDuty / setRepBackup."""
    on_duty: bool | None = None
    backup_rep_id: str | None = None


class SalesTerritoryQuota(_Body):
    """assignTerritory (no group_key) / saveQuota / assignGroupTerritory (group_key sent)."""
    rep_id: str
    group_key: str | None = None
    target: Decimal


class SalesTerritoryIds(_Body):
    territory_ids: list[str]


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


class SalesTerritoryProposalReview(_Body):
    """approveProposal / rejectProposal (reviewed_at is the server's clock)."""
    state: str
    payload: Any = None


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


class SalesTerritorySeatPatch(_Body):
    monthly_quota: Decimal | None = None


class SalesTerritoryRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


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


class SalesTerritoryBrandLink(_Body):
    org_id: str
    lane: str | None = None


class SalesTerritoryAssignmentNew(_Body):
    rep_id: str | None = None
    group_key: str | None = None
    assignment_type: Literal["account", "claims_queue"]


class SalesTerritoryRampRow(_Body):
    rep_id: str | None = None
    month_offset: int
    ramp_pct: Decimal


class SalesTerritoryRampRows(_Body):
    rows: list[SalesTerritoryRampRow]
