"""Request/response models of the admin `search_console` resource (moved out of its router modules)."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Active(BaseModel):
    active: bool


class ConfigValue(BaseModel):
    value: str = Field(max_length=5000)


class Batch(BaseModel):
    batch: int = Field(ge=1, le=1000)


class Assign(BaseModel):
    advertiser_name: str = Field(min_length=1, max_length=300)
    price: float | None = None
    status: str = Field(max_length=40)
    lock: bool = False
    pricing_mode: str | None = None
    per_1k: float | None = None


class LockRate(BaseModel):
    price: float | None = None
    per1k: float | None = None


class NewSlot(BaseModel):
    gcid: str = Field(min_length=1, max_length=200)
    geo_value: str = Field(min_length=1, max_length=20)
    position: int = Field(ge=1, le=10)


class NewAd(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    placement: str
    context: str
    target_gcid: str | None = None
    target_geo: str | None = None
    budget: float | None = None
    starts_on: str | None = None
    ends_on: str | None = None


Placement = Literal["profile", "category_hub", "topic_hub", "search", "syndication"]


class VoceBoostPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    boosted: bool | None = None
    boost_placements: list[Placement] | None = Field(default=None, max_length=5)
    boost_starts_on: date | None = None
    boost_ends_on: date | None = None
    boost_spend: float | None = None
