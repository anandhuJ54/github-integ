"""Public profile + monetization endpoints for the SRP pages (/p, /o, /c, /find, /topic).

Replaces the pages' direct supabase-js reads and RPCs. Each call runs as the visitor: `anon` when
signed out, the signed-in user otherwise, exactly as the browser's Supabase client did.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from _base.core import db
from _base.core.server_fn import optional_user
from search.queries import monetization, profile

log = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])


def _visitor(claims: dict | None, *, write: bool = False):
    if claims is None:
        return db.role_connection("anon", write=write)
    return db.role_connection("authenticated", claims, write=write)


@router.get("/profile/p/{slug}")
def professional_profile(slug: str, claims: dict | None = Depends(optional_user)) -> dict[str, Any]:
    with _visitor(claims) as conn:
        raw = profile.professional_raw(conn, slug)
    if raw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    return raw


@router.get("/profile/{kind}/{slug}")
def org_profile(kind: Literal["o", "c"], slug: str,
                claims: dict | None = Depends(optional_user)) -> dict[str, Any]:
    with _visitor(claims) as conn:
        raw = profile.org_raw(conn, kind, slug)
    if raw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    return raw


@router.get("/category-label/{gcid}")
def category_label(gcid: str, claims: dict | None = Depends(optional_user)) -> dict | None:
    with _visitor(claims) as conn:
        return profile.category_label_row(conn, gcid)


def _rpc_rows(claims: dict | None, fn, *args) -> list[dict[str, Any]]:
    """`(data ?? [])`: a failed RPC is no rows, as the page treated it."""
    try:
        with _visitor(claims) as conn:
            return fn(conn, *args)
    except psycopg.Error as exc:
        log.warning("%s failed: %s", fn.__name__, type(exc).__name__)
        return []


@router.get("/sponsored-slots")
def sponsored_slots(gcid: str = Query(max_length=200), geo: str = Query(max_length=20),
                    claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    return _rpc_rows(claims, monetization.sponsored_slots, gcid, geo)


@router.get("/ad-units")
def ad_units(context: str = Query(max_length=60), gcid: str = Query("default", max_length=200),
             geo: str = Query("", max_length=20),
             claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    return _rpc_rows(claims, monetization.ad_units, context, gcid, geo)


class PageViewIn(BaseModel):
    gcid: str = Field(min_length=1, max_length=200)
    zip: str = Field(min_length=1, max_length=20)
    claimCta: bool = False


@router.post("/page-view")
def page_view(body: PageViewIn, claims: dict | None = Depends(optional_user)) -> dict:
    # Fire-and-forget from the page, as before: a failed ping is logged, never shown.
    try:
        with _visitor(claims, write=True) as conn:
            monetization.page_view_ping(conn, body.gcid, body.zip, body.claimCta)
    except psycopg.Error as exc:
        log.warning("page view ping failed: %s", type(exc).__name__)
    return {"ok": True}
