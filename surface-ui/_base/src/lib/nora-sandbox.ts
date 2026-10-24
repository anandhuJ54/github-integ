import { api } from "@v3/ui/lib/server-fn";

/* NORA sandbox — read entity state + weights, write only opportunity feedback.
   Through FastAPI (skills: /skills/sandbox/*), as the signed-in user. */

const SBX = "/skills/sandbox";
const seg = (v: string) => encodeURIComponent(v);

export type Gap = {
  key: string;
  label: string;
  lane?: string | null;
  impact?: number | null;
  feasibility?: number | null;
  effort?: number | null;
  urgency?: number | null;
  skill_key?: string | null;
  needs?: string | string[] | null;
};

export type NoraState = {
  nodes?: { current?: number; previous?: number; delta?: number; possible?: number; scored?: number; missing?: number; new?: unknown[] };
  scope?: { category?: string; gcid?: string; entity_type?: string; possible_nodes?: number; scored_nodes?: number; note?: string };
  srs?: { score?: number; max?: number; trend?: number | string; by_lane?: Record<string, number | { score?: number; max?: number }> };
  thin_lanes?: string[];
  signals?: Record<string, unknown>;
  features?: Record<string, unknown>;
  engagement?: Record<string, unknown>;
  total_gaps?: number;
  gaps?: Gap[];
};

export type SandboxEntity = {
  entity_ref: string;
  entity_type: string | null;
  name: string | null;
  title: string | null;
  market: string | null;
  category: string | null;
  state: NoraState | null;
};

export type Feedback = {
  id?: string;
  entity_id: string;
  entity_type: string | null;
  opportunity_key: string;
  signal: string;
  weight?: number | null;
  snooze_until?: string | null;
  created_at?: string | null;
};

export type Weights = Record<string, number>;
export const WEIGHT_KEYS = ["impact", "feasibility", "urgency", "confidence", "effort_penalty"] as const;

export async function listSandboxEntities(): Promise<SandboxEntity[]> {
  return (await api.get<SandboxEntity[]>(`${SBX}/entities`)) ?? [];
}
export async function getSandboxState(entityRef: string): Promise<SandboxEntity | null> {
  return api.get<SandboxEntity | null>(`${SBX}/entities/${seg(entityRef)}`);
}
export async function listWeights(): Promise<Weights> {
  const rows = (await api.get<{ key: string; weight: number }[]>(`${SBX}/weights`)) ?? [];
  const w: Weights = {};
  for (const r of rows) w[r.key] = Number(r.weight);
  return w;
}
export async function saveWeight(key: string, weight: number) {
  await api.put(`${SBX}/weights/${seg(key)}`, { weight });
}
export async function listFeedback(entityRef: string): Promise<Feedback[]> {
  return (await api.get<Feedback[]>(`${SBX}/feedback`, { params: { entity_id: entityRef } })) ?? [];
}
export async function giveFeedback(f: Feedback) {
  await api.post(`${SBX}/feedback`, f);
}

/* ───────── Pure ranking ───────── */
const SUPPRESS_SIGNALS = new Set(["declined", "not_relevant"]);
export const SUPPRESSION_FACTOR = 0.01;

/** Pure: is this opportunity suppressed by feedback (declined/not_relevant or an active snooze)? */
export function isSuppressed(key: string, feedback: Pick<Feedback, "opportunity_key" | "signal" | "snooze_until">[], now = new Date()) {
  return feedback.some(
    (f) =>
      f.opportunity_key === key &&
      (SUPPRESS_SIGNALS.has(f.signal) || (!!f.snooze_until && new Date(f.snooze_until).getTime() > now.getTime())),
  );
}

const w = (ws: Weights, k: string) => (Number.isFinite(ws[k]) ? ws[k] : 1);

/** Pure: priority = impact·w(impact)·feasibility·(1+urgency·w(urgency))·w(confidence) − effort·w(effort_penalty). */
export function priorityScore(g: Gap, ws: Weights) {
  const impact = Number(g.impact ?? 0);
  const feas = Number(g.feasibility ?? 0);
  const urg = Number(g.urgency ?? 0);
  const effort = Number(g.effort ?? 0);
  return impact * w(ws, "impact") * feas * (1 + urg * w(ws, "urgency")) * w(ws, "confidence") - effort * w(ws, "effort_penalty");
}

export type Ranked = Gap & { priority: number; raw: number; suppressed: boolean };

/** Pure: rank gaps desc; suppressed items are scaled to ~nothing and sink below everything else. */
export function rankGaps(gaps: Gap[], ws: Weights, feedback: Feedback[] = [], now = new Date()): Ranked[] {
  return gaps
    .map((g) => {
      const raw = priorityScore(g, ws);
      const suppressed = isSuppressed(g.key, feedback, now);
      return { ...g, raw, suppressed, priority: suppressed ? raw * SUPPRESSION_FACTOR - 1e6 : raw };
    })
    .sort((a, b) => b.priority - a.priority);
}

const needsText = (n: Gap["needs"]) => (Array.isArray(n) ? n.join(", ") : n ?? "");

/** Pure: one-line why built from the dominant factors. */
export function whyLine(g: Gap) {
  const parts: string[] = [];
  const impact = Number(g.impact ?? 0);
  parts.push(`${impact >= 15 ? "high" : impact >= 7 ? "moderate" : "low"} impact (+${impact} SRS)`);
  const f = Number(g.feasibility ?? 0);
  parts.push(f >= 0.7 ? "feasible" : f >= 0.4 ? "partly feasible" : "hard to execute");
  if (Number(g.urgency ?? 0) >= 0.6) parts.push("urgent");
  if (Number(g.effort ?? 0) >= 4) parts.push("high effort");
  const needs = needsText(g.needs);
  return needs ? `${parts.join(", ")}, but needs ${needs}` : parts.join(", ");
}

/* ───────── Dry-run telemetry + trace ───────── */
export type TraceLevel = "plan" | "read" | "check" | "call" | "warn" | "error";
export type TraceLine = { level: TraceLevel; text: string };
export type Telemetry = { model: string; input_tokens: number | null; output_tokens: number | null; ms: number | null; estimated: boolean };

type SkillLike = {
  key: string;
  model_tier?: string | null;
  reads_state?: string[] | null;
  tools_used?: string[] | null;
  guardrails?: string[] | null;
  entity_types?: string[] | null;
  autonomy?: string | null;
};

/** Pure: normalized model label from a skill's model_tier. */
export function modelLabel(tier: string | null | undefined) {
  const t = (tier ?? "").toLowerCase();
  for (const m of ["deterministic", "haiku", "sonnet", "opus"]) if (t.includes(m)) return m;
  return t || "deterministic";
}

/** Pure: estimate — 400 + 120/read + 200/tool; 0 for deterministic. Shape matches future actuals. */
export function estimateTelemetry(skill?: SkillLike | null): Telemetry {
  const model = modelLabel(skill?.model_tier);
  const tokens = model === "deterministic" ? 0 : 400 + 120 * (skill?.reads_state?.length ?? 0) + 200 * (skill?.tools_used?.length ?? 0);
  return { model, input_tokens: tokens, output_tokens: null, ms: null, estimated: true };
}

/** Pure: find an entitlement's access in features (e.g. features.voce.access). */
function accessOf(features: Record<string, unknown> | undefined, need: string): string {
  const f = features?.[need];
  if (f == null) return "none";
  if (typeof f === "boolean") return f ? "yes" : "none";
  if (typeof f === "object") {
    const o = f as Record<string, unknown>;
    const a = o.access ?? o.connected ?? o.enabled ?? o.active;
    if (a == null || a === false || a === "none" || a === "") return "none";
    return String(a);
  }
  return String(f) || "none";
}

/** Pure: deterministic step-by-step trace with real problems surfaced as warn/error lines. */
export function buildTrace(
  gap: Gap,
  skill: SkillLike | undefined,
  entity: { name?: string | null; entity_type?: string | null; state?: NoraState | null },
  capKeys: Iterable<string>,
): { lines: TraceLine[]; errors: number; verdict: string } {
  const L: TraceLine[] = [];
  const caps = new Set(capKeys);
  const et = entity.entity_type ?? "unknown";
  L.push({ level: "plan", text: `target gap "${gap.label}" (${gap.key}) · lane ${gap.lane ?? "—"} · +${gap.impact ?? 0} SRS` });
  if (!gap.skill_key) L.push({ level: "error", text: "no skill mapped — cannot act" });
  else if (!skill) L.push({ level: "error", text: `skill ${gap.skill_key} not registered` });
  else {
    L.push({ level: "plan", text: `use skill ${skill.key} · model ${modelLabel(skill.model_tier)} · autonomy ${skill.autonomy ?? "—"}` });
    L.push({ level: "check", text: `entity type ${et} ∈ [${(skill.entity_types ?? []).join(", ")}]` });
    if (!(skill.entity_types ?? []).includes(et)) L.push({ level: "error", text: `skill not valid for ${et}` });
    for (const r of skill.reads_state ?? []) L.push({ level: "read", text: `read ${r} for ${entity.name ?? "entity"}` });
    for (const t of skill.tools_used ?? []) {
      if (caps.has(t)) L.push({ level: "call", text: `call ${t} (dry run)` });
      else L.push({ level: "error", text: `capability ${t} not registered` });
    }
  }
  const needs = Array.isArray(gap.needs) ? gap.needs : gap.needs ? [gap.needs] : [];
  for (const n of needs) {
    const a = accessOf(entity.state?.features as Record<string, unknown> | undefined, n);
    L.push({ level: "check", text: `entitlement ${n} — access=${a}` });
    if (a === "none") L.push({ level: "warn", text: `entitlement ${n} required — access=none; would halt and offer trial` });
  }
  for (const g of skill?.guardrails ?? []) L.push({ level: "warn", text: `guardrail: ${g}` });
  const errors = L.filter((l) => l.level === "error").length;
  return { lines: L, errors, verdict: errors ? `WOULD BLOCK — ${errors} issue(s)` : "WOULD EXECUTE" };
}

/* ───────── Real Search Rank Score source ───────── */
export const DEFAULT_SANDBOX_REF = "22222222-0000-4000-8000-000000000001";

export type SrsRow = {
  entity_type: string;
  entity_id: string;
  gcid: string | null;
  total_score: number | null;
  max_possible: number | null;
  score_pct: number | null;
  score_reviews: number | null;
  score_profile: number | null;
  score_listings: number | null;
  score_content: number | null;
  score_web_analytics: number | null;
  score_connections: number | null;
  local_rank: number | null;
  local_rank_of: number | null;
  local_market: string | null;
  top_pct: number | null;
  previous_score: number | null;
  score_change_7d: number | null;
  score_change_30d: number | null;
  gaps: { action: string; gap: number; lane: string }[] | null;
  next_milestone: string | null;
  next_milestone_gap: number | null;
  calculated_at: string | null;
};

export type ScoredEntity = { entity_ref: string; entity_type: string; gcid: string | null; total_score: number | null; display_name: string | null };

/** Lane → registered skill key (null = no skill yet). */
export const LANE_SKILL: Record<string, string | null> = {
  Completeness: "publish_bio",
  Articles: "write_market_article",
  Website: null,
  GBP: "connect_google",
  Directories: "fix_listing_nap",
  Reviews: "request_reviews",
  Connections: "add_referral_partners",
  "Q&A": null,
  Videos: null,
  Audio: null,
};

/** The six SRS lane sub-scores, labelled as the lanes are named. */
export const SRS_LANES = [
  ["score_reviews", "Reviews"],
  ["score_profile", "Completeness"],
  ["score_listings", "Directories"],
  ["score_content", "Articles"],
  ["score_web_analytics", "Website"],
  ["score_connections", "Connections"],
] as const;

/** Pure: SRS gaps → queue gaps. Impact = real points left; feasibility/urgency default 1, effort 0. */
export function srsGapsToGaps(gaps: SrsRow["gaps"]): Gap[] {
  return (gaps ?? []).map((g) => ({
    key: `lane:${g.lane}`,
    label: g.action,
    lane: g.lane,
    impact: Number(g.gap ?? 0),
    feasibility: 1,
    urgency: 1,
    effort: 0,
    skill_key: Object.prototype.hasOwnProperty.call(LANE_SKILL, g.lane) ? LANE_SKILL[g.lane] : null,
  }));
}

/** Scores by total desc, each with its exp_entity display name (joined server-side; null when unknown). */
export async function listScoredEntities(): Promise<ScoredEntity[]> {
  const rows =
    (await api.get<(Pick<SrsRow, "entity_id" | "entity_type" | "gcid" | "total_score"> & { display_name: string | null })[]>(
      `${SBX}/scored`,
    )) ?? [];
  return rows.map((r) => ({
    entity_ref: String(r.entity_id),
    entity_type: r.entity_type,
    gcid: r.gcid,
    total_score: r.total_score,
    display_name: r.display_name ?? null,
  }));
}

/** The latest SRS row for `ref` with its display name, or null. */
export async function getScore(ref: string): Promise<(SrsRow & { display_name: string | null }) | null> {
  return api.get<(SrsRow & { display_name: string | null }) | null>(`${SBX}/scores/${seg(ref)}`);
}

export type SandboxView = { source: "srs" | "synthetic"; entity: SandboxEntity; srs: (SrsRow & { display_name: string | null }) | null };

/** Real SRS first; exp_nora_state only as a labelled synthetic fallback. */
export async function loadSandbox(ref: string): Promise<SandboxView | null> {
  const srs = await getScore(ref);
  if (srs) {
    const by_lane: Record<string, number> = {};
    for (const [col, lane] of SRS_LANES) by_lane[lane] = Number(srs[col] ?? 0);
    return {
      source: "srs",
      srs,
      entity: {
        entity_ref: ref,
        entity_type: srs.entity_type,
        name: srs.display_name,
        title: null,
        market: srs.local_market,
        category: srs.gcid,
        state: {
          srs: { score: srs.total_score ?? 0, max: srs.max_possible ?? 0, trend: srs.score_change_30d ?? undefined, by_lane },
          gaps: srsGapsToGaps(srs.gaps),
          total_gaps: srs.gaps?.length ?? 0,
        },
      },
    };
  }
  const syn = await getSandboxState(ref);
  return syn ? { source: "synthetic", entity: syn, srs: null } : null;
}
