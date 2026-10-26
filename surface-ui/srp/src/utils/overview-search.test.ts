import { describe, expect, test } from "bun:test";
import { validateOverviewSearch } from "./overview-search";

describe("validateOverviewSearch", () => {
  test("keeps day only when it is 7 or 24", () => {
    expect(validateOverviewSearch({ day: 7 }).day).toBe(7);
    expect(validateOverviewSearch({ day: "24" }).day).toBe(24);
    expect(validateOverviewSearch({ day: 1 }).day).toBeUndefined();
    expect(validateOverviewSearch({ day: "x" }).day).toBeUndefined();
    expect(validateOverviewSearch({}).day).toBeUndefined();
  });

  test("keeps events only when it is 1", () => {
    expect(validateOverviewSearch({ events: 1 }).events).toBe(1);
    expect(validateOverviewSearch({ events: "1" }).events).toBe(1);
    expect(validateOverviewSearch({ events: 2 }).events).toBeUndefined();
    expect(validateOverviewSearch({ events: true }).events).toBeUndefined();
  });

  test("keeps from only when it is a string", () => {
    expect(validateOverviewSearch({ from: "claim" }).from).toBe("claim");
    expect(validateOverviewSearch({ from: 3 }).from).toBeUndefined();
  });
});
