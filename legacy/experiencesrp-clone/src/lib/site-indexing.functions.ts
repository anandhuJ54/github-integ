import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { audit, requireSuperAdmin, type Ctx } from "./google-workspace.functions";
import { SITE_INDEXING_KEY } from "./index-floor";

/**
 * Site-wide indexing switch (exp_index_config.site_indexing_enabled, read by
 * exp_index_enabled()). Defaults OFF. Public read returns only the boolean;
 * any failure reads as OFF.
 */
export const getSiteIndexing = createServerFn({ method: "GET" }).handler(async () => {
  const { loadSiteIndexingEnabled } = await import("./sitemap.server");
  return { enabled: await loadSiteIndexingEnabled() };
});

/** Super admin only. Writes the one key through the caller's session (RLS also applies). */
export const setSiteIndexing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireSuperAdmin(ctx);
    const { error } = await ctx.supabase.from("exp_index_config").upsert({
      key: SITE_INDEXING_KEY,
      value: data.enabled ? "true" : "false",
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    const { resetSiteIndexingCache } = await import("./sitemap.server");
    resetSiteIndexingCache();
    await audit(ctx, data.enabled ? "site_indexing_enabled" : "site_indexing_disabled", null, {
      [SITE_INDEXING_KEY]: data.enabled,
    });
    return { enabled: data.enabled };
  });
