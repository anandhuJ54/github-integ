// Shared types for the evidence-harvest tool. See README.md.

export type Mode = "full" | "lean";

export interface HarvestConfig {
  gcid: string;
  name: string;
  aliases: string[];
  existing_keywords: string[];
  seeds: string[];
  head_queries: string[];
  patterns: string[];
  stems: string[];
  out_dir: string;
  mode: Mode;
  // Optional overrides (all have defaults, see config.ts).
  budget_usd?: number;
  domain_blocklist?: string[];
  top_domains?: number;
  pack_keyword_limit?: number;
  intent_keyword_limit?: number;
  suggestion_min_volume?: number;
  ranked_min_volume?: number;
  location_code?: number;
  language_code?: string;
  pack_location_name?: string;
}

export interface Credentials {
  login: string;
  password: string;
}

// A keyword volume is `number | null`. null means "Google did not report a volume"
// (regulated categories such as cannabis) and is NEVER coerced to 0.
export type Volume = number | null;

export interface OverviewItem {
  keyword: string;
  search_volume: Volume;
  cpc: number | null;
  competition: number | null;
}

export interface SuggestionItem extends OverviewItem {
  keyword_difficulty: number | null;
}

export interface OrganicDomain {
  domain: string;
  rank: number | null;
  url: string | null;
}

export interface RankedItem {
  keyword: string;
  search_volume: Volume;
  rank: number | null;
  url: string | null;
}

export interface IntentItem {
  keyword: string;
  label: string | null;
  probability: number | null;
}

export interface PackResult {
  pack: boolean;
  titles: string[];
}

export type StepName =
  | "existing_overview"
  | "suggestions"
  | "domains"
  | "ranked"
  | "autocomplete"
  | "intent"
  | "serp_pack";

export interface PlannedCall {
  step: StepName;
  endpoint: string;
  description: string;
  estimate_usd: number;
}
