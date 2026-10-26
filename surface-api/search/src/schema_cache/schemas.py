"""Input models for getCachedSchema / cacheSchema (moved from `schema_cache/router.py`)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class _Key(BaseModel):
    model_config = ConfigDict(strict=True)
    entityType: str
    entityId: str
    pageType: str


class _Put(_Key):
    schemaJson: str
    nodeCount: int | float
