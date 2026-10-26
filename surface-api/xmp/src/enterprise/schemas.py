"""Pydantic request models for the enterprise resource."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class _XmpBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


class XmpRpcArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    args: dict[str, Any] = Field(default_factory=dict)


class XmpInvitationIn(_XmpBody):
    """One invitation as the page built it; `invited_by` is the signed-in user (the page sent
    its own session user id)."""
    email: str | None = None
    full_name: str | None = None
    role: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    status: str | None = None
    expires_at: str | None = None


class XmpInvitationsIn(_XmpBody):
    records: list[XmpInvitationIn] = Field(min_length=1, max_length=1000)


class XmpImpersonateIn(_XmpBody):
    impersonating: str
    org_slug: str
