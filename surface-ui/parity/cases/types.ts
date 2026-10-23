import type { supabase } from "@v3/ui/integrations/supabase/client";

/** One browser read moved to FastAPI: the legacy function and the endpoint that replaced it. */
export type ParityCase = {
  name: string;
  /** Legacy module, repo-relative, read from PARITY_LEGACY_REF (before the Surface was ported). */
  legacyModule?: string;
  /** Export to call, and its arguments. */
  legacyExport?: string;
  legacyArgs?: unknown[];
  /**
   * For legacy reads written inline in a component (nothing to import): a verbatim copy of the
   * old supabase-js query code, run with the signed-in client. Name the source file:line.
   */
  legacy?: (sb: typeof supabase) => Promise<unknown>;
  api: { method: "GET" | "POST"; path: string; body?: unknown };
  /** JSON paths whose values may differ (e.g. live counters that move between the two reads). */
  ignore?: string[];
  /**
   * Exact text replacements applied to the legacy source before it runs, for a legacy query that
   * cannot complete (e.g. hits the browser's statement timeout). Each must say why, and the
   * values it stands in for must be listed in `ignore` and verified another way.
   */
  legacyPatch?: { find: string; replace: string; why: string }[];
};
