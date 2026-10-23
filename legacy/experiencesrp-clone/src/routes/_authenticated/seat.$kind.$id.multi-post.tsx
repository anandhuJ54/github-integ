import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, PageHeader, Panel } from "@/components/console/primitives";
import { ReadOnlyRow, SeatLoading } from "@/components/seat/pieces";
import { PersonAvatar } from "@/components/sales/entity-avatar";
import { seatProName } from "@/lib/seat";
import { useLocationSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/multi-post")({
  component: SeatMultiPost,
});

function SeatMultiPost() {
  const { id, isPro } = useSeatParams();
  const q = useLocationSeat(id, !isPro);

  if (isPro) return <EmptyState title="Not available" description="Multi-Post is a location-seat surface." />;
  if (q.isLoading) return <SeatLoading />;
  const seat = q.data;
  if (!seat) return <EmptyState title="Location not found" />;

  const connected = seat.office.gbp_connected ? 1 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Location workspace"
        title="Multi-Post"
        description={`Publish targets for ${seat.office.name} only. Read-only seat — composing and sending is disabled.`}
      />
      <ReadOnlyRow isDemo={seat.isDemo} />

      <Panel title="Publish targets" description="Only surfaces this location has an active connection to can receive a post.">
        {connected === 0 ? (
          <EmptyState
            compact
            title="No connected surface"
            description="This location has no connected Google Business Profile or social surface, so there is nothing to post to yet."
          />
        ) : (
          <ul className="space-y-2 text-sm text-ink">
            <li className="flex items-center gap-2 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2">
              Google Business Profile
              <span className="ml-auto text-xs text-[#1e8e3e]">connected</span>
            </li>
          </ul>
        )}
      </Panel>

      <Panel
        title="Audience"
        description={`${seat.pros.length} professional${seat.pros.length === 1 ? "" : "s"} at this location would be included in a roster post.`}
      >
        {seat.pros.length === 0 ? (
          <EmptyState compact title="No professionals attached" />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {seat.pros.slice(0, 24).map((p) => (
              <li
                key={p.id}
                className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-hairline)] px-2 py-1 text-xs text-ink"
              >
                <PersonAvatar name={seatProName(p)} photoUrl={p.photo_url} size="xs" />
                {seatProName(p)}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
