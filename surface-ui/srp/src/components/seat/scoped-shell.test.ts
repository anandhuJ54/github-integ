import { describe, expect, test } from "bun:test";
import { LOCATION_NAV_LABELS, PROFESSIONAL_NAV_FLAGS, PROFESSIONAL_NAV_LABELS } from "./scoped-shell";

describe("seat nav", () => {
  test("professional nav is the Happyflow one, in order", () => {
    expect(PROFESSIONAL_NAV_LABELS).toEqual([
      "Home",
      "SRS",
      "Profile",
      "Insights",
      "Website Analytics",
      "Expertise Graph",
      "Reviews",
      "Connections",
      "Network",
      "Settings",
      "NORA interview",
    ]);
  });

  test("Website Analytics has the PRO pill and Reviews the lock", () => {
    expect(PROFESSIONAL_NAV_FLAGS).toEqual([
      { label: "Website Analytics", pro: true, locked: false },
      { label: "Reviews", pro: false, locked: true },
    ]);
  });

  test("location nav is unchanged", () => {
    expect(LOCATION_NAV_LABELS).toEqual([
      "Overview",
      "Team",
      "Reviews",
      "Listings",
      "Multi-Post",
      "Reporting",
      "NORA interview",
    ]);
  });
});
