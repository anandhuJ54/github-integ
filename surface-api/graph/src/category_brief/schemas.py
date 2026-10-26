"""Pydantic input model for the category_brief resource."""
from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints


class _In(BaseModel):
    model_config = ConfigDict(strict=True)
    gcid: Annotated[str, StringConstraints(min_length=1)]
