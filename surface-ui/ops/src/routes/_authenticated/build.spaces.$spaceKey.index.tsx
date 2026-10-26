import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { EmptyState, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { useSpaceData } from "@v3/ops/components/build/wiki-bits";
import { createDoc, isWatching, teamForSpace, toggleWatch } from "@v3/ops/lib/build-wiki";
import { TRACK_META, expectedPct, loadOverview, trackOf, weightedProgress } from "@v3/ops/lib/dev-progress";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/build/spaces/$spaceKey/")({
  component: SpaceHome,
});

function SpaceHome() {
  const { spaceKey } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { space, tree } = useSpaceData(spaceKey);
  const overview = useQuery({ queryKey: ["dev-overview"], queryFn: loadOverview });
  const s = space.data;
  const watching = useQuery({
    queryKey: ["wiki-watch", "space", s?.id],
    queryFn: () => isWatching({ spaceId: s!.id }),
    enabled: !!s?.id,
  });
  const watch = useMutation({
    mutationFn: () => toggleWatch({ spaceId: s!.id }),
    onSuccess: (on) => {
      qc.invalidateQueries({ queryKey: ["wiki-watch", "space", s?.id] });
      toast.success(on ? "Watching this space" : "Stopped watching");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: (title: string) => createDoc({ spaceId: s!.id, title }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["wiki-tree", s?.id] });
      qc.invalidateQueries({ queryKey: ["wiki-spaces"] });
      navigate({ to: "/build/spaces/$spaceKey/$slug", params: { spaceKey, slug: doc.slug }, search: { edit: true } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!s) return null;

  const docs = tree.data?.docs ?? [];
  const pinned = docs.filter((d) => d.is_pinned);
  const recent = [...docs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);
  const team = overview.data ? teamForSpace(s, overview.data.teams) : null;
  const projects = team ? (overview.data?.projects ?? []).filter((p) => p.team_id === team.id) : [];
  const expected = expectedPct(overview.data?.launch ?? null);
  const actual = weightedProgress(projects);
  const track = trackOf(actual, expected);

  return (
    <div>
      <PageHeader
        eyebrow="Space"
        title={s.name}
        description={s.description ?? undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => watch.mutate()} disabled={watch.isPending}>
              {watching.data ? <EyeOff className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}
              {watching.data ? "Unwatch" : "Watch space"}
            </Button>
            <Button
              size="sm"
              disabled={create.isPending}
              onClick={() => {
                const t = window.prompt("New page title");
                if (t?.trim()) create.mutate(t.trim());
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New page
            </Button>
          </>
        }
      />

      {team ? (
        <Panel
          className="mb-6"
          title={`Delivery — ${team.name}`}
          description={`${projects.length} projects · expected ${expected.toFixed(1)}% today`}
          actions={
            <Link to="/dev/teams/$teamId" params={{ teamId: team.id }} className="text-xs font-medium text-[color:var(--color-g-blue)]">
              Open team
            </Link>
          }
        >
          <div className="flex items-center gap-3">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", TRACK_META[track].chip)}>{TRACK_META[track].label}</span>
            <span className="text-sm font-semibold tabular-nums text-ink">{actual === null ? "—" : `${actual}%`}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
              <div className={cn("h-full", TRACK_META[track].bar)} style={{ width: `${actual ?? 0}%` }} />
            </div>
          </div>
          {projects.length ? (
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id} className="flex justify-between gap-2 text-xs">
                  <span className="truncate text-ink">{p.priority ?? "P2"} · {p.name}</span>
                  <span className="tabular-nums text-[color:var(--color-ink-2)]">{p.progress_pct ?? 0}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">No projects for this team yet.</p>
          )}
        </Panel>
      ) : null}

      {!docs.length && !tree.isLoading ? (
        <EmptyState title="No pages in this space yet" description="Create the first page to start this space's knowledge base." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Pinned">
            {pinned.length ? (
              <DocList spaceKey={spaceKey} docs={pinned} />
            ) : (
              <p className="text-xs text-[color:var(--color-ink-3)]">Nothing pinned.</p>
            )}
          </Panel>
          <Panel title="Recently updated">
            <DocList spaceKey={spaceKey} docs={recent} showDate />
          </Panel>
        </div>
      )}
    </div>
  );
}

function DocList({ spaceKey, docs, showDate }: { spaceKey: string; docs: { id: string; slug: string; title: string; summary: string | null; updated_at: string }[]; showDate?: boolean }) {
  return (
    <ul className="space-y-2">
      {docs.map((d) => (
        <li key={d.id}>
          <Link to="/build/spaces/$spaceKey/$slug" params={{ spaceKey, slug: d.slug }} className="block rounded-md p-1.5 hover:bg-[color:var(--color-surface-2)]">
            <div className="flex justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">{d.title}</span>
              {showDate ? <span className="shrink-0 text-[11px] text-[color:var(--color-ink-3)]">{d.updated_at.slice(0, 10)}</span> : null}
            </div>
            {d.summary ? <p className="line-clamp-1 text-xs text-[color:var(--color-ink-2)]">{d.summary}</p> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
