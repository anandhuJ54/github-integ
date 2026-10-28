// The Website screen reads the Web analytics model (srp/web-analytics-page-schema, task 9): a real seat's page shows its stored values and none of the prototype's, and with no real
// seat the page is the prototype's. SSR render tests (no DOM, first render only: clicks, the timers and the sheets are not run here, so the filter is chosen with the screen's
// `initialFilter`).
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
import { HfWebAnalyticsModelProvider } from "../web-analytics-context";
import { WebAnalyticsForSeat, webAnalyticsNoticeFor } from "../web-analytics-page";
import { WebsiteScreen, checkSheet } from "./website";
import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import { webAnalyticsModel, type WebAnalyticsApi } from "@v3/srp/utils/web-analytics-model";
import { api } from "@v3/srp/utils/web-analytics-fixture";

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
const model = (over: Partial<WebAnalyticsApi> = {}) => webAnalyticsModel(api(over), "34")!;
const page = (
  m: ReturnType<typeof model> | null,
  props: { initialFilter?: "all" | "fail" | "warn" | "pass" } = {},
) =>
  render(() =>
    createElement(HfWebAnalyticsModelProvider, { model: m }, createElement(WebsiteScreen, props)),
  );
const SAMPLE_ONLY = [
  "demomortgage",
  "Alex",
  "Oct 16",
  "40 of 102",
  "LCP 3.1 s",
  "+42 open",
  "2 of 5",
  "No pages for FHA or VA loans",
  "Demo Mortgage",
  "Widget not installed",
  "Indexed; no sitemap",
  "No blog",
];

describe("a real seat's Website Analytics page", () => {
  let html = "";
  let t = "";
  test("renders", async () => {
    html = await page(model());
    t = text(html);
    expect(t.length).toBeGreaterThan(500);
  });
  test("the header: title, the address under it and the last check", () => {
    expect(t).toContain("Website Analytics");
    expect(t).toContain("harper-jones.example.test/loans");
    expect(t).toContain("Last checked Sep 9");
  });
  test("the gauge and the three tiles", () => {
    expect(html).toContain('aria-label="Site health 77 of 102 — see the checks"');
    for (const s of [
      "Speed LCP 1.9 s Passing",
      "Markup Partial +20 open",
      "AI readiness 0 of 5 Failing",
    ])
      expect(t).toContain(s);
    expect(html).toContain('aria-label="Markup: Partial — open the check"');
  });
  test("the filter pills and their counts", () => {
    expect(t).toContain("All 10 Failing 3 Needs work 2 Passing 5");
  });
  test("all ten rows with their result and points text", () => {
    for (const s of [
      "Entity and markup Structured data is incomplete +20 open",
      "Name, address, phone Matches the profile 30 of 30",
      "Indexing Indexed with a sitemap 20 of 20",
      "Service pages Service pages for some of your loan products 5 of 10",
      "Speed LCP 1.9 s, INP 90 ms, CLS 0.02 Pass",
      "Conversion No click-to-call and no booking link —",
      "Reviews on site Reviews widget installed Pass",
      "Security No HTTPS (the page is served over HTTP) —",
      "Content Blog with 4 posts Pass",
    ])
      expect(t).toContain(s);
  });
  test("the top fix card: the number of points open, and the snippet with the seat's own name", () => {
    expect(t).toContain("Top fix · +20 points");
    expect(t).toContain("Add markup so Google and AI can read your page.");
    expect(t).toContain("I've written the code.");
    expect(t).toContain('"name": "Harper Jones – Example Home Loans"');
    expect(t).toContain("Send to my webmaster");
    expect(t).toContain("Copy code");
  });
  test("none of the prototype's values are on the page", () => {
    for (const s of SAMPLE_ONLY) expect(t).not.toContain(s);
  });
});

describe("the filter", () => {
  test("each filter shows only its rows", async () => {
    const fail = text(await page(model(), { initialFilter: "fail" }));
    expect(fail).toContain("AI readiness GPTBot blocked") &&
      expect(fail).toContain("Security No HTTPS");
    expect(fail).not.toContain("Name, address, phone Matches the profile");
    const warn = text(await page(model(), { initialFilter: "warn" }));
    expect(warn).toContain("Entity and markup Structured data is incomplete") &&
      expect(warn).toContain("Service pages Service pages for some");
    expect(warn).not.toContain("Security No HTTPS");
    const pass = text(await page(model(), { initialFilter: "pass" }));
    expect(pass).toContain("Name, address, phone Matches the profile");
    expect(pass).not.toContain("Entity and markup Structured data is incomplete");
  });
});

describe("a real seat in other shapes", () => {
  test("no gauge means no gauge card, and the tiles still show", async () => {
    const t = text(await page(model({ health: null })));
    expect(t).not.toContain("Site health");
    expect(t).toContain("Speed LCP 1.9 s Passing");
  });
  test("no top fix means no top-fix card, no code and no hand-off controls; the checks still show", async () => {
    const t = text(await page(model({ top_fix: null })));
    expect(t).not.toContain("Top fix");
    expect(t).not.toContain("Copy code");
    expect(t).not.toContain("Send to my webmaster");
    expect(t).toContain("Entity and markup Structured data is incomplete");
  });
  test("a top fix with no snippet keeps the number and the Send button but shows no code or copy", async () => {
    const t = text(await page(model({ top_fix: { open: 42, snippet: null } })));
    expect(t).toContain("Top fix · +42 points");
    expect(t).toContain("Send to my webmaster");
    expect(t).not.toContain("Copy code");
    expect(t).not.toContain("<script");
    expect(t).not.toContain("I've written the code."); // nothing was written when the Profile has no name (second review, finding 8)
  });
  test("a seat that was never scanned says so, and one with no address has no line under the title", async () => {
    const t = text(await page(model({ site: { url: null, last_checked: null } })));
    expect(t).toContain("Not checked yet");
    expect(t).not.toContain("Last checked");
    expect(t).not.toContain("harper-jones.example.test");
  });
  test("no tiles means none are drawn", async () => {
    const t = text(await page(model({ tiles: [] })));
    expect(t).not.toContain("open the check");
    expect(t).toContain("Entity and markup");
  });
  test("a code snippet is text, never markup", async () => {
    const snippet =
      '<script type="application/ld+json">\n{ "@type": "FinancialService",\n  "name": "<img src=x onerror=alert(1)>" }\n</script>';
    const html = await page(model({ top_fix: { open: 3, snippet } }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
  test("a mock seat says so, a live one does not", () => {
    expect(webAnalyticsNoticeFor(model())).toBe(MOCK_NOTICE);
    expect(webAnalyticsNoticeFor(webAnalyticsModel(api({ data: "live" }), "1"))).toBe(
      "These values come from your account.",
    );
    expect(webAnalyticsNoticeFor(null)).toBeUndefined();
  });
  test("the screen is remounted when the seat changes, so one seat's filter and hand-off never carry over to another", () => {
    const src = readFileSync(join(import.meta.dir, "..", "web-analytics-page.tsx"), "utf8");
    expect(/<WebsiteScreen\s+key=\{model\?\.seatKey \?\? "sample"\}/.test(src)).toBe(true);
  });
  test("NORA's notes in the shell are the model's (they are not drawn on the first render, so the source is checked)", () => {
    const src = readFileSync(join(import.meta.dir, "website.tsx"), "utf8");
    expect(/model\.thinks\.map/.test(src)).toBe(true);
    expect(/action === "send"/.test(src)).toBe(true);
  });
  test("the gauge's arc is drawn to the lane's points, not the sample's", async () => {
    const html = await page(model());
    expect(html).toContain('stroke-dasharray="118.6 400"'); // 77 of 102
    expect(html).not.toContain('stroke-dasharray="61.6 400"'); // the sample's 40 of 102
    const sample = await page(null);
    expect(sample).toContain('stroke-dasharray="61.6 400"');
  });
  test("a tile opens the check it names, and the shell's notes are the ones the model gives", () => {
    const src = readFileSync(join(import.meta.dir, "website.tsx"), "utf8");
    expect(/onClick=\{\(\) => openCheck\(check\)\}/.test(src)).toBe(true);
    expect(/nora=\{\{\s*thinks\s*\}\}/.test(src)).toBe(true);
  });
  test("the fix sheet carries the check's group and result, and offers the webmaster hand-off only when it does not pass", () => {
    const checks = model().checks;
    expect(checkSheet(checks, "Entity and markup")).toEqual({
      title: "Entity and markup",
      body: "Structured data is incomplete",
      cta: "Send the fix to my webmaster",
      nora: "I'll write the fix and hand it to your webmaster with clear steps.",
      done: "Sent to your webmaster",
    });
    expect(checkSheet(checks, "Indexing")).toEqual({
      title: "Indexing",
      body: "Indexed with a sitemap",
      cta: "Got it",
      nora: "Nothing to fix here.",
      done: undefined,
    });
    expect(checkSheet(checks, "No such check")).toBeNull();
  });
  test("the screen holds none of the prototype's values as literals any more", () => {
    const src = readFileSync(join(import.meta.dir, "website.tsx"), "utf8");
    for (const s of [
      "No structured data on the page",
      "Matches the profile",
      "Indexed; no sitemap",
      "LCP 3.1 s",
      "Alex Sample",
      "Demo Mortgage",
      "Oct 16",
      "40 of 102",
      "+42",
      "Davenport",
      "(563) 555-0100",
    ])
      expect(src).not.toContain(s);
  });
});

describe("with no real seat the page is the prototype's", () => {
  test("every sample value is there", async () => {
    const t = text(await page(null));
    for (const s of [
      "Website Analytics",
      "demomortgage.com/alex-sample",
      "Last checked Oct 16",
      "Speed LCP 3.1 s Needs work",
      "Markup Missing +42 open",
      "AI readiness 2 of 5 Needs work",
      "All 10 Failing 4 Needs work 4 Passing 2",
      "Entity and markup No structured data on the page +42 open",
      "Name, address, phone Matches the profile 30 of 30",
      "Indexing Indexed; no sitemap 10 of 20",
      "Service pages No pages for FHA or VA loans 0 of 10",
      "Security HTTPS Pass",
      "Top fix · +42 points",
      '"name": "Alex Sample – Demo Mortgage"',
      '"telephone": "(563) 555-0100"',
      "Send to my webmaster",
      "Copy code",
    ])
      expect(t).toContain(s);
  });
  test("the page under a real seat's provider shows the mock notice; without one, the sample notice", async () => {
    const withSeat = text(
      await render(() =>
        createElement(
          HfWebAnalyticsModelProvider,
          { model: model() },
          createElement(WebAnalyticsForSeat),
        ),
      ),
    );
    expect(withSeat).toContain(MOCK_NOTICE);
    const sample = text(
      await render(() =>
        createElement(
          HfWebAnalyticsModelProvider,
          { model: null },
          createElement(WebAnalyticsForSeat),
        ),
      ),
    );
    expect(sample).toContain("Sample data");
    expect(sample).not.toContain(MOCK_NOTICE);
  });
});
