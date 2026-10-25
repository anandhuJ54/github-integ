// Client shim: the server implementation moved to FastAPI (surface-api/search, and admin for setSiteIndexing).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";



export const getSiteIndexing = serverFn("search", "getSiteIndexing");
// setSiteIndexing moved to admin (surface audit 2026-10-25); getSiteIndexing stays in search.
export const setSiteIndexing = serverFn("admin", "setSiteIndexing");
