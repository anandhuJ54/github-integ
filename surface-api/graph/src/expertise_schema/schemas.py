"""Pydantic input model for the expertise_schema resource."""
from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints


class _GenIn(BaseModel):
    model_config = ConfigDict(strict=True)
    gcid: Annotated[str, StringConstraints(min_length=1)]
    displayName: Annotated[str, StringConstraints(min_length=1)]
    entityType: Annotated[str, StringConstraints(min_length=1)]
