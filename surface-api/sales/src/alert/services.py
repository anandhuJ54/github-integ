"""sales alerts (S3) — port of the supabase-js calls in surface-ui/_base/src/lib/sales-alerts.ts
(a shared lib, imported by the sales pages and by the admin integrations page): the open alerts
(exp_sales_alerts), dismissing one (plus its audit_log row), and three RPCs.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. The read keeps the
browser's statement (its `.limit(100)` is under the 1000-row cap). The dismiss is the browser's
two statements in its order: the update (threw on error), then the audit_log insert, whose
error the browser never looked at, so a failed audit insert is ignored here too (in a savepoint,
so the dismiss still commits, as it did). `dismissed_at` is the server's clock; the audit row's
`user_id` (the browser's `auth.getUser()` id) is the verified token's subject.

The RPCs (ALERT_RPCS) are SECURITY DEFINER and executable by anon (docs/SECURITY_FINDINGS.md
SF-10). Two of them are tick functions that the browser calls today from the admin integrations
page's "run now" button: exp_alerts_generate (writes exp_sales_alerts) and
exp_task_reminders_tick (writes reminder alerts and queues reminder emails in exp_email_outbox).
They are ported as the browser called them (no arguments, so `p_now` keeps its DEFAULT now()),
not made safer or moved server-side here; that is SF-10's decision.
"""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import select

from _base.db import tables as T
from _base.db.sql import fetch_all
from surfaces.sales.core.services import insert_rows, update_by
from surfaces.sales.internal import call, cols, execute, now, rpc_call

_log = logging.getLogger(__name__)

alerts = T.t_exp_sales_alerts
audit = T.t_audit_log

ALERT_COLS = ("id,opportunity_id,logo,alert_type,rule,body,severity,owner_id,is_nora_suggested,"
              "suggested_task,accepted_task_id,created_at")
# loadAlerts' match for an empty opportunityIds list: no opportunity has this id
NO_OPPORTUNITY = "00000000-0000-0000-0000-000000000000"


def alerts_stmt(opportunity_id: str | None, owner_id: str | None,
                opportunity_ids: list[str] | None) -> Any:
    """loadAlerts: .is("dismissed_at", null).is("accepted_task_id", null)
    .order("created_at", desc).limit(100), then (each only when given, by JS truthiness)
    .eq("opportunity_id"), .eq("owner_id"), and .in("opportunity_id", ids) — or, for an empty
    list, .eq("opportunity_id", the zero uuid)."""
    stmt = select(*cols(alerts, ALERT_COLS)).where(alerts.c.dismissed_at.is_(None),
                                                   alerts.c.accepted_task_id.is_(None))
    if opportunity_id:
        stmt = stmt.where(alerts.c.opportunity_id == opportunity_id)
    if owner_id:
        stmt = stmt.where(alerts.c.owner_id == owner_id)
    if opportunity_ids is not None:
        stmt = stmt.where(alerts.c.opportunity_id.in_(opportunity_ids) if opportunity_ids
                          else alerts.c.opportunity_id == NO_OPPORTUNITY)
    return stmt.order_by(alerts.c.created_at.desc()).limit(100)


def load_alerts(conn: psycopg.Connection, opportunity_id: str | None, owner_id: str | None,
                opportunity_ids: list[str] | None) -> list[dict[str, Any]]:
    return fetch_all(conn, alerts_stmt(opportunity_id, owner_id, opportunity_ids))


def dismiss_stmt(alert_id: str) -> Any:
    """update({ dismissed_at: now, acknowledged: true }).eq("id", id)."""
    return update_by(alerts, alerts.c.id, alert_id, {"dismissed_at": now(), "acknowledged": True})


def audit_stmt(user_id: str | None, alert_id: str, opportunity_id: str | None,
               rule: str | None) -> Any:
    """audit_log insert({ user_id, action: "sales_alert_dismissed", entity_type: "opportunity",
    entity_id: opportunity_id, field_changes: { alert_id, rule } })."""
    return insert_rows(audit, [{
        "user_id": user_id, "action": "sales_alert_dismissed", "entity_type": "opportunity",
        "entity_id": opportunity_id,
        "field_changes": Jsonb({"alert_id": alert_id, "rule": rule}),
    }])


def dismiss_alert(conn: psycopg.Connection, alert_id: str, opportunity_id: str | None,
                  rule: str | None, user_id: str | None) -> None:
    """dismissAlert: the update (its error reaches the page), then the audit row (its error was
    ignored by the browser: logged and ignored here, the dismiss kept)."""
    execute(conn, dismiss_stmt(alert_id))
    try:
        with conn.transaction():  # a savepoint: a failed audit insert doesn't undo the dismiss
            execute(conn, audit_stmt(user_id, alert_id, opportunity_id, rule))
    except psycopg.Error as exc:
        _log.warning("dismissAlert: audit_log insert failed, ignored as the browser did: %s: %s",
                     type(exc).__name__, exc.diag.message_primary if exc.diag else exc)


# --- RPCs ------------------------------------------------------------------------------------

# name → [(param, db type)] the browser sends. Live signatures (pg_proc, read at port time):
#   exp_alert_accept(p_alert uuid) → uuid
#   exp_alerts_generate(p_now timestamptz DEFAULT now()) → integer
#   exp_task_reminders_tick(p_now timestamptz DEFAULT now()) → integer
# The browser calls both ticks with no arguments, so `p_now` is not accepted from a request (the
# function's DEFAULT now() applies, as before). All three: SECURITY DEFINER, search_path=public,
# EXECUTE granted to anon and authenticated (SF-10).
ALERT_RPCS: dict[str, list[tuple[str, str]]] = {
    # a human accepts a NORA suggestion; the function creates the real task
    "exp_alert_accept": [("p_alert", "uuid")],
    # tick: the alert sweep, called from the browser's "run now" today
    "exp_alerts_generate": [],
    # tick: the task-reminder sweep (queues emails in exp_email_outbox), called from the
    # browser's "run now" today
    "exp_task_reminders_tick": [],
}


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return rpc_call(ALERT_RPCS, name, args)


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    sql, params = rpc_sql(name, args)
    return call(conn, sql, params)
