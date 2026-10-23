import {
  buildRunRow,
  dispatchCapabilities,
  evaluateGovernance,
  governanceTrace,
  runTelemetry,
  type EntitlementRow,
  type GovCapability,
  type GovSkill,
  type HandlerRegistry,
  type RunEntity,
  type RunMode,
  type RunTrigger,
  type SkillRun,
  type TraceStep,
  type Verdict,
} from "@/lib/nora-runner";
import type { TraceLevel } from "@/lib/nora-sandbox";

/*
 * Server-only core of the NORA skill executor, shared by every entry point:
 *  - runSkill (nora-runner.functions.ts) — the console; checks console roles first.
 *  - the claim gate (claim.functions.ts) — claimant-initiated runs of the claim_* skills.
 * Loads the skill + its capabilities from the registry, applies the governance envelope
 * deterministically BEFORE executing, dispatches to the capability handlers, and writes
 * exactly one exp_skill_run row per invocation (including refusals). dry_run never calls a
 * capability with side effects; live refuses when any gate fails. Authorization of WHO may
 * run is the caller's job; this function trusts its arguments.
 */

export type ExecuteRunInput = {
  skillKey: string;
  entityId?: string | null;
  mode: RunMode;
  inputs: Record<string, unknown>;
  trigger: RunTrigger;
  approval: { approved: boolean; consent: boolean };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_HOPS = 6;
const SKILL_COLS =
  "key,status,is_active,version,entity_types,tools_used,autonomy,model_tier,reads_state,requires_entitlement,charges_money,captures_consent,requires_user_approval,expected_srs_lift,value_prop,price_ref,offer_expected_points,trial_eligible,graph_writes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function must<T>(
  res: { data: T | null; error: { message: string } | null },
  what: string,
): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Resolve an entity ref: real SRS first (matches the Sandbox), then exp_entity, professionals, organizations, then synthetic exp_nora_state. */
async function resolveEntity(db: Db, ref: string): Promise<RunEntity | null> {
  if (UUID.test(ref)) {
    const srs = must<{ entity_type: string; gcid: string | null; local_market: string | null }>(
      await db
        .from("search_rank_scores")
        .select("entity_type,gcid,local_market")
        .eq("entity_id", ref)
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "search_rank_scores",
    );
    const ent = must<{ entity_type: string; display_name: string | null }>(
      await db
        .from("exp_entity")
        .select("entity_type,display_name")
        .eq("entity_id", ref)
        .maybeSingle(),
      "exp_entity",
    );
    if (srs || ent)
      return {
        ref,
        type: srs?.entity_type ?? ent?.entity_type ?? null,
        name: ent?.display_name ?? null,
        gcid: srs?.gcid ?? null,
        market: srs?.local_market ?? null,
        source: srs ? "search_rank_scores" : "exp_entity",
      };
    const pro = must<{ display_name: string | null; gcid: string | null }>(
      await db.from("professionals").select("display_name,gcid").eq("id", ref).maybeSingle(),
      "professionals",
    );
    if (pro)
      return {
        ref,
        type: "professional",
        name: pro.display_name,
        gcid: pro.gcid,
        source: "professionals",
      };
    const org = must<{ name: string | null; gcid: string | null }>(
      await db.from("organizations").select("name,gcid").eq("id", ref).maybeSingle(),
      "organizations",
    );
    if (org)
      return { ref, type: "organization", name: org.name, gcid: org.gcid, source: "organizations" };
  }
  const syn = must<{
    entity_type: string | null;
    name: string | null;
    category: string | null;
    market: string | null;
  }>(
    await db
      .from("exp_nora_state")
      .select("entity_type,name,category,market")
      .eq("entity_ref", ref)
      .maybeSingle(),
    "exp_nora_state",
  );
  return syn
    ? {
        ref,
        type: syn.entity_type,
        name: syn.name,
        gcid: syn.category,
        market: syn.market,
        source: "exp_nora_state (synthetic)",
      }
    : null;
}

/** Subjects whose entitlements cover the entity: itself, plus its org chain (professional → primary org → parents). */
async function entitlementSubjects(db: Db, entity: RunEntity): Promise<string[]> {
  const subjects = [entity.ref];
  if (!UUID.test(entity.ref)) return subjects;
  let org: string | null = null;
  if (entity.type === "professional") {
    const p = must<{ primary_org_id: string | null }>(
      await db.from("professionals").select("primary_org_id").eq("id", entity.ref).maybeSingle(),
      "professionals",
    );
    org = p?.primary_org_id ?? null;
  } else org = entity.ref;
  for (let hop = 0; org && hop < ORG_HOPS; hop++) {
    if (!subjects.includes(org)) subjects.push(org);
    const o = must<{ parent_org_id: string | null }>(
      await db.from("organizations").select("parent_org_id").eq("id", org).maybeSingle(),
      "organizations",
    );
    org = o?.parent_org_id ?? null;
  }
  return subjects;
}

/** Execute one skill run and persist its exp_skill_run row. `db` reads; `writer` (service role) inserts the row. */
export async function executeSkillRun(a: {
  db: Db;
  writer: Db;
  actor: string | null;
  data: ExecuteRunInput;
  handlers: HandlerRegistry;
}): Promise<SkillRun> {
  const { db, data } = a;
  const clock = () => Date.now();
  const startedAt = new Date();
  const t0 = clock();
  const steps: TraceStep[] = [];
  const trace = (level: TraceLevel, text: string, extra?: Partial<TraceStep>) =>
    steps.push({ step: steps.length + 1, level, text, ...extra });

  // OBSERVE — load registry, entity, entitlements.
  const skill = must<GovSkill>(
    await db.from("exp_skill_registry").select(SKILL_COLS).eq("key", data.skillKey).maybeSingle(),
    "exp_skill_registry",
  );
  const toolKeys = (skill?.tools_used ?? []).filter((t) => t && t !== "none");
  const capabilities = toolKeys.length
    ? (must<GovCapability[]>(
        await db
          .from("exp_capability_registry")
          .select("key,status,entitlement_required,side_effects,dry_run")
          .in("key", toolKeys),
        "exp_capability_registry",
      ) ?? [])
    : [];
  const entityRef = data.entityId ?? null;
  const entity = entityRef ? await resolveEntity(db, entityRef) : null;
  let entitlements: EntitlementRow[] = [];
  if (entity) {
    const subjects = await entitlementSubjects(db, entity);
    entitlements =
      must<EntitlementRow[]>(
        await db
          .from("exp_entitlements")
          .select("product_key,state,expires_at,subject_type,subject_id")
          .in("subject_id", subjects),
        "exp_entitlements",
      ) ?? [];
    trace(
      "read",
      `entity ${entity.name ?? entity.ref} · ${entity.type ?? "unknown"} · via ${entity.source} · entitlement subjects ${subjects.length}`,
    );
  }
  const msLoad = clock() - t0;

  // EVALUATE — governance envelope, before anything executes.
  const handlers = a.handlers;
  const tg = clock();
  const gov = evaluateGovernance({
    mode: data.mode,
    trigger: data.trigger,
    skillKey: data.skillKey,
    skill,
    capabilities,
    entityRequested: !!entityRef,
    entity,
    entitlements,
    approval: data.approval,
    implemented: Object.keys(handlers),
  });
  trace(
    "plan",
    `run ${data.skillKey} · ${data.mode} · trigger ${data.trigger} · ${gov.compliance} · ${gov.commercial}`,
  );
  for (const l of governanceTrace(gov, data.mode)) trace(l.level, l.text);
  const msGov = clock() - tg;

  // ACT — dispatch only when the envelope allows it.
  let verdict: Verdict;
  let outputs: Record<string, unknown> = {};
  let graphWrites: unknown[] = [];
  let error: string | null = null;
  let dispatchSteps: { capability: string; ms: number; ran: boolean }[] = [];
  const te = clock();
  const pre = gov.preVerdict;
  const dispatch =
    data.mode === "live"
      ? pre === "execute"
      : pre === "would_execute" || pre === "not_implemented";
  if (dispatch) {
    // Dry run previews read-only capabilities even when others are unimplemented;
    // live only reaches here when every gate is open and every capability is implemented.
    const runnable =
      pre === "not_implemented"
        ? gov.capabilityKeys.filter((k) => !gov.unimplemented.includes(k))
        : gov.capabilityKeys;
    for (const k of gov.unimplemented)
      trace("warn", `${k} — not implemented; nothing faked`, { capability: k });
    try {
      const r = await dispatchCapabilities({
        mode: data.mode,
        capabilityKeys: runnable,
        capabilities,
        handlers,
        entity,
        inputs: data.inputs,
        actor: a.actor,
        trace,
        clock,
      });
      outputs = r.outputs;
      graphWrites = r.graph_writes;
      dispatchSteps = r.steps;
      error = r.error;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      trace("error", `dispatch failed: ${error}`);
    }
    verdict = error ? "failed" : pre === "execute" ? "executed" : pre;
    const declared = skill?.graph_writes ?? [];
    if (verdict === "executed" && declared.length && !graphWrites.length)
      trace(
        "warn",
        `declared graph writes [${declared.join(", ")}] — no capability in this run persisted them`,
      );
  } else {
    if (pre === "execute") throw new Error("runner invariant: open envelope was not dispatched");
    verdict = pre;
  }
  const msExec = clock() - te;

  trace(
    verdict === "failed" || verdict === "blocked"
      ? "error"
      : verdict === "executed" || verdict === "would_execute"
        ? "plan"
        : "warn",
    `verdict ${verdict}`,
  );

  const finishedAt = new Date();
  const row = buildRunRow({
    skillKey: data.skillKey,
    skill,
    capabilityKeys: gov.capabilityKeys,
    entity,
    entityRef,
    mode: data.mode,
    trigger: data.trigger,
    verdict,
    trace: steps,
    inputs: { ...data.inputs, _approval: data.approval },
    outputs: {
      capabilities: outputs,
      governance: {
        compliance: gov.compliance,
        commercial: gov.commercial,
        gates: gov.gates,
        live_blockers: gov.liveBlockers,
        live_ready: gov.liveBlockers.length === 0 && gov.unimplemented.length === 0 && !gov.pitch,
      },
      unimplemented: gov.unimplemented,
      ...(gov.pitch ? { pitch: gov.pitch } : {}),
    },
    telemetry: runTelemetry(
      skill,
      { ms_total: clock() - t0, ms_load: msLoad, ms_governance: msGov, ms_execution: msExec },
      dispatchSteps,
    ),
    graphWrites,
    error,
    actor: a.actor,
    startedAt,
    finishedAt,
  });

  // Server writes use the service role (see the exp_skill_run migration header).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ins = await (a.writer as any).from("exp_skill_run").insert(row).select("*").single();
  if (ins.error) throw new Error(`exp_skill_run: ${ins.error.message}`);
  return ins.data as SkillRun;
}
