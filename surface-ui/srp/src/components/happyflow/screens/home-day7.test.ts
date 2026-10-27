// The Day 7 / Day 24 layout reads the Home model (srp/home-page-schema, task 12): a real seat's page shows its stored figures and none of the prototype's.
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";
import { HfHomeModelProvider } from "../home-context";
import { HomeDay7, HomeDay7Screen, day7Sub, day7Tiles } from "./home-day7";
import { homeModel, type HomeApi } from "@v3/srp/utils/home-model";
import { api } from "@v3/srp/utils/home-fixture";
import { sampleHomeModel } from "../sample-home";

async function render(Screen: ComponentType): Promise<string> {
  const root = createRootRoute();
  const seat = createRoute({ getParentRoute: () => root, path: "/seat/$kind/$id", component: Screen });
  const router = createRouter({ routeTree: root.addChildren([seat]), history: createMemoryHistory({ initialEntries: ["/seat/professional/p1"] }) });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

/** A day 12 seat whose every figure differs from the prototype's. */
const day7 = (over: Partial<HomeApi> = {}): HomeApi =>
  api({
    day: { n: 12, trial_days: 45, layout: "day7", over: false },
    person: { first_name: "Harper", full_name: "Harper Jones", title: null, photo_url: null, year_started: 2009, credentials: 1 },
    score: {
      total: 455, max: 850, band: { name: "Established", min_points: 400, next: { name: "Leading", min_points: 600 } }, as_of: "2026-10-27T12:00:00Z",
      since_claim: 150, week_delta: 31, lanes: [],
    },
    rank: { position: 4, of: 19, city: "Ames", first_position: 9 },
    board: { ...api().board!, moves: { done: 2, goal: 4 }, streak_weeks: 3, needs_you_count: 2 },
    tiles: {
      map: { scanned_at: "2026-10-20T08:00:00Z", top3: 7, total: 49, cells: [] },
      ai: { cited: 3, checked: 7, checked_at: "2026-10-26T10:00:00Z" },
      reviews: { avg: 4.6, count: 77, as_of: "2026-10-27T12:00:00Z" },
      profile_strength: { pct: 58, previous_pct: 50 },
      website: null,
      articles: { published: 1, total: 1 },
    },
    locked: { features: [{ key: "map_rank", title: "Map Rank tracking", description: null, points_waiting: null, plan: "amplify" }], points_waiting: 0 },
    brief: {
      week_start: "2026-10-20T00:00:00Z", points_total: 14, items: [{ label: "Bio approved", points: 8 }, { label: "Service areas added", points: 6 }],
      next_move: { label: "Repair my site", points: 33, target: "website" }, away: { new_reviews: 3, bio_live: true, first_article: false },
    },
    drafts: [
      { id: 1, reviewer_label: "Reviewer A. (mock)", rating: 5, review_text: "Great loan officer", draft_text: "Thank you so much", compliance_status: "passed", status: "draft" },
      { id: 2, reviewer_label: "Reviewer B. (mock)", rating: 2, review_text: "Slow replies", draft_text: "I am sorry", compliance_status: "needs_edit", status: "draft" },
      { id: 3, reviewer_label: "Reviewer C. (mock)", rating: 4, review_text: "Already answered", draft_text: "Posted text", compliance_status: "passed", status: "posted" },
    ],
    events: [],
    ...over,
  });

const model = (over: Partial<HomeApi> = {}) => homeModel(day7(over))!;
const page = (m: ReturnType<typeof model>, events = false) => render(() => createElement(HfHomeModelProvider, { model: m }, createElement(HomeDay7, { model: m, events })));
const t7 = async (over: Partial<HomeApi> = {}) => text(await page(model(over)));

describe("a real day 7 seat", () => {
  let t = "";
  test("renders", async () => {
    t = await t7();
    expect(t.length).toBeGreaterThan(500);
  });
  test("away banner and hero", () => {
    expect(t).toContain("While you were away: 3 new reviews and your bio went live.");
    expect(t).toContain("You're Established");
    expect(t).toContain("▲ 31 this week");
    expect(t).toContain("#4 of 19 in Ames");
    expect(t).toContain("Next band: Leading at 600.");
    expect(t).toContain("455");
  });
  test("year default is the stored year", async () => {
    const html = await page(model());
    expect(html).toMatch(/<option value="2009" selected/);
  });
  test("the four tiles", () => {
    expect(t).toContain("Top-3 map spots 7 of 49 Last scan Oct 20");
    expect(t).toContain("AI citations 3 of 7 Last check Oct 26");
    expect(t).toContain("Reviews 4.6 from 77 reviews");
    expect(t).toContain("Profile strength 58% up from 50%");
  });
  test("moves and streak", () => {
    expect(t).toContain("2 of 4 moves this week");
    expect(t).toContain("Streak · 3 weeks");
  });
  test("brief", () => {
    expect(t).toContain("Up 14 this week");
    expect(t).toContain("Bio approved +8");
    expect(t).toContain("Service areas added +6");
    expect(t).toContain("Repair my site · +33");
  });
  test("drafts that need you, not the posted one", () => {
    expect(t).toContain("Needs you 2");
    expect(t).toContain("Reviewer A. (mock) ★★★★★");
    expect(t).toContain("Reviewer B. (mock) ★★☆☆☆");
    expect(t).toContain('"Great loan officer"');
    expect(t).toContain("NORA'S DRAFT Thank you so much");
    expect(t).toContain("Compliant");
    expect(t).toContain("Needs an edit");
    expect(t).not.toContain("Already answered");
  });
  test("nothing of the prototype is left", () => {
    for (const s of ["Kevin", "Maria", "James", "Riverbend", "Davenport", "#5 of 41", "▲ 28", "Up 28", "9 of 49", "130 reviews", "72%", "up from 64%", "2 replies posted", "First article published", "Fix my website · +42", "2 new reviews, your bio", "crossed 400 on day 6"]) expect(t).not.toContain(s);
  });
});

describe("what changes with the data", () => {
  test("no brief: no away banner, no brief card", async () => {
    const t = await t7({ brief: null });
    expect(t).not.toContain("While you were away");
    expect(t).not.toContain("WEEKLY BRIEF");
  });
  test("nothing new while away", async () => {
    expect(await t7({ brief: { ...day7().brief!, away: { new_reviews: 0, bio_live: false, first_article: false } } })).toContain("Nothing new while you were away.");
  });
  test("no next move label: no next move button", async () => {
    const t = await t7({ brief: { ...day7().brief!, next_move: { label: null, points: null, target: null } } });
    expect(t).not.toContain("NEXT MOVE");
  });
  test("no week change, band or rank: those lines are not drawn", async () => {
    const t = await t7({ score: { ...day7().score!, week_delta: null, band: null }, rank: null });
    expect(t).not.toContain("▲");
    expect(t).not.toContain("▼");
    expect(t).not.toContain("You're ");
    expect(t).not.toContain("#4 of 19");
  });
  test("a fall is shown as a fall", async () => {
    expect(await t7({ score: { ...day7().score!, week_delta: -5 } })).toContain("▼ 5 this week");
  });
  test("streak: none hides it, one is singular", async () => {
    expect(await t7({ board: { ...day7().board!, streak_weeks: 0 } })).not.toContain("Streak");
    expect(await t7({ board: { ...day7().board!, streak_weeks: 1 } })).toContain("Streak · 1 week");
  });
  test("no drafts: says nothing needs you", async () => {
    const t = await t7({ drafts: [], board: { ...day7().board!, needs_you_count: 0 } });
    expect(t).toContain("Nothing needs you right now.");
  });
  test("tiles the data does not have are not drawn; a dash for unknown numbers", async () => {
    const t = await t7({ tiles: { ...day7().tiles!, map: null, ai: { cited: null, checked: 7, checked_at: null }, reviews: { avg: null, count: null, as_of: null }, profile_strength: { pct: 60, previous_pct: null } } });
    expect(t).not.toContain("Top-3 map spots");
    expect(t).toContain("AI citations — of 7");
    expect(t).not.toContain("Last check");
    expect(t).toContain("Reviews —");
    expect(t).toContain("Profile strength 60%");
    expect(t).not.toContain("up from");
  });
  test("the tile locks follow the data", () => {
    const tiles = day7Tiles(model());
    expect(tiles.map((x) => [x.l, x.lk])).toEqual([["Top-3 map spots", true], ["AI citations", true], ["Reviews", false], ["Profile strength", false]]);
    const open = day7Tiles(model({ locked: { features: [], points_waiting: 0 } }));
    expect(open.map((x) => x.lk)).toEqual([false, false, false, false]);
  });
  test("the moves dots fill as moves are done", async () => {
    const html = await page(model());
    expect(html.match(/data-move="done"/g)?.length).toBe(2);
    expect(html.match(/data-move="open"/g)?.length).toBe(2);
  });
  test("the score ring follows the stored maximum", async () => {
    expect(await t7({ score: { ...day7().score!, max: 900 } })).toContain("/ 900");
  });
});

describe("figures that could be mistaken for the fixture's", () => {
  test("the sub line, mobile and desktop", () => {
    expect(day7Sub(model(), true)).toBe("Day 12 of 45 · NORA is on it");
    expect(day7Sub(model(), false)).toBe("Here is what happened while you were away.");
  });
  test("the away line is bold up to the colon", async () => {
    expect(await page(model())).toContain("<b>While you were away:</b>");
    expect(await page(model({ brief: { ...day7().brief!, away: { new_reviews: 0, bio_live: false, first_article: false } } }))).not.toContain("<b>While you were away:</b>");
  });
  test("score, band, moves, badge, streak and tiles follow other values", async () => {
    const t = await t7({
      score: { ...day7().score!, total: 470, band: { name: "Leading", min_points: 450, next: null } },
      board: { ...day7().board!, moves: { done: 3, goal: 5 }, needs_you_count: 5, streak_weeks: 1 },
      tiles: { ...day7().tiles!, reviews: { avg: 4, count: 3, as_of: null }, profile_strength: { pct: 58, previous_pct: 70 } },
    });
    expect(t).toContain("470");
    expect(t).not.toContain("455");
    expect(t).toContain("You're Leading");
    expect(t).toContain("3 of 5 moves this week");
    expect(t).toContain("Needs you 5");
    expect(t).toContain("Streak · 1 week");
    expect(t).not.toContain("1 weeks");
    expect(t).toContain("Reviews 4.0");
    expect(t).not.toContain("up from");
  });
  test("no stored start year: the picker starts empty, not on a demo year", async () => {
    const html = await page(model({ person: { ...day7().person!, year_started: null } }));
    expect(html).toContain('<option value="" selected');
    expect(html).not.toMatch(/<option value="2014" selected/);
  });
  test("moves dots: three done of five", async () => {
    const html = await page(model({ board: { ...day7().board!, moves: { done: 3, goal: 5 } } }));
    expect([html.match(/data-move="done"/g)?.length, html.match(/data-move="open"/g)?.length]).toEqual([3, 2]);
  });
  test("locked tiles are marked", async () => {
    const html = await page(model());
    expect(html.match(/data-locked="true"/g)?.length).toBe(2);
    expect(html.match(/data-locked="false"/g)?.length).toBe(2);
  });
});

describe("event banners", () => {
  const ev = { kind: "facebook" as const, title: "Your Facebook connection expires Friday.", body: "Reconnect to keep your points.", action_label: "Reconnect", expires_at: "2026-10-30T12:00:00Z" };
  test("a stored event shows as the banner with its action", async () => {
    const t = await t7({ events: [ev] });
    expect(t).toContain("Your Facebook connection expires Friday. Reconnect to keep your points.");
    expect(t).toContain("Reconnect");
  });
  test("a review event is red, a facebook one yellow", async () => {
    const red = await page(model({ events: [{ ...ev, kind: "review", action_label: "Review the draft" }] }));
    expect(red).toContain("background:#fce8e6");
    expect(text(red)).toContain("Review the draft");
    expect(await page(model({ events: [ev] }))).toContain("background:#fef7e0");
  });
  test("no event: no banner", async () => {
    expect(await t7()).not.toContain("Dismiss");
  });
});

describe("the sample page", () => {
  const screen = (day: 7 | 24) => () => createElement(HomeDay7Screen, { day, events: false });
  test("is the same markup whether the screen builds the sample model or is handed it", async () => {
    for (const day of [7, 24] as const) {
      const a = await render(screen(day));
      const b = await render(() => createElement(HfHomeModelProvider, { model: sampleHomeModel(day) }, createElement(HomeDay7Screen, { day, events: false })));
      expect(b.replace(/id="[^"]*"/g, "")).toBe(a.replace(/id="[^"]*"/g, ""));
    }
  });
  test("still tells the prototype's story", async () => {
    const t = text(await render(screen(7)));
    for (const s of ["While you were away: 2 new reviews, your bio went live and your first article is published.", "You're Established", "▲ 28 this week", "#5 of 41 in Davenport", "You crossed 400 on day 6. Next band target: Riverbend at 571.",
      "Top-3 map spots 9 of 49 Last scan Oct 16", "Reviews 4.9 from 130 reviews", "Profile strength 72% up from 64%", "2 of 3 moves this week", "Streak · 1 week", "Up 28 this week", "Service areas added +6", "Fix my website · +42",
      "Needs you 2", "Maria L.", "James T.", "Compliant"]) expect(t).toContain(s);
  });
});
