"""Request models for the sales google_workspace endpoints (moved out of its router.py)."""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
)

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


# zod v3 email regex.
_EMAIL_RE = re.compile(
    r"^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$",
    re.IGNORECASE,
)


def _check(pattern: re.Pattern[str], what: str):
    def v(s: str) -> str:
        if not pattern.match(s):
            raise ValueError(f"Invalid {what}")
        return s
    return AfterValidator(v)


Uuid = Annotated[str, _check(_UUID_RE, "uuid")]


Email = Annotated[str, _check(_EMAIL_RE, "email")]


class _EmailIn(BaseModel):
    model_config = ConfigDict(strict=True)
    opportunityId: Uuid
    to: Annotated[list[Email], Field(min_length=1, max_length=20)]
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


class _MeetingIn(BaseModel):
    model_config = ConfigDict(strict=True)
    opportunityId: Uuid
    kind: Literal["demo", "meeting"]
    start: Annotated[str, StringConstraints(min_length=10)]
    durationMinutes: Annotated[int, Field(ge=15, le=480)]
    objective: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1,
                                                max_length=2000)]
    agenda: Annotated[str, StringConstraints(max_length=5000)]
    attendees: Annotated[list[Email], Field(max_length=50)]
    sellerId: Uuid | None
