"""Pydantic request models for the review_campaign resource."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class _CampaignBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


class CampaignStatusIn(_CampaignBody):
    status: str


class CampaignIn(_CampaignBody):
    """The keys duplicate() and launch() send."""
    entity_type: str | None = None
    entity_id: str | None = None
    name: str | None = None
    campaign_type: str | None = None
    status: str | None = None
    subject: str | None = None
    message_body: str | None = None
    target_platform: str | None = None
    sent_count: int | None = None
    opened_count: int | None = None
    clicked_count: int | None = None
    completed_count: int | None = None
    compliance_approved: bool | None = None
    includes_required_disclosures: bool | None = None
