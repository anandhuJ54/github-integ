"""Pydantic models for the seat resource."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SrpRpcArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    args: dict[str, Any] = Field(default_factory=dict)
