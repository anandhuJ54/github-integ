"""Server function from legacy `lib/site-indexing.functions.ts`: the super-admin write.

`setSiteIndexing` is super admin only and writes the one exp_index_config key through the
caller's session (RLS applies). Turning indexing on is a gated, human-approved release decision
(AGENTS.md §3); this port only carries the existing capability across and changes no flag.
Moved from the search Surface (was /search/fn/setSiteIndexing), surface audit 2026-10-25; the
public read getSiteIndexing stays in search. After commit it emits SITE_INDEXING_CHANGED so the
search Surface's cached reader on this process sees the new value (no cross-Surface import).
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

import psycopg
from fastapi import Depends
from pydantic import BaseModel, ConfigDict, ValidationError

from _base.core.auth import current_user
from _base.core.db import role_connection
from _base.core.server_fn import FnCall, bad_input, fn_router, forbidden

log = logging.getLogger(__name__)
router = fn_router("admin")

# exp_index_config key read by exp_index_enabled(); seeded 'false' by migration 0024.
SITE_INDEXING_KEY = "site_indexing_enabled"


class SetInput(BaseModel):
    model_config = ConfigDict(strict=True)
    enabled: bool


def require_super_admin(conn: Any) -> None:
    """exp_ctrl_has_role(['super_admin']) as the caller; anything but true is refused."""
    try:
        with conn.transaction():
            row = conn.execute(
                "select public.exp_ctrl_has_role(p_roles := %s::text[]) as ok", [["super_admin"]]
            ).fetchone()
    except psycopg.Error:
        row = None
    if not row or row.get("ok") is not True:
        raise forbidden("Super admin required")


def _audit(conn: Any, user_id: str, action: str, changes: dict) -> None:
    """audit_log insert (legacy `audit()` ignored its result)."""
    try:
        with conn.transaction():
            conn.execute(
                "insert into audit_log (user_id, action, entity_type, entity_id, field_changes) "
                "values (%s, %s, 'integration', null, %s::jsonb)",
                [user_id, action, json.dumps(changes)],
            )
    except psycopg.Error as exc:
        log.warning("audit_log insert failed: %s", type(exc).__name__)


@router.post("/setSiteIndexing")
def set_site_indexing(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    try:
        data = SetInput.model_validate(call.data)
    except ValidationError as exc:
        raise bad_input("enabled: expected boolean") from exc
    with role_connection("authenticated", claims, write=True) as conn:
        require_super_admin(conn)
        conn.execute(
            "insert into exp_index_config (key, value, updated_at) values (%s, %s, %s) "
            "on conflict (key) do update set value = excluded.value, "
            "updated_at = excluded.updated_at returning key",
            [SITE_INDEXING_KEY, "true" if data.enabled else "false", datetime.now(UTC)],
        ).fetchall()
        _audit(
            conn,
            claims["sub"],
            "site_indexing_enabled" if data.enabled else "site_indexing_disabled",
            {SITE_INDEXING_KEY: data.enabled},
        )
    # search's getSiteIndexing caches the flag for up to 60 s per worker, so readers see the
    # change within a minute (surface audit 2026-10-25: no cross-Surface cache reset).
    return {"enabled": data.enabled}
