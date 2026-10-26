"""sales SRE call console (S3) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/sre-console.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
rep / seller id is the page's SRE_REP_ID, sent as before. The inserts are the browser's own
statements: each request model allow-lists the columns the page sends, and only the keys sent
are written; `occurred_at` / `redeemed_at` are the server's clock.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from _base.auth import current_user
from surfaces.sales.internal import _read_with, _write_with
from surfaces.sales.sre import services as q
from surfaces.sales.sre.schemas import (
    SalesSreCallOutcome,
    SalesSrePromoRedemption,
    SalesSreTrialExtension,
)

router = APIRouter(prefix="/sales/sre", tags=["sales"])


@router.get("/reps/{rep_id}")
def load_rep(rep_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadSreRep: {id, name, role}, or null."""
    return _read_with(claims, q.load_rep, rep_id)


@router.get("/promo-code")
def load_promo(seller_id: str = Query(...), claims: dict = Depends(current_user)) -> dict | None:
    """loadPromoCode's row: {code, discount_pct, active, seller_id} of one active code of the
    seller, or null (the page maps it)."""
    return _read_with(claims, q.load_promo, seller_id)


@router.get("/queues")
def load_queues(seller_id: str = Query(...), claims: dict = Depends(current_user)) -> dict:
    """loadQueues: {attempted, engaged, lapsed_no_upgrade}, each at most 250 claim events,
    oldest first."""
    return _read_with(claims, q.load_queues, seller_id)


@router.post("/call-outcomes")
def log_call_outcome(body: SalesSreCallOutcome, claims: dict = Depends(current_user)) -> dict:
    """logCallOutcome: one exp_activity_events row."""
    return _write_with(claims, q.log_call_outcome, body.sent())


@router.post("/promo-redemptions")
def send_promo_code(body: SalesSrePromoRedemption, claims: dict = Depends(current_user)) -> dict:
    """sendPromoCode: one exp_promo_redemptions row."""
    return _write_with(claims, q.send_promo_code, body.sent())


@router.post("/trial-extensions")
def extend_trial(body: SalesSreTrialExtension, claims: dict = Depends(current_user)) -> dict:
    """extendTrial: one exp_trial_extensions row."""
    return _write_with(claims, q.extend_trial, body.sent())
