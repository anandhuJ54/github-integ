import { api } from "@v3/ui/lib/server-fn";

// Governed Worklist mutations: both go through SECURITY DEFINER functions that audit-log the actor.
// FastAPI: surface-api/sales/routers/worklist_data.py (allow-listed functions, run as the signed-in user).
const rpc = <T>(fn: string, args: Record<string, unknown>): Promise<T> => api.post<T>(`/sales/worklist/rpc/${fn}`, { args });

export async function setClaimContact(input: { eventId: string; phone: string; email: string; claimedOverride: boolean }) {
  return rpc<{ id: string; claimed_override: boolean }>("exp_claim_set_contact", { p_event: input.eventId, p_phone: input.phone, p_email: input.email, p_claimed_override: input.claimedOverride });
}

/** No email transport exists: rows are enqueued as pending in exp_verification_requests, never sent. */
export async function queueVerification(eventIds: string[]): Promise<number> {
  const data = await rpc<number | null>("exp_claim_queue_verification", { p_events: eventIds });
  return Number(data ?? 0);
}

/** One open opportunity per logo: returns the existing open one (created=false) or a new auto-named one. */
export async function createOpportunity(input: { orgId: string; accountId?: string | null; ownerId: string | null; source: "sre" | "nora" | "seller" | "campaign" }) {
  return rpc<{ id: string; created: boolean }>("exp_opp_create", { p_org_id: input.orgId, p_account_id: input.accountId ?? null, p_owner: input.ownerId, p_source: input.source });
}
