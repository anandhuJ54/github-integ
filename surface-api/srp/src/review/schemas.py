"""Pydantic input models for the review resource's server functions."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

_UUID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True)


class DraftInput(_Strict):
    reviewId: str = Field(pattern=_UUID)
    professionalId: str = Field(pattern=_UUID)


class CheckInput(_Strict):
    text: str
    gcid: str | None


class SaveInput(_Strict):
    reviewId: str = Field(pattern=_UUID)
    replyBody: str = Field(min_length=1, max_length=4000)


class FlagInput(_Strict):
    reviewId: str = Field(pattern=_UUID)
    reason: str = Field(min_length=1, max_length=500)
