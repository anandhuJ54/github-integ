import { createClient } from "@supabase/supabase-js";
import { bandRanges, parseIndexingEnabled } from "@/lib/index-floor";

export type PartitionRow = {
  partition_key: string;
  min_score: number | null;
  max_score: number | null;
  changefreq: string | null;
  priority: number | null;
  url_count: number | null;
  last_built_at: string | null;
};

/** Held-below-floor pages are never emitted into an indexable sitemap. */
export const INDEXABLE_PARTITIONS = ["priority-high", "priority-mid", "priority-low"] as const;

function client() {
  const url = process.env["VITE_SUPABASE_URL"] ?? import.meta.env["VITE_SUPABASE_URL"];
  const key =
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  return createClient(String(url), String(key), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const SWITCH_TTL_MS = 60_000;
let switchCache: { value: boolean; at: number } | null = null;

/**
 * The site-wide indexing switch (exp_index_enabled(), SECURITY DEFINER, anon
 * callable). Cached per server instance for 60s. Any error -> OFF.
 */
/** Drop the cached value on this instance (after a super admin flips the switch). */
export function resetSiteIndexingCache() {
  switchCache = null;
}

export async function loadSiteIndexingEnabled(): Promise<boolean> {
  if (switchCache && Date.now() - switchCache.at < SWITCH_TTL_MS) return switchCache.value;
  let value = false;
  try {
    const { data, error } = await (client() as unknown as {
      rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
    }).rpc("exp_index_enabled");
    value = !error && parseIndexingEnabled(data);
  } catch {
    value = false;
  }
  switchCache = { value, at: Date.now() };
  return value;
}

export async function loadPartitions(): Promise<PartitionRow[]> {
  const { data } = await client()
    .from("exp_sitemap_partition")
    .select("partition_key,min_score,max_score,changefreq,priority,url_count,last_built_at")
    .order("min_score", { ascending: false });
  return (data ?? []) as PartitionRow[];
}

export type SitemapUrlRow = {
  url: string | null;
  lastmod: string | null;
  submitted_at: string | null;
  created_at: string | null;
};

/**
 * URLs for one indexable partition. Band thresholds come from the
 * exp_sitemap_partition rows (bandRanges), not constants; held and demo rows
 * never appear. The floor itself is applied upstream by exp_index_sync.
 */
export async function loadPartitionUrls(
  key: string,
  partitions: PartitionRow[],
  limit = 45000,
): Promise<SitemapUrlRow[]> {
  const range = bandRanges(partitions, INDEXABLE_PARTITIONS).get(key);
  if (!range) return [];
  let q = client()
    .from("exp_index_queue")
    .select("url,lastmod,submitted_at,created_at")
    .neq("state", "held")
    .or("is_demo.is.null,is_demo.eq.false")
    .not("url", "is", null);
  if (range.min !== null) q = q.gte("score", range.min);
  if (range.maxExclusive !== null) q = q.lt("score", range.maxExclusive);
  const { data } = await q
    .order("thoroughness_pct", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as SitemapUrlRow[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const abs = (origin: string, url: string) => (/^https?:/i.test(url) ? url : `${origin}${url}`);

export function sitemapIndexXml(origin: string, partitions: PartitionRow[], enabled = false) {
  const body = (enabled ? partitions : [])
    .filter((p) => (INDEXABLE_PARTITIONS as readonly string[]).includes(p.partition_key))
    .filter((p) => Number(p.url_count ?? 0) > 0)
    .map(
      (p) =>
        `  <sitemap><loc>${esc(origin)}/api/public/sitemap/${esc(p.partition_key)}.xml</loc>` +
        (p.last_built_at ? `<lastmod>${new Date(p.last_built_at).toISOString()}</lastmod>` : "") +
        `</sitemap>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export function urlSetXml(
  origin: string,
  partition: PartitionRow,
  rows: SitemapUrlRow[],
  enabled = false,
) {
  const body = (enabled ? rows : [])
    .filter((r) => !!r.url)
    .map((r) => {
      const lastmod = r.lastmod ?? r.submitted_at ?? r.created_at;
      return (
        `  <url><loc>${esc(abs(origin, r.url as string))}</loc>` +
        (lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : "") +
        (partition.changefreq ? `<changefreq>${esc(partition.changefreq)}</changefreq>` : "") +
        (partition.priority != null ? `<priority>${Number(partition.priority).toFixed(1)}</priority>` : "") +
        `</url>`
      );
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export const xmlResponse = (xml: string) =>
  new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" },
  });
