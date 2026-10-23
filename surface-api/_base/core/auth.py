"""Supabase JWT verification — the auth boundary for FastAPI.

This is the single most important governed-decision point moved out of TypeScript.
FastAPI verifies the Supabase-issued JWT, and downstream code derives the RLS context
from the returned claims (see db.rls_connection). Authorization is decided here and in
the DB (RLS / SECURITY DEFINER functions), never in the browser.

Signing: Supabase projects sign access tokens with an asymmetric key (ES256, or RS256),
whose public half is published at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. Tokens
signed with the legacy shared secret (HS256) are still accepted while SUPABASE_JWT_SECRET
is set, so a project can rotate from one to the other without downtime. The algorithm is
taken from the token header but each algorithm is only ever paired with its own key type
(JWKS public key for ES256/RS256, the shared secret for HS256), so a token cannot pick
a weaker verification path.
"""
from __future__ import annotations

import os
from functools import lru_cache

import jwt  # PyJWT
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=True)

_ASYMMETRIC = frozenset({"ES256", "RS256"})


def _secret() -> str | None:
    # Read lazily so the app imports/runs without the secret until an authed route is hit.
    # Referenced by name from Secret Manager / Vault in real envs. Unset = HS256 disabled.
    return os.environ.get("SUPABASE_JWT_SECRET") or None


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    """Public signing keys of the Supabase project, cached; refetched on an unknown `kid`."""
    base = os.environ["SUPABASE_URL"].rstrip("/")
    return jwt.PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=600)


def decode_token(token: str) -> dict:
    """Verify a Supabase access token and return its claims. Raises jwt.PyJWTError."""
    alg = jwt.get_unverified_header(token).get("alg")
    if alg in _ASYMMETRIC:
        key = _jwks_client().get_signing_key_from_jwt(token).key
    elif alg == "HS256":
        key = _secret()
        if key is None:
            raise jwt.InvalidAlgorithmError("HS256 tokens are not accepted (no shared secret)")
    else:
        raise jwt.InvalidAlgorithmError(f"unsupported token algorithm {alg!r}")
    return jwt.decode(token, key, algorithms=[alg], audience="authenticated")


def verify_jwt(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    """Verify a Supabase JWT and return its claims. Raises 401 on any failure."""
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWKClientConnectionError as exc:  # JWKS endpoint unreachable: not the user's fault
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="auth keys unavailable",
        ) from exc
    except jwt.PyJWTError as exc:  # expired, bad signature, wrong audience, unknown kid, ...
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired token",
        ) from exc


# Dependency alias for routers: `claims: dict = Depends(current_user)`
current_user = verify_jwt
