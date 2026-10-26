"""Request/response models of the admin `me` resource (moved out of its router modules)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AdminMeAuditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(min_length=1, max_length=200)
    acting_role: str | None = Field(default=None, max_length=60)
    target: str | None = Field(default=None, max_length=500)
    details: dict[str, Any] = Field(default_factory=dict)
