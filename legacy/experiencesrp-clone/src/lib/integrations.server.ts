// Server-only accessor for NORA platform integrations. Same mechanism as Google Workspace:
// exp_integration_settings stores secret reference NAMES; values are read from the vault-backed
// environment via secretByRef and never leave the server.
import { secretByRef } from "./google-workspace.server";
import {
  deriveIntegrationStatus,
  INTEGRATION_KEYS,
  INTEGRATIONS,
  notConfigured,
  type IntegrationKey,
  type IntegrationMode,
  type IntegrationResult,
  type IntegrationStatus,
} from "./integrations";

type Row = {
  key: string;
  mode: IntegrationMode;
  secret_refs: Record<string, string> | null;
  settings: Record<string, string> | null;
};

/** Service-role client, untyped because exp_integration_settings is not in the generated types until migration 0017 is applied. */
export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not yet in generated Database types
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

/** Missing table (migration 0017 not applied yet) falls back to code defaults in stub mode. */
export const isMissingTable = (e: { code?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205");

async function loadRows(): Promise<{ rows: Row[]; persisted: boolean }> {
  const db = await admin();
  const { data, error } = await db
    .from("exp_integration_settings")
    .select("key,mode,secret_refs,settings");
  if (isMissingTable(error)) return { rows: [], persisted: false };
  if (error) throw error;
  return { rows: (data ?? []) as Row[], persisted: true };
}

function toStatus(
  key: IntegrationKey,
  row: Row | undefined,
  persisted: boolean,
): IntegrationStatus {
  const def = INTEGRATIONS[key];
  const settings = Object.fromEntries(
    def.settings.map((s) => [s.id, String(row?.settings?.[s.id] ?? "")]),
  );
  return deriveIntegrationStatus(
    key,
    {
      mode: row?.mode ?? "stub",
      refs: row?.secret_refs ?? {},
      settings,
      persisted: persisted && !!row,
    },
    (ref) => !!secretByRef(ref),
  );
}

export async function getIntegrationStatus(key: IntegrationKey): Promise<IntegrationStatus> {
  const { rows, persisted } = await loadRows();
  return toStatus(
    key,
    rows.find((r) => r.key === key),
    persisted,
  );
}

export async function listIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const { rows, persisted } = await loadRows();
  return INTEGRATION_KEYS.map((k) =>
    toStatus(
      k,
      rows.find((r) => r.key === k),
      persisted,
    ),
  );
}

/** NORA code branches on this: false → use the STUB path (which must return NotConfigured, never fake data). */
export async function isLive(key: IntegrationKey): Promise<boolean> {
  return (await getIntegrationStatus(key)).status === "live";
}

/** Live credentials for a live integration only; null otherwise. Values stay server-side. */
type LiveCreds = { secrets: Record<string, string>; settings: Record<string, string> };
function credsFor(s: IntegrationStatus): LiveCreds | null {
  if (s.status !== "live") return null;
  const secrets: Record<string, string> = {};
  for (const [id, ref] of Object.entries(s.refs)) {
    const v = secretByRef(ref);
    if (!v) return null;
    secrets[id] = v;
  }
  return { secrets, settings: s.settings };
}
export async function getLiveCredentials(key: IntegrationKey): Promise<LiveCreds | null> {
  return credsFor(await getIntegrationStatus(key));
}

/**
 * Stub contract: runs `live` only when the integration is live; otherwise returns a typed
 * NotConfigured result. Never fabricates data.
 */
export async function withIntegration<T>(
  key: IntegrationKey,
  live: (creds: LiveCreds) => Promise<T>,
): Promise<IntegrationResult<T>> {
  const s = await getIntegrationStatus(key);
  const creds = credsFor(s);
  if (!creds) return notConfigured(s);
  return { ok: true, status: "live", integration: key, data: await live(creds) };
}
