"""Request models for the sales category_group endpoints (moved out of category_group/router.py)."""
from __future__ import annotations

from surfaces.sales.internal import _Body


class SalesCategoryGroupMemberNew(_Body):
    gcid: str
