import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageBody, PageHeader, Panel } from "@v3/shared/components/ui/console-primitives";
import { loadOverview, weightedProgress } from "@v3/ops/utils/dev-progress";

export const Route = createFileRoute("/_authenticated/build/teams")({
  head: () => ({
    meta: [
      { title: "Teams & People — Build" },
      { name: "description", content: "Every development team, its lane owner and roster." },
      { property: "og:title", content: "Teams & People — Build" },
      { property: "og:description", content: "Every development team, its lane owner and roster." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["dev-overview"], queryFn: loadOverview });
  const teams = data?.teams ?? [];
  return (
    <PageBody>
      <PageHeader eyebrow="Build" title="Teams & People" description="Roster, roles and the owner of each lane." />
      {isLoading ? (
        <p className="text-sm text-[color:var(--color-ink-3)]">Loading…</p>
      ) : !teams.length ? (
        <EmptyState title="No teams yet" description="Teams appear here once they exist in the development program." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const members = (data?.members ?? []).filter((m) => m.team_id === t.id);
            const pct = weightedProgress((data?.projects ?? []).filter((p) => p.team_id === t.id));
            return (
              <Panel
                key={t.id}
                title={t.name}
                description={[t.lane, t.leader ? `Owner: ${t.leader}` : null].filter(Boolean).join(" · ") || undefined}
                actions={
                  <Link to="/dev/teams/$teamId" params={{ teamId: t.id }} className="text-xs font-medium text-[color:var(--color-g-blue)]">
                    Open
                  </Link>
                }
              >
                <p className="mb-3 text-xs text-[color:var(--color-ink-3)]">
                  {members.length}/{t.target_size ?? "—"} staffed · {pct === null ? "—" : `${pct}%`} ready
                </p>
                {members.length ? (
                  <ul className="space-y-1.5">
                    {members.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-ink">
                          {m.name}
                          {m.is_lead ? <span className="ml-1.5 text-[10px] font-bold uppercase text-[color:var(--color-g-blue)]">Lead</span> : null}
                        </span>
                        <span className="shrink-0 text-xs capitalize text-[color:var(--color-ink-2)]">{m.role}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[color:var(--color-ink-3)]">No members yet.</p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
