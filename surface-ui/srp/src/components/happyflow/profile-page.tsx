import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import type { ProfileModel } from "@v3/srp/utils/profile-model";
import { useRealProfileModel } from "./profile-context";
import { ProfileScreen } from "./screens/profile";
import { SampleData } from "./sample-data";

/** The notice above the page: what kind of data a real seat's facts are; undefined keeps the sample notice. */
export function profileNoticeFor(model: ProfileModel | null): string | undefined {
  if (!model) return undefined;
  return model.isMock ? MOCK_NOTICE : "These values come from your account.";
}

/** The Profile page of a professional seat: the screen on the seat's data (or the sample page), under its notice. */
export function ProfileForSeat() {
  const model = useRealProfileModel();
  return (
    <SampleData note={profileNoticeFor(model)}>
      <ProfileScreen key={model?.storeKey ?? "sample"} />
    </SampleData>
  );
}
