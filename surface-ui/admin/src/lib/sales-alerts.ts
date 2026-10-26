import { api } from "@v3/ui/lib/server-fn";

// Admin's own small client for the sales alert engine (surface audit §11 row 5, 2026-10-25): the
// "Run now" button on /admin/integrations and the rule list it shows. Calls the sales API through its
// published contract (POST /sales/alerts/rpc/{fn}); the sales lib is surface-ui/sales/src/lib/sales-alerts.ts.
const A = "/sales/alerts";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => api.post<T>(`${A}/rpc/${fn}`, { args });

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

/** Runs the alert generator and the task-reminder tick once. */
export async function runAlertEngineNow(): Promise<{ alerts: number; reminders: number }> {
  const a = await rpc<number | null>("exp_alerts_generate");
  const r = await rpc<number | null>("exp_task_reminders_tick");
  return { alerts: Number(a ?? 0), reminders: Number(r ?? 0) };
}
