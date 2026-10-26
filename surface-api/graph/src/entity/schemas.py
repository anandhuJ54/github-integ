"""Pydantic request models for the entity resource."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RpcArgs(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
