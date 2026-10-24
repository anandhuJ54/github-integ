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

from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from _base.core import db
from _base.core.auth import current_user
from sales.queries import cpq as q

router = APIRouter(prefix="/sales/cpq", tags=["sales"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except q.MultipleRows as exc:  # PostgREST answered `.single()` on 0 or 2+ rows with 406
        raise HTTPException(status.HTTP_406_NOT_ACCEPTABLE, str(exc)) from exc
    except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


def _write_with(claims: dict, fn, *args) -> Any:
    with db.role_connection("authenticated", claims, write=True) as conn:
        out = _guard(fn, conn, *args)
    return {"ok": True} if out is None else out


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


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


class SalesCpqQuoteSave(_Body):
    """saveQuote's payload (always every key; `updated_at` is stamped by the server)."""
    name: str
    state: Any
    summary: Any
    status: str
    account_id: str | None
    opportunity_id: str | None


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

class SalesCpqContractNew(_Body):
    name: str
    account_id: str | None = None
    org_id: str | None = None
    status: str | None = None
    mrr: Decimal | None = None
    net: Decimal | None = None
    terms: Any = None
    approval_state: str | None = None
    approval_note: str | None = None


@router.post("/contracts")
def create_contract(body: SalesCpqContractNew, claims: dict = Depends(current_user)) -> dict:
    """commitEntitlements (new contract): insert … select("id").single(); created_by = the
    caller. Returns {id}."""
    return _write_with(claims, q.create_contract, body.sent(), claims.get("sub"))


class SalesCpqContractPatch(_Body):
    mrr: Decimal | None = None
    net: Decimal | None = None
    account_id: str | None = None
    org_id: str | None = None
    approval_state: str | None = None
    approval_note: str | None = None


@router.patch("/contracts/{contract_id}")
def update_contract(contract_id: str, body: SalesCpqContractPatch,
                    claims: dict = Depends(current_user)) -> dict:
    """commitEntitlements (existing contract): update(patch).eq("id", id)."""
    return _write_with(claims, q.update_contract, contract_id, body.sent())


@router.delete("/contracts/{contract_id}/line-items")
def delete_contract_lines(contract_id: str, claims: dict = Depends(current_user)) -> dict:
    """commitEntitlements (existing contract): delete().eq("contract_id", id)."""
    return _write_with(claims, q.delete_contract_lines, contract_id)


class SalesCpqLineItem(_Body):
    product_key: str | None
    qty: Decimal | None
    unit_price: Decimal | None
    net: Decimal | None
    term: str | None
    discount_pct: Decimal | None
    notes: str | None


class SalesCpqLineItems(_Body):
    rows: list[SalesCpqLineItem] = Field(max_length=1000)


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


class SalesCpqRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


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


class SalesCpqTierPatch(_Body):
    """updateTierFields' schedule fields, and upsertPriceTier's row (with an id)."""
    product_key: str | None = None
    entity_type: str | None = None
    effective_from: str | None = None
    min_qty: int | None = None
    max_qty: int | None = None
    unit_price: Decimal | None = None
    discount_pct: Decimal | None = None
    platform_fee_annual: Decimal | None = None
    addl_user_monthly: Decimal | None = None
    setup_fee: Decimal | None = None
    included_campaigns: int | None = None
    pooled_credits: int | None = None
    overage_rate: Decimal | None = None


@router.patch("/price-tiers/{tier_id}")
def update_tier(tier_id: str, body: SalesCpqTierPatch,
                claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_tier, tier_id, body.sent())


class SalesCpqTierNew(_Body):
    """upsertPriceTier's row (no id)."""
    product_key: str | None = None
    entity_type: str | None = None
    min_qty: int | None = None
    max_qty: int | None = None
    unit_price: Decimal | None = None
    effective_from: str | None = None


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


class SalesCpqPromoNew(_Body):
    code: str | None = None
    applies_to_products: list[str] | None = None
    discount_kind: str | None = None
    amount: Decimal | None = None
    discount_pct: Decimal | None = None
    pricing_type: str | None = None
    duration_months: int | None = None
    starts_at: str | None = None
    expires_at: str | None = None
    scope_type: str | None = None
    applies_to_scope: str | None = None
    seller_id: str | None = None


@router.post("/promos")
def create_promo(body: SalesCpqPromoNew, claims: dict = Depends(current_user)) -> dict:
    """createPromo: insert({...p, active: true})."""
    return _write_with(claims, q.create_promo, body.sent())


class SalesCpqPromoActive(_Body):
    active: bool


@router.patch("/promos/{promo_id}")
def set_promo_active(promo_id: str, body: SalesCpqPromoActive,
                     claims: dict = Depends(current_user)) -> dict:
    """setPromoActive: update({active}).eq("id", id)."""
    return _write_with(claims, q.set_promo_active, promo_id, body.active)


@router.get("/promo-redemptions")
def redemption_codes(claims: dict = Depends(current_user)) -> list:
    """redemptionCounts: every redemption's {code} (counted in the browser)."""
    return _read_with(claims, q.redemption_codes)
