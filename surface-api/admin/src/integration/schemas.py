"""Request/response models of the admin `integration` resource (moved out of its router modules)."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

from _base.integrations.catalog import SECRET_REF_PATTERN


def _secret_name(v: str) -> str:
    if not SECRET_REF_PATTERN.match(v):
        raise ValueError("Secret names must be UPPER_SNAKE_CASE")
    return v


SecretName = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=128), AfterValidator(_secret_name)
]


SettingValue = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


IntegrationKey = Literal["google_business_profile", "google_places", "apify"]


class _UpdateIn(BaseModel):
    model_config = ConfigDict(strict=True)
    key: IntegrationKey
    refs: dict[str, SecretName] | None = None
    settings: dict[str, SettingValue] | None = None
    mode: Literal["stub", "live"] | None = None


class _ConnectIn(BaseModel):
    origin: str
