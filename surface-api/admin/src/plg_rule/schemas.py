"""Request/response models of the admin `plg_rule` resource (moved out of its router modules)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Rule(BaseModel):
    id: str
    gcid: str | None
    rule_name: str
    rule_type: str
    trigger_condition: dict[str, Any] | None
    priority: int | None
    headline: str | None
    body: str | None
    cta_text: str | None
    cta_action: str | None
    cta_url: str | None
    requires_upgrade: bool | None
    upgrade_tier: str | None
    icon: str | None
    is_active: bool | None
    created_at: str | None


class EventStat(BaseModel):
    rule_id: str
    fires: int
    dismissals: int
    conversions: int


class RulesPage(BaseModel):
    rules: list[Rule]
    stats: list[EventStat]


class RuleIn(BaseModel):
    """What the editor saves (the page normalizes empty strings to null before sending)."""
    gcid: str | None = None
    rule_name: str = Field(min_length=1, max_length=200)
    rule_type: str = Field(min_length=1, max_length=50)
    trigger_condition: dict[str, Any] = Field(default_factory=dict)
    priority: int = 50
    headline: str | None = None
    body: str | None = None
    cta_text: str | None = None
    cta_action: str | None = None
    cta_url: str | None = None
    requires_upgrade: bool = False
    upgrade_tier: str | None = None
    icon: str | None = None
    is_active: bool = True


class ActiveIn(BaseModel):
    is_active: bool
