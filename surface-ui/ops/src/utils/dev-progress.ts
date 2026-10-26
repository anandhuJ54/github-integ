import { supabase } from "@v3/state/auth/adapters/supabase/client";
import { getCurrentUser } from "@v3/state/session/current-user";
import { api } from "@v3/state/api/server-fn";

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
/* Reads go through GET /ops/dev/* (surface-api/ops/queries/dev.py), as the signed-in user. */

export type OverviewData = {
  launch: Launch | null;
  teams: Team[];
  projects: Project[];
  members: Member[];
  demos: DemoDay[];
};

export function loadOverview(): Promise<OverviewData> {
  return api.get<OverviewData>("/ops/dev/overview");
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

/** The team's rows; `myVotes` are the signed-in user's votes (the API knows who that is). */
export function loadTeam(teamId: string): Promise<TeamData> {
  return api.get<TeamData>(`/ops/dev/teams/${encodeURIComponent(teamId)}`);
}

/** Live gate items (is_gate = true) that are not done, or blocked items flagged as gates. */
export async function loadOpenGates(teamId?: string): Promise<OpenGate[]> {
  // gate items, plus the sprints and teams they belong to, in one request
  const raw = await api.get<{
    items: (SprintItem & { sprint_id: string | null })[];
    sprints: { id: string; name: string; team_id: string | null }[];
    teams: { id: string; name: string }[];
  }>("/ops/dev/open-gates");
  const rows = raw.items.filter((r) => (r.status ?? "todo") !== "done");
  if (!rows.length) return [];
  const { sprints, teams } = raw;

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
  const user = await getCurrentUser();
  return user?.email ?? user?.id ?? "anonymous";
}

/* ───────────── Mutations ───────────── */
/*
 * Writes go through /ops/dev/{entity} (an allow-listed create/update/delete per tracker table),
 * as the signed-in user. The API sets updated_by / submitted_by / voter from the login.
 * Document files stay in Supabase Storage for now (storage gets its own design).
 */

const dev = (entity: string, id?: string) =>
  `/ops/dev/${entity}${id ? `/${encodeURIComponent(id)}` : ""}`;
const add = (entity: string, row: Record<string, unknown>) =>
  api.post<{ id: string }>(dev(entity), row).then(() => undefined);
const patch = (entity: string, id: string, row: Record<string, unknown>) =>
  api.patch(dev(entity, id), row).then(() => undefined);
const remove = (entity: string, id: string) => api.delete(dev(entity, id)).then(() => undefined);

export const devMutations = {
  setLeader: (teamId: string, leader: string | null) => patch("teams", teamId, { leader }),

  addMember: (
    teamId: string,
    row: { name: string; role: string; email?: string | null; is_lead?: boolean },
  ) =>
    add("members", {
      team_id: teamId,
      name: row.name,
      role: row.role,
      email: row.email?.trim() || null,
      is_lead: !!row.is_lead,
    }),

  updateMember: (id: string, p: Partial<Member>) => patch("members", id, p),
  removeMember: (id: string) => remove("members", id),

  addProject: (teamId: string, row: Partial<Project>) => add("projects", { team_id: teamId, ...row }),
  updateProject: (id: string, p: Partial<Project>) =>
    patch("projects", id, { ...p, updated_at: new Date().toISOString() }),
  removeProject: (id: string) => remove("projects", id),

  addSprint: (teamId: string, row: Partial<Sprint>) => add("sprints", { team_id: teamId, ...row }),
  removeSprint: (id: string) => remove("sprints", id),

  addItem: (sprintId: string, row: Partial<SprintItem>) =>
    add("sprint-items", { sprint_id: sprintId, ...row }),
  updateItem: (id: string, p: Partial<SprintItem>) => patch("sprint-items", id, p),
  removeItem: (id: string) => remove("sprint-items", id),

  addDemo: (teamId: string, row: Partial<DemoDay>) => add("demo-days", { team_id: teamId, ...row }),
  removeDemo: (id: string) => remove("demo-days", id),

  saveWiki: async (teamId: string, row: { id?: string; title: string; body: string }) => {
    const stamp = { title: row.title, body: row.body, updated_at: new Date().toISOString() };
    if (row.id) return patch("docs", row.id, stamp);
    return add("docs", { team_id: teamId, doc_type: "wiki", ...stamp });
  },
  removeDoc: (id: string) => remove("docs", id),

  uploadDoc: async (teamId: string, file: File) => {
    const path = `${teamId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file);
    if (up.error) throw new Error(up.error.message);
    await add("docs", {
      team_id: teamId,
      title: file.name,
      doc_type: "doc",
      storage_path: path,
      updated_at: new Date().toISOString(),
    });
  },

  docUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  addIdea: (teamId: string, title: string, description: string) =>
    add("ideas", { team_id: teamId, title, description, votes: 0, status: "parked" }),
  removeIdea: (id: string) => remove("ideas", id),

  /** One vote per voter per idea; votes column is recomputed from the vote rows. */
  voteIdea: async (ideaId: string) =>
    (await api.post<{ result: "voted" | "already" }>(`/ops/dev/ideas/${encodeURIComponent(ideaId)}/vote`))
      .result,
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
