"""Request models for the sales cpq endpoints (moved out of cpq/router.py)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesCpqQuoteSave(_Body):
    """saveQuote's payload (always every key; `updated_at` is stamped by the server)."""
    name: str
    state: Any
    summary: Any
    status: str
    account_id: str | None
    opportunity_id: str | None


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


class SalesCpqContractPatch(_Body):
    mrr: Decimal | None = None
    net: Decimal | None = None
    account_id: str | None = None
    org_id: str | None = None
    approval_state: str | None = None
    approval_note: str | None = None


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


class SalesCpqRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


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


class SalesCpqTierNew(_Body):
    """upsertPriceTier's row (no id)."""
    product_key: str | None = None
    entity_type: str | None = None
    min_qty: int | None = None
    max_qty: int | None = None
    unit_price: Decimal | None = None
    effective_from: str | None = None


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


class SalesCpqPromoActive(_Body):
    active: bool
