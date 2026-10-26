/**
 * Find you + Claim (screens 1–2) — Happyflow prototype screen in the professional seat (demo data;
 * see src/components/happyflow/demo-data.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { FindYouScreen } from "@v3/srp/components/happyflow/screens/find-you";
import { SampleData } from "@v3/srp/components/happyflow/sample-data";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/find")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro } = useSeatParams();
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  return (
    <SampleData>
      <FindYouScreen />
    </SampleData>
  );
}
