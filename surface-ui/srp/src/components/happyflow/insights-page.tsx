import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import type { InsightsModel } from "@v3/srp/utils/insights-model";
import { useRealInsightsModel } from "./insights-context";
import { InsightsScreen } from "./screens/insights";
import { SampleData } from "./sample-data";

/** The notice above the page: what kind of data a real seat's figures are; undefined keeps the sample notice. */
export function insightsNoticeFor(model: InsightsModel | null): string | undefined {
  if (!model) return undefined;
  return model.isMock ? MOCK_NOTICE : "These values come from your account.";
}

/** The Insights page of a professional seat: the screen on the seat's data (or the sample page), under its notice. */
export function InsightsForSeat() {
  const model = useRealInsightsModel();
  return (
    <SampleData note={insightsNoticeFor(model)}>
      <InsightsScreen key={model?.seatKey ?? "sample"} />
    </SampleData>
  );
}
