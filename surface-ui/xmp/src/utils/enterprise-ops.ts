/**
 * Enterprise operations reads — data feeds / ingestion health and settings.
 *
 * Real-only: every value comes from a live table scoped to the impersonated
 * organization (crm_integrations, sync_jobs, oauth_connections,
 * enterprise_settings, sso_config, user_roles, invitations). When a client's
 * feed has never been wired we return empty and the surface renders an honest
 * "instrument to activate" state — nothing is estimated.
 */
import { api } from "@v3/state/api/server-fn";

// Raw rows from FastAPI (xmp: /xmp/enterprise/ops/*); errors read as empty, as before.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export type FeedHealth = "live" | "stale" | "never" | "error";

export type FeedRow = {
  id: string;
  kind: "crm" | "oauth";
  provider: string;
  display_name: string;
  direction: string | null;
  cadence: string | null;
  last_sync_at: string | null;
  sync_status: string | null;
  records_synced: number | null;
  is_active: boolean | null;
  health: FeedHealth;
};

export type SyncJobRow = {
  id: string;
  job_type: string | null;
  status: string | null;
  records_processed: number | null;
  records_failed: number | null;
  error_log: unknown;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
};

export type VolumeAuditRow = {
  provider: string;
  crm_reported: number | null;
  ingested: number;
  variance: number | null;
  last_sync_at: string | null;
};

export type IngestionSnapshot = {
  feeds: FeedRow[];
  jobs: SyncJobRow[];
  audit: VolumeAuditRow[];
  totals: { processed: number; failed: number; jobs: number };
};

const DAY = 86_400_000;

function cadenceMs(freq: string | null): number {
  switch ((freq ?? "").toLowerCase()) {
    case "realtime":
    case "hourly":
      return 2 * 3600_000;
    case "daily":
      return 1.5 * DAY;
    case "weekly":
      return 8 * DAY;
    default:
      return 2 * DAY;
  }
}

function health(
  active: boolean | null,
  status: string | null,
  last: string | null,
  freq: string | null,
): FeedHealth {
  if ((status ?? "").toLowerCase().includes("error") || (status ?? "") === "failed") return "error";
  if (!last) return "never";
  if (!active) return "stale";
  return Date.now() - new Date(last).getTime() <= cadenceMs(freq) ? "live" : "stale";
}

export async function loadIngestion(orgId: string): Promise<IngestionSnapshot> {
  const raw = await api.get<{ crm: Row[]; oauth: Row[]; jobs: Row[] }>("/xmp/enterprise/ops/ingestion", {
    params: { org_id: orgId },
  });
  const crm = (raw.crm ?? []) as Row[];
  const oauth = (raw.oauth ?? []) as Row[];

  const feeds: FeedRow[] = [
    ...crm.map((r) => ({
      id: String(r.id),
      kind: "crm" as const,
      provider: String(r.crm_type ?? "crm"),
      display_name: String(r.display_name ?? r.crm_type ?? "CRM feed"),
      direction: r.sync_direction ?? null,
      cadence: r.sync_frequency ?? null,
      last_sync_at: r.last_sync_at ?? null,
      sync_status: r.sync_status ?? null,
      records_synced: r.records_synced ?? null,
      is_active: r.is_active ?? null,
      health: health(r.is_active, r.sync_status, r.last_sync_at, r.sync_frequency),
    })),
    ...oauth.map((r) => ({
      id: String(r.id),
      kind: "oauth" as const,
      provider: String(r.provider ?? "oauth"),
      display_name: String(r.provider_name ?? r.provider ?? "Connection"),
      direction: "inbound",
      cadence: null,
      last_sync_at: r.last_sync_at ?? null,
      sync_status: r.sync_error ? "error" : (r.sync_status ?? null),
      records_synced: r.sync_count ?? null,
      is_active: r.is_active ?? null,
      health: health(r.is_active, r.sync_error ? "error" : r.sync_status, r.last_sync_at, null),
    })),
  ];

  // sync_jobs of these CRM feeds (read server-side only when there are any).
  const jobs: SyncJobRow[] = ((raw.jobs ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    job_type: r.job_type ?? null,
    status: r.status ?? null,
    records_processed: r.records_processed ?? null,
    records_failed: r.records_failed ?? null,
    error_log: r.error_log ?? null,
    started_at: r.started_at ?? null,
    completed_at: r.completed_at ?? null,
    duration_ms: r.duration_ms ?? null,
  }));

  const audit: VolumeAuditRow[] = crm.map((r) => {
    const reported = Number(r.config?.crm_record_count);
    const crmReported = Number.isFinite(reported) ? reported : null;
    const ingested = Number(r.records_synced ?? 0);
    return {
      provider: String(r.display_name ?? r.crm_type ?? "CRM"),
      crm_reported: crmReported,
      ingested,
      variance: crmReported === null ? null : ingested - crmReported,
      last_sync_at: r.last_sync_at ?? null,
    };
  });

  return {
    feeds,
    jobs,
    audit,
    totals: {
      jobs: jobs.length,
      processed: jobs.reduce((a, j) => a + (j.records_processed ?? 0), 0),
      failed: jobs.reduce((a, j) => a + (j.records_failed ?? 0), 0),
    },
  };
}

/** Record-state tabs (reference parity). Counts come from sync_jobs metadata only. */
export const RECORD_STATES = [
  "Mismatched",
  "Processed",
  "Uncollected",
  "Unsubscribed",
  "Mapped",
  "Archived",
  "Corrupt",
  "Ignored",
  "Duplicate",
] as const;
export type RecordState = (typeof RECORD_STATES)[number];

export type EnterpriseSettingsRow = {
  id: string;
  org_id: string;
  feature_listings: boolean | null;
  feature_reviews: boolean | null;
  feature_campaigns: boolean | null;
  feature_voce: boolean | null;
  feature_ai_agents: boolean | null;
  feature_crm_sync: boolean | null;
  feature_api_access: boolean | null;
  feature_websites: boolean | null;
  feature_analytics: boolean | null;
  brand_voice: string | null;
  compliance_rules_override: unknown;
  pii_restrictions: unknown;
  review_pii_filter: boolean | null;
  allow_org_posts: boolean | null;
  require_post_approval: boolean | null;
  pricing_tier: string | null;
  contract_start: string | null;
  contract_end: string | null;
};

export type OrgUserRow = {
  id: string;
  role: string | null;
  is_active: boolean | null;
  can_manage_users: boolean | null;
  can_publish_content: boolean | null;
  can_manage_billing: boolean | null;
  invited_at: string | null;
  accepted_at: string | null;
};

export type InviteRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  status: string | null;
  invited_at: string | null;
  expires_at: string | null;
};

export type SsoRow = {
  id: string;
  provider: string | null;
  issuer_url: string | null;
  is_active: boolean | null;
};

export type SettingsSnapshot = {
  settings: EnterpriseSettingsRow | null;
  users: OrgUserRow[];
  invites: InviteRow[];
  sso: SsoRow[];
  integrations: number;
};

export async function loadEnterpriseSettings(orgId: string): Promise<SettingsSnapshot> {
  const r = await api.get<SettingsSnapshot>("/xmp/enterprise/ops/settings", { params: { org_id: orgId } });
  return {
    settings: (r.settings ?? null) as EnterpriseSettingsRow | null,
    users: (r.users ?? []) as OrgUserRow[],
    invites: (r.invites ?? []) as InviteRow[],
    sso: (r.sso ?? []) as SsoRow[],
    integrations: r.integrations ?? 0,
  };
}

export function csvExport(filename: string, rows: Record<string, unknown>[]) {
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
