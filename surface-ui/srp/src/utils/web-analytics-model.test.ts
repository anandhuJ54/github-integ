// The Web analytics view model built from the API's response (srp/web-analytics-page-schema, task 8). Pure functions, no DOM, no network.
import { describe, expect, test } from "bun:test";
import { api as client } from "@v3/state/api/server-fn";
import {
  loadWebAnalyticsData,
  webAnalyticsKey,
  webAnalyticsModel,
} from "@v3/srp/utils/web-analytics-model";
import { api } from "@v3/srp/utils/web-analytics-fixture";
import { sampleWebAnalyticsModel } from "@v3/srp/components/happyflow/sample-web-analytics";
import { PERSONA } from "@v3/srp/components/happyflow/demo-data";
import { mergePersona } from "@v3/srp/components/happyflow/persona";

const m = webAnalyticsModel(api(), "34")!;

describe("not ready", () => {
  test("no data or ready false or a missing list gives no model (the sample view)", () => {
    expect(webAnalyticsModel(null, "1")).toBeNull();
    expect(webAnalyticsModel(undefined, "1")).toBeNull();
    expect(webAnalyticsModel(api({ ready: false }), "1")).toBeNull();
    expect(webAnalyticsModel(api({ checks: null }), "1")).toBeNull();
  });
  test("a ready response with no gauge, no top fix, no tiles and no notes still gives a model whose sections are empty, never zero", () => {
    const e = webAnalyticsModel(
      api({ health: null, top_fix: null, tiles: [], notes: [], site: null }),
      "1",
    )!;
    expect(e.gauge).toBeNull();
    expect(e.topFix).toBeNull();
    expect(e.tiles).toEqual([]);
    expect(e.thinks).toEqual([]);
    expect(e.site).toBe("");
    expect(e.lastChecked).toBe("");
  });
});

describe("identity", () => {
  test("real, mock or live, and the seat key", () => {
    expect([m.mode, m.isMock, m.seatKey]).toEqual(["real", true, "34"]);
    expect(webAnalyticsModel(api({ data: "live" }), "34")!.isMock).toBe(false);
    expect(webAnalyticsModel(api(), "9")!.seatKey).toBe("9");
    expect(sampleWebAnalyticsModel(mergePersona({})).seatKey).toBe("sample");
  });
});

describe("the header and the gauge", () => {
  test("the address under the title and the last check as month and day", () => {
    expect(m.site).toBe("harper-jones.example.test/loans");
    expect(m.lastChecked).toBe("Sep 9");
  });
  test("no scan date is an empty label, not a date", () => {
    expect(
      webAnalyticsModel(api({ site: { url: "x.example.test", last_checked: null } }), "1")!
        .lastChecked,
    ).toBe("");
  });
  test("the gauge is the lane's earned and max", () => {
    expect(m.gauge).toEqual({ earned: 77, max: 102 });
    expect(
      webAnalyticsModel(api({ health: { earned: 0, max: 102, open: 102 } }), "1")!.gauge,
    ).toEqual({ earned: 0, max: 102 });
  });
});

describe("the checks", () => {
  test("each row carries the page's label, its result, its points text and its state, in the response's order", () => {
    expect(m.checks.map((c) => [c.group, c.points, c.state])).toEqual([
      ["Entity and markup", "+20 open", "warn"],
      ["Name, address, phone", "30 of 30", "pass"],
      ["Indexing", "20 of 20", "pass"],
      ["Service pages", "5 of 10", "warn"],
      ["Speed", "Pass", "pass"],
      ["AI readiness", "—", "fail"],
      ["Content", "Pass", "pass"],
      ["Conversion", "—", "fail"],
      ["Reviews on site", "Pass", "pass"],
      ["Security", "—", "fail"],
    ]);
    expect(m.checks[0].result).toBe("Structured data is incomplete");
  });
  test("the counts follow the states", () => {
    expect(m.counts).toEqual({ all: 10, fail: 3, warn: 2, pass: 5 });
    const base = api();
    expect(webAnalyticsModel({ ...base, checks: base.checks!.slice(0, 2) }, "1")!.counts).toEqual({
      all: 2,
      fail: 0,
      warn: 1,
      pass: 1,
    });
  });
  test("an empty list of checks still counts zero checks", () => {
    expect(webAnalyticsModel(api({ checks: [] }), "1")!.counts).toEqual({
      all: 0,
      fail: 0,
      warn: 0,
      pass: 0,
    });
  });
});

describe("the tiles", () => {
  test("icon, label, value, note, state and the check each one opens", () => {
    expect(m.tiles).toEqual([
      {
        icon: "zap",
        label: "Speed",
        value: "LCP 1.9 s",
        note: "Passing",
        state: "pass",
        check: "Speed",
      },
      {
        icon: "code",
        label: "Markup",
        value: "Partial",
        note: "+20 open",
        state: "warn",
        check: "Entity and markup",
      },
      {
        icon: "spark",
        label: "AI readiness",
        value: "0 of 5",
        note: "Failing",
        state: "fail",
        check: "AI readiness",
      },
    ]);
  });
});

describe("the top fix and NORA's notes", () => {
  test("the top fix carries what is open and the snippet", () => {
    expect(m.topFix).toEqual({ open: 20, snippet: api().top_fix!.snippet });
  });
  test("a top fix with no snippet (no name in the Profile) keeps its number and has no code", () => {
    expect(webAnalyticsModel(api({ top_fix: { open: 42, snippet: null } }), "1")!.topFix).toEqual({
      open: 42,
      snippet: null,
    });
  });
  test("the notes become the shell's thinks with an action word the screen turns into a button action", () => {
    expect(m.thinks).toEqual([
      {
        t: "Markup is worth 20 points.",
        d: "I've written the code — your webmaster only needs to paste it in.",
        cta: "Send to my webmaster",
        action: "send",
      },
      {
        t: "AI can't read your page yet.",
        d: "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content built by scripts; missing title or description tags.",
        cta: "See the checks",
        action: "close",
      },
    ]);
  });
});

describe("the sample model equals every constant it replaces", () => {
  const s = sampleWebAnalyticsModel(mergePersona({}));
  test("identity, address under the title, last check and gauge", () => {
    expect([s.mode, s.isMock]).toEqual(["sample", true]);
    expect(s.site).toBe(PERSONA.site);
    expect(s.lastChecked).toBe("Oct 16");
    expect(s.gauge).toEqual({ earned: 40, max: 102 });
  });
  test("the ten checks as the prototype lists them", () => {
    expect(s.checks.map((c) => [c.group, c.result, c.points, c.state])).toEqual([
      ["Entity and markup", "No structured data on the page", "+42 open", "fail"],
      ["Name, address, phone", "Matches the profile", "30 of 30", "pass"],
      ["Indexing", "Indexed; no sitemap", "10 of 20", "warn"],
      ["Service pages", "No pages for FHA or VA loans", "0 of 10", "fail"],
      ["Speed", "LCP 3.1 s (needs work), INP 180 ms, CLS 0.02", "—", "warn"],
      [
        "AI readiness",
        "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content in the page HTML",
        "—",
        "warn",
      ],
      ["Content", "No blog", "—", "fail"],
      ["Conversion", "Click-to-call yes; no booking link", "—", "warn"],
      ["Reviews on site", "Widget not installed", "—", "fail"],
      ["Security", "HTTPS", "Pass", "pass"],
    ]);
    expect(s.counts).toEqual({ all: 10, fail: 4, warn: 4, pass: 2 });
  });
  test("the three tiles", () => {
    expect(s.tiles).toEqual([
      {
        icon: "zap",
        label: "Speed",
        value: "LCP 3.1 s",
        note: "Needs work",
        state: "warn",
        check: "Speed",
      },
      {
        icon: "code",
        label: "Markup",
        value: "Missing",
        note: "+42 open",
        state: "fail",
        check: "Entity and markup",
      },
      {
        icon: "spark",
        label: "AI readiness",
        value: "2 of 5",
        note: "Needs work",
        state: "warn",
        check: "AI readiness",
      },
    ]);
  });
  test("the top fix and its code snippet with the persona's own name", () => {
    expect(s.topFix!.open).toBe(42);
    expect(s.topFix!.snippet).toBe(`<script type="application/ld+json">
{ "@type": "FinancialService",
  "name": "Alex Sample – Demo Mortgage",
  "telephone": "(563) 555-0100",
  "address": "100 Main St, Davenport, IA 52801" }
</script>`);
    const real = sampleWebAnalyticsModel(mergePersona({ first: "Harper", name: "Harper Jones" }));
    expect(real.topFix!.snippet).toContain('"name": "Harper Jones – Demo Mortgage"');
  });
  test("NORA's notes", () => {
    expect(s.thinks).toEqual([
      {
        t: "Markup is worth 42 points.",
        d: "I've written the code — your webmaster only needs to paste it in.",
        cta: "Send to my webmaster",
        action: "send",
      },
      {
        t: "AI can't read your page yet.",
        d: "GPTBot is blocked in robots.txt, and there's no llms.txt or FAQ.",
        cta: "See the checks",
        action: "close",
      },
    ]);
  });
});

describe("loading", () => {
  test("the cache key is one per seat", () => {
    expect(webAnalyticsKey("1")).not.toEqual(webAnalyticsKey("2"));
    expect(webAnalyticsKey("7")).toEqual(["seat-web-analytics-v1", "7"]);
  });
  test("the data is read from the seat's website route", async () => {
    const calls: string[] = [];
    const c = client as unknown as { get: (url: string) => Promise<unknown> };
    const real = c.get;
    c.get = async (url: string) => {
      calls.push(url);
      return api();
    };
    try {
      expect((await loadWebAnalyticsData("42/x")).ready).toBe(true);
    } finally {
      c.get = real;
    }
    expect(calls).toEqual(["/srp/seat/professional/42%2Fx/website"]);
  });
});
