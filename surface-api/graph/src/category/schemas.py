"""Pydantic request models for the category resource."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


class CategoryChildrenIn(BaseModel):
    gcids: list[str] = Field(default_factory=list, max_length=1000)
    view: Literal["tree", "detail"]


class CategoryPatch(_Body):
    gcid: str = Field(min_length=1, max_length=200)
    status: str | None = None
    supports_single_pro_office: bool | None = None


class CategoryRuleIn(_Body):
    gcid: str | None = None
    rule_name: str | None = None
    rule_type: str | None = None
    rule_value: str | None = None
    applies_to: list[str] | None = None
    severity: str | None = None
    is_active: bool | None = None


class CategoryRuleActiveIn(_Body):
    is_active: bool


class CategoryAiAgentsIn(_Body):
    gcid: str = Field(min_length=1, max_length=200)
    ai_agents: dict[str, Any]


class CategoryNodeIn(_Body):
    node_name: str | None = None
    node_slug: str | None = None
    node_description: str | None = None
    ring: str | None = None
    connection_method: str | None = None
    schema_type: str | None = None
    schema_property: str | None = None
    required_for_score: bool | None = None
    score_points: int | None = None
    priority: int | None = None
    url_pattern: str | None = None
    url_example: str | None = None
    compliance_notes: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class CategoryNewNodeIn(CategoryNodeIn):
    gcid: str | None = None


class CategoryPriority(_Body):
    id: str
    priority: int | None = None


class CategoryReorderIn(_Body):
    updates: list[CategoryPriority] = Field(max_length=1000)


class CategoryTaxReorderIn(CategoryReorderIn):
    gcid: str = Field(min_length=1, max_length=200)


class CategoryTermIn(_Body):
    gcid: str | None = None
    level: str | None = None
    term: str | None = None
    term_slug: str | None = None
    term_display: str | None = None
    priority: int | None = None
    search_intent: str | None = None
    search_volume_monthly: int | None = None
    wikidata_id: str | None = None
    source: str | None = None
    validated: bool | None = None
