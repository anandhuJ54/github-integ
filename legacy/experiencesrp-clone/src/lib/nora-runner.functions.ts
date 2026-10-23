import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RUN_MODES, RUN_TRIGGERS, type SkillRun } from "@/lib/nora-runner";

/*
 * runSkill — the NORA skill executor's console entry point (queue #2). Checks the caller's
 * console role, then hands off to executeSkillRun (nora-runner.server.ts), which applies the
 * governance envelope, dispatches to the capability handlers in nora-capabilities.server.ts,
 * and writes exactly one exp_skill_run row per invocation (including refusals).
 */

const runInput = z.object({
  skillKey: z.string().trim().min(1).max(200),
  entityId: z.string().trim().min(1).max(200).nullable().optional(),
  mode: z.enum(RUN_MODES),
  inputs: z.record(z.string(), z.unknown()).default({}),
  trigger: z.enum(RUN_TRIGGERS).default("manual"),
  approval: z
    .object({ approved: z.boolean().default(false), consent: z.boolean().default(false) })
    .default({ approved: false, consent: false }),
});
export type RunSkillInput = z.input<typeof runInput>;

const LIVE_ROLES = new Set(["super_admin", "architect"]);
/** Entity-scoped 'owner' grants (written by the claim gate) are not console roles. */
const NON_CONSOLE_ROLES = new Set(["owner"]);

export const runSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => runInput.parse(data))
  .handler(async ({ data, context }): Promise<SkillRun> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { capabilityHandlers } = await import("@/lib/nora-capabilities.server");
    const { executeSkillRun } = await import("@/lib/nora-runner.server");

    // Who may run: any console grant for dry runs; super_admin/architect for live.
    const { data: grantRows, error } = await supabaseAdmin
      .from("exp_control_grants")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(`exp_control_grants: ${error.message}`);
    const grants = ((grantRows ?? []) as { role: string }[]).filter(
      (g) => !NON_CONSOLE_ROLES.has(g.role),
    );
    if (!grants.length) throw new Error("Forbidden: no console role");
    if (data.mode === "live" && !grants.some((g) => LIVE_ROLES.has(g.role)))
      throw new Error("Forbidden: live runs require Super Admin or Architect");

    return executeSkillRun({
      db: context.supabase,
      writer: supabaseAdmin,
      actor: context.userId,
      data,
      handlers: capabilityHandlers(context.supabase),
    });
  });
