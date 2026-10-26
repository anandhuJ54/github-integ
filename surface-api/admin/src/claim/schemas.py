"""Request/response models of the admin `claim` resource (moved out of its router modules)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ClaimStats(BaseModel):
    pending: int
    approved: int
    manual: int
    conflict: int


class Claim(BaseModel):
    # `select *` on claim_queue: the page reads these; the rest pass through.
    model_config = {"extra": "allow"}
    id: str
    entity_type: str
    entity_id: str
    claimant_user_id: str | None
    claimant_email: str | None
    claimant_name: str | None
    confidence_score: float | None
    confidence_signals: dict[str, Any] | None
    match_method: str | None
    status: str | None
    review_notes: str | None
    created_at: str | None


class EntitiesIn(BaseModel):
    professionalIds: list[str] = Field(default_factory=list, max_length=200)
    organizationIds: list[str] = Field(default_factory=list, max_length=200)


class Entity(BaseModel):
    name: str
    gcid: str | None
    imageUrl: str | None
    kind: Literal["professional", "organization"]


class AdjudicateIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=2000)
