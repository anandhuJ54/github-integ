// A ready Insights API response for tests (srp/insights-page-schema): the shape of GET /srp/seat/professional/{id}/insights, for a seat whose every figure
// differs from the prototype's.
import type { InsightsApi } from "@v3/srp/utils/insights-model";

type Leader = { position: number; name: string | null; is_you: boolean };

/** 49 cells in row-major order. Ranks: the centre is 2, the ring around it 5, the next ring 14 and the rest "20+" (null). */
const rankOf = (r: number, c: number): number | null => {
  const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
  return ring === 0 ? 2 : ring === 1 ? 5 : ring === 2 ? 14 : null;
};
const RIVALS = ["Summit Credit Union", "Lakeside Lending", "Oakmont Mortgage"];
const leadersFor = (rank: number | null): Leader[] => {
  const names = [...RIVALS];
  const you = rank !== null && rank <= 3 ? rank : null;
  return [1, 2, 3].map((position) =>
    you === position
      ? { position, name: null, is_you: true }
      : { position, name: names.shift() as string, is_you: false },
  );
};

export const api = (over: Partial<InsightsApi> = {}): InsightsApi => ({
  as_of: "2026-10-27T10:00:00Z",
  data: "mock",
  ready: true,
  visibility: [
    {
      metric: "search_views",
      value: 2310,
      period_days: 30,
      source: "From Google",
      trust_tier: "imported",
      source_line: "Last 30 days · From Google",
    },
    {
      metric: "maps_views",
      value: 1420,
      period_days: 30,
      source: "From Google",
      trust_tier: "imported",
      source_line: "Last 30 days · From Google",
    },
    {
      metric: "calls",
      value: 0,
      period_days: 30,
      source: "From Google",
      trust_tier: "imported",
      source_line: "Last 30 days · From Google",
    },
    {
      metric: "directions",
      value: 73,
      period_days: 30,
      source: "From Google",
      trust_tier: "imported",
      source_line: "Last 30 days · From Google",
    },
    {
      metric: "website_clicks",
      value: 129,
      period_days: 30,
      source: "From Google",
      trust_tier: "imported",
      source_line: "Last 30 days · From Google",
    },
    {
      metric: "profile_views",
      value: 1000000,
      period_days: 30,
      source: "From Experience.com",
      trust_tier: "platform_observed",
      source_line: "Last 30 days · From Experience.com",
    },
  ],
  map: {
    address: "412 Main St, Bettendorf, IA 52722",
    scanned_at: "2026-10-09T09:00:00Z",
    spots: 49,
    top3: 1,
    cells: Array.from({ length: 49 }, (_, i) => {
      const row = Math.floor(i / 7);
      const col = i % 7;
      const rank = rankOf(row, col);
      return { row, col, rank, leaders: leadersFor(rank) };
    }),
  },
  ai: {
    cited: 3,
    checked: 6,
    engines: [
      { engine: "chatgpt", cited: 2, checked: 2, note: "Names you for local lender questions." },
      { engine: "gemini", cited: 1, checked: 2, note: null },
      { engine: "perplexity", cited: 0, checked: 2, note: "Does not mention you yet." },
    ],
  },
  competitors: [
    {
      place: 1,
      name: "Summit Credit Union",
      is_you: false,
      rating: 4.2,
      reviews: 88,
      avg_position: 1.9,
      is_leader: true,
    },
    {
      place: 2,
      name: "Harper Jones",
      is_you: true,
      rating: 4.1,
      reviews: 71,
      avg_position: 11.6,
      is_leader: false,
    },
    {
      place: 3,
      name: "Lakeside Lending",
      is_you: false,
      rating: null,
      reviews: null,
      avg_position: null,
      is_leader: false,
    },
  ],
  target: { name: "Summit Credit Union" },
  locked: [
    {
      key: "map_rank_tracking",
      title: "Map Rank tracking",
      text: "Re-scan every week and see the day you pass Summit",
    },
    {
      key: "ai_citation_monitoring",
      title: "AI-citation monitoring",
      text: "Track every answer that names you",
    },
  ],
  notes: [
    {
      title: "Summit wins on volume.",
      body: "88 reviews and 3 articles. Your 4.1 rating is below their 4.2.",
      cta: "Start publishing",
      action: "voce",
    },
    {
      title: "Perplexity never names you.",
      body: "Does not mention you yet.",
      cta: "Write an article",
      action: "voce",
    },
  ],
  ...over,
});
