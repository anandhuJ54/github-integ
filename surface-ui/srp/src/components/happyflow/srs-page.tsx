import { MOCK_NOTICE } from "@v3/srp/utils/srs-model";
import type { SrsModel } from "@v3/srp/utils/srs-model";
import { useRealSrsModel } from "./srs-context";
import { SrsScreen } from "./screens/srs";
import { SampleData } from "./sample-data";

/** The notice above the page: what kind of data a real seat's numbers are; undefined keeps the sample notice. */
export function srsNoticeFor(model: SrsModel | null): string | undefined {
  if (!model) return undefined;
  return model.isMock ? MOCK_NOTICE : "These values come from your account.";
}

/** The SRS page of a professional seat: the screen on the seat's data (or the sample page), under its notice. */
export function SrsForSeat() {
  const model = useRealSrsModel();
  return (
    <SampleData note={srsNoticeFor(model)}>
      <SrsScreen />
    </SampleData>
  );
}
