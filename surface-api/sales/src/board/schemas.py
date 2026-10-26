"""Request models for the sales board endpoints (moved out of board/router.py)."""
from __future__ import annotations

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesDeskNewProfiles(_Body):
    territory_ids: list[str] = Field(min_length=1, max_length=1000)
    days: int = Field(ge=0, le=3660)


class SalesBoardNoteNew(_Body):
    """addNote's row."""
    seller_id: str | None = None
    subject_label: str | None = None
    subject_type: str | None = None
    body: str | None = None
    callback_priority: bool | None = None
    callback_at: str | None = None  # Postgres parses the timestamp text, as through PostgREST
    created_by: str | None = None


class SalesBoardReferralNew(_Body):
    """requestReferral's note (subject_type, callback_priority and callback_at set by the
    server)."""
    seller_id: str | None = None
    subject_label: str | None = None
    body: str | None = None
    created_by: str | None = None


class SalesBoardNotePatch(_Body):
    callback_priority: bool
