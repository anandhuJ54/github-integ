// Client shim: the server implementation moved to FastAPI (surface-api/graph).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";



export const getCachedSchema = serverFn<{ schemaJson: string; generatedAt: string | null } | null>("graph", "getCachedSchema");
export const cacheSchema = serverFn<{ ok: true }>("graph", "cacheSchema");
