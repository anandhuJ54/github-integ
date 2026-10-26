"""Response models for GET /etl/run-monitor (`run_monitor/router.py`)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class Progress(BaseModel):
    total: int
    processed: int
    remaining: int
    pctComplete: float


class NodeCounts(BaseModel):
    product_service: int
    social_profile: int
    credential: int


class Yield(BaseModel):
    profiles: int
    withBio: int
    withPhoto: int
    withPlaceId: int
    nodes: NodeCounts


class FieldFloor(BaseModel):
    gcid: str
    min_fields: int
    required_keys: list[str] | None
    min_products: int | None
    min_licenses: int | None
    notes: str | None
    created_at: str
    updated_at: str


class FlaggedRow(BaseModel):
    stage_id: str
    detail_url: str | None
    resolution_status: str
    reasons: list[str]
    resolved_at: str | None


class Gate(BaseModel):
    floors: list[FieldFloor]
    flagged: int
    shallowRate: float
    recent: list[FlaggedRow]


class Depth(BaseModel):
    baseline: int
    avgFieldsNow: float | None
    deepRows: int


class EtlMonitor(BaseModel):
    progress: Progress
    yield_: Yield = Field(alias="yield")
    gate: Gate
    depth: Depth
