"""Category boundary panel (port of `lib/category-boundary.functions.ts`, 2026-10-16).

Read a category's boundary (exp_category_boundary has RLS with no client policy, so it is read
with the service role) and regenerate a generated one (super admins / architects, checked
server-side). Generation is `_base.disco.boundary` — the same code discovery uses; an authored
boundary is never replaced.
"""
from __future__ import annotations

import os
import re
from typing import Any

import httpx
import psycopg
from fastapi import Depends, HTTPException

from _base.auth import current_user
from _base.db.session import role_connection
from _base.server_fn import FnCall, bad_input, fn_router, forbidden
from surfaces.graph.internal import maybe_one

router = fn_router("graph")

_GCID = re.compile(r"^gcid:[a-z0-9_]+$")


def gcid_of(d: Any) -> str:
    v = d.get("gcid") if isinstance(d, dict) else None
    g = "" if v is None else str(v).strip()
    if not _GCID.match(g):
        raise bad_input("gcid required")
    return g


@router.post("/getCategoryBoundary")
def get_category_boundary(call: FnCall, claims: dict = Depends(current_user)) -> dict | None:
    gcid = gcid_of(call.data)
    with role_connection("service_role") as conn:
        return maybe_one(
            conn,
            "select gcid, definition, includes, excludes, subtypes, source, updated_at "
            "from exp_category_boundary where gcid = %s",
            (gcid,),
        )


def _has_role(claims: dict, roles: list[str]) -> bool:
    try:
        with role_connection("authenticated", claims) as conn:
            row = maybe_one(conn, "select exp_ctrl_has_role(p_roles := %s) as ok", (roles,))
    except (psycopg.Error, ValueError):
        return False
    return bool(row) and row.get("ok") is True


def anthropic_tool_call(api_key: str, model: str, prompt: str, tool: dict) -> dict:
    """One forced tool_use call; notes token usage for the ETL cost log."""
    from _base.disco.ai_cost import note_ai_usage

    res = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": model, "max_tokens": 2048, "tools": [tool],
              "tool_choice": {"type": "tool", "name": tool["name"]},
              "messages": [{"role": "user", "content": prompt}]},
        timeout=300.0,
    )
    if not res.is_success:
        raise RuntimeError(f"anthropic {res.status_code}: {res.text[:300]}")
    j = res.json()
    note_ai_usage(model=str(j.get("model") or model), usage=j.get("usage"), tool=tool["name"],
                  activity="boundary")
    block = next((b for b in j.get("content") or [] if (b or {}).get("type") == "tool_use"), None)
    if not block:
        raise RuntimeError("model returned no tool_use block")
    return block.get("input") or {}


@router.post("/regenerateCategoryBoundary")
def regenerate_category_boundary(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    gcid = gcid_of(call.data)
    if not _has_role(claims, ["super_admin", "architect"]):
        raise forbidden("insufficient_privilege")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    model = os.environ.get("DISCO_MODEL") or "claude-sonnet-4-6"
    # Imported lazily: the shared disco library is ported separately.
    from _base.disco.ai_cost import CostContext, with_cost_context
    from _base.disco.boundary import generate_category_boundary

    def ask(prompt: str, tool: dict) -> dict:
        return anthropic_tool_call(api_key, model, prompt, tool)

    # Fix (ETL AI cost log, 2026-10-22): "Generate now" / Regenerate is logged as 'boundary'.
    # Cost rows are written on their own connection so they survive a failed generation.
    ctx = CostContext(db=lambda: role_connection("service_role", write=True),
                      activity="boundary", gcid=gcid)
    with role_connection("service_role", write=True) as conn:
        r = with_cost_context(
            ctx,
            lambda: generate_category_boundary(conn, model, gcid, ask, regenerate=True),
        )
    return {"saved": r["saved"], "reason": r["reason"]}
