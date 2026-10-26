"""Base router for the 13-ops Surface.

Pattern for every Surface capability:
- one router module per capability, mounted by this Surface's `router.py`
- auth via the shared `current_user` dependency (verified Supabase JWT)
- governed DB access via `_base.db` — never a raw table write
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from _base.auth import current_user

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/hello")
def hello() -> dict:
    """Public endpoint — no auth/DB. Proves the FE↔BE wiring end to end."""
    return {"surface": "13-ops", "message": "Hello from FastAPI"}


@router.get("/me")
def whoami(claims: dict = Depends(current_user)) -> dict:
    """Trivial authed endpoint proving the JWT + routing path works."""
    return {"surface": "13-ops", "sub": claims.get("sub")}
