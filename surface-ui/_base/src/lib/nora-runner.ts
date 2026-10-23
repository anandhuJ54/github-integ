import { estimateTelemetry, modelLabel, type TraceLevel } from "@v3/ui/lib/nora-sandbox";
import type { Capability, Skill } from "@v3/ui/lib/nora-registry";
import type { Json } from "@v3/ui/integrations/supabase/types";

/*
 * NORA skill runner — the pure half of the executor (docs/nora-os-skills-registry.md §5.7).
 *
 * Every invocation: governance envelope (deterministic, here) → dispatch to capability
 * handlers → one exp_skill_run row. No I/O in this module: the server function
 * (nora-runner.server.ts, via runSkill / the claim gate) loads the registry/entity/entitlements, calls these, and
 * persists the row. That keeps every gate unit-testable (tests/nora-runner.test.ts).
 */

export const RUN_MODES = ["dry_run", "live"] as const;
export type RunMode = (typeof RUN_MODES)[number];
export const RUN_TRIGGERS = ["manual", "scripted", "autonomous"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export type Verdict =
  | "executed"
  | "would_execute"
  | "blocked"
  | "pitch"
  | "not_implemented"
  | "failed";
export type RunStatus = "planned" | "running" | "blocked" | "succeeded" | "failed" | "cancelled";

export type ComplianceClass =
  | "safe-autonomous"
  | "consent-gated"
  | "human-review-required"
  | "restricted";
export type CommercialClass = "free" | "metered" | "paid-unlock";

/** Capability side effects that publish or write content about the entity → restricted class. */
export const PUBLISH_EFFECTS = new Set(["public_publish", "content_write"]);
/** Pseudo tool key some skills declare when they compose no capability. */
export const NO_CAPABILITY = "none";

export type GovSkill = Pick<
  Skill,
  | "key"
  | "status"
  | "is_active"
  | "version"
  | "entity_types"
  | "tools_used"
  | "autonomy"
  | "model_tier"
  | "reads_state"
  | "requires_entitlement"
  | "charges_money"
  | "captures_consent"
  | "requires_user_approval"
  | "expected_srs_lift"
  | "value_prop"
  | "price_ref"
  | "offer_expected_points"
  | "trial_eligible"
  | "graph_writes"
>;
export type GovCapability = Pick<
  Capability,
  "key" | "status" | "entitlement_required" | "side_effects" | "dry_run"
>;
export type EntitlementRow = {
  product_key: string;
  state: string;
  expires_at?: string | null;
  subject_type?: string | null;
  subject_id?: string | null;
};
export type RunEntity = {
  ref: string;
  type: string | null;
  name?: string | null;
  gcid?: string | null;
  market?: string | null;
  source?: string | null;
};
export type Approval = { approved: boolean; consent: boolean };

/**
 * Gate outcome:
 *  pass  — satisfied.
 *  warn  — advisory; never stops a run.
 *  live  — stops a LIVE run; reported (not enforced) in a dry run.
 *  block — stops both modes.
 *  pitch — paid-unlock without entitlement: emit the Ledger pitch instead of executing.
 */
export type GateOutcome = "pass" | "warn" | "live" | "block" | "pitch";
export type Gate = { gate: string; outcome: GateOutcome; detail: string };

export type Pitch = {
  product_key: string;
  value_prop: string | null;
  price_ref: string | null;
  expected_lift: number;
  offer_expected_points: number | null;
  trial_eligible: boolean;
};

export type GovernanceInput = {
  mode: RunMode;
  trigger: RunTrigger;
  skillKey: string;
  skill: GovSkill | null;
  /** Registry rows for the skill's tools_used (missing keys are simply absent). */
  capabilities: GovCapability[];
  /** Was an entity requested by the caller, and did it resolve? */
  entityRequested: boolean;
  entity: RunEntity | null;
  entitlements: EntitlementRow[];
  approval: Approval;
  /** Capability keys that have a handler in code. */
  implemented: Iterable<string>;
  now?: Date;
};

export type Governance = {
  compliance: ComplianceClass;
  commercial: CommercialClass;
  gates: Gate[];
  /** Gate details that stop a live run (block + live outcomes). */
  liveBlockers: string[];
  pitch: Pitch | null;
  /** Declared capability keys (minus the "none" pseudo key). */
  capabilityKeys: string[];
  unimplemented: string[];
  /** Verdict before execution; "execute" means every gate is open and the run may dispatch. */
  preVerdict: Verdict | "execute";
};

const list = (a: string[] | null | undefined) => (a ?? []).filter((x) => !!x);

/** Pure: declared capability keys for a skill (drops the "none" pseudo key, dedupes). */
export function declaredCapabilities(skill: Pick<GovSkill, "tools_used"> | null) {
  return [...new Set(list(skill?.tools_used).filter((t) => t !== NO_CAPABILITY))];
}

/**
 * Pure: compliance class from registry fields (the registry has no explicit column yet).
 * restricted > human-review-required > consent-gated > safe-autonomous.
 */
export function complianceClass(
  skill: Pick<
    GovSkill,
    "autonomy" | "requires_user_approval" | "captures_consent" | "charges_money"
  >,
  caps: Pick<GovCapability, "side_effects">[],
): ComplianceClass {
  if (caps.some((c) => list(c.side_effects).some((e) => PUBLISH_EFFECTS.has(e))))
    return "restricted";
  if (skill.requires_user_approval || (skill.autonomy ?? "approve") !== "auto")
    return "human-review-required";
  if (skill.captures_consent || skill.charges_money) return "consent-gated";
  return "safe-autonomous";
}

/** Pure: commercial class. An entitlement on the skill = paid-unlock; charging money = metered. */
export function commercialClass(
  skill: Pick<GovSkill, "requires_entitlement" | "charges_money">,
): CommercialClass {
  if (skill.requires_entitlement && skill.requires_entitlement.trim()) return "paid-unlock";
  if (skill.charges_money) return "metered";
  return "free";
}

/** Pure: is a product held (active, not expired) by any of the resolved subjects? */
export function entitlementState(
  product: string,
  rows: EntitlementRow[],
  now = new Date(),
): "active" | "entitled_unconfigured" | "expired" | "not_entitled" {
  const mine = rows.filter((r) => r.product_key === product);
  const live = mine.filter(
    (r) => !r.expires_at || new Date(r.expires_at).getTime() > now.getTime(),
  );
  if (live.some((r) => r.state === "active")) return "active";
  if (live.some((r) => r.state === "entitled_unconfigured")) return "entitled_unconfigured";
  if (mine.some((r) => r.state === "active" || r.state === "entitled_unconfigured"))
    return "expired";
  return "not_entitled";
}

/** Pure: the governance envelope. Deterministic; runs before any capability is touched. */
export function evaluateGovernance(input: GovernanceInput): Governance {
  const { mode, trigger, skill, approval } = input;
  const now = input.now ?? new Date();
  const gates: Gate[] = [];
  const add = (gate: string, outcome: GateOutcome, detail: string) =>
    gates.push({ gate, outcome, detail });
  const capKeys = declaredCapabilities(skill);
  const capByKey = new Map(input.capabilities.map((c) => [c.key, c]));
  const caps = capKeys.map((k) => capByKey.get(k)).filter((c): c is GovCapability => !!c);
  const implemented = new Set(input.implemented);

  if (!skill) {
    add("registered", "block", `skill ${input.skillKey} is not registered`);
    return finish(gates, "safe-autonomous", "free", null, capKeys, [], mode);
  }
  const compliance = complianceClass(skill, caps);
  const commercial = commercialClass(skill);
  add("registered", "pass", `skill ${skill.key}@${skill.version ?? "—"}`);

  // 1. Lifecycle
  if (skill.is_active === false) add("active", "block", "skill is inactive");
  const status = skill.status ?? "draft";
  if (status === "deprecated") add("publish_state", "block", "skill is deprecated (yanked)");
  else if (status !== "published")
    add("publish_state", "live", `skill is ${status} — live runs require a published skill`);
  else add("publish_state", "pass", "published");

  // 2. Entity
  const types = list(skill.entity_types);
  if (input.entityRequested && !input.entity) add("entity", "block", "entity not found");
  else if (input.entity) {
    const et = input.entity.type ?? "unknown";
    if (types.length && !types.includes(et))
      add("entity", "block", `skill not valid for ${et} (allows ${types.join(", ")})`);
    else add("entity", "pass", `${et} ${input.entity.ref}`);
  } else if (types.length) add("entity", "live", "no target entity — live runs require one");

  // 3. Capabilities registered + implemented
  const unregistered = capKeys.filter((k) => !capByKey.has(k));
  if (unregistered.length)
    add("capabilities", "block", `capability not registered: ${unregistered.join(", ")}`);
  const deprecated = caps.filter((c) => c.status === "deprecated").map((c) => c.key);
  if (deprecated.length)
    add("capabilities", "block", `capability deprecated: ${deprecated.join(", ")}`);
  const unimplemented = capKeys.filter((k) => capByKey.has(k) && !implemented.has(k));
  if (!unregistered.length && !deprecated.length)
    add(
      "capabilities",
      unimplemented.length ? "warn" : "pass",
      unimplemented.length
        ? `no implementation in code: ${unimplemented.join(", ")}`
        : capKeys.length
          ? `all ${capKeys.length} implemented`
          : "composes no capability",
    );

  // 4. Autonomy gate — autonomous triggers may only run safe-autonomous skills (§5.7.4)
  if (trigger === "autonomous" && compliance !== "safe-autonomous")
    add("autonomy", "block", `autonomous trigger cannot run a ${compliance} skill`);
  else add("autonomy", "pass", `trigger ${trigger} · autonomy ${skill.autonomy ?? "—"}`);

  // 5. Human review
  if (skill.requires_user_approval || (skill.autonomy ?? "approve") !== "auto")
    add(
      "approval",
      approval.approved ? "pass" : "live",
      approval.approved ? "owner approval recorded" : "owner approval required before a live run",
    );

  // 6. Consent
  if (skill.captures_consent || skill.charges_money)
    add(
      "consent",
      approval.consent ? "pass" : "live",
      approval.consent ? "consent recorded" : "consent required before a live run",
    );

  // 7. Compliance (restricted): output must pass the per-category filter before publish.
  if (compliance === "restricted")
    add(
      "compliance",
      "live",
      "restricted — the per-category compliance filter (content_compliance_rules + exp_category_compliance) is not wired into the runner; live publish refused",
    );

  // 8. Dry-run safety: capabilities with side effects are never called in a dry run.
  const effectful = caps.filter((c) => list(c.side_effects).length);
  if (mode === "dry_run" && effectful.length)
    add(
      "side_effects",
      "pass",
      `dry run — will not call: ${effectful.map((c) => `${c.key} [${list(c.side_effects).join(", ")}]`).join("; ")}`,
    );

  // 9. Commercial / entitlement (monetization bridge §5.7.5)
  let pitch: Pitch | null = null;
  const skillProduct = skill.requires_entitlement?.trim() || null;
  const products = new Map<string, string>(); // product → who requires it
  if (skillProduct) products.set(skillProduct, "skill");
  for (const c of caps)
    if (c.entitlement_required?.trim() && !products.has(c.entitlement_required.trim()))
      products.set(c.entitlement_required.trim(), `capability ${c.key}`);
  for (const [product, by] of products) {
    const st = entitlementState(product, input.entitlements, now);
    if (st === "active") {
      add("entitlement", "pass", `${product} active (required by ${by})`);
      continue;
    }
    if (st === "entitled_unconfigured") {
      add("entitlement", "live", `${product} entitled but unconfigured (required by ${by})`);
      continue;
    }
    if (by === "skill" && commercial === "paid-unlock") {
      const lift = Number(skill.expected_srs_lift ?? 0);
      if (lift > 0) {
        pitch = {
          product_key: product,
          value_prop: skill.value_prop ?? null,
          price_ref: skill.price_ref ?? null,
          expected_lift: lift,
          offer_expected_points: skill.offer_expected_points ?? null,
          trial_eligible: !!skill.trial_eligible,
        };
        add(
          "entitlement",
          "pitch",
          `${product} ${st} — paid-unlock: pitch (+${lift} SRS) instead of executing`,
        );
      } else
        add(
          "entitlement",
          "block",
          `${product} ${st} — paid-unlock with no expected lift: integrity rule forbids a pitch`,
        );
      continue;
    }
    add("entitlement", "live", `${product} ${st} (required by ${by})`);
  }
  if (!products.size) add("entitlement", "pass", `${commercial} — no entitlement required`);

  return finish(gates, compliance, commercial, pitch, capKeys, unimplemented, mode);
}

function finish(
  gates: Gate[],
  compliance: ComplianceClass,
  commercial: CommercialClass,
  pitch: Pitch | null,
  capabilityKeys: string[],
  unimplemented: string[],
  mode: RunMode,
): Governance {
  const liveBlockers = gates
    .filter((g) => g.outcome === "block" || g.outcome === "live")
    .map((g) => `${g.gate}: ${g.detail}`);
  return {
    compliance,
    commercial,
    gates,
    liveBlockers,
    pitch,
    capabilityKeys,
    unimplemented,
    preVerdict: resolveVerdict(gates, unimplemented, mode),
  };
}

/**
 * Pure: verdict precedence — blocked > pitch > not_implemented > (dry_run: would_execute |
 * live: execute). Live refuses on any block or live gate.
 */
export function resolveVerdict(
  gates: Pick<Gate, "outcome">[],
  unimplemented: string[],
  mode: RunMode,
): Verdict | "execute" {
  if (gates.some((g) => g.outcome === "block")) return "blocked";
  if (mode === "live" && gates.some((g) => g.outcome === "live")) return "blocked";
  if (gates.some((g) => g.outcome === "pitch")) return "pitch";
  if (unimplemented.length) return "not_implemented";
  return mode === "dry_run" ? "would_execute" : "execute";
}

/** Pure: exp_skill_run.status for a final verdict. */
export function statusFor(v: Verdict): RunStatus {
  if (v === "executed" || v === "would_execute") return "succeeded";
  if (v === "failed") return "failed";
  return "blocked";
}

/* ───────── Capability dispatch ───────── */

export type TraceStep = {
  step: number;
  level: TraceLevel;
  text: string;
  capability?: string;
  ms?: number;
};

export type HandlerContext = {
  mode: RunMode;
  entity: RunEntity | null;
  inputs: Record<string, unknown>;
  /** Outputs of earlier capabilities in this run, keyed by capability key. */
  prior: Record<string, unknown>;
  /** The user the run acts for (exp_skill_run.actor). Never taken from inputs. */
  actor?: string | null;
};
export type HandlerResult = { outputs: Record<string, unknown>; graph_writes?: unknown[] };
export type CapabilityHandler = {
  /** True when the handler only reads. Only read-only handlers run in a dry run. */
  readOnly: boolean;
  run: (ctx: HandlerContext) => Promise<HandlerResult>;
};
export type HandlerRegistry = Record<string, CapabilityHandler>;

export const CAPABILITY_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

export type DispatchResult = {
  outputs: Record<string, unknown>;
  graph_writes: unknown[];
  steps: { capability: string; ms: number; ran: boolean }[];
  error: string | null;
};

/**
 * Runs the skill's capabilities in declared order. Dry run calls a handler only when it is
 * read-only AND the registry declares no side effects for it; everything else is traced as
 * "would call". Live runs every capability; the first failure stops the run.
 */
export async function dispatchCapabilities(args: {
  mode: RunMode;
  capabilityKeys: string[];
  capabilities: GovCapability[];
  handlers: HandlerRegistry;
  entity: RunEntity | null;
  inputs: Record<string, unknown>;
  actor?: string | null;
  trace: (level: TraceLevel, text: string, extra?: Partial<TraceStep>) => void;
  timeoutMs?: number;
  clock?: () => number;
}): Promise<DispatchResult> {
  const clock = args.clock ?? (() => Date.now());
  const capByKey = new Map(args.capabilities.map((c) => [c.key, c]));
  const outputs: Record<string, unknown> = {};
  const graph_writes: unknown[] = [];
  const steps: DispatchResult["steps"] = [];
  for (const key of args.capabilityKeys) {
    const h = args.handlers[key];
    const cap = capByKey.get(key);
    if (!h || !cap) {
      args.trace("error", `no implementation for ${key}`, { capability: key });
      return { outputs, graph_writes, steps, error: `no implementation for ${key}` };
    }
    const effects = list(cap.side_effects);
    if (args.mode === "dry_run" && (!h.readOnly || effects.length)) {
      args.trace(
        "call",
        `would call ${key} (dry run — not called${effects.length ? `: side effects ${effects.join(", ")}` : ""})`,
        { capability: key },
      );
      steps.push({ capability: key, ms: 0, ran: false });
      continue;
    }
    const t0 = clock();
    try {
      const r = await withTimeout(
        h.run({
          mode: args.mode,
          entity: args.entity,
          inputs: args.inputs,
          prior: { ...outputs },
          actor: args.actor ?? null,
        }),
        args.timeoutMs ?? CAPABILITY_TIMEOUT_MS,
        key,
      );
      const ms = clock() - t0;
      outputs[key] = r.outputs;
      if (r.graph_writes?.length) graph_writes.push(...r.graph_writes);
      steps.push({ capability: key, ms, ran: true });
      args.trace("call", `call ${key}${h.readOnly ? " (read-only)" : ""} — ok`, {
        capability: key,
        ms,
      });
    } catch (e) {
      const ms = clock() - t0;
      const msg = e instanceof Error ? e.message : String(e);
      steps.push({ capability: key, ms, ran: true });
      args.trace("error", `call ${key} failed: ${msg}`, { capability: key, ms });
      return { outputs, graph_writes, steps, error: `${key}: ${msg}` };
    }
  }
  return { outputs, graph_writes, steps, error: null };
}

/* ───────── Telemetry ───────── */

/** USD per million tokens [input, output] — Anthropic list rates for the current (5.5) tier models. */
export const MODEL_RATES: Record<string, [number, number] | null> = {
  deterministic: [0, 0],
  haiku: [0.1, 0.5],
  sonnet: [2, 10],
  opus: [4, 20],
};

export type RunTelemetry = {
  model: string;
  model_tier: string | null;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  actual_cost_usd: number;
  estimated_input_tokens: number | null;
  estimated_cost_usd: number | null;
  rate_usd_per_mtok: [number, number] | null;
  ms_total: number;
  ms_load: number;
  ms_governance: number;
  ms_execution: number;
  steps: { capability: string; ms: number; ran: boolean }[];
};

/** Pure: telemetry for a run. No capability calls a model yet, so actuals are 0. */
export function runTelemetry(
  skill: Pick<GovSkill, "key" | "model_tier" | "reads_state" | "tools_used"> | null,
  timings: { ms_total: number; ms_load: number; ms_governance: number; ms_execution: number },
  steps: RunTelemetry["steps"] = [],
): RunTelemetry {
  const est = estimateTelemetry(skill ?? undefined);
  const model = modelLabel(skill?.model_tier);
  const rate = MODEL_RATES[model] ?? null;
  const estTokens = est.input_tokens;
  return {
    model,
    model_tier: skill?.model_tier ?? null,
    model_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    actual_cost_usd: 0,
    estimated_input_tokens: estTokens,
    estimated_cost_usd:
      rate && estTokens != null ? Math.round(((estTokens * rate[0]) / 1e6) * 1e6) / 1e6 : null,
    rate_usd_per_mtok: rate,
    ...timings,
    steps,
  };
}

/* ───────── Run row ───────── */

/** The exp_skill_run columns this runner writes (id + created_at are DB defaults). */
export const SKILL_RUN_COLUMNS = [
  "skill_key",
  "skill_version",
  "capability_keys",
  "entity_ref",
  "entity_type",
  "mode",
  "status",
  "trigger",
  "verdict",
  "trace",
  "inputs",
  "outputs",
  "telemetry",
  "graph_writes",
  "expected_srs_lift",
  "actual_srs_delta",
  "error",
  "actor",
  "started_at",
  "finished_at",
] as const;
export type SkillRunInsert = { [K in (typeof SKILL_RUN_COLUMNS)[number]]: unknown };

export type SkillRun = {
  id: string;
  skill_key: string;
  skill_version: string | null;
  capability_keys: string[];
  entity_ref: string | null;
  entity_type: string | null;
  mode: RunMode;
  status: RunStatus;
  trigger: string | null;
  verdict: Verdict | null;
  trace: TraceStep[];
  inputs: { [k: string]: Json };
  outputs: { [k: string]: Json };
  telemetry: Partial<RunTelemetry>;
  graph_writes: Json[];
  expected_srs_lift: number | null;
  actual_srs_delta: number | null;
  error: string | null;
  actor: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

/** Pure: assemble the exp_skill_run insert — exactly the live columns, nothing else. */
export function buildRunRow(a: {
  skillKey: string;
  skill: Pick<GovSkill, "version" | "expected_srs_lift"> | null;
  capabilityKeys: string[];
  entity: RunEntity | null;
  entityRef: string | null;
  mode: RunMode;
  trigger: RunTrigger;
  verdict: Verdict;
  trace: TraceStep[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  telemetry: RunTelemetry;
  graphWrites: unknown[];
  error: string | null;
  actor: string | null;
  startedAt: Date;
  finishedAt: Date;
}): SkillRunInsert {
  return {
    skill_key: a.skillKey,
    skill_version: a.skill?.version ?? null,
    capability_keys: a.capabilityKeys,
    entity_ref: a.entity?.ref ?? a.entityRef,
    entity_type: a.entity?.type ?? null,
    mode: a.mode,
    status: statusFor(a.verdict),
    trigger: a.trigger,
    verdict: a.verdict,
    trace: a.trace,
    inputs: a.inputs,
    outputs: a.outputs,
    telemetry: a.telemetry,
    graph_writes: a.graphWrites,
    expected_srs_lift: a.skill?.expected_srs_lift ?? null,
    actual_srs_delta: null,
    error: a.error,
    actor: a.actor,
    started_at: a.startedAt.toISOString(),
    finished_at: a.finishedAt.toISOString(),
  };
}

/** Pure: trace lines for the governance pass (gate outcome → trace level). */
export function governanceTrace(
  g: Governance,
  mode: RunMode,
): { level: TraceLevel; text: string }[] {
  return g.gates.map((x) => {
    const level: TraceLevel =
      x.outcome === "block"
        ? "error"
        : x.outcome === "live"
          ? mode === "live"
            ? "error"
            : "warn"
          : x.outcome === "pitch" || x.outcome === "warn"
            ? "warn"
            : "check";
    const prefix = x.outcome === "live" && mode === "dry_run" ? "live would block — " : "";
    return { level, text: `gate ${x.gate}: ${prefix}${x.detail}` };
  });
}
