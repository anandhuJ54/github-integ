"""Request models for the sales contract endpoints (moved out of contract/router.py)."""
from __future__ import annotations

from typing import Any

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesContractsRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


class SalesContractsSpecialTerms(_Body):
    special_terms: str | None
