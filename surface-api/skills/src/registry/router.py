"""NORA registry + sandbox data — replaces the direct supabase-js calls in
surface-ui/_base/src/lib/nora-registry.ts and nora-sandbox.ts.

Every endpoint runs as the signed-in user (the registry and sandbox tabs render only for signed-in
staff), so RLS decides exactly as it did for the browser. The writes are the browser's own
statements: each request model allow-lists the table's columns, and only the keys sent are
written (as PostgREST did).
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.skills.registry import sandbox as sbx
from surfaces.skills.registry import services as reg
from surfaces.skills.registry.schemas import (
    NoraBuildStepNew,
    NoraBuildStepPatch,
    NoraCapability,
    NoraEval,
    NoraEvalResult,
    NoraFeedback,
    NoraSkill,
    NoraSkillRelease,
    NoraWeight,
)

router = APIRouter(prefix="/skills", tags=["skills"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except reg.NotOneRow as exc:  # PostgREST answered `.single()`/`.maybeSingle()` with 406
        raise HTTPException(status.HTTP_406_NOT_ACCEPTABLE, str(exc)) from exc
    except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


def _write_with(claims: dict, fn, *args) -> Any:
    with db.role_connection("authenticated", claims, write=True) as conn:
        out = _guard(fn, conn, *args)
    return {"ok": True} if out is None else out


# --- skills ----------------------------------------------------------------------------------

@router.get("/registry/skills")
def list_skills(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, reg.list_skills)


@router.get("/registry/skills/{key}")
def get_skill(key: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, reg.get_skill, key)


@router.post("/registry/skills")
def create_skill(body: NoraSkill, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.insert_row, reg.skills, body.sent())


@router.patch("/registry/skills/{skill_id}")
def update_skill(skill_id: str, body: NoraSkill, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.update_row, reg.skills, skill_id, body.sent())


@router.post("/registry/skills/release")
def release_skill(body: NoraSkillRelease, claims: dict = Depends(current_user)) -> dict:
    uid = claims.get("sub") or None
    return _write_with(claims, reg.release_skill, body.id, body.skill.sent(), body.release, uid,
                       body.note, body.release == "yanked")


# --- capabilities ----------------------------------------------------------------------------

@router.get("/registry/capabilities")
def list_capabilities(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, reg.list_capabilities)


@router.get("/registry/capabilities/{key}")
def get_capability(key: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, reg.get_capability, key)


@router.post("/registry/capabilities")
def create_capability(body: NoraCapability, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.insert_row, reg.caps, body.sent())


@router.patch("/registry/capabilities/{cap_id}")
def update_capability(cap_id: str, body: NoraCapability,
                      claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.update_row, reg.caps, cap_id, body.sent())


# --- build map -------------------------------------------------------------------------------

@router.get("/registry/build-map")
def list_build_map(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, reg.list_build_map)


@router.patch("/registry/build-map/{step_id}")
def update_build_step(step_id: str, body: NoraBuildStepPatch,
                      claims: dict = Depends(current_user)) -> dict:
    """setBuildState and updateBuildStep: the sent columns."""
    return _write_with(claims, reg.patch_by_id, reg.build, step_id, body.sent())


@router.post("/registry/build-map")
def add_build_step(body: NoraBuildStepNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.insert_row, reg.build, body.sent())


# --- evals, versions, runs -------------------------------------------------------------------

@router.get("/registry/evals")
def list_evals(skill_key: str | None = Query(None, max_length=500),
               claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, reg.list_evals, skill_key)


@router.post("/registry/evals")
def create_eval(body: NoraEval, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.insert_row, reg.evals, body.sent())


@router.patch("/registry/evals/{eval_id}")
def update_eval(eval_id: str, body: NoraEval, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.update_row, reg.evals, eval_id, body.sent())


@router.post("/registry/evals/{eval_id}/result")
def set_eval_result(eval_id: str, body: NoraEvalResult,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, reg.set_eval_result, eval_id, body.status)


@router.get("/registry/versions")
def list_versions(skill_key: str = Query(max_length=500),
                  claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, reg.list_versions, skill_key)


@router.get("/registry/skill-runs")
def list_skill_runs(limit: int = Query(100, ge=0),
                    claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, reg.list_skill_runs, limit)


# --- sandbox ---------------------------------------------------------------------------------

@router.get("/sandbox/entities")
def sandbox_entities(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, sbx.list_entities)


@router.get("/sandbox/entities/{entity_ref}")
def sandbox_state(entity_ref: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, sbx.get_state, entity_ref)


@router.get("/sandbox/weights")
def sandbox_weights(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, sbx.list_weights)


@router.put("/sandbox/weights/{key}")
def save_weight(key: str, body: NoraWeight, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, sbx.save_weight, key, body.weight)


@router.get("/sandbox/feedback")
def sandbox_feedback(entity_id: str = Query(max_length=500),
                     claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, sbx.list_feedback, entity_id)


@router.post("/sandbox/feedback")
def give_feedback(body: NoraFeedback, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, sbx.give_feedback, body.sent())


@router.get("/sandbox/scored")
def scored_entities(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, sbx.list_scored)


@router.get("/sandbox/scores/{ref}")
def sandbox_score(ref: str, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, sbx.get_score, ref)
