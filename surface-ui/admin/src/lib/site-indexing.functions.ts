// Client shim: the server implementation moved to FastAPI (surface-api/admin).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

// The site-indexing switch (write). The read, getSiteIndexing, stays shared in
// surface-ui/_base/src/lib/site-indexing.functions.ts (surface audit §11 row 6, 2026-10-25).
export const setSiteIndexing = serverFn("admin", "setSiteIndexing");
