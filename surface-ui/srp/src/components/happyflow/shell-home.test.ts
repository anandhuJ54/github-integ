// The shell's Home parts read the Home model (srp/home-page-schema, task 11): trial chip and banner, plan window, upgrade and recap panels, chips.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { PlanBanner, PlansPanel, RecapPanel, UpgradePanel, dayChip, defaultChips } from "./shell";
import { homeModel, type HomeApi } from "@v3/srp/utils/home-model";
import { api } from "@v3/srp/utils/home-fixture";
import { sampleHomeModel } from "./sample-home";

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const noop = () => {};
const model = (over: Partial<HomeApi> = {}) => homeModel(api({ day: { n: 12, trial_days: 45, layout: "day7", over: false }, ...over }))!;
const banner = (m: ReturnType<typeof model>) => text(renderToString(createElement(PlanBanner, { model: m, onCompare: noop, onClose: noop })));

describe("the trial chip and banner", () => {
  test("chip: day of trial days, from the data", () => {
    expect(dayChip(model())).toBe("Day 12 of 45");
    expect(dayChip(sampleHomeModel(7))).toBe("Day 7 of 30");
  });
  test("banner names what is locked and the points waiting", () => {
    const t = banner(model());
    expect(t).toContain("Trial · day 12 of 45.");
    expect(t).toContain("Listings and Map Rank tracking are locked — 87 points are waiting behind them.");
    expect(t).not.toContain("127");
  });
  test("one locked feature is singular; no points waiting leaves the clause out", () => {
    const one = { features: [{ key: "map_rank", title: "Map Rank tracking", description: null, points_waiting: null, plan: "amplify" }], points_waiting: 0 };
    const t = banner(model({ locked: one }));
    expect(t).toContain("Map Rank tracking is locked.");
    expect(t).not.toContain("points are waiting");
    expect(banner(model())).toContain("are locked — 87 points are waiting");
  });
  test("the sample banner is the prototype's", () => {
    expect(banner(sampleHomeModel(1))).toContain("Trial · day 1 of 30. Listings, VOCE articles, Map Rank tracking and AI-citation monitoring are locked — 127 points are waiting behind them.");
  });
  test("nothing locked: no banner", () => {
    const m = model({ locked: { features: [], points_waiting: 0 } });
    expect(m.trial.showBanner).toBe(false);
    expect(renderToString(createElement(PlanBanner, { model: m, onCompare: noop, onClose: noop }))).toBe("");
  });
  test("after the trial the chip stays on the last day", () => {
    expect(dayChip(model({ day: { n: 45, trial_days: 45, layout: "day24", over: true } }))).toBe("Day 45 of 45");
  });
});

describe("the plan window", () => {
  const render = (m: ReturnType<typeof model>) => text(renderToString(createElement(PlansPanel, { isD: true, model: m, onChoose: noop })));
  test("shows the stored plans, the current one marked, and the peer line", () => {
    const t = render(model());
    expect(t).toContain("Core");
    expect(t).toContain("Your profile");
    expect(t).toContain("Current plan");
    expect(t).toContain("Amplify Includes Engage");
    expect(t).toContain("Everything in Engage");
    expect(t).toContain("Choose Amplify");
    expect(t).toContain("median +61 points in 90 days; 3 of 5 reached the next band.");
    expect(t).not.toContain("Riverbend");
  });
  test("the columns follow the number of plans, and the peer line follows the data", () => {
    const m = model({ peers: { band_from: "Building", median_gain: 47, horizon_days: 60, cohort_size: 22, cohort_period: "Feb–Aug 2026", reached_next_band: 4, of: 6 } });
    const html = renderToString(createElement(PlansPanel, { isD: true, model: m, onChoose: noop }));
    expect(html).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(text(html)).toContain("median +47 points in 60 days; 4 of 6 reached the next band.");
    expect(render(model({ peers: null }))).not.toContain("median +");
  });
  test("the sample's three plans are unchanged", () => {
    const t = render(sampleHomeModel(1));
    for (const s of ["Your trial today · stays free after day 30", "Choose Engage", "Choose Amplify", "median +61 points in 90 days; 3 of 5 reached the next band."]) expect(t).toContain(s);
  });
});

describe("the upgrade panel", () => {
  const render = (m: ReturnType<typeof model>) => text(renderToString(createElement(UpgradePanel, { model: m, onCompare: noop, onNotNow: noop })));
  test("names the first locked feature from the data", () => {
    const t = render(model());
    expect(t).toContain("Directories miss you. 87 points are waiting.");
    expect(t).toContain("Amplify unlocks it.".replace("Amplify", "Engage"));
    expect(t).not.toContain("22 directories");
  });
  test("sample: the prototype's text", () => {
    expect(render(sampleHomeModel(1))).toContain("22 directories are missing you or show your old phone. 42 points are waiting. Engage keeps your details right everywhere; Amplify includes it.");
  });
  test("nothing locked: says so", () => {
    expect(render(model({ locked: { features: [], points_waiting: 0 } }))).toContain("Nothing is locked on your plan.");
  });
});

describe("the day 24 recap panel", () => {
  const recap = { days: 30, things_done: 52, tiles: [{ label: "Score", from: 300, to: 480, delta: 180 }, { label: "Rank", from: 12, to: 5, delta: 7 }, { label: "Profile strength", from: 50, to: 81, delta: 31 }], articles: 4, replies: 9 };
  const m = () => model({ day: { n: 45, trial_days: 45, layout: "day24", over: true }, recap });
  const render = (x: ReturnType<typeof model>) => text(renderToString(createElement(RecapPanel, { isD: true, model: x, onCompare: noop, onRemind: noop })));
  test("every figure is the stored one", () => {
    const t = render(m());
    expect(t).toContain("In 30 days I did 52 things for you.");
    expect(t).toContain("Score 300 → 480 +180");
    expect(t).toContain("Rank in Davenport #12 → #5");
    expect(t).toContain("Profile strength 50% → 81%");
    expect(t).toContain("Articles published 4");
    expect(t).toContain("Reviews answered 9");
    expect(t).toContain("You: +180 in 30 days.");
    expect(t).toContain("median +61 in 90 days");
    expect(t).toContain("ON DAY 46 · STAYS FREE Your profile");
    expect(t).toContain("ON DAY 46 · PAUSES");
    for (const s of ["384", "471", "41 things", "+87", "24 days"]) expect(t).not.toContain(s);
  });
  test("without a recap it says it is not ready", () => {
    expect(render(model({ recap: null }))).toContain("Your recap is not ready yet.");
  });
  test("the sample recap is the prototype's", () => {
    const t = render(sampleHomeModel(24));
    for (const s of ["In 24 days I did 41 things for you.", "Score 384 → 471 +87", "Rank in Davenport #6 → #4", "Profile strength 64% → 88%", "Articles published 3", "Reviews answered 12", "You: +87 in 24 days."]) expect(t).toContain(s);
  });
});

describe("NORA's default chips", () => {
  test("day 1: the rival and the score from the data; later days as before", () => {
    expect(defaultChips(1, model())).toEqual(["Where am I losing to Riverbend?", "What should I fix first?", "Write my first article", "Why is my score 420?", "Show my map"]);
    expect(defaultChips(7, model())).toEqual(["What did you do this week?", "Fix my website", "Show my map"]);
    expect(defaultChips(1, sampleHomeModel(1))[3]).toBe("Why is my score 390?");
  });
});
