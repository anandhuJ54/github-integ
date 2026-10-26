/**
 * Website Analytics (screen 9) — Happyflow prototype screen in the professional seat (demo data;
 * see src/components/happyflow/demo-data.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { WebsiteScreen } from "@v3/srp/components/happyflow/screens/website";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/website")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro } = useSeatParams();
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  return <WebsiteScreen />;
}
