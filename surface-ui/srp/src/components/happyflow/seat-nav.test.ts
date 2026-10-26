import { describe, expect, test } from "bun:test";
import { hfNavTarget, type HfRoute } from "./seat-nav";

const params = { kind: "professional", id: "p1" };

describe("hfNavTarget", () => {
  test("home screens are the seat index with a day / events search", () => {
    expect(hfNavTarget("home", params)).toEqual({ to: "/seat/$kind/$id", params, search: {} });
    expect(hfNavTarget("day7", params)).toEqual({ to: "/seat/$kind/$id", params, search: { day: 7 } });
    expect(hfNavTarget("events", params)).toEqual({
      to: "/seat/$kind/$id",
      params,
      search: { day: 7, events: 1 },
    });
    expect(hfNavTarget("recap", params)).toEqual({ to: "/seat/$kind/$id", params, search: { day: 24 } });
  });

  test("srs opens the nora route", () => {
    expect(hfNavTarget("srs", params).to).toBe("/seat/$kind/$id/nora");
  });

  test("every other screen opens the route with its own name", () => {
    const named: HfRoute[] = [
      "find",
      "interview",
      "reviews",
      "profile",
      "connections",
      "website",
      "insights",
      "network",
      "settings",
    ];
    for (const to of named) {
      const t = hfNavTarget(to, params);
      expect(t.to).toBe(`/seat/$kind/$id/${to}`);
      expect(t.params).toEqual(params);
      expect(t.search).toBeUndefined();
    }
  });
});
