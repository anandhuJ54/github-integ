"""The site-wide indexing switch as the search Surface reads it.

Port of `loadSiteIndexingEnabled` (legacy `lib/sitemap.server.ts`). The srp Surface keeps its
own copy for robots.txt / sitemaps; Surfaces do not import each other's internals. Defaults
OFF; any failure reads as OFF. Nothing here flips the switch on its own. The write
(setSiteIndexing) is in the admin Surface; it emits SITE_INDEXING_CHANGED after commit and the
handler registered below drops this process's cached value (surface audit 2026-10-25).
"""
from __future__ import annotations

import logging
import time
from typing import Any

from _base.core.db import role_connection

log = logging.getLogger(__name__)

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
