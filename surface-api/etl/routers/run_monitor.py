"""GET /etl/run-monitor — the console's live ETL run monitor (read-only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from _base.auth import current_user
from _base.db import session as db
from etl.queries.run_monitor import load_etl_monitor

router = APIRouter(prefix="/etl", tags=["etl"])


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


@router.get("/run-monitor", response_model=EtlMonitor, response_model_by_alias=True)
def etl_monitor(claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims) as conn:
        return load_etl_monitor(conn)
