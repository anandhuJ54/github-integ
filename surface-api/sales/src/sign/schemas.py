"""Request models for the sales sign endpoints (moved out of sign/router.py)."""
from __future__ import annotations

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesSignFetch(_Body):
    token: str = Field(min_length=1, max_length=512)


class SalesSignRecord(_Body):
    """m4_record_signature's arguments, as the page sent them."""
    token: str = Field(min_length=1, max_length=512)
    type: str | None = Field(max_length=100)
    data: str | None = Field(max_length=10_000)
    identity: str | None = Field(max_length=100)
    ip: str | None = Field(max_length=100)
    ua: str | None = Field(max_length=2_000)
