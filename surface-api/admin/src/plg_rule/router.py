"""PLG rules admin endpoints for /emp/plg-rules (replaces the page's direct table reads/writes)."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.admin.plg_rule import services as q
from surfaces.admin.plg_rule.schemas import ActiveIn, RuleIn, RulesPage

router = APIRouter(prefix="/admin/plg-rules", tags=["admin"])


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
