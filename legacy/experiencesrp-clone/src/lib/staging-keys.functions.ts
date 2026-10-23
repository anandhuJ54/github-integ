import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FIELD_MEANINGS, STATIC_FORMATS } from "@/routes/api/public/-disco-site-contract";

/* Staging schema v1 static keys (docs/ETL-Staging-Data-Schema.md) for admin forms.
   Read on the server from the site-contract module so the list lives in one place and
   the browser never loads the parsing code. */

export type StagingKey = { id: string; subject: "person" | "location" | "firm"; format: string; meaning: string | null };

export const getStagingKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<StagingKey[]> =>
    Object.entries(STATIC_FORMATS)
      .map(([id, format]) => ({
        id,
        subject: id.split(".")[0] as StagingKey["subject"],
        format,
        meaning: FIELD_MEANINGS[id] ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
