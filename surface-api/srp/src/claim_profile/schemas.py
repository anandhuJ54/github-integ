"""Pydantic models for the claim_profile resource."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ClaimProfile(BaseModel):
    prof: dict[str, Any]
    licenseLabel: str
