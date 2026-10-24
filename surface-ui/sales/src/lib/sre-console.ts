import { api } from "@v3/ui/lib/server-fn";

/**
 * SRE Call Console data layer.
 *
 * Reads the claim lifecycle from exp_claim_events and writes only to
 * exp_activity_events / exp_promo_redemptions / exp_trial_extensions.
 * It never touches graph_nodes, graph_edges, graph_rings or exp_entity.
 * FastAPI: surface-api/sales/routers/sre_data.py (runs as the signed-in user).
 */
const S = "/sales/sre";

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

export type SreRep = { id: string; name: string | null; role: string | null };
export type PromoCode = { code: string; discount_pct: number | null };

export type Queues = Record<QueueKey, ClaimRow[]>;

export async function loadSreRep(): Promise<SreRep | null> {
  const data = await api.get<SreRep | null>(`${S}/reps/${encodeURIComponent(SRE_REP_ID)}`);
  return data ?? null;
}

export async function loadPromoCode(): Promise<PromoCode | null> {
  const data = await api.get<{ code: string | null; discount_pct: number | null; active: boolean | null; seller_id: string | null } | null>(
    `${S}/promo-code`,
    { params: { seller_id: SRE_REP_ID } },
  );
  return data?.code ? { code: data.code, discount_pct: data.discount_pct } : null;
}

/** The three queues (each at most 250 claim events, oldest first; "engaged" only with NORA engagement > 0), one request. */
export async function loadQueues(): Promise<Queues> {
  return api.get<Queues>(`${S}/queues`, { params: { seller_id: SRE_REP_ID } });
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
  // occurred_at: the server's clock
  await api.post(`${S}/call-outcomes`, {
    event_type: outcome,
    subject_type: "claim",
    subject_id: row.entity_id ?? row.id,
    actor,
    source: "manual",
    value: { entity_label: row.entity_label, queue: row.event_type },
  });
}

export async function sendPromoCode(row: ClaimRow, code: string) {
  // redeemed_at: the server's clock
  await api.post(`${S}/promo-redemptions`, { code, subject_id: row.entity_id ?? row.id });
}

export async function extendTrial(row: ClaimRow, days: number, reason: string) {
  const capped = Math.max(1, Math.min(7, Math.round(days)));
  await api.post(`${S}/trial-extensions`, {
    subject_id: row.entity_id ?? row.id,
    days: capped,
    granted_by: SRE_REP_ID,
    reason: reason || "SRE call console",
  });
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
