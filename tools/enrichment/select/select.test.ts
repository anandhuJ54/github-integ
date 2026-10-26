import { describe, expect, test } from "bun:test";
import {
  aggregateTemplates,
  buildChangeSet,
  chooseCanonical,
  cleanWording,
  detectTags,
  jaccard,
  normalizeKey,
  scorecard,
  selectKeywordLane,
  slugify,
  stubJudge,
} from "./index";
import type { Candidate, ExistingRow, JudgeResult, SelectInput } from "./index";

const kw = (term: string, volume: number | null, source = "keyword_ideas", extra: Partial<Candidate> = {}): Candidate => ({
  term, volume, source, ...extra,
});
const ac = (term: string, position: number): Candidate => ({ term, volume: null, source: "autocomplete", position });
const row = (id: string, term: string, extra: Partial<ExistingRow> = {}): ExistingRow => ({ id, term, ...extra });

function run(p: Partial<SelectInput> & { judge?: SelectInput["judge"] }) {
  return selectKeywordLane({
    gcid: "gcid:test",
    existing: [],
    candidates: [],
    judge: stubJudge(),
    ...p,
  });
}
const terms = (r: ReturnType<typeof run>) => r.selected.map((s) => s.term);
const outcome = (r: ReturnType<typeof run>, id: string) => r.outcomes.find((o) => o.id === id)!;

describe("1. normalization / dedupe key", () => {
  test("strain word order collapses", () => {
    expect(normalizeKey("strain blue dream")).toBe(normalizeKey("blue dreams strain"));
  });
  test("lower-case, punctuation, stopwords, digits", () => {
    expect(normalizeKey("The Best Dentist, in 78701!")).toBe("best dentist");
    expect(normalizeKey("24 hour pharmacy")).toBe("hour pharmacy");
    expect(normalizeKey("women's clothing")).toBe(normalizeKey("womens clothing"));
  });
  test("radius phrases are dropped", () => {
    expect(normalizeKey("dispensary within 0.5 mi")).toBe("dispensary");
    expect(normalizeKey("dispensary within 5 miles")).toBe("dispensary");
    expect(normalizeKey("pizza 10 mile radius")).toBe("pizza");
  });
  test("plural stemming: ies->y, trailing s, not ss", () => {
    expect(normalizeKey("dispensaries")).toBe("dispensary");
    expect(normalizeKey("weeds")).toBe("weed");
    expect(normalizeKey("glass")).toBe("glass");
    expect(normalizeKey("dress")).toBe("dress");
  });
  test("deliver family -> delivery", () => {
    const k = normalizeKey("weed delivery");
    for (const t of ["weed deliver", "weed delivers", "weed delivering", "weed deliveries"]) expect(normalizeKey(t)).toBe(k);
  });
  test("proximity words collapse into one NEAR token", () => {
    expect(normalizeKey("dispensary near me")).toBe("NEAR dispensary");
    for (const t of ["dispensary nearby", "dispensary closest", "local dispensary", "dispensary around me", "dispensary closeby", "dispensary in my area", "dispensary near me near me"])
      expect(normalizeKey(t)).toBe("NEAR dispensary");
  });
  test("key is a sorted token set", () => {
    expect(normalizeKey("near me dispensary")).toBe(normalizeKey("dispensary near me"));
    expect(normalizeKey("beta alpha")).toBe("alpha beta");
  });
  test("close to me is NOT a proximity word (left to cluster collapse)", () => {
    expect(normalizeKey("burrito close to me")).not.toBe(normalizeKey("burrito near me"));
  });
});

describe("2. canonical wording", () => {
  test("golden wording fixes", () => {
    expect(cleanWording("dispensary near me near me")).toBe("dispensary near me");
    expect(cleanWording("weeds store near me")).toBe("weed store near me");
    expect(cleanWording("dispensary within 0.5 mi")).toBe("dispensary");
  });
  test("leading near me moves to the end; trailing near becomes near me", () => {
    expect(cleanWording("near me dispensary")).toBe("dispensary near me");
    expect(cleanWording("near me weed near me")).toBe("weed near me");
    expect(cleanWording("pizza near")).toBe("pizza near me");
  });
  test("plural kept when it is the head noun", () => {
    expect(cleanWording("homes for sale near me")).toBe("homes for sale near me");
    expect(cleanWording("dispensaries near me")).toBe("dispensaries near me");
  });
  test("idempotent", () => {
    for (const t of ["near me near me weeds store near", "dispensary within 5 mi near me", "Weeds Store"]) {
      expect(cleanWording(cleanWording(t))).toBe(cleanWording(t));
    }
  });
  test("existing wording preferred when within 90% of best", () => {
    const c = chooseCanonical([
      { text: "dentist near me", volume: 1000, has_existing: true, ac_confirmed: false, ac_position: null },
      { text: "dentists near me", volume: 1100, has_existing: false, ac_confirmed: true, ac_position: 0 },
    ]);
    expect(c).toEqual({ term: "dentist near me", basis: "existing" });
  });
  test("existing wording loses below 90%: autocomplete-confirmed wins, else shortest", () => {
    const base = { has_existing: false, ac_position: null as number | null };
    const v = [
      { text: "dentist near me", volume: 800, has_existing: true, ac_confirmed: false, ac_position: null },
      { text: "dentists near me", volume: 1000, ...base, ac_confirmed: true, ac_position: 1 },
      { text: "dentist office near me", volume: 1000, ...base, ac_confirmed: false },
    ];
    expect(chooseCanonical(v)).toEqual({ term: "dentists near me", basis: "autocomplete" });
    v[1].ac_confirmed = false;
    expect(chooseCanonical(v)).toEqual({ term: "dentists near me", basis: "shortest" });
  });
  test("a wording far below the best is never canonical (shortest only among near-best)", () => {
    const c = chooseCanonical([
      { text: "x", volume: 5, has_existing: false, ac_confirmed: false, ac_position: null },
      { text: "long wording here", volume: 5000, has_existing: false, ac_confirmed: false, ac_position: null },
    ]);
    expect(c.term).toBe("long wording here");
  });
  test("group-level: variant volume = max, canonical never has doubled proximity", () => {
    const r = run({
      candidates: [kw("dispensary near me near me", 90000), kw("dispensary near me", 100000), kw("dispensary nearby", 20000)],
    });
    expect(r.selected).toHaveLength(1);
    expect(r.selected[0].term).toBe("dispensary near me");
    expect(r.selected[0].volume).toBe(100000);
  });
});

describe("3. Google cluster collapse", () => {
  test("burrito near me / close to me / food near me at 450000 -> one representative", () => {
    const r = run({
      candidates: [
        kw("burrito near me", 450000),
        kw("burrito close to me", 450000),
        kw("burrito food near me", 450000),
        kw("taco near me", 301000),
      ],
    });
    expect(terms(r)).toEqual(["burrito near me", "taco near me"]);
    const rep = r.selected[0];
    expect(rep.cluster.map((c) => c.term).sort()).toEqual(["burrito close to me", "burrito food near me"]);
  });
  test("identical volume but unrelated terms are not collapsed", () => {
    const r = run({
      candidates: [kw("burrito near me", 1000), kw("plumber near me", 1000)],
      judge: stubJudge({ "burrito near me": { family: "food" }, "plumber near me": { family: "trades" } }),
    });
    expect(r.selected).toHaveLength(2);
  });
  test("same family + identical volume + a shared token collapses even below the Jaccard threshold", () => {
    // tokens {NEAR, burrito} vs {NEAR, food, fast, mexican, burrito, place}: jaccard 2/6 = 0.33 < 0.34
    const r = run({
      candidates: [kw("burrito near me", 5000), kw("fast mexican burrito food place near me", 5000)],
      judge: stubJudge({}, { unlistedFamily: () => "mexican" }),
    });
    expect(r.selected).toHaveLength(1);
    expect(jaccard(["NEAR", "burrito"], ["NEAR", "food", "fast", "mexican", "burrito", "place"])).toBeLessThan(0.34);
  });
  test("same family with no shared token (only NEAR) does not collapse by default", () => {
    const r = run({
      candidates: [kw("burrito near me", 5000), kw("pizza near me", 5000)],
      judge: stubJudge({}, { unlistedFamily: () => "food" }),
    });
    expect(r.selected).toHaveLength(2);
  });
  test("collapsed existing row merges into the representative's row", () => {
    const r = run({
      existing: [row("r1", "burrito near me"), row("r2", "burrito close to me")],
      candidates: [kw("burrito near me", 450000), kw("burrito close to me", 450000)],
    });
    expect(outcome(r, "r1").outcome).toBe("KEEP_TOP");
    expect(outcome(r, "r2")).toMatchObject({ outcome: "MERGE", into: "r1" });
  });
  test("a group that already has a row is preferred as representative on a volume tie", () => {
    const r = run({
      existing: [row("r2", "burrito close to me")],
      candidates: [kw("burrito near me", 450000), kw("burrito close to me", 450000)],
    });
    expect(r.selected).toHaveLength(1);
    expect(r.selected[0].row_id).toBe("r2");
    expect(r.adds).toHaveLength(0);
  });
});

describe("4. hidden volume (Tier A / Tier B)", () => {
  test("null volume + autocomplete position 0 -> Tier B, flagged hidden, band Unknown", () => {
    const r = run({ candidates: [ac("weed delivery near me", 0), kw("dispensary near me", 90000)] });
    const b = r.selected.find((s) => s.term === "weed delivery near me")!;
    expect(b).toMatchObject({ tier: "B", hidden_volume: true, band: "Unknown", volume: null });
    expect(r.selected.find((s) => s.term === "dispensary near me")!.tier).toBe("A");
  });
  test("autocomplete position > 4 is not enough on its own", () => {
    const r = run({ candidates: [ac("weed delivery near me", 5)] });
    expect(r.selected).toHaveLength(0);
  });
  test("position 5-9 qualifies only when corroborated by a second source and configured", () => {
    const cands = [ac("weed delivery near me", 6), kw("weed delivery near me", null, "competitor", { domain: "a.com" })];
    expect(run({ candidates: cands }).selected).toHaveLength(0);
    expect(run({ candidates: cands, config: { tierBCorroboratedMaxPosition: 9 } }).selected).toHaveLength(1);
  });
  test("Tier B is capped", () => {
    const cands = Array.from({ length: 20 }, (_, i) => ac(`hidden term q${String.fromCharCode(97 + i)}`, i % 5));
    const r = run({ candidates: cands, config: { tierBCap: 12 }, judge: stubJudge({}, { unlistedFamily: (t) => t }) });
    expect(r.selected.filter((s) => s.tier === "B")).toHaveLength(12);
    expect(r.skipped.tier_b_cap).toBe(8);
  });
  test("Tier B terms keep their reserved slots when measured terms exceed n", () => {
    const measured = Array.from({ length: 30 }, (_, i) => kw(`measured${String.fromCharCode(97 + (i % 26))} near me`, 10000 - i));
    const r = run({ candidates: [...measured, ac("hidden one", 0), ac("hidden two", 1)], config: { n: 10, familyCap: 99, headFamilyCap: 99 } });
    expect(r.selected).toHaveLength(10);
    expect(r.selected.filter((s) => s.tier === "B")).toHaveLength(2);
  });
  test("floor is configurable; below-floor measured term is not Tier A", () => {
    const cands = [kw("a thing", 299), kw("b thing", 300)];
    expect(terms(run({ candidates: cands }))).toEqual(["b thing"]);
    expect(terms(run({ candidates: cands, config: { floor: 100 } }))).toEqual(["b thing", "a thing"]);
  });
  test("null never means zero: null is not Tier A and ranks below measured", () => {
    const r = run({ candidates: [ac("hidden", 0), kw("measured", 301)] });
    expect(terms(r)).toEqual(["measured", "hidden"]);
  });
});

describe("5. selection", () => {
  const fam = (f: (t: string) => string) => stubJudge({}, { unlistedFamily: f });
  test("ranked by volume desc", () => {
    const r = run({ candidates: [kw("b q", 500), kw("c q", 900), kw("a q", 700)] });
    expect(terms(r)).toEqual(["c q", "a q", "b q"]);
    expect(r.selected.map((s) => s.rank)).toEqual([1, 2, 3]);
  });
  test("per-family cap 5, head family 8; families come from the judge", () => {
    const cands = [
      ...Array.from({ length: 10 }, (_, i) => kw(`head${i} x`, 10000 - i)),
      ...Array.from({ length: 10 }, (_, i) => kw(`other${i} x`, 5000 - i)),
    ];
    const r = run({ candidates: cands, judge: fam((t) => (t.startsWith("head") ? "H" : "O")) });
    expect(r.head_family).toBe("H");
    expect(r.selected.filter((s) => s.family === "H")).toHaveLength(8);
    expect(r.selected.filter((s) => s.family === "O")).toHaveLength(5);
    expect(r.skipped.family_cap).toBe(2 + 5);
  });
  test("modifiers are tags, not families: same family regardless of best/near me", () => {
    const r = run({
      candidates: [kw("dentist near me", 9000), kw("best dentist", 8000), kw("cheap dentist", 7000)],
      judge: fam(() => "dentist"),
    });
    expect(new Set(r.selected.map((s) => s.family))).toEqual(new Set(["dentist"]));
  });
  test("informational cap", () => {
    const cands = Array.from({ length: 8 }, (_, i) => kw(`how thing${i}`, 1000 - i));
    const intents = Object.fromEntries(cands.map((c) => [c.term, "informational"]));
    const r = run({ candidates: cands, intents, judge: fam((t) => t) });
    expect(r.selected).toHaveLength(5);
    expect(r.skipped.informational_cap).toBe(3);
  });
  test("fills up to n and reports short_by for niche categories", () => {
    const r = run({ candidates: [kw("only one", 1000), kw("only two", 900)], config: { n: 50 } });
    expect(r.selected).toHaveLength(2);
    expect(r.short_by).toBe(48);
  });
  test("n is configurable", () => {
    const cands = Array.from({ length: 10 }, (_, i) => kw(`t${i} x`, 1000 - i));
    const r = run({ candidates: cands, config: { n: 4 }, judge: fam((t) => t) });
    expect(r.selected).toHaveLength(4);
    expect(r.short_by).toBe(0);
  });
  test("judge-excluded candidates are never selected; unjudged candidates are listed and skipped", () => {
    const r = run({
      candidates: [kw("starbucks near me", 90000), kw("coffee near me", 80000), kw("mystery term", 70000)],
      judge: stubJudge({ "starbucks near me": { decision: "exclude", reason_code: "brand" } }, { unlisted: "none" }),
    });
    expect(terms(r)).toEqual([]);
    const r2 = run({
      candidates: [kw("starbucks near me", 90000), kw("coffee near me", 80000), kw("mystery term", 70000)],
      judge: stubJudge({ "starbucks near me": { decision: "exclude", reason_code: "brand" }, "coffee near me": {} }, { unlisted: "none" }),
    });
    expect(terms(r2)).toEqual(["coffee near me"]);
    expect(r2.unjudged).toEqual(["mystery term"]);
    expect(r2.excluded[0]).toMatchObject({ term: "starbucks near me", reason_code: "brand" });
  });
  test("deterministic regardless of input order", () => {
    const cands = [kw("a x", 500), kw("b x", 500), kw("c near me", 500), ac("d x", 1), kw("e x", 900, "competitor", { domain: "z.com" })];
    const a = run({ candidates: cands });
    const b = run({ candidates: [...cands].reverse() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("6. modifier tags", () => {
  test("detects configured modifiers", () => {
    expect(detectTags("best cheap weed delivery near me open now")).toEqual(["near me", "best", "cheap", "open now", "delivery"]);
    expect(detectTags("homes for sale")).toEqual(["for sale"]);
    expect(detectTags("24 hour pharmacy same day online")).toEqual(["online", "same day", "24 hour"]);
    expect(detectTags("dispensary deliveries")).toEqual(["delivery"]);
  });
  test("custom tag list", () => {
    expect(detectTags("luxury homes", ["luxury", { tag: "pet", pattern: "\\bdogs?\\b" }])).toEqual(["luxury"]);
    expect(detectTags("dog groomer", ["luxury", { tag: "pet", pattern: "\\bdogs?\\b" }])).toEqual(["pet"]);
  });
  test("local_intent from NEAR; local_pack passed through", () => {
    const r = run({
      candidates: [kw("dentist near me", 5000), kw("dentist cost", 4000)],
      local_pack: { "dentist near me": true },
    });
    const near = r.selected.find((s) => s.term === "dentist near me")!;
    const plain = r.selected.find((s) => s.term === "dentist cost")!;
    expect(near).toMatchObject({ local_intent: true, local_pack: true });
    expect(near.tags).toContain("near me");
    expect(plain).toMatchObject({ local_intent: false, local_pack: false });
  });
});

describe("7. bands", () => {
  test("High top 15%, Medium next 35%, Low rest; hidden = Unknown", () => {
    const cands = Array.from({ length: 20 }, (_, i) => kw(`tq${String.fromCharCode(97 + i)} x`, 10000 - i * 100));
    const r = run({ candidates: [...cands, ac("hidden", 0)], config: { familyCap: 99, headFamilyCap: 99 }, judge: stubJudge({}, { unlistedFamily: (t) => t }) });
    const by = (b: string) => r.selected.filter((s) => s.band === b).length;
    expect(by("High")).toBe(3);
    expect(by("Medium")).toBe(7);
    expect(by("Low")).toBe(10);
    expect(by("Unknown")).toBe(1);
    expect(r.selected[0].band).toBe("High");
    expect(r.selected[3].band).toBe("Medium");
    expect(r.selected[10].band).toBe("Low");
  });
  test("identical volumes at a boundary share a band", () => {
    const r = run({
      candidates: [kw("alpha one", 1000), kw("beta two", 1000), kw("gamma three", 500), kw("delta four", 400)],
      judge: stubJudge({}, { unlistedFamily: (t) => t }),
    });
    expect(r.selected.slice(0, 2).map((s) => s.band)).toEqual(["High", "High"]);
  });
});

describe("8. local templates", () => {
  test("template rows are kept, not counted in the top N", () => {
    const r = run({
      existing: [row("t1", "realtors {city}"), row("t2", "realtor in {city} {state}")],
      candidates: [kw("realtor near me", 5000)],
      config: { n: 1 },
    });
    expect(outcome(r, "t1")).toMatchObject({ outcome: "KEEP_TEMPLATE" });
    expect(outcome(r, "t2")).toMatchObject({ outcome: "KEEP_TEMPLATE" });
    expect(r.selected).toHaveLength(1);
    expect(r.short_by).toBe(0);
    expect(r.templates.map((t) => t.id)).toEqual(["t1", "t2"]);
  });
  test("aggregates demand of city variants per template", () => {
    const { templates, unmatched } = aggregateTemplates(
      ["realtors {city}", "realtor {city} {state}"],
      [
        { term: "realtors austin", volume: 1000 },
        { term: "realtor in austin", volume: 400 },
        { term: "realtors dallas", volume: 800 },
        { term: "realtors houston", volume: null },
        { term: "realtor austin tx", volume: 300 },
        { term: "realtors near me", volume: 90000 },
        { term: "mortgage austin", volume: 50 },
      ],
    );
    const t1 = templates.find((t) => t.template === "realtors {city}")!;
    expect(t1.total_volume).toBe(1000 + 800); // "realtor in austin" duplicates "realtors austin": max kept, not summed
    expect(t1.measured_count).toBe(2);
    expect(t1.null_count).toBe(1);
    expect(t1.variants.find((v) => v.term === "realtors dallas")!.slots).toEqual({ city: "dallas" });
    const t2 = templates.find((t) => t.template === "realtor {city} {state}")!;
    expect(t2.total_volume).toBe(300);
    expect(unmatched.map((u) => u.term).sort()).toEqual(["mortgage austin", "realtors near me"]);
  });
  test("local_intent for placeholder terms", () => {
    expect(selectKeywordLane({ gcid: "g", existing: [], candidates: [], judge: [] }).templates).toEqual([]);
    expect(detectTags("realtors {city}")).toEqual([]);
  });
});

describe("9. existing row outcomes", () => {
  test("null volume, no objection -> KEEP_LONG_TAIL_UNVERIFIED (never retired for missing data)", () => {
    const r = run({ existing: [row("r1", "obscure thing nobody measured")] });
    expect(outcome(r, "r1").outcome).toBe("KEEP_LONG_TAIL_UNVERIFIED");
    expect(outcome(r, "r1").reason.length).toBeGreaterThan(0);
  });
  test("measured but not selected -> KEEP_LONG_TAIL", () => {
    const r = run({ existing: [row("r1", "tiny term")], candidates: [kw("tiny term", 50)] });
    expect(outcome(r, "r1").outcome).toBe("KEEP_LONG_TAIL");
    expect(outcome(r, "r1").evidence?.volume).toBe(50);
  });
  test("stored volume counts as measured when no fresh evidence exists", () => {
    const r = run({ existing: [row("r1", "tiny term", { search_volume_monthly: 20 })] });
    expect(outcome(r, "r1").outcome).toBe("KEEP_LONG_TAIL");
    expect(outcome(r, "r1").evidence?.volume_origin).toBe("existing");
  });
  test("KEEP_TOP carries rank, band and evidence", () => {
    const r = run({ existing: [row("r1", "dentist near me")], candidates: [kw("dentist near me", 9000)] });
    const o = outcome(r, "r1");
    expect(o).toMatchObject({ outcome: "KEEP_TOP", rank: 1, band: "High" });
    expect(o.evidence?.sources).toEqual(["keyword_ideas"]);
    expect(r.adds).toHaveLength(0);
  });
  test("duplicate rows of one group: one kept, others MERGE into it", () => {
    const r = run({ existing: [row("r1", "dentist near me"), row("r2", "dentists near me"), row("r3", "near me dentist")], candidates: [kw("dentist near me", 9000)] });
    expect(r.outcomes.filter((o) => o.outcome === "KEEP_TOP")).toHaveLength(1);
    const keep = r.outcomes.find((o) => o.outcome === "KEEP_TOP")!;
    for (const o of r.outcomes.filter((x) => x.outcome === "MERGE")) expect(o.into).toBe(keep.id);
    expect(r.outcomes.filter((o) => o.outcome === "MERGE")).toHaveLength(2);
  });
  test("MERGE of duplicates also works in the long tail", () => {
    const r = run({ existing: [row("r1", "tiny thing"), row("r2", "tiny things")] });
    expect(outcome(r, "r1").outcome).toBe("KEEP_LONG_TAIL_UNVERIFIED");
    expect(outcome(r, "r2")).toMatchObject({ outcome: "MERGE", into: "r1" });
  });
  test("judge exclusion -> RETIRE with reason_code", () => {
    for (const code of ["brand", "other_category", "off_intent", "geo", "amenity", "compliance"]) {
      const r = run({
        existing: [row("r1", "something")],
        candidates: [kw("something", 5000)],
        judge: stubJudge({ something: { decision: "exclude", reason_code: code } }),
      });
      expect(outcome(r, "r1")).toMatchObject({ outcome: "RETIRE", reason_code: code });
      expect(r.selected).toHaveLength(0);
    }
  });
  test("judge exclusion with a lane -> MOVE", () => {
    const r = run({
      existing: [row("r1", "how to buy weed"), row("r2", "weed guide")],
      judge: stubJudge({
        "how to buy weed": { decision: "exclude", reason_code: "informational" },
        "weed guide": { decision: "exclude", reason_code: "off_intent", to_lane: "question" },
      }),
    });
    expect(outcome(r, "r1")).toMatchObject({ outcome: "MOVE", to_lane: "guide" });
    expect(outcome(r, "r2")).toMatchObject({ outcome: "MOVE", to_lane: "question" });
  });
  test("an exclusion without a reason_code is not acted on", () => {
    const r = run({ existing: [row("r1", "something")], judge: stubJudge({ something: { decision: "exclude", reason_code: "" } }) });
    expect(outcome(r, "r1").outcome).toBe("KEEP_LONG_TAIL_UNVERIFIED");
    expect(r.warnings.some((w) => w.includes("without a reason_code"))).toBe(true);
  });
  test("every existing row gets exactly one outcome", () => {
    const existing = [row("a", "dentist near me"), row("b", "dentists near me"), row("c", "x {city}"), row("d", "zzz"), row("e", "bad", {}), row("f", "tiny")];
    const r = run({
      existing,
      candidates: [kw("dentist near me", 9000), kw("tiny", 5)],
      judge: stubJudge({ bad: { decision: "exclude", reason_code: "brand" } }),
    });
    expect(r.outcomes.map((o) => o.id).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(new Set(r.outcomes.map((o) => o.id)).size).toBe(existing.length);
  });
});

describe("10. new adds", () => {
  test("selected terms without a row become ADD with full evidence", () => {
    const r = run({
      candidates: [kw("dentist near me", 9000, "keyword_ideas", { volume_as_of: "2026-09-01" }), ac("dentist near me", 2)],
      intents: { "dentist near me": "local" },
    });
    expect(r.adds).toHaveLength(1);
    expect(r.adds[0]).toMatchObject({
      op: "ADD", term: "dentist near me", source: "keyword_ideas", volume: 9000, volume_as_of: "2026-09-01",
      intent: "local", band: "High", local_intent: true, tier: "A", hidden_volume: false,
    });
    expect(r.adds[0].tags).toContain("near me");
    expect(r.adds[0].evidence.sources).toEqual(["autocomplete", "keyword_ideas"]);
    expect(r.adds[0].evidence.ac_best_position).toBe(2);
  });
  test("config.volumeAsOf is the default as-of date", () => {
    const r = run({ candidates: [kw("dentist", 9000)], config: { volumeAsOf: "2026-10-01" } });
    expect(r.adds[0].volume_as_of).toBe("2026-10-01");
  });
});

describe("golden: cannabis / real estate", () => {
  test("hidden-volume Tier B + unverified existing row", () => {
    const r = run({
      existing: [row("r1", "cbd gummies strain guide")],
      candidates: [ac("weed delivery near me", 0), kw("dispensary near me", 1200000)],
    });
    expect(r.selected.find((s) => s.term === "weed delivery near me")).toMatchObject({ tier: "B", hidden_volume: true });
    expect(outcome(r, "r1").outcome).toBe("KEEP_LONG_TAIL_UNVERIFIED");
  });
  test("strain terms collapse to one group", () => {
    const r = run({ candidates: [kw("strain blue dream", 40000), kw("blue dreams strain", 33100)] });
    expect(r.selected).toHaveLength(1);
    expect(r.selected[0].volume).toBe(40000);
  });
  test("homes for sale near me kept (map pack, judge keep); homes for sale excluded (portal_owned)", () => {
    const r = run({
      candidates: [kw("homes for sale near me", 550000), kw("homes for sale", 1500000)],
      local_pack: { "homes for sale near me": true, "homes for sale": false },
      judge: stubJudge({
        "homes for sale near me": { decision: "keep", family: "listings" },
        "homes for sale": { decision: "exclude", reason_code: "portal_owned", family: "listings" },
      }),
    });
    expect(terms(r)).toEqual(["homes for sale near me"]);
    expect(r.selected[0]).toMatchObject({ local_pack: true, local_intent: true });
    expect(r.excluded.map((e) => [e.term, e.reason_code])).toEqual([["homes for sale", "portal_owned"]]);
  });
  test("an existing 'homes for sale' row is RETIRED as portal_owned", () => {
    const r = run({
      existing: [row("r1", "homes for sale"), row("r2", "homes for sale near me")],
      candidates: [kw("homes for sale near me", 550000), kw("homes for sale", 1500000)],
      judge: stubJudge({ "homes for sale": { decision: "exclude", reason_code: "portal_owned" } }),
    });
    expect(outcome(r, "r1")).toMatchObject({ outcome: "RETIRE", reason_code: "portal_owned" });
    expect(outcome(r, "r2").outcome).toBe("KEEP_TOP");
  });
});

describe("11. change set", () => {
  const gc = "gcid:test";
  const base = () => {
    const existing: ExistingRow[] = [
      row("11111111-1111-1111-1111-111111111111", "dentist near me near me", { level: "keyword", term_slug: "dentist_near_me_near_me", term_display: "Dentist Near Me Near Me", priority: 5, search_volume_monthly: null, search_intent: null }),
      row("22222222-2222-2222-2222-222222222222", "dentists near me", { level: "keyword", priority: 5 }),
      row("33333333-3333-3333-3333-333333333333", "starbucks", { level: "keyword", priority: 5 }),
      row("44444444-4444-4444-4444-444444444444", "tiny thing", { level: "keyword", priority: 5 }),
      row("55555555-5555-5555-5555-555555555555", "how to floss", { level: "keyword" }),
      row("66666666-6666-6666-6666-666666666666", "dentist {city}", { level: "keyword" }),
    ];
    const r = selectKeywordLane({
      gcid: gc,
      existing,
      candidates: [
        kw("dentist near me", 9000, "keyword_ideas", { volume_as_of: "2026-09-01" }),
        kw("teeth whitening", 4000, "keyword_ideas", { volume_as_of: "2026-09-01" }),
        ac("emergency dentist", 1),
      ],
      intents: { "dentist near me": "local" },
      judge: stubJudge({
        starbucks: { decision: "exclude", reason_code: "brand" },
        "how to floss": { decision: "exclude", reason_code: "informational" },
      }),
      config: { volumeAsOf: "2026-09-01" },
    });
    return { r, existing, cs: buildChangeSet(r, existing) };
  };

  test("ADD: target_key {gcid, level, term_slug}, allowed payload keys only", () => {
    const { cs } = base();
    const add = cs.proposals.find((p) => p.op === "add" && p.payload.term === "teeth whitening")!;
    expect(add.target_table).toBe("exp_taxonomy");
    expect(add.target_key).toEqual({ gcid: gc, level: "keyword", term_slug: "teeth_whitening" });
    expect(add.before).toEqual({});
    const allowed = new Set(["level", "term", "term_display", "term_slug", "entity_scope", "source", "search_intent", "search_volume_monthly", "validated", "priority", "is_required", "concept_slug", "volume_source", "volume_as_of", "evidence"]);
    for (const k of Object.keys(add.payload)) expect(allowed.has(k)).toBe(true);
    expect(add.payload).toMatchObject({ level: "keyword", term_slug: "teeth_whitening", search_volume_monthly: 4000, validated: true, is_required: false, volume_as_of: "2026-09-01", volume_source: "keyword_ideas" });
    expect(typeof add.rationale).toBe("string");
    expect(add.rule).toBe("KW.add_measured");
    const hidden = cs.proposals.find((p) => p.op === "add" && p.payload.term === "emergency dentist")!;
    expect(hidden.payload).toMatchObject({ search_volume_monthly: null, validated: false });
    expect(hidden.rule).toBe("KW.add_hidden_volume");
  });
  test("ADD priority = rank 1..N; add target_keys are unique", () => {
    const { r, cs } = base();
    const adds = cs.proposals.filter((p) => p.op === "add");
    const byTerm = Object.fromEntries(adds.map((p) => [p.payload.term as string, p.payload.priority]));
    expect(byTerm["teeth whitening"]).toBe(r.selected.find((s) => s.term === "teeth whitening")!.rank);
    const keys = adds.map((p) => JSON.stringify(p.target_key));
    expect(new Set(keys).size).toBe(keys.length);
  });
  test("SET on a kept row carries `before` for every key (stale-write guard), incl. rewording", () => {
    const { cs } = base();
    const set = cs.proposals.find((p) => p.op === "set" && (p.target_key as { id: string }).id.startsWith("1111"))!;
    expect(Object.keys(set.before).sort()).toEqual(Object.keys(set.payload).sort());
    expect(set.payload).toMatchObject({ term: "dentist near me", term_display: "dentist near me", term_slug: "dentist_near_me", priority: 1, search_volume_monthly: 9000, search_intent: "local" });
    expect(set.before).toMatchObject({ term: "dentist near me near me", term_slug: "dentist_near_me_near_me", priority: 5, search_volume_monthly: null });
    expect(set.target_key).toEqual({ id: "11111111-1111-1111-1111-111111111111" });
  });
  test("MERGE payload {into, reason}; RETIRE payload {reason}; targets keyed by id", () => {
    const { cs } = base();
    const merge = cs.proposals.find((p) => p.op === "merge")!;
    expect(merge.target_key).toEqual({ id: "22222222-2222-2222-2222-222222222222" });
    expect(Object.keys(merge.payload).sort()).toEqual(["into", "reason"]);
    expect(merge.payload.into).toBe("11111111-1111-1111-1111-111111111111");
    const retire = cs.proposals.find((p) => p.op === "retire" && p.rule === "KW.retire_brand")!;
    expect(retire.target_key).toEqual({ id: "33333333-3333-3333-3333-333333333333" });
    expect(retire.payload).toEqual({ reason: "brand" });
  });
  test("MOVE = add in the new lane + retire 'moved to <lane>' in the old", () => {
    const { cs } = base();
    const add = cs.proposals.find((p) => p.op === "add" && p.payload.level === "guide")!;
    expect(add.target_key).toEqual({ gcid: gc, level: "guide", term_slug: "how_to_floss" });
    const retire = cs.proposals.find((p) => p.op === "retire" && (p.target_key as { id: string }).id.startsWith("5555"))!;
    expect(retire.payload).toEqual({ reason: "moved to guide" });
  });
  test("long tail gets priority 100; templates produce no change", () => {
    const { cs } = base();
    const tiny = cs.proposals.find((p) => p.op === "set" && (p.target_key as { id: string }).id.startsWith("4444"))!;
    expect(tiny.payload).toEqual({ priority: 100 });
    expect(tiny.before).toEqual({ priority: 5 });
    expect(cs.proposals.some((p) => JSON.stringify(p.target_key).includes("6666"))).toBe(false);
  });
  test("an add whose slug already exists is skipped with a warning (unique index)", () => {
    const existing = [row("a1", "dentist near me", { level: "keyword", term_slug: "dentist_near_me", priority: 1 })];
    const r = selectKeywordLane({ gcid: gc, existing: [], candidates: [kw("dentist near me", 9000)], judge: stubJudge() });
    const cs = buildChangeSet(r, existing);
    expect(cs.proposals).toHaveLength(0);
    expect(cs.warnings[0]).toContain("already exists");
  });
  test("no change emitted when nothing differs", () => {
    const existing = [row("a1", "dentist near me", { level: "keyword", priority: 1, search_volume_monthly: 9000, volume_source: "keyword_ideas", volume_as_of: null, validated: true })];
    const r = selectKeywordLane({ gcid: gc, existing, candidates: [kw("dentist near me", 9000)], judge: stubJudge() });
    expect(buildChangeSet(r, existing).proposals).toHaveLength(0);
  });
  test("slugify", () => {
    expect(slugify("Dentist Near-Me!")).toBe("dentist_near_me");
  });
});

describe("12. scorecard", () => {
  test("counts by outcome, measured share, wording mix, families, local share, tiers", () => {
    const existing = [row("r1", "dentist near me"), row("r2", "dentists near me"), row("r3", "zzz")];
    const r = run({
      existing,
      candidates: [kw("dentist near me", 9000), kw("teeth whitening", 4000), kw("emergency dentist", null), ac("emergency dentist", 0), ac("hidden thing", 1)],
      judge: stubJudge({ "dentist near me": { family: "dentist" }, "teeth whitening": { family: "cosmetic" }, "emergency dentist": { family: "dentist" } }),
    });
    const s = scorecard(r);
    expect(s.outcomes).toMatchObject({ KEEP_TOP: 1, MERGE: 1, KEEP_LONG_TAIL_UNVERIFIED: 1, ADD: 3 });
    expect(s.selected).toBe(4);
    expect(s.tier_a).toBe(2);
    expect(s.tier_b).toBe(2);
    expect(s.measured_share).toBe(0.5);
    expect(s.families).toMatchObject({ dentist: 2, cosmetic: 1 });
    expect(s.local_intent_share).toBe(0.25);
    expect(s.wording_mix.existing + s.wording_mix.autocomplete + s.wording_mix.shortest).toBe(4);
    expect(s.wording_mix.existing).toBe(1);
    expect(s.bands.Unknown).toBe(2);
    expect(s.short_by).toBe(46);
  });
});
