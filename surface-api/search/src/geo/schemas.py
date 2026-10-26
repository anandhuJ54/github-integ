"""Request models for the search geo resource (moved from `geo/router.py`)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SrpGeoCentroidsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # withCoordinates() sends at most 200 distinct city names
    cities: list[str] = Field(max_length=200)
