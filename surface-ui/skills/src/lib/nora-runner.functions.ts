// Client shim: the server implementation moved to FastAPI (surface-api/nora_os).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";
import type { RunMode, RunTrigger, SkillRun } from "@v3/skills/lib/nora-runner";

/** Input of runSkill (was z.input of the server-side zod schema). */
export type RunSkillInput = {
  skillKey: string;
  entityId?: string | null;
  mode: RunMode;
  inputs?: Record<string, unknown>;
  trigger?: RunTrigger;
  approval?: { approved?: boolean; consent?: boolean };
};

export const runSkill = serverFn<SkillRun>("nora_os", "runSkill");
