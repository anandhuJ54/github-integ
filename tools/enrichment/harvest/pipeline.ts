// The harvest pipeline: seven steps, each writes one JSON file to out_dir.
// Steps are independent on disk, so --resume can skip any step whose file already exists.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetExceededError, type Budget } from "./budget";
import { DataForSeoClient, DataForSeoError } from "./client";
import type { ResolvedConfig } from "./config";
import {
  EP,
  MAX_INTENT_KEYWORDS,
  MAX_OVERVIEW_KEYWORDS,
  autocompleteBody,
  intentBody,
  organicBody,
  overviewBody,
  packBody,
  parseAutocomplete,
  parseIntent,
  parseOrganicDomains,
  parseOverview,
  parsePack,
  parseRanked,
  parseSuggestions,
  rankedBody,
  suggestionsBody,
  topDomains,
  type Loc,
} from "./endpoints";
import { chunk, splitPatterns } from "./filters";
import { autocompleteStems, est, headQueries, overviewKeywords } from "./plan";
import type { IntentItem, OrganicDomain, OverviewItem, RankedItem, StepName, SuggestionItem, Volume } from "./types";

export const OUTPUT_FILES: Record<StepName | "spend", string> = {
  existing_overview: "existing_overview.json",
  suggestions: "suggestions.json",
  domains: "domains.json",
  ranked: "ranked.json",
  autocomplete: "autocomplete.json",
  intent: "intent.json",
  serp_pack: "serp_pack.json",
  spend: "spend.json",
};

export interface RunOptions {
  client: DataForSeoClient;
  budget: Budget;
  resume?: boolean;
  log?: (msg: string) => void;
}

interface StepError {
  call: string;
  error: string;
}

const norm = (k: string) => k.trim().toLowerCase();

// Order by volume desc; null (unknown) volumes sort after known ones but are KEPT, never zeroed.
export const byVolumeDesc = <T extends { search_volume: Volume }>(a: T, b: T) =>
  (b.search_volume ?? -1) - (a.search_volume ?? -1);

// Merge by keyword: keep the highest known volume; stays null only if every source was null.
export function maxVolume(a: Volume, b: Volume): Volume {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function writeJson(dir: string, name: string, data: unknown) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2));
}

export function readJson<T = Record<string, unknown>>(dir: string, name: string): T | null {
  const p = join(dir, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}

const header = (cfg: ResolvedConfig) => ({ gcid: cfg.gcid, name: cfg.name, mode: cfg.mode, generated_at: new Date().toISOString() });

// Run one billed call; API/network errors are recorded and the step carries on. A budget abort is
// never swallowed.
async function attempt<T>(errors: StepError[], label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e;
    if (e instanceof DataForSeoError) {
      errors.push({ call: label, error: e.message });
      return undefined;
    }
    throw e;
  }
}

export interface Candidate {
  keyword: string;
  search_volume: Volume;
}

// Union of every keyword harvested so far, with the best known volume (null if never reported).
export function collectCandidates(dir: string): Candidate[] {
  const map = new Map<string, Candidate>();
  const add = (keyword: string, v: Volume) => {
    const k = norm(keyword);
    if (!k) return;
    const prev = map.get(k);
    map.set(k, { keyword: prev?.keyword ?? keyword, search_volume: maxVolume(prev?.search_volume ?? null, v) });
  };
  for (const it of readJson<{ keywords?: OverviewItem[] }>(dir, OUTPUT_FILES.existing_overview)?.keywords ?? []) add(it.keyword, it.search_volume);
  for (const it of readJson<{ items?: SuggestionItem[] }>(dir, OUTPUT_FILES.suggestions)?.items ?? []) add(it.keyword, it.search_volume);
  for (const it of readJson<{ items?: RankedItem[] }>(dir, OUTPUT_FILES.ranked)?.items ?? []) add(it.keyword, it.search_volume);
  for (const s of readJson<{ stems?: { suggestions: string[] }[] }>(dir, OUTPUT_FILES.autocomplete)?.stems ?? []) {
    for (const x of s.suggestions) add(x, null);
  }
  return [...map.values()].sort(byVolumeDesc);
}

export async function runHarvest(cfg: ResolvedConfig, opts: RunOptions): Promise<void> {
  const { client, budget, resume = false } = opts;
  const log = opts.log ?? (() => {});
  const dir = cfg.out_dir;
  const loc: Loc = { location_code: cfg.location_code, language_code: cfg.language_code };
  mkdirSync(dir, { recursive: true });

  const steps: [StepName, () => Promise<unknown>][] = [
    [
      "existing_overview",
      async () => {
        const errors: StepError[] = [];
        const wanted = overviewKeywords(cfg);
        const found = new Map<string, OverviewItem>();
        for (const batch of chunk(wanted, MAX_OVERVIEW_KEYWORDS)) {
          const r = await attempt(errors, "overview", async () =>
            parseOverview(await client.post("existing_overview", EP.overview, overviewBody(batch, loc), est.overview(batch.length))),
          );
          for (const it of r ?? []) found.set(norm(it.keyword), it);
        }
        // Keywords the API did not return are kept with null volume (not 0) and found:false.
        const keywords = wanted.map((k) => ({
          ...(found.get(norm(k)) ?? { keyword: k, search_volume: null, cpc: null, competition: null }),
          found: found.has(norm(k)),
        }));
        return { ...header(cfg), keywords, errors };
      },
    ],
    [
      "suggestions",
      async () => {
        const errors: StepError[] = [];
        const bySeed: { seed: string; items: SuggestionItem[] }[] = [];
        const merged = new Map<string, SuggestionItem>();
        for (const seed of cfg.seeds) {
          const r = await attempt(errors, `suggestions:${seed}`, async () =>
            parseSuggestions(await client.post("suggestions", EP.suggestions, suggestionsBody(seed, loc, cfg.suggestion_min_volume), est.suggestions())),
          );
          if (!r) continue;
          bySeed.push({ seed, items: r });
          for (const it of r) {
            const prev = merged.get(norm(it.keyword));
            merged.set(norm(it.keyword), prev ? { ...prev, search_volume: maxVolume(prev.search_volume, it.search_volume) } : it);
          }
        }
        return { ...header(cfg), min_volume: cfg.suggestion_min_volume, seeds: bySeed, items: [...merged.values()].sort(byVolumeDesc), errors };
      },
    ],
    [
      "domains",
      async () => {
        const errors: StepError[] = [];
        const queries: { keyword: string; domains: OrganicDomain[] }[] = [];
        for (const q of headQueries(cfg)) {
          const r = await attempt(errors, `organic:${q}`, async () =>
            parseOrganicDomains(await client.post("domains", EP.organic, organicBody(q, loc), est.organic())),
          );
          if (r) queries.push({ keyword: q, domains: r });
        }
        const t = topDomains(queries.map((q) => q.domains), cfg.domain_blocklist, cfg.top_domains);
        return { ...header(cfg), queries, counts: t.counts, top: t.top, blocked: t.blocked, errors };
      },
    ],
    [
      "ranked",
      async () => {
        if (cfg.mode === "lean") return { ...header(cfg), skipped: "lean mode", competitors: [], items: [], errors: [] };
        const errors: StepError[] = [];
        const top = readJson<{ top?: string[] }>(dir, OUTPUT_FILES.domains)?.top ?? [];
        const groups = splitPatterns(cfg.patterns);
        const patternGroups = groups.length ? groups : [[]];
        const merged = new Map<string, { keyword: string; search_volume: Volume; domains: { domain: string; rank: number | null; url: string | null }[] }>();
        for (const domain of top) {
          for (const [gi, group] of patternGroups.entries()) {
            const r = await attempt(errors, `ranked:${domain}:g${gi + 1}`, async () =>
              parseRanked(await client.post("ranked", EP.ranked, rankedBody(domain, loc, cfg.ranked_min_volume, group), est.ranked())),
            );
            for (const it of r ?? []) {
              const k = norm(it.keyword);
              const cur = merged.get(k) ?? { keyword: it.keyword, search_volume: null, domains: [] };
              cur.search_volume = maxVolume(cur.search_volume, it.search_volume);
              if (!cur.domains.some((d) => d.domain === domain)) cur.domains.push({ domain, rank: it.rank, url: it.url });
              merged.set(k, cur);
            }
          }
        }
        return {
          ...header(cfg),
          competitors: top,
          pattern_groups: groups,
          min_volume: cfg.ranked_min_volume,
          items: [...merged.values()].sort(byVolumeDesc),
          errors,
        };
      },
    ],
    [
      "autocomplete",
      async () => {
        const errors: StepError[] = [];
        const stems: { stem: string; suggestions: string[] }[] = [];
        for (const stem of autocompleteStems(cfg)) {
          const r = await attempt(errors, `autocomplete:${stem}`, async () =>
            parseAutocomplete(await client.post("autocomplete", EP.autocomplete, autocompleteBody(stem, loc), est.autocomplete())),
          );
          if (r) stems.push({ stem, suggestions: r }); // list order preserved: position matters
        }
        return { ...header(cfg), stems, errors };
      },
    ],
    [
      "intent",
      async () => {
        const errors: StepError[] = [];
        const cands = collectCandidates(dir)
          .slice(0, cfg.intent_keyword_limit)
          .map((c) => c.keyword);
        const labelled = new Map<string, IntentItem>();
        for (const batch of chunk(cands, MAX_INTENT_KEYWORDS)) {
          const r = await attempt(errors, "intent", async () =>
            parseIntent(await client.post("intent", EP.intent, intentBody(batch, cfg.language_code), est.intent(batch.length))),
          );
          for (const it of r ?? []) labelled.set(norm(it.keyword), it);
        }
        const vol = new Map(collectCandidates(dir).map((c) => [norm(c.keyword), c.search_volume]));
        const items = cands.map((k) => ({
          keyword: k,
          search_volume: vol.get(norm(k)) ?? null,
          label: labelled.get(norm(k))?.label ?? null,
          probability: labelled.get(norm(k))?.probability ?? null,
        }));
        return { ...header(cfg), requested: cands.length, items, errors };
      },
    ],
    [
      "serp_pack",
      async () => {
        const errors: StepError[] = [];
        const cands = collectCandidates(dir);
        const vol = new Map(cands.map((c) => [norm(c.keyword), c.search_volume]));
        // Head queries and seeds always get checked first, then the highest-volume keywords.
        const list: string[] = [];
        const seen = new Set<string>();
        for (const k of [...headQueries(cfg), ...cfg.seeds, ...cands.map((c) => c.keyword)]) {
          if (!seen.has(norm(k))) {
            seen.add(norm(k));
            list.push(k);
          }
        }
        const items: { keyword: string; search_volume: Volume; pack: boolean; titles: string[] }[] = [];
        for (const k of list.slice(0, cfg.pack_keyword_limit)) {
          const r = await attempt(errors, `pack:${k}`, async () =>
            parsePack(await client.post("serp_pack", EP.pack, packBody(k, cfg.pack_location_name, cfg.language_code), est.pack())),
          );
          if (r) items.push({ keyword: k, search_volume: vol.get(norm(k)) ?? null, pack: r.pack, titles: r.titles });
        }
        return { ...header(cfg), location: cfg.pack_location_name, device: "mobile", items, errors };
      },
    ],
  ];

  try {
    for (const [step, run] of steps) {
      const file = OUTPUT_FILES[step];
      if (resume && existsSync(join(dir, file))) {
        log(`skip ${step} (${file} exists, --resume)`);
        continue;
      }
      log(`run  ${step}`);
      const before = budget.spent;
      writeJson(dir, file, await run());
      log(`done ${step} (+$${(budget.spent - before).toFixed(4)})`);
    }
  } finally {
    budget.save(); // spend.json always reflects what was actually billed, even on abort
  }
}

export function formatCostSummary(budget: Budget): string {
  const s = budget.summary();
  const lines = ["Cost summary:"];
  for (const [step, usd] of Object.entries(s.by_step)) lines.push(`  ${step.padEnd(18)} $${usd.toFixed(4)}`);
  lines.push(`  ${"TOTAL".padEnd(18)} $${s.spent_usd.toFixed(4)} of $${s.limit_usd.toFixed(2)} cap (${s.calls.length} billed calls)`);
  return lines.join("\n");
}
