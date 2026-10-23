// Shared (client-safe) registry for NORA platform integrations. No secret values here —
// only the default vault/secret reference NAMES, required scopes and setting keys.
// Server-side status/accessor lives in integrations.server.ts.

export type IntegrationKey = "google_business_profile" | "google_places" | "apify";
export type IntegrationMode = "stub" | "live";
/** not_configured: secrets/settings missing · configured_stub: ready but still in stub mode · live: real calls allowed. */
export type IntegrationStatusCode = "not_configured" | "configured_stub" | "live";

export type IntegrationDef = {
  key: IntegrationKey;
  name: string;
  purpose: string;
  secrets: { id: string; label: string; defaultRef: string }[];
  settings: { id: string; label: string; help?: string }[];
  scopes?: string[];
  redirectPath?: string;
  costNote?: string;
};

export const INTEGRATIONS: Record<IntegrationKey, IntegrationDef> = {
  google_business_profile: {
    key: "google_business_profile",
    name: "Google sign-in + Business Profile",
    purpose: "End-user OAuth for profile owners claiming their listing (NORA claim gate).",
    secrets: [
      { id: "clientId", label: "OAuth web client ID", defaultRef: "GOOGLE_BP_OAUTH_CLIENT_ID" },
      {
        id: "clientSecret",
        label: "OAuth web client secret",
        defaultRef: "GOOGLE_BP_OAUTH_CLIENT_SECRET",
      },
    ],
    settings: [],
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/business.manage"],
    redirectPath: "/api/public/google-business-oauth-callback",
  },
  google_places: {
    key: "google_places",
    name: "Google Places API",
    purpose: "Place ID lookup and match for listings.",
    secrets: [{ id: "apiKey", label: "Places API key", defaultRef: "GOOGLE_PLACES_API_KEY" }],
    settings: [],
  },
  apify: {
    key: "apify",
    name: "Apify",
    purpose: "Competitive data: map-rank 7x7 grid and LLM-citation monitor actors.",
    secrets: [{ id: "apiToken", label: "Apify API token", defaultRef: "APIFY_API_TOKEN" }],
    settings: [
      { id: "mapRankActorId", label: "Map-rank 7x7 grid actor ID", help: "~$0.05 per run" },
      { id: "llmCitationActorId", label: "LLM-citation monitor actor ID" },
    ],
    costNote: "Map-rank 7x7 grid ≈ $0.05 per run.",
  },
};

export const INTEGRATION_KEYS = Object.keys(INTEGRATIONS) as IntegrationKey[];
export const SECRET_REF_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatusCode, string> = {
  not_configured: "Not configured",
  configured_stub: "Configured · stub",
  live: "Live",
};

export type IntegrationStatus = {
  key: IntegrationKey;
  status: IntegrationStatusCode;
  mode: IntegrationMode;
  refs: Record<string, string>;
  secrets: Record<string, boolean>;
  settings: Record<string, string>;
  /** Names of missing secret refs / settings (never values). */
  missing: string[];
  /** False when the settings table has not been migrated yet (defaults in use, cannot go live). */
  persisted: boolean;
};

/** Typed stub result. NORA code returns this instead of fabricating data when an integration is not live. */
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

/** Pure status derivation: live only when every secret + setting is present AND a super admin switched mode to live. */
export function deriveIntegrationStatus(
  key: IntegrationKey,
  input: {
    mode: IntegrationMode;
    refs: Record<string, string>;
    settings: Record<string, string>;
    persisted: boolean;
  },
  hasSecret: (ref: string) => boolean,
): IntegrationStatus {
  const def = INTEGRATIONS[key];
  const secrets: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const s of def.secrets) {
    const ref = input.refs[s.id] ?? s.defaultRef;
    secrets[s.id] = hasSecret(ref);
    if (!secrets[s.id]) missing.push(ref);
  }
  for (const s of def.settings) if (!input.settings[s.id]?.trim()) missing.push(s.id);
  const ready = missing.length === 0;
  const status: IntegrationStatusCode = !ready
    ? "not_configured"
    : input.mode === "live" && input.persisted
      ? "live"
      : "configured_stub";
  return {
    key,
    status,
    mode: input.mode,
    refs: Object.fromEntries(def.secrets.map((s) => [s.id, input.refs[s.id] ?? s.defaultRef])),
    secrets,
    settings: input.settings,
    missing,
    persisted: input.persisted,
  };
}

export function notConfigured(
  s: Pick<IntegrationStatus, "key" | "status" | "missing">,
): NotConfigured {
  const reason =
    s.status === "configured_stub"
      ? `${INTEGRATIONS[s.key].name} is configured but still in stub mode — no live calls`
      : `${INTEGRATIONS[s.key].name} is not configured — missing ${s.missing.join(", ")}`;
  return {
    ok: false,
    status: "not_configured",
    integration: s.key,
    mode: "stub",
    missing: s.missing,
    reason,
  };
}
