"""PLG rules admin endpoints for /emp/plg-rules (replaces the page's direct table reads/writes)."""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from _base.auth import current_user
from _base.db import session as db
from admin.queries import plg_rules as q

router = APIRouter(prefix="/admin/plg-rules", tags=["admin"])


class Rule(BaseModel):
    id: str
    gcid: str | None
    rule_name: str
    rule_type: str
    trigger_condition: dict[str, Any] | None
    priority: int | None
    headline: str | None
    body: str | None
    cta_text: str | None
    cta_action: str | None
    cta_url: str | None
    requires_upgrade: bool | None
    upgrade_tier: str | None
    icon: str | None
    is_active: bool | None
    created_at: str | None


class EventStat(BaseModel):
    rule_id: str
    fires: int
    dismissals: int
    conversions: int


class RulesPage(BaseModel):
    rules: list[Rule]
    stats: list[EventStat]


class RuleIn(BaseModel):
    """What the editor saves (the page normalizes empty strings to null before sending)."""
    gcid: str | None = None
    rule_name: str = Field(min_length=1, max_length=200)
    rule_type: str = Field(min_length=1, max_length=50)
    trigger_condition: dict[str, Any] = Field(default_factory=dict)
    priority: int = 50
    headline: str | None = None
    body: str | None = None
    cta_text: str | None = None
    cta_action: str | None = None
    cta_url: str | None = None
    requires_upgrade: bool = False
    upgrade_tier: str | None = None
    icon: str | None = None
    is_active: bool = True


class ActiveIn(BaseModel):
    is_active: bool


def _bad(exc: psycopg.Error) -> HTTPException:
    msg = (exc.diag.message_primary if exc.diag else None) or "Request failed"
    return HTTPException(status.HTTP_400_BAD_REQUEST, msg)


@router.get("", response_model=RulesPage)
def rules_page(claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims) as conn:
        return {"rules": q.list_rules(conn), "stats": q.event_stats(conn)}


@router.post("")
def create_rule(body: RuleIn, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            return {"id": q.create(conn, body.model_dump())}
    except psycopg.Error as exc:
        raise _bad(exc) from exc


@router.put("/{rule_id}")
def save_rule(rule_id: str, body: RuleIn, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            q.save(conn, rule_id, body.model_dump())
    except psycopg.Error as exc:
        raise _bad(exc) from exc
    return {"ok": True}


@router.patch("/{rule_id}/active")
def set_active(rule_id: str, body: ActiveIn, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            q.set_active(conn, rule_id, body.is_active)
    except psycopg.Error as exc:
        raise _bad(exc) from exc
    return {"ok": True}


@router.post("/{rule_id}/duplicate")
def duplicate_rule(rule_id: str, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            new_id = q.duplicate(conn, rule_id)
    except psycopg.Error as exc:
        raise _bad(exc) from exc
    if new_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return {"id": new_id}


@router.delete("/{rule_id}")
def delete_rule(rule_id: str, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            q.remove(conn, rule_id)
    except psycopg.Error as exc:
        raise _bad(exc) from exc
    return {"ok": True}
