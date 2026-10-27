import { MOCK_NOTICE, type HomeLayout, type HomeModel } from "@v3/srp/utils/home-model";
import { useRealHomeModel } from "./home-context";
import { HomeDay1Screen } from "./screens/home-day1";
import { HomeDay7Screen } from "./screens/home-day7";
import { SampleData } from "./sample-data";

/** Which layout to show: the `?day=` override when given, else the one the seat's trial dates say, else day 1. */
export function layoutFor(model: HomeModel | null, dayParam: 7 | 24 | undefined): HomeLayout {
  if (dayParam === 7) return "day7";
  if (dayParam === 24) return "day24";
  return model?.layout ?? "day1";
}

/** The notice above the page: what kind of data a real seat's numbers are; undefined keeps the sample notice. */
export function noticeFor(model: HomeModel | null): string | undefined {
  if (!model) return undefined;
  return model.isMock ? MOCK_NOTICE : "These values come from your account.";
}

/** The Home of a professional seat: the layout from the data (or `?day=`), under its notice. */
export function HomeForSeat({ day, events }: { day: 7 | 24 | undefined; events: boolean }) {
  const model = useRealHomeModel();
  const layout = layoutFor(model, day);
  return (
    <SampleData note={noticeFor(model)}>
      {layout === "day1" ? <HomeDay1Screen /> : <HomeDay7Screen key={layout} day={layout === "day24" ? 24 : 7} events={events} />}
    </SampleData>
  );
}
