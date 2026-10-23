import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Lightbulb, LayoutGrid } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { EmptyState, PageBody, PageHeader } from "@v3/ui/components/console/primitives";
import {
  PRIORITY_CHIP,
  TRACK_META,
  expectedPct,
  loadOverview,
  trackOf,
  weightedProgress,
  type Priority,
  type Project,
  type Sprint,
  type SprintItem,
} from "@v3/ops/lib/dev-progress";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/dev/board")({
  head: () => ({
    meta: [
      { title: "Launch board — SRP Dev Progress" },
      {
        name: "description",
        content:
          "Board view of every launch team: priorities and sprint items as colour-coded cards, grouped by team and sortable by priority or status.",
      },
      { property: "og:title", content: "Launch board — SRP Dev Progress" },
      {
        property: "og:description",
        content: "Team-by-team board of priorities and sprint items on the way to the Dec 1 Alpha.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevBoard,
});

const STATUS_CHIP: Record<string, string> = {
  not_started: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
  todo: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
  in_progress: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  blocked: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  done: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
};

type Card = {
  id: string;
  kind: "project" | "item";
  title: string;
  priority: Priority;
  status: string;
  deadline: string | null;
  progress: number | null;
  assignee: string | null;
  sprint: string | null;
};

async function loadBoard() {
  const [overview, sprintsRes, itemsRes] = await Promise.all([
    loadOverview(),
    supabase.from("exp_dev_sprints").select("*").order("start_date"),
    supabase.from("exp_dev_sprint_items").select("*"),
  ]);
  return {
    ...overview,
    sprints: (sprintsRes.data ?? []) as Sprint[],
    items: (itemsRes.data ?? []) as SprintItem[],
  };
}

const PRIO_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const STATUS_RANK: Record<string, number> = { blocked: 0, in_progress: 1, todo: 2, not_started: 3, done: 4 };

function BoardCard({ c }: { c: Card }) {
  return (
    <div className="rounded-[14px] border border-[color:var(--color-hairline)] bg-card p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start gap-2">
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", PRIORITY_CHIP[c.priority])}>
          {c.priority}
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink">{c.title}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide",
            STATUS_CHIP[c.status] ?? STATUS_CHIP.not_started,
          )}
        >
          {c.status.replace("_", " ")}
        </span>
        <span className="rounded-full bg-[color:var(--color-surface-2)] px-1.5 py-0.5 text-[color:var(--color-ink-3)]">
          {c.kind === "project" ? "priority" : (c.sprint ?? "sprint item")}
        </span>
        {c.deadline ? (
          <span className="text-[color:var(--color-ink-3)]">due {c.deadline}</span>
        ) : null}
        {c.assignee ? <span className="text-[color:var(--color-ink-3)]">{c.assignee}</span> : null}
      </div>
      {c.progress !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
          <div
            className="h-full rounded-full bg-[color:var(--color-g-blue)]"
            style={{ width: `${Math.min(100, Math.max(0, c.progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function DevBoard() {
  const { data, isLoading } = useQuery({ queryKey: ["dev-board"], queryFn: loadBoard });
  const [sortBy, setSortBy] = useState<"priority" | "status" | "deadline">("priority");
  const [prio, setPrio] = useState<string>("all");

  const expected = expectedPct(data?.launch ?? null);

  const columns = useMemo(() => {
    if (!data) return [];
    return data.teams
      .map((team) => {
        const projects = data.projects.filter((p: Project) => p.team_id === team.id);
        const sprintIds = data.sprints.filter((s) => s.team_id === team.id).map((s) => s.id);
        const sprintName = new Map(data.sprints.map((s) => [s.id, s.name]));
        const cards: Card[] = [
          ...projects.map((p) => ({
            id: `p-${p.id}`,
            kind: "project" as const,
            title: p.name,
            priority: (p.priority ?? "P2") as Priority,
            status: p.status ?? "not_started",
            deadline: p.deadline,
            progress: p.progress_pct ?? 0,
            assignee: null,
            sprint: null,
          })),
          ...data.items
            .filter((i) => i.sprint_id && sprintIds.includes(i.sprint_id))
            .map((i) => ({
              id: `i-${i.id}`,
              kind: "item" as const,
              title: i.title,
              priority: (i.priority ?? "P2") as Priority,
              status: i.status ?? "todo",
              deadline: null,
              progress: null,
              assignee: i.assignee,
              sprint: i.sprint_id ? (sprintName.get(i.sprint_id) ?? null) : null,
            })),
        ].filter((c) => prio === "all" || c.priority === prio);

        cards.sort((a, b) => {
          if (sortBy === "status")
            return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
              PRIO_RANK[a.priority] - PRIO_RANK[b.priority];
          if (sortBy === "deadline")
            return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
          return (
            PRIO_RANK[a.priority] - PRIO_RANK[b.priority] ||
            (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
          );
        });

        const progress = weightedProgress(projects);
        return { team, cards, progress, track: trackOf(progress, expected) };
      })
      .sort((a, b) => TRACK_META[a.track].rank - TRACK_META[b.track].rank);
  }, [data, sortBy, prio, expected]);

  return (
    <PageBody>
      <PageHeader
        eyebrow="SRP Dev Progress"
        title="Launch board"
        description="Every team as a column: its ranked priorities and live sprint items. Behind teams sort first — colour is the priority, the chip is the status."
        actions={
          <div className="flex items-center gap-2">
            <Select value={prio} onValueChange={setPrio}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p} only
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="priority">Sort by priority</SelectItem>
                <SelectItem value="status">Sort by status</SelectItem>
                <SelectItem value="deadline">Sort by deadline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[420px] w-[300px] animate-pulse rounded-[18px] bg-[color:var(--color-surface-2)]" />
          ))}
        </div>
      ) : columns.length === 0 ? (
        <EmptyState title="No teams yet" description="Teams come from exp_dev_teams." />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(({ team, cards, progress, track }) => (
            <section
              key={team.id}
              className="flex w-[320px] shrink-0 flex-col rounded-[18px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)]"
            >
              <header className="border-b border-[color:var(--color-hairline)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to="/dev/teams/$teamId"
                    params={{ teamId: team.id }}
                    className="truncate text-sm font-semibold text-ink hover:underline"
                  >
                    {team.name}
                  </Link>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", TRACK_META[track].chip)}>
                    {TRACK_META[track].label}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                    <div
                      className={cn("h-full rounded-full", TRACK_META[track].bar)}
                      style={{ width: `${progress ?? 0}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums text-[color:var(--color-ink-2)]">
                    {progress === null ? "—" : `${progress}%`}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-[color:var(--color-ink-3)]">
                  <span className="inline-flex items-center gap-1">
                    <LayoutGrid className="h-3 w-3" /> {cards.length} cards
                  </span>
                  <Link
                    to="/dev/teams/$teamId"
                    params={{ teamId: team.id }}
                    className="inline-flex items-center gap-1 font-semibold text-[color:var(--color-g-blue)] hover:underline"
                  >
                    <Lightbulb className="h-3 w-3" /> Parking lot
                  </Link>
                </div>
              </header>
              <div className="flex flex-col gap-2 p-3">
                {cards.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-[color:var(--color-ink-3)]">
                    No priorities or sprint items yet.
                  </p>
                ) : (
                  cards.map((c) => <BoardCard key={c.id} c={c} />)
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageBody>
  );
}
