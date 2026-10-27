"""POST /srp/auth/login and GET /srp/auth/me — local sign-in (srp/local-login-srp-home).

Off unless LOCAL_AUTH_ENABLED is on: the login route is then a 404, and local tokens are not accepted.
"""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import LOCAL_ISSUER, current_srp_user, issue_local_token
from _base.config import get_settings
from surfaces.srp.auth import services
from surfaces.srp.auth.schemas import LoginRequest, LoginResponse, MeResponse

router = APIRouter(prefix="/srp/auth", tags=["srp"])


def _require_enabled() -> None:
    if not get_settings().local_auth_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")


def _refuse(result: services.AuthResult) -> HTTPException:
    if result.reason == services.NO_SEAT:
        return HTTPException(status.HTTP_403_FORBIDDEN, services.NO_SEAT)
    return HTTPException(status.HTTP_401_UNAUTHORIZED, services.INVALID)


# `_require_enabled` is a dependency so that, with local sign-in off, even a malformed body is a 404
# (not a 422 that would show the route exists).
@router.post("/login", response_model=LoginResponse, dependencies=[Depends(_require_enabled)])
def login(body: LoginRequest) -> dict:
    result = services.authenticate(body.email, body.password)
    if not result.ok:
        raise _refuse(result)
    assert result.user is not None
    token, exp = issue_local_token(result.user["id"], result.user["email"])
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_at": datetime.fromtimestamp(exp, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "user": result.user,
        "landing": {"path": result.landing_path},
    }


@router.get("/me", response_model=MeResponse)
def me(claims: dict = Depends(current_srp_user)) -> dict:
    if claims.get("iss") != LOCAL_ISSUER:  # a Supabase token is not a local session
        raise HTTPException(status.HTTP_403_FORBIDDEN, "local_session_required")
    _require_enabled()
    try:
        user_id = int(claims["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from exc
    result = services.current_session(user_id)
    if not result.ok:
        raise _refuse(result)
    return {"user": result.user, "landing": {"path": result.landing_path}}
