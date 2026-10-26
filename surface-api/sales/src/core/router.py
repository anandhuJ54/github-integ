"""sales core (S2) — replaces the direct supabase-js calls in surface-ui/sales/src/lib/sales.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
writes are the browser's own statements: each request model allow-lists the columns the page
sends, and only the keys sent are written (as PostgREST did). Money and quantity values are
`Decimal` (never float, never rounded here); integer columns take whole numbers only, as
Postgres did. Multi-step flows (setContractStatus → exp_contract_provision, duplicateContract,
persistQuoteMargins, recomputeAccountTiers) stay orchestrated by the browser, one endpoint per
supabase-js call, in the browser's order; exp_contract_provision is the existing
POST /sales/cpq/rpc/exp_contract_provision.
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query

from _base.auth import current_user
from surfaces.sales.core import services as q
from surfaces.sales.core.schemas import (
    SalesCoreAccountTiers,
    SalesCoreContractNew,
    SalesCoreContractPatch,
    SalesCoreCreditConfig,
    SalesCoreIds,
    SalesCoreLineItemPatch,
    SalesCoreLineItems,
    SalesCorePricePatch,
    SalesCoreRenewalNew,
    SalesCoreRenewalPatch,
    SalesCoreSignatureNew,
)
from surfaces.sales.internal import _read_with, _write_with

router = APIRouter(prefix="/sales/core", tags=["sales"])


# --- reps + territory + activity -------------------------------------------------------------

@router.get("/reps")
def list_reps(claims: dict = Depends(current_user)) -> list:
    """loadReps."""
    return _read_with(claims, q.list_reps)


@router.get("/assignments")
def list_assignments(claims: dict = Depends(current_user)) -> list:
    """loadAssignments."""
    return _read_with(claims, q.list_assignments)


@router.get("/activity")
def list_activity(since: datetime = Query(...), claims: dict = Depends(current_user)) -> list:
    """loadActivity: events at or after `since` (the browser's now − days), newest first, at most
    1000 (the browser's limit(5000) was cut to 1000 by PostgREST)."""
    return _read_with(claims, q.list_activity, since)


# --- account tiers ---------------------------------------------------------------------------

@router.get("/account-tiers")
def list_account_tiers(claims: dict = Depends(current_user)) -> list:
    """loadAccountTiers."""
    return _read_with(claims, q.list_account_tiers)


@router.get("/account-tiers/inputs")
def tier_inputs(claims: dict = Depends(current_user)) -> dict:
    """recomputeAccountTiers' reads: `{ orgs, pros }` (each cut to 1000 rows, follow-up 1j)."""
    return _read_with(claims, q.tier_inputs)


@router.put("/account-tiers")
def upsert_account_tiers(body: SalesCoreAccountTiers, claims: dict = Depends(current_user)) -> dict:
    """recomputeAccountTiers' upsert (onConflict account_id); updated_at = the server's clock."""
    return _write_with(claims, q.upsert_account_tiers, [r.model_dump() for r in body.rows])


@router.post("/organizations/names")
def account_names(body: SalesCoreIds, claims: dict = Depends(current_user)) -> list:
    """loadAccountNames: `[{id, name}]` for the ids (a read; POST so a long id list fits)."""
    return _read_with(claims, q.account_names, body.ids)


# --- price book ------------------------------------------------------------------------------

@router.get("/price-book")
def price_book(claims: dict = Depends(current_user)) -> dict:
    """loadPriceBook's rows: `{ book, products }` (one round trip; the browser joins and sorts)."""
    return _read_with(claims, q.price_book)


@router.patch("/price-book/{price_id}")
def update_price(price_id: str, body: SalesCorePricePatch,
                 claims: dict = Depends(current_user)) -> dict:
    """savePrice: update(patch).eq("id", id)."""
    return _write_with(claims, q.update_price, price_id, body.sent())


@router.patch("/products/{product_key}/credit-config")
def update_credit_config(product_key: str, body: SalesCoreCreditConfig,
                         claims: dict = Depends(current_user)) -> dict:
    """saveCreditConfig: update(patch).eq("product_key", key)."""
    return _write_with(claims, q.update_credit_config, product_key, body.sent())


# --- contracts -------------------------------------------------------------------------------

@router.get("/contracts")
def contract_bundle(claims: dict = Depends(current_user)) -> dict:
    """loadContracts' rows: `{ contracts, lineItems, signatures, renewals }` (the account names
    are the next call, POST /organizations/names, as before)."""
    return _read_with(claims, q.contract_bundle)


@router.post("/contracts")
def create_contract(body: SalesCoreContractNew, claims: dict = Depends(current_user)) -> dict:
    """createContract: insert(…).select("id").single(). Returns {id}."""
    return _write_with(claims, q.create_contract, body.sent())


@router.patch("/contracts/{contract_id}")
def update_contract(contract_id: str, body: SalesCoreContractPatch,
                    claims: dict = Depends(current_user)) -> dict:
    """update(patch).eq("id", id)."""
    return _write_with(claims, q.update_contract, contract_id, body.sent())


@router.post("/line-items")
def insert_line_items(body: SalesCoreLineItems, claims: dict = Depends(current_user)) -> dict:
    """addLineItem / duplicateContract: one insert of the rows, only the keys sent."""
    return _write_with(claims, q.insert_line_items, [r.sent() for r in body.rows])


@router.patch("/line-items/{line_id}")
def update_line_item(line_id: str, body: SalesCoreLineItemPatch,
                     claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_line_item, line_id, body.sent())


@router.delete("/line-items/{line_id}")
def delete_line_item(line_id: str, claims: dict = Depends(current_user)) -> dict:
    """removeLineItem."""
    return _write_with(claims, q.delete_line_item, line_id)


# --- signatures + renewals -------------------------------------------------------------------

@router.post("/signatures")
def insert_signature(body: SalesCoreSignatureNew, claims: dict = Depends(current_user)) -> dict:
    """sendSignature."""
    return _write_with(claims, q.insert_signature, body.sent())


@router.post("/signatures/{signature_id}/signed")
def mark_signed(signature_id: str, claims: dict = Depends(current_user)) -> dict:
    """markSigned: status "signed", signed_at = the server's clock."""
    return _write_with(claims, q.mark_signed, signature_id)


@router.post("/renewals")
def insert_renewal(body: SalesCoreRenewalNew, claims: dict = Depends(current_user)) -> dict:
    """upsertRenewal (a plain insert, as before)."""
    return _write_with(claims, q.insert_renewal, body.sent())


@router.patch("/renewals/{renewal_id}")
def update_renewal(renewal_id: str, body: SalesCoreRenewalPatch,
                   claims: dict = Depends(current_user)) -> dict:
    """setRenewalState."""
    return _write_with(claims, q.update_renewal, renewal_id, body.sent())


# --- revenue rollup --------------------------------------------------------------------------

@router.get("/revenue")
def revenue(today: date = Query(...), in90: date = Query(...),
            claims: dict = Depends(current_user)) -> dict:
    """loadRevenue's rows: `{ active: [{mrr}], expiring, pendingSignatures }` (counts null when
    the count failed; the browser sums and defaults them, as before). `today` / `in90` are the
    browser's dates, as before."""
    return _read_with(claims, q.revenue, today, in90)
