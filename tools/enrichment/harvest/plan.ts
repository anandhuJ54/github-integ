// Planned calls + cost estimates (used by --dry-run and by the budget guard before each call).
// Prices are rough figures from DataForSEO's public pricing and are UNVERIFIED; real spend is
// always taken from each response's `cost` field, never from these estimates.
import type { ResolvedConfig } from "./config";
import { splitPatterns, chunk } from "./filters";
import { EP, MAX_INTENT_KEYWORDS, MAX_OVERVIEW_KEYWORDS } from "./endpoints";
import type { PlannedCall } from "./types";

const LABS_TASK = 0.01;
const LABS_ITEM = 0.0001;

export const est = {
  overview: (n: number) => LABS_TASK + LABS_ITEM * n,
  suggestions: (maxItems = 300) => LABS_TASK + LABS_ITEM * maxItems,
  organic: () => 0.004, // depth 20 = two result pages
  ranked: (maxItems = 700) => LABS_TASK + LABS_ITEM * maxItems,
  autocomplete: () => 0.002,
  intent: (n: number) => 0.001 + LABS_ITEM * n,
  pack: () => 0.002,
};

export const overviewKeywords = (cfg: ResolvedConfig): string[] =>
  [...new Set([...cfg.existing_keywords, cfg.name, ...cfg.aliases].map((k) => k.trim()).filter(Boolean))];

export const headQueries = (cfg: ResolvedConfig): string[] => (cfg.head_queries.length ? cfg.head_queries : [cfg.name]);

export const autocompleteStems = (cfg: ResolvedConfig): string[] => (cfg.stems.length ? cfg.stems : cfg.seeds);

export function planCalls(cfg: ResolvedConfig): PlannedCall[] {
  const calls: PlannedCall[] = [];
  const add = (step: PlannedCall["step"], endpoint: string, description: string, estimate_usd: number) =>
    calls.push({ step, endpoint, description, estimate_usd });

  for (const [i, c] of chunk(overviewKeywords(cfg), MAX_OVERVIEW_KEYWORDS).entries()) {
    add("existing_overview", EP.overview, `overview batch ${i + 1} (${c.length} keywords)`, est.overview(c.length));
  }
  for (const s of cfg.seeds) add("suggestions", EP.suggestions, `suggestions for "${s}"`, est.suggestions());
  for (const q of headQueries(cfg)) add("domains", EP.organic, `competitor SERP for "${q}"`, est.organic());
  if (cfg.mode === "full") {
    const groups = Math.max(1, splitPatterns(cfg.patterns).length);
    for (let d = 1; d <= cfg.top_domains; d++) {
      for (let g = 1; g <= groups; g++) {
        add("ranked", EP.ranked, `ranked keywords, competitor #${d}, pattern group ${g}/${groups}`, est.ranked());
      }
    }
  }
  for (const s of autocompleteStems(cfg)) add("autocomplete", EP.autocomplete, `autocomplete for "${s}"`, est.autocomplete());
  const intentCalls = Math.max(1, Math.ceil(cfg.intent_keyword_limit / MAX_INTENT_KEYWORDS));
  for (let i = 0; i < intentCalls; i++) {
    const n = Math.min(MAX_INTENT_KEYWORDS, cfg.intent_keyword_limit - i * MAX_INTENT_KEYWORDS);
    add("intent", EP.intent, `intent labels batch ${i + 1} (up to ${n} keywords)`, est.intent(n));
  }
  for (let i = 1; i <= cfg.pack_keyword_limit; i++) {
    add("serp_pack", EP.pack, `map-pack check, keyword ${i}/${cfg.pack_keyword_limit} (${cfg.pack_location_name})`, est.pack());
  }
  return calls;
}

export function formatPlan(cfg: ResolvedConfig, calls: PlannedCall[]): string {
  const lines = [`Dry run for ${cfg.gcid} (${cfg.name}), mode=${cfg.mode}. No calls will be made.`];
  const byStep = new Map<string, { n: number; usd: number }>();
  for (const c of calls) {
    const s = byStep.get(c.step) ?? { n: 0, usd: 0 };
    s.n++;
    s.usd += c.estimate_usd;
    byStep.set(c.step, s);
  }
  for (const c of calls) lines.push(`  [${c.step}] ${c.endpoint}  ${c.description}  ~$${c.estimate_usd.toFixed(4)}`);
  lines.push("", "Per step (worst-case estimate):");
  for (const [step, s] of byStep) lines.push(`  ${step.padEnd(18)} ${String(s.n).padStart(3)} calls  ~$${s.usd.toFixed(4)}`);
  const total = calls.reduce((s, c) => s + c.estimate_usd, 0);
  lines.push(
    `Estimated total (worst case): ~$${total.toFixed(4)}   budget cap: $${cfg.budget_usd.toFixed(2)}`,
    total > cfg.budget_usd ? "WARNING: worst-case estimate exceeds the cap; the guard will stop the run part way." : "Within cap.",
  );
  return lines.join("\n");
}
