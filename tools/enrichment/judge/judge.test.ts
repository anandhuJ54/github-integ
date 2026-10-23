import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DECISIONS,
  DECISION_ORDER,
  FORBIDDEN_FAMILY_SLUGS,
  LANES,
  REASON_CODES,
  REASON_CODE_DEFS,
  type Lane,
} from "./reason-codes";
import { JUDGE_OUTPUT_SCHEMA, structuredOutputsSubset } from "./schema";
import { buildCandidateBlock, buildCategoryBlock, buildJudgePrompt, buildSystemPrompt, chunkCandidates, toBatchRequest, toMessagesParams } from "./prompt";
import { familyShapeProblem, validateJudgeOutput } from "./validate";
import { evaluate, renderReport, type GoldenFile, type GoldenRow, type ResultCall, type ResultsFile } from "./eval";
import { cost, estimateTokens, PRICES, type Scenario } from "./cost";
import type { CategoryContext, JudgeCandidate, JudgeRow } from "./types";

const here = (p: string) => new URL(p, import.meta.url);
const golden = JSON.parse(readFileSync(here("./golden/golden.json"), "utf8")) as GoldenFile;
const identityKeys = JSON.parse(readFileSync(here("../../category_brief/out/category_identity_keys.json"), "utf8")) as Record<string, unknown>;

// ---------------------------------------------------------------- mocked model
type Mutator = (g: GoldenRow, row: JudgeRow) => JudgeRow | null; // null = drop the row from the output

function goldenToRow(g: GoldenRow): JudgeRow {
  return {
    term: g.term,
    decision: g.expected.decision,
    reason_code: g.expected.reason_code,
    family: g.expected.decision === "keep" ? g.family_hint : null,
    to_lane: g.expected.to_lane,
    note: g.note,
  };
}

function candidatesFor(gcid: string, lane: Lane): JudgeCandidate[] {
  return golden.rows.filter((g) => g.gcid === gcid && g.lane === lane).map((g) => ({ term: g.term, volume: null, intent: null, local_pack: g.local_pack }));
}

/** A mocked model: answers every (category, lane) call from the golden labels, optionally corrupted by `mutate`. */
function mockModel(mutate?: Mutator, asString = false): ResultsFile {
  const groups = new Map<string, GoldenRow[]>();
  for (const g of golden.rows) {
    const k = `${g.gcid}|${g.lane}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(g);
  }
  const calls: ResultCall[] = [];
  for (const [k, rows] of groups) {
    const [gcid, lane] = k.split("|") as [string, Lane];
    const out: JudgeRow[] = [];
    for (const g of rows) {
      const base = goldenToRow(g);
      const r = mutate ? mutate(g, base) : base;
      if (r) out.push(r);
    }
    calls.push({ gcid, lane, output: asString ? JSON.stringify(out) : out, candidates: candidatesFor(gcid, lane) });
  }
  return { calls };
}

// ---------------------------------------------------------------- vocabulary
describe("reason-code vocabulary", () => {
  test("every code has a definition, a note rule and 2+ examples, and a legal decision", () => {
    expect(REASON_CODES.length).toBe(13);
    for (const c of REASON_CODES) {
      const d = REASON_CODE_DEFS[c];
      expect(d.code).toBe(c);
      expect(d.definition.length).toBeGreaterThan(40);
      expect(d.noteRule.length).toBeGreaterThan(5);
      expect(d.examples.length).toBeGreaterThanOrEqual(2);
      for (const dec of d.decisions) expect((DECISIONS as readonly string[]).includes(dec)).toBe(true);
    }
  });
  test("14 lanes, precedence covers every code exactly once", () => {
    expect(LANES.length).toBe(14);
    expect([...DECISION_ORDER].sort()).toEqual([...REASON_CODES].sort());
  });
  test("system prompt renders every code, every lane and the family rules", () => {
    const s = buildSystemPrompt();
    for (const c of REASON_CODES) expect(s).toContain(c);
    for (const l of LANES) expect(s).toContain(`- ${l}:`);
    expect(s).toContain("domain-qualified");
    expect(s).toContain("real_estate:brokerage");
    expect(s).toContain("local_pack");
    expect(s).toContain("Google reports one shared volume");
  });
  test("the prompt says 'category', and 'vertical' appears only in the one instruction that forbids it", () => {
    const sys = buildSystemPrompt();
    expect((sys.match(/vertical/gi) ?? []).length).toBe(1);
    expect(sys).toContain('never "vertical"');
    expect(buildCategoryBlock(golden.categories["gcid:cannabis_store"]).toLowerCase()).not.toContain("vertical");
  });
});

// ---------------------------------------------------------------- schema
describe("JSON schema", () => {
  test("checked-in schema file is in sync with the TypeScript source", () => {
    const onDisk = JSON.parse(readFileSync(here("./judge-output.schema.json"), "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(JUDGE_OUTPUT_SCHEMA)));
  });
  test("reason_code enum equals the vocabulary; structured-output subset drops conditionals", () => {
    expect(JUDGE_OUTPUT_SCHEMA.items.properties.reason_code.enum).toEqual([...REASON_CODES]);
    expect("allOf" in (structuredOutputsSubset() as { items: object }).items).toBe(false);
  });
});

// ---------------------------------------------------------------- validator
describe("validateJudgeOutput", () => {
  const cat = golden.categories["gcid:real_estate_agents"];
  const good: JudgeRow = { term: "realtor near me", decision: "keep", reason_code: "keep", family: "real_estate:residential_agent", to_lane: null, note: "" };
  const cands = (...t: string[]): JudgeCandidate[] => t.map((term) => ({ term, volume: 100, intent: null, local_pack: null }));
  const run = (rows: unknown, extra: Partial<Parameters<typeof validateJudgeOutput>[1]> = {}) => validateJudgeOutput(rows, { lane: "keyword", category: cat, ...extra });
  const codes = (r: ReturnType<typeof validateJudgeOutput>) => r.errors.map((e) => e.code);

  test("accepts a valid array and a valid JSON string", () => {
    expect(run([good]).ok).toBe(true);
    expect(run(JSON.stringify([good])).ok).toBe(true);
  });
  test("rejects non-JSON, non-array, empty and fenced output", () => {
    expect(codes(run("here you go: []"))).toContain("NOT_JSON");
    expect(codes(run({ rows: [good] }))).toContain("NOT_ARRAY");
    expect(codes(run([]))).toContain("EMPTY");
    expect(codes(run("```json\n" + JSON.stringify([good]) + "\n```"))).toContain("NOT_JSON");
    expect(run("```json\n" + JSON.stringify([good]) + "\n```", { allowFences: true }).ok).toBe(true);
  });
  test("rejects an unknown reason code", () => {
    const r = run([{ ...good, reason_code: "irrelevant" }]);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("UNKNOWN_REASON_CODE");
    expect(r.rows.length).toBe(0);
  });
  test("rejects missing and extra keys, bad decision", () => {
    const { note: _n, ...noNote } = good;
    expect(codes(run([noNote]))).toContain("MISSING_KEY");
    expect(codes(run([{ ...good, confidence: 0.9 }]))).toContain("EXTRA_KEY");
    expect(codes(run([{ ...good, decision: "maybe" }]))).toContain("BAD_DECISION");
  });
  test("decision and reason_code must pair (navigational_brand is keep-only, brand is exclude-only)", () => {
    expect(codes(run([{ ...good, decision: "exclude", reason_code: "navigational_brand", family: null, note: "x" }]))).toContain("DECISION_REASON_MISMATCH");
    expect(codes(run([{ ...good, reason_code: "brand_or_business_name" }]))).toContain("DECISION_REASON_MISMATCH");
    expect(run([{ ...good, term: "realtor", reason_code: "navigational_brand", note: "mostly Realtor.com" }]).ok).toBe(true);
  });
  test("families: must be domain-qualified, never a modifier, domain must belong to the category", () => {
    expect(codes(run([{ ...good, family: "broker" }]))).toContain("BAD_FAMILY_SHAPE");
    expect(codes(run([{ ...good, family: "real_estate:best" }]))).toContain("BAD_FAMILY_SHAPE");
    expect(codes(run([{ ...good, family: "real_estate:near_me" }]))).toContain("BAD_FAMILY_SHAPE");
    expect(codes(run([{ ...good, family: "real_estate:top_rated" }]))).toContain("BAD_FAMILY_SHAPE");
    expect(codes(run([{ ...good, family: "real_estate:best_realtor" }]))).toContain("BAD_FAMILY_SHAPE");
    expect(codes(run([{ ...good, family: "insurance:brokerage" }]))).toContain("FAMILY_DOMAIN");
    expect(run([{ ...good, family: "real_estate:brokerage" }]).ok).toBe(true);
    expect(familyShapeProblem("real_estate:brokerage")).toBeNull();
    expect(FORBIDDEN_FAMILY_SLUGS.has("broker")).toBe(false); // bare words are caught by the domain rule instead
  });
  test("an off-menu family is a warning (proposal), not an error", () => {
    const r = run([{ ...good, family: "real_estate:staging_consultation" }]);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("PROPOSED_FAMILY");
  });
  test("family required on keep in family lanes; forbidden on exclude and in tag/modifier lanes", () => {
    expect(codes(run([{ ...good, family: null }]))).toContain("FAMILY_REQUIRED");
    expect(codes(run([{ ...good, decision: "exclude", reason_code: "off_intent", note: "x" }]))).toContain("FAMILY_NOT_ALLOWED");
    expect(codes(validateJudgeOutput([{ ...good, term: "best" }], { lane: "modifier", category: cat }))).toContain("FAMILY_NOT_ALLOWED");
    expect(validateJudgeOutput([{ ...good, term: "best", family: null }], { lane: "modifier", category: cat }).ok).toBe(true);
  });
  test("move requires to_lane in an informational lane; to_lane forbidden otherwise", () => {
    const mv: JudgeRow = { term: "what is thc", decision: "move", reason_code: "informational", family: null, to_lane: "question", note: "definition" };
    expect(run([mv]).ok).toBe(true);
    expect(codes(run([{ ...mv, to_lane: null }]))).toContain("TO_LANE_REQUIRED");
    expect(codes(run([{ ...mv, to_lane: "keyword" }]))).toContain("TO_LANE_NOT_ALLOWED");
    expect(codes(run([{ ...good, to_lane: "topic" }]))).toContain("TO_LANE_NOT_ALLOWED");
    expect(codes(validateJudgeOutput([mv], { lane: "question", category: cat }))).toContain("TO_LANE_SAME_LANE");
  });
  test("note rules: required on exclude, geo template, duplicate survivor", () => {
    const ex: JudgeRow = { term: "yuma realtors", decision: "exclude", reason_code: "geo_specific", family: null, to_lane: null, note: "realtors {city}" };
    expect(run([ex]).ok).toBe(true);
    expect(codes(run([{ ...ex, note: "a place" }]))).toContain("GEO_TEMPLATE_REQUIRED");
    expect(codes(run([{ ...ex, note: "" }]))).toContain("NOTE_REQUIRED");
    const dup: JudgeRow = { term: "realtors near me", decision: "exclude", reason_code: "duplicate_meaning", family: null, to_lane: null, note: "duplicate of: realtor near me" };
    expect(run([good, dup], { candidates: cands("realtor near me", "realtors near me") }).ok).toBe(true);
    expect(codes(run([good, { ...dup, note: "duplicate" }], { candidates: cands("realtor near me", "realtors near me") }))).toContain("DUPLICATE_SURVIVOR_REQUIRED");
  });
  test("portal_owned is rejected when local_pack=Y (houses for sale near me is kept)", () => {
    const po: JudgeRow = { term: "houses for sale near me", decision: "exclude", reason_code: "portal_owned", family: null, to_lane: null, note: "portals own it" };
    const withPack = [{ term: po.term, volume: 1, intent: null, local_pack: true }];
    const noPack = [{ term: po.term, volume: 1, intent: null, local_pack: false }];
    expect(codes(run([po], { candidates: withPack }))).toContain("PORTAL_OWNED_WITH_LOCAL_PACK");
    expect(run([po], { candidates: noPack }).ok).toBe(true);
  });
  test("completeness: missing, unknown and duplicated terms are reported", () => {
    const r = run([good, { ...good, term: "invented term" }, good], { candidates: cands("realtor near me", "buyers agent") });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["buyers agent"]);
    expect(r.extra).toEqual(["invented term"]);
    expect(codes(r)).toContain("UNKNOWN_TERM");
    expect(codes(r)).toContain("DUPLICATE_ROW");
    expect(run([good], { candidates: cands("realtor near me", "buyers agent"), allowMissing: true }).ok).toBe(true);
  });
  test("partial failures keep the good rows for salvage", () => {
    const r = run([good, { ...good, term: "buyers agent", reason_code: "nope" }]);
    expect(r.ok).toBe(false);
    expect(r.rows.map((x) => x.term)).toEqual(["realtor near me"]);
  });
});

// ---------------------------------------------------------------- prompt / caching structure
describe("prompt structure", () => {
  const cat = golden.categories["gcid:cannabis_store"];
  const cands: JudgeCandidate[] = [
    { term: "dispensary near me", volume: 90500, intent: "local", local_pack: true },
    { term: "what is thc", volume: 33100, intent: "informational", local_pack: false },
    { term: "live resin", volume: 40500, intent: "commercial", local_pack: null },
  ];
  test("system prompt is byte-identical across categories; category block across lanes and chunks", () => {
    const a = buildJudgePrompt(cat, "keyword", cands);
    const b = buildJudgePrompt(golden.categories["gcid:plumber"], "topic", cands);
    const c = buildJudgePrompt(cat, "topic", cands.slice(0, 2));
    expect(a.system).toBe(b.system);
    expect(a.categoryBlock).toBe(c.categoryBlock);
    expect(a.categoryBlock).not.toBe(b.categoryBlock);
  });
  test("no volatile content in the cached prefix", () => {
    const prefix = buildSystemPrompt() + buildCategoryBlock(cat);
    expect(prefix).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(prefix).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
  test("messages params put stable blocks first with two cache breakpoints and candidates last, uncached", () => {
    const p = toMessagesParams(buildJudgePrompt(cat, "keyword", cands), { model: "claude-haiku-4-5", cacheTtl: "1h" });
    expect(p.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(p.messages[0].content.map((b) => ("cache_control" in b ? "cached" : "plain"))).toEqual(["cached", "plain"]);
    expect(p.messages[0].content[1].text).toContain("LANE TO JUDGE: keyword");
    expect(JSON.stringify(p).indexOf("CATEGORY")).toBeLessThan(JSON.stringify(p).indexOf("CANDIDATES"));
  });
  test("candidate block carries volume, intent and local_pack; sorted by volume; capped", () => {
    const blk = buildCandidateBlock("keyword", cands);
    expect(blk).toContain("dispensary near me\t90500\tlocal\tY");
    expect(blk).toContain("live resin\t40500\tcommercial\t?");
    expect(blk.indexOf("dispensary near me")).toBeLessThan(blk.indexOf("what is thc"));
    expect(() => buildCandidateBlock("keyword", Array.from({ length: 301 }, (_, i) => ({ term: `t${i}`, volume: null, intent: null, local_pack: null })))).toThrow();
  });
  test("category block carries siblings (with shares_pack), prohibited phrases, entity types and the family menu", () => {
    const re = buildCategoryBlock(golden.categories["gcid:real_estate_agents"]);
    expect(re).toContain("shares_pack");
    expect(re).toContain("safe neighborhood");
    expect(re).toContain("professional, location, brand");
    expect(re).toContain("real_estate_agency");
    expect(re).toContain("brokerage");
  });
  test("batch request keys the call and chunking is balanced", () => {
    const br = toBatchRequest(buildJudgePrompt(cat, "keyword", cands), { gcid: cat.gcid, lane: "keyword", chunk: 2 }, { model: "claude-haiku-4-5" });
    expect(br.custom_id).toBe("gcid:cannabis_store|keyword|2");
    const chunks = chunkCandidates(Array.from({ length: 610 }, (_, i) => i));
    expect(chunks.length).toBe(3);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(300);
    expect(chunks.flat().length).toBe(610);
  });
});

// ---------------------------------------------------------------- golden set integrity
describe("golden set", () => {
  test("size, provenance and the named observations are present", () => {
    expect(golden.rows.length).toBeGreaterThanOrEqual(150);
    expect(golden.rows.filter((r) => r.provenance === "synthetic").length).toBeGreaterThanOrEqual(40);
    const has = (gcid: string, term: string, decision: string, reason: string) =>
      golden.rows.some((r) => r.gcid === gcid && r.term === term && r.expected.decision === decision && r.expected.reason_code === reason);
    expect(has("gcid:cannabis_store", "mint dispensary az", "exclude", "brand_or_business_name")).toBe(true);
    expect(has("gcid:cannabis_store", "muscle strains", "exclude", "ambiguous_meaning")).toBe(true);
    expect(has("gcid:cannabis_store", "dispensary that takes card near me", "keep", "keep")).toBe(true);
    expect(has("gcid:mexican_restaurant", "catacombs in paris france", "exclude", "ambiguous_meaning")).toBe(true);
    expect(has("gcid:real_estate_agents", "houses for sale near me", "keep", "keep")).toBe(true);
    expect(has("gcid:real_estate_agents", "realtor", "keep", "navigational_brand")).toBe(true);
    expect(has("gcid:real_estate_agents", "homes for sale", "exclude", "portal_owned")).toBe(true);
    expect(has("gcid:real_estate_agents", "real estate brokerage near me", "keep", "keep")).toBe(true);
    expect(has("gcid:real_estate_agents", "realtor agencies near me", "keep", "keep")).toBe(true);
    expect(has("gcid:mortgage_lender", "VA streamline refinance", "keep", "keep")).toBe(true);
    const vet = golden.rows.find((r) => r.term === "Veterans Benefits in Austin, TX")!;
    expect(vet.expected.decision).toBe("exclude");
    expect(vet.rationale).toContain("must NOT be matched");
  });
  test("observed row counts match the brief (24 cannabis, 28 mexican, 34 real estate)", () => {
    const n = (g: string) => golden.rows.filter((r) => r.gcid === g && r.provenance === "observed").length;
    expect(n("gcid:cannabis_store")).toBe(24);
    expect(n("gcid:mexican_restaurant")).toBe(28);
    expect(n("gcid:real_estate_agents")).toBe(34);
  });
  test("every gcid (and sibling gcid) JOINs to the canonical category list, never an isolated count", () => {
    const used = new Set<string>();
    for (const r of golden.rows) used.add(r.gcid);
    for (const c of Object.values(golden.categories)) {
      used.add(c.gcid);
      for (const s of c.siblings) used.add(s.gcid);
    }
    const unmatched = [...used].filter((g) => !(g in identityKeys));
    expect(unmatched).toEqual([]);
    for (const g of new Set(golden.rows.map((r) => r.gcid))) expect(g in golden.categories).toBe(true);
  });
  test("keys are unique and every label is legal", () => {
    const keys = new Set<string>();
    for (const r of golden.rows) {
      const k = `${r.gcid}|${r.lane}|${r.term.toLowerCase()}`;
      expect(keys.has(k)).toBe(false);
      keys.add(k);
      expect((REASON_CODES as readonly string[]).includes(r.expected.reason_code)).toBe(true);
      expect((LANES as readonly string[]).includes(r.lane)).toBe(true);
      expect(REASON_CODE_DEFS[r.expected.reason_code].decisions).toContain(r.expected.decision);
    }
  });
  test("the golden labels themselves pass the validator (a perfect mocked model produces valid output)", () => {
    for (const call of mockModel().calls) {
      const v = validateJudgeOutput(call.output, { lane: call.lane, category: golden.categories[call.gcid], candidates: call.candidates });
      expect({ call: `${call.gcid}/${call.lane}`, errors: v.errors }).toEqual({ call: `${call.gcid}/${call.lane}`, errors: [] });
    }
  });
});

// ---------------------------------------------------------------- harness
describe("evaluation harness", () => {
  test("perfect mocked model: 100% agreement, gate passes, even when outputs arrive as JSON strings", () => {
    for (const asString of [false, true]) {
      const r = evaluate(golden, mockModel(undefined, asString));
      expect(r.n).toBe(golden.rows.length);
      expect(r.agreement.strict).toBe(1);
      expect(r.agreement.decision).toBe(1);
      expect(r.exclude.precision).toBe(1);
      expect(r.exclude.recall).toBe(1);
      expect(r.false_keeps + r.false_excludes).toBe(0);
      expect(r.agreement.family).toBe(1);
      expect(r.disagreements.length).toBe(0);
      expect(r.gate.pass).toBe(true);
    }
  });
  test("a model that is wrong on ~10% fails the 95% gate and shows up in the confusion matrix", () => {
    // flip every 10th keep to an exclude/off_intent, and every 10th brand exclusion to keep
    let ki = 0, bi = 0;
    const res = mockModel((g, row) => {
      if (g.expected.decision === "keep" && ++ki % 6 === 0) return { ...row, decision: "exclude", reason_code: "off_intent", family: null, note: "mocked error" };
      if (g.expected.reason_code === "brand_or_business_name" && ++bi % 3 === 0) return { ...row, decision: "keep", reason_code: "keep", family: `${golden.categories[g.gcid].family_domains[0]}:${golden.categories[g.gcid].families[0].slug}`, note: "" };
      return row;
    });
    const r = evaluate(golden, res);
    expect(r.agreement.strict).toBeLessThan(0.95);
    expect(r.gate.pass).toBe(false);
    expect(r.false_excludes).toBeGreaterThan(0);
    expect(r.false_keeps).toBeGreaterThan(0);
    expect(r.reason_confusion.keep.off_intent).toBe(r.false_excludes);
    expect(r.reason_confusion.brand_or_business_name.keep).toBe(r.false_keeps);
    expect(r.exclude.precision!).toBeLessThan(1);
    expect(r.exclude.recall!).toBeLessThan(1);
    expect(renderReport(r)).toContain("PILOT EXIT GATE");
  });
  test("a single compliance_conflict row judged keep fails the gate even at ~99.6% agreement", () => {
    let done = false;
    const res = mockModel((g, row) => {
      if (!done && g.expected.reason_code === "compliance_conflict") {
        done = true;
        return { ...row, decision: "keep", reason_code: "keep", family: `${golden.categories[g.gcid].family_domains[0]}:${golden.categories[g.gcid].families[0].slug}`, note: "" };
      }
      return row;
    });
    const r = evaluate(golden, res);
    expect(r.agreement.strict).toBeGreaterThan(0.99);
    expect(r.gate.checks.find((c) => c.name.startsWith("compliance"))!.pass).toBe(false);
    expect(r.gate.pass).toBe(false);
  });
  test("decision-only gate is more lenient than strict: right decision, wrong reason code", () => {
    const res = mockModel((g, row) => (g.expected.reason_code === "other_category" ? { ...row, reason_code: "off_intent" } : row));
    expect(evaluate(golden, res, { gate: "strict" }).agreement.strict).toBeLessThan(1);
    expect(evaluate(golden, res, { gate: "decision" }).agreement.decision).toBe(1);
    expect(evaluate(golden, res, { gate: "decision" }).gate.pass).toBe(true);
    expect(evaluate(golden, res, { gate: "strict" }).by_reason_code.other_category.recall).toBe(0);
    expect(evaluate(golden, res).by_reason_code.off_intent.precision!).toBeLessThan(1);
  });
  test("malformed output: invalid calls are counted, their rows are scored <invalid>, nothing is silently accepted", () => {
    const res = mockModel();
    res.calls[0].output = "Sure! Here is the JSON: []"; // not JSON
    res.calls[1].output = (res.calls[1].output as JudgeRow[]).map((r, i) => (i === 0 ? { ...r, reason_code: "made_up_code" } : r));
    const r = evaluate(golden, res);
    expect(r.invalid_calls).toBe(2);
    expect(r.agreement.strict).toBeLessThan(1);
    expect(r.gate.pass).toBe(false);
    const bad = r.disagreements.filter((d) => d.predicted.reason_code === "<invalid>" || d.predicted.reason_code === "<missing>");
    expect(bad.length).toBeGreaterThan(0);
    expect(r.reason_confusion.keep["<invalid>"] + r.reason_confusion.keep["<missing>"] + Object.values(r.reason_confusion).reduce((a, m) => a + m["<invalid>"] + m["<missing>"], 0)).toBeGreaterThan(0);
  });
  test("missing rows count as disagreement and lower coverage", () => {
    const res = mockModel((g, row) => (g.id === golden.rows[0].id ? null : row));
    const r = evaluate(golden, res);
    expect(r.missing).toBe(1);
    expect(r.judged).toBe(golden.rows.length - 1);
    expect(r.agreement.strict).toBeCloseTo((golden.rows.length - 1) / golden.rows.length, 10);
  });
  test("precision/recall on a hand-computed 8-row set", () => {
    // expected: 4 exclude (brand x2, other x1, geo x1), 3 keep, 1 move
    const mk = (id: string, decision: "keep" | "exclude" | "move", reason: GoldenRow["expected"]["reason_code"], to: GoldenRow["expected"]["to_lane"] = null): GoldenRow => ({
      id, gcid: "gcid:plumber", lane: "keyword", term: id, local_pack: null, expected: { decision, reason_code: reason, to_lane: to },
      family_hint: decision === "keep" ? "plumbing:general_plumbing" : null, provenance: "synthetic", contested: false, note: "n",
    });
    const g: GoldenFile = {
      version: "t", categories: { "gcid:plumber": golden.categories["gcid:plumber"] },
      rows: [mk("b1", "exclude", "brand_or_business_name"), mk("b2", "exclude", "brand_or_business_name"), mk("o1", "exclude", "other_category"), mk("g1", "exclude", "geo_specific"),
        mk("k1", "keep", "keep"), mk("k2", "keep", "keep"), mk("k3", "keep", "keep"), mk("m1", "move", "informational", "question")],
    };
    const row = (term: string, decision: JudgeRow["decision"], reason: JudgeRow["reason_code"], extra: Partial<JudgeRow> = {}): JudgeRow => ({
      term, decision, reason_code: reason, family: decision === "keep" ? "plumbing:general_plumbing" : null, to_lane: null, note: decision === "keep" ? "" : "{city} x brand", ...extra,
    });
    // b1 right; b2 -> keep (false keep); o1 -> exclude but as off_intent (decision right, reason wrong); g1 right ({city} in note);
    // k1 right; k2 -> exclude/brand (false exclude); k3 right; m1 right
    const out: JudgeRow[] = [
      row("b1", "exclude", "brand_or_business_name"), row("b2", "keep", "keep"), row("o1", "exclude", "off_intent"), row("g1", "exclude", "geo_specific", { note: "plumbers {city}" }),
      row("k1", "keep", "keep"), row("k2", "exclude", "brand_or_business_name"), row("k3", "keep", "keep"), row("m1", "move", "informational", { to_lane: "question", note: "how-to" }),
    ];
    const r = evaluate(g, { calls: [{ gcid: "gcid:plumber", lane: "keyword", output: out }] });
    expect(r.judged).toBe(8);
    expect(r.agreement.decision).toBeCloseTo(6 / 8, 10); // b2 and k2 wrong
    expect(r.agreement.strict).toBeCloseTo(5 / 8, 10); // plus o1 wrong reason
    // exclude class: predicted exclude = b1, o1, g1, k2 (4); expected exclude = b1,b2,o1,g1 (4); tp = b1,o1,g1 (3)
    expect(r.exclude.tp).toBe(3);
    expect(r.exclude.precision).toBeCloseTo(3 / 4, 10);
    expect(r.exclude.recall).toBeCloseTo(3 / 4, 10);
    // not-keep class: expected b1,b2,o1,g1,m1 (5); predicted b1,o1,g1,k2,m1 (5); tp = b1,o1,g1,m1 (4)
    expect(r.not_keep.precision).toBeCloseTo(4 / 5, 10);
    expect(r.not_keep.recall).toBeCloseTo(4 / 5, 10);
    expect(r.false_keeps).toBe(1);
    expect(r.false_excludes).toBe(1);
    // per reason code
    expect(r.by_reason_code.brand_or_business_name).toMatchObject({ support: 2, predicted: 2, tp: 1 }); // b1 only (k2 is a wrong 'brand')
    expect(r.by_reason_code.brand_or_business_name.precision).toBeCloseTo(1 / 2, 10);
    expect(r.by_reason_code.brand_or_business_name.recall).toBeCloseTo(1 / 2, 10);
    expect(r.by_reason_code.other_category.recall).toBe(0);
    expect(r.by_reason_code.informational.recall).toBe(1);
    // confusion
    expect(r.reason_confusion.other_category.off_intent).toBe(1);
    expect(r.reason_confusion.brand_or_business_name.keep).toBe(1);
    expect(r.reason_confusion.keep.brand_or_business_name).toBe(1);
    expect(r.decision_confusion.exclude.keep).toBe(1);
    expect(r.decision_confusion.keep.exclude).toBe(1);
    expect(r.gate.pass).toBe(false);
  });
  test("move rows must match to_lane for a strict hit", () => {
    const res = mockModel((g, row) => (g.expected.to_lane === "question" ? { ...row, to_lane: "topic" } : row));
    const r = evaluate(golden, res);
    expect(r.agreement.decision).toBe(1);
    expect(r.agreement.strict).toBeLessThan(1);
  });
  test("exclude-contested option removes contested rows from the denominator", () => {
    const r = evaluate(golden, mockModel(), { excludeContested: true });
    expect(r.n).toBe(golden.rows.filter((g) => !g.contested).length);
  });
});

// ---------------------------------------------------------------- cost arithmetic
describe("cost model", () => {
  const sc: Scenario = { categories: 10, candidatesPerCategory: 500, perCall: 250, systemTokens: 5000, categoryTokens: 1500, systemHit: 0, categoryHit: 0, cacheTtl: "5m", caching: "none" };
  test("batch is half of standard; caching reduces input spend; compact output reduces output spend", () => {
    const h = PRICES[0];
    const a = cost(sc, h);
    expect(a.calls).toBe(20);
    expect(a.usdBatch).toBeCloseTo(a.usdStandard / 2, 10);
    const cached = cost({ ...sc, caching: "system", systemHit: 1 }, h);
    expect(cached.usdStandard).toBeLessThan(a.usdStandard);
    const compact = cost({ ...sc, outputScale: 0.5 }, h);
    expect(compact.outputTokens).toBeLessThan(a.outputTokens * 0.6);
  });
  test("token heuristic is chars/3.5", () => {
    expect(estimateTokens("x".repeat(350))).toBe(100);
  });
});
