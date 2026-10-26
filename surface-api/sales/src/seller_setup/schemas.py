"""Request models for the sales seller_setup endpoints (moved out of seller_setup/router.py)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesSellerSetupRep(_Body):
    """saveSellerSetup's repPayload (the browser sends every key)."""
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    title: str | None = None
    photo_url: str | None = None
    hire_date: date | None = None
    on_duty: bool | None = None
    backup_rep_id: str | None = None
    role: str | None = None
    group_key: str | None = None
    team_name: str | None = None
    attribution_target: Decimal | None = None
    sdrcloud_url: str | None = None


class SalesSellerSetupVerticalsNew(_Body):
    group_keys: list[str] = Field(default_factory=list)


class SalesSellerSetupQuotaPatch(_Body):
    target: Decimal | None = None
    actual: Decimal | None = None


class SalesSellerSetupQuotaNew(_Body):
    """A quarter quota (period_type "quarter" is set by the server)."""
    rep_id: str
    group_key: str
    period_start: date
    target: Decimal | None = None
    actual: Decimal | None = None
