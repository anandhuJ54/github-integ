// Client shim: the server implementation moved to FastAPI (surface-api/admin).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

/* Staging schema v1 static keys (docs/ETL-Staging-Data-Schema.md) for admin forms.
   Read on the server from the site-contract module so the list lives in one place and
   the browser never loads the parsing code. */

export type StagingKey = { id: string; subject: "person" | "location" | "firm"; format: string; meaning: string | null };

export const getStagingKeys = serverFn<StagingKey[]>("admin", "getStagingKeys");
