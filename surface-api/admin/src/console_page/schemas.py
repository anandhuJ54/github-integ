"""Request/response models of the admin `console_page` resource (moved out of its router modules)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Ids = Field(default_factory=list, max_length=1000)


class ProIds(BaseModel):
    ids: list[str] = Ids


class ProExtrasIn(BaseModel):
    orgIds: list[str] = Ids
    gcids: list[str] = Ids


class GrantIn(BaseModel):
    user_id: str = Field(min_length=36, max_length=36)
    role: Literal["super_admin", "architect", "analyst"]
