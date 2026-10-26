"""runSkill — the NORA skill executor's console entry point (port of
lib/nora-runner.functions.ts).

Checks the caller's console role, then hands off to execute_skill_run
(internal/runner_server.py), which applies the governance envelope, dispatches to the capability
handlers in internal/capabilities.py, and writes exactly one exp_skill_run row per invocation
(including refusals).
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException
from pydantic import ValidationError

from _base.auth import current_user
from _base.server_fn import FnCall, bad_input, fn_router, forbidden
from surfaces.nora_os.internal.capabilities import capability_handlers
from surfaces.nora_os.internal.db import Db, DbError
from surfaces.nora_os.internal.runner_server import execute_skill_run
from surfaces.nora_os.nora_runner.schemas import RunSkillInput

router = fn_router("nora_os")

LIVE_ROLES = frozenset({"super_admin", "architect"})
# Entity-scoped 'owner' grants (written by the claim gate) are not console roles.
NON_CONSOLE_ROLES = frozenset({"owner"})


def parse_run_input(raw: Any) -> RunSkillInput:
    try:
        return RunSkillInput.model_validate(raw)
    except ValidationError as exc:
        raise bad_input(_issues(exc)) from exc


def _issues(exc: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(p) for p in e['loc']) or 'data'}: {e['msg'].removeprefix('Value error, ')}"
        for e in exc.errors()
    )


def run_data(inp: RunSkillInput) -> dict:
    """The parsed input in the shape execute_skill_run reads (the TS `data`)."""
    return {
        "skillKey": inp.skillKey,
        "entityId": inp.entityId,
        "mode": inp.mode,
        "inputs": inp.inputs,
        "trigger": inp.trigger,
        "approval": {"approved": inp.approval.approved, "consent": inp.approval.consent},
    }


@router.post("/runSkill")
def run_skill(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    inp = parse_run_input(call.data)
    user_id = claims["sub"]
    admin = Db("service_role")
    try:
        # Who may run: any console grant for dry runs; super_admin/architect for live.
        grant_rows = admin.rows(
            "select role from exp_control_grants where user_id = %s",
            (user_id,),
            what="exp_control_grants",
        )
        grants = [g for g in grant_rows if g.get("role") not in NON_CONSOLE_ROLES]
        if not grants:
            raise forbidden("Forbidden: no console role")
        if inp.mode == "live" and not any(g.get("role") in LIVE_ROLES for g in grants):
            raise forbidden("Forbidden: live runs require Super Admin or Architect")
        user_db = Db("authenticated", claims)
        return execute_skill_run(
            db=user_db,
            writer=admin,
            actor=user_id,
            data=run_data(inp),
            handlers=capability_handlers(user_db),
        )
    except DbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
