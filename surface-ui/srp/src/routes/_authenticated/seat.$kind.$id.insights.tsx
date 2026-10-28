/**
 * Insights › Competitors (screen 10) — Happyflow prototype screen in the professional seat. A real seat's page reads its figures, map, AI citations and
 * competitors from the local database (srp/insights-page-schema), read-only: the question, "Add a competitor" and the selected spot only change what the
 * browser shows. With no data, or when the read fails, it is the prototype's sample page.
 */
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { HfInsightsModelProvider } from "@v3/srp/components/happyflow/insights-context";
import { InsightsForSeat } from "@v3/srp/components/happyflow/insights-page";
import { SeatLoading } from "@v3/srp/components/seat/pieces";
import { insightsModel, useInsightsApi } from "@v3/srp/utils/insights-model";
import { waitingForSeat } from "@v3/srp/utils/seat-wait";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/insights")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro, id } = useSeatParams();
  // Read once per professional seat; a failure or a seat with no Insights data falls back to the sample view.
  const insightsQ = useInsightsApi(id, isPro);
  const model = useMemo(
    () => insightsModel(isPro ? insightsQ.data : null, id),
    [isPro, insightsQ.data, id],
  );
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  if (waitingForSeat(isPro, insightsQ.status)) return <SeatLoading />;
  return (
    <HfInsightsModelProvider model={model}>
      <InsightsForSeat />
    </HfInsightsModelProvider>
  );
}
