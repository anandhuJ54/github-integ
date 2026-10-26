// Client shim: the server implementation moved to FastAPI (surface-api/search).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

// The read (every page load) stays shared. The write, setSiteIndexing (the indexing switch), is admin's:
// surface-ui/admin/src/lib/site-indexing.functions.ts (surface audit §11 row 6, 2026-10-25).
export const getSiteIndexing = serverFn("search", "getSiteIndexing");
