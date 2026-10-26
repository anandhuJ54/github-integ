"""Request models for the sales core endpoints (moved out of core/router.py)."""
from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesCoreAccountTier(_Body):
    account_id: str
    agent_count: int
    tier: str
    group_key: str | None


class SalesCoreAccountTiers(_Body):
    # the roots of at most 1000 organizations (the read above is capped)
    rows: list[SalesCoreAccountTier] = Field(max_length=1000)


class SalesCoreIds(_Body):
    ids: list[str] = Field(max_length=1000)


class SalesCorePricePatch(_Body):
    """savePrice: the price-book page sends list_price, contract_price and sometimes
    credit_cost_per_unit, so only those are accepted; `id` is the match key, never patched."""
    list_price: Decimal | None = None
    contract_price: Decimal | None = None
    credit_cost_per_unit: Decimal | None = None


class SalesCoreCreditConfig(_Body):
    consumes_llm_credits: bool | None = None
    est_credits_per_professional: Decimal | None = None
    est_credits_per_location: Decimal | None = None


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


class SalesCoreLineItemPatch(_Body):
    """setLineDiscount (discount_pct) / persistQuoteMargins (cost, net, margin_pct)."""
    discount_pct: Decimal | None = None
    cost: Decimal | None = None
    net: Decimal | None = None
    margin_pct: Decimal | None = None


class SalesCoreSignatureNew(_Body):
    contract_id: str | None = None
    signer_name: str | None = None
    signer_email: str | None = None
    status: str | None = None


class SalesCoreRenewalNew(_Body):
    contract_id: str | None = None
    renewal_date: str | None = None
    reminder_state: str | None = None
    notes: str | None = None


class SalesCoreRenewalPatch(_Body):
    reminder_state: str | None = None
