"""Request models for the registry and sandbox endpoints (moved from registry/router.py).

Each model allow-lists its table's columns; only the keys sent are written."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class _NoraBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


class NoraSkill(_NoraBody):
    """An exp_skill_registry row as the page saves it (its `id`, `created_at` and `updated_at`
    are not written)."""
    key: str
    title: str | None = None
    summary: str | None = None
    value_loop: str | None = None
    owning_surface: str | None = None
    gap_closed: str | None = None
    triggers: list[str] | None = None
    reads_state: list[str] | None = None
    tools_used: list[str] | None = None
    autonomy: str | None = None
    model_tier: str | None = None
    explanation_template: str | None = None
    guardrails: list[str] | None = None
    status: str | None = None
    version: str | None = None
    is_active: bool | None = None
    entity_types: list[str] | None = None
    graph_writes: list[str] | None = None
    affects_lanes: list[str] | None = None
    expected_srs_lift: int | None = None
    requires_entitlement: str | None = None
    value_prop: str | None = None
    offer_expected_points: int | None = None
    offer_ranking_effect: str | None = None
    price_ref: str | None = None
    trial_eligible: bool | None = None
    decline_mute_days: int | None = None
    permanently_dismissible: bool | None = None
    requires_user_approval: bool | None = None
    charges_money: bool | None = None
    captures_consent: bool | None = None
    is_async: bool | None = None
    estimated_duration: str | None = None
    produces_report: bool | None = None
    tracks_results: bool | None = None
    result_metrics: list[str] | None = None
    report_to_weekly_digest: bool | None = None
    success_event: str | None = None


class NoraSkillRelease(_NoraBody):
    """publishSkill / yankSkill (the page checks the publish gate first). `id` updates that
    row, none inserts; `skill` already carries the new status."""
    id: str | None = None
    skill: NoraSkill
    release: Literal["published", "yanked"]
    note: str | None = None


class NoraCapability(_NoraBody):
    key: str
    title: str | None = None
    owning_surface: str | None = None
    description: str | None = None
    inputs: Any = None
    outputs: Any = None
    reads_state: list[str] | None = None
    entitlement_required: str | None = None
    side_effects: list[str] | None = None
    idempotent_key: str | None = None
    dry_run: bool | None = None
    events_emitted: list[str] | None = None
    transport: str | None = None
    status: str | None = None
    version: str | None = None


class NoraBuildStepPatch(_NoraBody):
    track: str | None = None
    step_no: int | None = None
    title: str | None = None
    description: str | None = None
    state: str | None = None
    emits_event: str | None = None
    consumes_event: str | None = None
    notes: str | None = None
    sort_order: int | None = None


class NoraBuildStepNew(NoraBuildStepPatch):
    track: str
    title: str


class NoraEval(_NoraBody):
    skill_key: str
    name: str
    fixture: Any = None
    expected: Any = None
    status: str | None = None
    last_run_at: str | None = None
    last_result: Any = None


class NoraEvalResult(_NoraBody):
    status: Literal["pass", "fail", "untested"]


class NoraWeight(_NoraBody):
    weight: float


class NoraFeedback(_NoraBody):
    id: str | None = None
    entity_id: str
    entity_type: str | None = None
    opportunity_key: str
    signal: str
    weight: float | None = None
    snooze_until: str | None = None
    created_at: str | None = None
