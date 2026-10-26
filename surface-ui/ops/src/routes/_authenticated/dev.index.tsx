import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CalendarClock, Flag, Rocket, Users2 } from "lucide-react";
import { EmptyState, PageBody, PageHeader, Panel, StatTile } from "@v3/ui/components/console/primitives";
import { NeedsYouBanner } from "@v3/ops/components/dev/needs-you-banner";
import {
  PRIORITY_CHIP,
  TRACK_META,
  daysToLaunch,
  expectedPct,
  loadOverview,
  trackOf,
  weightedProgress,
  type Priority,
  type Project,
} from "@v3/ops/lib/dev-progress";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/dev/")({
  head: () => ({
    meta: [
      { title: "SRP Dev Progress — Experience.com Console" },
      {
        name: "description",
        content:
          "Live countdown to the Dec 1, 2026 Alpha launch with weighted readiness, expected-vs-actual pace and per-team status.",
      },
      { property: "og:title", content: "SRP Dev Progress — Experience.com Console" },
      {
        property: "og:description",
        content: "Weighted launch readiness and team-by-team pace toward the Alpha launch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevOverview,
});

export default function DevOverview() {
  const { data, isLoading } = useQuery({ queryKey: ["dev-overview"], queryFn: loadOverview });

  const launch = data?.launch ?? null;
  const expected = expectedPct(launch);
  const overall = weightedProgress(data?.projects ?? []);
  const overallTrack = trackOf(overall, expected);
  const days = daysToLaunch(launch);

  const teamCards = useMemo(() => {
    if (!data) return [];
    return data.teams
      .map((t) => {
        const projects = data.projects.filter((p) => p.team_id === t.id);
        const actual = weightedProgress(projects);
        const track = trackOf(actual, expected);
        const members = data.members.filter((m) => m.team_id === t.id);
        const nextDemo = data.demos
          .filter((d) => d.team_id === t.id && d.demo_date >= new Date().toISOString().slice(0, 10))
          .sort((a, b) => a.demo_date.localeCompare(b.demo_date))[0];
        return { team: t, projects, actual, track, members, nextDemo };
      })
      .sort(
        (a, b) =>
          TRACK_META[a.track].rank - TRACK_META[b.track].rank ||
          (a.actual ?? 0) - (b.actual ?? 0) ||
          (a.team.sort_order ?? 0) - (b.team.sort_order ?? 0),
      );
  }, [data, expected]);

  const counts = useMemo(() => {
    const c: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const p of data?.projects ?? []) c[(p.priority ?? "P2") as Priority] += 1;
    return c;
  }, [data]);

  return (
    <PageBody>
      <PageHeader
        eyebrow="SRP Dev Progress"
        title={`${launch?.phase ?? "Alpha"} launch — ${launch?.launch_date ?? "date not set"}`}
        description="Every team, project and sprint that has to land before launch. Progress is weighted by priority (P0 ×4 → P3 ×1) and compared with the share of the program calendar already spent."
      />

      <NeedsYouBanner />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Days to launch"
          value={days === null ? "—" : days}
          hint={launch ? `Program started ${launch.program_start}` : undefined}
          icon={<CalendarClock className="h-4 w-4" />}
          tone={days !== null && days < 45 ? "red" : "blue"}
          loading={isLoading}
        />
        <StatTile
          label="Ready to launch"
          value={overall === null ? "—" : `${overall}%`}
          hint={`Calendar spent ${expected.toFixed(1)}% · ${TRACK_META[overallTrack].label}`}
          icon={<Rocket className="h-4 w-4" />}
          tone={overallTrack === "behind" ? "red" : overallTrack === "ahead" ? "green" : "yellow"}
          loading={isLoading}
        />
        <StatTile
          label="Projects in flight"
          value={data?.projects.length ?? 0}
          hint={`P0 ${counts.P0} · P1 ${counts.P1} · P2 ${counts.P2} · P3 ${counts.P3}`}
          icon={<Flag className="h-4 w-4" />}
          tone="purple"
          loading={isLoading}
        />
        <StatTile
          label="Teams staffed"
          value={`${data?.members.length ?? 0}/${(data?.teams ?? []).reduce((s, t) => s + (t.target_size ?? 0), 0)}`}
          hint={`${data?.teams.length ?? 0} teams`}
          icon={<Users2 className="h-4 w-4" />}
          tone="neutral"
          loading={isLoading}
        />
      </div>

      <div className="mt-8">
        <Panel
          title="Weighted launch readiness"
          description="Actual weighted progress versus the expected pace marker for today."
        >
          <div className="relative h-6 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
            <div
              className={cn("h-full rounded-full transition-[width]", TRACK_META[overallTrack].bar)}
              style={{ width: `${overall ?? 0}%` }}
            />
            <div
              className="absolute inset-y-0 w-[2px] bg-ink"
              style={{ left: `${expected}%` }}
              title={`Expected ${expected.toFixed(1)}%`}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[color:var(--color-ink-2)]">
            <span className={cn("rounded-full px-2 py-0.5 font-semibold", TRACK_META[overallTrack].chip)}>
              {TRACK_META[overallTrack].label}
            </span>
            <span>Actual {overall === null ? "—" : `${overall}%`}</span>
            <span>Expected {expected.toFixed(1)}%</span>
            <span className="text-[color:var(--color-ink-3)]">
              Ahead = +10pts or better · Behind = −10pts or worse
            </span>
          </div>
        </Panel>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink">Teams — behind first</h2>
      {!isLoading && !teamCards.length ? (
        <EmptyState title="No teams yet" description="Teams live in the development program tables." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teamCards.map(({ team, projects, actual, track, members, nextDemo }) => (
            <Link
              key={team.id}
              to="/dev/teams/$teamId"
              params={{ teamId: team.id }}
              className="rounded-[20px] border border-[color:var(--color-hairline)] bg-card p-5 shadow-[var(--shadow-xs)] transition-shadow hover:shadow-[var(--shadow-md)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{team.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[color:var(--color-ink-2)]">
                    {team.lane}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider",
                    TRACK_META[track].chip,
                  )}
                >
                  {TRACK_META[track].label}
                </span>
              </div>

              <p className={cn("mt-4 text-[34px] font-semibold leading-none", TRACK_META[track].text)}>
                {actual === null ? "—" : `${actual}%`}
              </p>
              <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                <div
                  className={cn("h-full rounded-full", TRACK_META[track].bar)}
                  style={{ width: `${actual ?? 0}%` }}
                />
                <div className="absolute inset-y-0 w-[2px] bg-ink/70" style={{ left: `${expected}%` }} />
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <dt className="text-[color:var(--color-ink-3)]">Projects</dt>
                  <dd className="font-semibold text-ink">{projects.length}</dd>
                </div>
                <div>
                  <dt className="text-[color:var(--color-ink-3)]">Staffed</dt>
                  <dd className="font-semibold text-ink">
                    {members.length}/{team.target_size ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[color:var(--color-ink-3)]">Next demo</dt>
                  <dd className="font-semibold text-ink">{nextDemo?.demo_date ?? "—"}</dd>
                </div>
              </dl>

              {projects.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {projects.slice(0, 4).map((p: Project) => (
                    <span
                      key={p.id}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        PRIORITY_CHIP[(p.priority ?? "P2") as Priority],
                      )}
                    >
                      {p.priority ?? "P2"} · {p.progress_pct ?? 0}%
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-xs text-[color:var(--color-ink-3)]">
                  No projects defined — open the team to add the first one.
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </PageBody>
  );
}
