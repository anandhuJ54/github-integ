"""The long-form professional profile page data (/:category/:city/:professional, surface-ui/search).

Moved from graph (/graph/profile/{slug}, /graph/profile-services → /search/profile-page/{slug},
/search/profile-services), surface audit 2026-10-25. Same SQL, role and responses: the page runs
as the signed-in user, so RLS decides as it did for the browser.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from _base.db.sql import fetch_all
from surfaces.search.profile_page import services as q

router = APIRouter(prefix="/search", tags=["search"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _guard(fn, *args):
    try:
        return fn(*args)
    except q.MultipleRows as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except psycopg.Error as exc:  # the function's / database's message reaches the page
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "insufficient_privilege" in msg or "forbidden" in msg.lower() or "row-level security" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _rows(claims: dict, stmt: Any) -> list[dict[str, Any]]:
    with _read(claims) as conn:
        return _guard(fetch_all, conn, stmt)


@router.get("/profile-page/{slug}")
def professional_page(slug: str, claims: dict = Depends(current_user)) -> dict:
    """loadProfile(): the view row (null when unknown) and its side reads."""
    with _read(claims) as conn:
        return _guard(q.professional_page, conn, slug)


@router.get("/profile-services")
def profile_services(gcid: str, claims: dict = Depends(current_user)) -> list:
    """ServicesSection: a category's services (errors were shown as none)."""
    try:
        return _rows(claims, q.services_stmt(gcid))
    except HTTPException:
        return []
