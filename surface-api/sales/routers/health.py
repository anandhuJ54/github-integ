"""Example Sales router.

Pattern for every Surface capability:
- one router module per capability, mounted by `api/app.py`
- auth via the shared `current_user` dependency (verified Supabase JWT)
- governed DB access via `api.base.core` — never a raw table write
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from _base.core.auth import current_user

router = APIRouter(prefix="/sales", tags=["sales"])


@router.get("/hello")
def hello() -> dict:
    """Public endpoint — no auth/DB. Proves the FE↔BE wiring end to end."""
    return {"surface": "01-sales", "message": "Hello from FastAPI"}


@router.get("/me")
def whoami(claims: dict = Depends(current_user)) -> dict:
    """Trivial authed endpoint proving the JWT + routing path works."""
    return {"surface": "01-sales", "sub": claims.get("sub")}
