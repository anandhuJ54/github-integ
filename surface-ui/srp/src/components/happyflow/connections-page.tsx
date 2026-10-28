import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import type { ConnectionsModel } from "@v3/srp/utils/connections-model";
import { useRealConnectionsModel } from "./connections-context";
import { ConnectionsScreen } from "./screens/connections";
import { SampleData } from "./sample-data";

/** The notice above the page: what kind of data a real seat's accounts are; undefined keeps the sample notice. */
export function connectionsNoticeFor(model: ConnectionsModel | null): string | undefined {
  if (!model) return undefined;
  return model.isMock ? MOCK_NOTICE : "These values come from your account.";
}

/** The Connections page of a professional seat: the screen on the seat's data (or the sample page), under its notice. */
export function ConnectionsForSeat() {
  const model = useRealConnectionsModel();
  return (
    <SampleData note={connectionsNoticeFor(model)}>
      <ConnectionsScreen key={model?.seatKey ?? "sample"} />
    </SampleData>
  );
}
