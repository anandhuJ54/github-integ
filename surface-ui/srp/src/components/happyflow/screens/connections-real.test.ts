// The Connections screen reads the Connections model (srp/connections-page-schema, task 9): a real seat's page shows its stored values and none of the prototype's, and with no
// real seat the page is the prototype's. SSR render tests (no DOM, first render only: Connect clicks are not run here).
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
import { HfConnectionsModelProvider } from "../connections-context";
import { connectionsNoticeFor } from "../connections-page";
import { ConnectionsScreen, clickedCount, connectThinks } from "./connections";
import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import { connectionsModel, type ConnectionsApi } from "@v3/srp/utils/connections-model";
import { api } from "@v3/srp/utils/connections-fixture";

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
const model = (over: Partial<ConnectionsApi> = {}) => connectionsModel(api(over), "34")!;
const page = (m: ReturnType<typeof model> | null) =>
  render(() =>
    createElement(HfConnectionsModelProvider, { model: m }, createElement(ConnectionsScreen)),
  );

const SAMPLE_ONLY = [
  "synced today",
  "67 of 68",
  "4 connected, 2 matched",
  "Match found",
  "Apple Maps, Bing and 28 directories",
];

describe("a real seat's Connections page", () => {
  let t = "";
  let html = "";
  test("renders", async () => {
    html = await page(model());
    t = text(html);
    expect(t).toContain("Every account NORA can use, and what it powers.");
    expect(t.length).toBeGreaterThan(300);
  });
  test("the header counts and the one suggestion", () => {
    expect(t).toContain(
      "5 connected, 1 matched. Connect Website / CMS and I can apply your website fixes myself.",
    );
  });
  test("each card shows its stored name, powers and status", () => {
    for (const s of [
      "Google Business Profile GBP lane (41 of 68), hours, photos, reviews Connected · synced Oct 24",
      "Search Console Indexing and search queries for Website Analytics Connected",
      "Yelp Listing check Matched, no sign-in needed",
      "Loan system (Encompass) Review requests after each closing Connected",
    ])
      expect(t).toContain(s);
    // the five accounts that are not connected show a Connect button, the connected ones a pill
    expect(html.match(/>Connect<\/button>/g)?.length).toBe(5);
  });
  test("no directories card when the plan has it", () => {
    expect(t).not.toContain("directories");
  });
  test("none of the prototype's values are on the page", () => {
    for (const s of SAMPLE_ONLY) expect(t).not.toContain(s);
  });
});

describe("a real seat in other shapes", () => {
  test("both unconnected: the prototype's sentence, with the stored counts", async () => {
    const a = api({
      suggest: [
        { key: "search_console", name: "Search Console" },
        { key: "website_cms", name: "Website / CMS" },
      ],
      summary: { connected: 3, matched: 0 },
    });
    const t = text(await page(connectionsModel(a, "2")!));
    expect(t).toContain(
      "3 connected, 0 matched. Connect Search Console and your Website / CMS and I can fix your website myself instead of handing it to your webmaster.",
    );
  });
  test("none unconnected: no second sentence and no notes", async () => {
    const t = text(await page(model({ suggest: [], notes: [] })));
    expect(t).toContain("5 connected, 1 matched.");
    expect(t).not.toContain("Connect Website");
  });
  test("a seat on the core plan sees the directories card", async () => {
    const t = text(
      await page(
        model({
          locked: { title: "Publish your details to two places.", text: "Unlock with Engage." },
        }),
      ),
    );
    expect(t).toContain("Publish your details to two places.");
    expect(t).toContain("Unlock with Engage.");
    expect(t).toContain("Unlock →");
  });
  test("a missing account draws no card", async () => {
    const withX = text(await page(model()));
    expect(/Connections lane(?!,)/.test(withX)).toBe(true); // X's powers line is "Connections lane" alone
    const a = api();
    a.accounts = a.accounts!.filter((x) => x.key !== "x");
    const t = text(await page(connectionsModel(a, "3")!));
    expect(/Connections lane(?!,)/.test(t)).toBe(false);
    for (const n of [
      "Google Business Profile",
      "YouTube",
      "Facebook",
      "Instagram",
      "LinkedIn",
      "Zillow",
      "Yelp",
      "Website / CMS",
      "Loan system (Encompass)",
    ])
      expect(t).toContain(n);
  });
});

describe("the sample page and the notice", () => {
  test("with no real seat the page is the prototype's", async () => {
    const t = text(await page(null));
    for (const s of [
      "4 connected, 2 matched.",
      "Match found · replies need Yelp's partner access",
      "Apple Maps, Bing and 28 directories",
      "Unlock →",
    ])
      expect(t).toContain(s);
  });
  test("the notice: mock data says so, live data says it is yours, no model keeps the sample notice", () => {
    expect(connectionsNoticeFor(null)).toBeUndefined();
    expect(connectionsNoticeFor(model())).toBe(MOCK_NOTICE);
    expect(connectionsNoticeFor(model({ data: "live" }))).toBe(
      "These values come from your account.",
    );
  });
});

describe("NORA's notes", () => {
  test("each button connects the account its note names, and nothing else", () => {
    const called: string[] = [];
    const thinks = connectThinks(model().thinks);
    expect(thinks.map((t) => [t.t, t.cta])).toEqual([
      ["Your Website / CMS would let me apply fixes.", "Connect it"],
    ]);
    thinks[0].act({ connect: (n: string) => called.push(n) } as never);
    expect(called).toEqual(["Website / CMS"]);
  });
});

describe("the header count of Connect clicks", () => {
  test("only an account that is not connected yet adds to the stored count", () => {
    const cards = model().cards;
    // Search Console is connected in this seat's data: a Connect click on the shell's sources sheet must not count it again (second review, finding 2).
    expect(clickedCount(cards, { "Search Console": 1 })).toBe(0);
    expect(clickedCount(cards, { "Website / CMS": 1 })).toBe(1);
    expect(
      clickedCount(cards, {
        "Search Console": 1,
        "Website / CMS": 1,
        "Loan system (Encompass)": 1,
        Facebook: 1,
      }),
    ).toBe(2);
    expect(clickedCount(cards, {})).toBe(0);
    expect(clickedCount(cards, { "Not an account": 1 })).toBe(0);
  });
});
