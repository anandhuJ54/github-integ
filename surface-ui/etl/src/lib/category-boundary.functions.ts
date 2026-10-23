// Client shim: the server implementation moved to FastAPI (surface-api/graph).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

/* Category boundary panel (2026-10-16): read a category's boundary (exp_category_boundary has RLS with no client
   policy, so it is read here with the server client) and regenerate a generated one (admins / architects).
   Generation is -disco-boundary.ts, the same code discovery uses; an authored boundary is never replaced. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CategoryBoundaryRow = {
  gcid: string;
  definition: string | null;
  includes: string[] | null;
  excludes: Array<{ type?: string; goes_to?: string }> | null;
  subtypes: Array<{ name?: string; criteria?: string }> | null;
  source: string | null;
  updated_at: string | null;
};

export const getCategoryBoundary = serverFn<CategoryBoundaryRow | null>("graph", "getCategoryBoundary");
export const regenerateCategoryBoundary = serverFn<{ saved: boolean; reason: string }>("graph", "regenerateCategoryBoundary");
