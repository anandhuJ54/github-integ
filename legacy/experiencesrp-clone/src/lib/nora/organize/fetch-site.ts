import { scrapeCost } from "./costs";
import { parseCandidateFacts } from "./parse";
import type { CandidateFacts, OwnedCandidate, ProviderCost } from "./types";

/*
 * fetchSite / hop2 — fetch through Abdul's shared fetch layer (scrapeWebsite in
 * disco-webscraper-worker.ts: Oxylabs with render fallback + looksBlocked; a plain fetch only
 * for crawl_method "direct" when FORCE_PROXY=false) and parse with parseCandidateFacts.
 * Read-only toward our DB.
 */

export type CrawlMethod = "server_crawl" | "needs_proxy" | "needs_js_api" | "direct";

export type FetchSiteResult = {
  ok: boolean;
  status_code: number | null;
  rendered: boolean;
  error: string | null;
  facts: CandidateFacts | null;
  cost: ProviderCost;
};

/** Pages one hop2 call follows at most (each is a paid fetch through Oxylabs by default). */
export const HOP2_CAP = 4;

export async function fetchSite(
  url: string,
  opts: { crawlMethod?: CrawlMethod; entityName?: string | null } = {},
): Promise<FetchSiteResult> {
  const { scrapeWebsite } = await import("@/routes/api/public/disco-webscraper-worker");
  const r = await scrapeWebsite({ url, crawl_method: opts.crawlMethod ?? "direct" });
  const cost = scrapeCost(r);
  const facts = r.content
    ? parseCandidateFacts(r.content, {
        sourceUrl: url,
        resolvedUrl: r.resolved_url,
        fetchedAt: new Date().toISOString(),
        entityName: opts.entityName,
        statusCode: r.status_code,
      })
    : null;
  return {
    ok: r.ok,
    status_code: r.status_code,
    rendered: r.rendered,
    error: r.error ?? null,
    facts,
    cost,
  };
}

/** Normalises hop2 input: OwnedCandidate objects or bare URL strings. */
export function ownedUrls(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const x of list) {
    const u = typeof x === "string" ? x : (x as Partial<OwnedCandidate> | null)?.url;
    if (typeof u === "string" && /^https?:\/\//i.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

/** One hop to the entity's other owned properties, same fetch + parse. */
export async function hop2(
  candidates: (string | OwnedCandidate)[],
  opts: { crawlMethod?: CrawlMethod; entityName?: string | null; cap?: number } = {},
): Promise<{ pages: (FetchSiteResult & { url: string })[]; skipped: string[] }> {
  const urls = ownedUrls(candidates);
  const cap = opts.cap ?? HOP2_CAP;
  const take = urls.slice(0, cap);
  const pages = await Promise.all(
    take.map(async (url) => {
      try {
        return { url, ...(await fetchSite(url, opts)) };
      } catch (e) {
        return {
          url,
          ok: false,
          status_code: null,
          rendered: false,
          error: e instanceof Error ? e.message : String(e),
          facts: null,
          cost: { provider: "oxylabs", requests: 0, est_cost_usd: 0 } as ProviderCost,
        };
      }
    }),
  );
  return { pages, skipped: urls.slice(cap) };
}
