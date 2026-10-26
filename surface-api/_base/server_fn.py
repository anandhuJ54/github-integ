"""Server functions: the FastAPI side of the frontend's `serverFn()` shims.

The React app calls `POST /api/<api_surface>/fn/<name>` with `{"data": ...}`; the Vite dev proxy
(and the production edge) strips `/api`, so a Surface serves them under `/<api_surface>/fn/`.
The JSON response body is the function's return value. Errors use HTTP status + `detail`.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from _base.auth import verify_jwt

_optional_bearer = HTTPBearer(auto_error=False)


class FnCall(BaseModel):
    """Request body of every server function: the old createServerFn `{ data }`."""

    data: Any = None


def fn_router(api_surface: str) -> APIRouter:
    """Router for one Surface's server functions, mounted from its aggregate router."""
    return APIRouter(prefix=f"/{api_surface}/fn", tags=[f"{api_surface}:fn"])


def optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
) -> dict | None:
    """Verified JWT claims when a bearer token is sent, else None (public functions)."""
    return verify_jwt(creds) if creds is not None else None


def not_implemented(what: str) -> HTTPException:
    """Missing behaviour is reported, never faked (AGENTS.md §3)."""
    return HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=f"not_implemented: {what}")


def bad_input(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def forbidden(detail: str = "forbidden") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
