"""Enterprise review campaigns data (/enterprise/$orgSlug/campaigns) — replaces the direct
supabase-js calls in routes/_authenticated/enterprise.$orgSlug.campaigns.tsx.

Moved from xmp, surface audit 2026-10-25: /xmp/enterprise/orgs/{slug}/campaigns and
/xmp/enterprise/campaigns[/{id}] → /campaigns/enterprise/... (same SQL, role and responses; open
decision O11 still applies, no features added). Everything runs as the signed-in user, so RLS
decides as it did for the browser. Each write model allow-lists the columns the page sent, and
only the keys sent are written.
"""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.campaigns.review_campaign import services as q
from surfaces.campaigns.review_campaign.schemas import (
    CampaignIn,
    CampaignStatusIn,
)

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except psycopg.Error as exc:  # the database's message reaches the page
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


def _write_with(claims: dict, fn, *args) -> dict:
    with db.role_connection("authenticated", claims, write=True) as conn:
        _guard(fn, conn, *args)
    return {"ok": True}


@router.get("/enterprise/orgs/{org_slug}/campaigns")
def campaigns_page(org_slug: str, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, q.campaigns_page, org_slug)


@router.patch("/enterprise/campaigns/{campaign_id}")
def update_campaign_status(campaign_id: str, body: CampaignStatusIn,
                           claims: dict = Depends(current_user)) -> dict:
    """updateStatus(): no update policy on review_campaigns, so 0 rows (no error), as before."""
    return _write_with(claims, q.update_campaign_status, campaign_id, body.status)


@router.post("/enterprise/campaigns")
def insert_campaign(body: CampaignIn, claims: dict = Depends(current_user)) -> dict:
    """duplicate() / launch(): no insert policy on review_campaigns → RLS error, as before."""
    return _write_with(claims, q.insert_campaign, body.sent())
