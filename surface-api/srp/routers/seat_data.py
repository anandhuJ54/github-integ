"""srp seat, NORA interview and pro dashboard data — replaces the direct supabase-js calls in
surface-ui/srp (seat, interview data, office mode and the dashboard route files).

Moved from xmp (xmp/routers/seat_data.py), surface audit 2026-10-25 (the seat area and the pro
dashboard belong to srp): /xmp/seat/*, /xmp/interview/*, /xmp/dashboard/* and the
exp_office_mode RPC (/xmp/rpc/exp_office_mode) → /srp/... . Same SQL, roles and responses.

Everything runs as the signed-in user (these pages are all under `_authenticated`), so RLS and
the SECURITY INVOKER functions decide as they did for the browser. Reads keep the 1000-row
PostgREST cap.
"""
from __future__ import annotations

from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from _base.auth import current_user
from _base.db import session as db
from srp.queries import common, dashboard, seat

router = APIRouter(prefix="/srp", tags=["srp"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _guard(fn, *args):
    try:
        return fn(*args)
    except common.MultipleRows as exc:  # PostgREST answered `.maybeSingle()` on 2+ rows with 406
        raise HTTPException(status.HTTP_406_NOT_ACCEPTABLE, str(exc)) from exc
    except psycopg.Error as exc:  # the database's message reaches the page
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with _read(claims) as conn:
        return _guard(fn, conn, *args)


def _uid(claims: dict) -> str:
    return str(claims.get("sub") or "")


# --- RPCs (lib/office-mode.ts) -----------------------------------------------------------------

class SrpRpcArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: SrpRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed SECURITY INVOKER read (common.SRP_RPCS): rows, or the jsonb value."""
    try:
        common.rpc_sql(name, body.args)  # refuse before leasing a connection
    except common.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _read_with(claims, common.call_rpc, name, body.args)


# --- seat (lib/seat.ts) ------------------------------------------------------------------------

@router.get("/seat/location/{office_id}")
def location_seat(office_id: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, seat.location_seat, office_id)


@router.get("/seat/professional/{pro_id}")
def professional_seat(pro_id: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, seat.professional_seat, pro_id)


@router.get("/seat/listings")
def seat_listings(entity_type: seat.Kind, entity_id: str,
                  claims: dict = Depends(current_user)) -> list:
    """loadListings() for one record (errors ignored → [])."""
    return _read_with(claims, seat.listings, entity_type, entity_id)


# --- interview (lib/nora/interview-data.ts) ----------------------------------------------------

@router.get("/interview/subject/{kind}/{entity_id}")
def interview_subject(kind: Literal["professional", "office"], entity_id: str,
                      claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, seat.interview_subject, kind, entity_id)


@router.get("/interview/claim/{entity_id}")
def interview_claim(entity_id: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, seat.claim_queue_row, entity_id)


# --- dashboard ---------------------------------------------------------------------------------

ProId = Query(None, description="read this professional instead of the caller's own")


@router.get("/dashboard/home")
def dashboard_home(professional_id: str | None = ProId,
                   claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, dashboard.home, _uid(claims), professional_id)


@router.get("/dashboard/content")
def dashboard_content(professional_id: str | None = ProId,
                      claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, dashboard.content, _uid(claims), professional_id)


@router.get("/dashboard/me")
def dashboard_me(professional_id: str | None = ProId, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, dashboard.me, _uid(claims), professional_id)


@router.get("/dashboard/listings")
def dashboard_listings(entity_type: seat.Kind, entity_id: str, gcid: str | None = None,
                       claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, dashboard.listing_rows, entity_type, entity_id, gcid)


@router.get("/dashboard/reviews")
def dashboard_reviews(professional_id: str | None = ProId,
                      claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, dashboard.reviews, _uid(claims), professional_id)
