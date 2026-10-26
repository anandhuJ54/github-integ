"""Base router for the 14-integrations Surface: proves the wiring (public /hello, authed /me)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from _base.auth import current_user

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("/hello")
def hello() -> dict:
    """Public endpoint — no auth/DB. Proves the FE↔BE wiring end to end."""
    return {"surface": "14-integrations", "message": "Hello from FastAPI"}


@router.get("/me")
def whoami(claims: dict = Depends(current_user)) -> dict:
    """Trivial authed endpoint proving the JWT + routing path works."""
    return {"surface": "14-integrations", "sub": claims.get("sub")}
