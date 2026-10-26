"""Request/response models of the ops `console` resource (moved out of its router modules)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class WatchTarget(BaseModel):
    doc_id: str | None = None
    space_id: str | None = None


class NewDoc(BaseModel):
    space_id: str
    parent_id: str | None = None
    title: str = Field(min_length=1, max_length=300)


class NewComment(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_id: str | None = None


class Resolved(BaseModel):
    resolved: bool = True
