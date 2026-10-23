// All HTTP is mocked: no test here touches the network. Fixtures follow the DataForSEO v3
// response shapes as documented (UNVERIFIED against the live API).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Budget, BudgetExceededError } from "./budget";
import { DataForSeoClient, DataForSeoError, type FetchFn } from "./client";
import { resolveConfig, type ResolvedConfig } from "./config";
import { loadCredentials, parseEnv } from "./env";
import {
  EP,
  isBlocked,
  parseAutocomplete,
  parseIntent,
  parseOrganicDomains,
  parseOverview,
  parsePack,
  parseRanked,
  parseSuggestions,
  topDomains,
} from "./endpoints";
import { MAX_FILTER_CONDITIONS, countConditions, rankedFilter, splitPatterns } from "./filters";
import { OUTPUT_FILES, collectCandidates, formatCostSummary, readJson, runHarvest } from "./pipeline";
import { formatPlan, planCalls } from "./plan";
import { parseArgs } from "./cli";

// ---- fixtures ----

const envelope = (result: unknown, cost: number) => ({
  version: "0.1.20240801",
  status_code: 20000,
  status_message: "Ok.",
  time: "0.5 sec.",
  cost,
  tasks_count: 1,
  tasks_error: 0,
  tasks: [{ status_code: 20000, status_message: "Ok.", cost, result_count: 1, result: [result] }],
});

const overviewFx = {
  items_count: 3,
  items: [
    { keyword: "cannabis store", keyword_info: { search_volume: null, cpc: null, competition: null } },
    { keyword: "dispensary near me", keyword_info: { search_volume: 1220000, cpc: 1.2, competition: 0.31 } },
    { keyword: "weed shop", keyword_info: { search_volume: 0, cpc: 0.4, competition: 0.1 } },
  ],
};
const suggestionsFx = {
  items: [
    { keyword: "dispensary near me", keyword_info: { search_volume: 1220000, cpc: 1.2, competition: 0.31 }, keyword_properties: { keyword_difficulty: 55 } },
    { keyword: "recreational dispensary", keyword_info: { search_volume: 8100, cpc: null, competition: null }, keyword_properties: { keyword_difficulty: null } },
    { keyword: "no volume term", keyword_info: { search_volume: null }, keyword_properties: {} },
  ],
};
const organicFx = {
  items: [
    { type: "paid", domain: "ads.example.com", rank_group: 1 },
    { type: "organic", domain: "weedmaps.com", rank_group: 1, url: "https://weedmaps.com/dispensaries" },
    { type: "organic", domain: "en.wikipedia.org", rank_group: 2, url: "https://en.wikipedia.org/wiki/Cannabis_shop" },
    { type: "organic", domain: "leafly.com", rank_group: 3, url: "https://leafly.com/dispensaries" },
    { type: "people_also_ask", items: [] },
  ],
};
const rankedFx = {
  items: [
    {
      keyword_data: { keyword: "dispensary near me", keyword_info: { search_volume: 1220000 } },
      ranked_serp_element: { serp_item: { rank_group: 2, url: "https://weedmaps.com/dispensaries" } },
    },
    { keyword_data: { keyword: "thc gummies", keyword_info: { search_volume: null } }, ranked_serp_element: { serp_item: { rank_group: 7 } } },
  ],
};
const autocompleteFx = {
  items: [
    { type: "autocomplete", relevance: 1500, suggestion: "dispensary near me" },
    { type: "autocomplete", relevance: 1400, suggestion: "dispensary open now" },
    { type: "autocomplete", relevance: 1300, suggestion: "dispensary deals" },
  ],
};
const intentFx = {
  items: [
    { keyword: "dispensary near me", keyword_intent: { label: "transactional", probability: 0.92 }, secondary_keyword_intents: [{ label: "commercial", probability: 0.05 }] },
    { keyword: "what is thc", keyword_intent: { label: "informational", probability: 0.98 } },
    { keyword: "mystery", keyword_intent: null },
  ],
};
const packFx = {
  items: [
    { type: "organic", title: "Weedmaps" },
    { type: "local_pack", title: "Green Leaf Dispensary", rating: { value: 4.8 } },
    { type: "local_pack", title: "Austin Cannabis Co" },
    { type: "map", items: [{ title: "Green Leaf Dispensary" }, { title: "High Tide" }] },
  ],
};
const noPackFx = { items: [{ type: "organic", title: "Wikipedia" }] };

// ---- helpers ----

const creds = { login: "user@example.com", password: "s3cret-pw-VALUE" };
const tmp = () => mkdtempSync(join(tmpdir(), "harvest-test-"));

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

// Mock fetch: routes on the endpoint path, records calls. `cost` is billed per response.
function mockFetch(cost = 0.01, overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fx: Record<string, unknown> = {
    [EP.overview]: overviewFx,
    [EP.suggestions]: suggestionsFx,
    [EP.organic]: organicFx,
    [EP.ranked]: rankedFx,
    [EP.autocomplete]: autocompleteFx,
    [EP.intent]: intentFx,
    [EP.pack]: packFx,
    ...overrides,
  };
  const fn: FetchFn = async (url, init) => {
    const endpoint = url.replace("https://api.dataforseo.com/v3/", "");
    calls.push({ url, body: (JSON.parse(init.body) as Record<string, unknown>[])[0], headers: init.headers });
    return new Response(JSON.stringify(envelope(fx[endpoint], cost)), { status: 200 });
  };
  return { fn, calls };
}

function cfg(over: Record<string, unknown> = {}, out = tmp()): ResolvedConfig {
  return resolveConfig(
    {
      gcid: "gcid:cannabis_store",
      name: "cannabis store",
      aliases: ["dispensary"],
      existing_keywords: ["dispensary near me", "weed shop"],
      seeds: ["cannabis store", "dispensary", "weed shop", "marijuana store"],
      head_queries: ["dispensary near me", "cannabis store"],
      patterns: ["dispensar", "cannabis", "weed", "marijuana", "thc", "cbd", "edible", "vape"],
      stems: ["dispensary", "cannabis store"],
      out_dir: out,
      mode: "full",
      ...over,
    },
    "/",
  );
}

const client = (fn: FetchFn, budget: Budget) => new DataForSeoClient(creds, budget, fn);

// ---- tests ----

describe("budget guard", () => {
  test("aborts before the call once the limit is reached; fetch is not invoked", async () => {
    const dir = tmp();
    const { fn, calls } = mockFetch(0.5);
    const budget = new Budget(1.0, join(dir, "spend.json"));
    const c = client(fn, budget);
    await c.post("suggestions", EP.suggestions, {}, 0.04);
    await c.post("suggestions", EP.suggestions, {}, 0.04);
    expect(budget.spent).toBe(1);
    await expect(c.post("suggestions", EP.suggestions, {}, 0.04)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls.length).toBe(2);
    rmSync(dir, { recursive: true });
  });

  test("aborts when spent + estimate would exceed the limit", () => {
    const b = new Budget(0.1);
    b.record("s", "e", 0.08);
    expect(() => b.assertCanSpend(0.01)).not.toThrow();
    expect(() => b.assertCanSpend(0.05)).toThrow(BudgetExceededError);
  });

  test("spend is summed from response cost and persisted; reloaded across runs", async () => {
    const dir = tmp();
    const path = join(dir, "spend.json");
    const { fn } = mockFetch(0.0123);
    const b1 = new Budget(3, path);
    await client(fn, b1).post("intent", EP.intent, {}, 0.01);
    await client(fn, b1).post("intent", EP.intent, {}, 0.01);
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.spent_usd).toBeCloseTo(0.0246, 6);
    expect(onDisk.by_step.intent).toBeCloseTo(0.0246, 6);
    expect(onDisk.by_endpoint[EP.intent]).toBeCloseTo(0.0246, 6);
    const b2 = new Budget(3, path);
    expect(b2.spent).toBeCloseTo(0.0246, 6);
    rmSync(dir, { recursive: true });
  });

  test("cost of a failed task is still recorded", async () => {
    const budget = new Budget(3);
    const fn: FetchFn = async () =>
      new Response(
        JSON.stringify({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 40501, status_message: "Invalid Field", cost: 0.01, result: null }] }),
        { status: 200 },
      );
    await expect(client(fn, budget).post("s", EP.ranked, {}, 0.01)).rejects.toBeInstanceOf(DataForSeoError);
    expect(budget.spent).toBe(0.01);
  });

  test("pipeline aborts mid-run on a tiny cap and spend.json shows what was billed", async () => {
    const dir = tmp();
    const c = cfg({ budget_usd: 0.05, mode: "lean" }, dir);
    const { fn, calls } = mockFetch(0.03);
    const budget = new Budget(c.budget_usd, join(dir, "spend.json"));
    await expect(runHarvest(c, { client: client(fn, budget), budget })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls.length).toBeLessThan(3);
    expect(JSON.parse(readFileSync(join(dir, "spend.json"), "utf8")).spent_usd).toBeLessThanOrEqual(0.05);
    rmSync(dir, { recursive: true });
  });
});

describe("filter-group splitting", () => {
  test("never exceeds 8 conditions and keeps every pattern", () => {
    const patterns = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const groups = splitPatterns(patterns);
    expect(groups.map((g) => g.length)).toEqual([6, 6, 6, 2]);
    expect(groups.flat().sort()).toEqual([...patterns].sort());
    for (const g of groups) {
      const f = rankedFilter(1000, g);
      expect(countConditions(f)).toBe(g.length + 1);
      expect(countConditions(f)).toBeLessThanOrEqual(MAX_FILTER_CONDITIONS);
    }
  });

  test("group size is clamped to 6 even if a larger size is requested", () => {
    for (const g of splitPatterns(Array.from({ length: 30 }, (_, i) => `p${i}`), 50)) expect(g.length).toBeLessThanOrEqual(6);
  });

  test("filter shape matches the spec", () => {
    expect(rankedFilter(1000, ["a", "b"])).toEqual([
      ["keyword_data.keyword_info.search_volume", ">=", 1000],
      "and",
      [["keyword_data.keyword", "like", "%a%"], "or", ["keyword_data.keyword", "like", "%b%"]],
    ]);
    expect(countConditions(rankedFilter(1000, []))).toBe(1);
  });

  test("dedupes and lowercases patterns", () => {
    expect(splitPatterns(["Weed", "weed", " ", "THC"])).toEqual([["weed", "thc"]]);
  });

  test("ranked requests sent by the pipeline stay within 8 conditions and merge across groups", async () => {
    const dir = tmp();
    const c = cfg({}, dir);
    const { fn, calls } = mockFetch(0.01);
    const budget = new Budget(10, join(dir, "spend.json"));
    await runHarvest(c, { client: client(fn, budget), budget });
    const ranked = calls.filter((x) => x.url.endsWith(EP.ranked));
    // 2 competitors (weedmaps, leafly; wikipedia blocked) x 2 groups (8 patterns -> 6 + 2)
    expect(ranked.length).toBe(4);
    for (const r of ranked) expect(countConditions(r.body.filters as never)).toBeLessThanOrEqual(MAX_FILTER_CONDITIONS);
    const out = readJson<{ items: { keyword: string; domains: unknown[] }[] }>(dir, "ranked.json")!;
    expect(out.items.filter((i) => i.keyword === "dispensary near me").length).toBe(1); // merged, not duplicated
    expect(out.items.find((i) => i.keyword === "dispensary near me")!.domains.length).toBe(2);
    rmSync(dir, { recursive: true });
  });
});

describe("response parsing", () => {
  test("overview", () => {
    const r = parseOverview(overviewFx);
    expect(r.map((x) => x.keyword)).toEqual(["cannabis store", "dispensary near me", "weed shop"]);
    expect(r[1]).toEqual({ keyword: "dispensary near me", search_volume: 1220000, cpc: 1.2, competition: 0.31 });
  });
  test("suggestions", () => {
    const r = parseSuggestions(suggestionsFx);
    expect(r[0].keyword_difficulty).toBe(55);
    expect(r[1].keyword_difficulty).toBeNull();
  });
  test("organic domains: only organic items, with rank", () => {
    const r = parseOrganicDomains(organicFx);
    expect(r.map((x) => x.domain)).toEqual(["weedmaps.com", "en.wikipedia.org", "leafly.com"]);
    expect(r[0]).toEqual({ domain: "weedmaps.com", rank: 1, url: "https://weedmaps.com/dispensaries" });
  });
  test("top domains: count, blocklist (incl. subdomains), top N", () => {
    const q1 = parseOrganicDomains(organicFx);
    const q2 = parseOrganicDomains({ items: [{ type: "organic", domain: "www.weedmaps.com" }, { type: "organic", domain: "reddit.com" }, { type: "organic", domain: "eaze.com" }] });
    const t = topDomains([q1, q2], ["wikipedia.org", "reddit.com"], 2);
    expect(t.counts[0]).toEqual({ domain: "weedmaps.com", count: 2 });
    expect(t.top.length).toBe(2);
    expect(t.top).not.toContain("en.wikipedia.org");
    expect(t.blocked).toEqual(["en.wikipedia.org", "reddit.com"]);
    expect(isBlocked("notwikipedia.org", ["wikipedia.org"])).toBe(false);
  });
  test("ranked", () => {
    const r = parseRanked(rankedFx);
    expect(r[0]).toEqual({ keyword: "dispensary near me", search_volume: 1220000, rank: 2, url: "https://weedmaps.com/dispensaries" });
    expect(r[1]).toEqual({ keyword: "thc gummies", search_volume: null, rank: 7, url: null });
  });
  test("autocomplete keeps order", () => {
    expect(parseAutocomplete(autocompleteFx)).toEqual(["dispensary near me", "dispensary open now", "dispensary deals"]);
  });
  test("intent labels", () => {
    const r = parseIntent(intentFx);
    expect(r.map((x) => x.label)).toEqual(["transactional", "informational", null]);
    expect(r[0].probability).toBe(0.92);
  });
  test("pack: local_pack and map items, titles deduped", () => {
    const r = parsePack(packFx);
    expect(r.pack).toBe(true);
    expect(r.titles).toEqual(["Green Leaf Dispensary", "Austin Cannabis Co", "High Tide"]);
    expect(parsePack(noPackFx)).toEqual({ pack: false, titles: [] });
    expect(parsePack(null)).toEqual({ pack: false, titles: [] });
  });
  test("null / malformed results parse to empty lists", () => {
    for (const p of [parseOverview, parseSuggestions, parseOrganicDomains, parseRanked, parseAutocomplete, parseIntent]) {
      expect(p(null)).toEqual([]);
      expect(p({ items: null })).toEqual([]);
    }
  });
  test("request bodies match the endpoint contracts", async () => {
    const dir = tmp();
    const c = cfg({}, dir);
    const { fn, calls } = mockFetch(0.01);
    const budget = new Budget(10);
    await runHarvest(c, { client: client(fn, budget), budget });
    const by = (ep: string) => calls.filter((x) => x.url.endsWith(ep));
    expect(by(EP.overview)[0].body).toEqual({ keywords: ["dispensary near me", "weed shop", "cannabis store", "dispensary"], location_code: 2840, language_code: "en" });
    expect(by(EP.suggestions)[0].body).toEqual({
      keyword: "cannabis store",
      location_code: 2840,
      language_code: "en",
      limit: 300,
      include_seed_keyword: true,
      order_by: ["keyword_info.search_volume,desc"],
      filters: [["keyword_info.search_volume", ">=", 500]],
    });
    expect(by(EP.organic)[0].body).toEqual({ keyword: "dispensary near me", location_code: 2840, language_code: "en", depth: 20 });
    expect(by(EP.intent)[0].body.language_code).toBe("en");
    expect(by(EP.intent)[0].body.location_code).toBeUndefined();
    expect(by(EP.pack)[0].body).toEqual({ keyword: "dispensary near me", location_name: "Austin,Texas,United States", language_code: "en", device: "mobile", depth: 10 });
    expect(by(EP.autocomplete)[0].body).toEqual({ keyword: "dispensary", location_code: 2840, language_code: "en" });
    rmSync(dir, { recursive: true });
  });
});

describe("resume", () => {
  test("skips steps whose file exists and makes no calls for them", async () => {
    const dir = tmp();
    const c = cfg({ mode: "lean" }, dir);
    const first = mockFetch(0.01);
    const b1 = new Budget(10, join(dir, "spend.json"));
    await runHarvest(c, { client: client(first.fn, b1), budget: b1 });
    expect(first.calls.length).toBeGreaterThan(0);

    const second = mockFetch(0.01);
    const b2 = new Budget(10, join(dir, "spend.json"));
    await runHarvest(c, { client: client(second.fn, b2), budget: b2, resume: true });
    expect(second.calls.length).toBe(0);
    expect(b2.spent).toBeCloseTo(b1.spent, 6);

    // delete one file: only that step re-runs
    rmSync(join(dir, OUTPUT_FILES.autocomplete));
    const third = mockFetch(0.01);
    const b3 = new Budget(10, join(dir, "spend.json"));
    await runHarvest(c, { client: client(third.fn, b3), budget: b3, resume: true });
    expect(third.calls.every((x) => x.url.endsWith(EP.autocomplete))).toBe(true);
    expect(third.calls.length).toBe(2);
    rmSync(dir, { recursive: true });
  });

  test("without --resume existing files are re-run", async () => {
    const dir = tmp();
    const c = cfg({ mode: "lean" }, dir);
    const a = mockFetch();
    const budget = new Budget(10, join(dir, "spend.json"));
    await runHarvest(c, { client: client(a.fn, budget), budget });
    const b = mockFetch();
    await runHarvest(c, { client: client(b.fn, budget), budget });
    expect(b.calls.length).toBe(a.calls.length);
    rmSync(dir, { recursive: true });
  });
});

describe("null volume preservation", () => {
  test("parsers keep null and real zero distinct", () => {
    const r = parseOverview(overviewFx);
    expect(r[0].search_volume).toBeNull();
    expect(r[2].search_volume).toBe(0);
    expect(parseRanked(rankedFx)[1].search_volume).toBeNull();
    expect(parseSuggestions(suggestionsFx)[2].search_volume).toBeNull();
  });

  test("written files keep null volumes, including keywords the API did not return", async () => {
    const dir = tmp();
    const c = cfg({ existing_keywords: ["cannabis store", "never returned"] }, dir);
    const { fn } = mockFetch(0.01);
    const budget = new Budget(10);
    await runHarvest(c, { client: client(fn, budget), budget });
    const ov = readJson<{ keywords: { keyword: string; search_volume: number | null; found: boolean }[] }>(dir, "existing_overview.json")!;
    expect(ov.keywords.find((k) => k.keyword === "cannabis store")!.search_volume).toBeNull();
    const missing = ov.keywords.find((k) => k.keyword === "never returned")!;
    expect(missing).toMatchObject({ search_volume: null, found: false });
    const sug = readJson<{ items: { keyword: string; search_volume: number | null }[] }>(dir, "suggestions.json")!;
    expect(sug.items.find((k) => k.keyword === "no volume term")!.search_volume).toBeNull();
    const rk = readJson<{ items: { keyword: string; search_volume: number | null }[] }>(dir, "ranked.json")!;
    expect(rk.items.find((k) => k.keyword === "thc gummies")!.search_volume).toBeNull();
    const it = readJson<{ items: { keyword: string; search_volume: number | null }[] }>(dir, "intent.json")!;
    expect(it.items.find((k) => k.keyword === "thc gummies")!.search_volume).toBeNull();
    rmSync(dir, { recursive: true });
  });

  test("candidates: null-volume keywords are kept (after known volumes), and a known volume wins on merge", async () => {
    const dir = tmp();
    const c = cfg({}, dir);
    const { fn } = mockFetch(0.01);
    const budget = new Budget(10);
    await runHarvest(c, { client: client(fn, budget), budget });
    const cands = collectCandidates(dir);
    expect(cands[0].search_volume).toBe(1220000);
    expect(cands.find((x) => x.keyword === "cannabis store")!.search_volume).toBeNull();
    const firstNull = cands.findIndex((x) => x.search_volume === null);
    expect(cands.slice(firstNull).every((x) => x.search_volume === null)).toBe(true);
    rmSync(dir, { recursive: true });
  });
});

describe("full run outputs", () => {
  test("writes all eight files; pack flag and titles recorded; autocomplete order kept", async () => {
    const dir = tmp();
    const c = cfg({}, dir);
    const { fn } = mockFetch(0.01);
    const budget = new Budget(10, join(dir, "spend.json"));
    await runHarvest(c, { client: client(fn, budget), budget });
    for (const f of Object.values(OUTPUT_FILES)) expect(existsSync(join(dir, f))).toBe(true);
    const pack = readJson<{ items: { pack: boolean; titles: string[] }[] }>(dir, "serp_pack.json")!;
    expect(pack.items[0].pack).toBe(true);
    expect(pack.items[0].titles).toContain("High Tide");
    const ac = readJson<{ stems: { stem: string; suggestions: string[] }[] }>(dir, "autocomplete.json")!;
    expect(ac.stems[0].suggestions).toEqual(["dispensary near me", "dispensary open now", "dispensary deals"]);
    const dom = readJson<{ top: string[]; blocked: string[] }>(dir, "domains.json")!;
    expect(dom.blocked).toContain("en.wikipedia.org");
    expect(dom.top).toEqual(["leafly.com", "weedmaps.com"]);
    expect(formatCostSummary(budget)).toContain("TOTAL");
    rmSync(dir, { recursive: true });
  });

  test("lean mode skips ranked_keywords and caps seeds at 3", async () => {
    const dir = tmp();
    const c = cfg({ mode: "lean" }, dir);
    expect(c.seeds.length).toBe(3);
    expect(c.budget_usd).toBe(0.6);
    expect(cfg().budget_usd).toBe(3);
    const { fn, calls } = mockFetch(0.01);
    const budget = new Budget(10);
    await runHarvest(c, { client: client(fn, budget), budget });
    expect(calls.some((x) => x.url.endsWith(EP.ranked))).toBe(false);
    expect(calls.filter((x) => x.url.endsWith(EP.suggestions)).length).toBe(3);
    expect(readJson<{ skipped: string }>(dir, "ranked.json")!.skipped).toBe("lean mode");
    rmSync(dir, { recursive: true });
  });

  test("an API error in one call is recorded and the run continues", async () => {
    const dir = tmp();
    const c = cfg({ mode: "lean" }, dir);
    let n = 0;
    const base = mockFetch(0.01);
    const fn: FetchFn = async (url, init) => {
      if (url.endsWith(EP.autocomplete) && n++ === 0) return new Response("boom", { status: 500 });
      return base.fn(url, init);
    };
    const budget = new Budget(10);
    await runHarvest(c, { client: client(fn, budget), budget });
    const ac = readJson<{ stems: unknown[]; errors: { error: string }[] }>(dir, "autocomplete.json")!;
    expect(ac.stems.length).toBe(1);
    expect(ac.errors[0].error).toContain("HTTP 500");
    rmSync(dir, { recursive: true });
  });
});

describe("dry run", () => {
  test("plans calls with an estimate, needs no credentials, and respects mode", () => {
    const full = planCalls(cfg());
    const lean = planCalls(cfg({ mode: "lean" }));
    expect(full.some((c) => c.step === "ranked")).toBe(true);
    expect(lean.some((c) => c.step === "ranked")).toBe(false);
    const sum = (cs: { estimate_usd: number }[]) => cs.reduce((s, c) => s + c.estimate_usd, 0);
    expect(sum(lean)).toBeLessThan(0.6);
    expect(sum(full)).toBeLessThan(3);
    const text = formatPlan(cfg(), full);
    expect(text).toContain("No calls will be made");
    expect(text).toContain("Estimated total");
  });
  test("cli arg parsing", () => {
    expect(parseArgs(["c.json", "--dry-run", "--resume", "--budget", "1.5"])).toMatchObject({ config: "c.json", dryRun: true, resume: true, budget: 1.5 });
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["c.json", "--nope"])).toThrow();
  });
});

describe("credentials", () => {
  test("parseEnv handles quotes, export, comments, blank lines, CRLF", () => {
    const env = parseEnv('# c\r\nDATAFORSEO_LOGIN="a@b.com"\r\n\r\nexport DATAFORSEO_PASSWORD=\'p w\'\nOTHER=x # trailing\n');
    expect(env).toEqual({ DATAFORSEO_LOGIN: "a@b.com", DATAFORSEO_PASSWORD: "p w", OTHER: "x" });
  });

  test("loadCredentials reads the file", () => {
    const dir = tmp();
    const p = join(dir, ".env.local");
    writeFileSync(p, `DATAFORSEO_LOGIN=${creds.login}\nDATAFORSEO_PASSWORD=${creds.password}\n`);
    expect(loadCredentials(p, {})).toEqual(creds);
    rmSync(dir, { recursive: true });
  });

  test("missing credentials: error names the variable but contains no values", () => {
    const dir = tmp();
    const p = join(dir, ".env.local");
    writeFileSync(p, `DATAFORSEO_LOGIN=${creds.login}\n`);
    let msg = "";
    try {
      loadCredentials(p, {});
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("DATAFORSEO_PASSWORD");
    expect(msg).not.toContain(creds.login);
    expect(msg).not.toContain(creds.password);
    rmSync(dir, { recursive: true });
  });

  test("a missing file with no env fallback fails cleanly", () => {
    expect(() => loadCredentials("/nonexistent/.env.local", {})).toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
  });

  test("sends Basic auth to the v3 base URL, and no error/log output leaks credentials or the header", async () => {
    const budget = new Budget(3);
    const seen: Call[] = [];
    const ok = mockFetch(0.01);
    const fn: FetchFn = async (url, init) => {
      seen.push({ url, body: {}, headers: init.headers });
      return ok.fn(url, init);
    };
    await client(fn, budget).post("intent", EP.intent, {}, 0.01);
    expect(seen[0].url).toBe("https://api.dataforseo.com/v3/dataforseo_labs/google/search_intent/live");
    const expected = `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString("base64")}`;
    expect(seen[0].headers.Authorization).toBe(expected);

    // Failure paths must not echo the header or credentials.
    const bad: FetchFn = async () => new Response("nope", { status: 401 });
    const boom: FetchFn = async () => {
      throw new Error(`connect failed with ${expected}`);
    };
    for (const f of [bad, boom]) {
      let msg = "";
      try {
        await client(f, new Budget(3)).post("s", EP.intent, {}, 0.01);
      } catch (e) {
        msg = String((e as Error).message) + String((e as Error).stack ?? "").split("\n")[0];
      }
      expect(msg).not.toContain(creds.password);
      expect(msg).not.toContain(expected);
      expect(msg).not.toContain(Buffer.from(`${creds.login}:${creds.password}`).toString("base64"));
    }
  });
});

describe("config", () => {
  test("validates required fields and mode", () => {
    expect(() => resolveConfig({ name: "x", out_dir: "o" })).toThrow(/gcid/);
    expect(() => resolveConfig({ gcid: "g", name: "x", out_dir: "o", mode: "huge" })).toThrow(/mode/);
    expect(() => resolveConfig({ gcid: "g", name: "x", out_dir: "o", seeds: "nope" })).toThrow(/seeds/);
  });
  test("defaults: empty seeds fall back to the category name; budget by mode", () => {
    const c = resolveConfig({ gcid: "g", name: "Mexican restaurant", out_dir: "o", mode: "lean" });
    expect(c.seeds).toEqual(["Mexican restaurant"]);
    expect(c.budget_usd).toBe(0.6);
  });
});
