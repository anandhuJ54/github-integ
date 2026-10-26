import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import { EmptyState, PageBody, PageHeader, Panel } from "@v3/shared/components/ui/console-primitives";
import {
  PRIORITIES,
  PRIORITY_CHIP,
  TRACK_META,
  expectedPct,
  loadOverview,
  trackOf,
  type Priority,
} from "@v3/ops/utils/dev-progress";
import { cn } from "@v3/shared/components/utils/utils";

export const Route = createFileRoute("/_authenticated/dev/priorities")({
  head: () => ({
    meta: [
      { title: "Priority board — SRP Dev Progress" },
      {
        name: "description",
        content:
          "Every launch project across all teams grouped P0 to P3, with pace against the program calendar and team filters.",
      },
      { property: "og:title", content: "Priority board — SRP Dev Progress" },
      {
        property: "og:description",
        content: "Cross-team P0–P3 launch board with live progress and deadlines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PriorityBoard,
});

export function PriorityBoard() {
  const { data, isLoading } = useQuery({ queryKey: ["dev-overview"], queryFn: loadOverview });
  const [team, setTeam] = useState("all");
  const [status, setStatus] = useState("all");

  const expected = expectedPct(data?.launch ?? null);

  const grouped = useMemo(() => {
    const rows = (data?.projects ?? []).filter(
      (p) =>
        (team === "all" || p.team_id === team) && (status === "all" || (p.status ?? "not_started") === status),
    );
    return PRIORITIES.map((pr) => ({
      priority: pr,
      rows: rows
        .filter((p) => (p.priority ?? "P2") === pr)
        .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")),
    }));
  }, [data, team, status]);

  const teamName = (id: string | null) => data?.teams.find((t) => t.id === id)?.name ?? "Unassigned";

  return (
    <PageBody>
      <PageHeader
        eyebrow="SRP Dev Progress"
        title="Priority board"
        description="Everything that must ship for Alpha, grouped by priority across every team. Colour reflects pace against the share of the program calendar already spent."
        actions={
          <div className="flex gap-2">
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {(data?.teams ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="space-y-6">
        {grouped.map((g) => (
          <Panel
            key={g.priority}
            title={`${g.priority} — ${g.rows.length} project${g.rows.length === 1 ? "" : "s"}`}
            description={
              g.priority === "P0"
                ? "Launch blockers. Nothing ships without these."
                : g.priority === "P1"
                  ? "Required for a credible Alpha."
                  : g.priority === "P2"
                    ? "Valuable, cut if the calendar tightens."
                    : "Nice to have."
            }
          >
            {isLoading ? (
              <div className="h-16 animate-pulse rounded-lg bg-[color:var(--color-surface-2)]" />
            ) : !g.rows.length ? (
              <EmptyState title="Nothing at this priority" compact />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.rows.map((p) => {
                  const track = trackOf(p.progress_pct ?? 0, expected);
                  return (
                    <Link
                      key={p.id}
                      to="/dev/teams/$teamId"
                      params={{ teamId: p.team_id ?? "" }}
                      className="rounded-[16px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-4 transition-shadow hover:shadow-[var(--shadow-sm)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{p.name}</p>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                            PRIORITY_CHIP[(p.priority ?? "P2") as Priority],
                          )}
                        >
                          {p.priority ?? "P2"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[color:var(--color-ink-2)]">
                        {teamName(p.team_id)} · due {p.deadline ?? "—"} · {p.status ?? "not_started"}
                      </p>
                      {p.success_criteria ? (
                        <p className="mt-2 line-clamp-2 text-xs text-[color:var(--color-ink-3)]">
                          {p.success_criteria}
                        </p>
                      ) : null}
                      <div className="mt-3 flex items-center gap-3">
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white">
                          <div
                            className={cn("h-full rounded-full", TRACK_META[track].bar)}
                            style={{ width: `${p.progress_pct ?? 0}%` }}
                          />
                          <div
                            className="absolute inset-y-0 w-[2px] bg-ink/60"
                            style={{ left: `${expected}%` }}
                          />
                        </div>
                        <span className={cn("text-xs font-semibold", TRACK_META[track].text)}>
                          {p.progress_pct ?? 0}%
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Panel>
        ))}
      </div>
    </PageBody>
  );
}
