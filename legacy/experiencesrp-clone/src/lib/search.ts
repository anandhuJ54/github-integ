import { supabase } from "@/integrations/supabase/client";
import { withCoordinates } from "@/lib/geo-coords";

export type SearchKind = "professional" | "location" | "brand";

export type SearchDoc = {
  id: string;
  entity_type: SearchKind;
  entity_id: string;
  slug: string | null;
  gcid: string | null;
  name: string;
  title: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  review_count: number | null;
  claimed: boolean | null;
  rank_score: number | null;
  completeness_pct: number | null;
  photo_url: string | null;
};

export type Suggestion = {
  id: string;
  entity_type: SearchKind;
  slug: string | null;
  gcid: string | null;
  name: string;
  title: string | null;
  city: string | null;
  state: string | null;
  photo_url: string | null;
  rank_score: number | null;
};

export type Facets = {
  categories: { gcid: string; label: string; count: number }[];
  cities: { city: string; state: string | null; count: number }[];
  ratings: { r45: number; r40: number; r30: number };
  claimed: { yes: number; no: number };
  kinds: { entity_type: SearchKind; count: number }[];
};

export const EMPTY_FACETS: Facets = {
  categories: [],
  cities: [],
  ratings: { r45: 0, r40: 0, r30: 0 },
  claimed: { yes: 0, no: 0 },
  kinds: [],
};

export type SearchQuery = {
  q: string;
  gcid: string;
  loc: string;
  rating: number;
  claimed: "any" | "yes" | "no";
  sort: "relevance" | "rank" | "rating" | "reviews" | "complete";
  page: number;
  view: "list" | "map";
};

export const PAGE_SIZE = 20;

export const SORT_OPTIONS: { value: SearchQuery["sort"]; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "rank", label: "Search Rank Score" },
  { value: "rating", label: "Rating" },
  { value: "reviews", label: "Review volume" },
  { value: "complete", label: "Profile completeness" },
];

export const DEFAULT_QUERY: SearchQuery = {
  q: "",
  gcid: "",
  loc: "",
  rating: 0,
  claimed: "any",
  sort: "relevance",
  page: 1,
  view: "list",
};

function args(s: SearchQuery) {
  return {
    p_q: s.q.trim() || undefined,
    p_gcid: s.gcid || undefined,
    // The area chip carries "City, ST"; the index matches on the city name.
    p_loc: (s.loc.split(",")[0] ?? "").trim() || undefined,
    p_min_rating: s.rating > 0 ? s.rating : undefined,
    p_claimed: s.claimed === "any" ? undefined : s.claimed === "yes",
  };
}

/** ETL rows can carry HTML-escaped characters in names; render them faithfully. */
export function decodeName(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .replace(/&#0?34;|&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function runSearch(s: SearchQuery) {
  const base = args(s);
  const [rows, count, facets] = await Promise.all([
    supabase.rpc("search_docs", {
      ...base,
      p_sort: s.sort,
      p_limit: PAGE_SIZE,
      p_offset: (Math.max(1, s.page) - 1) * PAGE_SIZE,
    }),
    supabase.rpc("search_docs_count", base),
    supabase.rpc("search_docs_facets", base),
  ]);
  const named = ((rows.data ?? []) as SearchDoc[]).map((r) => ({ ...r, name: decodeName(r.name) }));
  // Precise geo is sparse, so fall back to the city centroid for map pins.
  const mapped = await withCoordinates(supabase as never, named).catch(() => named);
  return {
    results: mapped,
    total: Number(count.data ?? 0),
    facets: ((facets.data as Facets | null) ?? EMPTY_FACETS),
    error: rows.error?.message ?? count.error?.message ?? facets.error?.message ?? null,
  };
}

export async function suggest(q: string): Promise<Suggestion[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const { data } = await supabase.rpc("search_docs_suggest", { p_q: term, p_limit: 8 });
  return ((data ?? []) as Suggestion[]).map((r) => ({ ...r, name: decodeName(r.name) }));
}

export const KIND_LABEL: Record<SearchKind, string> = {
  professional: "Professional",
  location: "Location",
  brand: "Brand",
};

export function profilePath(d: { entity_type: SearchKind; slug: string | null }) {
  const prefix = d.entity_type === "professional" ? "p" : d.entity_type === "brand" ? "c" : "o";
  return `/${prefix}/${d.slug ?? ""}`;
}

export function locationLine(d: Pick<SearchDoc, "city" | "state" | "zip">) {
  return [d.city, d.state].filter(Boolean).join(", ") + (d.zip ? ` ${d.zip}` : "");
}

/** Zip/city clusters for results that have no coordinates. */
export function clusters(results: SearchDoc[]) {
  const map = new Map<string, { key: string; label: string; count: number }>();
  for (const r of results) {
    const key = r.zip || [r.city, r.state].filter(Boolean).join(", ") || "Unknown";
    const cur = map.get(key);
    map.set(key, {
      key,
      label: r.zip ? `${[r.city, r.state].filter(Boolean).join(", ")} ${r.zip}`.trim() : key,
      count: (cur?.count ?? 0) + 1,
    });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
