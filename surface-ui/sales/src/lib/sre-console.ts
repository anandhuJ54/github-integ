import { supabase } from "@v3/ui/integrations/supabase/client";

/**
 * SRE Call Console data layer.
 *
 * Reads the claim lifecycle from exp_claim_events and writes only to
 * exp_activity_events / exp_promo_redemptions / exp_trial_extensions.
 * It never touches graph_nodes, graph_edges, graph_rings or exp_entity.
 */

/** The SRE (srx) rep whose queues this console works. Later: the logged-in SRE. */
export const SRE_REP_ID = "c1000000-0000-4000-8000-000000000001";

export type QueueKey = "attempted" | "engaged" | "lapsed_no_upgrade";

export const QUEUES: { key: QueueKey; label: string; note: string }[] = [
  { key: "attempted", label: "Attempted", note: "Help them finish claiming" },
  { key: "engaged", label: "Engaged", note: "Nora is working them — monitor only" },
  {
    key: "lapsed_no_upgrade",
    label: "Claimed 30+, not upgraded",
    note: "The real money — convert to paid",
  },
];

export type ClaimRow = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  group_key: string | null;
  event_type: string | null;
  nora_engagement: number | null;
  upgraded: boolean | null;
  contact_phone: string | null;
  contact_email: string | null;
  occurred_at: string | null;
  state: string | null;
  is_demo: boolean | null;
};

const SELECT =
  "id, entity_type, entity_id, entity_label, group_key, event_type, nora_engagement, upgraded, contact_phone, contact_email, occurred_at, state, is_demo";

export type SreRep = { id: string; name: string | null; role: string | null };
export type PromoCode = { code: string; discount_pct: number | null };

export type Queues = Record<QueueKey, ClaimRow[]>;

export async function loadSreRep(): Promise<SreRep | null> {
  const { data, error } = await supabase
    .from("exp_sales_reps")
    .select("id, name, role")
    .eq("id", SRE_REP_ID)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function loadPromoCode(): Promise<PromoCode | null> {
  const { data, error } = await supabase
    .from("exp_promo_codes")
    .select("code, discount_pct, active, seller_id")
    .eq("seller_id", SRE_REP_ID)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.code ? { code: data.code, discount_pct: data.discount_pct } : null;
}

async function loadQueue(eventType: QueueKey): Promise<ClaimRow[]> {
  let q = supabase
    .from("exp_claim_events")
    .select(SELECT)
    .eq("seller_id", SRE_REP_ID)
    .eq("event_type", eventType)
    .order("occurred_at", { ascending: true })
    .limit(250);
  if (eventType === "engaged") q = q.gt("nora_engagement", 0);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ClaimRow[];
}

export async function loadQueues(): Promise<Queues> {
  const [attempted, engaged, lapsed] = await Promise.all([
    loadQueue("attempted"),
    loadQueue("engaged"),
    loadQueue("lapsed_no_upgrade"),
  ]);
  return { attempted, engaged, lapsed_no_upgrade: lapsed };
}

/* ─────────── Writes ─────────── */

export const CALL_OUTCOMES: { value: string; label: string }[] = [
  { value: "call_reached", label: "Reached" },
  { value: "call_voicemail", label: "Left voicemail" },
  { value: "call_no_answer", label: "No answer" },
  { value: "call_not_interested", label: "Not interested" },
  { value: "call_converting", label: "Converting" },
];

export async function logCallOutcome(row: ClaimRow, outcome: string, actor: string) {
  const { error } = await supabase.from("exp_activity_events").insert({
    event_type: outcome,
    subject_type: "claim",
    subject_id: row.entity_id ?? row.id,
    actor,
    occurred_at: new Date().toISOString(),
    source: "manual",
    value: { entity_label: row.entity_label, queue: row.event_type },
  });
  if (error) throw error;
}

export async function sendPromoCode(row: ClaimRow, code: string) {
  const { error } = await supabase.from("exp_promo_redemptions").insert({
    code,
    subject_id: row.entity_id ?? row.id,
    redeemed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function extendTrial(row: ClaimRow, days: number, reason: string) {
  const capped = Math.max(1, Math.min(7, Math.round(days)));
  const { error } = await supabase.from("exp_trial_extensions").insert({
    subject_id: row.entity_id ?? row.id,
    days: capped,
    granted_by: SRE_REP_ID,
    reason: reason || "SRE call console",
  });
  if (error) throw error;
}

/* ─────────── Helpers ─────────── */

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}
