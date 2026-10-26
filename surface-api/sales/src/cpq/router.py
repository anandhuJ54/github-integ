"""sales quotes, promo codes and price tiers (S1) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/sales-cpq.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
writes are the browser's own statements: each request model allow-lists the columns the page
sends, and only the keys sent are written (as PostgREST did). Money and quantity values are
`Decimal` (never float, never rounded here); integer columns take whole numbers only, as
Postgres did. The entitlement commit stays orchestrated by the browser, one endpoint per
supabase-js call, in the browser's order; only `saveQuote` (find the quote by name, then update
or insert it) runs its two statements in one request (one transaction).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.sales.cpq import services as q
from surfaces.sales.cpq.schemas import (
    SalesCpqContractNew,
    SalesCpqContractPatch,
    SalesCpqLineItems,
    SalesCpqPromoActive,
    SalesCpqPromoNew,
    SalesCpqQuoteSave,
    SalesCpqRpcArgs,
    SalesCpqTierNew,
    SalesCpqTierPatch,
)
from surfaces.sales.internal import _guard, _read_with, _write_with

router = APIRouter(prefix="/sales/cpq", tags=["sales"])




# --- quotes ----------------------------------------------------------------------------------

@router.get("/quotes")
def list_quotes(claims: dict = Depends(current_user)) -> list:
    """listQuotes."""
    return _read_with(claims, q.list_quotes)


@router.get("/quotes/state")
def quote_state(name: str = Query(...), claims: dict = Depends(current_user)) -> dict | None:
    """loadQuote: {state} of the latest quote with that name, or null."""
    return _read_with(claims, q.quote_state, name)


@router.get("/quotes/by-opportunity/{opportunity_id}")
def opportunity_quote(opportunity_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """prepareOpportunityQuote: {name} of the opportunity's latest quote, or null."""
    return _read_with(claims, q.opportunity_quote, opportunity_id)


@router.put("/quotes")
def save_quote(body: SalesCpqQuoteSave, claims: dict = Depends(current_user)) -> dict:
    """saveQuote: update the quote with that name, else insert it (created_by = the caller).
    Returns {id}."""
    return _write_with(claims, q.save_quote, body.sent(), claims.get("sub"))


# --- accounts --------------------------------------------------------------------------------

@router.get("/accounts")
def list_accounts(claims: dict = Depends(current_user)) -> list:
    """listAccounts."""
    return _read_with(claims, q.list_accounts)


# --- contracts (commitEntitlements) ----------------------------------------------------------

@router.post("/contracts")
def create_contract(body: SalesCpqContractNew, claims: dict = Depends(current_user)) -> dict:
    """commitEntitlements (new contract): insert … select("id").single(); created_by = the
    caller. Returns {id}."""
    return _write_with(claims, q.create_contract, body.sent(), claims.get("sub"))


@router.patch("/contracts/{contract_id}")
def update_contract(contract_id: str, body: SalesCpqContractPatch,
                    claims: dict = Depends(current_user)) -> dict:
    """commitEntitlements (existing contract): update(patch).eq("id", id)."""
    return _write_with(claims, q.update_contract, contract_id, body.sent())


@router.delete("/contracts/{contract_id}/line-items")
def delete_contract_lines(contract_id: str, claims: dict = Depends(current_user)) -> dict:
    """commitEntitlements (existing contract): delete().eq("contract_id", id)."""
    return _write_with(claims, q.delete_contract_lines, contract_id)


@router.post("/contracts/{contract_id}/line-items")
def insert_contract_lines(contract_id: str, body: SalesCpqLineItems,
                          claims: dict = Depends(current_user)) -> dict:
    """commitEntitlements: the annual + one-time lines in one insert."""
    return _write_with(claims, q.insert_contract_lines, contract_id,
                       [r.model_dump() for r in body.rows])


@router.get("/contracts/{contract_id}/approval")
def contract_approval(contract_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadContractApproval: {approval_state, approval_note}, or null."""
    return _read_with(claims, q.contract_approval, contract_id)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: SalesCpqRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed function (q.CPQ_RPCS): exp_contract_provision(p_contract)."""
    try:
        q.rpc_sql(name, body.args)  # refuse before leasing a connection
    except q.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args)


# --- volume tiers ----------------------------------------------------------------------------

@router.get("/price-tiers")
def list_tiers(claims: dict = Depends(current_user)) -> list:
    """listPriceTiers (raw rows; the browser maps them)."""
    return _read_with(claims, q.list_tiers)


@router.patch("/price-tiers/{tier_id}")
def update_tier(tier_id: str, body: SalesCpqTierPatch,
                claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_tier, tier_id, body.sent())


@router.post("/price-tiers")
def create_tier(body: SalesCpqTierNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_tier, body.sent())


@router.delete("/price-tiers/{tier_id}")
def delete_tier(tier_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete_tier, tier_id)


# --- promo codes -----------------------------------------------------------------------------

@router.get("/promos")
def list_promos(claims: dict = Depends(current_user)) -> list:
    """listPromos."""
    return _read_with(claims, q.list_promos)


@router.get("/promos/find")
def find_promo(code: str = Query(...), claims: dict = Depends(current_user)) -> dict | None:
    """findPromo: the active promo matching `code` (ilike), or null. The browser trims the code
    and checks the date window."""
    return _read_with(claims, q.find_promo, code)


@router.post("/promos")
def create_promo(body: SalesCpqPromoNew, claims: dict = Depends(current_user)) -> dict:
    """createPromo: insert({...p, active: true})."""
    return _write_with(claims, q.create_promo, body.sent())


@router.patch("/promos/{promo_id}")
def set_promo_active(promo_id: str, body: SalesCpqPromoActive,
                     claims: dict = Depends(current_user)) -> dict:
    """setPromoActive: update({active}).eq("id", id)."""
    return _write_with(claims, q.set_promo_active, promo_id, body.active)


@router.get("/promo-redemptions")
def redemption_codes(claims: dict = Depends(current_user)) -> list:
    """redemptionCounts: every redemption's {code} (counted in the browser)."""
    return _read_with(claims, q.redemption_codes)
