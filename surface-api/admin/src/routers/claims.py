"""Claims queue endpoints for /claims (replaces the page's direct claim_queue reads + RPC)."""
from __future__ import annotations

from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from surfaces.admin.queries import claims as q

from _base.auth import current_user
from _base.db import session as db

router = APIRouter(prefix="/admin/claims", tags=["admin"])

Tab = Literal["pending", "manual_review", "auto_approved", "conflict", "all"]


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


@router.get("/stats", response_model=ClaimStats)
def claim_stats(claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims) as conn:
        return q.claim_stats(conn)


@router.get("", response_model=list[Claim])
def list_claims(tab: Tab = "pending", claims: dict = Depends(current_user)) -> list[dict]:
    with db.role_connection("authenticated", claims) as conn:
        return q.claims_for_tab(conn, tab)


@router.post("/entities", response_model=dict[str, Entity])
def claim_entities(body: EntitiesIn, claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims) as conn:
        return q.claim_entities(conn, body.professionalIds, body.organizationIds)


@router.post("/{queue_id}/adjudicate")
def adjudicate(queue_id: str, body: AdjudicateIn, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            q.adjudicate(conn, queue_id, body.approve, body.note or None)
    except psycopg.Error as exc:  # the page shows the function's message, as it did from the RPC
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _message(exc)) from exc
    return {"ok": True}


def _message(exc: psycopg.Error) -> str:
    return (exc.diag.message_primary if exc.diag else None) or "Adjudication failed"
