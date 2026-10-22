"""Supabase JWT verification — the auth boundary for FastAPI.

This is the single most important governed-decision point moved out of TypeScript.
FastAPI verifies the Supabase-issued JWT, and downstream code derives the RLS context
from the returned claims (see db.rls_connection). Authorization is decided here and in
the DB (RLS / SECURITY DEFINER functions), never in the browser.
"""
from __future__ import annotations

import os

import jwt  # PyJWT
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=True)


def _secret() -> str:
    # Read lazily so the app imports/runs without the secret until an authed route is hit.
    # Referenced by name from Secret Manager / Vault in real envs.
    return os.environ["SUPABASE_JWT_SECRET"]


def verify_jwt(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    """Verify a Supabase JWT and return its claims. Raises 401 on any failure."""
    try:
        claims = jwt.decode(
            creds.credentials,
            _secret(),
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:  # expired, bad signature, wrong audience, ...
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired token",
        ) from exc
    return claims


# Dependency alias for routers: `claims: dict = Depends(current_user)`
current_user = verify_jwt
