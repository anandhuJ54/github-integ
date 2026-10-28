// The Insights view model built from the API's response (srp/insights-page-schema, task 8). Pure functions, no DOM, no network.
import { describe, expect, test } from "bun:test";
import { api as client } from "@v3/state/api/server-fn";
import {
  DEFAULT_SPOT,
  insightsKey,
  insightsModel,
  loadInsightsData,
  rankColor,
} from "@v3/srp/utils/insights-model";
import { api } from "@v3/srp/utils/insights-fixture";
import { sampleInsightsModel } from "@v3/srp/components/happyflow/sample-insights";
import { GRID, PERSONA, RIVALS } from "@v3/srp/components/happyflow/demo-data";
import { mergePersona } from "@v3/srp/components/happyflow/persona";

const m = insightsModel(api(), "34")!;

describe("not ready", () => {
  test("no data or ready false gives no model (the sample view)", () => {
    expect(insightsModel(null)).toBeNull();
    expect(insightsModel(undefined)).toBeNull();
    expect(insightsModel(api({ ready: false }))).toBeNull();
    expect(insightsModel(api({ visibility: null, competitors: null }))).toBeNull();
  });
  test("a ready response with no map, no AI block and no leader still gives a model whose sections are empty, never zero", () => {
    const e = insightsModel(
      api({ map: null, ai: null, target: null, locked: [], notes: [], visibility: [] }),
    )!;
    expect(e.map).toBeNull();
    expect(e.ai).toBeNull();
    expect(e.target).toBeNull();
    expect(e.locked).toEqual([]);
    expect(e.thinks).toEqual([]);
    expect(e.visibility).toEqual([]);
  });
});

describe("identity", () => {
  test("real, mock or live", () => {
    expect([m.mode, m.isMock]).toEqual(["real", true]);
    expect(insightsModel(api({ data: "live" }))!.isMock).toBe(false);
  });
  test('the seat key remounts the screen per seat: the seat\'s id for a real seat, "sample" for the sample page', () => {
    expect(m.seatKey).toBe("34");
    expect(insightsModel(api(), "9")!.seatKey).toBe("9");
    expect(sampleInsightsModel(mergePersona({})).seatKey).toBe("sample");
  });
  test("the default selected spot is the office pin", () => {
    expect(DEFAULT_SPOT).toBe(24);
    expect(m.map!.cells[DEFAULT_SPOT].label).toBe("●");
  });
});

describe("visibility", () => {
  test("labels in the pages order, thousands separators, a real zero stays 0", () => {
    expect(m.visibility.map((v) => [v.label, v.value])).toEqual([
      ["Search views", "2,310"],
      ["Maps views", "1,420"],
      ["Calls", "0"],
      ["Directions", "73"],
      ["Website clicks", "129"],
      ["Experience.com profile views", "1,000,000"],
    ]);
  });
  test("the line under each figure is the response's source line", () => {
    expect(m.visibility[0].line).toBe("Last 30 days · From Google");
    expect(m.visibility[5].line).toBe("Last 30 days · From Experience.com");
  });
  test("a metric with no row is absent and an unknown metric is ignored", () => {
    const base = api();
    const fewer = insightsModel({
      ...base,
      visibility: base.visibility!.filter((v) => v.metric !== "calls"),
    })!;
    expect(fewer.visibility.map((v) => v.label)).not.toContain("Calls");
    expect(fewer.visibility).toHaveLength(5);
  });
});

describe("the map", () => {
  test("the heading names the street, the scan date is month and day", () => {
    expect(m.map!.heading).toBe("Map rank around 412 Main St");
    expect(m.map!.scanLabel).toBe("One-time scan · Oct 9");
  });
  test("with no address the heading is about the office, and with no scan date there is no scan label", () => {
    const base = api();
    const e = insightsModel({ ...base, map: { ...base.map!, address: null, scanned_at: null } })!;
    expect(e.map!.heading).toBe("Map rank around your office");
    expect(e.map!.scanLabel).toBe("");
  });
  test("49 cells in row-major order with their rank text and colours", () => {
    const cells = m.map!.cells;
    expect(cells).toHaveLength(49);
    expect(cells.map((c) => c.i)).toEqual(Array.from({ length: 49 }, (_, i) => i));
    expect(cells[0]).toMatchObject({ i: 0, rank: null, label: "20+", bg: "#ea4335", fg: "#fff" });
    expect(cells[24]).toMatchObject({ rank: 2, label: "●", bg: "#34a853" });
    expect(cells[23]).toMatchObject({ rank: 5, label: "5", bg: "#fbbc04", fg: "#202124" });
    expect(cells[8]).toMatchObject({ rank: 14, label: "14", bg: "#fa7b17" });
  });
  test("the colour follows the rank at every boundary", () => {
    expect([1, 3].map((r) => rankColor(r).bg)).toEqual(["#34a853", "#34a853"]);
    expect([4, 10].map((r) => rankColor(r).bg)).toEqual(["#fbbc04", "#fbbc04"]);
    expect([11, 20].map((r) => rankColor(r).bg)).toEqual(["#fa7b17", "#fa7b17"]);
    expect([21, 40, null].map((r) => rankColor(r).bg)).toEqual(["#ea4335", "#ea4335", "#ea4335"]);
  });
  test("each spot's top three, with the seat shown as You", () => {
    expect(m.map!.cells[24].leaders).toEqual([
      { place: 1, name: "Summit Credit Union", you: false },
      { place: 2, name: "You", you: true },
      { place: 3, name: "Lakeside Lending", you: false },
    ]);
    expect(m.map!.cells[0].leaders.map((l) => l.name)).toEqual([
      "Summit Credit Union",
      "Lakeside Lending",
      "Oakmont Mortgage",
    ]);
    expect(m.map!.cells.filter((c) => c.leaders.some((l) => l.you))).toHaveLength(1);
  });
  test("leaders come back in place order even when the response lists them shuffled", () => {
    const base = api();
    const cells = base.map!.cells.map((c, i) =>
      i === 3 ? { ...c, leaders: [c.leaders[2], c.leaders[0], c.leaders[1]] } : c,
    );
    expect(
      insightsModel({ ...base, map: { ...base.map!, cells } })!.map!.cells[3].leaders.map(
        (l) => l.place,
      ),
    ).toEqual([1, 2, 3]);
  });
  test("cells come back in grid order even when the response lists them shuffled, and the pin is still spot 24 (second review, finding 6)", () => {
    const base = api();
    const cells = [...base.map!.cells].reverse();
    const e = insightsModel({ ...base, map: { ...base.map!, cells } })!;
    expect(e.map!.cells.map((c) => c.i)).toEqual(Array.from({ length: 49 }, (_, i) => i));
    expect(e.map!.cells[DEFAULT_SPOT].label).toBe("●");
    expect(e.map!.cells[24].rank).toBe(2);
  });
  test("fewer than 49 cells keep their own grid index", () => {
    const base = api();
    const cells = base.map!.cells.filter((c) => c.row === 3 && c.col === 3);
    const e = insightsModel({ ...base, map: { ...base.map!, cells } })!;
    expect(e.map!.cells.map((c) => c.i)).toEqual([24]);
  });
  test("a spot with no leader rows has none", () => {
    const base = api();
    const cells = base.map!.cells.map((c, i) => (i === 3 ? { ...c, leaders: [] } : c));
    expect(insightsModel({ ...base, map: { ...base.map!, cells } })!.map!.cells[3].leaders).toEqual(
      [],
    );
  });
  test("a numeric rank above 20 counts as 20+ in the summary", () => {
    const base = api();
    const cells = base.map!.cells.map((c, i) => (i < 2 ? { ...c, rank: 25 } : c));
    expect(insightsModel({ ...base, map: { ...base.map!, cells } })!.map!.summary).toBe(
      "Top 3 in 1 · 4–10 in 8 · 11–20 in 16 · 20+ in 24",
    );
  });
  test("the summary counts the cells in the four bands", () => {
    expect(m.map!.summary).toBe("Top 3 in 1 · 4–10 in 8 · 11–20 in 16 · 20+ in 24");
  });
  test("the query line has the scan's keyword and the city from the address, or just the keyword", () => {
    expect(m.query).toBe('"mortgage lender near me" · Bettendorf, IA');
    const base = api();
    expect(insightsModel({ ...base, map: { ...base.map!, address: null } })!.query).toBe(
      '"mortgage lender near me"',
    );
    expect(insightsModel({ ...base, map: { ...base.map!, address: "Somewhere odd" } })!.query).toBe(
      '"mortgage lender near me"',
    );
  });
});

describe("AI citations", () => {
  test("the heading and the engine rows", () => {
    expect(m.ai!.heading).toBe("Named in 3 of 6 answers");
    expect(m.ai!.rows).toEqual([
      {
        name: "ChatGPT",
        share: "2 of 2",
        note: "Names you for local lender questions.",
        cited: 2,
        checked: 2,
      },
      { name: "Gemini", share: "1 of 2", note: "", cited: 1, checked: 2 },
      {
        name: "Perplexity",
        share: "0 of 2",
        note: "Does not mention you yet.",
        cited: 0,
        checked: 2,
      },
    ]);
  });
});

describe("competitors", () => {
  test("places, names with (you) for the seat, ratings and averages; unknown shows a dash, never 0", () => {
    expect(m.competitors).toEqual([
      { place: 1, name: "Summit Credit Union", you: false, rating: "4.2 (88)", avg: "1.9" },
      { place: 2, name: "Harper Jones (you)", you: true, rating: "4.1 (71)", avg: "11.6" },
      { place: 3, name: "Lakeside Lending", you: false, rating: "—", avg: "—" },
    ]);
  });
  test("a real zero rating or average is shown as 0.0, not as unknown", () => {
    const base = api();
    const e = insightsModel({
      ...base,
      competitors: [{ ...base.competitors![0], rating: 0, reviews: 3, avg_position: 0 }],
    })!;
    expect(e.competitors[0]).toMatchObject({ rating: "0.0 (3)", avg: "0.0" });
  });
  test("a rating without a review count shows the rating alone, and an average shows one decimal", () => {
    const base = api();
    const e = insightsModel({
      ...base,
      competitors: [{ ...base.competitors![0], reviews: null, avg_position: 2 }],
    })!;
    expect(e.competitors[0]).toMatchObject({ rating: "4.2", avg: "2.0" });
  });
  test("the target is the market leader", () => {
    expect(m.target).toBe("Summit Credit Union");
  });
});

describe("locked cards and notes", () => {
  test("title and text as the response gives them", () => {
    expect(m.locked).toEqual([
      ["Map Rank tracking", "Re-scan every week and see the day you pass Summit"],
      ["AI-citation monitoring", "Track every answer that names you"],
    ]);
  });
  test("NORA's notes become the shell's thinks", () => {
    expect(m.thinks).toEqual([
      {
        t: "Summit wins on volume.",
        d: "88 reviews and 3 articles. Your 4.1 rating is below their 4.2.",
        cta: "Start publishing",
        act: "voce",
      },
      {
        t: "Perplexity never names you.",
        d: "Does not mention you yet.",
        cta: "Write an article",
        act: "voce",
      },
    ]);
  });
});

describe("the sample model equals every constant it replaces", () => {
  const s = sampleInsightsModel(mergePersona({}));
  test("identity", () => {
    expect([s.mode, s.isMock]).toEqual(["sample", true]);
  });
  test("visibility", () => {
    expect(s.visibility.map((v) => [v.label, v.value, v.line])).toEqual([
      ["Search views", "1,240", "Last 30 days · from Google"],
      ["Maps views", "860", "Last 30 days · from Google"],
      ["Calls", "41", "Last 30 days · from Google"],
      ["Directions", "18", "Last 30 days · from Google"],
      ["Website clicks", "57", "Last 30 days · from Google"],
      ["Experience.com profile views", "312", "Last 30 days · from Google"],
    ]);
  });
  test("the map: heading, scan label, summary and query line", () => {
    expect(s.map!.heading).toBe("Map rank around 100 Main St");
    expect(s.map!.scanLabel).toBe("One-time scan · Oct 16");
    expect(s.map!.summary).toBe("Top 3 in 9 · 4–10 in 17 · 11–20 in 14 · 20+ in 9");
    expect(s.query).toBe('"mortgage lender near me" · Davenport, IA');
  });
  test("every cell is the prototype's grid cell, with the colour, text and rotating top three it used to compute", () => {
    expect(s.map!.cells).toHaveLength(49);
    for (const g of GRID) {
      const c = s.map!.cells[g.i];
      expect([c.i, c.row, c.col, c.bg, c.fg, c.label, c.rank]).toEqual([
        g.i,
        g.r,
        g.c,
        g.bg,
        g.fg,
        g.i === 24 ? "●" : String(g.rank),
        g.rank === "20+" ? null : g.rank,
      ]);
      const rkN = typeof g.rank === "number" ? g.rank : 21;
      const rot = g.i % 3;
      const base = [RIVALS[rot % 3], RIVALS[(rot + 1) % 3], RIVALS[(rot + 2) % 3]];
      if (rkN <= 3) base.splice(rkN - 1, 0, "You");
      expect(c.leaders).toEqual(
        base.slice(0, 3).map((n, k) => ({ place: k + 1, name: n, you: n === "You" })),
      );
    }
  });
  test("AI citations", () => {
    expect(s.ai!.heading).toBe("Named in 1 of 7 answers");
    expect(s.ai!.rows.map((r) => [r.name, r.share, r.note, r.cited, r.checked])).toEqual([
      ["ChatGPT", "1 of 3", "Cites your Zillow reviews", 1, 3],
      ["Gemini", "0 of 2", "Leans on the map pack", 0, 2],
      ["Perplexity", "0 of 2", "Cites articles; you have none", 0, 2],
    ]);
  });
  test("competitors, with the persona's name for the seat", () => {
    expect(s.competitors.map((c) => [c.place, c.name, c.you, c.rating, c.avg])).toEqual([
      [1, "Riverbend Bank & Trust", false, "4.7 (412)", "2.1"],
      [2, "Prairie Home Lending", false, "4.8 (230)", "3.4"],
      [3, "Bluff City Mortgage", false, "4.6 (188)", "4.0"],
      [4, "Mississippi Valley Loans", false, "4.5 (96)", "5.2"],
      [5, "Heartland Credit Union", false, "4.4 (151)", "5.9"],
      [6, "Alex Sample (you)", true, "4.9 (128)", "7.8"],
    ]);
    const real = sampleInsightsModel(mergePersona({ first: "Harper", name: "Harper Jones" }));
    expect(real.competitors[5].name).toBe("Harper Jones (you)");
  });
  test("target, locked cards and notes", () => {
    expect(s.target).toBe("Riverbend Bank & Trust");
    expect(s.locked).toEqual([
      ["Map Rank tracking", "Re-scan every week and see the day you pass Riverbend"],
      ["AI-citation monitoring", "Track every answer that names you"],
    ]);
    expect(s.thinks).toEqual([
      {
        t: "Riverbend wins on volume.",
        d: "412 reviews and 14 articles. Your 4.9 rating is better than their 4.7.",
        cta: "Start publishing",
        act: "voce",
      },
      {
        t: "Perplexity cites articles.",
        d: "You have none, so it never names you. One article changes that.",
        cta: "Write my first article",
        act: "voce",
      },
    ]);
    expect(PERSONA.name).toBe("Alex Sample");
  });
});

describe("loading", () => {
  test("the cache key is one per seat", () => {
    expect(insightsKey("1")).not.toEqual(insightsKey("2"));
    expect(insightsKey("7")).toEqual(["seat-insights-v1", "7"]);
  });
  test("the data is read from the seat's Insights route", async () => {
    const calls: string[] = [];
    const c = client as unknown as { get: (url: string) => Promise<unknown> };
    const real = c.get;
    c.get = async (url: string) => {
      calls.push(url);
      return api();
    };
    try {
      expect((await loadInsightsData("42/x")).ready).toBe(true);
    } finally {
      c.get = real;
    }
    expect(calls).toEqual(["/srp/seat/professional/42%2Fx/insights"]);
  });
});
