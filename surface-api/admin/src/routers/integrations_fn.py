"""NORA platform integrations admin (port of `lib/integrations.functions.ts`).

Super-admin only (checked server-side). Secret presence is reported as booleans and reference
names only; values never leave the server.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, HTTPException
from psycopg.types.json import Jsonb
from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints
from surfaces.admin.routers.google_workspace_fn import audit, require_super_admin
from surfaces.admin.sqlutil import execute, parse_input

from _base.auth import current_user
from _base.db.session import role_connection
from _base.integrations.catalog import INTEGRATIONS, SECRET_REF_PATTERN
from _base.integrations.status import (
    get_integration_status,
    is_missing_table,
    list_integration_statuses,
)
from _base.server_fn import FnCall, bad_input, fn_router

router = fn_router("admin")


@router.post("/getNoraIntegrations")
def get_nora_integrations(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    require_super_admin(claims)
    return {"integrations": list_integration_statuses()}


def _secret_name(v: str) -> str:
    if not SECRET_REF_PATTERN.match(v):
        raise ValueError("Secret names must be UPPER_SNAKE_CASE")
    return v


SecretName = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=128), AfterValidator(_secret_name)
]
SettingValue = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
IntegrationKey = Literal["google_business_profile", "google_places", "apify"]


class _UpdateIn(BaseModel):
    model_config = ConfigDict(strict=True)
    key: IntegrationKey
    refs: dict[str, SecretName] | None = None
    settings: dict[str, SettingValue] | None = None
    mode: Literal["stub", "live"] | None = None


@router.post("/updateNoraIntegration")
def update_nora_integration(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    """Save secret reference names / settings, or switch stub <-> live.

    Live requires every secret and setting present.
    """
    data = parse_input(_UpdateIn, call.data)
    require_super_admin(claims)
    d = INTEGRATIONS[data.key]
    current = get_integration_status(data.key)
    refs = dict(current["refs"])
    for s in d["secrets"]:
        if data.refs and data.refs.get(s["id"]):
            refs[s["id"]] = data.refs[s["id"]]
    settings = dict(current["settings"])
    for s in d["settings"]:
        if data.settings is not None and s["id"] in data.settings:
            settings[s["id"]] = data.settings[s["id"]]
    mode = data.mode or current["mode"]
    try:
        with role_connection("service_role", write=True) as conn:
            execute(
                conn,
                "insert into exp_integration_settings "
                "(key, secret_refs, settings, mode, updated_by, updated_at) "
                "values (%s, %s, %s, %s, %s, %s) on conflict (key) do update set "
                "secret_refs = excluded.secret_refs, settings = excluded.settings, "
                "mode = excluded.mode, updated_by = excluded.updated_by, "
                "updated_at = excluded.updated_at",
                (data.key, Jsonb(refs), Jsonb(settings), "stub", claims.get("sub"),
                 datetime.now(UTC)),
            )
    except Exception as e:
        if is_missing_table(e):
            raise HTTPException(
                status_code=500,
                detail="Integration settings table is not migrated yet (drizzle migration 0017)",
            ) from e
        raise
    if mode == "live":
        nxt = get_integration_status(data.key)
        if nxt["missing"]:
            raise bad_input(f"Cannot go live — missing {', '.join(nxt['missing'])}")
        with role_connection("service_role", write=True) as conn:
            execute(conn, "update exp_integration_settings set mode = %s where key = %s",
                    ("live", data.key))
    audit(claims, "nora_integration_updated", None,
          {"key": data.key, "refs": refs, "settings": settings, "mode": mode})
    return get_integration_status(data.key)
