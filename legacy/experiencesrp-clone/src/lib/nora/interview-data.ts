import { supabase } from "@/integrations/supabase/client";
import type { ClaimSource, InterviewSubject, SubjectKind } from "@/lib/nora/interview";

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
  if (kind === "professional") {
    const { data, error } = await supabase
      .from("professionals")
      .select(
        "id,display_name,first_name,last_name,gcid,website_url,address_city,address_state,phone,claimed",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
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
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,gcid,website_url,address_city,address_state,phone,claimed")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
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
  const { data } = await supabase
    .from("claim_queue")
    .select("*")
    .eq("entity_id", subject.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { recordClaimed: subject.claimed, queue: (data as ClaimSource["queue"]) ?? null };
}
