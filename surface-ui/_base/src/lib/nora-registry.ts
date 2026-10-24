import { api } from "@v3/ui/lib/server-fn";
import type { SkillRun } from "@v3/ui/lib/nora-runner";

/* NORA build & registry — exp_skill_registry, exp_capability_registry, exp_build_map.
   Reads and writes go through FastAPI (skills: /skills/registry/*), as the signed-in user. */

const REG = "/skills/registry";
const seg = (v: string) => encodeURIComponent(v);

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
  return (await api.get<Skill[]>(`${REG}/skills`)) ?? [];
}
export async function getSkill(key: string): Promise<Skill | null> {
  return api.get<Skill | null>(`${REG}/skills/${seg(key)}`);
}
/** The row without id / created_at / updated_at (never written). */
function rowBody<T extends { id?: string }>(row: T) {
  const { id, ...rest } = row as T & { created_at?: unknown; updated_at?: unknown };
  delete (rest as Record<string, unknown>).created_at;
  delete (rest as Record<string, unknown>).updated_at;
  return { id, rest };
}
async function upsertRow<T extends { id?: string; key: string }>(path: string, row: T): Promise<T> {
  const { id, rest } = rowBody(row);
  if (id) return api.patch<T>(`${path}/${seg(id)}`, rest);
  return api.post<T>(path, rest);
}
export const upsertSkill = (s: Skill) => upsertRow(`${REG}/skills`, s);

export async function listCapabilities(): Promise<Capability[]> {
  return (await api.get<Capability[]>(`${REG}/capabilities`)) ?? [];
}
export async function getCapability(key: string): Promise<Capability | null> {
  return api.get<Capability | null>(`${REG}/capabilities/${seg(key)}`);
}
export const upsertCapability = (c: Capability) => upsertRow(`${REG}/capabilities`, c);

export async function listBuildMap(): Promise<BuildStep[]> {
  return (await api.get<BuildStep[]>(`${REG}/build-map`)) ?? [];
}
export async function setBuildState(id: string, state: string) {
  await api.patch(`${REG}/build-map/${seg(id)}`, { state });
}

/* ───────── Phase 3: build map editing ───────── */
export type NewBuildStep = Omit<BuildStep, "id" | "sort_order"> & { sort_order?: number | null };
export async function updateBuildStep(id: string, patch: Partial<Omit<BuildStep, "id">>) {
  await api.patch(`${REG}/build-map/${seg(id)}`, patch);
}
export async function addBuildStep(step: NewBuildStep) {
  const sort = step.sort_order ?? step.step_no ?? null;
  return api.post<BuildStep>(`${REG}/build-map`, { ...step, sort_order: sort });
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
  return (await api.get<SkillEval[]>(`${REG}/evals`, { params: { skill_key: skillKey || undefined } })) ?? [];
}
export async function upsertEval(e: SkillEval): Promise<SkillEval> {
  const { id, ...rest } = e;
  if (id) return api.patch<SkillEval>(`${REG}/evals/${seg(id)}`, rest);
  return api.post<SkillEval>(`${REG}/evals`, { ...rest, status: rest.status ?? "untested" });
}
export async function setEvalResult(id: string, status: "pass" | "fail" | "untested") {
  // status, last_run_at (server clock) and last_result { manual: true, status }
  await api.post(`${REG}/evals/${seg(id)}/result`, { status });
}
export async function listVersions(skillKey: string): Promise<SkillVersion[]> {
  return (await api.get<SkillVersion[]>(`${REG}/versions`, { params: { skill_key: skillKey } })) ?? [];
}

/** Saves the skill and snapshots a version row (published_by = the signed-in user, server-side). */
async function releaseSkill(skill: Skill, release: "published" | "yanked", note?: string | null): Promise<Skill> {
  const { id, rest } = rowBody(skill);
  return api.post<Skill>(`${REG}/skills/release`, {
    ...(id ? { id } : {}),
    skill: rest,
    release,
    ...(release === "yanked" ? { note: note ?? null } : {}),
  });
}

/** Saves the skill as published only when the gate is open, then snapshots a version row. */
export async function publishSkill(skill: Skill): Promise<Skill> {
  const [caps, evals] = await Promise.all([listCapabilities(), listEvals(skill.key)]);
  const reasons = publishBlockers(skill, caps.map((c) => c.key), evals);
  if (reasons.length) throw new Error(`Cannot publish: ${reasons.join("; ")}`);
  return releaseSkill({ ...skill, status: "published" }, "published");
}

/* ───────── Skill runs (exp_skill_run, written by runSkill in nora-runner.functions.ts) ───────── */
export async function listSkillRuns(limit = 100): Promise<SkillRun[]> {
  return (await api.get<SkillRun[]>(`${REG}/skill-runs`, { params: { limit } })) ?? [];
}

/** Deprecates the skill and records a yanked version row. */
export async function yankSkill(skill: Skill, note?: string): Promise<Skill> {
  return releaseSkill({ ...skill, status: "deprecated" }, "yanked", note);
}
