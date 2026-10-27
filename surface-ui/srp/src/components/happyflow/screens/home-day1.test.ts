// The Day 1 layout reads the Home model (srp/home-page-schema, task 10): a real seat's page shows its stored figures and none of the prototype's.
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";
import { HfHomeModelProvider } from "../home-context";
import { HomeDay1, HomeDay1Screen, day1Facts, miniMap } from "./home-day1";
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
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

/** A day 1 seat whose every figure differs from the prototype's. */
const day1 = (over: Partial<HomeApi> = {}): HomeApi =>
  api({
    day: { n: 1, trial_days: 45, layout: "day1", over: false },
    score: {
      total: 363, max: 850, band: { name: "Building", min_points: 0, next: { name: "Established", min_points: 400 } }, as_of: "2026-10-27T12:00:00Z",
      since_claim: 41, week_delta: null, lanes: [],
    },
    rank: { position: 9, of: 27, city: "Ames", first_position: 9 },
    rival: { name: "Harbor Mortgage Group", initial: "H", score: 588, points_to_first: 225, review_count: 310, review_avg: 4.4, article_count: 9 },
    board: {
      latest: { label: "Registering your Bing listing", points: 7, status: "done", started_at: "2026-10-27T10:30:00Z", completed_at: "2026-10-27T11:00:00Z" },
      done: [{ label: "Registering your Bing listing", points: 7 }, { label: "Wrote your bio", points: 11 }, { label: "Mapped 4 competitors", points: null }],
      done_count: 6, since_claim_points: 41,
      next_moves: [
        { icon: "pen", title: "Publish a story", subtitle: "Your gap: 0 articles to 9.", recommended: true, target: "voce", points: 85 },
        { icon: "wrench", title: "Repair your site", subtitle: "Health 33 of 102", recommended: false, target: "website", points: null },
      ],
      moves: { done: 1, goal: 4 }, streak_weeks: 0, needs_you_count: 0,
    },
    tiles: {
      map: { scanned_at: null, top3: 13, total: 36, cells: [{ row: 0, col: 0, rank: 1 }, { row: 0, col: 1, rank: 6 }, { row: 3, col: 3, rank: 12 }, { row: 6, col: 6, rank: null }] },
      ai: { cited: 2, checked: 5, checked_at: null },
      reviews: { avg: 4.6, count: 77, as_of: "2026-10-27T12:00:00Z" },
      profile_strength: { pct: 58, previous_pct: null },
      website: { score: 33, max: 102, url: null },
      articles: { published: 0, total: 0 },
    },
    locked: {
      features: [
        { key: "listings", title: "Listings", description: "Nine directories miss you.", points_waiting: 31, plan: "engage" },
        { key: "voce", title: "VOCE", description: "No stories yet.", points_waiting: 85, plan: "engage" },
        { key: "map_rank", title: "Map Rank tracking", description: "See when you pass the leader.", points_waiting: null, plan: "amplify" },
      ],
      points_waiting: 116,
    },
    peers: { band_from: "Building", median_gain: 47, horizon_days: 60, cohort_size: 22, cohort_period: "Feb–Aug 2026", reached_next_band: 4, of: 6 },
    ...over,
  });

const model = (over: Partial<HomeApi> = {}) => homeModel(day1(over))!;
const page = (m: ReturnType<typeof model>, settled = false) => render(() => createElement(HfHomeModelProvider, { model: m }, createElement(HomeDay1, { model: m, settled })));

describe("a real day 1 seat, before the first task finishes", () => {
  let t = "";
  test("renders", async () => {
    t = text(await page(model()));
    expect(t.length).toBeGreaterThan(500);
  });
  test("the hero: day, rival, sentence, scores and the gap at the starting total", () => {
    expect(t).toContain("YOUR MISSION · DAY 1 OF 45");
    expect(t).toContain("Pass Harbor Mortgage Group");
    expect(t).toContain("Harbor Mortgage Group is #1 in Ames — here's your gap. You're #9 of 27.");
    expect(t).toContain("You 356");           // the count-up starts at the total less the task's 7 points
    expect(t).toContain("Harbor 588");
    expect(t).toContain("232 points to #1");  // 588 - 356
    expect(t).toContain("400 · Established");
    expect(t).toContain("OF 850");
    expect(t).toContain("Building");
    expect(t).toContain("▲ 34 since you claimed"); // 41 less the 7 not yet counted
  });
  test("the board: moves, the task, up next and the done list", () => {
    expect(t).toContain("1 of 4 moves this week");
    expect(t).toContain("Registering your Bing listing");
    expect(t).toContain("DOING NOW");
    expect(t).toContain("Publish a story");
    expect(t).toContain("Your gap: 0 articles to 9.");
    expect(t).toContain("Repair your site");
    expect(t).toContain("Health 33 of 102");
    expect(t).toContain("DONE · 5 THINGS");  // 6 once the task is done
    expect(t).toContain("+34 points since you claimed");
    expect(t).toContain("Wrote your bio +11");
    expect(t).toContain("Mapped 4 competitors");
    expect(t).toContain("ChatGPT names you in 2 of 5 answers.");
    expect(t).toContain("Nothing needs you right now.");
    expect(t).not.toContain("Registering your Bing listing +7"); // not in the list until it is finished
  });
  test("the tiles", () => {
    expect(t).toContain("13 of 36");
    expect(t).toContain("2 of 5");
    expect(t).toContain("4.6");
    expect(t).toContain("from 77 reviews");
    expect(t).toContain("58%");
  });
  test("the locked cards and their total", () => {
    expect(t).toContain("116 points waiting");
    expect(t).toContain("Listings");
    expect(t).toContain("Nine directories miss you. 31 points are waiting.");
    expect(t).toContain("+31");
    expect(t).toContain("+85");
    expect(t).toContain("Map Rank tracking");
    expect(t).toContain("See when you pass the leader.");
  });
  // The trial banner and chip at the top (Day 1 of 30, 127 points waiting) belong to the shell: task 11.
  test("nothing of the prototype's persona or numbers is left in the page itself", () => {
    for (const s of ["Riverbend", "Davenport", "#6 of 41", "of 49", "1 of 7", "4.9", "128", "64%", "Google category", "Fixed 4 places", "571", "181", "92 ", "390", "384"]) expect(t).not.toContain(s);
  });
  test("the peer card waits for the first task to finish", () => {
    expect(t).not.toContain("median points");
  });
});

describe("a real day 1 seat, first task finished", () => {
  let t = "";
  test("the settled page shows the stored totals and the peer card", async () => {
    t = text(await page(model(), true));
    expect(t).toContain("You 363");
    expect(t).toContain("225 points to #1");
    expect(t).toContain("▲ 41 since you claimed");
    expect(t).toContain("Done · +7 points");
    expect(t).toContain("JUST FINISHED");
    expect(t).toContain("DONE · 6 THINGS");
    expect(t).toContain("+41 points since you claimed");
    expect(t).toContain("Registering your Bing listing +7");
    expect(t).toContain("+47");
    expect(t).toContain("median points in 60 days");
    expect(t).toContain("4 of 6 reached the next band.");
    expect(t).toContain("Based on 22 loan officers who started at Building, Feb–Aug 2026.");
  });
});

describe("what changes with the data", () => {
  test("no rival: the hero says you lead and shows no gap", async () => {
    const t = text(await page(model({ rival: null, rank: { position: 1, of: 27, city: "Ames", first_position: 1 } })));
    expect(t).toContain("You lead Ames");
    expect(t).toContain("You lead Ames. You're #1 of 27.");
    expect(t).not.toContain("points to #1");
    expect(t).not.toContain("Pass ");
  });
  test("the top band has no next-band marker, only its name", async () => {
    const t = text(await page(model({ score: { ...day1().score!, band: { name: "Elite", min_points: 750, next: null } } })));
    expect(t).toContain("Elite");
    expect(t).not.toContain("400 · Established");
  });
  test("the ring label follows the stored maximum", async () => {
    const t = text(await page(model({ score: { ...day1().score!, max: 900 } })));
    expect(t).toContain("OF 900");
    expect(t).not.toContain("OF 850");
  });
  test("a number the data does not have is a dash, never a demo number", async () => {
    const t = text(await page(model({ tiles: { ...day1().tiles!, ai: { cited: null, checked: 5, checked_at: null }, reviews: { avg: null, count: null, as_of: null }, profile_strength: { pct: null, previous_pct: null } } })));
    expect(t).toContain("— of 5");
    expect(t).not.toContain("ChatGPT names you");
    expect(t).not.toContain("from 77 reviews");
    expect(t).not.toContain("4.6");
  });
  test("a tile section the API leaves out is not drawn", async () => {
    const t = text(await page(model({ tiles: { ...day1().tiles!, map: null, ai: null }, peers: null })));
    expect(t).not.toContain("Top-3 map spots");
    expect(t).not.toContain("AI citations");
    expect(t).not.toContain("ChatGPT names you");
    expect(text(await page(model({ peers: null }), true))).not.toContain("median points");
  });
  test("things that need you are counted", async () => {
    const t = text(await page(model({ board: { ...day1().board!, needs_you_count: 2 } })));
    expect(t).toContain("2 things need you right now.");
    expect(t).not.toContain("Nothing needs you right now.");
  });
  test("the moves dots fill as moves are done", async () => {
    const html = await page(model());
    expect(html.match(/data-move="done"/g)?.length).toBe(1);
    expect(html.match(/data-move="open"/g)?.length).toBe(3);
  });
});

describe("markup details that carry a figure", () => {
  const dot = (bg: string) => new RegExp(`width:7px;height:7px;border-radius:2px;background:${bg}`, "g");
  test("the score bar, the band marker and the dots", async () => {
    const html = await page(model());
    expect(html).toContain("width:60.5%");      // 356 of 588
    expect(html).toContain("left:68%");         // 400 of 588
    expect(html.match(/background:#9b72f2"/g)?.length).toBe(2);           // 2 of 5 AI answers name you
    expect(html.match(/background:#eceef1"><\/span>/g)?.length).toBe(3);  // and 3 do not
  });
  test("the peer dots: 4 of 6 reached the next band", async () => {
    const html = await page(model(), true);
    expect(html.match(/width:12px;height:12px;border-radius:50%;background:#34a853/g)?.length).toBe(4);
    expect(html.match(/width:12px;height:12px;border-radius:50%;background:#e6f4ea/g)?.length).toBe(2);
  });
  test("the mini map: one colour per rank band, the office blue, spots without data grey", async () => {
    const html = await page(model());
    expect(html).toContain("grid-template-columns:repeat(7,7px)");
    expect([html.match(dot("#34a853"))?.length, html.match(dot("#fbbc04"))?.length, html.match(dot("#ea4335"))?.length, html.match(dot("#1a73e8"))?.length]).toEqual([1, 1, 1, 1]);
    expect(html.match(dot("#eceef1"))?.length).toBe(45);
  });
  test("a map of another size: its own columns, the middle spot is the office", () => {
    const cells = Array.from({ length: 15 }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3, rank: i + 1 }));
    const { cols, spots } = miniMap(cells);
    expect([cols, spots.length, spots.findIndex((x) => x.bg === "#1a73e8")]).toEqual([3, 15, 7]);   // 5 rows, 3 columns: the middle is row 2, column 1
    expect(spots[0].bg).toBe("#34a853");
    expect(miniMap([]).spots).toHaveLength(1);
  });
  test("the locked grid has one column per feature", async () => {
    const two = { ...day1().locked!, features: day1().locked!.features.slice(0, 2) };
    expect(await page(model({ locked: two }))).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(await page(model())).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
  });
  test("the stars follow the average", async () => {
    const t = text(await page(model({ tiles: { ...day1().tiles!, reviews: { avg: 3.4, count: 9, as_of: null } } })));
    expect(t).toContain("3.4 ★★★ from 9 reviews");
  });
});

describe("what NORA's panel says on day 1", () => {
  const f = day1Facts(model());
  test("the first task", () => {
    expect([f.start, f.points, f.label, f.doneNote]).toEqual([356, 7, "Registering your Bing listing", "Done · +7 points"]);
  });
  test("status and launcher, working and done", () => {
    expect([f.status(false), f.status(true)]).toEqual(["Working on 1 task", "All caught up · on for you 45 days"]);
    expect([f.launcher(false), f.launcher(true)]).toEqual(["Registering your Bing listing", "Done · +7 points"]);
    expect(day1Facts(sampleHomeModel(1)).launcher(false)).toBe("Adding your Google category…");
  });
  test("the insights and the chips come from the data", () => {
    expect(f.thinks).toEqual([{ t: "Lead is content", d: "They have 14 articles.", cta: "", act: "voce" }]);
    expect(f.chips).toEqual(["Where am I losing to Harbor?", "What should I fix first?", "Write my first article", "Why is my score 363?", "Show my map"]);
  });
  test("no task yet: nothing is counted up", () => {
    const g = day1Facts(model({ board: { ...day1().board!, latest: null } }));
    expect([g.label, g.points, g.start]).toEqual(["Nothing running right now", 0, 363]);
  });
});

describe("second review: a task still running, a fall, a marker past the end", () => {
  const doing = () => ({ ...day1().board!, latest: { label: "Writing your first article", points: null, status: "doing" as const, started_at: "2026-10-27T11:56:00Z", completed_at: null }, done_count: 3,
    done: [{ label: "Wrote your bio", points: 11 }, { label: "Mapped 4 competitors", points: null }, { label: "Kept 9 loan products", points: 5 }] });
  test("a task the database says is running is never shown as finished", async () => {
    for (const settled of [false, true]) {
      const t = text(await page(model({ board: doing() }), settled));
      expect(t).toContain("DOING NOW");
      expect(t).toContain("Writing your first article");
      expect(t).toContain("In progress");
      expect(t).not.toContain("JUST FINISHED");
      expect(t).not.toContain("Done · +");
      expect(t).toContain("DONE · 3 THINGS");
      expect(t).not.toContain("Writing your first article +");
      expect(t).toContain("You 363");
    }
  });
  test("a running task counts nothing up", () => {
    const f = day1Facts(model({ board: doing() }));
    expect([f.running, f.points, f.start]).toEqual([true, 0, 363]);
    expect(day1Facts(model()).running).toBe(false);
  });
  test("a fall since you claimed shows a down arrow", async () => {
    const t = text(await page(model({ score: { ...day1().score!, since_claim: -5 } }), true));
    expect(t).toContain("▼ 5 since you claimed");
    expect(t).toContain("−5 points since you claimed");
    expect(t).not.toContain("▲ -5");
  });
  test("the band marker stays inside the bar", async () => {
    const html = await page(model({ rival: { ...day1().rival!, score: 380, points_to_first: 17 } }));
    expect(html).toContain("left:100%");
    expect(html).not.toContain("left:105%");
  });
});

describe("the sample page", () => {
  test("is the same markup whether the screen builds the sample model or is handed it", async () => {
    const a = await render(HomeDay1Screen);
    const m = sampleHomeModel(1);
    const b = await render(() => createElement(HfHomeModelProvider, { model: m }, createElement(HomeDay1Screen)));
    expect(b.replace(/id="[^"]*"/g, "")).toBe(a.replace(/id="[^"]*"/g, ""));
  });
  test("still tells the prototype's story", async () => {
    const t = text(await render(HomeDay1Screen));
    for (const s of ["Pass Riverbend Bank & Trust", "You 384", "Riverbend 571", "187 points to #1", "400 · Established", "OF 850", "0 of 3 moves this week", "DONE · 9 THINGS", "9 of 49", "1 of 7", "4.9", "from 128 reviews", "64%", "127 points waiting"]) expect(t).toContain(s);
  });
});
