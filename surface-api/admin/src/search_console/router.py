"""Search control plane data — replaces the direct supabase-js reads/writes and RPCs in
surface-ui/admin/src/lib/search-console.ts. Runs as the signed-in user, so access is unchanged
(see admin/src/search_console/services.py and docs/SECURITY_FINDINGS.md SF-1..SF-3).

Moved from the search Surface (its console router), surface audit 2026-10-25; the VOCE boost
write (was PATCH /search/voce/articles/{id}) moved with it. The UI URLs are unchanged."""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.admin.search_console import services as q
from surfaces.admin.search_console import voce_boost
from surfaces.admin.search_console.schemas import (
    Active,
    Assign,
    Batch,
    ConfigValue,
    LockRate,
    NewAd,
    NewSlot,
    VoceBoostPatch,
)

router = APIRouter(prefix="/admin/search-console", tags=["admin"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _write(claims: dict):
    return db.role_connection("authenticated", claims, write=True)


def _guard(fn, *args):
    try:
        return fn(*args)
    except q.Refused as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except psycopg.Error as exc:  # the page shows the database's message, as before
        msg = (exc.diag.message_primary if exc.diag else None) or "Request failed"
        raise HTTPException(status.HTTP_400_BAD_REQUEST, msg) from exc


# --- reads -----------------------------------------------------------------------------------

@router.get("/category-labels")
def category_labels(claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(q.category_labels, conn)


@router.get("/launched-categories")
def launched_categories(claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(q.launched_categories, conn)


@router.get("/overview")
def overview(claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(q.overview_rollup, conn)


@router.get("/indexing")
def indexing(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(q.indexing, conn)


@router.get("/sponsored")
def sponsored(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(q.sponsored, conn)


@router.get("/ads")
def ads(claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(q.ads, conn)


# --- writes ----------------------------------------------------------------------------------


Patch = dict[str, Any]


@router.patch("/index-agents/{agent_id}")
def set_agent_active(agent_id: str, body: Active, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.set_agent_active, conn, agent_id, body.active)
    return {"ok": True}


@router.put("/index-config/{key}")
def set_index_config(key: str, body: ConfigValue, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.set_index_config, conn, key, body.value)
    return {"ok": True}


@router.post("/sitemap/rebuild")
def rebuild_sitemap(claims: dict = Depends(current_user)) -> Any:
    with _write(claims) as conn:
        return _guard(q.rebuild_sitemap, conn)


@router.post("/index/submit-tick")
def submit_tick(body: Batch, claims: dict = Depends(current_user)) -> Any:
    with _write(claims) as conn:
        return _guard(q.submit_tick, conn, body.batch)


@router.post("/index/sync")
def sync_queue(claims: dict = Depends(current_user)) -> Any:
    with _write(claims) as conn:
        return _guard(q.sync_queue, conn)


@router.patch("/sponsored-pricing/{pricing_id}")
def update_pricing(pricing_id: str, patch: Patch, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.update_pricing, conn, pricing_id, patch)
    return {"ok": True}


@router.post("/sponsored-slots/{slot_id}/assign")
def assign_slot(slot_id: str, body: Assign, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.assign_slot, conn, slot_id, body.model_dump())
    return {"ok": True}


@router.post("/sponsored-slots/{slot_id}/lock")
def lock_slot_rate(slot_id: str, body: LockRate, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.lock_slot_rate, conn, slot_id, body.price, body.per1k)
    return {"ok": True}


@router.post("/sponsored-slots/{slot_id}/release")
def release_slot(slot_id: str, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.release_slot, conn, slot_id)
    return {"ok": True}


@router.post("/sponsored-slots")
def create_slot(body: NewSlot, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.create_slot, conn, body.gcid, body.geo_value, body.position)
    return {"ok": True}


@router.post("/ads")
def create_ad(body: NewAd, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.create_ad, conn, body.model_dump())
    return {"ok": True}


@router.patch("/ads/{ad_id}")
def update_ad(ad_id: str, patch: Patch, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.update_ad, conn, ad_id, patch)
    return {"ok": True}


@router.delete("/ads/{ad_id}")
def delete_ad(ad_id: str, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(q.delete_ad, conn, ad_id)
    return {"ok": True}


# --- VOCE boost manager (/search/voce) -------------------------------------------------------

def _voce_db_error(exc: psycopg.Error) -> HTTPException:
    msg = (exc.diag.message_primary if exc.diag else None) or "Request failed"
    refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or "row-level security" in msg
    return HTTPException(status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST, msg)


@router.patch("/voce/articles/{article_id}")
def update_voce_boost(article_id: str, patch: VoceBoostPatch,
                      claims: dict = Depends(current_user)) -> dict[str, bool]:
    """updateBoost(): `update(patch).eq("id", id)` with only the keys sent; RLS decides (a row
    the policy hides is unchanged and not an error, as with PostgREST)."""
    values = patch.model_dump(exclude_unset=True)
    if not values:
        return {"ok": True}
    try:
        with _write(claims) as conn:
            voce_boost.update_boost(conn, article_id, values)
        return {"ok": True}
    except psycopg.Error as exc:
        raise _voce_db_error(exc) from exc
