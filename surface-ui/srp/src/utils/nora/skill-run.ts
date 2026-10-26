// srp's own copy of what the seat interview needs from skills (surface audit §11 row 4, 2026-10-25):
// the exp_skill_run row shape and a client for runSkill. The runner itself stays server-side;
// this only calls its published endpoint (/nora_os/fn/runSkill). Keep in step with
// surface-ui/skills/src/lib/nora-runner.ts (types) and nora-runner.functions.ts (client).
import { serverFn } from "@v3/state/api/server-fn";
import type { Json } from "@v3/state/auth/adapters/supabase/types";

export type RunMode = "dry_run" | "live";
export type RunTrigger = "manual" | "scripted" | "autonomous";

export type Verdict =
  | "executed"
  | "would_execute"
  | "blocked"
  | "pitch"
  | "not_implemented"
  | "failed";
export type RunStatus = "planned" | "running" | "blocked" | "succeeded" | "failed" | "cancelled";

export type TraceLevel = "plan" | "read" | "check" | "call" | "warn" | "error";

export type TraceStep = {
  step: number;
  level: TraceLevel;
  text: string;
  capability?: string;
  ms?: number;
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

/** Input of runSkill. */
export type RunSkillInput = {
  skillKey: string;
  entityId?: string | null;
  mode: RunMode;
  inputs?: Record<string, unknown>;
  trigger?: RunTrigger;
  approval?: { approved?: boolean; consent?: boolean };
};

export const runSkill = serverFn<SkillRun>("nora_os", "runSkill");
