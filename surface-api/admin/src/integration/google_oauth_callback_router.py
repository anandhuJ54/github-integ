"""Google OAuth redirect target (port of `routes/api/public/google-oauth-callback.ts`).

GET /public/google-oauth-callback (the edge strips `/api`). Receives Google's redirect after a
human admin approves consent; validates the one-time state before exchanging the code, and
stores the refresh token in the vault (`exp_google_vault_put`), never in a table. Every outcome
redirects (302) to `/admin/integrations?google=<result>`.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from urllib.parse import quote

import httpx
import psycopg
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from psycopg.types.json import Jsonb

from _base.db.session import role_connection
from _base.integrations.google_workspace import secret_by_ref
from surfaces.admin.integration.sqlutil import fetch_all, maybe_one, soft_execute

log = logging.getLogger(__name__)

router = APIRouter(tags=["admin:public"])

_TIMEOUT = 30.0


def _origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}"


def _as_utc(v: object) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    if isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v)
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    return None


def _set_workspace(sql_set: str, params: tuple) -> None:
    with role_connection("service_role", write=True) as conn:
        soft_execute(conn, f"update exp_integration_google set {sql_set} where id = %s",
                     (*params, "workspace"))


@router.get("/public/google-oauth-callback")
def google_oauth_callback(request: Request) -> RedirectResponse:
    origin = _origin(request)

    def back(q: str) -> RedirectResponse:
        enc = quote(q, safe="!*'()")  # encodeURIComponent
        return RedirectResponse(f"{origin}/admin/integrations?google={enc}", status_code=302)

    qp = request.query_params
    code, state = qp.get("code"), qp.get("state")
    valid = (code is not None and 1 <= len(code) <= 2048
             and state is not None and 16 <= len(state) <= 128)
    if qp.get("error"):
        return back(f"denied:{qp.get('error')}")
    if not valid:
        return back("invalid_request")

    with role_connection("service_role", fresh=True) as conn:
        try:
            with conn.transaction():
                row = maybe_one(conn, "select * from exp_integration_google where id = %s",
                                ("workspace",))
        except (psycopg.Error, ValueError):
            row = None
    expires = _as_utc((row or {}).get("oauth_state_expires_at"))
    if (not row or not row.get("oauth_state") or row["oauth_state"] != state
            or expires is None or expires < datetime.now(UTC)):
        return back("state_mismatch")
    client_id = secret_by_ref(row.get("client_id_ref"))
    client_secret = secret_by_ref(row.get("client_secret_ref"))
    if not client_id or not client_secret:
        return back("missing_client_credentials")

    token_res = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={"code": code, "client_id": client_id, "client_secret": client_secret,
              "redirect_uri": f"{origin}/api/public/google-oauth-callback",
              "grant_type": "authorization_code"},
        timeout=_TIMEOUT,
    )
    if not token_res.is_success:
        log.error("Google token exchange failed [%s]: %s", token_res.status_code, token_res.text)
        _set_workspace("status = %s, last_error = %s, oauth_state = null, updated_at = %s",
                       ("error", f"token exchange {token_res.status_code}", datetime.now(UTC)))
        return back("token_exchange_failed")
    tokens = token_res.json()
    who = httpx.get("https://openidconnect.googleapis.com/v1/userinfo",
                    headers={"authorization": f"Bearer {tokens.get('access_token')}"},
                    timeout=_TIMEOUT)
    info = who.json() if who.is_success else {}
    email = info.get("email")
    if not email or not email.lower().endswith(f"@{str(row.get('domain')).lower()}"):
        _set_workspace("status = %s, last_error = %s, oauth_state = null, updated_at = %s",
                       ("error", "Authorizing account is not on the company domain",
                        datetime.now(UTC)))
        return back("wrong_domain")

    vault_id = row.get("refresh_token_vault_id")
    if tokens.get("refresh_token"):
        try:
            with role_connection("service_role", write=True) as conn:
                r = fetch_all(conn, "select exp_google_vault_put(p_existing := %s, p_secret := %s) "
                              "as id", (vault_id, tokens["refresh_token"]))
            vault_id = r[0]["id"] if r else None
        except psycopg.Error as e:
            log.error("exp_google_vault_put failed: %s", e.sqlstate)
            return back("vault_error")

    now = datetime.now(UTC)
    scopes = [s for s in (tokens.get("scope") or "").split(" ") if s]
    with role_connection("service_role", write=True) as conn:
        soft_execute(
            conn,
            "update exp_integration_google set status = %s, connected_by_email = %s, "
            "connected_at = %s, scopes = %s, refresh_token_vault_id = %s, oauth_state = null, "
            "oauth_state_expires_at = null, last_error = null, updated_at = %s where id = %s",
            ("connected", email, now, scopes, vault_id, now, "workspace"),
        )
        soft_execute(
            conn,
            "insert into audit_log (user_id, action, entity_type, field_changes) "
            "values (%s, %s, %s, %s)",
            (row.get("connected_by"), "google_workspace_connected", "integration",
             Jsonb({"email": email, "scopes": tokens.get("scope") or ""})),
        )
    return back("connected")
