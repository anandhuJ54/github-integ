import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import type { WebAnalyticsModel } from "@v3/srp/utils/web-analytics-model";
import { useRealWebAnalyticsModel } from "./web-analytics-context";
import { WebsiteScreen } from "./screens/website";
import { SampleData } from "./sample-data";

/** The notice above the page: what kind of data a real seat's audit is; undefined keeps the sample notice. */
export function webAnalyticsNoticeFor(model: WebAnalyticsModel | null): string | undefined {
  if (!model) return undefined;
  return model.isMock ? MOCK_NOTICE : "These values come from your account.";
}

/** The Web analytics page of a professional seat: the screen on the seat's data (or the sample page), under its notice. */
export function WebAnalyticsForSeat() {
  const model = useRealWebAnalyticsModel();
  return (
    <SampleData note={webAnalyticsNoticeFor(model)}>
      <WebsiteScreen key={model?.seatKey ?? "sample"} />
    </SampleData>
  );
}
