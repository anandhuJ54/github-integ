import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, PageHeader } from "@v3/ui/components/console/primitives";
import { RatingSummary, ReadOnlyRow, ReviewList, SeatLoading } from "@v3/xmp/components/seat/pieces";
import { useLocationSeat, useProfessionalSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/reviews")({
  component: SeatReviews,
});

function SeatReviews() {
  const { id, isPro } = useSeatParams();
  const locQ = useLocationSeat(isPro ? "" : id);
  const proQ = useProfessionalSeat(isPro ? id : "");
  const loading = isPro ? proQ.isLoading : locQ.isLoading;

  if (loading) return <SeatLoading />;

  if (isPro) {
    const seat = proQ.data;
    if (!seat) return <EmptyState title="Professional not found" />;
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="My workspace" title="Reviews" description="Reviews written about me only." />
        <ReadOnlyRow isDemo={seat.isDemo} />
        <RatingSummary ratings={seat.ratings} title="My rating" />
        <ReviewList reviews={seat.reviews} title="All reviews on file" />
      </div>
    );
  }

  const seat = locQ.data;
  if (!seat) return <EmptyState title="Location not found" />;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Location workspace"
        title="Reviews"
        description={`Reviews for ${seat.office.name} and the professionals at this location.`}
      />
      <ReadOnlyRow isDemo={seat.isDemo} />
      <div className="grid gap-6 lg:grid-cols-2">
        <RatingSummary ratings={seat.ratings} title="Location rating" />
        <RatingSummary ratings={seat.proRatings} title="Roster ratings" />
      </div>
      <ReviewList reviews={seat.reviews} title="Recent reviews" />
    </div>
  );
}
