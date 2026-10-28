/**
 * Connections (screen 8) — Happyflow prototype screen in the professional seat. A real seat's page reads its eleven accounts, their status and what each powers, NORA's notes and
 * the directories card from the local database (srp/connections-page-schema), read-only: Connect and NORA's notes only change what the browser shows (no sign-in, token or
 * write exists). With no data, or when the read fails, it is the prototype's sample page.
 */
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { HfConnectionsModelProvider } from "@v3/srp/components/happyflow/connections-context";
import { ConnectionsForSeat } from "@v3/srp/components/happyflow/connections-page";
import { SeatLoading } from "@v3/srp/components/seat/pieces";
import { connectionsModel, useConnectionsApi } from "@v3/srp/utils/connections-model";
import { waitingForSeat } from "@v3/srp/utils/seat-wait";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/connections")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro, id } = useSeatParams();
  // Read once per professional seat; a failure or a seat with no Connections data falls back to the sample view.
  const connQ = useConnectionsApi(id, isPro);
  const model = useMemo(
    () => connectionsModel(isPro ? connQ.data : null, id),
    [isPro, connQ.data, id],
  );
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  if (waitingForSeat(isPro, connQ.status)) return <SeatLoading />;
  return (
    <HfConnectionsModelProvider model={model}>
      <ConnectionsForSeat />
    </HfConnectionsModelProvider>
  );
}
