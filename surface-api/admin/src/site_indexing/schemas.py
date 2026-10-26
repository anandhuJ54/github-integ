"""Request/response models of the admin `site_indexing` resource (moved out of its router modules)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SetInput(BaseModel):
    model_config = ConfigDict(strict=True)
    enabled: bool
