"""xmp enterprise data — replaces the direct supabase-js calls in surface-ui/xmp (enterprise-xmp,
insurance-team and the enterprise route files).

Surface audit 2026-10-25: the seat, interview, dashboard and office-mode endpoints moved to srp
(srp/routers/seat_data.py, /srp/...); the review campaigns endpoints moved to campaigns
(campaigns/routers/review_campaigns.py, /campaigns/enterprise/...).

Everything runs as the signed-in user (these pages are all under `_authenticated`), so RLS and
the SECURITY INVOKER functions decide as they did for the browser. Reads keep the 1000-row
PostgREST cap. The writes are the pages' own statements, ported as they are: each request model
allow-lists the columns the page sent, and only the keys sent are written.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from _base.core import db
from _base.core.auth import current_user
from _base.core.sql import fetch_all
from xmp.queries import common, enterprise, enterprise_ops, team

router = APIRouter(prefix="/xmp", tags=["xmp"])

def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _write(claims: dict):
    return db.role_connection("authenticated", claims, write=True)


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


def _rows(claims: dict, stmt: Any) -> list:
    return _read_with(claims, fetch_all, stmt)


def _write_with(claims: dict, fn, *args) -> dict:
    with _write(claims) as conn:
        _guard(fn, conn, *args)
    return {"ok": True}


def _uid(claims: dict) -> str:
    return str(claims.get("sub") or "")


class _XmpBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


# --- RPCs (lib/enterprise-xmp.ts) ------------------------------------------

class XmpRpcArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: XmpRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed SECURITY INVOKER read (common.XMP_RPCS): rows, or the jsonb value."""
    try:
        common.rpc_sql(name, body.args)  # refuse before leasing a connection
    except common.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _read_with(claims, common.call_rpc, name, body.args)


# --- enterprise (lib/enterprise-xmp.ts) --------------------------------------------------------

@router.get("/enterprise/brands/{slug}")
def brand(slug: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadBrand(): the brand, or null (its error was ignored)."""
    try:
        rows = _rows(claims, enterprise.brand_stmt(slug))
    except HTTPException:
        return None
    return common.single(rows)


@router.get("/enterprise/offices/{office_id}/pros")
def office_pros(office_id: str, limit: int = Query(50, ge=0), claims: dict = Depends(current_user)) -> list:
    """loadOfficePros()."""
    return _rows(claims, enterprise.office_pros_stmt(office_id, limit))


@router.get("/enterprise/brands/{brand_id}/top-offices")
def top_offices(brand_id: str, limit: int = Query(20, ge=0), claims: dict = Depends(current_user)) -> list:
    """loadTopOfficesByScore() (the page adds pro_count / total_count)."""
    return _rows(claims, enterprise.top_offices_stmt(brand_id, limit))


@router.get("/enterprise/brands/{brand_id}/moderation")
def moderation(brand_id: str, limit: int = Query(50, ge=0), claims: dict = Depends(current_user)) -> list:
    """loadModerationQueue()'s reviews (the page adds the flags)."""
    return _read_with(claims, enterprise.moderation_reviews, brand_id, limit)


@router.get("/enterprise/view-as/professional/{pro_id}")
def view_as_professional(pro_id: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, enterprise.view_as_professional, pro_id)


@router.get("/enterprise/view-as/location/{office_id}")
def view_as_location(office_id: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, enterprise.view_as_location, office_id)


# --- enterprise.$orgSlug.users.tsx -------------------------------------------------------------

@router.get("/enterprise/orgs/{org_slug}/users")
def users_page(org_slug: str, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, enterprise.users_page, org_slug, _uid(claims))


class XmpInvitationIn(_XmpBody):
    """One invitation as the page built it; `invited_by` is the signed-in user (the page sent
    its own session user id)."""
    email: str | None = None
    full_name: str | None = None
    role: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    status: str | None = None
    expires_at: str | None = None


class XmpInvitationsIn(_XmpBody):
    records: list[XmpInvitationIn] = Field(min_length=1, max_length=1000)


@router.post("/enterprise/invitations")
def insert_invitations(body: XmpInvitationsIn, claims: dict = Depends(current_user)) -> dict:
    """submitSingleInvite() (one record) / submitBulkInvite(): no insert policy on invitations →
    RLS error, as before."""
    records = [{**r.sent(), "invited_by": _uid(claims) or None} for r in body.records]
    return _write_with(claims, enterprise.insert_invitations, records)


class XmpImpersonateIn(_XmpBody):
    impersonating: str
    org_slug: str


@router.post("/enterprise/professionals/{pro_id}/impersonate")
def impersonate(pro_id: str, body: XmpImpersonateIn, claims: dict = Depends(current_user)) -> dict:
    """impersonate(): the audit_log insert (user_id = the signed-in user); its error is shown."""
    return _write_with(claims, enterprise.impersonate, _uid(claims), pro_id, body.impersonating,
                       body.org_slug)


@router.post("/enterprise/professionals/{pro_id}/deactivate")
def deactivate(pro_id: str, claims: dict = Depends(current_user)) -> dict:
    """deactivate(): the professionals update (no update policy: 0 rows), then the audit_log
    insert whose error the page ignored."""
    return _write_with(claims, enterprise.deactivate, _uid(claims), pro_id)


# --- Team Central (lib/insurance-team.ts) ------------------------------------------------------

@router.get("/team/{group_key}")
def team_base(group_key: str, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, team.team_base, group_key)


class XmpTeamFamilyIn(_XmpBody):
    family_key: str | None = None
    territory_ids: list[str] = Field(default_factory=list, max_length=1000)
    year: int


@router.post("/team/family")
def team_family(body: XmpTeamFamilyIn, claims: dict = Depends(current_user)) -> dict:
    """The family-dependent reads (a read; POST carries the territory ids)."""
    return _read_with(claims, team.team_family, body.family_key, body.territory_ids, body.year)


# --- enterprise operations (surface-ui/_base/src/lib/enterprise-ops.ts) ------------------------

@router.get("/enterprise/ops/ingestion")
def ops_ingestion(org_id: str = Query(max_length=200), claims: dict = Depends(current_user)) -> dict:
    """loadIngestion's reads: {crm, oauth, jobs} raw rows (each [] on error, as the page saw)."""
    return _read_with(claims, enterprise_ops.load_ingestion, org_id)


@router.get("/enterprise/ops/settings")
def ops_settings(org_id: str = Query(max_length=200), claims: dict = Depends(current_user)) -> dict:
    """loadEnterpriseSettings: {settings, users, invites, sso, integrations}."""
    return _read_with(claims, enterprise_ops.load_enterprise_settings, org_id)
