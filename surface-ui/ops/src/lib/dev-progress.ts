import { supabase } from "@v3/ui/integrations/supabase/client";

/* ───────────── Types (mirror exp_dev_* tables) ───────────── */

export type Launch = {
  id: string;
  phase: string;
  launch_date: string;
  program_start: string;
};

export type Team = {
  id: string;
  name: string;
  lane: string | null;
  team_type: string | null;
  leader: string | null;
  target_size: number | null;
  sort_order: number | null;
};

export type Member = {
  id: string;
  team_id: string;
  name: string;
  role: string;
  email: string | null;
  is_lead: boolean | null;
  is_demo: boolean | null;
};


export type Priority = "P0" | "P1" | "P2" | "P3";

export type Project = {
  id: string;
  team_id: string | null;
  name: string;
  description: string | null;
  success_criteria: string | null;
  priority: Priority | null;
  status: string | null;
  deadline: string | null;
  progress_pct: number | null;
  updated_at?: string | null;
};

export type Sprint = {
  id: string;
  team_id: string | null;
  name: string;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type SprintItem = {
  id: string;
  sprint_id: string | null;
  project_id: string | null;
  title: string;
  assignee: string | null;
  status: string | null;
  priority: Priority | null;
  deep_instructions?: string | null;
  is_gate?: boolean | null;
  canon_ref?: string | null;
};

/** A sprint item flagged is_gate that is not done — needs Scott. */
export type OpenGate = {
  id: string;
  title: string;
  status: string | null;
  canon_ref: string | null;
  deep_instructions: string | null;
  sprint_name: string | null;
  team_id: string | null;
  team_name: string | null;
};

export type DemoDay = {
  id: string;
  team_id: string | null;
  title: string;
  demo_date: string;
  notes: string | null;
};

export type DevDoc = {
  id: string;
  team_id: string | null;
  title: string;
  doc_type: "doc" | "wiki" | string | null;
  storage_path: string | null;
  url: string | null;
  body: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

export type Idea = {
  id: string;
  team_id: string | null;
  title: string;
  description: string | null;
  submitted_by: string | null;
  votes: number | null;
  status: string | null;
};

/* ───────────── Constants ───────────── */

export const PRIORITY_WEIGHT: Record<Priority, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };

export const PRIORITY_CHIP: Record<Priority, string> = {
  P0: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  P1: "bg-[#fff1e0] text-[#b45309]",
  P2: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  P3: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
};

export const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];
export const PROJECT_STATUSES = ["not_started", "in_progress", "blocked", "done"] as const;
export const MEMBER_ROLES = ["prototyper", "builder", "polisher", "lead", "specialist"] as const;
export const ITEM_STATUSES = ["todo", "in_progress", "done"] as const;
export const DOCS_BUCKET = "dev-docs";

/* ───────────── Progress + track status math ───────────── */

export type Track = "ahead" | "on_track" | "behind" | "none";

export const TRACK_META: Record<
  Track,
  { label: string; bar: string; text: string; chip: string; rank: number }
> = {
  behind: {
    label: "BEHIND",
    bar: "bg-[#c5221f]",
    text: "text-[#c5221f]",
    chip: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
    rank: 0,
  },
  on_track: {
    label: "ON TRACK",
    bar: "bg-[color:var(--color-g-green)]",
    text: "text-[#1e8e3e]",
    chip: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
    rank: 2,
  },
  ahead: {
    label: "AHEAD",
    bar: "bg-[#0f9d76]",
    text: "text-[#0f766e]",
    chip: "bg-[#dcfce9] text-[#0f766e]",
    rank: 3,
  },
  none: {
    label: "NO PROJECTS",
    bar: "bg-[color:var(--color-surface-3)]",
    text: "text-[color:var(--color-ink-3)]",
    chip: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
    rank: 1,
  },
};

export function dayDiff(a: string | Date, b: string | Date) {
  const da = typeof a === "string" ? new Date(`${a}T00:00:00Z`) : a;
  const db = typeof b === "string" ? new Date(`${b}T00:00:00Z`) : b;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Weighted average of project progress, weighted by priority (P0=4 … P3=1). */
export function weightedProgress(projects: Project[]): number | null {
  let num = 0;
  let den = 0;
  for (const p of projects) {
    const w = PRIORITY_WEIGHT[(p.priority ?? "P2") as Priority] ?? 2;
    num += w * (p.progress_pct ?? 0);
    den += w;
  }
  if (!den) return null;
  return Math.round((num / den) * 10) / 10;
}

/** Fraction of the program elapsed, as a percentage 0–100. */
export function expectedPct(launch: Launch | null): number {
  if (!launch) return 0;
  const total = dayDiff(launch.program_start, launch.launch_date);
  if (total <= 0) return 100;
  const elapsed = dayDiff(launch.program_start, todayIso());
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

export function trackOf(actual: number | null, expected: number): Track {
  if (actual === null) return "none";
  if (actual >= expected + 10) return "ahead";
  if (actual < expected - 10) return "behind";
  return "on_track";
}

export function daysToLaunch(launch: Launch | null) {
  if (!launch) return null;
  return dayDiff(todayIso(), launch.launch_date);
}

/* ───────────── Loaders ───────────── */

function unwrap<T>(res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

export type OverviewData = {
  launch: Launch | null;
  teams: Team[];
  projects: Project[];
  members: Member[];
  demos: DemoDay[];
};

export async function loadOverview(): Promise<OverviewData> {
  const [launchRes, teamsRes, projectsRes, membersRes, demosRes] = await Promise.all([
    supabase.from("exp_dev_launch").select("*").order("launch_date").limit(1),
    supabase.from("exp_dev_teams").select("*").order("sort_order", { ascending: true }),
    supabase.from("exp_dev_projects").select("*").order("priority").order("deadline"),
    supabase.from("exp_dev_members").select("*").order("name"),
    supabase.from("exp_dev_demo_days").select("*").order("demo_date"),
  ]);
  return {
    launch: (unwrap<Launch>(launchRes as never)[0] ?? null) as Launch | null,
    teams: unwrap<Team>(teamsRes as never),
    projects: unwrap<Project>(projectsRes as never),
    members: unwrap<Member>(membersRes as never),
    demos: unwrap<DemoDay>(demosRes as never),
  };
}

export type TeamData = {
  launch: Launch | null;
  team: Team | null;
  members: Member[];
  projects: Project[];
  sprints: Sprint[];
  items: SprintItem[];
  demos: DemoDay[];
  docs: DevDoc[];
  ideas: Idea[];
  myVotes: string[];
};

export async function loadTeam(teamId: string): Promise<TeamData> {
  const [
    launchRes,
    teamRes,
    membersRes,
    projectsRes,
    sprintsRes,
    demosRes,
    docsRes,
    ideasRes,
    userRes,
  ] = await Promise.all([
    supabase.from("exp_dev_launch").select("*").order("launch_date").limit(1),
    supabase.from("exp_dev_teams").select("*").eq("id", teamId).maybeSingle(),
    supabase.from("exp_dev_members").select("*").eq("team_id", teamId).order("name"),
    supabase.from("exp_dev_projects").select("*").eq("team_id", teamId).order("priority"),
    supabase.from("exp_dev_sprints").select("*").eq("team_id", teamId).order("start_date"),
    supabase.from("exp_dev_demo_days").select("*").eq("team_id", teamId).order("demo_date"),
    supabase.from("exp_dev_docs").select("*").eq("team_id", teamId).order("updated_at", { ascending: false }),
    supabase.from("exp_dev_ideas").select("*").eq("team_id", teamId).order("votes", { ascending: false }),
    supabase.auth.getUser(),
  ]);

  const sprints = unwrap<Sprint>(sprintsRes as never);
  let items: SprintItem[] = [];
  if (sprints.length) {
    items = unwrap<SprintItem>(
      (await supabase
        .from("exp_dev_sprint_items")
        .select("*")
        .in("sprint_id", sprints.map((s) => s.id))) as never,
    );
  }

  const ideas = unwrap<Idea>(ideasRes as never);
  const voter = userRes.data?.user?.email ?? userRes.data?.user?.id ?? "";
  let myVotes: string[] = [];
  if (voter && ideas.length) {
    const votes = unwrap<{ idea_id: string }>(
      (await supabase
        .from("exp_dev_idea_votes")
        .select("idea_id")
        .eq("voter", voter)
        .in("idea_id", ideas.map((i) => i.id))) as never,
    );
    myVotes = votes.map((v) => v.idea_id);
  }

  return {
    launch: (unwrap<Launch>(launchRes as never)[0] ?? null) as Launch | null,
    team: (teamRes.data as Team | null) ?? null,
    members: unwrap<Member>(membersRes as never),
    projects: unwrap<Project>(projectsRes as never),
    sprints,
    items,
    demos: unwrap<DemoDay>(demosRes as never),
    docs: unwrap<DevDoc>(docsRes as never),
    ideas,
    myVotes,
  };
}

/** Live gate items (is_gate = true) that are not done, or blocked items flagged as gates. */
export async function loadOpenGates(teamId?: string): Promise<OpenGate[]> {
  const itemsRes = await supabase
    .from("exp_dev_sprint_items")
    .select("id,title,status,canon_ref,deep_instructions,sprint_id,is_gate")
    .eq("is_gate", true);
  const rows = unwrap<
    SprintItem & { sprint_id: string | null }
  >(itemsRes as never).filter((r) => (r.status ?? "todo") !== "done");
  if (!rows.length) return [];

  const sprintIds = Array.from(new Set(rows.map((r) => r.sprint_id).filter(Boolean))) as string[];
  const sprints = sprintIds.length
    ? unwrap<{ id: string; name: string; team_id: string | null }>(
        (await supabase
          .from("exp_dev_sprints")
          .select("id,name,team_id")
          .in("id", sprintIds)) as never,
      )
    : [];
  const teamIds = Array.from(new Set(sprints.map((s) => s.team_id).filter(Boolean))) as string[];
  const teams = teamIds.length
    ? unwrap<{ id: string; name: string }>(
        (await supabase.from("exp_dev_teams").select("id,name").in("id", teamIds)) as never,
      )
    : [];

  const gates = rows.map((r) => {
    const sprint = sprints.find((s) => s.id === r.sprint_id) ?? null;
    const team = teams.find((t) => t.id === sprint?.team_id) ?? null;
    return {
      id: r.id,
      title: r.title,
      status: r.status ?? null,
      canon_ref: r.canon_ref ?? null,
      deep_instructions: r.deep_instructions ?? null,
      sprint_name: sprint?.name ?? null,
      team_id: sprint?.team_id ?? null,
      team_name: team?.name ?? null,
    } satisfies OpenGate;
  });
  return teamId ? gates.filter((g) => g.team_id === teamId) : gates;
}

export async function currentVoter() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? data?.user?.id ?? "anonymous";
}

/* ───────────── Mutations ───────────── */

async function run(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

export const devMutations = {
  setLeader: (teamId: string, leader: string | null) =>
    run(supabase.from("exp_dev_teams").update({ leader }).eq("id", teamId)),

  addMember: (
    teamId: string,
    row: { name: string; role: string; email?: string | null; is_lead?: boolean },
  ) =>
    run(
      supabase.from("exp_dev_members").insert({
        team_id: teamId,
        name: row.name,
        role: row.role,
        email: row.email?.trim() || null,
        is_lead: !!row.is_lead,
      } as never),
    ),

  updateMember: (id: string, patch: Partial<Member>) =>
    run(supabase.from("exp_dev_members").update(patch).eq("id", id)),
  removeMember: (id: string) => run(supabase.from("exp_dev_members").delete().eq("id", id)),

  addProject: (teamId: string, row: Partial<Project>) =>
    run(supabase.from("exp_dev_projects").insert({ team_id: teamId, ...row } as never)),
  updateProject: (id: string, patch: Partial<Project>) =>
    run(
      supabase
        .from("exp_dev_projects")
        .update({ ...patch, updated_at: new Date().toISOString() } as never)
        .eq("id", id),
    ),
  removeProject: (id: string) => run(supabase.from("exp_dev_projects").delete().eq("id", id)),

  addSprint: (teamId: string, row: Partial<Sprint>) =>
    run(supabase.from("exp_dev_sprints").insert({ team_id: teamId, ...row } as never)),
  removeSprint: (id: string) => run(supabase.from("exp_dev_sprints").delete().eq("id", id)),

  addItem: (sprintId: string, row: Partial<SprintItem>) =>
    run(supabase.from("exp_dev_sprint_items").insert({ sprint_id: sprintId, ...row } as never)),
  updateItem: (id: string, patch: Partial<SprintItem>) =>
    run(supabase.from("exp_dev_sprint_items").update(patch as never).eq("id", id)),
  removeItem: (id: string) => run(supabase.from("exp_dev_sprint_items").delete().eq("id", id)),

  addDemo: (teamId: string, row: Partial<DemoDay>) =>
    run(supabase.from("exp_dev_demo_days").insert({ team_id: teamId, ...row } as never)),
  removeDemo: (id: string) => run(supabase.from("exp_dev_demo_days").delete().eq("id", id)),

  saveWiki: async (
    teamId: string,
    row: { id?: string; title: string; body: string },
  ) => {
    const updated_by = await currentVoter();
    if (row.id) {
      await run(
        supabase
          .from("exp_dev_docs")
          .update({
            title: row.title,
            body: row.body,
            updated_by,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id),
      );
      return;
    }
    await run(
      supabase.from("exp_dev_docs").insert({
        team_id: teamId,
        title: row.title,
        body: row.body,
        doc_type: "wiki",
        updated_by,
        updated_at: new Date().toISOString(),
      } as never),
    );
  },
  removeDoc: (id: string) => run(supabase.from("exp_dev_docs").delete().eq("id", id)),

  uploadDoc: async (teamId: string, file: File) => {
    const updated_by = await currentVoter();
    const path = `${teamId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file);
    if (up.error) throw new Error(up.error.message);
    await run(
      supabase.from("exp_dev_docs").insert({
        team_id: teamId,
        title: file.name,
        doc_type: "doc",
        storage_path: path,
        updated_by,
        updated_at: new Date().toISOString(),
      } as never),
    );
  },

  docUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  addIdea: async (teamId: string, title: string, description: string) => {
    const submitted_by = await currentVoter();
    await run(
      supabase.from("exp_dev_ideas").insert({
        team_id: teamId,
        title,
        description,
        submitted_by,
        votes: 0,
        status: "parked",
      } as never),
    );
  },
  removeIdea: (id: string) => run(supabase.from("exp_dev_ideas").delete().eq("id", id)),

  /** One vote per voter per idea; votes column is recomputed from the vote rows. */
  voteIdea: async (ideaId: string) => {
    const voter = await currentVoter();
    const ins = await supabase.from("exp_dev_idea_votes").insert({ idea_id: ideaId, voter });
    if (ins.error && !/duplicate|unique/i.test(ins.error.message)) {
      throw new Error(ins.error.message);
    }
    const { count, error } = await supabase
      .from("exp_dev_idea_votes")
      .select("id", { count: "exact", head: true })
      .eq("idea_id", ideaId);
    if (error) throw new Error(error.message);
    await run(supabase.from("exp_dev_ideas").update({ votes: count ?? 0 }).eq("id", ideaId));
    return ins.error ? "already" : "voted";
  },
};

/* ───────────── AI partner: deterministic build-prompt composer ───────────── */

export function composeBuildPrompt(args: {
  project: Project;
  team: Team | null;
  wikis?: DevDoc[];
  launch?: Launch | null;
}) {
  const { project, team, wikis = [], launch } = args;
  const lines: string[] = [];
  lines.push(
    `Build "${project.name}" for the ${team?.name ?? "unassigned"} lane (${team?.lane ?? "lane not set"}).`,
  );
  lines.push(`Priority: ${project.priority ?? "P2"}. Status: ${project.status ?? "not_started"}. Current progress: ${project.progress_pct ?? 0}%.`);
  if (project.deadline) lines.push(`Due: ${project.deadline}.`);
  if (launch) lines.push(`Program target: ${launch.phase} launch on ${launch.launch_date}.`);
  lines.push("");
  lines.push("## Objective");
  lines.push(project.description?.trim() || "(no description captured yet)");
  lines.push("");
  lines.push("## Success criteria");
  lines.push(project.success_criteria?.trim() || "(no success criteria captured yet)");
  if (wikis.length) {
    lines.push("");
    lines.push("## Context (team wiki)");
    for (const w of wikis) {
      lines.push(`### ${w.title}`);
      lines.push((w.body ?? "").trim().slice(0, 4000) || "(empty)");
    }
  }
  lines.push("");
  lines.push("## Constraints");
  lines.push("- Wire to live tables only — no mock data.");
  lines.push("- Reuse the console shell, primitives and design tokens.");
  lines.push("- Report what is live-wired vs pending instrumentation when done.");
  return lines.join("\n");
}

/* ───────────── Tiny markdown renderer (wiki bodies) ───────────── */

export function markdownToHtml(md: string) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code class="rounded bg-[color:var(--color-surface-3)] px-1 py-0.5 text-[12px]">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a class="text-[color:var(--color-g-blue)] underline" href="$2" target="_blank" rel="noreferrer">$1</a>',
      );

  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lvl = h[1].length;
      const size = ["text-lg", "text-base", "text-sm", "text-sm"][lvl - 1];
      out.push(`<h${lvl} class="mt-4 mb-1 font-semibold ${size} text-ink">${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== "ul") {
        closeList();
        list = "ul";
        out.push('<ul class="my-2 list-disc space-y-1 pl-5">');
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (list !== "ol") {
        closeList();
        list = "ol";
        out.push('<ol class="my-2 list-decimal space-y-1 pl-5">');
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    out.push(`<p class="my-2 leading-relaxed">${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}
