// Client shim: the server implementation moved to FastAPI (surface-api/search; moved from graph,
// surface audit 2026-10-25).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/state/api/server-fn";



export const getCachedSchema = serverFn<{ schemaJson: string; generatedAt: string | null } | null>("search", "getCachedSchema");
export const cacheSchema = serverFn<{ ok: true }>("search", "cacheSchema");
