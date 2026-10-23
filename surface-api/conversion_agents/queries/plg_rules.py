"""PLG rules admin — port of the supabase-js calls in
surface-ui/conversion-agents/src/routes/_authenticated/emp.plg-rules.tsx.

Reads and writes run as the signed-in user (role `authenticated`), so plg_rules / plg_events /
audit_log RLS decides what is allowed, as it did for the browser. Each change and its audit_log
entry share one transaction; as in the TS, a failed audit insert does not undo the change.
"""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import delete, func, insert, literal, select, update

from _base.core.sql import MAX_ROWS, compile_sql, fetch_all
from _base.schema.tables import t_audit_log as audit_t
from _base.schema.tables import t_plg_events as ev_t
from _base.schema.tables import t_plg_rules as rules_t

log = logging.getLogger(__name__)

# The columns the page reads, in its select order.
RULE_COLUMNS = (
    "id", "gcid", "rule_name", "rule_type", "trigger_condition", "priority", "headline", "body",
    "cta_text", "cta_action", "cta_url", "requires_upgrade", "upgrade_tier", "icon", "is_active",
    "created_at",
)
# What the editor writes (everything above but id / created_at).
EDITABLE = RULE_COLUMNS[1:-1]


def list_rules(conn: psycopg.Connection) -> list[dict[str, Any]]:
    c = rules_t.c
    stmt = (
        select(*(c[k] for k in RULE_COLUMNS))
        .order_by(c.priority.asc(), c.rule_name.asc())
        .limit(2000)
    )
    return fetch_all(conn, stmt)


def event_stats(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Fires / dismissals / conversions per rule, over the same events the page loaded and
    counted in the browser: it asked for 50,000, and PostgREST returned at most MAX_ROWS.
    Sorted by rule_id."""
    e = ev_t.c
    sample = (
        select(e.rule_id, e.fired_at, e.dismissed_at, e.converted_at)
        .limit(min(50000, MAX_ROWS))
        .subquery()
    )
    stmt = (
        select(
            sample.c.rule_id,
            func.count(sample.c.fired_at).label("fires"),
            func.count(sample.c.dismissed_at).label("dismissals"),
            func.count(sample.c.converted_at).label("conversions"),
        )
        .group_by(sample.c.rule_id)
        .order_by(sample.c.rule_id)
    )
    return fetch_all(conn, stmt)


def _exec(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    sql, params = compile_sql(stmt)
    params = {k: Jsonb(v) if isinstance(v, (dict, list)) else v for k, v in params.items()}
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall()) if cur.description else []


def _audit(conn: psycopg.Connection, action: str, entity_id: str | None,
           field_changes: dict[str, Any] | None = None) -> None:
    """audit_log entry for a rule change. Best effort, as the TS's unchecked insert was."""
    values: dict[str, Any] = {"action": action, "entity_type": "plg_rule", "entity_id": entity_id}
    if field_changes is not None:
        values["field_changes"] = field_changes
    try:
        with conn.transaction():  # savepoint: a refused audit row keeps the change
            _exec(conn, insert(audit_t).values(**values))
    except psycopg.Error as exc:
        log.warning("plg_rule audit insert failed: %s", type(exc).__name__)


def set_active(conn: psycopg.Connection, rule_id: str, is_active: bool) -> None:
    _exec(conn, update(rules_t).where(rules_t.c.id == rule_id).values(is_active=is_active))
    _audit(conn, "plg_rule.activate" if is_active else "plg_rule.deactivate", rule_id,
           {"is_active": is_active})


def create(conn: psycopg.Connection, payload: dict[str, Any]) -> str:
    rows = _exec(conn, insert(rules_t).values(**payload).returning(rules_t.c.id))
    new_id = str(rows[0]["id"])
    # The TS logged `entity_id: form.id ?? null`, always null for a new rule; log the new id.
    _audit(conn, "plg_rule.create", new_id, payload)
    return new_id


def save(conn: psycopg.Connection, rule_id: str, payload: dict[str, Any]) -> None:
    _exec(conn, update(rules_t).where(rules_t.c.id == rule_id).values(**payload))
    _audit(conn, "plg_rule.update", rule_id, payload)


def duplicate(conn: psycopg.Connection, rule_id: str) -> str | None:
    """Copy a rule as an inactive "<name> (Copy)". None when the rule isn't visible."""
    c = rules_t.c
    copied = [c[k] for k in EDITABLE if k not in ("rule_name", "is_active")]
    src = select(
        *copied, (c.rule_name + literal(" (Copy)")).label("rule_name"), literal(False)
    ).where(c.id == rule_id)
    stmt = insert(rules_t).from_select(
        [col.name for col in copied] + ["rule_name", "is_active"], src
    ).returning(c.id)
    rows = _exec(conn, stmt)
    return str(rows[0]["id"]) if rows else None


def remove(conn: psycopg.Connection, rule_id: str) -> None:
    _exec(conn, delete(rules_t).where(rules_t.c.id == rule_id))
    _audit(conn, "plg_rule.delete", rule_id)
