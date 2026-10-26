"""Request models for the runSkill endpoint (moved from nora_runner/router.py)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Approval(BaseModel):
    model_config = ConfigDict(strict=True)
    approved: bool = False
    consent: bool = False


class RunSkillInput(BaseModel):
    """The zod runInput schema (unknown keys are stripped, values trimmed)."""

    model_config = ConfigDict(strict=True)
    skillKey: str
    entityId: str | None = None
    mode: Literal["dry_run", "live"]
    inputs: dict[str, Any] = Field(default_factory=dict)
    trigger: Literal["manual", "scripted", "autonomous"] = "manual"
    approval: Approval = Field(default_factory=Approval)

    @field_validator("skillKey")
    @classmethod
    def _skill_key(cls, v: str) -> str:
        return _trimmed(v)

    @field_validator("entityId")
    @classmethod
    def _entity_id(cls, v: str | None) -> str | None:
        return None if v is None else _trimmed(v)


def _trimmed(v: str) -> str:
    t = v.strip()
    if len(t) < 1:
        raise ValueError("String must contain at least 1 character(s)")
    if len(t) > 200:
        raise ValueError("String must contain at most 200 character(s)")
    return t
