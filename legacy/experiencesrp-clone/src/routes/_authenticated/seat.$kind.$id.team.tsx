import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, PageHeader, Panel } from "@/components/console/primitives";
import { CoverageBars, ReadOnlyRow, SeatLoading } from "@/components/seat/pieces";
import { PersonAvatar } from "@/components/sales/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { rosterCoverage, seatProName } from "@/lib/seat";
import { useLocationSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/team")({
  component: SeatTeam,
});

function SeatTeam() {
  const { id, isPro } = useSeatParams();
  const q = useLocationSeat(id);
  const seat = q.data;

  if (isPro) return <EmptyState title="Not available" description="Team is a location-seat surface." />;
  if (q.isLoading) return <SeatLoading />;
  if (!seat) return <EmptyState title="Location not found" />;

  const cov = rosterCoverage(seat.pros);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Location workspace"
        title="Team"
        description={`Professionals attached to ${seat.office.name}. Nothing outside this location is visible.`}
      />
      <ReadOnlyRow isDemo={seat.isDemo} />

      <Panel title="Roster completeness">
        {cov.total === 0 ? (
          <EmptyState compact title="No professionals attached" />
        ) : (
          <CoverageBars
            total={cov.total}
            rows={[
              ["Claimed", cov.claimed],
              ["Photo", cov.photo],
              ["Bio", cov.bio],
              ["Title / headline", cov.title],
              ["Contact on file", cov.contact],
              ["Scored", cov.scored],
            ]}
          />
        )}
      </Panel>

      <Panel title={`${cov.total} professional${cov.total === 1 ? "" : "s"}`} bodyClassName="p-0">
        {cov.total === 0 ? (
          <div className="p-6">
            <EmptyState compact title="No professionals attached" />
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {seat.pros.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                <PersonAvatar name={seatProName(p)} photoUrl={p.photo_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/seat/$kind/$id"
                    params={{ kind: "professional", id: p.id }}
                    search={{}}
                    className="block truncate text-sm font-medium text-[color:var(--color-g-blue)]"
                  >
                    {seatProName(p)}
                  </Link>
                  <span className="block truncate text-[11px] text-[color:var(--color-ink-3)]">
                    {p.job_title ?? p.headline ?? "—"} · {p.email ?? p.phone ?? "no contact"}
                  </span>
                </div>
                <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                  {p.claimed ? "claimed" : "unclaimed"}
                </Badge>
                <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                  {p.search_rank_score ?? "unscored"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
