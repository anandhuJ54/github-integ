// The SRS screen reads the SRS model (srp/srs-page-schema, task 9): a real seat's page shows its stored figures and none of the prototype's,
// and with no real seat the page is the prototype's. SSR render tests (no DOM, first render only: the score ring counts up in an effect, so it is not read here).
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";
import { HfSrsModelProvider } from "../srs-context";
import { SrsForSeat, srsNoticeFor } from "../srs-page";
import { CalcDialog, SrsScreen, noraFor, srsRows } from "./srs";
import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import { srsModel, type SrsApi } from "@v3/srp/utils/srs-model";
import { api } from "@v3/srp/utils/srs-fixture";
import { sampleSrsModel } from "../sample-srs";

async function render(Screen: ComponentType): Promise<string> {
  const root = createRootRoute();
  const seat = createRoute({ getParentRoute: () => root, path: "/seat/$kind/$id", component: Screen });
  const router = createRouter({ routeTree: root.addChildren([seat]), history: createMemoryHistory({ initialEntries: ["/seat/professional/p1"] }) });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

type L = NonNullable<SrsApi["lanes"]>[number];
const lane = (key: string, name: string, short: string | null, earned: number, max: number, status: L["status"], you: string | null, rival: string | null,
  note: string | null, label: string | null, target: L["action_target"]): L => ({
  key, name, short_name: short, earned, max, open: max - earned, status, you_text: you, rival_text: rival, note, action_label: label, action_target: target });

/** A seat on 455 in Ames whose every figure differs from the prototype's. Lanes are in the API's order (most open points first). */
const real = (over: Partial<SrsApi> = {}): SrsApi => {
  const lanes = [
    lane("reviews", "Reviews", "Reviews", 150, 187, "Strong", "77", "300 reviews", "9 in the last 12 months", "Read reviews", "reviews"),
    lane("completeness", "Completeness", "Completeness", 90, 182, "Fix", "Profile 58% complete", "a full profile", null, "Finish profile", "profile"),
    lane("website", "Website", "Website", 80, 102, "Strong", "Partial markup", "full markup", null, "Repair site", "website"),
    lane("articles", "Articles", "Articles", 30, 103, "Fix", "7", "9 articles", null, "Write more", "voce"),
    lane("gbp", "Google Business Profile", "GBP", 60, 68, "Strong", "Connected", "Connected", null, "Open GBP", "connections"),
    lane("directories", "Directories", "Directories", 20, 90, "Fix · locked", "13 consistent", "30", null, "Unlock Listings", "billing"),
    lane("qa", "Q&A", "Q&A", 10, 34, "Fix", "3", "15 answered", null, "Answer more", "chat"),
    lane("connections", "Connections", "Connections", 15, 51, "Fix", "1", "4 connected accounts", null, "Link accounts", "connections"),
    lane("videos", "Videos", "Videos", 0, 27, "Missing", "No videos", "a video a month", null, "Film one", "chat"),
    lane("audio", "Audio", "Audio", 0, 6, "Missing", "No audio", "6 episodes", null, null, null),
  ].sort((a, b) => (b.open as number) - (a.open as number));
  return api({
    score: { total: 455, max: 850, open_total: 395, as_of: "2026-10-27T12:00:00Z", band: { name: "Established", min_points: 400, next: { name: "Leading", min_points: 600, points_needed: 145 } } },
    rank: { position: 4, of: 19, city: "Ames" },
    rival: { name: "Prairie Home Lending", score: 500, points_to_first: 45, review_count: 300, review_avg: 4.5 },
    lanes,
    counts: { all: 10, missing: 2, fix: 5, strong: 3 },
    notes: [
      { title: "Completeness is your biggest gap.", body: "It's 92 points open.", cta: "Finish profile", action: "profile" },
      { title: "Your Articles is costing you 73 points.", body: "Prairie Home Lending: 9 articles. You: 7.", cta: "Write more", action: "voce" },
      { title: "Reviews is already strong.", body: "9 in the last 12 months", cta: "Read reviews", action: "reviews" },
    ],
    ...over,
  });
};
const model = (over: Partial<SrsApi> = {}) => srsModel(real(over))!;
const page = (m: ReturnType<typeof model> | null) => render(() => createElement(HfSrsModelProvider, { model: m }, createElement(SrsScreen)));
const SAMPLE_ONLY = ["Riverbend", "Davenport", "571", "#6 of 41", "10 points to Established", "Articles is your biggest gap — 85", "0 vs 14 articles", "Bio thin"];

describe("a real SRS seat", () => {
  let t = "";
  test("renders", async () => {
    t = text(await page(model()));
    expect(t.length).toBeGreaterThan(500);
  });
  test("the subtitle and the ring labels", () => {
    expect(t).toContain("Every gap between you and the #1 lender in Ames.");
    expect(t).toContain("YOUR SCORE · OF 850");
    expect(t).toContain("/ 850");
  });
  test("band pills, rank and the band bar", () => {
    expect(t).toContain("Established");
    expect(t).toContain("145 points to Leading");
    expect(t).toContain("#4 of 19");
    expect(t).toContain("in Ames");
    expect(t).toContain("600 Leading");
  });
  test("the target card names the rival and its figures", () => {
    expect(t).toContain("Prairie Home Lending: 500");
    expect(t).toContain("#1 in Ames · 4.5 from 300 reviews");
    expect(t).toContain("Prairie");
    expect(t).toContain(" 45 ");
    expect(t).toContain("points to #1");
    expect(t).toContain(" 395 ");
    expect(t).toContain("points open across 10 lanes");
  });
  test("the callout is the lane with the most open points", () => {
    expect(t).toContain("Completeness is your biggest gap — 92 points.");
    expect(t).toContain("Prairie: a full profile; you have Profile 58% complete.");
    expect(t).toContain("Finish profile");
  });
  test("the filter chips carry the API's counts", () => {
    expect(t).toContain("All 10");
    expect(t).toContain("Missing 2");
    expect(t).toContain("Fix 5");
    expect(t).toContain("Strong 3");
    expect(t).toContain("Your gaps vs Prairie");
  });
  test("every lane is listed with its comparison", () => {
    for (const s of ["Completeness", "Articles", "Directories", "Connections", "Reviews", "Q&A", "Website", "Videos", "Audio", "GBP",
      "Profile 58% complete vs a full profile", "7 vs 9 articles", "77 vs 300 reviews; 9 in the last 12 months", "13 consistent vs 30", "No audio vs 6 episodes"]) {
      expect(t).toContain(s);
    }
  });
  test("none of the prototype's figures are on the page", () => {
    for (const s of SAMPLE_ONLY) expect(t).not.toContain(s);
  });
});

describe("figures set in styles", () => {
  test("the ring label, the bar fill and marker, and the race bar come from the seat", async () => {
    const m = model({ score: { ...real().score!, max: 860 } });
    const html = await page(m);
    expect(text(html)).toContain("YOUR SCORE · OF 860");
    expect(text(html)).toContain("/ 860");
    expect(html).toContain(`width:${m.bar.fillPct}%`);
    expect(html).toContain(`left:${m.bar.markerPct}%`);
    expect(html).toContain(`width:${m.race.youPct}%`);
    expect([m.bar.fillPct, m.bar.markerPct, m.race.youPct]).toEqual([52.9, 69.77, 91]);
  });
  test("a lane with no action label has no action pill (one arrow fewer)", async () => {
    const arrows = (h: string) => (h.match(/<svg/g) ?? []).length;
    const without = await page(model());
    const lanes = real().lanes!.map((l) => (l.key === "audio" ? { ...l, action_label: "Plan audio", action_target: "chat" as const } : l));
    const withAct = await page(model({ lanes }));
    expect(arrows(withAct)).toBe(arrows(without) + 1);
  });
});

describe("the gap rows", () => {
  const m = model();
  test("all rows in the API's order, each with its colours and bar", () => {
    const rows = srsRows(m, "All");
    expect(rows.map((r) => r.lane)).toEqual(m.lanes.map((l) => l.lane));
    const r = rows.find((x) => x.lane === "Reviews")!;
    expect([r.earned, r.max, r.pts, r.barW, r.statusShort, r.locked]).toEqual([150, 187, 37, "80.2%", "Strong", false]);
    const d = rows.find((x) => x.lane === "Directories")!;
    expect([d.statusShort, d.locked, d.earned]).toEqual(["Locked", true, 20]);
  });
  test("the filters group the lanes, locked counting as Fix", () => {
    expect(srsRows(m, "Missing").map((r) => r.lane)).toEqual(["Videos", "Audio"]);
    expect(srsRows(m, "Strong").map((r) => r.lane)).toEqual(["Reviews", "Website", "GBP"]);
    expect(srsRows(m, "Fix").map((r) => r.lane)).toEqual(["Completeness", "Articles", "Directories", "Connections", "Q&A"]);
  });
  test("a lane with no action has no action pill; the first row is the highlighted one", () => {
    const rows = srsRows(m, "All");
    expect(rows.find((r) => r.lane === "Audio")!.act).toBe("");
    expect(rows[0].actBg).toBe("#1a73e8");
  });
});

describe("a real seat in other shapes", () => {
  test("no rival: nothing about a rival or points to #1", async () => {
    const t = text(await page(model({ rival: null })));
    expect(t).not.toContain("Prairie");
    expect(t).not.toContain("points to #1");
    expect(t).toContain("ahead of every competitor");
  });
  test("one point to the next band is singular on the pill", async () => {
    const t = text(await page(model({ score: { ...real().score!, band: { name: "Established", min_points: 400, next: { name: "Leading", min_points: 600, points_needed: 1 } } } })));
    expect(t).toContain("1 point to Leading");
    expect(t).not.toContain("1 points to Leading");
  });
  test("no band at all shows no empty band pill", async () => {
    const html = await page(model({ score: { ...real().score!, band: null } }));
    expect(html).not.toContain("background:#fef7e0;padding:5px 12px");
    expect(text(html)).toContain("#4 of 19");
  });
  test("the top band has no next band pill or marker label", async () => {
    const t = text(await page(model({ score: { ...real().score!, total: 780, open_total: 70, band: { name: "Elite", min_points: 750, next: null } } })));
    expect(t).not.toContain("points to Leading");
    expect(t).not.toContain("600 Leading");
    expect(t).toContain("Elite");
  });
  test("lanes without points are counted below the list, not shown as zero", async () => {
    const lanes = real().lanes!.map((l) => (l.key === "website" ? { ...l, earned: null, open: null, status: null } : l));
    const t = text(await page(model({ lanes })));
    expect(t).toContain("1 lane without points yet");
    expect(t).not.toContain("Partial markup vs full markup");
  });
  test("the market is named when the city is unknown", async () => {
    expect(text(await page(model({ rank: { position: 2, of: 5, city: null } })))).toContain("#1 lender in your market.");
  });
  test("a mock seat says so, a live one does not", () => {
    expect(srsNoticeFor(model())).toBe(MOCK_NOTICE);
    expect(srsNoticeFor(model({ data: "live" }))).toBe("These values come from your account.");
    expect(srsNoticeFor(null)).toBeUndefined();
  });
});

describe("NORA on the SRS page", () => {
  const n = noraFor(model());
  test("her notes become the thinks, with billing opening Billing", () => {
    expect(n.thinks!.map((x) => [x.t, x.d, x.cta, x.act])).toEqual([
      ["Completeness is your biggest gap.", "It's 92 points open.", "Finish profile", "profile"],
      ["Your Articles is costing you 73 points.", "Prairie Home Lending: 9 articles. You: 7.", "Write more", "voce"],
      ["Reviews is already strong.", "9 in the last 12 months", "Read reviews", "reviews"],
    ]);
    const b = noraFor(model({ notes: [{ title: "t", body: "b", cta: "Unlock Listings", action: "billing" }] }));
    expect(typeof b.thinks![0].act).toBe("function");
  });
  test("her chips and greeting", () => {
    expect(n.chips).toEqual(["What should I fix first?", "Why is my score 455?", "How do I pass Prairie?", "What can you do on your own?"]);
    expect(text(renderToString(createElement("span", null, n.greeting)))).toBe(" You're 145 points from Leading and 45 from #1. Here's where I'd start. ");
  });
});

describe("the calculation dialog", () => {
  const dialog = (m: ReturnType<typeof model>) => text(renderToString(createElement(CalcDialog, { isD: true, onClose: () => {}, model: m })));
  test("its numbers are the seat's", () => {
    const t = dialog(model());
    expect(t).toContain("runs from 0 to 850");
    expect(t).toContain("across 10 lanes");
    expect(t).toContain("Prairie Home Lending has earned more of them; that's the 45-point gap.");
    expect(t).toContain("You are here · 455");
    expect(t).toContain("Leading");
    expect(t).toContain("From 600");
    expect(t).toContain("Prairie · 500");
    for (const s of SAMPLE_ONLY) expect(t).not.toContain(s);
  });
  test("without a rival there is no gap sentence and no target; at the top band no next band", () => {
    const t = dialog(model({ rival: null, score: { ...real().score!, band: { name: "Elite", min_points: 750, next: null } } }));
    expect(t).not.toContain("gap.");
    expect(t).not.toContain("#1 target");
    expect(t).not.toContain("From ");
  });
});

describe("with no real seat the page is the prototype's", () => {
  test("every sample figure is there", async () => {
    const t = text(await page(null));
    for (const s of ["Every gap between you and the #1 lender in Davenport.", "#6 of 41", "in Davenport", "10 points to Established", "400 Established",
      "Riverbend Bank & Trust: 571", "#1 in Davenport · 4.7 from 412 reviews", "181", "460", "points open across 10 lanes",
      "Articles is your biggest gap — 85 points.", "Riverbend has 14; you have none.", "Your gaps vs Riverbend",
      "All 10", "Missing 4", "Fix 4", "Strong 2", "0 vs 14 articles", "128 vs 412 reviews; 31 in the last 12 months"]) {
      expect(t).toContain(s);
    }
  });
  test("the sample rows are the prototype's lanes", () => {
    expect(srsRows(sampleSrsModel(), "All").map((r) => r.lane)).toEqual(["Completeness", "Articles", "Website", "Directories", "Connections", "Reviews", "Q&A", "Videos", "Audio", "GBP"]);
  });
  test("the page under a real seat's provider shows the mock notice; without one, the sample notice", async () => {
    const withSeat = text(await render(() => createElement(HfSrsModelProvider, { model: model() }, createElement(SrsForSeat))));
    expect(withSeat).toContain(MOCK_NOTICE);
    const sample = text(await render(() => createElement(HfSrsModelProvider, { model: null }, createElement(SrsForSeat))));
    expect(sample).toContain("Sample data");
    expect(sample).not.toContain(MOCK_NOTICE);
  });
});
