// Client shim: the server implementation moved to FastAPI (surface-api/graph).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";
import type { CategoryBrief } from "@v3/xmp/lib/category-brief";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const getCategoryBrief = serverFn<CategoryBrief>("graph", "getCategoryBrief");
