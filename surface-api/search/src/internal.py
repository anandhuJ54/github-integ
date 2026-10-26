"""Helpers shared by two or more of the search Surface's resource folders. Private; no endpoints.

Two parts, each moved here unchanged from its own module:

* Small SQL helpers (was `surfaces.search.pg`, supabase-js parity). supabase-js returned
  `{ data: null, error }` instead of throwing; `safe()` keeps that by running the statement in a
  savepoint and yielding the fallback on a database error.

* The site-wide indexing switch as the search Surface reads it (was
  `surfaces.search.site_indexing`). Port of `loadSiteIndexingEnabled` (legacy
  `lib/sitemap.server.ts`). robots.txt and the sitemaps (`surfaces.search.sitemap.robots`,
  `surfaces.search.sitemap.router`) read it too. Defaults OFF; any failure reads as OFF. Nothing
  here flips the switch on its own. The write (setSiteIndexing) is in the admin Surface; it emits
  SITE_INDEXING_CHANGED after commit and the handler registered below drops this process's cached
  value (surface audit 2026-10-25).
"""
from __future__ import annotations

import logging
import math
import time
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

import psycopg

from _base.db.session import role_connection

log = logging.getLogger(__name__)


# --- small SQL helpers (was surfaces.search.pg) ---

def rows(conn: Any, sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    return list(conn.execute(sql, params).fetchall())


def safe(conn: Any, sql: str, params: Sequence[Any] | None, default: Any) -> Any:
    try:
        with conn.transaction():
            return rows(conn, sql, params)
    except psycopg.Error as exc:
        log.warning("search query failed, using fallback: %s", type(exc).__name__)
        return default


def rpc_args(args: Sequence[tuple[str, Any, str]]) -> tuple[str, list[Any]]:
    """Named-argument list `name := %s::type, ...` for a function call.

    `args` holds (name, value, pg type). Names and types come from code only, never input.
    Callers omit an argument entirely to get the function default (supabase-js `undefined`).
    """
    parts = [f"{name} := %s::{pgtype}" for name, _value, pgtype in args]
    return ", ".join(parts), [value for _name, value, _t in args]


def js_number(value: Any) -> float:
    """JavaScript `Number(value)` for JSON input (missing → NaN, null → 0)."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0.0
        try:
            return float(text)
        except ValueError:
            return math.nan
    return math.nan


# --- site-wide indexing switch (was surfaces.search.site_indexing) ---

# exp_index_config key read by exp_index_enabled(); seeded 'false' by migration 0024.
SITE_INDEXING_KEY = "site_indexing_enabled"

_TTL_S = 60.0
_cache: dict[str, Any] | None = None


def parse_indexing_enabled(value: Any) -> bool:
    """Same rule as exp_index_enabled(): only the literal 'true' turns indexing on."""
    if value is True:
        return True
    return isinstance(value, str) and value.strip().lower() == "true"


def reset_site_indexing_cache() -> None:
    global _cache
    _cache = None



def load_site_indexing_enabled() -> bool:
    """exp_index_enabled() as anon, cached 60s per process. Any error → OFF."""
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache["at"] < _TTL_S:
        return bool(_cache["value"])
    value = False
    try:
        with role_connection("anon") as conn:
            row = conn.execute("select public.exp_index_enabled() as enabled").fetchone()
        value = parse_indexing_enabled(row["enabled"] if row else None)
    except Exception as exc:  # noqa: BLE001 — any failure reads as OFF (legacy behaviour)
        log.warning("exp_index_enabled read failed, treating as OFF: %s", type(exc).__name__)
        value = False
    _cache = {"value": value, "at": now}
    return value
