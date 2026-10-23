import { supabase } from "@v3/ui/integrations/supabase/client";

const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };

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
  let q = db.from("exp_sales_alerts").select("id,opportunity_id,logo,alert_type,rule,body,severity,owner_id,is_nora_suggested,suggested_task,accepted_task_id,created_at")
    .is("dismissed_at", null).is("accepted_task_id", null).order("created_at", { ascending: false }).limit(100);
  if (filter.opportunityId) q = q.eq("opportunity_id", filter.opportunityId);
  if (filter.ownerId) q = q.eq("owner_id", filter.ownerId);
  if (filter.opportunityIds) q = filter.opportunityIds.length ? q.in("opportunity_id", filter.opportunityIds) : q.eq("opportunity_id", "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SalesAlert[];
}

/** A human accepts a NORA suggestion; the database creates the real task. */
export async function acceptAlert(alertId: string): Promise<string> {
  const { data, error } = await db.rpc("exp_alert_accept", { p_alert: alertId });
  if (error) throw error;
  return data as string;
}

export async function dismissAlert(alert: SalesAlert) {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await db.from("exp_sales_alerts").update({ dismissed_at: new Date().toISOString(), acknowledged: true }).eq("id", alert.id);
  if (error) throw error;
  await db.from("audit_log").insert({ user_id: auth.user?.id ?? null, action: "sales_alert_dismissed", entity_type: "opportunity", entity_id: alert.opportunity_id, field_changes: { alert_id: alert.id, rule: alert.rule } });
}

export async function runAlertEngineNow(): Promise<{ alerts: number; reminders: number }> {
  const a = await db.rpc("exp_alerts_generate", {});
  if (a.error) throw a.error;
  const r = await db.rpc("exp_task_reminders_tick", {});
  if (r.error) throw r.error;
  return { alerts: Number(a.data ?? 0), reminders: Number(r.data ?? 0) };
}
