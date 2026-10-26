"""Admin console pages' data — replaces the direct supabase-js reads/writes in
surface-ui/admin/src/routes/_authenticated/{professionals,organizations,compliance,admin.users}.tsx.

Everything runs as the signed-in user (role `authenticated`); RLS and the governed functions
decide access, exactly as they did for the browser.
"""
from __future__ import annotations

from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from _base.auth import current_user
from _base.db import session as db
from admin.queries import compliance, grants, organizations, professionals

router = APIRouter(prefix="/admin", tags=["admin"])

Ids = Field(default_factory=list, max_length=1000)


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _db_error(exc: psycopg.Error, default: str) -> HTTPException:
    msg = (exc.diag.message_primary if exc.diag else None) or default
    code = status.HTTP_403_FORBIDDEN if msg == "forbidden" or "row-level security" in msg \
        else status.HTTP_400_BAD_REQUEST
    return HTTPException(code, msg)


# --- /professionals --------------------------------------------------------------------------

class ProIds(BaseModel):
    ids: list[str] = Ids


class ProExtrasIn(BaseModel):
    orgIds: list[str] = Ids
    gcids: list[str] = Ids


@router.get("/professionals/categories")
def pro_categories(claims: dict = Depends(current_user)) -> list[str]:
    with _read(claims) as conn:
        return professionals.category_options(conn)


@router.get("/professionals/stats")
def pro_stats(claims: dict = Depends(current_user)) -> dict[str, int]:
    with _read(claims) as conn:
        return professionals.stats(conn)


@router.get("/professionals")
def pro_page(
    search: str = "",
    gcid: str = "all",
    location: str = "",
    claimed: Literal["all", "claimed", "unclaimed"] = "all",
    score: Literal["all", "0-300", "300-600", "600-850", "unscored"] = "all",
    page: int = Query(0, ge=0, le=10_000),
    claims: dict = Depends(current_user),
) -> dict[str, Any]:
    with _read(claims) as conn:
        return professionals.page(conn, search=search, gcid=gcid, location=location,
                                  claimed=claimed, score=score, page_no=page)


@router.post("/professionals/scores")
def pro_scores(body: ProIds, claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return professionals.scores(conn, body.ids) if body.ids else {}


@router.post("/professionals/depth")
def pro_depth(body: ProIds, claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return professionals.depth(conn, body.ids) if body.ids else {}


@router.post("/professionals/extras")
def pro_extras(body: ProExtrasIn, claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return professionals.extras(conn, body.orgIds, body.gcids)


# --- /organizations --------------------------------------------------------------------------

@router.get("/organizations/categories")
def org_categories(claims: dict = Depends(current_user)) -> list[str]:
    with _read(claims) as conn:
        return organizations.category_options(conn)


@router.get("/organizations")
def org_page(
    search: str = "",
    gcid: str = "all",
    status_: Literal["all", "claimed", "unclaimed", "scored"] = Query("all", alias="status"),
    scope: Literal["all", "real", "demo"] = "real",
    page: int = Query(0, ge=0, le=10_000),
    claims: dict = Depends(current_user),
) -> dict[str, Any]:
    with _read(claims) as conn:
        return organizations.page(conn, search=search, gcid=gcid, status=status_, scope=scope,
                                  page_no=page)


# --- /compliance -----------------------------------------------------------------------------

@router.get("/compliance/coverage")
def compliance_coverage(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return compliance.coverage(conn)


@router.get("/compliance/entities")
def compliance_entities(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return compliance.entities(conn)


# --- /admin/users (super_admin only, enforced by the database) --------------------------------

class GrantIn(BaseModel):
    user_id: str = Field(min_length=36, max_length=36)
    role: Literal["super_admin", "architect", "analyst"]


@router.get("/control-users")
def control_users(claims: dict = Depends(current_user)) -> list[dict[str, Any]]:
    try:
        with _read(claims) as conn:
            return grants.control_users(conn)
    except psycopg.Error as exc:
        raise _db_error(exc, "Could not list users") from exc


@router.get("/control-grants")
def control_grants(claims: dict = Depends(current_user)) -> list[dict[str, Any]]:
    with _read(claims) as conn:
        return grants.all_grants(conn)


@router.post("/control-grants")
def assign_grant(body: GrantIn, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            grants.assign(conn, body.user_id, body.role)
    except psycopg.Error as exc:
        raise _db_error(exc, "Could not assign the role") from exc
    return {"ok": True}


@router.delete("/control-grants/{grant_id}")
def revoke_grant(grant_id: str, claims: dict = Depends(current_user)) -> dict:
    try:
        with db.role_connection("authenticated", claims, write=True) as conn:
            grants.revoke(conn, grant_id)
    except psycopg.Error as exc:
        raise _db_error(exc, "Could not revoke the role") from exc
    return {"ok": True}
