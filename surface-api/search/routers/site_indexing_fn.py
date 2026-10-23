"""Server functions from legacy `lib/site-indexing.functions.ts`.

`getSiteIndexing` is public and returns only the boolean. `setSiteIndexing` is super admin
only and writes the one exp_index_config key through the caller's session (RLS applies).
Turning indexing on is a gated, human-approved release decision (AGENTS.md §3); this port
only carries the existing capability across and changes no flag.
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
from search import site_indexing
from search.pg import rows

log = logging.getLogger(__name__)
router = fn_router("search")


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


@router.post("/getSiteIndexing")
def get_site_indexing(call: FnCall) -> dict:
    return {"enabled": site_indexing.load_site_indexing_enabled()}


@router.post("/setSiteIndexing")
def set_site_indexing(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    try:
        data = SetInput.model_validate(call.data)
    except ValidationError as exc:
        raise bad_input("enabled: expected boolean") from exc
    with role_connection("authenticated", claims, write=True) as conn:
        require_super_admin(conn)
        rows(
            conn,
            "insert into exp_index_config (key, value, updated_at) values (%s, %s, %s) "
            "on conflict (key) do update set value = excluded.value, "
            "updated_at = excluded.updated_at returning key",
            [
                site_indexing.SITE_INDEXING_KEY,
                "true" if data.enabled else "false",
                datetime.now(UTC),
            ],
        )
        _audit(
            conn,
            claims["sub"],
            "site_indexing_enabled" if data.enabled else "site_indexing_disabled",
            {site_indexing.SITE_INDEXING_KEY: data.enabled},
        )
    # After commit, so this process's next read sees the new value.
    site_indexing.reset_site_indexing_cache()
    return {"enabled": data.enabled}
