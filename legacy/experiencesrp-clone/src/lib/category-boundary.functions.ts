import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* Category boundary panel (2026-10-16): read a category's boundary (exp_category_boundary has RLS with no client
   policy, so it is read here with the server client) and regenerate a generated one (admins / architects).
   Generation is -disco-boundary.ts, the same code discovery uses; an authored boundary is never replaced. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CategoryBoundaryRow = {
  gcid: string;
  definition: string | null;
  includes: string[] | null;
  excludes: Array<{ type?: string; goes_to?: string }> | null;
  subtypes: Array<{ name?: string; criteria?: string }> | null;
  source: string | null;
  updated_at: string | null;
};

const gcidOf = (d: unknown) => {
  const g = String((d as any)?.gcid ?? "").trim();
  if (!/^gcid:[a-z0-9_]+$/.test(g)) throw new Error("gcid required");
  return { gcid: g };
};

export const getCategoryBoundary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(gcidOf)
  .handler(async ({ data }): Promise<CategoryBoundaryRow | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any).from("exp_category_boundary")
      .select("gcid, definition, includes, excludes, subtypes, source, updated_at").eq("gcid", data.gcid).maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as CategoryBoundaryRow | null;
  });

export const regenerateCategoryBoundary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(gcidOf)
  .handler(async ({ data, context }): Promise<{ saved: boolean; reason: string }> => {
    const ctx = context as { supabase: any };
    const { data: allowed } = await ctx.supabase.rpc("exp_ctrl_has_role", { p_roles: ["super_admin", "architect"] });
    if (allowed !== true) throw new Error("insufficient_privilege");
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const model = process.env["DISCO_MODEL"] ?? "claude-sonnet-4-6";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateCategoryBoundary } = await import("@/routes/api/public/-disco-boundary");
    const ask = async (prompt: string, tool: any) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 2048, tools: [tool], tool_choice: { type: "tool", name: tool.name }, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j: any = await res.json();
      noteAiUsage({ model: String(j?.model ?? model), usage: j?.usage, tool: tool.name, activity: "boundary" });
      const block = (j.content ?? []).find((b: any) => b?.type === "tool_use");
      if (!block) throw new Error("model returned no tool_use block");
      return block.input ?? {};
    };
    // Fix (ETL AI cost log, 2026-10-22): "Generate now" / Regenerate is logged as activity 'boundary'.
    const { withCostContext, noteAiUsage } = await import("@/routes/api/public/-disco-ai-cost");
    const r = await withCostContext({ db: supabaseAdmin, activity: "boundary", gcid: data.gcid }, () =>
      generateCategoryBoundary(supabaseAdmin as any, model, data.gcid, ask, { regenerate: true }));
    return { saved: r.saved, reason: r.reason };
  });
