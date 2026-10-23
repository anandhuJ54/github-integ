/*
 * Local adapter for the NORA integrations stub contract (PR #50, branch
 * nora-os/integrations-admin: src/lib/integrations.server.ts withIntegration / isLive).
 * That module is not on main yet, so this file mirrors its interface exactly and always takes
 * the STUB path: a typed NotConfigured result, never fabricated data.
 *
 * When PR #50 merges, replace the body of this file with:
 *   export { withIntegration, isLive } from "@/lib/integrations.server";
 *   export type { IntegrationKey, IntegrationResult, NotConfigured } from "@/lib/integrations";
 */

export type IntegrationKey = "google_business_profile" | "google_places" | "apify";

export type NotConfigured = {
  ok: false;
  status: "not_configured";
  integration: IntegrationKey;
  mode: "stub";
  missing: string[];
  reason: string;
};
export type IntegrationResult<T> =
  | { ok: true; status: "live"; integration: IntegrationKey; data: T }
  | NotConfigured;

type LiveCreds = { secrets: Record<string, string>; settings: Record<string, string> };

const NAMES: Record<IntegrationKey, string> = {
  google_business_profile: "Google sign-in + Business Profile",
  google_places: "Google Places API",
  apify: "Apify",
};

export async function isLive(_key: IntegrationKey): Promise<boolean> {
  return false;
}

export async function withIntegration<T>(
  key: IntegrationKey,
  _live: (creds: LiveCreds) => Promise<T>,
): Promise<IntegrationResult<T>> {
  return {
    ok: false,
    status: "not_configured",
    integration: key,
    mode: "stub",
    missing: [],
    reason: `${NAMES[key]} is not configured — integrations admin (PR #50) not merged`,
  };
}
