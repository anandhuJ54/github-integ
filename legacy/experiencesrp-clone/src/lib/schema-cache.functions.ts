import { createServerFn } from "@tanstack/react-start";

/** Cache stored as JSON string for serializable transport across the RPC boundary. */
export const getCachedSchema = createServerFn({ method: "GET" })
  .inputValidator((data: { entityType: string; entityId: string; pageType: string }) => data)
  .handler(async ({ data }): Promise<{ schemaJson: string; generatedAt: string | null } | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("schema_cache")
      .select("schema_json, generated_at, is_valid")
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .eq("page_type", data.pageType)
      .eq("is_valid", true)
      .maybeSingle();
    if (!row) return null;
    return {
      schemaJson: JSON.stringify(row.schema_json),
      generatedAt: (row.generated_at as string | null) ?? null,
    };
  });

export const cacheSchema = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      entityType: string;
      entityId: string;
      pageType: string;
      schemaJson: string;
      nodeCount: number;
    }) => data,
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const parsed = JSON.parse(data.schemaJson);
    await supabaseAdmin
      .from("schema_cache")
      .upsert(
        {
          entity_type: data.entityType,
          entity_id: data.entityId,
          page_type: data.pageType,
          schema_json: parsed as any,
          node_count: data.nodeCount,
          generated_at: new Date().toISOString(),
          invalidated_at: null,
          is_valid: true,
        } as any,
        { onConflict: "entity_type,entity_id,page_type" },
      );
    return { ok: true };
  });
