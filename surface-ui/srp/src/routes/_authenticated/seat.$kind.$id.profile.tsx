/**
 * Profile (screen 7) — Happyflow prototype screen in the professional seat. A real seat's page reads its facts, sources and counts from the local database
 * (srp/profile-page-schema), read-only: the edit flows only change what the browser shows. With no data, or when the read fails, it is the prototype's sample page.
 */
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@v3/shared/components/ui/console-primitives";
import { HfProfileModelProvider } from "@v3/srp/components/happyflow/profile-context";
import { ProfileForSeat } from "@v3/srp/components/happyflow/profile-page";
import { SeatLoading } from "@v3/srp/components/seat/pieces";
import { profileModel, useProfileApi } from "@v3/srp/utils/profile-model";
import { waitingForSeat } from "@v3/srp/utils/seat-wait";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/profile")({
  component: SeatPage,
});

function SeatPage() {
  const { isPro, id } = useSeatParams();
  // Read once per professional seat; a failure or a seat with no Profile data falls back to the sample view.
  const profileQ = useProfileApi(id, isPro);
  const model = useMemo(
    () => profileModel(isPro ? profileQ.data : null, id),
    [isPro, profileQ.data, id],
  );
  if (!isPro)
    return <EmptyState title="Not available" description="This is a professional-seat surface." />;
  if (waitingForSeat(isPro, profileQ.status)) return <SeatLoading />;
  return (
    <HfProfileModelProvider model={model}>
      <ProfileForSeat />
    </HfProfileModelProvider>
  );
}
