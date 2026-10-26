"""Rendered JSON-LD cache (port of `lib/schema-cache.functions.ts`).

Moved from graph (/graph/fn/getCachedSchema|cacheSchema → /search/fn/...), surface audit
2026-10-25: the long-form profile page that uses it is a search page. Same SQL and role.

Like the TS, these have no auth middleware and use the service role. The schema JSON travels as
a string across the call boundary.
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, TypeVar

import psycopg
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, ValidationError

from _base.db.session import role_connection
from _base.server_fn import FnCall, bad_input, fn_router

router = fn_router("search")

M = TypeVar("M", bound=BaseModel)


# --- small SQL helpers (copied from graph/sqlutil.py with the move; no cross-Surface import) ---

def _fetch_all(conn: Any, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def soft_maybe_one(conn: Any, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    """`(await q.maybeSingle()).data` with the error ignored: None on no/many rows or DB error."""
    try:
        with conn.transaction():
            rows = _fetch_all(conn, sql, params)
    except psycopg.Error:
        return None
    return rows[0] if rows and len(rows) == 1 else None


def soft_execute(conn: Any, sql: str, params: Sequence[Any] = ()) -> bool:
    """A write whose `error` the TS ignored: savepoint, False when it failed."""
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(sql, params)
        return True
    except psycopg.Error:
        return False


def parse_input(model: type[M], data: Any) -> M:
    """zod `.parse` -> 400 with the validation messages."""
    try:
        return model.model_validate(data)
    except ValidationError as e:
        msgs = "; ".join(
            f"{'.'.join(str(p) for p in err['loc']) or 'data'}: {err['msg']}" for err in e.errors()
        )
        raise bad_input(msgs) from e


class _Key(BaseModel):
    model_config = ConfigDict(strict=True)
    entityType: str
    entityId: str
    pageType: str


class _Put(_Key):
    schemaJson: str
    nodeCount: int | float


def _iso(v: object) -> str | None:
    if v is None:
        return None
    return v.isoformat() if isinstance(v, datetime) else str(v)


@router.post("/getCachedSchema")
def get_cached_schema(call: FnCall) -> dict | None:
    data = parse_input(_Key, call.data)
    with role_connection("service_role") as conn:
        row = soft_maybe_one(
            conn,
            "select schema_json, generated_at, is_valid from schema_cache where entity_type = %s "
            "and entity_id = %s and page_type = %s and is_valid = true",
            (data.entityType, data.entityId, data.pageType),
        )
    if not row:
        return None
    return {
        "schemaJson": json.dumps(row["schema_json"], separators=(",", ":"), ensure_ascii=False),
        "generatedAt": _iso(row.get("generated_at")),
    }


@router.post("/cacheSchema")
def cache_schema(call: FnCall) -> dict:
    data = parse_input(_Put, call.data)
    try:
        parsed = json.loads(data.schemaJson)
    except ValueError as e:
        raise bad_input(f"schemaJson: {e}") from e
    with role_connection("service_role", write=True) as conn:
        soft_execute(  # the TS ignored the upsert's error
            conn,
            "insert into schema_cache (entity_type, entity_id, page_type, schema_json, node_count, "
            "generated_at, invalidated_at, is_valid) values (%s, %s, %s, %s, %s, %s, null, true) "
            "on conflict (entity_type, entity_id, page_type) do update set "
            "schema_json = excluded.schema_json, node_count = excluded.node_count, "
            "generated_at = excluded.generated_at, invalidated_at = null, is_valid = true",
            (data.entityType, data.entityId, data.pageType, Jsonb(parsed), data.nodeCount,
             datetime.now(UTC)),
        )
    return {"ok": True}
