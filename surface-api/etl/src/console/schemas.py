"""Request models for the ETL console data routes (`console/router.py`)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class FieldFloorIn(BaseModel):
    gcid: str = Field(min_length=1, max_length=200)
    required_keys: list[str] = Field(max_length=200)
    min_fields: int = Field(ge=0)
    min_products: int = Field(ge=0)
    min_licenses: int = Field(ge=0)
    notes: str | None = Field(default=None, max_length=2000)


class Ids(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=1000)


class CronSwitch(BaseModel):
    jobname: str = Field(min_length=1, max_length=200)
    active: bool


class ManualCompanies(BaseModel):
    category: str = Field(min_length=1, max_length=200)
    entries: list[str] = Field(max_length=500)


class HierFilters(BaseModel):
    gcid: str | None = None
    source: str | None = None
    brand: str | None = None
    office: str | None = None
    type: str | None = None
    claim: str | None = None
    q: str | None = Field(default=None, max_length=200)


class HierTableIn(BaseModel):
    filters: HierFilters = Field(default_factory=HierFilters)
    page: int = Field(1, ge=1, le=100_000)
    sort: Literal["name", "type", "confidence", "created"] = "created"
    dir: Literal["asc", "desc"] = "desc"


class Gcids(BaseModel):
    gcids: list[str] = Field(default_factory=list, max_length=1000)


class RpcArgs(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)


class SourceId(BaseModel):
    source_id: str


class StageFilters(BaseModel):
    gcid: str | None = None
    source_id: str | None = None
    status: str | None = None


class StagePage(StageFilters):
    page: int = Field(0, ge=0, le=100_000)


class StateSource(BaseModel):
    source_id: str
    source_domain: str


class StatesIn(BaseModel):
    sources: list[StateSource] = Field(max_length=1000)


class Domains(BaseModel):
    domains: list[str] = Field(default_factory=list, max_length=1000)


class RequestIds(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=1000)
