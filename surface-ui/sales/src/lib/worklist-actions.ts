import { supabase } from "@v3/ui/integrations/supabase/client";

// Governed Worklist mutations: both go through SECURITY DEFINER functions that audit-log the actor.
const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => any };

export async function setClaimContact(input: { eventId: string; phone: string; email: string; claimedOverride: boolean }) {
  const { data, error } = await db.rpc("exp_claim_set_contact", { p_event: input.eventId, p_phone: input.phone, p_email: input.email, p_claimed_override: input.claimedOverride });
  if (error) throw new Error(error.message);
  return data as { id: string; claimed_override: boolean };
}

/** No email transport exists: rows are enqueued as pending in exp_verification_requests, never sent. */
export async function queueVerification(eventIds: string[]): Promise<number> {
  const { data, error } = await db.rpc("exp_claim_queue_verification", { p_events: eventIds });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** One open opportunity per logo: returns the existing open one (created=false) or a new auto-named one. */
export async function createOpportunity(input: { orgId: string; accountId?: string | null; ownerId: string | null; source: "sre" | "nora" | "seller" | "campaign" }) {
  const { data, error } = await db.rpc("exp_opp_create", { p_org_id: input.orgId, p_account_id: input.accountId ?? null, p_owner: input.ownerId, p_source: input.source });
  if (error) throw new Error(error.message);
  return data as { id: string; created: boolean };
}
