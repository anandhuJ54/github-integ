/*
 * Adapter onto the NORA integrations stub contract (src/lib/integrations.server.ts,
 * withIntegration — PR #50, branch nora-os/integrations-admin). That module is not on main
 * yet, so this adapter exposes the SAME interface and always returns NotConfigured: no live
 * call, never fabricated data. When PR #50 merges, replace the body of withIntegration with
 * a re-export of the real one; callers do not change.
 *
 * Oxylabs is not an integration in that registry — it is the ETL's existing fetch
 * configuration (OXYLABS_USERNAME / OXYLABS_PASSWORD, shared with disco-webscraper-worker).
 * withOxylabs applies the same contract to it: live only when those env vars are present.
 */

export type IntegrationKey = "google_business_profile" | "google_places" | "apify";
export type SourceKey = IntegrationKey | "oxylabs";

export type NotConfigured = {
  ok: false;
  status: "not_configured";
  integration: SourceKey;
  mode: "stub";
  missing: string[];
  reason: string;
};
export type IntegrationResult<T> =
  | { ok: true; status: "live"; integration: SourceKey; data: T }
  | NotConfigured;
type LiveCreds = { secrets: Record<string, string>; settings: Record<string, string> };

/** Default secret reference names, mirrored from INTEGRATIONS in PR #50 (names only, no values). */
const DEFAULT_REFS: Record<IntegrationKey, string[]> = {
  google_business_profile: ["GOOGLE_BP_OAUTH_CLIENT_ID", "GOOGLE_BP_OAUTH_CLIENT_SECRET"],
  google_places: ["GOOGLE_PLACES_API_KEY"],
  apify: ["APIFY_API_TOKEN"],
};

export async function withIntegration<T>(
  key: IntegrationKey,
  _live: (creds: LiveCreds) => Promise<T>,
): Promise<IntegrationResult<T>> {
  return {
    ok: false,
    status: "not_configured",
    integration: key,
    mode: "stub",
    missing: DEFAULT_REFS[key],
    reason: `${key} is not configured — the integrations registry (PR #50) is not on main yet; no live calls`,
  };
}

export async function withOxylabs<T>(live: () => Promise<T>): Promise<IntegrationResult<T>> {
  const missing = ["OXYLABS_USERNAME", "OXYLABS_PASSWORD"].filter((k) => !process.env[k]);
  if (missing.length)
    return {
      ok: false,
      status: "not_configured",
      integration: "oxylabs",
      mode: "stub",
      missing,
      reason: `Oxylabs is not configured — missing ${missing.join(", ")}`,
    };
  return { ok: true, status: "live", integration: "oxylabs", data: await live() };
}
