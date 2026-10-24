import { api } from "@v3/ui/lib/server-fn";
import type { ClaimSource, InterviewSubject, SubjectKind } from "@v3/xmp/lib/nora/interview";

/*
 * Interview loaders (client, RLS-scoped). The claim read is the thin adapter over both
 * claim flows: main writes claim_queue + professionals.claimed; the PR #58 claim gate keeps
 * writing claim_queue (plus trust_tier) through its governed functions. select("*") so the
 * same read works before and after 0021_claim_gate.sql is applied.
 */

export async function loadInterviewSubject(
  kind: SubjectKind,
  id: string,
): Promise<InterviewSubject | null> {
  const path = `/xmp/interview/subject/${kind}/${encodeURIComponent(id)}`;
  if (kind === "professional") {
    const data = await api.get<{
      id: string;
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      gcid: string | null;
      website_url: string | null;
      address_city: string | null;
      address_state: string | null;
      phone: string | null;
      claimed: boolean | null;
    } | null>(path);
    if (!data) return null;
    return {
      kind,
      id: data.id,
      name:
        data.display_name ??
        ([data.first_name, data.last_name].filter(Boolean).join(" ") || "Professional"),
      gcid: data.gcid,
      websiteUrl: data.website_url,
      city: data.address_city,
      state: data.address_state,
      phone: data.phone,
      claimed: data.claimed,
    };
  }
  const data = await api.get<{
    id: string;
    name: string | null;
    gcid: string | null;
    website_url: string | null;
    address_city: string | null;
    address_state: string | null;
    phone: string | null;
    claimed: boolean | null;
  } | null>(path);
  if (!data) return null;
  return {
    kind,
    id: data.id,
    name: data.name ?? "Location",
    gcid: data.gcid,
    websiteUrl: data.website_url,
    city: data.address_city,
    state: data.address_state,
    phone: data.phone,
    claimed: data.claimed,
  };
}

export async function loadClaimSource(subject: InterviewSubject): Promise<ClaimSource> {
  // claim_queue may be unreadable under RLS for this viewer — then the record flag alone decides.
  const data = await api
    .get<ClaimSource["queue"]>(`/xmp/interview/claim/${encodeURIComponent(subject.id)}`)
    .catch(() => null);
  return { recordClaimed: subject.claimed, queue: (data as ClaimSource["queue"]) ?? null };
}
