/**
 * NORA settings (screen 19) — Happyflow prototype screen in the professional seat (demo data;
 * see src/components/happyflow/demo-data.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { SettingsScreen } from "@v3/srp/components/happyflow/screens/settings";
import { SampleData } from "@v3/srp/components/happyflow/sample-data";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/settings")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro } = useSeatParams();
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  return (
    <SampleData>
      <SettingsScreen />
    </SampleData>
  );
}
