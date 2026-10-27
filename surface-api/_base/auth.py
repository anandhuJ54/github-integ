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
import time
from functools import lru_cache

import jwt  # PyJWT
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from _base.config import get_settings

_bearer = HTTPBearer(auto_error=True)

_ASYMMETRIC = frozenset({"ES256", "RS256"})

# Local sign-in (srp/local-login-srp-home): tokens the API itself issues for the SRP pages, HS256 with
# LOCAL_AUTH_JWT_SECRET. The `kid` header routes a token to this path; the global `verify_jwt` refuses it,
# so only the SRP dependency below accepts one.
LOCAL_KID = "v3-local"
LOCAL_ISSUER = "v3-local-auth"
# Its own audience, not Supabase's "authenticated": a local token must not be accepted by PostgREST or any
# other verifier that checks the audience.
LOCAL_AUDIENCE = "v3-local-srp"
_LOCAL_MIN_SECRET_BYTES = 32


def _secret() -> str | None:
    # Read lazily so the app imports/runs without the secret until an authed route is hit.
    # Referenced by name from Secret Manager / Vault in real envs. Unset = HS256 disabled.
    return os.environ.get("SUPABASE_JWT_SECRET") or None


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    """Public signing keys of the Supabase project, cached; refetched on an unknown `kid`."""
    base = os.environ["SUPABASE_URL"].rstrip("/")
    return jwt.PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=600)


def _local_secret_problem() -> str | None:
    """Why the local signing secret is not usable, or None. Never includes the secret."""
    secret = os.environ.get("LOCAL_AUTH_JWT_SECRET") or ""
    if len(secret.encode()) < _LOCAL_MIN_SECRET_BYTES:
        return f"LOCAL_AUTH_JWT_SECRET is unset or shorter than {_LOCAL_MIN_SECRET_BYTES} bytes"
    if secret == (os.environ.get("SUPABASE_JWT_SECRET") or None):
        return "LOCAL_AUTH_JWT_SECRET must differ from SUPABASE_JWT_SECRET"
    return None


def _local_secret() -> str | None:
    """The local signing secret when it is usable, else None."""
    return None if _local_secret_problem() else os.environ["LOCAL_AUTH_JWT_SECRET"]


def require_local_auth_ready() -> None:
    """Fail loudly at start-up when local sign-in is on but its signing secret is missing, weak or reused.

    A no-op while LOCAL_AUTH_ENABLED is off. Never echoes the secret.
    """
    if not get_settings().local_auth_enabled:
        return
    problem = _local_secret_problem()
    if problem:
        raise RuntimeError(f"{problem}; refusing to start local sign-in with an unsafe signing key")


def issue_local_token(user_id: int | str, email: str | None, *, hours: int | None = None) -> tuple[str, int]:
    """Sign a local sign-in token for `user_id`. Returns (token, expiry as epoch seconds).

    Raises RuntimeError when local sign-in is off or its key is unusable; never echoes the key.
    """
    settings = get_settings()
    if not settings.local_auth_enabled:
        raise RuntimeError("local sign-in is not enabled")
    secret = _local_secret()
    if secret is None:
        raise RuntimeError(_local_secret_problem())
    now = int(time.time())
    exp = now + 3600 * (hours if hours is not None else settings.local_auth_token_hours)
    claims: dict = {
        "sub": str(user_id),
        "aud": LOCAL_AUDIENCE,
        "iss": LOCAL_ISSUER,
        "iat": now,
        "exp": exp,
    }
    if email:
        claims["email"] = email
    token = jwt.encode(claims, secret, algorithm="HS256", headers={"kid": LOCAL_KID})
    return token, exp


def decode_local_token(token: str) -> dict:
    """Verify a token issued by the local sign-in and return its claims. Raises jwt.PyJWTError.

    HS256 only, with the local secret only: the algorithm is never taken from the token, so it cannot
    steer verification to the Supabase key, a public key or `none`.
    """
    if not get_settings().local_auth_enabled:
        raise jwt.InvalidTokenError("local sign-in is not enabled")
    secret = _local_secret()
    if secret is None:
        raise jwt.InvalidKeyError("local sign-in key is not usable")
    header = jwt.get_unverified_header(token)
    if header.get("alg") != "HS256":
        raise jwt.InvalidAlgorithmError("local tokens are HS256 only")
    return jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience=LOCAL_AUDIENCE,
        issuer=LOCAL_ISSUER,
        options={"require": ["exp", "iat", "sub", "aud", "iss"]},
    )


def decode_token(token: str) -> dict:
    """Verify a Supabase access token and return its claims. Raises jwt.PyJWTError."""
    header = jwt.get_unverified_header(token)
    if header.get("kid") == LOCAL_KID:  # a local token never passes the Supabase path, whatever its key
        raise jwt.InvalidTokenError("local tokens are not accepted here")
    alg = header.get("alg")
    if alg in _ASYMMETRIC:
        key = _jwks_client().get_signing_key_from_jwt(token).key
    elif alg == "HS256":
        key = _secret()
        if key is None:
            raise jwt.InvalidAlgorithmError("HS256 tokens are not accepted (no shared secret)")
    else:
        raise jwt.InvalidAlgorithmError(f"unsupported token algorithm {alg!r}")
    claims = jwt.decode(token, key, algorithms=[alg], audience="authenticated")
    if claims.get("iss") == LOCAL_ISSUER:  # `iss` is how the SRP routes recognise a local session
        raise jwt.InvalidIssuerError("the local issuer is reserved for local sign-in tokens")
    return claims


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


def verify_srp_jwt(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    """Like `verify_jwt`, but SRP routes also accept a local sign-in token. Raises 401 on any failure."""
    try:
        header = jwt.get_unverified_header(creds.credentials)
        if header.get("kid") == LOCAL_KID:
            return decode_local_token(creds.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired token",
        ) from exc
    return verify_jwt(creds)


# Dependency alias for routers: `claims: dict = Depends(current_user)`
current_user = verify_jwt
# Same, for the SRP Surface only: also accepts a local sign-in token.
current_srp_user = verify_srp_jwt
