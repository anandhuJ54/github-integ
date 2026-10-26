import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  LOCATION_NAV_LABELS,
  LOCATION_NAV_SUFFIXES,
  PROFESSIONAL_NAV_FLAGS,
  PROFESSIONAL_NAV_LABELS,
  PROFESSIONAL_NAV_SUFFIXES,
} from "./scoped-shell";

const ROUTES = join(import.meta.dir, "..", "..", "routes", "_authenticated");
const routeFile = (suffix: string) =>
  join(ROUTES, suffix ? `seat.$kind.$id.${suffix.slice(1)}.tsx` : "seat.$kind.$id.index.tsx");

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

  test("every nav link points at an existing route file", () => {
    for (const suffix of [...PROFESSIONAL_NAV_SUFFIXES, ...LOCATION_NAV_SUFFIXES])
      expect(existsSync(routeFile(suffix))).toBe(true);
  });
});
