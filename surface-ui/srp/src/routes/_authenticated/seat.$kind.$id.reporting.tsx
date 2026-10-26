import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, PageHeader, Panel, StatTile } from "@v3/ui/components/console/primitives";
import { CoverageBars, ReadOnlyRow, ScoreCard, SeatLoading } from "@v3/srp/components/seat/pieces";
import { PersonAvatar } from "@v3/ui/components/sales/entity-avatar";
import { rosterCoverage, seatProName } from "@v3/srp/lib/seat";
import { useLocationSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/reporting")({
  component: SeatReporting,
});

function SeatReporting() {
  const { id, isPro } = useSeatParams();
  const q = useLocationSeat(id, !isPro);

  if (isPro) return <EmptyState title="Not available" description="Reporting is a location-seat surface." />;
  if (q.isLoading) return <SeatLoading />;
  const seat = q.data;
  if (!seat) return <EmptyState title="Location not found" />;

  const cov = rosterCoverage(seat.pros);
  const scored = seat.pros.filter((p) => p.search_rank_score != null);
  const avg =
    scored.length > 0
      ? Math.round(scored.reduce((s, p) => s + (p.search_rank_score ?? 0), 0) / scored.length)
      : null;
  const reviewCount = seat.proRatings.reduce((s, r) => s + (r.review_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Location workspace"
        title="Reporting"
        description={`Everything below is computed from ${seat.office.name} and its roster only.`}
      />
      <ReadOnlyRow isDemo={seat.isDemo} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Roster size" value={cov.total.toLocaleString()} />
        <StatTile label="Avg roster score" value={avg ?? "—"} tone="purple" hint={avg == null ? "No scored professionals" : `${scored.length} scored`} />
        <StatTile label="Claim rate" value={cov.total ? `${Math.round((cov.claimed / cov.total) * 100)}%` : "—"} tone="green" />
        <StatTile label="Roster reviews" value={reviewCount.toLocaleString()} tone="yellow" hint={reviewCount === 0 ? "Instrument review sync to activate" : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ScoreCard score={seat.score} fallbackScore={seat.office.search_rank_score} title="Location Search Rank" />
        <Panel title="Coverage" description="Hydration/completeness of this roster.">
          {cov.total === 0 ? (
            <EmptyState compact title="No professionals attached" />
          ) : (
            <CoverageBars
              total={cov.total}
              rows={[
                ["Claimed", cov.claimed],
                ["Photo", cov.photo],
                ["Bio", cov.bio],
                ["Scored", cov.scored],
              ]}
            />
          )}
        </Panel>
      </div>

      <Panel title="Top of roster by score" bodyClassName={scored.length ? "p-0" : undefined}>
        {scored.length === 0 ? (
          <EmptyState compact title="No scored professionals" description="The scoring engine has not reached this roster." />
        ) : (
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {scored.slice(0, 15).map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                <span className="w-5 text-xs text-[color:var(--color-ink-3)]">{i + 1}</span>
                <PersonAvatar name={seatProName(p)} photoUrl={p.photo_url} size="xs" />
                <span className="min-w-0 flex-1 truncate text-ink">{seatProName(p)}</span>
                <span className="font-semibold text-ink">{p.search_rank_score}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
