"""Input models for getSearchPresentation (moved from `search_presentation/router.py`)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True)


class SearchDocIn(_Strict):
    id: str
    entity_type: Literal["professional", "location", "brand"]
    entity_id: str
    slug: str | None
    gcid: str | None
    name: str
    title: str | None
    city: str | None
    state: str | None
    zip: str | None
    lat: float | None
    lng: float | None
    rating: float | None
    review_count: float | None
    claimed: bool | None
    rank_score: float | None
    completeness_pct: float | None
    photo_url: str | None


class PresentationInput(_Strict):
    gcid: str | None = Field(max_length=160)
    results: list[SearchDocIn] = Field(max_length=20)
