"""Request models for the sales csm endpoints (moved out of csm/router.py)."""
from __future__ import annotations

from surfaces.sales.internal import _Body


class SalesCsmAssign(_Body):
    """assignCsm's CsmUser."""
    user_ref: str
    name: str | None
    email: str | None
