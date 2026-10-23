// Request builders and response parsers for each DataForSEO endpoint used by the harvest.
// Response shapes are modelled on DataForSEO's v3 docs and have NOT been verified against the live
// API (this tool was written without network access). Parsers are deliberately tolerant: every
// field is optional and a missing/odd value becomes null, never 0.
import { rankedFilter } from "./filters";
import type {
  IntentItem,
  OrganicDomain,
  OverviewItem,
  PackResult,
  RankedItem,
  SuggestionItem,
  Volume,
} from "./types";

export const EP = {
  overview: "dataforseo_labs/google/keyword_overview/live",
  suggestions: "dataforseo_labs/google/keyword_suggestions/live",
  organic: "serp/google/organic/live/regular",
  ranked: "dataforseo_labs/google/ranked_keywords/live",
  autocomplete: "serp/google/autocomplete/live/advanced",
  intent: "dataforseo_labs/google/search_intent/live",
  pack: "serp/google/organic/live/advanced",
} as const;

export const MAX_OVERVIEW_KEYWORDS = 700;
export const MAX_INTENT_KEYWORDS = 1000;

export interface Loc {
  location_code: number;
  language_code: string;
}

// ---- request bodies (each is the single task; the client wraps it in an array) ----

export const overviewBody = (keywords: string[], loc: Loc) => ({ keywords, ...loc });

export const suggestionsBody = (keyword: string, loc: Loc, minVolume: number) => ({
  keyword,
  ...loc,
  limit: 300,
  include_seed_keyword: true,
  order_by: ["keyword_info.search_volume,desc"],
  filters: [["keyword_info.search_volume", ">=", minVolume]],
});

export const organicBody = (keyword: string, loc: Loc) => ({ keyword, ...loc, depth: 20 });

export const rankedBody = (target: string, loc: Loc, minVolume: number, patternGroup: string[]) => ({
  target,
  ...loc,
  limit: 700,
  order_by: ["keyword_data.keyword_info.search_volume,desc"],
  filters: rankedFilter(minVolume, patternGroup),
});

export const autocompleteBody = (keyword: string, loc: Loc) => ({ keyword, ...loc });

export const intentBody = (keywords: string[], language_code: string) => ({ keywords, language_code });

export const packBody = (keyword: string, locationName: string, language_code: string) => ({
  keyword,
  location_name: locationName,
  language_code,
  device: "mobile",
  depth: 10,
});

// ---- parsing ----

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const items = (result: unknown): Rec[] => {
  const i = rec(result).items;
  return Array.isArray(i) ? (i as Rec[]) : [];
};

// null stays null. Never coerce a missing volume to 0.
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
export const volume = (v: unknown): Volume => num(v);

export function parseOverview(result: unknown): OverviewItem[] {
  return items(result).flatMap((it) => {
    const keyword = str(it.keyword);
    if (!keyword) return [];
    const info = rec(it.keyword_info);
    return [{ keyword, search_volume: volume(info.search_volume), cpc: num(info.cpc), competition: num(info.competition) }];
  });
}

export function parseSuggestions(result: unknown): SuggestionItem[] {
  return items(result).flatMap((it) => {
    const keyword = str(it.keyword);
    if (!keyword) return [];
    const info = rec(it.keyword_info);
    return [
      {
        keyword,
        search_volume: volume(info.search_volume),
        cpc: num(info.cpc),
        competition: num(info.competition),
        keyword_difficulty: num(rec(it.keyword_properties).keyword_difficulty),
      },
    ];
  });
}

export function parseOrganicDomains(result: unknown): OrganicDomain[] {
  return items(result).flatMap((it) => {
    const domain = str(it.domain);
    if (it.type !== "organic" || !domain) return [];
    return [{ domain: domain.toLowerCase(), rank: num(it.rank_group), url: str(it.url) }];
  });
}

export function parseRanked(result: unknown): RankedItem[] {
  return items(result).flatMap((it) => {
    const kd = rec(it.keyword_data);
    const keyword = str(kd.keyword);
    if (!keyword) return [];
    const serp = rec(rec(it.ranked_serp_element).serp_item);
    return [
      {
        keyword,
        search_volume: volume(rec(kd.keyword_info).search_volume),
        rank: num(serp.rank_group),
        url: str(serp.url),
      },
    ];
  });
}

// Order is preserved: position in the list is itself a signal.
export function parseAutocomplete(result: unknown): string[] {
  return items(result).flatMap((it) => {
    const s = str(it.suggestion);
    return s ? [s] : [];
  });
}

export function parseIntent(result: unknown): IntentItem[] {
  return items(result).flatMap((it) => {
    const keyword = str(it.keyword);
    if (!keyword) return [];
    const ki = rec(it.keyword_intent);
    return [{ keyword, label: str(ki.label), probability: num(ki.probability) }];
  });
}

export function parsePack(result: unknown): PackResult {
  const titles: string[] = [];
  let pack = false;
  for (const it of items(result)) {
    if (it.type !== "local_pack" && it.type !== "map") continue;
    pack = true;
    const own = str(it.title);
    if (own) titles.push(own);
    if (Array.isArray(it.items)) {
      for (const sub of it.items) {
        const t = str(rec(sub).title);
        if (t) titles.push(t);
      }
    }
  }
  return { pack, titles: [...new Set(titles)] };
}

// ---- competitor domains ----

export function isBlocked(domain: string, blocklist: string[]): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return blocklist.some((b) => {
    const x = b.toLowerCase().replace(/^www\./, "");
    return d === x || d.endsWith(`.${x}`);
  });
}

export interface DomainCount {
  domain: string;
  count: number;
}

export function topDomains(perQuery: OrganicDomain[][], blocklist: string[], n: number) {
  const counts = new Map<string, number>();
  const blocked = new Set<string>();
  for (const q of perQuery) {
    // Count each domain once per query so one SERP with many pages from a site does not dominate.
    for (const d of new Set(q.map((x) => x.domain.replace(/^www\./, "")))) {
      if (isBlocked(d, blocklist)) blocked.add(d);
      else counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  const ranked: DomainCount[] = [...counts].map(([domain, count]) => ({ domain, count }));
  ranked.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
  return { counts: ranked, top: ranked.slice(0, n).map((d) => d.domain), blocked: [...blocked].sort() };
}
