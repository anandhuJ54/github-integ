/** One browser read moved to FastAPI: the legacy function and the endpoint that replaced it. */
export type ParityCase = {
  name: string;
  /** Legacy module, repo-relative, read from PARITY_LEGACY_REF (before the Surface was ported). */
  legacyModule: string;
  /** Export to call, and its arguments. */
  legacyExport: string;
  legacyArgs?: unknown[];
  api: { method: "GET" | "POST"; path: string; body?: unknown };
  /** JSON paths whose values may differ (e.g. live counters that move between the two reads). */
  ignore?: string[];
};
