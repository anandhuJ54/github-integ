/**
 * Network (screen 18) — Happyflow prototype screen in the professional seat (demo data;
 * see src/components/happyflow/demo-data.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { NetworkScreen } from "@v3/srp/components/happyflow/screens/network";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/network")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro } = useSeatParams();
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  return <NetworkScreen />;
}
