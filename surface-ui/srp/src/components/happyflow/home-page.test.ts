// The Home page picks its layout and notice from the seat's model (srp/home-page-schema, task 13).
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";
import { HfHomeModelProvider, useRealHomeModel } from "./home-context";
import { HomeForSeat, layoutFor, noticeFor } from "./home-page";
import { SAMPLE_DATA_LABEL } from "./sample-data";
import { homeModel, MOCK_NOTICE, type HomeApi } from "@v3/srp/utils/home-model";
import { api } from "@v3/srp/utils/home-fixture";

async function render(Screen: ComponentType): Promise<string> {
  const root = createRootRoute();
  const seat = createRoute({ getParentRoute: () => root, path: "/seat/$kind/$id", component: Screen });
  const router = createRouter({ routeTree: root.addChildren([seat]), history: createMemoryHistory({ initialEntries: ["/seat/professional/p1"] }) });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const day = (layout: "day1" | "day7" | "day24", over: Partial<HomeApi> = {}) =>
  homeModel(api({ day: { n: layout === "day1" ? 2 : layout === "day7" ? 12 : 26, trial_days: 45, layout, over: false }, ...over }))!;
const page = (m: ReturnType<typeof day> | null, d?: 7 | 24, events = false) =>
  render(() => createElement(HfHomeModelProvider, { model: m }, createElement(HomeForSeat, { day: d, events })));

describe("layoutFor", () => {
  test("the data picks the layout; ?day overrides it; no data is day 1", () => {
    expect(layoutFor(day("day7"), undefined)).toBe("day7");
    expect(layoutFor(day("day24"), undefined)).toBe("day24");
    expect(layoutFor(day("day1"), undefined)).toBe("day1");
    expect(layoutFor(day("day1"), 7)).toBe("day7");
    expect(layoutFor(day("day7"), 24)).toBe("day24");
    expect(layoutFor(null, undefined)).toBe("day1");
    expect(layoutFor(null, 7)).toBe("day7");
    expect(layoutFor(null, 24)).toBe("day24");
  });
});

describe("noticeFor", () => {
  test("mock data says so; the sample (no model) keeps the sample notice; live data has no mock notice", () => {
    expect(noticeFor(day("day1"))).toBe(MOCK_NOTICE);
    expect(noticeFor(null)).toBeUndefined();
    expect(noticeFor(homeModel(api({ data: "live" }))!)).toBe("These values come from your account.");
  });
});

describe("the page", () => {
  test("a day 1 seat gets the day 1 layout and the mock notice", async () => {
    const html = await page(day("day1", { board: { ...api().board! } }));
    expect(text(html)).toContain(SAMPLE_DATA_LABEL);
    expect(text(html)).toContain(MOCK_NOTICE);
    expect(text(html)).toContain("YOUR MISSION · DAY 2 OF 45");
  });
  test("a day 7 seat gets the day 7 layout", async () => {
    const t = text(await page(day("day7")));
    expect(t).toContain("WEEKLY BRIEF");
    expect(t).not.toContain("YOUR MISSION");
  });
  test("a day 24 seat gets the day 24 layout", async () => {
    const t = text(await page(day("day24")));
    expect(t).toContain("WEEKLY BRIEF");
  });
  test("?day=7 on a day 1 seat shows the day 7 layout with the seat's own data", async () => {
    const t = text(await page(day("day1"), 7));
    expect(t).toContain("WEEKLY BRIEF");
    expect(t).toContain(MOCK_NOTICE);
  });
  test("no model: the sample page and its sample notice", async () => {
    const t = text(await page(null));
    expect(t).toContain("Pass Riverbend Bank & Trust");
    expect(t).not.toContain(MOCK_NOTICE);
    const t7 = text(await page(null, 7));
    expect(t7).toContain("Maria L.");
    expect(t7).toContain("418");
    expect(text(await page(null, 24))).toContain("471");
  });
});

describe("useRealHomeModel", () => {
  test("is null outside a provider", () => {
    let seen: unknown = "unset";
    const Probe = () => { seen = useRealHomeModel(); return null; };
    renderToString(createElement(Probe));
    expect(seen).toBeNull();
  });
});
