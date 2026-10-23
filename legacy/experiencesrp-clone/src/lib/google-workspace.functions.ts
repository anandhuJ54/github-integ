import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canDeliver, createCalendarEvent, GOOGLE_SCOPES, secretByRef, secretsPresent, sendGmail, type GoogleIntegrationRow } from "./google-workspace.server";

export type Ctx = { supabase: any; userId: string; claims: { email?: string } };
const DEFAULT_ROW = { id: "workspace" };

export async function requireSuperAdmin(ctx: Ctx) {
  const { data, error } = await ctx.supabase.rpc("exp_ctrl_has_role", { p_roles: ["super_admin"] });
  if (error || data !== true) throw new Error("Super admin required");
}
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (t: string) => any; rpc: (f: string, a?: unknown) => any };
}
async function loadRow(): Promise<(GoogleIntegrationRow & Record<string, any>)> {
  const db = await admin();
  const { data, error } = await db.from("exp_integration_google").select("*").eq("id", "workspace").maybeSingle();
  if (error) throw error;
  if (data) return data;
  const ins = await db.from("exp_integration_google").insert(DEFAULT_ROW).select("*").single();
  if (ins.error) throw ins.error;
  return ins.data;
}
export async function audit(ctx: Ctx, action: string, entityId: string | null, changes: unknown) {
  await ctx.supabase.from("audit_log").insert({ user_id: ctx.userId, action, entity_type: entityId ? "opportunity" : "integration", entity_id: entityId, field_changes: changes });
}

/** Status for any signed-in employee (no secrets, no tokens). */
export const getGoogleDeliveryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const row = await loadRow();
    return { status: row.status as string, domainStatus: row.domain_status as string, domain: row.domain as string, canDeliver: canDeliver(row) };
  });

/** Full admin view. Secret presence is reported as booleans only. */
export const getGoogleIntegration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context as Ctx);
    const row = await loadRow();
    const db = await admin();
    const pending = await db.from("exp_email_outbox").select("id", { count: "exact", head: true }).eq("status", "pending");
    const calPending = await db.from("exp_sales_demos").select("id", { count: "exact", head: true }).eq("calendar_status", "pending");
    return {
      status: row.status as string, domain: row.domain as string, domainStatus: row.domain_status as string,
      verificationToken: row.domain_verification_token as string | null, verifiedAt: row.verified_at as string | null,
      connectedByEmail: row.connected_by_email as string | null, connectedAt: row.connected_at as string | null,
      scopes: (row.scopes ?? []) as string[], requestedScopes: (row.requested_scopes ?? GOOGLE_SCOPES) as string[],
      delegationMode: row.delegation_mode as string, refs: { clientId: row.client_id_ref, clientSecret: row.client_secret_ref, serviceAccount: row.service_account_ref } as Record<string, string>,
      secrets: secretsPresent(row), refreshTokenStored: !!row.refresh_token_vault_id, lastError: row.last_error as string | null,
      canDeliver: canDeliver(row), pendingEmails: pending.count ?? 0, pendingCalendar: calPending.count ?? 0,
    };
  });

/** Builds the Google consent URL. The admin must open it and approve; nothing is auto-authorized. */
export const startGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireSuperAdmin(ctx);
    const row = await loadRow();
    const clientId = secretByRef(row.client_id_ref);
    if (!clientId || !secretByRef(row.client_secret_ref)) return { url: null as string | null, missing: [row.client_id_ref, row.client_secret_ref].filter((r) => !secretByRef(r)) };
    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const db = await admin();
    await db.from("exp_integration_google").update({ status: row.status === "connected" ? "connected" : "awaiting_admin_authorize", oauth_state: state, oauth_state_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), connected_by: ctx.userId, updated_at: new Date().toISOString() }).eq("id", "workspace");
    await audit(ctx, "google_workspace_connect_started", null, { domain: row.domain });
    const origin = new URL(data.origin).origin;
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: `${origin}/api/public/google-oauth-callback`, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", hd: row.domain, state, scope: ["openid", "email", ...((row.requested_scopes as string[]) ?? GOOGLE_SCOPES)].join(" ") });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, missing: [] as string[] };
  });

/** Issues a DNS TXT token; the domain is verified only when an admin clicks "Check" after publishing it. */
export const startDomainVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    await requireSuperAdmin(ctx);
    const row = await loadRow();
    const token = row.domain_verification_token ?? `experience-workspace-verification=${crypto.randomUUID()}`;
    const db = await admin();
    await db.from("exp_integration_google").update({ domain_status: row.domain_status === "verified" ? "verified" : "pending_verification", domain_verification_token: token, updated_at: new Date().toISOString() }).eq("id", "workspace");
    await audit(ctx, "google_domain_verification_started", null, { domain: row.domain });
    return { token };
  });

export const checkDomainVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    await requireSuperAdmin(ctx);
    const row = await loadRow();
    if (!row.domain_verification_token) return { verified: false, reason: "Generate a verification record first" };
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(row.domain)}&type=TXT`, { headers: { accept: "application/dns-json" } });
    if (!res.ok) return { verified: false, reason: `DNS lookup failed [${res.status}]` };
    const json = (await res.json()) as { Answer?: { data: string }[] };
    const found = (json.Answer ?? []).some((a) => a.data.replace(/"/g, "").includes(row.domain_verification_token));
    if (!found) return { verified: false, reason: "TXT record not found yet (DNS can take up to an hour)" };
    const db = await admin();
    await db.from("exp_integration_google").update({ domain_status: "verified", verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", "workspace");
    await audit(ctx, "google_domain_verified", null, { domain: row.domain });
    return { verified: true, reason: null as string | null };
  });

async function senderAddress(ctx: Ctx, domain: string, oppOwner: string | null): Promise<string | null> {
  const email = ctx.claims.email?.toLowerCase() ?? null;
  if (email?.endsWith(`@${domain}`)) return email;
  if (oppOwner) {
    const { data } = await ctx.supabase.from("exp_sales_reps").select("email").or(`id.eq.${/^[0-9a-f-]{36}$/i.test(oppOwner) ? oppOwner : "00000000-0000-0000-0000-000000000000"},name.eq.${JSON.stringify(oppOwner)}`).limit(1);
    const rep = (data?.[0]?.email as string | undefined)?.toLowerCase();
    if (rep?.endsWith(`@${domain}`)) return rep;
  }
  return email;
}

/** Email from the opportunity: queued as pending; sent only when Google delivery is live and confirms. */
export const sendOpportunityEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ opportunityId: z.string().uuid(), to: z.array(z.string().email()).min(1).max(20), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const row = await loadRow();
    const { data: opp } = await ctx.supabase.from("exp_sales_pipeline").select("id,owner,account_id").eq("id", data.opportunityId).maybeSingle();
    if (!opp) throw new Error("Opportunity not found");
    const from = await senderAddress(ctx, row.domain, opp.owner);
    const ins = await ctx.supabase.from("exp_email_outbox").insert({ opportunity_id: data.opportunityId, kind: "email", from_address: from, to_addresses: data.to, subject: data.subject, body: data.body, status: "pending" }).select("id").single();
    if (ins.error) throw ins.error;
    let status: "pending" | "sent" | "failed" = "pending"; let error: string | null = null;
    if (canDeliver(row) && from?.endsWith(`@${row.domain}`)) {
      const db = await admin();
      try {
        const id = await sendGmail(row, from, data.to, data.subject, data.body);
        await db.from("exp_email_outbox").update({ status: "sent", provider_message_id: id, sent_at: new Date().toISOString() }).eq("id", ins.data.id);
        status = "sent";
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        await db.from("exp_email_outbox").update({ status: "failed", error }).eq("id", ins.data.id);
        status = "failed";
      }
    }
    await ctx.supabase.from("exp_activity_events").insert({ event_type: status === "sent" ? "email_sent" : status === "failed" ? "email_failed" : "email_queued", subject_type: "opportunity", subject_id: data.opportunityId, account_id: opp.account_id, actor: from, source: "gmail", occurred_at: new Date().toISOString(), value: { subject: data.subject, to: data.to, outbox_id: ins.data.id, status } });
    await audit(ctx, `opportunity_email_${status}`, data.opportunityId, { outbox_id: ins.data.id, to: data.to });
    return { status, error, outboxId: ins.data.id as string };
  });

/** Meeting/demo: always creates the local record; calendar event created only when delivery is live. */
export const scheduleOpportunityMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ opportunityId: z.string().uuid(), kind: z.enum(["demo", "meeting"]), start: z.string().min(10), durationMinutes: z.number().int().min(15).max(480), objective: z.string().trim().min(1).max(2000), agenda: z.string().max(5000), attendees: z.array(z.string().email()).max(50), sellerId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const row = await loadRow();
    const start = new Date(data.start);
    if (Number.isNaN(start.getTime())) throw new Error("Invalid start time");
    const end = new Date(start.getTime() + data.durationMinutes * 60_000);
    const live = canDeliver(row);
    const ins = await ctx.supabase.from("exp_sales_demos").insert({ opportunity_id: data.opportunityId, seller_id: data.sellerId, booked_at: start.toISOString(), objective: data.objective, agenda: data.agenda || null, attendees: data.attendees, is_demo: false, meeting_kind: data.kind, duration_minutes: data.durationMinutes, calendar_status: "pending" }).select("id").single();
    if (ins.error) throw ins.error;
    let calendar: "pending" | "created" | "failed" = "pending";
    const { data: opp } = await ctx.supabase.from("exp_sales_pipeline").select("name,owner,account_id").eq("id", data.opportunityId).maybeSingle();
    const organizer = await senderAddress(ctx, row.domain, opp?.owner ?? null);
    if (live && organizer?.endsWith(`@${row.domain}`)) {
      const db = await admin();
      try {
        const eventId = await createCalendarEvent(row, organizer, { summary: `${data.kind === "demo" ? "Demo" : "Meeting"} · ${opp?.name ?? "Opportunity"}`, description: [data.objective, data.agenda].filter(Boolean).join("\n\n"), start: start.toISOString(), end: end.toISOString(), attendees: data.attendees });
        await db.from("exp_sales_demos").update({ calendar_status: "created", calendar_event_id: eventId }).eq("id", ins.data.id);
        calendar = "created";
      } catch (e) {
        await db.from("exp_sales_demos").update({ calendar_status: "failed", calendar_error: e instanceof Error ? e.message : String(e) }).eq("id", ins.data.id);
        calendar = "failed";
      }
    }
    await audit(ctx, `opportunity_${data.kind}_booked`, data.opportunityId, { demo_id: ins.data.id, booked_at: start.toISOString(), calendar });
    return { demoId: ins.data.id as string, calendar };
  });

/** Admin: deliver queued emails/reminders after Google goes live. */
export const dispatchGoogleOutbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    await requireSuperAdmin(ctx);
    const row = await loadRow();
    if (!canDeliver(row)) return { sent: 0, failed: 0, skipped: "Google Workspace is not live yet" };
    const db = await admin();
    const { data: rows } = await db.from("exp_email_outbox").select("*").eq("status", "pending").order("created_at").limit(50);
    let sent = 0; let failed = 0;
    for (const r of rows ?? []) {
      try {
        if (!r.from_address?.endsWith(`@${row.domain}`)) throw new Error("Sender is not a company address");
        const id = await sendGmail(row, r.from_address, r.to_addresses, r.subject, r.body);
        await db.from("exp_email_outbox").update({ status: "sent", provider_message_id: id, sent_at: new Date().toISOString() }).eq("id", r.id); sent++;
      } catch (e) {
        await db.from("exp_email_outbox").update({ status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", r.id); failed++;
      }
    }
    await audit(ctx, "google_outbox_dispatched", null, { sent, failed });
    return { sent, failed, skipped: null as string | null };
  });
