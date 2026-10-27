"""Pydantic models for the auth resource (local sign-in, srp/local-login-srp-home)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    # bcrypt reads at most 72 bytes; longer input is refused by the service, not hashed truncated.
    password: str = Field(min_length=1, max_length=128)


class SessionUser(BaseModel):
    id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None


class Landing(BaseModel):
    path: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_at: str
    user: SessionUser
    landing: Landing


class MeResponse(BaseModel):
    user: SessionUser
    landing: Landing
