"""Request models for the sales spine endpoints (moved out of spine/router.py)."""
from __future__ import annotations

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesSpineIds(_Body):
    ids: list[str] = Field(min_length=1, max_length=5000)


class SalesSpineEntityIds(_Body):
    ids: list[str] = Field(min_length=1, max_length=20000)
