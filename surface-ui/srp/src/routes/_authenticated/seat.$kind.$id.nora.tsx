import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { EmptyState, PageHeader, Panel, StatTile } from "@v3/shared/components/ui/console-primitives";
import { ReadOnlyRow, ScoreCard, SeatLoading } from "@v3/srp/components/seat/pieces";
import { Badge } from "@v3/shared/components/ui/badge";
import { nextMoves, ringLabel, ringSummary, seatProName } from "@v3/srp/utils/seat";
import { useProfessionalSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/nora")({
  component: SeatNora,
});

function SeatNora() {
  const { id, isPro } = useSeatParams();
  const q = useProfessionalSeat(id, isPro);

  if (!isPro) return <EmptyState title="Not available" description="Nora is a professional-seat surface." />;
  if (q.isLoading) return <SeatLoading />;
  const seat = q.data;
  if (!seat) return <EmptyState title="Professional not found" />;

  const moves = nextMoves(seat);
  const rings = ringSummary(seat.nodes);
  const emptyRings = [1, 2, 3, 4, 5, 6, 7, 8].filter((r) => !rings.some((x) => x.ring === r));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My workspace"
        title="Nora"
        description={`See → say → act. What is costing ${seatProName(seat.pro)} points right now, in order.`}
      />
      <ReadOnlyRow isDemo={seat.isDemo} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Open moves" value={moves.length} icon={<Sparkles className="h-4 w-4" />} />
        <StatTile label="Empty rings" value={emptyRings.length} tone="yellow" hint={emptyRings.map((r) => ringLabel(r)).join(", ") || "None"} />
        <StatTile
          label="Points to next milestone"
          value={seat.score?.next_milestone_gap ?? "—"}
          tone="green"
          hint={seat.score?.next_milestone != null ? `Milestone ${seat.score.next_milestone}` : "No milestone on file"}
        />
      </div>

      <Panel title="Next moves" description="Each item is a measured gap in live data — never a fabricated recommendation.">
        {moves.length === 0 ? (
          <EmptyState compact title="Nothing outstanding" description="No measurable gaps right now." />
        ) : (
          <ol className="space-y-2">
            {moves.map((m, i) => (
              <li
                key={`${m.title}-${i}`}
                className="flex items-start gap-3 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2.5"
              >
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)] text-[11px] font-bold text-[color:var(--color-g-blue)]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{m.title}</span>
                  <span className="block text-xs text-[color:var(--color-ink-2)]">{m.detail}</span>
                </span>
                <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                  {m.points != null ? `+${m.points} pts` : m.ring}
                </Badge>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <ScoreCard score={seat.score} fallbackScore={seat.pro.search_rank_score} title="Where the points are" />
    </div>
  );
}
