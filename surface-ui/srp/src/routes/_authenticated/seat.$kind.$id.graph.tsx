import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ExternalLink, Network } from "lucide-react";
import { ExpertiseGraphPage } from "@v3/srp/components/graph/expertise-graph-page";
import { EmptyState, PageHeader, Panel, StatTile } from "@v3/shared/components/ui/console-primitives";
import { ReadOnlyRow, SeatLoading } from "@v3/srp/components/seat/pieces";
import { Badge } from "@v3/shared/components/ui/badge";
import { ringSummary, seatProName } from "@v3/srp/utils/seat";
import { useProfessionalSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/graph")({
  component: SeatGraph,
});

function SeatGraph() {
  const { id, isPro } = useSeatParams();
  const q = useProfessionalSeat(id, isPro);
  const [radial, setRadial] = useState(false);

  if (!isPro) return <EmptyState title="Not available" description="The expertise graph is a professional-seat surface." />;
  if (q.isLoading) return <SeatLoading />;
  const seat = q.data;
  if (!seat) return <EmptyState title="Professional not found" />;

  // The full radial view opens inside the seat's main content, not a new tab.
  if (radial && seat.pro.slug)
    return (
      <ExpertiseGraphPage
        kind="professional"
        slug={seat.pro.slug}
        embedded
        onBack={() => setRadial(false)}
      />
    );

  const rings = ringSummary(seat.nodes);
  const points = seat.nodes.reduce((s, n) => s + (n.score_points ?? 0), 0);
  const verified = seat.nodes.filter((n) => n.verified).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My workspace"
        title="Expertise graph"
        description={`Every active node captured for ${seatProName(seat.pro)}. Scoped to me only.`}
        actions={
          seat.pro.slug ? (
            <button
              type="button"
              onClick={() => setRadial(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--color-g-blue)]"
            >
              Full radial view <Network className="h-3.5 w-3.5" />
            </button>
          ) : null
        }
      />
      <ReadOnlyRow isDemo={seat.isDemo} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active nodes" value={seat.nodes.length.toLocaleString()} />
        <StatTile label="Rings populated" value={`${rings.length} / 8`} tone="purple" />
        <StatTile label="Node points" value={points.toLocaleString()} tone="green" />
        <StatTile label="Verified nodes" value={verified.toLocaleString()} tone="yellow" />
      </div>

      {rings.length === 0 ? (
        <EmptyState title="No captured nodes" description="Hydration has not reached this profile yet." />
      ) : (
        rings.map((r) => {
          const nodes = seat.nodes.filter((n) => (n.ring ?? 0) === r.ring);
          return (
            <Panel
              key={r.ring}
              title={r.label}
              description={`${nodes.length} node${nodes.length === 1 ? "" : "s"} · ${r.points} points`}
            >
              <ul className="grid gap-2 md:grid-cols-2">
                {nodes.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center gap-2 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2"
                  >
                    <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                      {n.node_type ?? "node"}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{n.title ?? "—"}</span>
                    {n.url ? (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[color:var(--color-g-blue)]"
                        aria-label="Open source"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <span className="text-[11px] text-[color:var(--color-ink-3)]">{n.source ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })
      )}
    </div>
  );
}
