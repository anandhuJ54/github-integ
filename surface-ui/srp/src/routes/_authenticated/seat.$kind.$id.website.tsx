/**
 * Website Analytics (screen 9) — Happyflow prototype screen in the professional seat. A real seat's page reads its site, gauge, ten audit checks, tiles, top fix and NORA's notes
 * from the local database (srp/web-analytics-page-schema), read-only: Re-check, Send to my webmaster, Copy code and the hand-off steps only change what the browser shows.
 * With no data, or when the read fails, it is the prototype's sample page.
 */
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { HfWebAnalyticsModelProvider } from "@v3/srp/components/happyflow/web-analytics-context";
import { WebAnalyticsForSeat } from "@v3/srp/components/happyflow/web-analytics-page";
import { SeatLoading } from "@v3/srp/components/seat/pieces";
import { waitingForSeat } from "@v3/srp/utils/seat-wait";
import { useWebAnalyticsApi, webAnalyticsModel } from "@v3/srp/utils/web-analytics-model";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/website")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro, id } = useSeatParams();
  // Read once per professional seat; a failure or a seat with no Web analytics data falls back to the sample view.
  const webQ = useWebAnalyticsApi(id, isPro);
  const model = useMemo(
    () => webAnalyticsModel(isPro ? webQ.data : null, id),
    [isPro, webQ.data, id],
  );
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  if (waitingForSeat(isPro, webQ.status)) return <SeatLoading />;
  return (
    <HfWebAnalyticsModelProvider model={model}>
      <WebAnalyticsForSeat />
    </HfWebAnalyticsModelProvider>
  );
}
