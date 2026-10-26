"""Request models for the search public profile resource (moved from `public_profile/router.py`)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class PageViewIn(BaseModel):
    gcid: str = Field(min_length=1, max_length=200)
    zip: str = Field(min_length=1, max_length=20)
    claimCta: bool = False
