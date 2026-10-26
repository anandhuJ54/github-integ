import { describe, expect, test } from "bun:test";
import { SCORE_BY_DAY } from "../demo-data";
import { LANES } from "./srs";

// The 10 SRS v5 lanes and budgets: AGENTS.md §3 and docs/PLATFORM_HANDOFF_2026-10-12.md §2.6 (850 points).
const V5: Record<string, number> = {
  Reviews: 187,
  Completeness: 182,
  Website: 102,
  Articles: 103,
  GBP: 68,
  Directories: 90,
  "Q&A": 34,
  Connections: 51,
  Videos: 27,
  Audio: 6,
};

describe("SRS screen lanes", () => {
  test("are the 10 SRS v5 lanes with their budgets", () => {
    expect(Object.fromEntries(LANES.map((l) => [l.lane, l.max]))).toEqual(V5);
    expect(LANES.length).toBe(10);
  });

  test("budgets add up to 850 and the sample earns the day-1 score", () => {
    expect(LANES.reduce((a, l) => a + l.max, 0)).toBe(850);
    expect(LANES.reduce((a, l) => a + (l.max - l.pts), 0)).toBe(SCORE_BY_DAY[1]);
  });

  test("no lane has more open points than its budget", () => {
    for (const l of LANES) expect(l.pts).toBeLessThanOrEqual(l.max);
  });
});
