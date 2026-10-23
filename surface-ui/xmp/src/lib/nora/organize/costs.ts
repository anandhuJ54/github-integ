import type { ProviderCost } from "./types";

/*
 * Cost declarations for the organize source layer. List-rate ESTIMATES (USD per request) —
 * verify against the Oxylabs / Google contracts before using them for billing. They exist so
 * every handler states what it spent in telemetry instead of hiding it.
 */
export const UNIT_COST_USD = {
  /** Oxylabs Web Scraper API, source "universal", no JS render. */
  oxylabs_universal: 0.0015,
  /** Oxylabs Web Scraper API with render=html (JS rendering surcharge). */
  oxylabs_render: 0.003,
  /** Oxylabs Web Scraper API, source "google_search" parsed. */
  oxylabs_google_search: 0.0018,
  /** Google Places Text Search (New) with contact fields (Enterprise SKU). */
  google_places_text_search: 0.035,
} as const;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Same rule as scrapeWebsite: a no-proxy fetch only when FORCE_PROXY is explicitly "false". */
export function proxyForced(): boolean {
  return process.env["FORCE_PROXY"] !== "false";
}

export function sumCosts(costs: ProviderCost[]): { total_est_cost_usd: number; lines: ProviderCost[] } {
  const by = new Map<string, ProviderCost>();
  for (const c of costs) {
    const k = c.provider;
    const prev = by.get(k);
    if (prev) {
      prev.requests += c.requests;
      prev.est_cost_usd = round(prev.est_cost_usd + c.est_cost_usd);
    } else by.set(k, { ...c });
  }
  const lines = [...by.values()];
  return { total_est_cost_usd: round(lines.reduce((s, c) => s + c.est_cost_usd, 0)), lines };
}

/** Cost of one scrapeWebsite call from its result shape. */
export function scrapeCost(r: {
  crawl_method: string;
  rendered: boolean;
  attempted_render_fallback: boolean;
  oxylabs?: unknown;
  ok: boolean;
}): ProviderCost {
  // A successful direct fetch carries no oxylabs block (scrapeWebsite's direct branch).
  if (!r.oxylabs && r.ok && r.crawl_method === "direct" && !proxyForced())
    return { provider: "direct", requests: 1, est_cost_usd: 0 };
  const plain = r.attempted_render_fallback ? 1 : r.rendered ? 0 : 1;
  const rendered = r.rendered ? 1 : 0;
  return {
    provider: "oxylabs",
    requests: plain + rendered,
    est_cost_usd: round(
      plain * UNIT_COST_USD.oxylabs_universal + rendered * UNIT_COST_USD.oxylabs_render,
    ),
  };
}
