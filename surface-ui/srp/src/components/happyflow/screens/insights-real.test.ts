// The Insights screen reads the Insights model (srp/insights-page-schema, task 9): a real seat's page shows its stored figures and none of the prototype's, and
// with no real seat the page is the prototype's. SSR render tests (no DOM, first render only: clicks and the sheets are not run here, so the tab and the selected
// spot are chosen with the screen's `initialTab` and `initialSpot`).
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HfInsightsModelProvider } from "../insights-context";
import { InsightsForSeat, insightsNoticeFor } from "../insights-page";
import { InsightsScreen } from "./insights";
import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import { insightsModel, type InsightsApi } from "@v3/srp/utils/insights-model";
import { api } from "@v3/srp/utils/insights-fixture";

async function render(Screen: ComponentType): Promise<string> {
  const root = createRootRoute();
  const seat = createRoute({
    getParentRoute: () => root,
    path: "/seat/$kind/$id",
    component: Screen,
  });
  const router = createRouter({
    routeTree: root.addChildren([seat]),
    history: createMemoryHistory({ initialEntries: ["/seat/professional/p1"] }),
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const model = (over: Partial<InsightsApi> = {}) => insightsModel(api(over), "34")!;
const page = (
  m: ReturnType<typeof model> | null,
  props: { initialTab?: string; initialSpot?: number } = {},
) =>
  render(() =>
    createElement(HfInsightsModelProvider, { model: m }, createElement(InsightsScreen, props)),
  );
const SAMPLE_ONLY = [
  "Riverbend",
  "Prairie Home",
  "Bluff City",
  "Mississippi Valley",
  "Heartland",
  "Alex",
  "100 Main St",
  "Davenport",
  "Oct 16",
  "1,240",
  "Zillow",
  "map pack",
  "1 of 7",
];

describe("a real Insights seat: the Visibility tab", () => {
  let t = "";
  test("renders", async () => {
    t = text(await page(model(), { initialTab: "Visibility" }));
    expect(t.length).toBeGreaterThan(200);
  });
  test("the six figures with their labels and source lines", () => {
    for (const s of [
      "Search views 2,310",
      "Maps views 1,420",
      "Calls 0",
      "Directions 73",
      "Website clicks 129",
      "Experience.com profile views 1,000,000",
    ])
      expect(t).toContain(s);
    expect(t).toContain("Last 30 days · From Experience.com");
    expect(t.match(/Last 30 days · From Google/g)!.length).toBe(5);
  });
  test("none of the prototype's figures are on the page", () => {
    for (const s of SAMPLE_ONLY) expect(t).not.toContain(s);
  });
});

describe("a real Insights seat: the Competitors tab", () => {
  let html = "";
  let t = "";
  test("renders", async () => {
    html = await page(model());
    t = text(html);
    expect(t.length).toBeGreaterThan(500);
  });
  test("the map card: street, scan date, the office pin and the spot's top three with the seat's rank", () => {
    expect(t).toContain("Map rank around 412 Main St");
    expect(t).toContain("One-time scan · Oct 9");
    expect(t).toContain("●");
    expect(t).toContain("You're #2 here");
    expect(t).toContain("#1 Summit Credit Union");
    expect(t).toContain("#2 You");
    expect(t).toContain("#3 Lakeside Lending");
    expect(t).toContain("Top 3 in 1 · 4–10 in 8 · 11–20 in 16 · 20+ in 24");
  });
  test("every cell is coloured by its rank", () => {
    expect(html.match(/background:#34a853/g)!.length).toBe(1);
    expect(html.match(/background:#fbbc04/g)!.length).toBe(8);
    expect(html.match(/background:#fa7b17/g)!.length).toBe(16);
    expect(html.match(/background:#ea4335/g)!.length).toBe(24);
  });
  test("AI citations: heading, engines, their shares and notes", () => {
    for (const s of [
      "Named in 3 of 6 answers",
      "ChatGPT 2 of 2",
      "Gemini 1 of 2",
      "Perplexity 0 of 2",
      "Names you for local lender questions.",
      "Does not mention you yet.",
    ])
      expect(t).toContain(s);
  });
  test("the question names the market leader", () => {
    expect(t).toContain("Is Summit Credit Union who you lose deals to?");
    expect(t).toContain("Yes");
    expect(t).toContain("Add another");
  });
  test("the competitor table: places, names with (you), ratings, averages, and dashes for the unknown", () => {
    expect(t).toContain('"mortgage lender near me" · Bettendorf, IA');
    for (const s of [
      "1 Summit Credit Union ★ 4.2 (88) 1.9",
      "2 Harper Jones (you) ★ 4.1 (71) 11.6",
      "3 Lakeside Lending ★ — —",
    ])
      expect(t).toContain(s);
  });
  test("the locked cards", () => {
    expect(t).toContain("Map Rank tracking");
    expect(t).toContain("Re-scan every week and see the day you pass Summit");
    expect(t).toContain("AI-citation monitoring");
    expect(t.match(/Unlock →/g)!.length).toBe(2);
  });
  test("none of the prototype's figures are on the page", () => {
    for (const s of SAMPLE_ONLY) expect(t).not.toContain(s);
  });
});

describe("a real seat in other shapes", () => {
  test("the selected spot's top three follow the chosen spot", async () => {
    const t = text(await page(model(), { initialSpot: 0 }));
    expect(t).toContain("You're #20+ here");
    expect(t).toContain("#1 Summit Credit Union #2 Lakeside Lending #3 Oakmont Mortgage");
    expect(t).not.toContain("#2 You");
  });
  test("no map means no map card, and no AI block means no AI card; the rest still shows", async () => {
    const t = text(await page(model({ map: null, ai: null })));
    expect(t).not.toContain("Map rank around");
    expect(t).not.toContain("AT THIS SPOT");
    expect(t).not.toContain("AI citations");
    expect(t).toContain("Competitors");
    expect(t).toContain("Summit Credit Union");
  });
  test("with no market leader the question asks who the seat loses deals to and offers only to add one", async () => {
    const t = text(await page(model({ target: null })));
    expect(t).toContain("Who do you lose deals to?");
    expect(t).not.toContain("Yes");
    expect(t).toContain("Add a competitor");
  });
  test("a seat with no scan date shows no scan label and one with no address is about the office", async () => {
    const base = api();
    const t = text(
      await page(
        insightsModel({ ...base, map: { ...base.map!, address: null, scanned_at: null } }, "1")!,
      ),
    );
    expect(t).toContain("Map rank around your office");
    expect(t).not.toContain("One-time scan");
  });
  test("a selected spot with no cell shows nothing about a spot instead of another spot's top three (second review, finding 6)", async () => {
    const base = api();
    const cells = base.map!.cells.filter((c) => c.row === 0);
    const t = text(
      await page(insightsModel({ ...base, map: { ...base.map!, spots: 7, cells } }, "1")!),
    );
    expect(t).toContain("Map rank around 412 Main St");
    expect(t).not.toContain("You're #");
    expect(t).not.toContain("#1 Summit Credit Union");
  });
  test("the selected spot is found by its grid place, not by its position in the list", async () => {
    const base = api();
    const cells = base.map!.cells.filter((c) => !(c.row === 0 && c.col === 0)); // 48 cells: the list index of the pin is no longer 24
    const t = text(
      await page(insightsModel({ ...base, map: { ...base.map!, spots: 48, cells } }, "1")!),
    );
    expect(t).toContain("You're #2 here");
    expect(t).toContain("#2 You");
  });
  test("no locked cards means none are drawn", async () => {
    const t = text(await page(model({ locked: [] })));
    expect(t).not.toContain("Unlock →");
  });
  test("a missing metric is not drawn and a missing engine is not drawn", async () => {
    const base = api();
    const t = text(
      await page(
        model({
          visibility: base.visibility!.filter((v) => v.metric !== "calls"),
          ai: { ...base.ai!, engines: base.ai!.engines.slice(0, 2) },
        }),
        { initialTab: "Visibility" },
      ),
    );
    expect(t).not.toContain("Calls");
    const c = text(
      await page(model({ ai: { ...base.ai!, engines: base.ai!.engines.slice(0, 2) } })),
    );
    expect(c).not.toContain("Perplexity 0 of 2");
  });
  test("a mock seat says so, a live one does not", () => {
    expect(insightsNoticeFor(model())).toBe(MOCK_NOTICE);
    expect(insightsNoticeFor(insightsModel(api({ data: "live" }), "1"))).toBe(
      "These values come from your account.",
    );
    expect(insightsNoticeFor(null)).toBeUndefined();
  });
  test("the screen is remounted when the seat changes, so one seat's selected spot and answer never carry over to another", () => {
    const src = readFileSync(join(import.meta.dir, "..", "insights-page.tsx"), "utf8");
    expect(/<InsightsScreen\s+key=\{model\?\.seatKey \?\? "sample"\}/.test(src)).toBe(true);
  });
  test("NORA's notes in the shell are the model's (they are not drawn on the first render, so the source is checked)", () => {
    const src = readFileSync(join(import.meta.dir, "insights.tsx"), "utf8");
    expect(/nora=\{\{\s*thinks:\s*model\.thinks\s*\}\}/.test(src)).toBe(true);
  });
  test("the screen holds none of the prototype's figures as literals any more", () => {
    const src = readFileSync(join(import.meta.dir, "insights.tsx"), "utf8");
    for (const s of [
      "Riverbend",
      "Prairie Home",
      "1,240",
      "Zillow",
      "412 reviews",
      "100 Main St",
      "Davenport",
      "Oct 16",
      "4.7 (412)",
    ])
      expect(src).not.toContain(s);
  });
});

describe("with no real seat the page is the prototype's", () => {
  test("every sample figure is there on the Competitors tab", async () => {
    const t = text(await page(null));
    for (const s of [
      "Map rank around 100 Main St",
      "One-time scan · Oct 16",
      "You're #2 here",
      "Top 3 in 9 · 4–10 in 17 · 11–20 in 14 · 20+ in 9",
      "Named in 1 of 7 answers",
      "ChatGPT 1 of 3",
      "Cites your Zillow reviews",
      "Gemini 0 of 2",
      "Leans on the map pack",
      "Perplexity 0 of 2",
      "Cites articles; you have none",
      "Is Riverbend Bank & Trust who you lose deals to?",
      '"mortgage lender near me" · Davenport, IA',
      "1 Riverbend Bank & Trust ★ 4.7 (412) 2.1",
      "6 Alex Sample (you) ★ 4.9 (128) 7.8",
      "Map Rank tracking",
      "Re-scan every week and see the day you pass Riverbend",
      "AI-citation monitoring",
      "Track every answer that names you",
      "Add another",
    ])
      expect(t).toContain(s);
  });
  test("every sample figure is there on the Visibility tab", async () => {
    const t = text(await page(null, { initialTab: "Visibility" }));
    for (const s of [
      "Search views 1,240",
      "Maps views 860",
      "Calls 41",
      "Directions 18",
      "Website clicks 57",
      "Experience.com profile views 312",
    ])
      expect(t).toContain(s);
    expect(t.match(/Last 30 days · from Google/g)!.length).toBe(6);
  });
  test("the page under a real seat's provider shows the mock notice; without one, the sample notice", async () => {
    const withSeat = text(
      await render(() =>
        createElement(HfInsightsModelProvider, { model: model() }, createElement(InsightsForSeat)),
      ),
    );
    expect(withSeat).toContain(MOCK_NOTICE);
    const sample = text(
      await render(() =>
        createElement(HfInsightsModelProvider, { model: null }, createElement(InsightsForSeat)),
      ),
    );
    expect(sample).toContain("Sample data");
    expect(sample).not.toContain(MOCK_NOTICE);
  });
});
