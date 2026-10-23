import { supabase } from "@/integrations/supabase/client";
import type { SkillRun } from "@/lib/nora-runner";

/* NORA build & registry — exp_skill_registry, exp_capability_registry, exp_build_map. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const SKILL_STATUSES = ["draft", "in_eval", "published", "deprecated"] as const;
export const BUILD_STATES = ["built", "welded", "screen_only", "not_built"] as const;
export const TRACKS = ["customer", "nora", "gtm"] as const;

export type Skill = {
  id?: string;
  key: string;
  title: string | null;
  summary: string | null;
  value_loop: string | null;
  owning_surface: string | null;
  gap_closed: string | null;
  triggers: string[] | null;
  reads_state: string[] | null;
  tools_used: string[] | null;
  autonomy: string | null;
  model_tier: string | null;
  explanation_template: string | null;
  guardrails: string[] | null;
  status: string | null;
  version: string | null;
  is_active: boolean | null;
  entity_types?: string[] | null;
  graph_writes?: string[] | null;
  affects_lanes?: string[] | null;
  expected_srs_lift?: number | null;
  requires_entitlement?: string | null;
  value_prop?: string | null;
  offer_expected_points?: number | null;
  offer_ranking_effect?: string | null;
  price_ref?: string | null;
  trial_eligible?: boolean | null;
  decline_mute_days?: number | null;
  permanently_dismissible?: boolean | null;
  requires_user_approval?: boolean | null;
  charges_money?: boolean | null;
  captures_consent?: boolean | null;
  is_async?: boolean | null;
  estimated_duration?: string | null;
  produces_report?: boolean | null;
  tracks_results?: boolean | null;
  result_metrics?: string[] | null;
  report_to_weekly_digest?: boolean | null;
  success_event?: string | null;
  updated_at?: string | null;
};

type ReadinessInput = Partial<Omit<Skill, "key">> & { key?: string };
const has = (a: unknown[] | null | undefined) => (a ?? []).length > 0;
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());

/** Pure: authoring completeness. Blockers stop publish; warnings are advisory. */
export function skillReadiness(s: ReadinessInput) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!has(s.entity_types)) blockers.push("No entity types set");
  if (!has(s.triggers)) blockers.push("At least one trigger is required");
  if (has(s.graph_writes)) {
    if (!has(s.affects_lanes)) blockers.push("Graph writes declared but no SRS lanes affected");
    if (s.expected_srs_lift == null) blockers.push("Graph writes declared but no expected SRS lift");
  }
  if (!blank(s.requires_entitlement)) {
    if (blank(s.value_prop)) blockers.push("Entitlement set but no value prop");
    if (s.offer_expected_points == null) blockers.push("Entitlement set but no offer expected points");
    if (blank(s.price_ref)) blockers.push("Entitlement set but no price ref");
    if (s.decline_mute_days == null || s.decline_mute_days < 1) blockers.push("Decline mute days must be at least 1");
    if (s.permanently_dismissible) warnings.push("Paid feature is permanently dismissible — prefer a timed mute");
  }
  if (s.charges_money) {
    if (!s.requires_user_approval) blockers.push("Charges money but does not require user approval");
    if (!s.captures_consent) blockers.push("Charges money but does not capture consent");
  }
  if (s.tracks_results) {
    if (!has(s.result_metrics)) blockers.push("Tracks results but no result metrics listed");
    if (!s.report_to_weekly_digest) warnings.push("Tracks results — consider reporting to the weekly digest");
  }
  return { blockers, warnings };
}

export type Capability = {
  id?: string;
  key: string;
  title: string | null;
  owning_surface: string | null;
  description: string | null;
  inputs: unknown;
  outputs: unknown;
  reads_state: string[] | null;
  entitlement_required: string | null;
  side_effects: string[] | null;
  idempotent_key: string | null;
  dry_run: boolean | null;
  events_emitted: string[] | null;
  transport: string | null;
  status: string | null;
  version: string | null;
  updated_at?: string | null;
};

export type BuildStep = {
  id: string;
  track: string;
  step_no: number | null;
  title: string;
  description: string | null;
  state: string | null;
  emits_event: string | null;
  consumes_event: string | null;
  notes: string | null;
  sort_order: number | null;
};

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Pure: the one-line card an agent sees for a skill. */
export function agentCard(s: Pick<Skill, "key" | "status" | "version"> & { entity_types?: string[] | null }) {
  const base = `${s.key} · ${s.status ?? "draft"} · ${s.version ?? "—"}`;
  return s.entity_types?.length ? `${base} · [${s.entity_types.join(", ")}]` : base;
}

/** Pure: tool keys on a skill with no matching capability row. */
export function missingCapabilities(tools: string[] | null | undefined, capKeys: Iterable<string>) {
  const have = new Set(capKeys);
  return (tools ?? []).filter((t) => !have.has(t));
}

/** Pure: per-skill coverage — which tool keys have a capability and which don't. */
export function skillCoverage(tools: string[] | null | undefined, capKeys: Iterable<string>) {
  const have = new Set(capKeys);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const t of tools ?? []) (have.has(t) ? covered : missing).push(t);
  return { covered, missing };
}

/** Pure: reverse map — capability key → skill keys that reference it ("used by"). */
export function capabilityUsage(skills: Pick<Skill, "key" | "tools_used">[]) {
  const usedBy = new Map<string, string[]>();
  for (const s of skills)
    for (const t of s.tools_used ?? []) {
      const list = usedBy.get(t) ?? [];
      if (!list.includes(s.key)) list.push(s.key);
      usedBy.set(t, list);
    }
  return usedBy;
}

export async function listSkills(): Promise<Skill[]> {
  return must<Skill[]>(await db.from("exp_skill_registry").select("*").order("key")) ?? [];
}
export async function getSkill(key: string): Promise<Skill | null> {
  return must<Skill | null>(await db.from("exp_skill_registry").select("*").eq("key", key).maybeSingle());
}
async function upsertRow<T extends { id?: string; key: string }>(table: string, row: T): Promise<T> {
  const { id, ...rest } = row as T & { created_at?: unknown; updated_at?: unknown };
  delete (rest as Record<string, unknown>).created_at;
  delete (rest as Record<string, unknown>).updated_at;
  if (id) return must<T>(await db.from(table).update(rest).eq("id", id).select("*").single());
  return must<T>(await db.from(table).insert(rest).select("*").single());
}
export const upsertSkill = (s: Skill) => upsertRow("exp_skill_registry", s);

export async function listCapabilities(): Promise<Capability[]> {
  return must<Capability[]>(await db.from("exp_capability_registry").select("*").order("key")) ?? [];
}
export async function getCapability(key: string): Promise<Capability | null> {
  return must<Capability | null>(await db.from("exp_capability_registry").select("*").eq("key", key).maybeSingle());
}
export const upsertCapability = (c: Capability) => upsertRow("exp_capability_registry", c);

export async function listBuildMap(): Promise<BuildStep[]> {
  return (
    must<BuildStep[]>(await db.from("exp_build_map").select("*").order("track").order("sort_order").order("step_no")) ?? []
  );
}
export async function setBuildState(id: string, state: string) {
  must(await db.from("exp_build_map").update({ state }).eq("id", id).select("id"));
}

/* ───────── Phase 3: build map editing ───────── */
export type NewBuildStep = Omit<BuildStep, "id" | "sort_order"> & { sort_order?: number | null };
export async function updateBuildStep(id: string, patch: Partial<Omit<BuildStep, "id">>) {
  must(await db.from("exp_build_map").update(patch).eq("id", id).select("id"));
}
export async function addBuildStep(step: NewBuildStep) {
  const sort = step.sort_order ?? step.step_no ?? null;
  return must<BuildStep>(await db.from("exp_build_map").insert({ ...step, sort_order: sort }).select("*").single());
}

/* ───────── Phase 4: entity types, evals, versions, publish gate ───────── */
export const ENTITY_TYPES = ["professional", "location", "brand"] as const;
export const EVAL_STATUSES = ["untested", "pass", "fail"] as const;

export type SkillEval = {
  id?: string;
  skill_key: string;
  name: string;
  fixture: unknown;
  expected: unknown;
  status: string | null;
  last_run_at?: string | null;
  last_result?: unknown;
};
export type SkillVersion = {
  id: string;
  skill_key: string;
  version: string | null;
  manifest: unknown;
  status: string | null;
  published_by: string | null;
  note: string | null;
  published_at: string | null;
};

/** Pure: reasons a skill may not be published. Empty array = gate open. */
export function publishBlockers(
  skill: ReadinessInput,
  capKeys: Iterable<string>,
  evals: Pick<SkillEval, "name" | "status">[],
) {
  const reasons: string[] = [];
  const { missing } = skillCoverage(skill.tools_used, capKeys);
  if (missing.length) reasons.push(`Missing capabilities: ${missing.join(", ")}`);
  reasons.push(...skillReadiness(skill).blockers);
  if (!evals.length) reasons.push("No eval fixtures exist");
  else {
    const notPass = evals.filter((e) => e.status !== "pass");
    if (notPass.length) reasons.push(`Evals not passing: ${notPass.map((e) => e.name).join(", ")}`);
  }
  return reasons;
}

export async function listEvals(skillKey?: string): Promise<SkillEval[]> {
  let q = db.from("exp_skill_eval").select("*").order("skill_key").order("name");
  if (skillKey) q = q.eq("skill_key", skillKey);
  return must<SkillEval[]>(await q) ?? [];
}
export async function upsertEval(e: SkillEval): Promise<SkillEval> {
  const { id, ...rest } = e;
  if (id) return must<SkillEval>(await db.from("exp_skill_eval").update(rest).eq("id", id).select("*").single());
  return must<SkillEval>(await db.from("exp_skill_eval").insert({ ...rest, status: rest.status ?? "untested" }).select("*").single());
}
export async function setEvalResult(id: string, status: "pass" | "fail" | "untested") {
  must(
    await db
      .from("exp_skill_eval")
      .update({ status, last_run_at: new Date().toISOString(), last_result: { manual: true, status } })
      .eq("id", id)
      .select("id"),
  );
}
export async function listVersions(skillKey: string): Promise<SkillVersion[]> {
  return must<SkillVersion[]>(
    await db.from("exp_skill_version").select("*").eq("skill_key", skillKey).order("published_at", { ascending: false }),
  ) ?? [];
}

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
function manifestOf(s: Skill) {
  const m = { ...s } as Record<string, unknown>;
  delete m.id;
  delete m.created_at;
  delete m.updated_at;
  return m;
}

/** Saves the skill as published only when the gate is open, then snapshots a version row. */
export async function publishSkill(skill: Skill): Promise<Skill> {
  const [caps, evals] = await Promise.all([listCapabilities(), listEvals(skill.key)]);
  const reasons = publishBlockers(skill, caps.map((c) => c.key), evals);
  if (reasons.length) throw new Error(`Cannot publish: ${reasons.join("; ")}`);
  const saved = await upsertSkill({ ...skill, status: "published" });
  must(
    await db.from("exp_skill_version").insert({
      skill_key: saved.key,
      version: saved.version,
      manifest: manifestOf(saved),
      status: "published",
      published_by: await currentUserId(),
    }).select("id"),
  );
  return saved;
}

/* ───────── Skill runs (exp_skill_run, written by runSkill in nora-runner.functions.ts) ───────── */
export async function listSkillRuns(limit = 100): Promise<SkillRun[]> {
  return must<SkillRun[]>(
    await db.from("exp_skill_run").select("*").order("created_at", { ascending: false }).limit(limit),
  ) ?? [];
}

/** Deprecates the skill and records a yanked version row. */
export async function yankSkill(skill: Skill, note?: string): Promise<Skill> {
  const saved = await upsertSkill({ ...skill, status: "deprecated" });
  must(
    await db.from("exp_skill_version").insert({
      skill_key: saved.key,
      version: saved.version,
      manifest: manifestOf(saved),
      status: "yanked",
      published_by: await currentUserId(),
      note: note ?? null,
    }).select("id"),
  );
  return saved;
}
