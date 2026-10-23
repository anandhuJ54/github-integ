import { supabase } from "@/integrations/supabase/client";
import {
  expectedPct,
  trackOf,
  weightedProgress,
  type Launch,
  type Member,
  type Project,
  type Team,
  type Track,
} from "@/lib/dev-progress";

/* ───────────── Types ───────────── */

export type WeeklyStatus = "pending" | "submitted";

export type WeeklyUpdate = {
  id: string;
  team_id: string | null;
  member_id: string | null;
  week_start: string;
  status: WeeklyStatus | string;
  self_progress_pct: number | null;
  highlights: string | null;
  blockers: string | null;
  next_week: string | null;
  submitted_at: string | null;
};

export type DevConfig = {
  id: string;
  reminder_day: string;
  reminder_time: string;
  due_day: string;
  due_time: string;
  digest_day: string;
  digest_time: string;
  from_email: string | null;
  provider: string | null;
};

export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** Monday of the week containing `d`, as an ISO date. */
export function weekStartIso(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7; // 0 = Monday
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

/* ───────────── Loader ───────────── */

export type WeeklyData = {
  weekStart: string;
  launch: Launch | null;
  config: DevConfig | null;
  teams: Team[];
  members: Member[];
  projects: Project[];
  updates: WeeklyUpdate[];
  emailConfigured: boolean;
};

export type TeamWeekly = {
  team: Team;
  members: Member[];
  rows: { member: Member; update: WeeklyUpdate | null }[];
  submitted: number;
  pending: number;
  progress: number | null;
  track: Track;
  isDemo: boolean;
};

export async function loadWeekly(weekStart = weekStartIso()): Promise<WeeklyData> {
  const [launchRes, cfgRes, teamsRes, membersRes, projectsRes, updRes, mailRes] = await Promise.all([
    supabase.from("exp_dev_launch").select("*").order("launch_date").limit(1),
    supabase.from("exp_dev_config").select("*").limit(1),
    supabase.from("exp_dev_teams").select("*").order("sort_order"),
    supabase.from("exp_dev_members").select("*").order("name"),
    supabase.from("exp_dev_projects").select("*"),
    supabase.from("exp_dev_weekly_updates").select("*").eq("week_start", weekStart),
    fetch("/api/public/dev-weekly-status").then((r) => r.json()).catch(() => ({ emailConfigured: false })),
  ]);

  return {
    weekStart,
    launch: (launchRes.data?.[0] as Launch | undefined) ?? null,
    config: (cfgRes.data?.[0] as DevConfig | undefined) ?? null,
    teams: (teamsRes.data ?? []) as Team[],
    members: (membersRes.data ?? []) as Member[],
    projects: (projectsRes.data ?? []) as Project[],
    updates: (updRes.data ?? []) as WeeklyUpdate[],
    emailConfigured: !!(mailRes as { emailConfigured?: boolean })?.emailConfigured,
  };
}

export function groupWeekly(d: WeeklyData): TeamWeekly[] {
  const expected = expectedPct(d.launch);
  return d.teams
    .map((team) => {
      const members = d.members.filter((m) => m.team_id === team.id);
      const rows = members.map((member) => ({
        member,
        update: d.updates.find((u) => u.member_id === member.id) ?? null,
      }));
      const submitted = rows.filter((r) => r.update?.status === "submitted").length;
      const progress = weightedProgress(d.projects.filter((p) => p.team_id === team.id));
      return {
        team,
        members,
        rows,
        submitted,
        pending: rows.length - submitted,
        progress,
        track: trackOf(progress, expected),
        isDemo: members.length > 0 && members.every((m) => !!m.is_demo),
      };
    })
    .filter((t) => t.members.length > 0);
}

export function weeklyTotals(groups: TeamWeekly[]) {
  return groups.reduce(
    (acc, g) => ({ submitted: acc.submitted + g.submitted, pending: acc.pending + g.pending }),
    { submitted: 0, pending: 0 },
  );
}

/* ───────────── Mutations ───────────── */

async function run(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

export const weeklyMutations = {
  submit: async (args: {
    teamId: string;
    memberId: string;
    weekStart: string;
    self_progress_pct: number | null;
    highlights: string;
    blockers: string;
    next_week: string;
  }) => {
    await run(
      supabase.from("exp_dev_weekly_updates").upsert(
        {
          team_id: args.teamId,
          member_id: args.memberId,
          week_start: args.weekStart,
          status: "submitted",
          self_progress_pct: args.self_progress_pct,
          highlights: args.highlights.trim() || null,
          blockers: args.blockers.trim() || null,
          next_week: args.next_week.trim() || null,
          submitted_at: new Date().toISOString(),
        } as never,
        { onConflict: "member_id,week_start" },
      ),
    );
  },

  reopen: (id: string) =>
    run(
      supabase
        .from("exp_dev_weekly_updates")
        .update({ status: "pending", submitted_at: null })
        .eq("id", id),
    ),

  saveConfig: (id: string, patch: Partial<DevConfig>) =>
    run(supabase.from("exp_dev_config").update(patch as never).eq("id", id)),
};

/* ───────────── Digest composer (same shape the email sends) ───────────── */

export function composeDigest(d: WeeklyData, groups: TeamWeekly[]): string {
  const lines: string[] = [];
  const totals = weeklyTotals(groups);
  lines.push(`SRP Alpha weekly report — week of ${d.weekStart}`);
  if (d.launch) {
    const days = Math.round(
      (new Date(`${d.launch.launch_date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
    );
    lines.push(`${days} days to the ${d.launch.phase} launch on ${d.launch.launch_date}.`);
  }
  lines.push(
    `${totals.submitted} of ${totals.submitted + totals.pending} members submitted an update this week.`,
  );
  lines.push("");

  for (const g of groups) {
    lines.push(
      `## ${g.team.name} — ${g.progress === null ? "no projects" : `${g.progress}%`} (${g.track.replace("_", " ")}) · ${g.submitted}/${g.rows.length} submitted`,
    );
    for (const r of g.rows) {
      if (r.update?.status !== "submitted") continue;
      lines.push(
        `- ${r.member.name} (${r.member.role})${
          r.update.self_progress_pct === null ? "" : ` — self ${r.update.self_progress_pct}%`
        }`,
      );
      if (r.update.highlights) lines.push(`  Highlights: ${r.update.highlights}`);
      if (r.update.blockers) lines.push(`  Blockers: ${r.update.blockers}`);
      if (r.update.next_week) lines.push(`  Next week: ${r.update.next_week}`);
    }
    const chase = g.rows.filter((r) => r.update?.status !== "submitted").map((r) => r.member.name);
    if (chase.length) lines.push(`  Awaiting: ${chase.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
