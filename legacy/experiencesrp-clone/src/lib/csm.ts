import { supabase } from "@/integrations/supabase/client";

/* CSM assignments — one active row per (subject_type, subject_id). subject_id = org id as text,
   the same identifier exp_contracts.org_id uses, so renewal routing aligns. */

// exp_csm_assignments may not be in generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const SUBJECT = "organization";

export type CsmAssignment = {
  id: string;
  subject_id: string;
  csm_user_ref: string;
  csm_name: string | null;
  csm_email: string | null;
  assigned_by: string | null;
  assigned_at: string;
};

export type CsmUser = { user_ref: string; name: string | null; email: string | null };

/** Pure: does this assignment belong to the given user (id first, email fallback)? */
export function isMine(a: Pick<CsmAssignment, "csm_user_ref" | "csm_email">, userId?: string | null, email?: string | null) {
  if (userId && a.csm_user_ref === userId) return true;
  const e = email?.toLowerCase();
  return !!e && (a.csm_email?.toLowerCase() === e || a.csm_user_ref.toLowerCase() === e);
}

export async function listActiveCsms(): Promise<Map<string, CsmAssignment>> {
  const { data, error } = await db.from("exp_csm_assignments").select("*").eq("subject_type", SUBJECT).eq("active", true);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as CsmAssignment[]).map((a) => [a.subject_id, a]));
}

/** Org ids (as text) actively assigned to this user. */
export async function listMyAccounts(userId: string | null, email: string | null): Promise<Set<string>> {
  const all = await listActiveCsms();
  return new Set([...all.values()].filter((a) => isMine(a, userId, email)).map((a) => a.subject_id));
}

export async function getAccountCsm(orgId: string): Promise<CsmAssignment | null> {
  const { data, error } = await db
    .from("exp_csm_assignments")
    .select("*")
    .eq("subject_type", SUBJECT)
    .eq("subject_id", String(orgId))
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CsmAssignment | null;
}

export async function clearCsm(orgId: string) {
  const { error } = await db
    .from("exp_csm_assignments")
    .update({ active: false })
    .eq("subject_type", SUBJECT)
    .eq("subject_id", String(orgId))
    .eq("active", true);
  if (error) throw new Error(error.message);
}

export async function assignCsm(orgId: string, csm: CsmUser, assignedBy: string | null) {
  await clearCsm(orgId);
  const { error } = await db.from("exp_csm_assignments").insert({
    subject_type: SUBJECT,
    subject_id: String(orgId),
    csm_user_ref: csm.user_ref,
    csm_name: csm.name,
    csm_email: csm.email,
    assigned_by: assignedBy,
    active: true,
  });
  if (error) throw new Error(error.message);
}

/** Console users available as CSMs (super-admin only RPC). */
export async function listCsmCandidates(): Promise<CsmUser[]> {
  const { data, error } = await supabase.rpc("list_control_users");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { user_id: string; email: string | null }[]).map((u) => ({
    user_ref: u.user_id,
    email: u.email,
    name: u.email?.split("@")[0] ?? null,
  }));
}
