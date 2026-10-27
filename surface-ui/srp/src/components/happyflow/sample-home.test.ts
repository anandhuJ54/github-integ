// The sample Home model (srp/home-page-schema, task 9): it reproduces every constant the layouts used to hold inline, so the sample view is unchanged.
import { describe, expect, test } from "bun:test";
import { GRID, PERSONA, RIVALS, RIVERBEND_SCORE, SCORE_AT_LANDING, SCORE_BY_DAY } from "./demo-data";
import { rankColor } from "@v3/srp/utils/home-model";
import { BRIEF, CHIPS, DONE_BEFORE, LOCKED, MOVES, PLANS, SCORE_AT_CLAIM, TASK_POINTS, THINKS_DAY1, THINKS_DAY7, TILES, YEARS, draftsFor, sampleHomeModel } from "./sample-home";
import { monthDay } from "@v3/srp/utils/home-model";

describe("day 1", () => {
  const m = sampleHomeModel(1);
  test("is the sample, mock, on the day 1 layout", () => {
    expect([m.mode, m.isMock, m.layout, m.day, m.person]).toEqual(["sample", true, "day1", { n: 1, trialDays: 30, over: false }, null]);
  });
  test("score: 390 of 850, counting up from 384, Building, 92 since the claim", () => {
    expect(m.score).toEqual({ total: 390, max: 850, startTotal: 384, band: "Building", nextBand: { name: "Established", min: 400 }, sinceClaim: 92, weekDelta: null });
    expect(m.score.total).toBe(SCORE_BY_DAY[1]);
    expect(m.score.startTotal).toBe(SCORE_AT_LANDING);
    expect(m.score.total - SCORE_AT_CLAIM).toBe(92);
    expect(m.score.total - m.score.startTotal).toBe(TASK_POINTS);
  });
  test("rank #6 of 41 in Davenport and the rival 571, 181 points ahead", () => {
    expect(m.rank).toEqual({ position: 6, of: 41, city: "Davenport", firstPosition: 6 });
    expect(m.rival).toEqual({ name: RIVALS[0], short: "Riverbend", initial: "R", score: RIVERBEND_SCORE, pointsToFirst: 181, reviewCount: 412, reviewAvg: 4.7, articleCount: 14 });
    expect(m.competitorCount).toBe(RIVALS.length);
    expect(m.copy.heroSentence).toBe("Riverbend Bank & Trust is #1 in Davenport — here's your gap. You're #6 of 41.");
    expect(m.copy.bandNote).toBeNull();
  });
  test("the board is the constants: moves, done list, 10 things worth 92 points", () => {
    expect(m.board.nextMoves.map((x) => [x.icon, x.title, x.subtitle, x.recommended, x.target])).toEqual(MOVES.map((x) => [x.icon, x.t, x.sub, x.rec, x.to]));
    // as the API sends it: the latest finished task first, then the earlier ones
    expect(m.board.done).toEqual([{ label: "Adding your Google category and services", points: 6 }, ...DONE_BEFORE.map(([label, p]) => ({ label, points: p ? Number(p.slice(1)) : null }))]);
    expect(m.board.done.map((d) => d.points)).toEqual([6, 19, 13, 54, null]);
    expect(m.board.latest).toEqual({ label: "Adding your Google category and services", points: 6, status: "done" });
    expect([m.board.doneCount, m.board.sinceClaimPoints, m.board.moves, m.board.streakWeeks, m.board.needsYouCount]).toEqual([10, 92, { done: 0, goal: 3 }, 0, 0]);
    expect(m.board.done.reduce((a, d) => a + (d.points ?? 0), 0)).toBe(m.board.sinceClaimPoints);
  });
  test("the model's map cells colour exactly like the prototype's grid", () => {
    expect(m.tiles.map!.cells.map((c) => rankColor(c.rank))).toEqual(GRID.map((g) => g.bg));
  });
  test("the tiles: 9 of 49, 1 of 7, 4.9 from 128 reviews, 64%", () => {
    expect(m.tiles.map).toMatchObject({ top3: 9, total: 49, scannedAt: null, locked: false });
    expect(m.tiles.map!.cells).toHaveLength(49);
    expect(m.tiles.map!.cells.filter((c) => c.rank !== null && c.rank <= 3)).toHaveLength(9);
    expect(m.tiles.map!.cells.filter((c) => c.rank === null)).toHaveLength(GRID.filter((c) => c.rank === "20+").length);
    expect(m.tiles.ai).toEqual({ cited: 1, checked: 7, checkedAt: null, locked: false });
    expect(m.tiles.reviews).toEqual({ avg: 4.9, count: 128, asOf: null });
    expect(m.tiles.profileStrength).toEqual({ pct: 64, previousPct: null });
    expect(m.tiles.website).toEqual({ score: 40, max: 102, url: null });
    expect(m.tiles.reviews.count).toBe(PERSONA.reviews);
  });
  test("locked cards: Listings +42, VOCE +85, Map Rank with no points; 127 waiting", () => {
    expect(m.locked.features.map((f) => [f.title, f.text, f.pointsWaiting])).toEqual(LOCKED.map((l) => [l.t, l.d, l.pts ? Number(l.pts.slice(1)) : null]));
    expect(m.locked.features.map((f) => f.pointsWaiting)).toEqual([42, 85, null]);
    expect(m.locked.pointsWaiting).toBe(127);
    expect(m.locked.features.reduce((a, f) => a + (f.pointsWaiting ?? 0), 0)).toBe(127);
    expect(m.trial).toEqual({ lockedList: "Listings, VOCE articles, Map Rank tracking and AI-citation monitoring", lockedCount: 4, pointsWaiting: 127, showBanner: true });
  });
  test("peers, insights, plans", () => {
    expect(m.peers).toEqual({ bandFrom: "Building", medianGain: 61, horizonDays: 90, cohortSize: 34, cohortPeriod: "Jan–Sep 2026", reachedNextBand: 3, of: 5 });
    expect(m.insights.map((i) => [i.title, i.body, i.cta])).toEqual(THINKS_DAY1.map((t) => [t.t, t.d, t.cta]));
    expect(m.plans.map((p) => [p.name, p.tag, p.items, p.cta, p.highlight])).toEqual(PLANS.map((p) => [p.name, p.tag, p.items, p.cta ?? null, Boolean(p.highlight)]));
    expect(m.brief).toBeNull();
    expect(m.recap).toBeNull();
    expect(m.drafts).toEqual([]);
    expect(CHIPS).toContain("Why is my score 390?");
  });
});

describe("day 7", () => {
  const m = sampleHomeModel(7);
  test("418, Established, #5 of 41, 28 this week", () => {
    expect(m.layout).toBe("day7");
    expect(m.score).toMatchObject({ total: 418, startTotal: 418, band: "Established", weekDelta: 28 });
    expect(m.rank).toMatchObject({ position: 5, of: 41, city: "Davenport" });
    expect(m.copy.bandNote).toBe("You crossed 400 on day 6. Next band target: Riverbend at 571.");
    expect(m.board.moves).toEqual({ done: 2, goal: 3 });
    expect(m.board.streakWeeks).toBe(1);
  });
  test("the tiles are the TILES constants", () => {
    const t = m.tiles;
    expect([t.map!.top3, t.map!.total, monthDay(t.map!.scannedAt), t.map!.locked]).toEqual([9, 49, "Oct 16", TILES[0].lk]);
    expect(TILES[0].n).toBe(`Last scan ${monthDay(t.map!.scannedAt)}`);
    expect([t.ai!.cited, t.ai!.checked, monthDay(t.ai!.checkedAt), t.ai!.locked]).toEqual([1, 7, "Oct 16", TILES[1].lk]);
    expect(TILES[2].n).toBe(`from ${t.reviews.count} reviews`);
    expect([t.reviews.avg, t.profileStrength]).toEqual([4.9, { pct: 72, previousPct: 64 }]);
    expect(TILES[3].v).toBe(`${t.profileStrength.pct}%`);
    expect(TILES[3].n).toBe(`up from ${t.profileStrength.previousPct}%`);
  });
  test("the brief adds up to 28 and the away text is the sentence on the page", () => {
    expect(m.brief!.items).toEqual(BRIEF.map(([label, p]) => ({ label, points: Number(p.slice(1)) })));
    expect(m.brief!.pointsTotal).toBe(28);
    expect(m.brief!.items.reduce((a, i) => a + (i.points ?? 0), 0)).toBe(28);
    expect(m.brief!.nextMove).toEqual({ label: "Fix my website", points: 42, target: "website" });
    expect(m.brief!.awayText).toBe("While you were away: 2 new reviews, your bio went live and your first article is published.");
  });
  test("two drafts, the first names the professional; two things need you", () => {
    expect(m.drafts).toHaveLength(2);
    expect(m.board.needsYouCount).toBe(2);
    expect(m.drafts[0]).toMatchObject({ reviewerLabel: "Maria L.", rating: 5, compliant: true, status: "draft" });
    expect(m.drafts[0].reviewText).toContain(PERSONA.first);
    expect(sampleHomeModel(7, "Pat").drafts[0].reviewText).toContain("Pat");
    expect(m.drafts.map((d) => [d.reviewerLabel, d.rating, d.reviewText, d.draftText])).toEqual(draftsFor(PERSONA.first).map((d) => [d.n, d.s, d.t, d.d]));
  });
  test("insights are the day 7 ones; no recap", () => {
    expect(m.insights.map((i) => [i.title, i.body])).toEqual(THINKS_DAY7.map((t) => [t.t, t.d]));
    expect(m.recap).toBeNull();
    expect(YEARS).toHaveLength(37);
  });
});

describe("day 24", () => {
  const m = sampleHomeModel(24);
  test("471 and the recap numbers", () => {
    expect(m.layout).toBe("day24");
    expect(m.score.total).toBe(471);
    expect(m.rank!.position).toBe(4);
    expect(m.recap).toEqual({
      days: 24, thingsDone: 41, articles: 3, replies: 12,
      tiles: [{ label: "Score", from: 384, to: 471, delta: 87 }, { label: "Rank", from: 6, to: 4, delta: 2 }, { label: "Profile strength", from: 64, to: 88, delta: 24 }],
    });
  });
});

describe("every day", () => {
  test("the score matches the demo timeline and the rival gap is consistent", () => {
    for (const day of [1, 7, 24] as const) {
      const m = sampleHomeModel(day);
      expect(m.score.total).toBe(SCORE_BY_DAY[day]);
      expect(m.rival!.pointsToFirst).toBe(RIVERBEND_SCORE - m.score.total);
      expect(m.tiles.reviews.count).toBe(day === 1 ? 128 : 130);
    }
  });
});
