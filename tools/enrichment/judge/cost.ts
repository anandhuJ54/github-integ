// Token and cost estimator for the judge. Offline arithmetic only: no model or network calls.
//
//   bun tools/enrichment/judge/cost.ts [--categories 4032] [--candidates 600] [--per-call 250]
//
// Token counts use a chars/3.5 heuristic (English prose + JSON/TSV, about +-15%). Verify the final
// numbers with the token-counting endpoint before committing a budget (README open question 8).
import { readFileSync } from "node:fs";
import { buildCandidateBlock, buildCategoryBlock, buildSystemPrompt, TARGET_CANDIDATES_PER_CALL } from "./prompt";
import type { CategoryContext, JudgeCandidate } from "./types";

export const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

export interface PriceSheet {
  name: string;
  /** USD per million tokens, standard (non-batch). */
  input: number;
  output: number;
}
// ASSUMPTIONS (list prices as of 2026-10; verify before budgeting):
//  - Haiku 4.5: $1 in / $5 out per MTok.   - Haiku 5.5: $0.10 in / $0.50 out per MTok for prompts <= 100K tokens.
//  - Message Batches API: 50% off input and output.
//  - Prompt caching multipliers on the input price: read 0.10x, write 1.25x (5 min TTL) or 2.0x (1 h TTL).
//  - Batch and cache discounts stack. Cache hits inside a batch are best-effort (requests run concurrently, in any order).
export const PRICES: PriceSheet[] = [
  { name: "haiku-4.5", input: 1.0, output: 5.0 },
  { name: "haiku-5.5", input: 0.1, output: 0.5 },
];
export const BATCH_DISCOUNT = 0.5;
export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_MULT = { "5m": 1.25, "1h": 2.0 } as const;

/** Output tokens per judged row. A row is ~125 chars of JSON (term, 4 keys, short note) -> ~40 tokens keep, ~50 exclude. */
export const OUT_TOKENS_KEEP = 42;
export const OUT_TOKENS_EXCLUDE = 52;
/** Share of candidates that are excluded/moved in noisy search-tool exports (assumption; the golden set is 54% non-keep). */
export const EXCLUDE_SHARE = 0.5;
/** Candidate line: term + volume + intent + local_pack, tab separated. */
export const CANDIDATE_LINE_TOKENS = 14;

export interface Scenario {
  categories: number;
  /** Total candidates per category across every call (all lanes judged). */
  candidatesPerCategory: number;
  perCall: number;
  systemTokens: number;
  categoryTokens: number;
  /** Fraction of calls that read the SYSTEM prefix from cache (batch caching is best-effort). */
  systemHit: number;
  /** Fraction of calls (after the first of a category) that read the CATEGORY prefix from cache. */
  categoryHit: number;
  cacheTtl: "5m" | "1h";
  caching: "none" | "system" | "system+category";
  /** Multiplier on output tokens (1 = object-per-row JSON as specified; ~0.5 = compact tuple encoding, README open question 4). */
  outputScale?: number;
}

export interface CostBreakdown {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  usdStandard: number;
  usdBatch: number;
  usdPerCategory: number;
  usdPerThousandCandidates: number;
}

export function outputTokensPerCall(perCall: number): number {
  return Math.round(perCall * (EXCLUDE_SHARE * OUT_TOKENS_EXCLUDE + (1 - EXCLUDE_SHARE) * OUT_TOKENS_KEEP)) + 8; // + brackets
}

export function cost(s: Scenario, price: PriceSheet): CostBreakdown {
  const callsPerCategory = Math.max(1, Math.ceil(s.candidatesPerCategory / s.perCall));
  const calls = s.categories * callsPerCategory;
  const candTokensPerCall = Math.round(Math.min(s.perCall, s.candidatesPerCategory) * CANDIDATE_LINE_TOKENS) + 60; // + lane header
  const outPerCall = Math.round(outputTokensPerCall(Math.min(s.perCall, s.candidatesPerCategory)) * (s.outputScale ?? 1));

  const w = CACHE_WRITE_MULT[s.cacheTtl];
  // Per-call blended input cost in "input-token equivalents".
  let sysEq = s.systemTokens;
  let catEq = s.categoryTokens;
  let cachedRead = 0;
  if (s.caching !== "none") {
    // System prefix: a hit reads at 0.1x, a miss writes at w.
    sysEq = s.systemTokens * (s.systemHit * CACHE_READ_MULT + (1 - s.systemHit) * w);
    cachedRead += s.systemTokens * s.systemHit;
  }
  if (s.caching === "system+category") {
    // Category prefix: first call of each category writes; later calls hit with probability categoryHit (else rewrite).
    const first = w;
    const later = s.categoryHit * CACHE_READ_MULT + (1 - s.categoryHit) * w;
    catEq = (s.categoryTokens * (first + (callsPerCategory - 1) * later)) / callsPerCategory;
    cachedRead += (s.categoryTokens * s.categoryHit * (callsPerCategory - 1)) / callsPerCategory;
  }
  const inputEqPerCall = sysEq + catEq + candTokensPerCall;
  const rawInputPerCall = s.systemTokens + s.categoryTokens + candTokensPerCall;
  const usdStandard = (calls * (inputEqPerCall * price.input + outPerCall * price.output)) / 1e6;
  const usdBatch = usdStandard * BATCH_DISCOUNT;
  return {
    calls,
    inputTokens: Math.round(calls * rawInputPerCall),
    outputTokens: calls * outPerCall,
    cachedReadTokens: Math.round(calls * cachedRead),
    usdStandard,
    usdBatch,
    usdPerCategory: usdBatch / s.categories,
    usdPerThousandCandidates: (usdBatch / (s.categories * s.candidatesPerCategory)) * 1000,
  };
}

// ------------------------------------------------------------------ sample prompt measurement
export interface PromptSizes {
  systemTokens: number;
  categoryTokens: { gcid: string; tokens: number }[];
  candidateTokensPerCall: number;
}

export function measure(categories: CategoryContext[], perCall = TARGET_CANDIDATES_PER_CALL): PromptSizes {
  const cands: JudgeCandidate[] = Array.from({ length: perCall }, (_, i) => ({ term: `sample term number ${i} near me`, volume: 1000 + i, intent: "commercial", local_pack: i % 3 === 0 ? true : null }));
  return {
    systemTokens: estimateTokens(buildSystemPrompt()),
    categoryTokens: categories.map((c) => ({ gcid: c.gcid, tokens: estimateTokens(buildCategoryBlock(c)) })),
    candidateTokensPerCall: estimateTokens(buildCandidateBlock("keyword", cands)),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const get = (n: string, d: number) => (argv.includes(`--${n}`) ? Number(argv[argv.indexOf(`--${n}`) + 1]) : d);
  const golden = JSON.parse(readFileSync(new URL("./golden/golden.json", import.meta.url), "utf8")) as { categories: Record<string, CategoryContext> };
  const sizes = measure(Object.values(golden.categories));
  const catMax = Math.max(...sizes.categoryTokens.map((c) => c.tokens));
  console.log(`system prompt: ~${sizes.systemTokens} tokens`);
  for (const c of sizes.categoryTokens) console.log(`category block ${c.gcid}: ~${c.tokens} tokens`);
  console.log(`candidate block (${TARGET_CANDIDATES_PER_CALL} terms): measured ~${sizes.candidateTokensPerCall} tokens (model assumes ${CANDIDATE_LINE_TOKENS}/term)`);
  console.log(`output per call: ~${outputTokensPerCall(TARGET_CANDIDATES_PER_CALL)} tokens (${EXCLUDE_SHARE * 100}% non-keep)`);
  console.log(`golden category blocks are small fixtures (max ${catMax}); real blocks (10+ siblings, 40-80 families) assumed 1500 tokens`);

  const categories = get("categories", 4032);
  const base: Omit<Scenario, "caching" | "systemHit" | "categoryHit" | "cacheTtl"> = {
    categories,
    candidatesPerCategory: get("candidates", 600),
    perCall: get("per-call", TARGET_CANDIDATES_PER_CALL),
    systemTokens: sizes.systemTokens,
    categoryTokens: 1500,
  };
  const variants: Array<[string, Scenario]> = [
    ["no caching", { ...base, caching: "none", systemHit: 0, categoryHit: 0, cacheTtl: "5m" }],
    ["system cached, 1h TTL, 80% hit", { ...base, caching: "system", systemHit: 0.8, categoryHit: 0, cacheTtl: "1h" }],
    ["system+category, 1h TTL, 80%/60% hit (expected)", { ...base, caching: "system+category", systemHit: 0.8, categoryHit: 0.6, cacheTtl: "1h" }],
    ["system+category, 1h TTL, 95%/95% hit (best)", { ...base, caching: "system+category", systemHit: 0.95, categoryHit: 0.95, cacheTtl: "1h" }],
    ["system only, 1h, 80% hit + compact output (x0.5)", { ...base, caching: "system", systemHit: 0.8, categoryHit: 0, cacheTtl: "1h", outputScale: 0.5 }],
  ];
  console.log(`\nScenario: ${categories} categories x ${base.candidatesPerCategory} candidates, ${base.perCall}/call, batch mode (-50%)`);
  for (const p of PRICES) {
    console.log(`\n${p.name}  ($${p.input} in / $${p.output} out per MTok standard)`);
    for (const [name, sc] of variants) {
      const c = cost(sc, p);
      console.log(`  ${name.padEnd(52)} calls ${c.calls}  in ${(c.inputTokens / 1e6).toFixed(1)}M  out ${(c.outputTokens / 1e6).toFixed(1)}M  batch $${c.usdBatch.toFixed(0)}  ($${c.usdPerCategory.toFixed(3)}/category, $${c.usdPerThousandCandidates.toFixed(3)}/1k candidates)`);
    }
  }
}
