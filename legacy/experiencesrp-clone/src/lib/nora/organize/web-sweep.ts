import { toE164 } from "@/routes/api/public/-disco-site-contract";
import { UNIT_COST_USD } from "./costs";
import { withOxylabs, type IntegrationResult } from "./integrations";
import { hostOf, platformOf, registrableDomain } from "./parse";
import type { ProviderCost } from "./types";

/*
 * webSweep — open-web search for the entity ("tap the ones that are you"). Source: Oxylabs
 * Google Search (parsed), through the same Oxylabs client the ETL uses (oxylabsRaw in
 * disco-webscraper-worker.ts), behind the stub contract (withOxylabs → NotConfigured when the
 * credentials are absent). The category is only a display name in the query — no
 * per-category logic. Candidates carry dedupe hints; the user (and dedupe_match) decide.
 */

export type SweepInput = {
  categoryName: string | null;
  entityName: string;
  geo: string | null;
  /** Entity's own site, phone and already-known URLs, for the dedupe hints. */
  siteUrl?: string | null;
  phone?: string | null;
  knownUrls?: string[];
};

export type SweepCandidate = {
  url: string;
  title: string;
  snippet: string;
  rank: number;
  query: string;
  hints: {
    platform: string | null;
    /** canonical host+path key; equal keys are the same page. */
    dedupe_key: string;
    /** Index (in candidates) of an earlier result with the same dedupe_key. */
    duplicate_of: number | null;
    same_site: boolean;
    already_known: boolean;
    /** Share of the entity's name tokens present in title + snippet (0..1). */
    name_match: number;
    geo_match: boolean;
    phone_match: boolean;
    /** Ordering score only — not a confidence. */
    score: number;
  };
};

export type SweepOutput = { queries: string[]; candidates: SweepCandidate[]; cost: ProviderCost };

export const SWEEP_RESULTS_PER_QUERY = 10;

export const tokens = (s: string | null | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);

export function tokenShare(needle: string | null | undefined, hay: string): number {
  const n = [...new Set(tokens(needle))];
  if (!n.length) return 0;
  const h = new Set(tokens(hay));
  return Math.round((n.filter((t) => h.has(t)).length / n.length) * 100) / 100;
}

export function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return url.toLowerCase();
  }
}

/** Pure: the sweep's queries. */
export function sweepQueries(i: Pick<SweepInput, "categoryName" | "entityName" | "geo">): string[] {
  const name = i.entityName.trim();
  const geo = i.geo?.trim() ?? "";
  const q = [`"${name}" ${geo}`.trim()];
  if (i.categoryName?.trim()) q.push(`${name} ${i.categoryName.trim()} ${geo}`.trim());
  return q;
}

type Organic = { url?: string; title?: string; desc?: string; pos?: number };

/** Pure: Oxylabs parsed google_search content → organic rows. */
export function organicRows(body: unknown): Organic[] {
  const r = (body as { results?: { content?: { results?: { organic?: Organic[] } } }[] })?.results?.[0];
  return Array.isArray(r?.content?.results?.organic) ? r!.content!.results!.organic! : [];
}

/** Pure: rows from every query → candidates with dedupe hints, best first. */
export function buildCandidates(
  rowsByQuery: { query: string; rows: Organic[] }[],
  i: SweepInput,
): SweepCandidate[] {
  const siteReg = i.siteUrl ? registrableDomain(hostOf(i.siteUrl) ?? "") : null;
  const known = new Set((i.knownUrls ?? []).map(dedupeKey));
  const phoneDigits = toE164(i.phone ?? "")?.slice(-10) ?? null;
  const geoTokens = tokens(i.geo).filter((t) => t.length >= 3);
  const out: SweepCandidate[] = [];
  const firstByKey = new Map<string, number>();
  for (const { query, rows } of rowsByQuery) {
    for (const row of rows) {
      if (!row.url || !/^https?:\/\//i.test(row.url)) continue;
      const title = String(row.title ?? "");
      const snippet = String(row.desc ?? "");
      const text = `${title} ${snippet}`;
      const key = dedupeKey(row.url);
      const host = hostOf(row.url);
      const name_match = tokenShare(i.entityName, text);
      const geo_match = geoTokens.length > 0 && geoTokens.some((t) => tokens(text).includes(t));
      const phone_match = !!phoneDigits && text.replace(/\D/g, "").includes(phoneDigits);
      const same_site = !!siteReg && !!host && registrableDomain(host) === siteReg;
      const already_known = known.has(key);
      const dup = firstByKey.get(key);
      const hints = {
        platform: platformOf(row.url),
        dedupe_key: key,
        duplicate_of: dup ?? null,
        same_site,
        already_known,
        name_match,
        geo_match,
        phone_match,
        score: Math.round((name_match * 2 + (geo_match ? 1 : 0) + (phone_match ? 2 : 0) + (same_site ? 1 : 0)) * 100) / 100,
      };
      if (dup == null) firstByKey.set(key, out.length);
      out.push({ url: row.url, title, snippet, rank: Number(row.pos ?? 0), query, hints });
    }
  }
  return out;
}

export async function webSweep(i: SweepInput): Promise<IntegrationResult<SweepOutput>> {
  const queries = sweepQueries(i);
  return withOxylabs(async () => {
    const { oxylabsRaw } = await import("@/routes/api/public/disco-webscraper-worker");
    const rowsByQuery = await Promise.all(
      queries.map(async (query) => {
        const payload: Record<string, unknown> = {
          source: "google_search",
          query,
          parse: true,
          limit: SWEEP_RESULTS_PER_QUERY,
        };
        // Geo rides in the query text; Oxylabs geo_location wants its own canonical format.
        const res = await oxylabsRaw(payload, 12_000);
        if (res.httpStatus >= 400) throw new Error(`Oxylabs google_search HTTP ${res.httpStatus}`);
        return { query, rows: organicRows(res.body) };
      }),
    );
    return {
      queries,
      candidates: buildCandidates(rowsByQuery, i),
      cost: {
        provider: "oxylabs",
        requests: queries.length,
        est_cost_usd: Math.round(queries.length * UNIT_COST_USD.oxylabs_google_search * 1e6) / 1e6,
      },
    };
  });
}
