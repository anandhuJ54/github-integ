"""Shared extra-key list (C14 / C14b / C14c) — port of `-disco-extra-keys.ts`.

After a site contract is saved, the category's `extra_field` rows in `exp_field_discovery` are
refreshed: new extras are queued for review, seen_count = site contracts of the category that
hold the key, rows no contract holds any more are removed. A per-name dictionary row
(`element_kind = 'extra_key'`) records each key's definition once. Failures are logged, never
raised: every statement runs in its own savepoint so one failure does not abort the caller's
transaction (supabase-js returned errors instead of throwing).

NOTE (governance): like the TS, this writes `exp_field_discovery` directly (insert, update,
delete of `extra_field` rows).
"""
from __future__ import annotations

import importlib
import logging
from datetime import UTC, datetime
from typing import Any

from psycopg.types.json import Jsonb

log = logging.getLogger(__name__)

_FAILED = object()


def _sc() -> Any:
    """The site-contract module (ported in parallel; resolved at call time)."""
    return importlib.import_module("_base.disco.site_contract")


def _f(spec: Any, key: str) -> Any:
    """A field of an ExtraFieldSpec given as a dict or an object."""
    if isinstance(spec, dict):
        return spec.get(key)
    return getattr(spec, key, None)


def _rows(conn: Any, sql: str, params: tuple, what: str) -> Any:
    """Run one statement in a savepoint; return its rows, or _FAILED after logging."""
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() if cur.description else []
    except Exception as e:  # noqa: BLE001
        log.error("%s: %s", what, e)
        return _FAILED


def _count(conn: Any, key: str, gcid: str | None, what: str) -> int | None:
    """Site contracts (of gcid, or of any category) whose extra_fields hold key."""
    sql = (
        "select count(*) as n from disco_site_contract "
        "where extraction->'site_contract'->'extra_fields'->%s is not null"
    )
    params: tuple = (key,)
    if gcid is not None:
        sql += " and category_slug = %s"
        params = (key, gcid)
    rows = _rows(conn, sql, params, what)
    if rows is _FAILED:
        return None
    return int(rows[0]["n"]) if rows else 0


def _maybe_single(conn: Any, sql: str, params: tuple, what: str) -> Any:
    """`.maybeSingle()`: None for no row, the row for one, _FAILED (logged) for more."""
    rows = _rows(conn, sql, params, what)
    if rows is _FAILED:
        return _FAILED
    if len(rows) > 1:
        log.error("%s: multiple rows returned", what)
        return _FAILED
    return rows[0] if rows else None


def refresh_extra_keys(conn: Any, gcid: str, domain: str, extras: dict[str, Any]) -> None:
    """Refresh the category's shared extra-key list after a site contract is saved."""
    # C14: record kept extra keys (staging only).
    try:
        sc = _sc()
        universal = {*sc.PERSON_IDENTITY_KEYS, *sc.LOCATION_KEYS.keys(), *sc.FIRM_KEYS.keys()}
        for key, f in extras.items():
            # An extra named like a static key (routed by name) is not a shared extra key.
            if sc.is_static_extra_key(key, universal):
                continue
            # C14b: seen_count = site contracts in this category that hold the key.
            site_count = _count(conn, key, gcid, f"extra key count failed {key}")
            seen = max(1, site_count or 0)
            row = _maybe_single(
                conn,
                "select discovery_id, first_source, seen_count from exp_field_discovery "
                "where gcid = %s and element_kind = 'extra_field' and normalized = %s",
                (gcid, key),
                f"extra key lookup failed {key}",
            )
            if row is _FAILED:
                continue
            if row:
                _rows(
                    conn,
                    "update exp_field_discovery set seen_count = %s where discovery_id = %s",
                    (seen, row["discovery_id"]),
                    f"extra key update failed {key}",
                )
            else:
                _rows(
                    conn,
                    "insert into exp_field_discovery (gcid, element_kind, raw_label, normalized, "
                    "relevance_verdict, status, reason, first_source, seen_count) "
                    "values (%s, 'extra_field', %s, %s, 'needs_review', 'queued_review', %s, "
                    "%s, %s)",
                    (gcid, _f(f, "label"), key, "extra field (C14): staging only, not promoted",
                     domain, seen),
                    f"extra key insert failed {key}",
                )
            _record_dictionary_key(conn, gcid, domain, key, f)
    except Exception:
        log.exception("extra key recording failed")

    # C14c: shared list hygiene — recount every extra_field row of this category.
    try:
        list_rows = _rows(
            conn,
            "select discovery_id, normalized from exp_field_discovery "
            "where gcid = %s and element_kind = 'extra_field'",
            (gcid,),
            "extra list load failed",
        )
        for lr in [] if list_rows is _FAILED else list_rows:
            if not lr or not lr.get("normalized"):
                continue
            n = _count(conn, lr["normalized"], gcid, f"extra list recount failed {lr['normalized']}")
            if n is None:
                continue
            if n == 0:
                _rows(
                    conn,
                    "delete from exp_field_discovery "
                    "where discovery_id = %s and element_kind = 'extra_field'",
                    (lr["discovery_id"],),
                    f"extra list delete failed {lr['normalized']}",
                )
            else:
                _rows(
                    conn,
                    "update exp_field_discovery set seen_count = %s "
                    "where discovery_id = %s and element_kind = 'extra_field'",
                    (n, lr["discovery_id"]),
                    f"extra list update failed {lr['normalized']}",
                )
    except Exception:
        log.exception("extra list hygiene failed")


def _record_dictionary_key(conn: Any, gcid: str, domain: str, key: str, f: Any) -> None:
    """One 'extra_key' row per key name across all categories; never overwritten or deleted."""
    try:
        count = _count(conn, key, None, f"dictionary count failed {key}")
        seen = max(1, count or 0)
        row = _maybe_single(
            conn,
            "select discovery_id from exp_field_discovery "
            "where element_kind = 'extra_key' and normalized = %s",
            (key,),
            f"dictionary lookup failed {key}",
        )
        if row is _FAILED:
            return
        if row:
            _rows(
                conn,
                "update exp_field_discovery set seen_count = %s "
                "where discovery_id = %s and element_kind = 'extra_key'",
                (seen, row["discovery_id"]),
                f"dictionary update failed {key}",
            )
            return
        sc = _sc()
        d = _f(f, "definition")
        definition = d.strip() if isinstance(d, str) else ""
        vt, subj = _f(f, "value_type"), _f(f, "subject")
        value_type = vt if str(vt) in tuple(sc.EXTRA_VALUE_TYPES) else None
        subject = subj if str(subj) in tuple(sc.EXTRA_SUBJECTS) else None
        if not definition or not value_type or not subject:
            return
        ex = _f(f, "examples")
        examples = Jsonb(ex[:3]) if isinstance(ex, list) else None
        try:
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    "insert into exp_field_discovery (gcid, element_kind, raw_label, normalized, "
                    "definition, value_type, subject, examples, defined_at, relevance_verdict, "
                    "status, reason, first_source, seen_count) "
                    "values (%s, 'extra_key', %s, %s, %s, %s, %s, %s, %s, 'needs_review', "
                    "'queued_review', %s, %s, %s)",
                    (gcid, _f(f, "label") or key, key, definition, value_type, subject, examples,
                     datetime.now(UTC), "extra key dictionary: defined by the site mapper",
                     domain, seen),
                )
        except Exception as e:  # noqa: BLE001
            # 23505: another map defined the same name first; its definition stands.
            if getattr(e, "sqlstate", None) != "23505":
                log.error("dictionary insert failed %s: %s", key, e)
    except Exception:
        log.exception("dictionary record failed %s", key)
