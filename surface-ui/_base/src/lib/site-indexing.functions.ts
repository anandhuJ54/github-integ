// Client shim: the server implementation moved to FastAPI (surface-api/search).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";



export const getSiteIndexing = serverFn("search", "getSiteIndexing");
export const setSiteIndexing = serverFn("search", "setSiteIndexing");
