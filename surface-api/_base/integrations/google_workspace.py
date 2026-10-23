"""Server-only Google Workspace helpers (port of `lib/google-workspace.server.ts`).

Secrets are read from the vault-backed environment by the reference NAMES stored in
`exp_integration_google` — never from the table, never logged.

The service-account assertion is an RS256 JWT (the TS used WebCrypto), signed with PyJWT.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
from typing import Any

import httpx
import jwt  # PyJWT (with cryptography) signs the RS256 assertion

GOOGLE_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
]

_REF = re.compile(r"^[A-Z_][A-Z0-9_]*$")
_TIMEOUT = 30.0


def secret_by_ref(ref: str | None) -> str | None:
    """The secret value for a reference NAME, or None (bad name / unset / blank)."""
    if not ref or not _REF.match(ref):
        return None
    value = os.environ.get(ref)
    return value if value and value.strip() else None


def secrets_present(row: dict[str, Any]) -> dict[str, bool]:
    return {
        "clientId": bool(secret_by_ref(row.get("client_id_ref"))),
        "clientSecret": bool(secret_by_ref(row.get("client_secret_ref"))),
        "serviceAccount": bool(secret_by_ref(row.get("service_account_ref"))),
    }


def can_deliver(row: dict[str, Any] | None) -> bool:
    """Live only after a human authorized, the domain was verified, and delegation creds exist."""
    return (
        bool(row)
        and row.get("status") == "connected"
        and row.get("domain_status") == "verified"
        and bool(secret_by_ref(row.get("service_account_ref")))
    )


def b64url(data: bytes | str) -> str:
    raw = data.encode("utf-8") if isinstance(data, str) else data
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _compact(o: Any) -> str:
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def sign_assertion(claims: dict[str, Any], private_key_pem: str) -> str:
    """RS256 JWT bearer assertion for Google's token endpoint."""
    return jwt.encode(claims, private_key_pem, algorithm="RS256", headers={"typ": "JWT"})


def delegated_access_token(row: dict[str, Any], subject: str, scopes: list[str]) -> str:
    """Domain-wide delegation: mint an access token impersonating `subject`."""
    raw = secret_by_ref(row.get("service_account_ref"))
    if not raw:
        raise RuntimeError("Service account credentials are not configured")
    sa = json.loads(raw)
    token_uri = sa.get("token_uri") or "https://oauth2.googleapis.com/token"
    now = int(time.time())
    claims = {"iss": sa["client_email"], "sub": subject, "scope": " ".join(scopes),
              "aud": token_uri, "iat": now, "exp": now + 3600}
    assertion = sign_assertion(claims, sa["private_key"])
    res = httpx.post(
        token_uri,
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
              "assertion": assertion},
        timeout=_TIMEOUT,
    )
    if not res.is_success:
        raise RuntimeError(f"Google token request failed [{res.status_code}]: {res.text}")
    return res.json()["access_token"]


def mime_header(v: str) -> str:
    """RFC 2047 encode non-ASCII header values."""
    if v.isascii():
        return v
    return f"=?UTF-8?B?{base64.b64encode(v.encode('utf-8')).decode('ascii')}?="


def send_gmail(row: dict[str, Any], sender: str, to: list[str], subject: str, body: str) -> str:
    token = delegated_access_token(row, sender, ["https://www.googleapis.com/auth/gmail.send"])
    mime = "\r\n".join([
        f"From: {sender}", f"To: {', '.join(to)}", f"Subject: {mime_header(subject)}",
        "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body,
    ])
    res = httpx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        content=_compact({"raw": b64url(mime)}),
        timeout=_TIMEOUT,
    )
    if not res.is_success:
        raise RuntimeError(f"Gmail send failed [{res.status_code}]: {res.text}")
    return res.json()["id"]


def create_calendar_event(row: dict[str, Any], organizer: str, event: dict[str, Any]) -> str:
    """`event`: summary, description, start, end (ISO strings), attendees (emails)."""
    token = delegated_access_token(
        row, organizer, ["https://www.googleapis.com/auth/calendar.events"]
    )
    payload = {
        "summary": event["summary"],
        "description": event["description"],
        "start": {"dateTime": event["start"]},
        "end": {"dateTime": event["end"]},
        "attendees": [{"email": e} for e in event["attendees"]],
    }
    res = httpx.post(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        content=_compact(payload),
        timeout=_TIMEOUT,
    )
    if not res.is_success:
        raise RuntimeError(f"Calendar event failed [{res.status_code}]: {res.text}")
    return res.json()["id"]
