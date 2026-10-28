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

import logging
from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.auth import current_srp_user, current_user
from _base.db import session as db
from _base.server_fn import not_implemented
from surfaces.srp import internal
from surfaces.srp.seat import (
    connections,
    dashboard,
    home,
    insights,
    local,
    profile,
    srs,
    web_analytics,
)
from surfaces.srp.seat import services as seat
from surfaces.srp.seat.schemas import (
    ConnectionsResponse,
    HomeResponse,
    InsightsResponse,
    ProfileResponse,
    SrpRpcArgs,
    SrsResponse,
    WebAnalyticsResponse,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/srp", tags=["srp"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _guard(fn, *args):
    try:
        return fn(*args)
    except internal.MultipleRows as exc:  # PostgREST answered `.maybeSingle()` on 2+ rows with 406
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

@router.post("/rpc/{name}")
def call_rpc(name: str, body: SrpRpcArgs, claims: dict = Depends(current_srp_user)) -> Any:
    """An allow-listed SECURITY INVOKER read (common.SRP_RPCS): rows, or the jsonb value."""
    if local.is_local_session(claims):  # local sign-in: only exp_office_mode, and it has no mode
        if name == "exp_office_mode":
            return local.office_mode()
        raise local.other_rpc(name)
    try:
        internal.rpc_sql(name, body.args)  # refuse before leasing a connection
    except internal.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _read_with(claims, internal.call_rpc, name, body.args)


# --- seat (lib/seat.ts) ------------------------------------------------------------------------

@router.get("/seat/location/{office_id}")
def location_seat(office_id: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, seat.location_seat, office_id)


@router.get("/seat/professional/{pro_id}")
def professional_seat(pro_id: str, claims: dict = Depends(current_srp_user)) -> dict | None:
    if local.is_local_session(claims):  # local sign-in: its own seat, from srp_cleanup
        return local.professional_seat(claims, pro_id)
    return _read_with(claims, seat.professional_seat, pro_id)


@router.get(
    "/seat/professional/{pro_id}/home",
    response_model=HomeResponse,
    responses={403: {"description": "not_your_seat"}, 501: {"description": "not_implemented (only a local sign-in session is served)"}},
)
def professional_home(pro_id: str, claims: dict = Depends(current_srp_user)) -> dict:
    """The Home page's real data for the signed-in user's OWN seat, from the local schema (srp/home-page-data)."""
    if not local.is_local_session(claims):  # a Supabase session's Home is unchanged: it has no read here
        raise not_implemented("the Home read for a Supabase session")
    try:
        return home.home(claims, pro_id)
    except psycopg.Error as exc:  # the database's own message can carry a host or a query: log the kind, answer plainly
        log.warning("home read failed: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable") from exc


@router.get(
    "/seat/professional/{pro_id}/srs",
    response_model=SrsResponse,
    responses={403: {"description": "not_your_seat"}, 501: {"description": "not_implemented (only a local sign-in session is served)"}},
)
def professional_srs(pro_id: str, claims: dict = Depends(current_srp_user)) -> dict:
    """The SRS page's real data (SRS v5: 850 points, 10 lanes) for the signed-in user's OWN seat, from the local schema (srp/srs-page-schema)."""
    if not local.is_local_session(claims):  # a Supabase session's SRS page is unchanged: it has no read here
        raise not_implemented("the SRS read for a Supabase session")
    try:
        return srs.srs(claims, pro_id)
    except psycopg.Error as exc:  # the database's own message can carry a host or a query: log the kind, answer plainly
        log.warning("srs read failed: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable") from exc


@router.get(
    "/seat/professional/{pro_id}/profile",
    response_model=ProfileResponse,
    responses={403: {"description": "not_your_seat"}, 501: {"description": "not_implemented (only a local sign-in session is served)"}},
)
def professional_profile(pro_id: str, claims: dict = Depends(current_srp_user)) -> dict:
    """The Profile page's real data (the 18 facts with their sources, the preview, credentials and graph counts) for the signed-in user's OWN seat, read-only (srp/profile-page-schema)."""
    if not local.is_local_session(claims):  # a Supabase session's Profile page is unchanged: it has no read here
        raise not_implemented("the Profile read for a Supabase session")
    try:
        return profile.profile(claims, pro_id)
    except psycopg.Error as exc:  # the database's own message can carry a host or a query: log the kind, answer plainly
        log.warning("profile read failed: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable") from exc


@router.get(
    "/seat/professional/{pro_id}/insights",
    response_model=InsightsResponse,
    responses={403: {"description": "not_your_seat"}, 501: {"description": "not_implemented (only a local sign-in session is served)"}},
)
def professional_insights(pro_id: str, claims: dict = Depends(current_srp_user)) -> dict:
    """The Insights page's real data (visibility figures, map with the top 3 of each spot, AI engines, competitors, locked cards and NORA's notes) for the signed-in user's OWN seat, read-only (srp/insights-page-schema)."""
    if not local.is_local_session(claims):  # a Supabase session's Insights page is unchanged: it has no read here
        raise not_implemented("the Insights read for a Supabase session")
    try:
        return insights.insights(claims, pro_id)
    except psycopg.Error as exc:  # the database's own message can carry a host or a query: log the kind, answer plainly
        log.warning("insights read failed: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable") from exc


@router.get(
    "/seat/professional/{pro_id}/website",
    response_model=WebAnalyticsResponse,
    responses={403: {"description": "not_your_seat"}, 501: {"description": "not_implemented (only a local sign-in session is served)"}},
)
def professional_website(pro_id: str, claims: dict = Depends(current_srp_user)) -> dict:
    """The Web analytics page's real data (the site, the website-lane gauge, the ten audit checks, tiles, top fix with its JSON-LD snippet and NORA's notes) for the signed-in user's OWN seat, read-only (srp/web-analytics-page-schema)."""
    if not local.is_local_session(claims):  # a Supabase session's Web analytics page is unchanged: it has no read here
        raise not_implemented("the Web analytics read for a Supabase session")
    try:
        return web_analytics.web_analytics(claims, pro_id)
    except psycopg.Error as exc:  # the database's own message can carry a host or a query: log the kind, answer plainly
        log.warning("web analytics read failed: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable") from exc


@router.get(
    "/seat/professional/{pro_id}/connections",
    response_model=ConnectionsResponse,
    responses={403: {"description": "not_your_seat"}, 501: {"description": "not_implemented (only a local sign-in session is served)"}},
)
def professional_connections(pro_id: str, claims: dict = Depends(current_srp_user)) -> dict:
    """The Connections page's real data (the eleven accounts with their state, status and what each powers, the summary, NORA's notes and the directories card) for the signed-in user's OWN seat, read-only (srp/connections-page-schema)."""
    if not local.is_local_session(claims):  # a Supabase session's Connections page is unchanged: it has no read here
        raise not_implemented("the Connections read for a Supabase session")
    try:
        return connections.connections(claims, pro_id)
    except psycopg.Error as exc:  # the database's own message can carry a host or a query: log the kind, answer plainly
        log.warning("connections read failed: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable") from exc


@router.get("/seat/listings")
def seat_listings(entity_type: seat.Kind, entity_id: str,
                  claims: dict = Depends(current_srp_user)) -> list:
    """loadListings() for one record (errors ignored → [])."""
    if local.is_local_session(claims):
        return local.listings()
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
