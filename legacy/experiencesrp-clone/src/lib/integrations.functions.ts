import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { audit, requireSuperAdmin, type Ctx } from "./google-workspace.functions";
import {
  INTEGRATION_KEYS,
  INTEGRATIONS,
  SECRET_REF_PATTERN,
  type IntegrationKey,
} from "./integrations";
import {
  admin,
  getIntegrationStatus,
  isMissingTable,
  listIntegrationStatuses,
} from "./integrations.server";

/** Super-admin view of NORA integrations. Secret presence as booleans and reference names only. */
export const getNoraIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context as Ctx);
    return { integrations: await listIntegrationStatuses() };
  });

const updateInput = z.object({
  key: z.enum(INTEGRATION_KEYS as [IntegrationKey, ...IntegrationKey[]]),
  refs: z
    .record(
      z.string(),
      z.string().trim().regex(SECRET_REF_PATTERN, "Secret names must be UPPER_SNAKE_CASE").max(128),
    )
    .optional(),
  settings: z.record(z.string(), z.string().trim().max(200)).optional(),
  mode: z.enum(["stub", "live"]).optional(),
});

/** Save secret reference names / settings, or switch stub ↔ live. Live requires every secret and setting present. */
export const updateNoraIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateInput.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireSuperAdmin(ctx);
    const def = INTEGRATIONS[data.key];
    const current = await getIntegrationStatus(data.key);
    const refs = { ...current.refs };
    for (const s of def.secrets) if (data.refs?.[s.id]) refs[s.id] = data.refs[s.id];
    const settings = { ...current.settings };
    for (const s of def.settings)
      if (data.settings && s.id in data.settings) settings[s.id] = data.settings[s.id];
    const mode = data.mode ?? current.mode;
    const db = await admin();
    const { error } = await db.from("exp_integration_settings").upsert(
      {
        key: data.key,
        secret_refs: refs,
        settings,
        mode: "stub",
        updated_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error)
      throw new Error(
        isMissingTable(error)
          ? "Integration settings table is not migrated yet (drizzle migration 0017)"
          : error.message,
      );
    if (mode === "live") {
      const next = await getIntegrationStatus(data.key);
      if (next.missing.length)
        throw new Error(`Cannot go live — missing ${next.missing.join(", ")}`);
      const up = await db
        .from("exp_integration_settings")
        .update({ mode: "live" })
        .eq("key", data.key);
      if (up.error) throw new Error(up.error.message);
    }
    await audit(ctx, "nora_integration_updated", null, { key: data.key, refs, settings, mode });
    return getIntegrationStatus(data.key);
  });
