"""Console home (/console) data — replaces the direct supabase-js reads in
surface-ui/admin/src/routes/_authenticated/console.tsx.

Everything runs as the signed-in user (role `authenticated`), so the professionals /
organizations / exp_contracts / gbp_categories / disco_jobs / exp_activity_events RLS decides
access exactly as it did for the browser.

Moved from the ops Surface (its console routes in ops/routers/console_data.py), surface audit
2026-10-25. The UI URL (/console) is unchanged."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.admin.queries import console_home as console

router = APIRouter(prefix="/admin/console", tags=["admin"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _db_error(exc: psycopg.Error) -> HTTPException:
    """The database's message reaches the page, as supabase-js `error.message` did."""
    msg = (exc.diag.message_primary if exc.diag else None) or "Request failed"
    code = status.HTTP_403_FORBIDDEN if "row-level security" in msg \
        else status.HTTP_400_BAD_REQUEST
    return HTTPException(code, msg)


def _guard(fn, *args):
    try:
        return fn(*args)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except psycopg.Error as exc:
        raise _db_error(exc) from exc


@router.get("/profiles")
def console_profiles(d7: str, d14: str, today: str,
                     claims: dict = Depends(current_user)) -> dict[str, int]:
    with _read(claims) as conn:
        return _guard(console.profiles, conn, d7, d14, today)


@router.get("/revenue")
def console_revenue(claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(console.revenue, conn)


@router.get("/categories")
def console_categories(today: str, claims: dict = Depends(current_user)) -> dict[str, int]:
    with _read(claims) as conn:
        return _guard(console.categories, conn, today)


@router.get("/nora-events")
def console_nora_events(since: str, claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(console.nora_events, conn, since)
