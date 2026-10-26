"""Opportunity Google delivery (port of `lib/google-workspace.functions.ts`; formerly in admin,
ruling 2026-10-25).

POST /sales/fn/<name>. Serves the opportunity page's Send email, Schedule meeting and Book demo
buttons. Delivery (Gmail / Calendar) happens only when the workspace row is connected, its
domain verified and delegation credentials exist; otherwise emails and meetings are recorded as
pending. The workspace connection itself is managed by the admin Surface.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, TypeVar

import psycopg
from fastapi import Depends
from psycopg.types.json import Jsonb
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
)

from _base.auth import current_user
from _base.db.session import role_connection
from _base.integrations import google_workspace as gw
from _base.server_fn import FnCall, bad_input, fn_router

router = fn_router("sales")

_WS = "workspace"
_ZERO_UUID = "00000000-0000-0000-0000-000000000000"
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_OWNER_UUID_RE = re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE)
# zod v3 email regex.
_EMAIL_RE = re.compile(
    r"^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$",
    re.IGNORECASE,
)

M = TypeVar("M", bound=BaseModel)


def _check(pattern: re.Pattern[str], what: str):
    def v(s: str) -> str:
        if not pattern.match(s):
            raise ValueError(f"Invalid {what}")
        return s
    return AfterValidator(v)


Uuid = Annotated[str, _check(_UUID_RE, "uuid")]
Email = Annotated[str, _check(_EMAIL_RE, "email")]


def iso_z(dt: datetime) -> str:
    """JS `Date.toISOString()`."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# --- SQL helpers (supabase-js call semantics; same as surfaces.admin.sqlutil, kept local: no
# cross-Surface import) -------------------------------------------------------------------


def _fetch_all(conn: Any, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def _maybe_one(conn: Any, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    """`.maybeSingle()`: None for no row, error for more than one."""
    rows = _fetch_all(conn, sql, params)
    if len(rows) > 1:
        raise ValueError("JSON object requested, multiple (or no) rows returned")
    return rows[0] if rows else None


def _one(conn: Any, sql: str, params: Sequence[Any] = ()) -> dict[str, Any]:
    """`.single()`: exactly one row or an error."""
    rows = _fetch_all(conn, sql, params)
    if len(rows) != 1:
        raise ValueError("JSON object requested, multiple (or no) rows returned")
    return rows[0]


def _soft_execute(conn: Any, sql: str, params: Sequence[Any] = ()) -> bool:
    """A write whose `error` the TS ignored: savepoint, False when it failed."""
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(sql, params)
        return True
    except psycopg.Error:
        return False


def _parse_input(model: type[M], data: Any) -> M:
    """zod `.parse` -> 400 with the validation messages."""
    try:
        return model.model_validate(data)
    except ValidationError as e:
        msgs = "; ".join(
            f"{'.'.join(str(p) for p in err['loc']) or 'data'}: {err['msg']}" for err in e.errors()
        )
        raise bad_input(msgs) from e


# --- shared helpers -------------------------------------------------------------------


def _audit(claims: dict, action: str, entity_id: str | None, changes: Any) -> None:
    """audit_log insert as the caller (the TS ignored its error)."""
    with role_connection("authenticated", claims, write=True) as conn:
        _soft_execute(
            conn,
            "insert into audit_log (user_id, action, entity_type, entity_id, field_changes) "
            "values (%s, %s, %s, %s, %s)",
            (claims.get("sub"), action, "opportunity" if entity_id else "integration", entity_id,
             Jsonb(changes)),
        )


def _load_row() -> dict[str, Any]:
    """The singleton `exp_integration_google` row, created with defaults when absent."""
    with role_connection("service_role", write=True) as conn:
        row = _maybe_one(conn, "select * from exp_integration_google where id = %s", (_WS,))
        if row:
            return row
        return _one(conn, "insert into exp_integration_google (id) values (%s) returning *", (_WS,))


def _service_update(sql_set: str, params: tuple, where_id: Any, table: str) -> None:
    """Service-role status update whose error is ignored (savepoint)."""
    with role_connection("service_role", write=True) as conn:
        sql = f"update {table} set {sql_set} where id = %s"  # table/columns from code only
        _soft_execute(conn, sql, (*params, where_id))


def _sender_address(claims: dict, domain: str, opp_owner: str | None) -> str | None:
    email = (claims.get("email") or "").lower() or None
    if email and email.endswith(f"@{domain}"):
        return email
    if opp_owner:
        owner_id = opp_owner if _OWNER_UUID_RE.match(opp_owner) else _ZERO_UUID
        with role_connection("authenticated", claims) as conn:
            try:
                with conn.transaction():
                    rows = _fetch_all(
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


# --- endpoints -----------------------------------------------------------------------


@router.post("/getGoogleDeliveryStatus")
def get_google_delivery_status(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Status for any signed-in employee (no secrets, no tokens)."""
    row = _load_row()
    return {"status": row.get("status"), "domainStatus": row.get("domain_status"),
            "domain": row.get("domain"), "canDeliver": gw.can_deliver(row)}


class _EmailIn(BaseModel):
    model_config = ConfigDict(strict=True)
    opportunityId: Uuid
    to: Annotated[list[Email], Field(min_length=1, max_length=20)]
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


@router.post("/sendOpportunityEmail")
def send_opportunity_email(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Email from the opportunity: queued as pending; sent only when Google delivery is live."""
    data = _parse_input(_EmailIn, call.data)
    row = _load_row()
    domain = row.get("domain") or ""
    with role_connection("authenticated", claims) as conn:
        try:
            with conn.transaction():
                opp = _maybe_one(conn, "select id, owner, account_id from exp_sales_pipeline "
                                 "where id = %s", (data.opportunityId,))
        except (psycopg.Error, ValueError):
            opp = None
    if not opp:
        raise bad_input("Opportunity not found")
    sender = _sender_address(claims, domain, opp.get("owner"))
    with role_connection("authenticated", claims, write=True) as conn:
        ins = _one(
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
            _service_update("status = %s, provider_message_id = %s, sent_at = %s",
                            ("sent", mid, datetime.now(UTC)), ins["id"], "exp_email_outbox")
            status = "sent"
        except Exception as e:  # noqa: BLE001 — recorded on the outbox row, as the TS did
            error = str(e)
            _service_update("status = %s, error = %s", ("failed", error), ins["id"],
                            "exp_email_outbox")
            status = "failed"
    event_type = {"sent": "email_sent", "failed": "email_failed"}.get(status, "email_queued")
    with role_connection("authenticated", claims, write=True) as conn:
        _soft_execute(
            conn,
            "insert into exp_activity_events (event_type, subject_type, subject_id, account_id, "
            "actor, source, occurred_at, value) values (%s, %s, %s, %s, %s, %s, %s, %s)",
            (event_type, "opportunity", data.opportunityId, opp.get("account_id"), sender, "gmail",
             datetime.now(UTC),
             Jsonb({"subject": data.subject, "to": data.to, "outbox_id": outbox_id,
                    "status": status})),
        )
    _audit(claims, f"opportunity_email_{status}", data.opportunityId,
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
    data = _parse_input(_MeetingIn, call.data)
    row = _load_row()
    domain = row.get("domain") or ""
    start = parse_js_date(data.start)
    if start is None:
        raise bad_input("Invalid start time")
    end = start + timedelta(minutes=data.durationMinutes)
    live = gw.can_deliver(row)
    with role_connection("authenticated", claims, write=True) as conn:
        ins = _one(
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
                opp = _maybe_one(conn, "select name, owner, account_id from exp_sales_pipeline "
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
            _service_update("calendar_status = %s, calendar_event_id = %s", ("created", event_id),
                            ins["id"], "exp_sales_demos")
            calendar = "created"
        except Exception as e:  # noqa: BLE001 — recorded on the demo row, as the TS did
            _service_update("calendar_status = %s, calendar_error = %s", ("failed", str(e)),
                            ins["id"], "exp_sales_demos")
            calendar = "failed"
    demo_id = str(ins["id"])
    _audit(claims, f"opportunity_{data.kind}_booked", data.opportunityId,
           {"demo_id": demo_id, "booked_at": iso_z(start), "calendar": calendar})
    return {"demoId": demo_id, "calendar": calendar}
