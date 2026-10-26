"""Request/response models of the admin `control_claim` resource (moved out of its router modules)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RpcArgs(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
