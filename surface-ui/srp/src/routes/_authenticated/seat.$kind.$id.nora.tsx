/**
 * Professional seat "Nora" → the Happyflow Search Rank Score screen (screen 6). A real seat's page reads its SRS data from the local
 * database (srp/srs-page-schema); with no data, or when the read fails, it is the prototype's sample page.
 */
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { HfSrsModelProvider } from "@v3/srp/components/happyflow/srs-context";
import { SrsForSeat } from "@v3/srp/components/happyflow/srs-page";
import { SeatLoading } from "@v3/srp/components/seat/pieces";
import { srsModel, useSrsApi } from "@v3/srp/utils/srs-model";
import { waitingForSeat } from "@v3/srp/utils/seat-wait";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/nora")({
  component: SeatNora,
});

function SeatNora() {
  const { isPro, id } = useSeatParams();
  // Read once per professional seat; a failure or a seat with no SRS data falls back to the sample view.
  const srsQ = useSrsApi(id, isPro);
  const model = useMemo(() => srsModel(isPro ? srsQ.data : null), [isPro, srsQ.data]);
  if (!isPro)
    return <EmptyState title="Not available" description="Nora is a professional-seat surface." />;
  if (waitingForSeat(isPro, srsQ.status)) return <SeatLoading />;
  return (
    <HfSrsModelProvider model={model}>
      <SrsForSeat />
    </HfSrsModelProvider>
  );
}
