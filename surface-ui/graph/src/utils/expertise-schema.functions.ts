// Client shim: the server implementation moved to FastAPI (surface-api/graph).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/state/api/server-fn";

type Lane = "professional" | "location";

export const generateCategorySchema = serverFn("graph", "generateCategorySchema");
