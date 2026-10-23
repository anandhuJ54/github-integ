"""Server-side status/accessor for NORA platform integrations (port of `lib/integrations.server.ts`).

`exp_integration_settings` stores secret reference NAMES; values are read from the vault-backed
environment via `secret_by_ref` and never leave the server.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

import psycopg

from _base.core.db import role_connection
from _base.integrations.catalog import (
    INTEGRATION_KEYS,
    INTEGRATIONS,
    derive_integration_status,
    not_configured,
)
from _base.integrations.google_workspace import secret_by_ref

T = TypeVar("T")

MISSING_TABLE_CODES = frozenset({"42P01", "PGRST205"})


def is_missing_table(err: BaseException | None) -> bool:
    """True when the settings table is not migrated yet (migration 0017 not applied)."""
    return err is not None and getattr(err, "sqlstate", None) in MISSING_TABLE_CODES


def load_rows() -> tuple[list[dict[str, Any]], bool]:
    """(rows, persisted). A missing table falls back to code defaults in stub mode.

    Reads the primary (`fresh`) so a status read right after a settings write sees it.
    """
    with role_connection("service_role", fresh=True) as conn:
        try:
            with conn.transaction(), conn.cursor() as cur:
                cur.execute("select key, mode, secret_refs, settings from exp_integration_settings")
                rows = list(cur.fetchall())
        except psycopg.Error as e:
            if is_missing_table(e):
                return [], False
            raise
    return rows, True


def _js_string(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _to_status(key: str, row: dict[str, Any] | None, persisted: bool) -> dict[str, Any]:
    d = INTEGRATIONS[key]
    row_settings = (row or {}).get("settings") or {}
    settings = {s["id"]: _js_string(row_settings.get(s["id"])) for s in d["settings"]}
    return derive_integration_status(
        key,
        mode=(row or {}).get("mode") or "stub",
        refs=(row or {}).get("secret_refs") or {},
        settings=settings,
        persisted=persisted and row is not None,
        has_secret=lambda ref: bool(secret_by_ref(ref)),
    )


def _find(rows: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
    return next((r for r in rows if r.get("key") == key), None)


def get_integration_status(key: str) -> dict[str, Any]:
    rows, persisted = load_rows()
    return _to_status(key, _find(rows, key), persisted)


def list_integration_statuses() -> list[dict[str, Any]]:
    rows, persisted = load_rows()
    return [_to_status(k, _find(rows, k), persisted) for k in INTEGRATION_KEYS]


def is_live(key: str) -> bool:
    """NORA branches on this: False -> the STUB path (returns NotConfigured, never fake data)."""
    return get_integration_status(key)["status"] == "live"


def _creds_for(s: dict[str, Any]) -> dict[str, Any] | None:
    if s["status"] != "live":
        return None
    secrets: dict[str, str] = {}
    for sid, ref in s["refs"].items():
        v = secret_by_ref(ref)
        if not v:
            return None
        secrets[sid] = v
    return {"secrets": secrets, "settings": s["settings"]}


def get_live_credentials(key: str) -> dict[str, Any] | None:
    """Live credentials for a live integration only; None otherwise. Values stay server-side."""
    return _creds_for(get_integration_status(key))


def with_integration(key: str, live: Callable[[dict[str, Any]], T]) -> dict[str, Any]:
    """Run `live(creds)` only when the integration is live; else a typed NotConfigured result."""
    s = get_integration_status(key)
    creds = _creds_for(s)
    if not creds:
        return not_configured(s)
    return {"ok": True, "status": "live", "integration": key, "data": live(creds)}
