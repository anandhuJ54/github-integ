// The Home view model built from the API's response (srp/home-page-schema, task 9). Pure functions, no DOM, no network.
import { describe, expect, test } from "bun:test";
import { awayText, chipsFor, heroSentence, homeModel, joinList, launcherLabel, monthDay, MOCK_NOTICE, rankColor, shortName } from "@v3/srp/utils/home-model";
import { api } from "@v3/srp/utils/home-fixture";
import { sampleHomeModel } from "@v3/srp/components/happyflow/sample-home";

describe("not ready", () => {
  test("no data, ready false or a missing core section gives no model (the sample view)", () => {
    expect(homeModel(null)).toBeNull();
    expect(homeModel(undefined)).toBeNull();
    expect(homeModel(api({ ready: false }))).toBeNull();
    expect(homeModel(api({ score: null }))).toBeNull();
    expect(homeModel(api({ day: null }))).toBeNull();
  });
});

describe("a ready response", () => {
  const m = homeModel(api())!;
  test("identity, day and plan", () => {
    expect([m.mode, m.isMock, m.layout, m.day]).toEqual(["real", true, "day7", { n: 8, trialDays: 30, over: false }]);
    expect(m.person).toEqual({ firstName: "Pat", fullName: "Pat Example", title: "Loan officer", photoUrl: null, yearStarted: 2014, credentials: 2 });
    expect(m.plan).toEqual({ key: "core", name: "Core", tag: "Free after your 30-day trial" });
    expect(m.noraTextDay).toBe("Tuesday early morning");
  });
  test("live data is not labelled mock", () => {
    expect(homeModel(api({ data: "live" }))!.isMock).toBe(false);
  });
  test("score: total, maximum, band and next band, claim and week changes", () => {
    expect(m.score).toEqual({ total: 420, max: 850, startTotal: 414, band: "Established", nextBand: { name: "Leading", min: 600 }, sinceClaim: 120, weekDelta: 70 });
  });
  test("the count-up starts below the total by the latest finished task, and not at all for one in progress", () => {
    expect(m.score.startTotal).toBe(420 - 6);
    const doing = api();
    doing.board!.latest = { label: "Writing", points: 5, status: "doing", started_at: null, completed_at: null };
    expect(homeModel(doing)!.score.startTotal).toBe(420);
    const noPoints = api();
    noPoints.board!.latest!.points = null;
    expect(homeModel(noPoints)!.score.startTotal).toBe(420);
  });
  test("no band means no band and no next band", () => {
    const x = api();
    x.score!.band = null;
    const mm = homeModel(x)!;
    expect([mm.score.band, mm.score.nextBand, mm.copy.bandNote]).toEqual([null, null, null]);
  });
  test("rank, rival and the sentences composed from them", () => {
    expect(m.rank).toEqual({ position: 6, of: 41, city: "Davenport", firstPosition: 12 });
    expect(m.rival).toEqual({ name: "Riverbend Bank & Trust", short: "Riverbend", initial: "R", score: 571, pointsToFirst: 151, reviewCount: 412, reviewAvg: 4.7, articleCount: 14 });
    expect(m.copy.heroSentence).toBe("Riverbend Bank & Trust is #1 in Davenport — here's your gap. You're #6 of 41.");
    expect(m.copy.bandNote).toBe("Next band: Leading at 600.");
    expect(m.competitorCount).toBe(5);
  });
  test("board: lists, moves, empty subtitle becomes an empty string", () => {
    expect(m.board.done).toEqual([{ label: "Adding your Google category and services", points: 6 }, { label: "Mapped 5 competitors", points: null }]);
    expect([m.board.doneCount, m.board.sinceClaimPoints, m.board.moves, m.board.streakWeeks, m.board.needsYouCount]).toEqual([2, 6, { done: 2, goal: 3 }, 1, 1]);
    expect(m.board.nextMoves[0]).toEqual({ icon: "pen", title: "Start publishing", subtitle: "", recommended: true, target: "voce", points: 85 });
    expect(m.board.latest).toEqual({ label: "Adding your Google category and services", points: 6, status: "done" });
  });
  test("tiles: map and AI are locked while the map feature is locked", () => {
    expect(m.tiles.map).toEqual({ top3: 2, total: 49, scannedAt: "2026-10-20T08:00:00Z", cells: [{ row: 0, col: 0, rank: 1 }, { row: 0, col: 1, rank: null }], locked: true });
    expect(m.tiles.ai).toEqual({ cited: 1, checked: 7, checkedAt: "2026-10-26T10:00:00Z", locked: true });
    expect(m.tiles.reviews).toEqual({ avg: 4.9, count: 128, asOf: "2026-10-27T12:00:00Z" });
    expect(m.tiles.profileStrength).toEqual({ pct: 64, previousPct: 50 });
    expect(m.tiles.website).toEqual({ score: 91, max: 102, url: "https://example.test/seat-34" });
    expect(m.tiles.articles).toEqual({ published: 3, total: 4 });
  });
  test("map and AI are open once map rank is no longer locked; missing tiles stay missing", () => {
    const x = api();
    x.locked = { features: [], points_waiting: 0 };
    x.tiles!.map = null;
    x.tiles!.ai = null;
    x.tiles!.website = null;
    const mm = homeModel(x)!;
    expect([mm.tiles.map, mm.tiles.ai, mm.tiles.website]).toEqual([null, null, null]);
    expect(mm.trial.showBanner).toBe(false);
    const y = api();
    y.locked = { features: [{ key: "listings", title: "Listings", description: null, points_waiting: 5, plan: "engage" }], points_waiting: 5 };
    expect([homeModel(y)!.tiles.map!.locked, homeModel(y)!.tiles.ai!.locked]).toEqual([false, false]);
  });
  test("locked features: text is the description and the points waiting; the banner lists their titles", () => {
    expect(m.locked.features).toEqual([
      { key: "listings", title: "Listings", text: "Directories miss you. 87 points are waiting.", pointsWaiting: 87, plan: "engage" },
      { key: "map_rank", title: "Map Rank tracking", text: "See the week you pass the leader.", pointsWaiting: null, plan: "amplify" },
    ]);
    expect(m.locked.pointsWaiting).toBe(87);
    expect(m.trial).toEqual({ lockedList: "Listings and Map Rank tracking", lockedCount: 2, pointsWaiting: 87, showBanner: true });
  });
  test("peers, brief and the away text", () => {
    expect(m.peers).toEqual({ bandFrom: "Building", medianGain: 61, horizonDays: 90, cohortSize: 34, cohortPeriod: "Jan–Sep 2026", reachedNextBand: 3, of: 5 });
    expect(m.brief).toEqual({
      weekStart: "2026-10-20T00:00:00Z", pointsTotal: 14, items: [{ label: "Bio approved", points: 8 }, { label: "Service areas added", points: 6 }],
      nextMove: { label: "Fix my website", points: 42, target: "website" }, awayText: "While you were away: 1 new review and your bio went live.",
    });
  });
  test("drafts, events, insights and plans", () => {
    expect(m.drafts.map((d) => [d.id, d.reviewerLabel, d.compliant])).toEqual([[1, "Reviewer A. (mock)", true], [2, "Reviewer B. (mock)", false]]);
    expect(m.events).toEqual([{ kind: "facebook", title: "Your Facebook connection expires Friday", body: "", actionLabel: "Reconnect", expiresAt: "2026-10-30T12:00:00Z" }]);
    expect(m.insights).toEqual([{ title: "Lead is content", body: "They have 14 articles.", cta: "", action: "voce" }]);
    expect(m.plans.map((p) => [p.name, p.tag, p.cta, p.highlight])).toEqual([["Core", "", null, false], ["Amplify", "Includes Engage", "Choose Amplify", true]]);
  });
  test("null optional sections become empty lists or null, never demo values", () => {
    const x = api({ peers: null, brief: null, drafts: null, events: null, insights: null, plans: null, recap: null, rival: null, person: null });
    const mm = homeModel(x)!;
    expect([mm.peers, mm.brief, mm.drafts, mm.events, mm.insights, mm.plans, mm.recap, mm.rival, mm.person]).toEqual([null, null, [], [], [], [], null, null, null]);
    expect(mm.copy.heroSentence).toBe("You lead Davenport. You're #6 of 41.");
  });
  test("the recap is carried through on day 24", () => {
    const x = api({ day: { n: 25, trial_days: 30, layout: "day24", over: false }, recap: { days: 25, things_done: 9, articles: 3, replies: 2, tiles: [{ label: "Score", from: 300, to: 420, delta: 120 }] } });
    expect(homeModel(x)!.recap).toEqual({ days: 25, thingsDone: 9, articles: 3, replies: 2, tiles: [{ label: "Score", from: 300, to: 420, delta: 120 }] });
  });
});

describe("the real and the sample model share one shape and one formatting", () => {
  test("built from the sample's numbers, the real model gives the same score, rank, rival, hero sentence and board figures", () => {
    const s = sampleHomeModel(1);
    const x = api({
      day: { n: 1, trial_days: 30, layout: "day1", over: false },
      score: { total: 390, max: 850, band: { name: "Building", min_points: 0, next: { name: "Established", min_points: 400 } }, as_of: null, since_claim: 92, week_delta: null, lanes: [] },
      rank: { position: 6, of: 41, city: "Davenport", first_position: 6 },
      rival: { name: "Riverbend Bank & Trust", initial: "R", score: 571, points_to_first: 181, review_count: 412, review_avg: 4.7, article_count: 14 },
      competitors: { count: 5 },
    });
    const r = homeModel(x)!;
    expect(r.score).toEqual(s.score);
    expect([r.rank, r.rival, r.competitorCount]).toEqual([s.rank, s.rival, s.competitorCount]);
    expect(r.copy.heroSentence).toBe(s.copy.heroSentence);
  });
  test("the away sentence is the same composer for both", () => {
    expect(sampleHomeModel(7).brief!.awayText).toBe(awayText({ new_reviews: 2, bio_live: true, first_article: true }));
  });
});

describe("helpers", () => {
  test("monthDay reads the UTC date and tolerates nothing", () => {
    expect(monthDay("2026-10-16T00:00:00Z")).toBe("Oct 16");
    expect(monthDay("2026-01-05T23:59:59")).toBe("Jan 5");
    expect(monthDay(null)).toBe("");
    expect(monthDay("not a date")).toBe("");
  });
  test("joinList", () => {
    expect([joinList([]), joinList(["a"]), joinList(["a", "b"]), joinList(["a", "b", "c"])]).toEqual(["", "a", "a and b", "a, b and c"]);
  });
  test("awayText: plural, singular, none", () => {
    expect(awayText({ new_reviews: 2, bio_live: false, first_article: true })).toBe("While you were away: 2 new reviews and your first article is published.");
    expect(awayText({ new_reviews: 1, bio_live: true, first_article: true })).toBe("While you were away: 1 new review, your bio went live and your first article is published.");
    expect(awayText({ new_reviews: 0, bio_live: false, first_article: false })).toBe("Nothing new while you were away.");
  });
  test("heroSentence: with and without a rival, rank or city", () => {
    const rival = { name: "Rival Co", initial: "R", score: 500, points_to_first: 10, review_count: null, review_avg: null, article_count: null };
    expect(heroSentence(rival, { position: 3, of: 20, city: null, first_position: null })).toBe("Rival Co is #1 in your market — here's your gap. You're #3 of 20.");
    expect(heroSentence(null, { position: 1, of: 20, city: "Moline", first_position: null })).toBe("You lead Moline. You're #1 of 20.");
    expect(heroSentence(rival, null)).toBe("Rival Co is #1 in your market — here's your gap.");
    expect(heroSentence(null, null)).toBe("");
  });
  test("the mock notice says the values are mock and not the person's", () => {
    expect(MOCK_NOTICE).toBe("Mock data · these values come from the local database and are not your real score or activity.");
  });
});

describe("short rival name, map colours and the chips (day 1 layout)", () => {
  test("shortName keeps the first word, or the first two after The", () => {
    expect(shortName("Riverbend Bank & Trust")).toBe("Riverbend");
    expect(shortName("The Harbor Group")).toBe("The Harbor");
    expect(shortName("The")).toBe("The");
    expect(shortName("  Summit   Lending ")).toBe("Summit");
    expect(shortName("")).toBe("");
  });

  test("the model carries it on the rival, and the sample's is Riverbend", () => {
    expect(homeModel(api())!.rival!.short).toBe("Riverbend");
    expect(sampleHomeModel(1).rival!.short).toBe("Riverbend");
    expect(homeModel(api({ rival: null }))!.rival).toBeNull();
  });

  test("rankColor: top 3 green, 4 to 10 yellow, 11 to 20 orange, 20+ or unknown red", () => {
    expect([1, 2, 3].map(rankColor)).toEqual(["#34a853", "#34a853", "#34a853"]);
    expect([4, 10].map(rankColor)).toEqual(["#fbbc04", "#fbbc04"]);
    expect([11, 20].map(rankColor)).toEqual(["#fa7b17", "#fa7b17"]);
    expect([21, null].map(rankColor)).toEqual(["#ea4335", "#ea4335"]);
  });

  test("chipsFor names the rival and the score; without a rival it drops the rival question", () => {
    expect(chipsFor(390, "Riverbend")).toEqual(["Where am I losing to Riverbend?", "What should I fix first?", "Write my first article", "Why is my score 390?", "Show my map"]);
    expect(chipsFor(412, null)).toEqual(["What should I fix first?", "Write my first article", "Why is my score 412?", "Show my map"]);
  });
});

describe("launcherLabel", () => {
  test("a long task name is cut to its first four words and an ellipsis, a short one is kept", () => {
    expect(launcherLabel("Adding your Google category and services")).toBe("Adding your Google category…");
    expect(launcherLabel("Registering your Bing listing")).toBe("Registering your Bing listing");
    expect(launcherLabel("  Wrote   your bio ")).toBe("Wrote your bio");
    expect(launcherLabel("")).toBe("");
  });
});

describe("the upgrade note", () => {
  test("a real seat: the first locked feature's plan unlocks it", () => {
    expect(homeModel(api())!.locked.upgradeNote).toBe("Engage unlocks it.");
    expect(homeModel(api({ locked: { features: [], points_waiting: 0 } }))!.locked.upgradeNote).toBe("");
  });
  test("the sample's note is the prototype's", () => {
    expect(sampleHomeModel(1).locked.upgradeNote).toBe("Engage keeps your details right everywhere; Amplify includes it.");
  });
});

describe("hero sentence without a rank", () => {
  test("a rival but no rank still gives a sentence", () => {
    expect(heroSentence({ name: "Rival Co", initial: "R", score: 500, points_to_first: 10, review_count: null, review_avg: null, article_count: null }, null)).toBe("Rival Co is #1 in your market — here's your gap.");
    expect(heroSentence(null, null)).toBe("");
  });
});
