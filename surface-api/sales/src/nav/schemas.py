"""Request models for the sales nav endpoints (moved out of nav/router.py)."""
from __future__ import annotations

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesNavAccountIds(_Body):
    account_ids: list[str] = Field(min_length=1, max_length=1000)
