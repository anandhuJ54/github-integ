/**
 * The Insights page's view model (srp/insights-page-schema, task 8): the one object the Insights screen reads, instead of constants.
 *
 * `insightsModel(data)` maps the API's response (`GET /srp/seat/professional/{id}/insights`) to it; `sampleInsightsModel` (components/happyflow/sample-insights.ts)
 * builds the same shape from the prototype's constants, so the sample page (no real seat) is unchanged. Pure: no React, no network.
 *
 * Unknown stays unknown: a missing section is null or an empty list, an unknown rating or average is a dash, never 0. Everything the person clicks (the
 * yes/no question, "Add a competitor", the selected spot) stays in the browser; nothing here writes.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/state/api/server-fn";
import { monthDay } from "@v3/srp/utils/home-model";
import type { Think } from "@v3/srp/components/happyflow/shell";

// --- the API response (contracts/srp/openapi.json, InsightsResponse) ---------------------------------------------

export type InsightsMetric =
  "search_views" | "maps_views" | "calls" | "directions" | "website_clicks" | "profile_views";
export type InsightsEngineName = "chatgpt" | "gemini" | "perplexity";

export type InsightsApi = {
  as_of: string;
  data: "mock" | "live" | null;
  ready: boolean;
  visibility:
    | {
        metric: InsightsMetric;
        value: number;
        period_days: number;
        source: string;
        trust_tier:
          | "self_declared"
          | "imported"
          | "platform_observed"
          | "authority_verified"
          | "owner_verified";
        source_line: string;
      }[]
    | null;
  map: {
    address: string | null;
    scanned_at: string | null;
    spots: number;
    top3: number;
    cells: {
      row: number;
      col: number;
      rank: number | null;
      leaders: { position: number; name: string | null; is_you: boolean }[];
    }[];
  } | null;
  ai: {
    cited: number;
    checked: number;
    engines: { engine: InsightsEngineName; cited: number; checked: number; note: string | null }[];
  } | null;
  competitors:
    | {
        place: number;
        name: string;
        is_you: boolean;
        rating: number | null;
        reviews: number | null;
        avg_position: number | null;
        is_leader: boolean;
      }[]
    | null;
  target: { name: string } | null;
  locked:
    { key: "map_rank_tracking" | "ai_citation_monitoring"; title: string; text: string }[] | null;
  notes: { title: string; body: string; cta: string; action: string }[] | null;
};

// --- the view model ---------------------------------------------------------------------------------------------

export type InsightsCell = {
  /** Row-major index, 0 to 48; the office pin is 24. */
  i: number;
  row: number;
  col: number;
  rank: number | null;
  /** What the cell shows: the rank, "20+" for no rank, "●" for the office pin. */
  label: string;
  bg: string;
  fg: string;
  leaders: { place: number; name: string; you: boolean }[];
};

export type InsightsModel = {
  mode: "sample" | "real";
  /** What remounts the screen when the seat changes, so one seat's selected spot and answer never carry over: the seat's id, or "sample". */
  seatKey: string;
  /** True when the numbers are mock data from the local database or the prototype's sample: the page says so. */
  isMock: boolean;
  visibility: { label: string; value: string; line: string }[];
  map: { heading: string; scanLabel: string; cells: InsightsCell[]; summary: string } | null;
  /** The scan's keyword and city under the competitor table ("mortgage lender near me" · Davenport, IA). */
  query: string;
  ai: {
    heading: string;
    rows: { name: string; share: string; note: string; cited: number; checked: number }[];
  } | null;
  competitors: { place: number; name: string; you: boolean; rating: string; avg: string }[];
  /** The market leader the page asks about; null when there is none. */
  target: string | null;
  locked: [string, string][];
  thinks: Think[];
};

/** The office pin: the centre of the 7 x 7 map (row 3, column 3). */
export const DEFAULT_SPOT = 24;
export const SCAN_KEYWORD = '"mortgage lender near me"';
const LABELS: Record<InsightsMetric, string> = {
  search_views: "Search views",
  maps_views: "Maps views",
  calls: "Calls",
  directions: "Directions",
  website_clicks: "Website clicks",
  profile_views: "Experience.com profile views",
};
const METRICS: InsightsMetric[] = [
  "search_views",
  "maps_views",
  "calls",
  "directions",
  "website_clicks",
  "profile_views",
];
const ENGINE_NAMES: Record<InsightsEngineName, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
};
const ENGINES: InsightsEngineName[] = ["chatgpt", "gemini", "perplexity"];

// --- helpers ------------------------------------------------------------------------------------------------------

/** The colour of a map spot: green for the top 3, yellow for 4 to 10, orange for 11 to 20, red beyond (and for no rank). */
export function rankColor(rank: number | null): { bg: string; fg: string } {
  if (rank !== null && rank <= 3) return { bg: "#34a853", fg: "#fff" };
  if (rank !== null && rank <= 10) return { bg: "#fbbc04", fg: "#202124" };
  if (rank !== null && rank <= 20) return { bg: "#fa7b17", fg: "#fff" };
  return { bg: "#ea4335", fg: "#fff" };
}

export const formatCount = (n: number): string => n.toLocaleString("en-US");
export const ratingText = (rating: number | null, reviews: number | null): string =>
  rating === null
    ? "—"
    : reviews === null
      ? rating.toFixed(1)
      : `${rating.toFixed(1)} (${reviews})`;
export const avgText = (avg: number | null): string => (avg === null ? "—" : avg.toFixed(1));

/** "Top 3 in 9 · 4–10 in 17 · 11–20 in 14 · 20+ in 9" from the ranks of the spots. */
export function summaryOf(ranks: (number | null)[]): string {
  const n = (f: (r: number | null) => boolean) => ranks.filter(f).length;
  return `Top 3 in ${n((r) => r !== null && r <= 3)} · 4–10 in ${n((r) => r !== null && r >= 4 && r <= 10)} · 11–20 in ${n((r) => r !== null && r >= 11 && r <= 20)} · 20+ in ${n((r) => r === null || r > 20)}`;
}

/** "Davenport, IA" from "100 Main St, Davenport, IA 52801"; "" when the address does not end that way. */
export function cityOf(address: string | null): string {
  const m = address ? /,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/.exec(address) : null;
  return m ? `${m[1].trim()}, ${m[2]}` : "";
}

export const queryLine = (city: string): string =>
  city ? `${SCAN_KEYWORD} · ${city}` : SCAN_KEYWORD;

// --- the mapping ----------------------------------------------------------------------------------------------------

/** The model for a ready response, or null when the seat has no Insights data yet (the caller then shows the sample view). */
export function insightsModel(
  data: InsightsApi | null | undefined,
  seatId = "",
): InsightsModel | null {
  if (!data || !data.ready || !data.visibility || !data.competitors) return null;
  const byMetric = new Map(data.visibility.map((v) => [v.metric, v]));
  const map = data.map;
  const cells: InsightsCell[] | null = map
    ? [...map.cells]
        .map((c) => {
          const i = c.row * 7 + c.col;
          return {
            i,
            row: c.row,
            col: c.col,
            rank: c.rank,
            label: i === DEFAULT_SPOT ? "●" : c.rank === null ? "20+" : String(c.rank),
            ...rankColor(c.rank),
            leaders: [...c.leaders]
              .sort((a, b) => a.position - b.position)
              .map((l) => ({
                place: l.position,
                name: l.is_you ? "You" : (l.name ?? ""),
                you: l.is_you,
              })),
          };
        })
        .sort((a, b) => a.i - b.i)
    : null;
  const street = map?.address?.split(",")[0].trim();
  const byEngine = new Map((data.ai?.engines ?? []).map((e) => [e.engine, e]));
  return {
    mode: "real",
    seatKey: seatId,
    isMock: data.data !== "live",
    visibility: METRICS.filter((m) => byMetric.has(m)).map((m) => ({
      label: LABELS[m],
      value: formatCount(byMetric.get(m)!.value),
      line: byMetric.get(m)!.source_line,
    })),
    map:
      map && cells
        ? {
            heading: `Map rank around ${street || "your office"}`,
            scanLabel:
              map.scanned_at && monthDay(map.scanned_at)
                ? `One-time scan · ${monthDay(map.scanned_at)}`
                : "",
            cells,
            summary: summaryOf(map.cells.map((c) => c.rank)),
          }
        : null,
    query: queryLine(cityOf(map?.address ?? null)),
    ai: data.ai
      ? {
          heading: `Named in ${data.ai.cited} of ${data.ai.checked} answers`,
          rows: ENGINES.filter((e) => byEngine.has(e)).map((e) => {
            const row = byEngine.get(e)!;
            return {
              name: ENGINE_NAMES[e],
              share: `${row.cited} of ${row.checked}`,
              note: row.note ?? "",
              cited: row.cited,
              checked: row.checked,
            };
          }),
        }
      : null,
    competitors: data.competitors.map((c) => ({
      place: c.place,
      name: c.is_you ? `${c.name} (you)` : c.name,
      you: c.is_you,
      rating: ratingText(c.rating, c.reviews),
      avg: avgText(c.avg_position),
    })),
    target: data.target?.name ?? null,
    locked: (data.locked ?? []).map((l) => [l.title, l.text]),
    thinks: (data.notes ?? []).map((n) => ({
      t: n.title,
      d: n.body,
      cta: n.cta,
      act: n.action as Think["act"],
    })),
  };
}

/** The cache key of a seat's Insights data: one entry per seat, so two seats never share data. */
export const insightsKey = (seatId: string) => ["seat-insights-v1", seatId] as const;

export function loadInsightsData(seatId: string): Promise<InsightsApi> {
  return api.get<InsightsApi>(`/srp/seat/professional/${encodeURIComponent(seatId)}/insights`);
}

/** The seat's Insights data. A failure (a Supabase session gets 501, a seat that is not yours 403) is not shown: the page falls back to the sample view. */
export function useInsightsApi(seatId: string, enabled = true) {
  return useQuery({
    queryKey: insightsKey(seatId),
    queryFn: () => loadInsightsData(seatId),
    enabled: enabled && Boolean(seatId),
    retry: false,
    staleTime: 60_000,
  });
}
