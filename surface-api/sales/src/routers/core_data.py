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
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from surfaces.sales.queries import core as q
from surfaces.sales.routers.cpq_data import _Body, _read_with, _write_with

from _base.auth import current_user

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


class SalesCoreAccountTier(_Body):
    account_id: str
    agent_count: int
    tier: str
    group_key: str | None


class SalesCoreAccountTiers(_Body):
    # the roots of at most 1000 organizations (the read above is capped)
    rows: list[SalesCoreAccountTier] = Field(max_length=1000)


@router.put("/account-tiers")
def upsert_account_tiers(body: SalesCoreAccountTiers, claims: dict = Depends(current_user)) -> dict:
    """recomputeAccountTiers' upsert (onConflict account_id); updated_at = the server's clock."""
    return _write_with(claims, q.upsert_account_tiers, [r.model_dump() for r in body.rows])


class SalesCoreIds(_Body):
    ids: list[str] = Field(max_length=1000)


@router.post("/organizations/names")
def account_names(body: SalesCoreIds, claims: dict = Depends(current_user)) -> list:
    """loadAccountNames: `[{id, name}]` for the ids (a read; POST so a long id list fits)."""
    return _read_with(claims, q.account_names, body.ids)


# --- price book ------------------------------------------------------------------------------

@router.get("/price-book")
def price_book(claims: dict = Depends(current_user)) -> dict:
    """loadPriceBook's rows: `{ book, products }` (one round trip; the browser joins and sorts)."""
    return _read_with(claims, q.price_book)


class SalesCorePricePatch(_Body):
    """savePrice: the price-book page sends list_price, contract_price and sometimes
    credit_cost_per_unit, so only those are accepted; `id` is the match key, never patched."""
    list_price: Decimal | None = None
    contract_price: Decimal | None = None
    credit_cost_per_unit: Decimal | None = None


@router.patch("/price-book/{price_id}")
def update_price(price_id: str, body: SalesCorePricePatch,
                 claims: dict = Depends(current_user)) -> dict:
    """savePrice: update(patch).eq("id", id)."""
    return _write_with(claims, q.update_price, price_id, body.sent())


class SalesCoreCreditConfig(_Body):
    consumes_llm_credits: bool | None = None
    est_credits_per_professional: Decimal | None = None
    est_credits_per_location: Decimal | None = None


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


class SalesCoreContractNew(_Body):
    """createContract's insert. `created_by` stays a field: duplicateContract passes the copied
    contract's creator, not the signed-in user."""
    name: str
    account_id: str | None = None
    org_id: str | None = None
    status: str | None = None
    start_date: str | None = None  # Postgres parses the date text, as through PostgREST
    end_date: str | None = None
    token_package: int | None = None
    mrr: Decimal | None = None
    created_by: str | None = None


@router.post("/contracts")
def create_contract(body: SalesCoreContractNew, claims: dict = Depends(current_user)) -> dict:
    """createContract: insert(…).select("id").single(). Returns {id}."""
    return _write_with(claims, q.create_contract, body.sent())


class SalesCoreContractPatch(_Body):
    """The columns sales.ts updates on a contract: mrr (syncContractMrr), status
    (setContractStatus), cost / net / margin_pct / approval_state (persistQuoteMargins),
    approval_state / approval_note (requestMarginApproval, setMarginApproval), sold_by
    (setContractSeller)."""
    mrr: Decimal | None = None
    status: str | None = None
    cost: Decimal | None = None
    net: Decimal | None = None
    margin_pct: Decimal | None = None
    approval_state: str | None = None
    approval_note: str | None = None
    sold_by: str | None = None


@router.patch("/contracts/{contract_id}")
def update_contract(contract_id: str, body: SalesCoreContractPatch,
                    claims: dict = Depends(current_user)) -> dict:
    """update(patch).eq("id", id)."""
    return _write_with(claims, q.update_contract, contract_id, body.sent())


class SalesCoreLineItemNew(_Body):
    """addLineItem's row (with discount_pct) / duplicateContract's rows (without)."""
    contract_id: str | None = None
    product_key: str | None = None
    qty: Decimal | None = None
    unit_price: Decimal | None = None
    term: str | None = None
    discount_pct: Decimal | None = None
    notes: str | None = None


class SalesCoreLineItems(_Body):
    rows: list[SalesCoreLineItemNew] = Field(max_length=1000)


@router.post("/line-items")
def insert_line_items(body: SalesCoreLineItems, claims: dict = Depends(current_user)) -> dict:
    """addLineItem / duplicateContract: one insert of the rows, only the keys sent."""
    return _write_with(claims, q.insert_line_items, [r.sent() for r in body.rows])


class SalesCoreLineItemPatch(_Body):
    """setLineDiscount (discount_pct) / persistQuoteMargins (cost, net, margin_pct)."""
    discount_pct: Decimal | None = None
    cost: Decimal | None = None
    net: Decimal | None = None
    margin_pct: Decimal | None = None


@router.patch("/line-items/{line_id}")
def update_line_item(line_id: str, body: SalesCoreLineItemPatch,
                     claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_line_item, line_id, body.sent())


@router.delete("/line-items/{line_id}")
def delete_line_item(line_id: str, claims: dict = Depends(current_user)) -> dict:
    """removeLineItem."""
    return _write_with(claims, q.delete_line_item, line_id)


# --- signatures + renewals -------------------------------------------------------------------

class SalesCoreSignatureNew(_Body):
    contract_id: str | None = None
    signer_name: str | None = None
    signer_email: str | None = None
    status: str | None = None


@router.post("/signatures")
def insert_signature(body: SalesCoreSignatureNew, claims: dict = Depends(current_user)) -> dict:
    """sendSignature."""
    return _write_with(claims, q.insert_signature, body.sent())


@router.post("/signatures/{signature_id}/signed")
def mark_signed(signature_id: str, claims: dict = Depends(current_user)) -> dict:
    """markSigned: status "signed", signed_at = the server's clock."""
    return _write_with(claims, q.mark_signed, signature_id)


class SalesCoreRenewalNew(_Body):
    contract_id: str | None = None
    renewal_date: str | None = None
    reminder_state: str | None = None
    notes: str | None = None


@router.post("/renewals")
def insert_renewal(body: SalesCoreRenewalNew, claims: dict = Depends(current_user)) -> dict:
    """upsertRenewal (a plain insert, as before)."""
    return _write_with(claims, q.insert_renewal, body.sent())


class SalesCoreRenewalPatch(_Body):
    reminder_state: str | None = None


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
