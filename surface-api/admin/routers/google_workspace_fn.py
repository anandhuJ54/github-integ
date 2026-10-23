"""Google Workspace delivery (port of `lib/google-workspace.functions.ts`).

POST /admin/fn/<name>. Super-admin checks run server-side through `exp_ctrl_has_role` as the
calling user, exactly as the TS did. Delivery (Gmail / Calendar) happens only when the
workspace row is connected, its domain verified and delegation credentials exist; otherwise
emails and meetings are recorded as pending.
"""
from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from urllib.parse import urlencode, urlsplit

import httpx
import psycopg
from fastapi import Depends
from psycopg.types.json import Jsonb
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from _base.core.auth import current_user
from _base.core.db import role_connection
from _base.core.server_fn import FnCall, bad_input, fn_router, forbidden
from _base.integrations import google_workspace as gw
from admin.sqlutil import execute, fetch_all, maybe_one, one, parse_input, soft_execute

router = fn_router("admin")

_WS = "workspace"
_ZERO_UUID = "00000000-0000-0000-0000-000000000000"
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_OWNER_UUID_RE = re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE)
# zod v3 email regex.
_EMAIL_RE = re.compile(
    r"^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$",
    re.IGNORECASE,
)


def _check(pattern: re.Pattern[str], what: str):
    def v(s: str) -> str:
        if not pattern.match(s):
            raise ValueError(f"Invalid {what}")
        return s
    return AfterValidator(v)


Uuid = Annotated[str, _check(_UUID_RE, "uuid")]
Email = Annotated[str, _check(_EMAIL_RE, "email")]


def now_iso() -> str:
    """JS `new Date().toISOString()`."""
    return iso_z(datetime.now(UTC))


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# --- shared helpers (also used by integrations_fn) ------------------------------------


def require_super_admin(claims: dict) -> None:
    """`exp_ctrl_has_role(['super_admin'])` as the caller; anything but true -> 403."""
    try:
        with role_connection("authenticated", claims) as conn:
            row = maybe_one(conn, "select exp_ctrl_has_role(p_roles := %s) as ok", (["super_admin"],))
    except (psycopg.Error, ValueError) as e:
        raise forbidden("Super admin required") from e
    if not row or row.get("ok") is not True:
        raise forbidden("Super admin required")


def audit(claims: dict, action: str, entity_id: str | None, changes: Any) -> None:
    """audit_log insert as the caller (the TS ignored its error)."""
    with role_connection("authenticated", claims, write=True) as conn:
        soft_execute(
            conn,
            "insert into audit_log (user_id, action, entity_type, entity_id, field_changes) "
            "values (%s, %s, %s, %s, %s)",
            (claims.get("sub"), action, "opportunity" if entity_id else "integration", entity_id,
             Jsonb(changes)),
        )


def load_row() -> dict[str, Any]:
    """The singleton `exp_integration_google` row, created with defaults when absent."""
    with role_connection("service_role", write=True) as conn:
        row = maybe_one(conn, "select * from exp_integration_google where id = %s", (_WS,))
        if row:
            return row
        return one(conn, "insert into exp_integration_google (id) values (%s) returning *", (_WS,))


def _admin_update(sql_set: str, params: tuple, where_id: Any, table: str, *, soft: bool) -> None:
    with role_connection("service_role", write=True) as conn:
        sql = f"update {table} set {sql_set} where id = %s"  # table/columns from code only
        if soft:
            soft_execute(conn, sql, (*params, where_id))
        else:
            execute(conn, sql, (*params, where_id))


def _sender_address(claims: dict, domain: str, opp_owner: str | None) -> str | None:
    email = (claims.get("email") or "").lower() or None
    if email and email.endswith(f"@{domain}"):
        return email
    if opp_owner:
        owner_id = opp_owner if _OWNER_UUID_RE.match(opp_owner) else _ZERO_UUID
        with role_connection("authenticated", claims) as conn:
            try:
                with conn.transaction():
                    rows = fetch_all(
                        conn,
                        "select email from exp_sales_reps where id = %s::uuid or name = %s limit 1",
                        (owner_id, opp_owner),
                    )
            except psycopg.Error:
                rows = []
        rep = (rows[0].get("email") or "").lower() if rows else ""
        if rep and rep.endswith(f"@{domain}"):
            return rep
    return email


def _requested_scopes(row: dict[str, Any]) -> list[str]:
    """`row.requested_scopes ?? GOOGLE_SCOPES`."""
    v = row.get("requested_scopes")
    return v if v is not None else gw.GOOGLE_SCOPES


# --- endpoints -----------------------------------------------------------------------


@router.post("/getGoogleDeliveryStatus")
def get_google_delivery_status(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Status for any signed-in employee (no secrets, no tokens)."""
    row = load_row()
    return {"status": row.get("status"), "domainStatus": row.get("domain_status"),
            "domain": row.get("domain"), "canDeliver": gw.can_deliver(row)}


def _count(conn: Any, sql: str, params: tuple) -> int:
    try:
        with conn.transaction():
            r = fetch_all(conn, sql, params)
        return int(r[0]["count"]) if r else 0
    except psycopg.Error:
        return 0


@router.post("/getGoogleIntegration")
def get_google_integration(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Full admin view. Secret presence is reported as booleans only."""
    require_super_admin(claims)
    row = load_row()
    with role_connection("service_role") as conn:
        pending = _count(conn, "select count(*) as count from exp_email_outbox where status = %s",
                         ("pending",))
        cal_pending = _count(
            conn, "select count(*) as count from exp_sales_demos where calendar_status = %s",
            ("pending",),
        )
    return {
        "status": row.get("status"), "domain": row.get("domain"),
        "domainStatus": row.get("domain_status"),
        "verificationToken": row.get("domain_verification_token"),
        "verifiedAt": row.get("verified_at"),
        "connectedByEmail": row.get("connected_by_email"), "connectedAt": row.get("connected_at"),
        "scopes": row.get("scopes") or [],
        "requestedScopes": _requested_scopes(row),
        "delegationMode": row.get("delegation_mode"),
        "refs": {"clientId": row.get("client_id_ref"), "clientSecret": row.get("client_secret_ref"),
                 "serviceAccount": row.get("service_account_ref")},
        "secrets": gw.secrets_present(row),
        "refreshTokenStored": bool(row.get("refresh_token_vault_id")),
        "lastError": row.get("last_error"),
        "canDeliver": gw.can_deliver(row), "pendingEmails": pending, "pendingCalendar": cal_pending,
    }


class _ConnectIn(BaseModel):
    origin: str


def _url_origin(raw: str) -> str:
    """zod `.url()` + `new URL(x).origin`."""
    parts = urlsplit(raw.strip())
    if not parts.scheme or not parts.netloc:
        raise bad_input("origin: Invalid url")
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    default = {"http": 80, "https": 443}.get(scheme)
    try:
        port = parts.port
    except ValueError as e:
        raise bad_input("origin: Invalid url") from e
    if port is not None and port != default:
        host = f"{host}:{port}"
    return f"{scheme}://{host}"


@router.post("/startGoogleConnect")
def start_google_connect(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Builds the Google consent URL. The admin must open it and approve; nothing auto-authorizes."""
    data = parse_input(_ConnectIn, call.data)
    origin = _url_origin(data.origin)
    require_super_admin(claims)
    row = load_row()
    client_id = gw.secret_by_ref(row.get("client_id_ref"))
    if not client_id or not gw.secret_by_ref(row.get("client_secret_ref")):
        refs = [row.get("client_id_ref"), row.get("client_secret_ref")]
        return {"url": None, "missing": [r for r in refs if not gw.secret_by_ref(r)]}
    state = uuid.uuid4().hex + uuid.uuid4().hex
    _admin_update(
        "status = %s, oauth_state = %s, oauth_state_expires_at = %s, connected_by = %s, "
        "updated_at = %s",
        ("connected" if row.get("status") == "connected" else "awaiting_admin_authorize", state,
         datetime.now(UTC) + timedelta(minutes=15), claims.get("sub"), datetime.now(UTC)),
        _WS, "exp_integration_google", soft=True,
    )
    audit(claims, "google_workspace_connect_started", None, {"domain": row.get("domain")})
    scopes = ["openid", "email", *_requested_scopes(row)]
    params = urlencode({
        "client_id": client_id,
        "redirect_uri": f"{origin}/api/public/google-oauth-callback",
        "response_type": "code", "access_type": "offline", "prompt": "consent",
        "include_granted_scopes": "true", "hd": row.get("domain") or "", "state": state,
        "scope": " ".join(scopes),
    })
    return {"url": f"https://accounts.google.com/o/oauth2/v2/auth?{params}", "missing": []}


@router.post("/startDomainVerification")
def start_domain_verification(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Issues a DNS TXT token; verified only when an admin clicks "Check" after publishing it."""
    require_super_admin(claims)
    row = load_row()
    token = (row.get("domain_verification_token")
             or f"experience-workspace-verification={uuid.uuid4()}")
    _admin_update(
        "domain_status = %s, domain_verification_token = %s, updated_at = %s",
        ("verified" if row.get("domain_status") == "verified" else "pending_verification", token,
         datetime.now(UTC)),
        _WS, "exp_integration_google", soft=True,
    )
    audit(claims, "google_domain_verification_started", None, {"domain": row.get("domain")})
    return {"token": token}


@router.post("/checkDomainVerification")
def check_domain_verification(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    require_super_admin(claims)
    row = load_row()
    token = row.get("domain_verification_token")
    if not token:
        return {"verified": False, "reason": "Generate a verification record first"}
    res = httpx.get(
        "https://cloudflare-dns.com/dns-query",
        params={"name": row.get("domain") or "", "type": "TXT"},
        headers={"accept": "application/dns-json"},
        timeout=30.0,
    )
    if not res.is_success:
        return {"verified": False, "reason": f"DNS lookup failed [{res.status_code}]"}
    answers = res.json().get("Answer") or []
    if not any(token in str(a.get("data", "")).replace('"', "") for a in answers):
        return {"verified": False, "reason": "TXT record not found yet (DNS can take up to an hour)"}
    now = datetime.now(UTC)
    _admin_update("domain_status = %s, verified_at = %s, updated_at = %s", ("verified", now, now),
                  _WS, "exp_integration_google", soft=True)
    audit(claims, "google_domain_verified", None, {"domain": row.get("domain")})
    return {"verified": True, "reason": None}


class _EmailIn(BaseModel):
    model_config = ConfigDict(strict=True)
    opportunityId: Uuid
    to: Annotated[list[Email], Field(min_length=1, max_length=20)]
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


@router.post("/sendOpportunityEmail")
def send_opportunity_email(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Email from the opportunity: queued as pending; sent only when Google delivery is live."""
    data = parse_input(_EmailIn, call.data)
    row = load_row()
    domain = row.get("domain") or ""
    with role_connection("authenticated", claims) as conn:
        try:
            with conn.transaction():
                opp = maybe_one(conn, "select id, owner, account_id from exp_sales_pipeline "
                                "where id = %s", (data.opportunityId,))
        except (psycopg.Error, ValueError):
            opp = None
    if not opp:
        raise bad_input("Opportunity not found")
    sender = _sender_address(claims, domain, opp.get("owner"))
    with role_connection("authenticated", claims, write=True) as conn:
        ins = one(
            conn,
            "insert into exp_email_outbox (opportunity_id, kind, from_address, to_addresses, "
            "subject, body, status) values (%s, %s, %s, %s, %s, %s, %s) returning id",
            (data.opportunityId, "email", sender, data.to, data.subject, data.body, "pending"),
        )
    outbox_id = str(ins["id"])
    status, error = "pending", None
    if gw.can_deliver(row) and sender and sender.endswith(f"@{domain}"):
        try:
            mid = gw.send_gmail(row, sender, data.to, data.subject, data.body)
            _admin_update("status = %s, provider_message_id = %s, sent_at = %s",
                          ("sent", mid, datetime.now(UTC)), ins["id"], "exp_email_outbox",
                          soft=True)
            status = "sent"
        except Exception as e:  # noqa: BLE001 — recorded on the outbox row, as the TS did
            error = str(e)
            _admin_update("status = %s, error = %s", ("failed", error), ins["id"],
                          "exp_email_outbox", soft=True)
            status = "failed"
    event_type = {"sent": "email_sent", "failed": "email_failed"}.get(status, "email_queued")
    with role_connection("authenticated", claims, write=True) as conn:
        soft_execute(
            conn,
            "insert into exp_activity_events (event_type, subject_type, subject_id, account_id, "
            "actor, source, occurred_at, value) values (%s, %s, %s, %s, %s, %s, %s, %s)",
            (event_type, "opportunity", data.opportunityId, opp.get("account_id"), sender, "gmail",
             datetime.now(UTC),
             Jsonb({"subject": data.subject, "to": data.to, "outbox_id": outbox_id,
                    "status": status})),
        )
    audit(claims, f"opportunity_email_{status}", data.opportunityId,
          {"outbox_id": outbox_id, "to": data.to})
    return {"status": status, "error": error, "outboxId": outbox_id}


class _MeetingIn(BaseModel):
    model_config = ConfigDict(strict=True)
    opportunityId: Uuid
    kind: Literal["demo", "meeting"]
    start: Annotated[str, StringConstraints(min_length=10)]
    durationMinutes: Annotated[int, Field(ge=15, le=480)]
    objective: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1,
                                                max_length=2000)]
    agenda: Annotated[str, StringConstraints(max_length=5000)]
    attendees: Annotated[list[Email], Field(max_length=50)]
    sellerId: Uuid | None


def parse_js_date(s: str) -> datetime | None:
    """`new Date(s)` for ISO-8601 strings; naive values are taken as UTC. None when invalid."""
    try:
        dt = datetime.fromisoformat(s.strip().replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


@router.post("/scheduleOpportunityMeeting")
def schedule_opportunity_meeting(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Meeting/demo: always records it locally; the calendar event only when delivery is live."""
    data = parse_input(_MeetingIn, call.data)
    row = load_row()
    domain = row.get("domain") or ""
    start = parse_js_date(data.start)
    if start is None:
        raise bad_input("Invalid start time")
    end = start + timedelta(minutes=data.durationMinutes)
    live = gw.can_deliver(row)
    with role_connection("authenticated", claims, write=True) as conn:
        ins = one(
            conn,
            "insert into exp_sales_demos (opportunity_id, seller_id, booked_at, objective, agenda, "
            "attendees, is_demo, meeting_kind, duration_minutes, calendar_status) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (data.opportunityId, data.sellerId, iso_z(start), data.objective, data.agenda or None,
             data.attendees, False, data.kind, data.durationMinutes, "pending"),
        )
    with role_connection("authenticated", claims) as conn:
        try:
            with conn.transaction():
                opp = maybe_one(conn, "select name, owner, account_id from exp_sales_pipeline "
                                "where id = %s", (data.opportunityId,))
        except (psycopg.Error, ValueError):
            opp = None
    calendar = "pending"
    organizer = _sender_address(claims, domain, (opp or {}).get("owner"))
    if live and organizer and organizer.endswith(f"@{domain}"):
        try:
            title = "Demo" if data.kind == "demo" else "Meeting"
            event_id = gw.create_calendar_event(row, organizer, {
                "summary": f"{title} · {(opp or {}).get('name') or 'Opportunity'}",
                "description": "\n\n".join(x for x in (data.objective, data.agenda) if x),
                "start": iso_z(start), "end": iso_z(end), "attendees": data.attendees,
            })
            _admin_update("calendar_status = %s, calendar_event_id = %s", ("created", event_id),
                          ins["id"], "exp_sales_demos", soft=True)
            calendar = "created"
        except Exception as e:  # noqa: BLE001 — recorded on the demo row, as the TS did
            _admin_update("calendar_status = %s, calendar_error = %s", ("failed", str(e)),
                          ins["id"], "exp_sales_demos", soft=True)
            calendar = "failed"
    demo_id = str(ins["id"])
    audit(claims, f"opportunity_{data.kind}_booked", data.opportunityId,
          {"demo_id": demo_id, "booked_at": iso_z(start), "calendar": calendar})
    return {"demoId": demo_id, "calendar": calendar}


@router.post("/dispatchGoogleOutbox")
def dispatch_google_outbox(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Admin: deliver queued emails after Google goes live."""
    require_super_admin(claims)
    row = load_row()
    if not gw.can_deliver(row):
        return {"sent": 0, "failed": 0, "skipped": "Google Workspace is not live yet"}
    domain = row.get("domain") or ""
    with role_connection("service_role") as conn:
        try:
            with conn.transaction():
                rows = fetch_all(conn, "select * from exp_email_outbox where status = %s "
                                 "order by created_at limit 50", ("pending",))
        except psycopg.Error:
            rows = []
    sent = failed = 0
    for r in rows:
        try:
            sender = r.get("from_address") or ""
            if not sender.endswith(f"@{domain}"):
                raise RuntimeError("Sender is not a company address")
            mid = gw.send_gmail(row, sender, r.get("to_addresses") or [], r.get("subject") or "",
                                r.get("body") or "")
            _admin_update("status = %s, provider_message_id = %s, sent_at = %s",
                          ("sent", mid, datetime.now(UTC)), r["id"], "exp_email_outbox", soft=True)
            sent += 1
        except Exception as e:  # noqa: BLE001
            _admin_update("status = %s, error = %s", ("failed", str(e)), r["id"],
                          "exp_email_outbox", soft=True)
            failed += 1
    audit(claims, "google_outbox_dispatched", None, {"sent": sent, "failed": failed})
    return {"sent": sent, "failed": failed, "skipped": None}
