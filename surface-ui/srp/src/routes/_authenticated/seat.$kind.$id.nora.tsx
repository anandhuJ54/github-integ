/**
 * Professional seat "Nora" → the Happyflow Search Rank Score screen (screen 6, demo data).
 */
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { SrsScreen } from "@v3/srp/components/happyflow/screens/srs";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/nora")({
  component: SeatNora,
});

function SeatNora() {
  const { isPro } = useSeatParams();
  if (!isPro)
    return <EmptyState title="Not available" description="Nora is a professional-seat surface." />;
  return <SrsScreen />;
}
