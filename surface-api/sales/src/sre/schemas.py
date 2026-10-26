"""Request models for the sales sre endpoints (moved out of sre/router.py)."""
from __future__ import annotations

from typing import Any

from surfaces.sales.internal import _Body


class SalesSreCallOutcome(_Body):
    """logCallOutcome's insert (occurred_at is stamped by the server)."""
    event_type: str
    subject_type: str | None = None
    subject_id: str | None = None
    actor: str | None = None
    source: str | None = None
    value: Any = None


class SalesSrePromoRedemption(_Body):
    """sendPromoCode's insert (redeemed_at is stamped by the server)."""
    code: str | None = None
    subject_id: str | None = None


class SalesSreTrialExtension(_Body):
    """extendTrial's insert. `days` is clamped to 1..7 by the page, as before."""
    subject_id: str | None = None
    days: int | None = None
    granted_by: str | None = None
    reason: str | None = None
