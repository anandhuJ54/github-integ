// The SRS view model built from the API's response (srp/srs-page-schema, task 8). Pure functions, no DOM, no network.
import { describe, expect, test } from "bun:test";
import { loadSrsData, srsModel, type SrsApi } from "@v3/srp/utils/srs-model";
import { api } from "@v3/srp/utils/srs-fixture";
import { api as api_client } from "@v3/state/api/server-fn";
import { sampleSrsModel, LANES, THINKS, CHIPS } from "@v3/srp/components/happyflow/sample-srs";
import { SCORE_BY_DAY, RIVERBEND_SCORE } from "@v3/srp/components/happyflow/demo-data";

const lanesOf = (a: SrsApi) => a.lanes!;
const withLane = (key: string, patch: Partial<NonNullable<SrsApi["lanes"]>[number]>) =>
  api({ lanes: lanesOf(api()).map((l) => (l.key === key ? { ...l, ...patch } : l)) });

describe("not ready", () => {
  test("no data, ready false or a missing core section gives no model (the sample view)", () => {
    expect(srsModel(null)).toBeNull();
    expect(srsModel(undefined)).toBeNull();
    expect(srsModel(api({ ready: false }))).toBeNull();
    expect(srsModel(api({ score: null }))).toBeNull();
    expect(srsModel(api({ lanes: null }))).toBeNull();
    expect(srsModel(api({ counts: null }))).toBeNull();
  });
});

describe("a ready response", () => {
  const m = srsModel(api())!;
  test("identity: real, mock or live", () => {
    expect([m.mode, m.isMock]).toEqual(["real", true]);
    expect(srsModel(api({ data: "live" }))!.isMock).toBe(false);
  });
  test("score, band and the next band", () => {
    expect(m.score).toEqual({ total: 390, max: 850, openTotal: 460, band: "Building", nextBand: { name: "Established", min: 400, pointsNeeded: 10 } });
    const top = srsModel(api({ score: { ...api().score!, total: 760, open_total: 90, band: { name: "Elite", min_points: 750, next: null } } }))!;
    expect(top.score.nextBand).toBeNull();
    expect(top.score.band).toBe("Elite");
    expect(srsModel(api({ score: { ...api().score!, band: null } }))!.score.band).toBeNull();
  });
  test("rank and city", () => {
    expect(m.rank).toEqual({ position: 6, of: 41, city: "Davenport" });
    expect(m.city).toBe("Davenport");
    expect(srsModel(api({ rank: null }))!.rank).toBeNull();
    expect(srsModel(api({ rank: { position: 3, of: 9, city: null } }))!.city).toBeNull();
  });
  test("the rival, with its short name; none when nobody outscores the seat", () => {
    expect(m.rival).toEqual({ name: "Riverbend Bank & Trust", short: "Riverbend", initial: "R", score: 571, pointsToFirst: 181, reviewCount: 412, reviewAvg: 4.7 });
    expect(srsModel(api({ rival: null }))!.rival).toBeNull();
    expect(srsModel(api({ rival: { ...api().rival!, name: "The Harbor Group" } }))!.rival!.short).toBe("The Harbor");
  });
  test("the lanes keep the API's order and become the screen's rows", () => {
    expect(m.lanes.map((l) => l.lane)).toEqual(["Completeness", "Articles", "Website", "Directories", "Connections", "Reviews", "Q&A", "Videos", "Audio", "GBP"]);
    expect(m.lanes[0]).toEqual({ lane: "Completeness", icon: "user", status: "Fix", max: 182, pts: 105,
      cmp: "Bio thin, service areas missing vs a full profile", act: "Fill my profile", to: "profile" });
    expect(m.lanes.map((l) => l.status)).toEqual(["Fix", "Missing", "Fix", "Fix · locked", "Fix", "Strong", "Missing", "Missing", "Missing", "Strong"]);
    expect(m.lanes.reduce((a, l) => a + l.max, 0)).toBe(850);
    expect(m.lanes.reduce((a, l) => a + l.pts, 0)).toBe(460);
    expect(m.lanes.every((l) => l.pts >= 0 && l.pts <= l.max)).toBe(true);
  });
  test("each lane has its icon", () => {
    expect(Object.fromEntries(m.lanes.map((l) => [l.lane, l.icon]))).toEqual({
      Completeness: "user", Articles: "pen", Website: "code", Directories: "pin", Connections: "share", Reviews: "star", "Q&A": "help", Videos: "video", Audio: "mic", GBP: "plug" });
  });
  test("the label is the short name, else the name", () => {
    expect(m.lanes.some((l) => l.lane === "GBP")).toBe(true);
    expect(srsModel(withLane("gbp", { short_name: null }))!.lanes.some((l) => l.lane === "Google Business Profile")).toBe(true);
  });
  test("the comparison is you vs rival, with the note after a semicolon", () => {
    expect(m.lanes.find((l) => l.lane === "Reviews")!.cmp).toBe("128 vs 412 reviews; 31 in the last 12 months");
    expect(m.lanes.find((l) => l.lane === "Articles")!.cmp).toBe("0 vs 14 articles");
    expect(m.lanes.find((l) => l.lane === "Directories")!.cmp).toBe("9 consistent vs 28");
  });
  test("a lane with no gap row has no comparison and no action label", () => {
    const gone = srsModel(withLane("website", { you_text: null, rival_text: null, note: null, action_label: null, action_target: null }))!.lanes.find((l) => l.lane === "Website")!;
    expect([gone.cmp, gone.act, gone.to]).toEqual(["", "", "chat"]);
  });
  test("targets: billing becomes Billing, the rest are the screens", () => {
    expect(Object.fromEntries(m.lanes.map((l) => [l.lane, l.to]))).toEqual({
      Completeness: "profile", Articles: "voce", Website: "website", Directories: "Billing", Connections: "connections", Reviews: "reviews", "Q&A": "chat",
      Videos: "chat", Audio: "chat", GBP: "connections" });
  });
  test("a lane with unknown points is left out and counted", () => {
    const x = srsModel(withLane("website", { earned: null, open: null, status: null }))!;
    expect(x.lanes.some((l) => l.lane === "Website")).toBe(false);
    expect([x.lanes.length, x.unknownLanes]).toEqual([9, 1]);
    expect(m.unknownLanes).toBe(0);
  });
  test("the chip counts come from the API, locked counting as Fix", () => {
    expect(m.counts).toEqual({ All: 10, Missing: 4, Fix: 4, Strong: 2 });
  });
  test("the All count stays the API's even when an unknown lane is left out of the list", () => {
    const x = srsModel(withLane("website", { earned: null, open: null, status: null }))!;
    expect(x.counts.All).toBe(10);
    expect(x.lanes.length).toBe(9);
  });
  test("NORA's notes become the three thinks", () => {
    expect(m.notes).toEqual([
      { t: "Completeness gets you to Established.", d: "It's 105 points open, and you only need 10 to cross 400.", cta: "Fill my profile", to: "profile" },
      { t: "Your Articles is costing you 85 points.", d: "Riverbend Bank & Trust: 14 articles. You: 0.", cta: "Start publishing", to: "voce" },
      { t: "GBP is already strong.", d: "services added today", cta: "View connection", to: "connections" },
    ]);
  });
  test("a note without an action gets a plain Ask NORA, and billing becomes Billing", () => {
    const x = srsModel(api({ notes: [{ title: "t", body: "b", cta: null, action: null }, { title: "u", body: "c", cta: "Unlock Listings", action: "billing" }] }))!;
    expect(x.notes).toEqual([{ t: "t", d: "b", cta: "Ask NORA", to: "chat" }, { t: "u", d: "c", cta: "Unlock Listings", to: "Billing" }]);
    expect(srsModel(api({ notes: [] }))!.notes).toEqual([]);
  });
});

describe("the words and the bar", () => {
  const m = srsModel(api())!;
  test("subtitle names the city, or the market", () => {
    expect(m.copy.subtitle).toBe("Every gap between you and the #1 lender in Davenport.");
    expect(srsModel(api({ rank: null }))!.copy.subtitle).toBe("Every gap between you and the #1 lender in your market.");
  });
  test("NORA's greeting says how far the next band and #1 are", () => {
    expect(m.copy.greeting).toEqual({ before: "You're ", bold: "10 points from Established", after: " and 181 from #1. Here's where I'd start." });
    const lead = srsModel(api({ rival: null }))!;
    expect(lead.copy.greeting).toEqual({ before: "You're ", bold: "10 points from Established", after: ". Here's where I'd start." });
    const top = srsModel(api({ score: { ...api().score!, band: { name: "Elite", min_points: 750, next: null } } }))!;
    expect(top.copy.greeting.bold).toBe("in Elite");
  });
  test("one point is singular in the greeting and the callout", () => {
    const one = srsModel(api({ score: { ...api().score!, total: 399, band: { name: "Building", min_points: 0, next: { name: "Established", min_points: 400, points_needed: 1 } } },
      lanes: lanesOf(api()).map((l) => (l.key === "completeness" ? { ...l, earned: 181, open: 1 } : { ...l, earned: l.max - 1, open: 1 })) }))!;
    expect(one.copy.greeting.bold).toBe("1 point from Established");
    expect(one.callout!.title).toBe("Completeness is your biggest gap — 1 point.");
  });
  test("the chips use the score and the rival's short name", () => {
    expect(m.copy.chips).toEqual(["What should I fix first?", "Why is my score 390?", "How do I pass Riverbend?", "What can you do on your own?"]);
    expect(srsModel(api({ rival: null }))!.copy.chips).toEqual(["What should I fix first?", "Why is my score 390?", "What can you do on your own?"]);
  });
  test("the band bar: fill and marker as percentages of the maximum, and its labels", () => {
    expect(m.bar).toEqual({ fillPct: 45.9, markerPct: 47.06, from: "Building", next: "400 Established", end: 850 });
    const top = srsModel(api({ score: { ...api().score!, band: { name: "Elite", min_points: 750, next: null } } }))!;
    expect(top.bar.markerPct).toBeNull();
    expect(top.bar.next).toBeNull();
  });
  test("the race: your bar as a share of the rival's score, capped at 100", () => {
    expect(m.race).toEqual({ youPct: 68.3 });
    expect(srsModel(api({ rival: { ...api().rival!, score: 300 } }))!.race.youPct).toBe(100);
    expect(srsModel(api({ rival: null }))!.race.youPct).toBeNull();
  });
  test("the callout is the lane with the most open points", () => {
    expect(m.callout).toEqual({
      title: "Completeness is your biggest gap — 105 points.",
      text: "Riverbend: a full profile; you have Bio thin, service areas missing. Closing just this lane would take you past Established.",
      cta: "Fill my profile", to: "profile" });
  });
  test("the callout leaves out the band sentence when the lane is not enough, and has no rival line without a rival", () => {
    const small = srsModel(api({ score: { ...api().score!, band: { name: "Building", min_points: 0, next: { name: "Established", min_points: 400, points_needed: 300 } } } }))!;
    expect(small.callout!.text).toBe("Riverbend: a full profile; you have Bio thin, service areas missing.");
    const alone = srsModel(api({ rival: null }))!;
    expect(alone.callout!.text).toBe("Closing just this lane would take you past Established.");
  });
  test("a lane that exactly covers the gap to the next band gets the band sentence", () => {
    const exact = srsModel(api({ score: { ...api().score!, band: { name: "Building", min_points: 0, next: { name: "Established", min_points: 400, points_needed: 105 } } } }))!;
    expect(exact.callout!.text.endsWith("Closing just this lane would take you past Established.")).toBe(true);
  });
  test("a callout for a lane without an action asks NORA", () => {
    const x = srsModel(withLane("completeness", { action_label: null, action_target: null }))!;
    expect([x.callout!.cta, x.callout!.to]).toEqual(["Ask NORA", "chat"]);
  });
  test("no callout when no lane has points open", () => {
    const full = api({ lanes: lanesOf(api()).map((l) => ({ ...l, earned: l.max, open: 0, status: "Strong" as const })) });
    expect(srsModel(full)!.callout).toBeNull();
  });
});

describe("the sample model", () => {
  const s = sampleSrsModel();
  test("it is the prototype's page: today's lanes, thinks and chips", () => {
    expect(s.mode).toBe("sample");
    expect(s.lanes).toEqual(LANES);
    expect(s.notes).toEqual(THINKS.map((t) => ({ t: t.t, d: t.d, cta: t.cta, to: t.act })));
    expect(s.copy.chips).toEqual(CHIPS);
  });
  test("the numbers are the demo constants and add up", () => {
    expect(s.score.total).toBe(SCORE_BY_DAY[1]);
    expect(s.score.max).toBe(850);
    expect(s.score.openTotal).toBe(460);
    expect(s.score.total + s.score.openTotal!).toBe(850);
    expect(s.rival!.score).toBe(RIVERBEND_SCORE);
    expect(s.rival!.pointsToFirst).toBe(RIVERBEND_SCORE - SCORE_BY_DAY[1]);
    expect(s.lanes.reduce((a, l) => a + (l.max - l.pts), 0)).toBe(SCORE_BY_DAY[1]);
  });
  test("the words are the screen's own, to the character", () => {
    expect(s.copy.subtitle).toBe("Every gap between you and the #1 lender in Davenport.");
    expect(s.copy.greeting).toEqual({ before: "You're ", bold: "10 points from Established", after: " and 181 from #1. Here's where I'd start." });
    expect(s.score.band).toBe("Building");
    expect(s.score.nextBand).toEqual({ name: "Established", min: 400, pointsNeeded: 10 });
    expect(s.rank).toEqual({ position: 6, of: 41, city: "Davenport" });
    expect(s.rival).toMatchObject({ name: "Riverbend Bank & Trust", short: "Riverbend", initial: "R", reviewCount: 412, reviewAvg: 4.7 });
    expect(s.bar).toEqual({ fillPct: 45.9, markerPct: 47.06, from: "Building", next: "400 Established", end: 850 });
    expect(s.race).toEqual({ youPct: 68.3 });
    expect(s.callout).toEqual({
      title: "Articles is your biggest gap — 85 points.", text: "Riverbend has 14; you have none. Closing just this lane would take you past Established.",
      cta: "Start publishing", to: "voce" });
  });
  test("the chip counts group the lanes, locked counting as Fix", () => {
    expect(s.counts).toEqual({ All: 10, Missing: 4, Fix: 4, Strong: 2 });
    expect(s.unknownLanes).toBe(0);
  });
});

describe("loading", () => {
  test("the data is read from the seat's SRS route", async () => {
    const calls: string[] = [];
    const client = api_client as unknown as { get: (url: string) => Promise<unknown> };
    const real = client.get;
    client.get = async (url: string) => {
      calls.push(url);
      return api();
    };
    try {
      const got = await loadSrsData("42/x");
      expect(got.ready).toBe(true);
    } finally {
      client.get = real;
    }
    expect(calls).toEqual(["/srp/seat/professional/42%2Fx/srs"]);
  });
});
