"""Server-only core of the NORA skill executor (port of lib/nora-runner.server.ts).

Shared by every entry point:
 - runSkill (routers/nora_runner_fn.py) — the console; checks console roles first.
 - the claim gate (routers/claim_fn.py) — claimant-initiated runs of the claim_* skills.
Loads the skill + its capabilities from the registry, applies the governance envelope
deterministically BEFORE executing, dispatches to the capability handlers, and writes exactly
one exp_skill_run row per invocation (including refusals). dry_run never calls a capability with
side effects; live refuses when any gate fails. Authorization of WHO may run is the caller's
job; this function trusts its arguments.
"""
from __future__ import annotations

import datetime as _dt
import math
import re
from typing import Any

from surfaces.nora_os.db import Db, DbError, as_jsonb
from surfaces.nora_os.jsutil import js_numbers, message, now_ms, nz
from surfaces.nora_os.runner import (
    SKILL_RUN_COLUMNS,
    HandlerRegistry,
    RunEntity,
    build_run_row,
    dispatch_capabilities,
    evaluate_governance,
    governance_trace,
    run_telemetry,
)

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
ORG_HOPS = 6
SKILL_COLS = (
    "key,status,is_active,version,entity_types,tools_used,autonomy,model_tier,reads_state,"
    "requires_entitlement,charges_money,captures_consent,requires_user_approval,"
    "expected_srs_lift,value_prop,price_ref,offer_expected_points,trial_eligible,graph_writes"
)
_JSON_COLS = frozenset({"trace", "inputs", "outputs", "telemetry", "graph_writes"})


def is_uuid(v: Any) -> bool:
    return isinstance(v, str) and bool(UUID_RE.match(v))


def resolve_entity(db: Db, ref: str) -> RunEntity | None:
    """Real SRS first (matches the Sandbox), then exp_entity, professionals, organizations,
    then synthetic exp_nora_state."""
    if is_uuid(ref):
        srs = db.maybe_one(
            "select entity_type, gcid, local_market from search_rank_scores"
            " where entity_id = %s order by calculated_at desc nulls first limit 1",
            (ref,),
            what="search_rank_scores",
        )
        ent = db.maybe_one(
            "select entity_type, display_name from exp_entity where entity_id = %s",
            (ref,),
            what="exp_entity",
        )
        if srs or ent:
            return RunEntity(
                ref=ref,
                type=nz((srs or {}).get("entity_type"), (ent or {}).get("entity_type")),
                name=(ent or {}).get("display_name"),
                gcid=(srs or {}).get("gcid"),
                market=(srs or {}).get("local_market"),
                source="search_rank_scores" if srs else "exp_entity",
            )
        pro = db.maybe_one(
            "select display_name, gcid from professionals where id = %s",
            (ref,),
            what="professionals",
        )
        if pro:
            return RunEntity(
                ref=ref,
                type="professional",
                name=pro.get("display_name"),
                gcid=pro.get("gcid"),
                source="professionals",
            )
        org = db.maybe_one(
            "select name, gcid from organizations where id = %s", (ref,), what="organizations"
        )
        if org:
            return RunEntity(
                ref=ref,
                type="organization",
                name=org.get("name"),
                gcid=org.get("gcid"),
                source="organizations",
            )
    syn = db.maybe_one(
        "select entity_type, name, category, market from exp_nora_state where entity_ref = %s",
        (ref,),
        what="exp_nora_state",
    )
    if not syn:
        return None
    return RunEntity(
        ref=ref,
        type=syn.get("entity_type"),
        name=syn.get("name"),
        gcid=syn.get("category"),
        market=syn.get("market"),
        source="exp_nora_state (synthetic)",
    )


def entitlement_subjects(db: Db, entity: RunEntity) -> list[str]:
    """The entity itself, plus its org chain (professional → primary org → parents)."""
    subjects = [entity.ref]
    if not is_uuid(entity.ref):
        return subjects
    org: str | None
    if entity.type == "professional":
        p = db.maybe_one(
            "select primary_org_id from professionals where id = %s",
            (entity.ref,),
            what="professionals",
        )
        org = (p or {}).get("primary_org_id")
    else:
        org = entity.ref
    hop = 0
    while org and hop < ORG_HOPS:
        if org not in subjects:
            subjects.append(org)
        o = db.maybe_one(
            "select parent_org_id from organizations where id = %s", (org,), what="organizations"
        )
        org = (o or {}).get("parent_org_id")
        hop += 1
    return subjects


def _clock() -> int:
    return math.floor(now_ms())


def execute_skill_run(
    *,
    db: Db,
    writer: Db,
    actor: str | None,
    data: dict[str, Any],
    handlers: HandlerRegistry,
) -> dict:
    """Execute one skill run and persist its exp_skill_run row.

    `db` reads; `writer` (service role) inserts the row. `data` holds skillKey, entityId, mode,
    inputs, trigger, approval (the parsed runSkill input).
    """
    skill_key: str = data["skillKey"]
    mode: str = data["mode"]
    trigger: str = data["trigger"]
    inputs: dict = data["inputs"]
    approval: dict = data["approval"]
    started_at = _dt.datetime.now(_dt.UTC)
    t0 = _clock()
    steps: list[dict] = []

    def trace(level: str, text: str, extra: dict | None = None) -> None:
        steps.append({"step": len(steps) + 1, "level": level, "text": text, **(extra or {})})

    # OBSERVE — load registry, entity, entitlements.
    skill = db.maybe_one(
        f"select {SKILL_COLS} from exp_skill_registry where key = %s",
        (skill_key,),
        what="exp_skill_registry",
    )
    tool_keys = [t for t in ((skill or {}).get("tools_used") or []) if t and t != "none"]
    capabilities = (
        db.rows(
            "select key, status, entitlement_required, side_effects, dry_run"
            " from exp_capability_registry where key = any(%s::text[])",
            (tool_keys,),
            what="exp_capability_registry",
        )
        if tool_keys
        else []
    )
    entity_ref = data.get("entityId")
    entity = resolve_entity(db, entity_ref) if entity_ref else None
    entitlements: list[dict] = []
    if entity:
        subjects = entitlement_subjects(db, entity)
        entitlements = db.rows(
            "select product_key, state, expires_at, subject_type, subject_id"
            " from exp_entitlements where subject_id::text = any(%s::text[])",
            (subjects,),
            what="exp_entitlements",
        )
        trace(
            "read",
            f"entity {nz(entity.name, entity.ref)} · {nz(entity.type, 'unknown')} · via "
            f"{entity.source} · entitlement subjects {len(subjects)}",
        )
    ms_load = _clock() - t0

    # EVALUATE — governance envelope, before anything executes.
    tg = _clock()
    gov = evaluate_governance(
        mode=mode,
        trigger=trigger,
        skill_key=skill_key,
        skill=skill,
        capabilities=capabilities,
        entity_requested=bool(entity_ref),
        entity=entity,
        entitlements=entitlements,
        approval=approval,
        implemented=list(handlers.keys()),
    )
    trace("plan", f"run {skill_key} · {mode} · trigger {trigger} · {gov.compliance} · {gov.commercial}")
    for line in governance_trace(gov, mode):
        trace(line["level"], line["text"])
    ms_gov = _clock() - tg

    # ACT — dispatch only when the envelope allows it.
    outputs: dict[str, Any] = {}
    graph_writes: list[Any] = []
    error: str | None = None
    dispatch_steps: list[dict] = []
    te = _clock()
    pre = gov.pre_verdict
    dispatch = pre == "execute" if mode == "live" else pre in ("would_execute", "not_implemented")
    if dispatch:
        # Dry run previews read-only capabilities even when others are unimplemented;
        # live only reaches here when every gate is open and every capability is implemented.
        runnable = (
            [k for k in gov.capability_keys if k not in gov.unimplemented]
            if pre == "not_implemented"
            else gov.capability_keys
        )
        for k in gov.unimplemented:
            trace("warn", f"{k} — not implemented; nothing faked", {"capability": k})
        try:
            r = dispatch_capabilities(
                mode=mode,
                capability_keys=runnable,
                capabilities=capabilities,
                handlers=handlers,
                entity=entity,
                inputs=inputs,
                actor=actor,
                trace=trace,
                clock=_clock,
            )
            outputs = r["outputs"]
            graph_writes = r["graph_writes"]
            dispatch_steps = r["steps"]
            error = r["error"]
        except Exception as exc:  # noqa: BLE001
            error = message(exc)
            trace("error", f"dispatch failed: {error}")
        verdict = "failed" if error else ("executed" if pre == "execute" else pre)
        declared = (skill or {}).get("graph_writes") or []
        if verdict == "executed" and declared and not graph_writes:
            trace(
                "warn",
                f"declared graph writes [{', '.join(declared)}] — no capability in this run "
                "persisted them",
            )
    else:
        if pre == "execute":
            raise RuntimeError("runner invariant: open envelope was not dispatched")
        verdict = pre
    ms_exec = _clock() - te

    if verdict in ("failed", "blocked"):
        level = "error"
    elif verdict in ("executed", "would_execute"):
        level = "plan"
    else:
        level = "warn"
    trace(level, f"verdict {verdict}")

    finished_at = _dt.datetime.now(_dt.UTC)
    run_outputs: dict[str, Any] = {
        "capabilities": outputs,
        "governance": {
            "compliance": gov.compliance,
            "commercial": gov.commercial,
            "gates": [g.as_json() for g in gov.gates],
            "live_blockers": gov.live_blockers,
            "live_ready": not gov.live_blockers and not gov.unimplemented and not gov.pitch,
        },
        "unimplemented": gov.unimplemented,
    }
    if gov.pitch:
        run_outputs["pitch"] = gov.pitch
    row = build_run_row(
        skill_key=skill_key,
        skill=skill,
        capability_keys=gov.capability_keys,
        entity=entity,
        entity_ref=entity_ref,
        mode=mode,
        trigger=trigger,
        verdict=verdict,
        trace=steps,
        inputs={**inputs, "_approval": approval},
        outputs=run_outputs,
        telemetry=run_telemetry(
            skill,
            {
                "ms_total": _clock() - t0,
                "ms_load": ms_load,
                "ms_governance": ms_gov,
                "ms_execution": ms_exec,
            },
            dispatch_steps,
        ),
        graph_writes=graph_writes,
        error=error,
        actor=actor,
        started_at=started_at,
        finished_at=finished_at,
    )
    return insert_run_row(writer, row)


def insert_run_row(writer: Db, row: dict) -> dict:
    """Server writes use the service role (see the exp_skill_run migration header)."""
    row = js_numbers(row)
    cols = list(SKILL_RUN_COLUMNS)
    values: list[Any] = []
    marks: list[str] = []
    for c in cols:
        v = row[c]
        if c in _JSON_COLS:
            values.append(as_jsonb(v))
            marks.append("%s")
        elif c == "capability_keys":
            values.append(list(v))
            marks.append("%s::text[]")
        else:
            values.append(v)
            marks.append("%s")
    sql = (
        f"insert into exp_skill_run ({', '.join(cols)}) values ({', '.join(marks)}) returning *"
    )
    rows = writer.write(sql, tuple(values), what="exp_skill_run")
    if len(rows) != 1:
        raise DbError("exp_skill_run: JSON object requested, multiple (or no) rows returned")
    return rows[0]
