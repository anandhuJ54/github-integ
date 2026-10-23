/**
 * Server-only helpers for the weekly reporting loop (reminder + digest senders).
 * Email is optional: when RESEND_API_KEY is absent we log and skip the send —
 * we never fabricate a delivery.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MailResult =
  | { sent: true; recipients: number }
  | { sent: false; reason: "email_not_configured" | "no_recipients"; recipients: number };

export function weekStartIso(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

export function emailConfigured() {
  return !!process.env["RESEND_API_KEY"];
}

export function authorized(request: Request) {
  const secret = process.env["DEV_REPORT_CRON_SECRET"];
  if (!secret) return false;
  const header = request.headers.get("x-cron-secret") ?? "";
  return header === secret;
}

export async function sendMail(args: {
  to: string[];
  subject: string;
  text: string;
  from: string;
}): Promise<MailResult> {
  if (args.to.length === 0) return { sent: false, reason: "no_recipients", recipients: 0 };
  const key = process.env["RESEND_API_KEY"];
  if (!key) {
    console.warn(
      `[dev-weekly] RESEND_API_KEY missing — skipping send of "${args.subject}" to ${args.to.length} recipients`,
    );
    return { sent: false, reason: "email_not_configured", recipients: args.to.length };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: args.from, to: args.to, subject: args.subject, text: args.text }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[dev-weekly] Resend failed [${res.status}]: ${body}`);
    throw new Error(`Resend failed [${res.status}]: ${body}`);
  }
  return { sent: true, recipients: args.to.length };
}

type Row = Record<string, unknown>;

export async function loadWeeklyContext(weekStart: string) {
  const [launch, config, teams, members, projects, updates] = await Promise.all([
    supabaseAdmin.from("exp_dev_launch").select("*").order("launch_date").limit(1),
    supabaseAdmin.from("exp_dev_config").select("*").limit(1),
    supabaseAdmin.from("exp_dev_teams").select("*").order("sort_order"),
    supabaseAdmin.from("exp_dev_members").select("*").order("name"),
    supabaseAdmin.from("exp_dev_projects").select("*"),
    supabaseAdmin.from("exp_dev_weekly_updates").select("*").eq("week_start", weekStart),
  ]);
  return {
    launch: (launch.data?.[0] ?? null) as Row | null,
    config: (config.data?.[0] ?? null) as Row | null,
    teams: (teams.data ?? []) as Row[],
    members: (members.data ?? []) as Row[],
    projects: (projects.data ?? []) as Row[],
    updates: (updates.data ?? []) as Row[],
  };
}

const WEIGHT: Record<string, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };

export function teamProgress(projects: Row[]): number | null {
  let num = 0;
  let den = 0;
  for (const p of projects) {
    const w = WEIGHT[String(p["priority"] ?? "P2")] ?? 2;
    num += w * Number(p["progress_pct"] ?? 0);
    den += w;
  }
  return den ? Math.round((num / den) * 10) / 10 : null;
}

export function fromAddress(config: Row | null) {
  return String(config?.["from_email"] ?? "dev-reports@experience.com");
}
