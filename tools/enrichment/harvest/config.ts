import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_BUDGET_USD } from "./budget";
import type { HarvestConfig, Mode } from "./types";

export const DEFAULT_BLOCKLIST = [
  "wikipedia.org",
  "youtube.com",
  "reddit.com",
  "quora.com",
  "pinterest.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
];

export const LEAN_MAX_SEEDS = 3;

export interface ResolvedConfig extends Required<HarvestConfig> {
  budget_usd: number;
}

const strList = (v: unknown, field: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`config.${field} must be an array of strings`);
  return [...new Set((v as string[]).map((s) => s.trim()).filter(Boolean))];
};

export function resolveConfig(raw: unknown, baseDir = process.cwd()): ResolvedConfig {
  if (typeof raw !== "object" || raw === null) throw new Error("config must be a JSON object");
  const c = raw as Record<string, unknown>;
  for (const f of ["gcid", "name", "out_dir"]) {
    if (typeof c[f] !== "string" || !(c[f] as string).trim()) throw new Error(`config.${f} is required`);
  }
  const mode = (c.mode ?? "full") as Mode;
  if (mode !== "full" && mode !== "lean") throw new Error("config.mode must be 'full' or 'lean'");
  const num = (f: string, d: number): number => {
    const v = c[f];
    if (v === undefined || v === null) return d;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`config.${f} must be a non-negative number`);
    return v;
  };
  const lean = mode === "lean";
  let seeds = strList(c.seeds, "seeds");
  if (!seeds.length) seeds = [(c.name as string).trim()];
  if (lean) seeds = seeds.slice(0, LEAN_MAX_SEEDS);
  return {
    gcid: (c.gcid as string).trim(),
    name: (c.name as string).trim(),
    aliases: strList(c.aliases, "aliases"),
    existing_keywords: strList(c.existing_keywords, "existing_keywords"),
    seeds,
    head_queries: strList(c.head_queries, "head_queries").slice(0, lean ? LEAN_MAX_SEEDS : Infinity),
    patterns: strList(c.patterns, "patterns"),
    stems: strList(c.stems, "stems").slice(0, lean ? LEAN_MAX_SEEDS : Infinity),
    out_dir: resolve(baseDir, c.out_dir as string),
    mode,
    budget_usd: num("budget_usd", DEFAULT_BUDGET_USD[mode]),
    domain_blocklist: c.domain_blocklist === undefined ? DEFAULT_BLOCKLIST : strList(c.domain_blocklist, "domain_blocklist"),
    top_domains: num("top_domains", 5),
    pack_keyword_limit: num("pack_keyword_limit", lean ? 15 : 40),
    intent_keyword_limit: num("intent_keyword_limit", lean ? 300 : 1000),
    suggestion_min_volume: num("suggestion_min_volume", 500),
    ranked_min_volume: num("ranked_min_volume", 1000),
    location_code: num("location_code", 2840),
    language_code: typeof c.language_code === "string" ? c.language_code : "en",
    pack_location_name: typeof c.pack_location_name === "string" ? c.pack_location_name : "Austin,Texas,United States",
  };
}

export function loadConfig(path: string, baseDir = process.cwd()): ResolvedConfig {
  return resolveConfig(JSON.parse(readFileSync(resolve(baseDir, path), "utf8")), baseDir);
}
