"""sales alerts (S3) — replaces the direct supabase-js calls in
surface-ui/_base/src/lib/sales-alerts.ts (shared: the sales pages and the admin integrations
page call it; its tables are sales tables, so it calls this sales API).

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser.
Dismissing stamps `dismissed_at` with the server's clock and writes the audit row with the
caller's id from the verified token (the browser used `auth.getUser()`); the audit insert's
failure is ignored, as the browser ignored it.

POST /rpc/{name} runs an allow-listed function (q.ALERT_RPCS) as the signed-in user, as the
browser did: exp_alert_accept, and the two tick functions exp_alerts_generate and
exp_task_reminders_tick, which the browser calls today (admin integrations, "run now"). All three
are SECURITY DEFINER and anon-executable; the reminders tick queues emails (exp_email_outbox).
See docs/SECURITY_FINDINGS.md SF-10: this port moves the call, it does not change who may tick.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field

from _base.auth import current_user
from _base.db import session as db
from surfaces.sales.queries import alerts as q
from surfaces.sales.queries.contracts import UnknownRpc
from surfaces.sales.routers.cpq_data import _Body, _guard, _read_with, _write_with

router = APIRouter(prefix="/sales/alerts", tags=["sales"])


class SalesAlertsFilter(_Body):
    """loadAlerts' filter. `opportunity_ids`: absent/null = no filter, [] = matches nothing."""
    opportunity_id: str | None = None
    owner_id: str | None = None
    opportunity_ids: list[str] | None = Field(default=None, max_length=1000)


@router.post("/search")
def load_alerts(body: SalesAlertsFilter, claims: dict = Depends(current_user)) -> list:
    """loadAlerts: the 100 newest open (not dismissed, not accepted) alerts matching the filter
    (a read; POST so a long id list fits)."""
    return _read_with(claims, q.load_alerts, body.opportunity_id, body.owner_id,
                      body.opportunity_ids)


class SalesAlertsDismiss(_Body):
    """The alert's opportunity and rule, recorded on the audit row (as the browser sent them)."""
    opportunity_id: str | None = None
    rule: str | None = None


@router.post("/{alert_id}/dismiss")
def dismiss_alert(alert_id: str, body: SalesAlertsDismiss,
                  claims: dict = Depends(current_user)) -> dict:
    """dismissAlert: dismissed_at = now (server clock), acknowledged = true; then the audit row
    (user_id = the caller)."""
    return _write_with(claims, q.dismiss_alert, alert_id, body.opportunity_id, body.rule,
                       claims.get("sub"))


class SalesAlertsRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: SalesAlertsRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """acceptAlert (exp_alert_accept → the new task's id), runAlertEngineNow (exp_alerts_generate,
    then exp_task_reminders_tick → counts): tick functions called from the browser today, ported
    as called (SF-10)."""
    try:
        q.rpc_sql(name, body.args)  # refuse before leasing a connection
    except UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args)
