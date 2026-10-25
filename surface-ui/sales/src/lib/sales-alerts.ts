import { api } from "@v3/ui/lib/server-fn";

// Sales lib (moved from _base, surface audit §11 row 5, 2026-10-25). Admin's integrations page has its own
// small client for the alert-engine "Run now" (surface-ui/admin/src/lib/sales-alerts.ts).
// FastAPI: surface-api/sales/routers/alerts_data.py (runs as the signed-in user).
const A = "/sales/alerts";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => api.post<T>(`${A}/rpc/${fn}`, { args });

export type SalesAlert = {
  id: string;
  opportunity_id: string | null;
  logo: string | null;
  alert_type: string | null;
  rule: string | null;
  body: string | null;
  severity: string | null;
  owner_id: string | null;
  is_nora_suggested: boolean;
  suggested_task: { title?: string; task_type?: string; due_in_days?: number } | null;
  accepted_task_id: string | null;
  created_at: string;
};

/** Alert rules by delivery tier: instant (database triggers), 5-minute reminder sweep, daily absence sweep. */
export type AlertTier = "instant" | "every_5_min" | "daily";
export const ALERT_RULES: { rule: string; label: string; live: boolean; tier: AlertTier }[] = [
  { rule: "new_claim", label: "New claim in the logo", live: true, tier: "instant" },
  { rule: "exec_engaged", label: "Exec-level contact engaged", live: true, tier: "instant" },
  { rule: "multi_location_upgrade", label: "Multi-location upgrade", live: true, tier: "instant" },
  { rule: "engagement_spike", label: "Engagement spike (NORA engagement)", live: true, tier: "instant" },
  { rule: "cluster_activity", label: "Cluster activity", live: true, tier: "instant" },
  { rule: "login_spike", label: "Login spike", live: false, tier: "instant" },
  { rule: "task_due", label: "Task reminder due", live: true, tier: "every_5_min" },
  { rule: "no_seller_activity", label: "No seller activity 14+ days (NORA)", live: true, tier: "daily" },
  { rule: "stuck_in_stage", label: "Stuck in stage 21+ days (NORA)", live: true, tier: "daily" },
  { rule: "score_node_growth", label: "Score / node growth", live: false, tier: "daily" },
];
export const ALERT_TIER_LABEL: Record<AlertTier, string> = { instant: "instant", every_5_min: "every 5 min", daily: "daily" };

export async function loadAlerts(filter: { opportunityId?: string; ownerId?: string | null; opportunityIds?: string[] }): Promise<SalesAlert[]> {
  // The 100 newest open alerts; each filter applies only when given (an empty opportunityIds list matches nothing).
  const data = await api.post<SalesAlert[]>(`${A}/search`, {
    opportunity_id: filter.opportunityId || null,
    owner_id: filter.ownerId || null,
    opportunity_ids: filter.opportunityIds ?? null,
  });
  return data ?? [];
}

/** A human accepts a NORA suggestion; the database creates the real task. */
export async function acceptAlert(alertId: string): Promise<string> {
  return rpc<string>("exp_alert_accept", { p_alert: alertId });
}

export async function dismissAlert(alert: SalesAlert) {
  // dismissed_at: the server's clock; the audit row's user_id: the signed-in user (from the token). A failed audit insert is ignored, as before.
  await api.post(`${A}/${encodeURIComponent(alert.id)}/dismiss`, { opportunity_id: alert.opportunity_id, rule: alert.rule });
}

/** Runs the two tick functions now, in order (alert sweep, then task reminders; the reminders tick queues emails). SF-10. */
export async function runAlertEngineNow(): Promise<{ alerts: number; reminders: number }> {
  const a = await rpc<number | null>("exp_alerts_generate");
  const r = await rpc<number | null>("exp_task_reminders_tick");
  return { alerts: Number(a ?? 0), reminders: Number(r ?? 0) };
}
