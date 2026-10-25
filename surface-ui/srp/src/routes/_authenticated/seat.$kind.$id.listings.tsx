import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { ReadOnlyRow, SeatLoading } from "@v3/srp/components/seat/pieces";
import { Badge } from "@v3/ui/components/ui/badge";
import { loadLocationListings } from "@v3/srp/lib/seat";
import { useLocationSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/listings")({
  component: SeatListings,
});

function SeatListings() {
  const { id, isPro } = useSeatParams();
  const seatQ = useLocationSeat(id, !isPro);
  const listQ = useQuery({
    queryKey: ["seat-location-listings", id],
    queryFn: () => loadLocationListings(id),
    enabled: !isPro,
  });

  if (isPro) return <EmptyState title="Not available" description="Listings is a location-seat surface." />;
  if (seatQ.isLoading || listQ.isLoading) return <SeatLoading />;
  const seat = seatQ.data;
  if (!seat) return <EmptyState title="Location not found" />;
  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Location workspace"
        title="Listings"
        description={`Directory rows attached to ${seat.office.name}.`}
      />
      <ReadOnlyRow isDemo={seat.isDemo} />

      <Panel title="Name · address · phone source of truth">
        <ul className="space-y-2 text-sm text-[color:var(--color-ink-2)]">
          <li>{seat.office.name}</li>
          <li>
            {[seat.office.address_street, seat.office.address_city, seat.office.address_state, seat.office.address_zip]
              .filter(Boolean)
              .join(", ") || "No address captured"}
          </li>
          <li>{seat.office.phone ?? "No phone captured"}</li>
          <li className="text-xs text-[color:var(--color-ink-3)]">
            GBP {seat.office.gbp_connected ? "connected" : "not connected"} ·{" "}
            {seat.office.gbp_place_id ? "place id on file" : "no place id"}
          </li>
        </ul>
      </Panel>

      <Panel title={`${rows.length} listing${rows.length === 1 ? "" : "s"}`} bodyClassName={rows.length ? "p-0" : undefined}>
        {rows.length === 0 ? (
          <EmptyState
            compact
            title="No listing rows yet"
            description="Listings management stays frozen until this category's node registry is complete — connect a publisher to activate."
          />
        ) : (
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {rows.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {l.directory_name ?? l.directory_key ?? "Directory"}
                </span>
                <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                  {l.status ?? "unknown"}
                </Badge>
                {l.has_drift ? (
                  <Badge variant="secondary" className="border-0 bg-[color:var(--color-g-red-soft)] text-[10px] text-[#c5221f]">
                    drift
                  </Badge>
                ) : null}
                <span className="text-[11px] text-[color:var(--color-ink-3)]">
                  {l.last_verified ? new Date(l.last_verified).toLocaleDateString() : "never verified"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
