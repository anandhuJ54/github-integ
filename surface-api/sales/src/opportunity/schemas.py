"""Request models for the sales opportunity endpoints (moved out of opportunity/router.py)."""
from __future__ import annotations

from typing import Any

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesOppRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


class SalesOppContactNew(_Body):
    """addContact's exp_contacts row (source_origin "manual" is set by the server)."""
    account_id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    job_title: str | None = None


class SalesOppTaskDone(_Body):
    done: bool | None = None


class SalesOppContactLinkNew(_Body):
    """addContact, step 2: the exp_opportunity_contacts row (opportunity_id from the path,
    source_origin "manual" set by the server)."""
    contact_id: str | None = None
    role: str | None = None
    is_champion: bool | None = None
    is_primary: bool | None = None
    relationship_strength: int | None = None
    last_touch_at: str | None = None  # Postgres parses the timestamp text, as through PostgREST
    champion_detail: Any = None


class SalesOppContactLinkPatch(_Body):
    """updateOpportunityContact's columns."""
    is_champion: bool | None = None
    relationship_strength: int | None = None
    last_touch_at: str | None = None
    champion_detail: Any = None


class SalesOppNoteNew(_Body):
    """addOppNote's row (subject_type / subject_id set by the server). seller_id and created_by
    stay fields: the caller sends the opportunity owner's rep id, not the signed-in user."""
    subject_label: str | None = None
    seller_id: str | None = None
    created_by: str | None = None
    body: str | None = None
    pinned: bool | None = None
    mentions: list[str] | None = None


class SalesOppNotePatch(_Body):
    body: str | None = None
    pinned: bool | None = None
    mentions: list[str] | None = None


class SalesOppTaskNew(_Body):
    """addOppTask's row (done false set by the server). owner_id stays a field: the callers send
    the opportunity owner's rep id."""
    account_id: str | None = None
    owner_id: str | None = None
    title: str | None = None
    task_type: str | None = None
    due_at: str | None = None
    priority: str | None = None


class SalesOppActivityNew(_Body):
    """recordOpportunityActivity's row (subject, source "manual" and occurred_at set by the
    server). actor stays a field: the caller sends the opportunity owner's name (or null)."""
    event_type: str | None = None
    account_id: str | None = None
    actor: str | None = None
    value: Any = None


class SalesOppAuditNew(_Body):
    """auditOpportunityWrite's row (entity_type "opportunity", entity_id from the path)."""
    action: str
    field_changes: Any = None


class SalesOppDemoNew(_Body):
    """bookOpportunityDemo's row (is_demo false set by the server). seller_id stays a field."""
    seller_id: str | None = None
    booked_at: str | None = None
    objective: str | None = None
    agenda: str | None = None
    attendees: list[str] | None = None


class SalesOppDemoDone(_Body):
    """completeOpportunityDemo's columns (attended true set by the server)."""
    outcome: str | None = None
    follow_up: str | None = None
    disposition: str | None = None
    recording_url: str | None = None


class SalesOppFileNew(_Body):
    """recordOppFile's row (no storage upload). uploaded_by stays a field (no caller today)."""
    filename: str | None = None
    kind: str | None = None
    size_bytes: int | None = None
    uploaded_by: str | None = None
