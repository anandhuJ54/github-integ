"""Request models for the sales catalog endpoints (moved out of catalog/router.py)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

Text = Field(default=None, max_length=10000)


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


class SalesCatalogProductPatch(_Body):
    """The page's `toRow(patch, key)`: every ProductPatch key, with description / lane left out
    when null (`?? undefined`). product_key is the match key and never part of the patch."""
    name: str | None = Field(default=None, max_length=500)
    description: str | None = Text
    lane: str | None = Field(default=None, max_length=100)
    price_monthly: Decimal | None = None
    price_monthly_location: Decimal | None = None
    price_unit: str | None = Field(default=None, max_length=100)
    billing_type: str | None = Field(default=None, max_length=100)
    creditable: bool | None = None
    discountable: bool | None = None
    passthrough: bool | None = None
    min_charge: Decimal | None = None
    package_includes: list[str] | None = Field(default=None, max_length=1000)
    active: bool | None = None


class SalesCatalogProductNew(SalesCatalogProductPatch):
    """addAdminProduct: `{ product_key, ...toRow(patch, key) }` (the key checked by the page)."""
    product_key: str = Field(min_length=1, max_length=200)


class SalesCatalogVolumeTier(_Body):
    min: int | float
    pct: int | float


class SalesCatalogVolumeTiers(_Body):
    tiers: list[SalesCatalogVolumeTier] = Field(max_length=1000)


class SalesCatalogConfigValue(_Body):
    value: Decimal | None


class SalesCatalogCompRate(_Body):
    rate_pct: Decimal | None  # null reaches the NOT NULL column and is refused there, as before
