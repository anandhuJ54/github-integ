import { api } from "@v3/ui/lib/server-fn";

/* CSM assignments — one active row per (subject_type, subject_id). subject_id = org id as text,
   the same identifier exp_contracts.org_id uses, so renewal routing aligns.
   FastAPI: surface-api/sales/routers/csm_data.py, a sales API (this lib moved to admin with the
   Accounts pages, surface audit 2026-10-25; runs as the signed-in user; subject_type is
   "organization" there). */
const CSM = "/sales/csm";

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
  const data = await api.get<CsmAssignment[]>(`${CSM}/assignments`);
  return new Map(data.map((a) => [a.subject_id, a]));
}

/** Org ids (as text) actively assigned to this user. */
export async function listMyAccounts(userId: string | null, email: string | null): Promise<Set<string>> {
  const all = await listActiveCsms();
  return new Set([...all.values()].filter((a) => isMine(a, userId, email)).map((a) => a.subject_id));
}

export async function getAccountCsm(orgId: string): Promise<CsmAssignment | null> {
  return api.get<CsmAssignment | null>(`${CSM}/assignments/${encodeURIComponent(String(orgId))}`);
}

export async function clearCsm(orgId: string) {
  await api.delete(`${CSM}/assignments/${encodeURIComponent(String(orgId))}`);
}

/** Clears the org's active CSM, then assigns this one (one transaction). `_assignedBy` is kept so
 *  callers are unchanged: the server records the signed-in user's email (else id), which is what
 *  every caller passed. */
export async function assignCsm(orgId: string, csm: CsmUser, _assignedBy: string | null) {
  await api.put(`${CSM}/assignments/${encodeURIComponent(String(orgId))}`, {
    user_ref: csm.user_ref,
    name: csm.name,
    email: csm.email,
  });
}

/** Console users available as CSMs (super-admin only RPC). */
export async function listCsmCandidates(): Promise<CsmUser[]> {
  const data = await api.get<{ user_id: string; email: string | null }[]>(`${CSM}/candidates`);
  return data.map((u) => ({
    user_ref: u.user_id,
    email: u.email,
    name: u.email?.split("@")[0] ?? null,
  }));
}
