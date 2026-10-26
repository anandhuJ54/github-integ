"""Request models for the claim endpoints (moved from claim/router.py)."""
from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, field_validator

# zod's .uuid() pattern (any version / variant, case-insensitive).
_UUID = re.compile(
    r"^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$"
)


def _uuid(v: str) -> str:
    if not _UUID.match(v):
        raise ValueError("Invalid uuid")
    return v


def _max(v: str | None, n: int) -> str | None:
    if v is None:
        return None
    t = v.strip()
    if len(t) > n:
        raise ValueError(f"String must contain at most {n} character(s)")
    return t


class SubmitInput(BaseModel):
    model_config = ConfigDict(strict=True)
    professionalId: str
    licenseNumber: str | None = None

    @field_validator("professionalId")
    @classmethod
    def check_professional_id(cls, v: str) -> str:
        return _uuid(v)

    @field_validator("licenseNumber")
    @classmethod
    def check_license(cls, v: str | None) -> str | None:
        return _max(v, 64)


class VerifyInput(BaseModel):
    model_config = ConfigDict(strict=True)
    professionalId: str
    code: str

    @field_validator("professionalId")
    @classmethod
    def check_professional_id(cls, v: str) -> str:
        return _uuid(v)

    @field_validator("code")
    @classmethod
    def check_code(cls, v: str) -> str:
        t = v.strip()
        if not re.fullmatch(r"\d{6}", t, flags=re.ASCII):
            raise ValueError("Enter the 6-digit code")
        return t


class ReleaseInput(BaseModel):
    model_config = ConfigDict(strict=True)
    professionalId: str
    reason: str | None = None

    @field_validator("professionalId")
    @classmethod
    def check_professional_id(cls, v: str) -> str:
        return _uuid(v)

    @field_validator("reason")
    @classmethod
    def check_reason(cls, v: str | None) -> str | None:
        return _max(v, 500)
