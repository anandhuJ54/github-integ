import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SearchDoc } from "@/lib/search";

/**
 * Public (unauthenticated) reads for the search-first home page.
 * Everything here is a live read — an empty table renders as an empty state,
 * never as placeholder content.
 */
function publicClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export type HomeCategory = { gcid: string; label: string; count: number };
export type HomeCity = { city: string; state: string | null; count: number };
export type HomeTrend = { label: string; gcid: string; loc: string; count: number };
export type HomeGuide = {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string | null;
  gcid: string | null;
  published_at: string | null;
};
export type HomeTopic = {
  id: string;
  title: string;
  slug: string | null;
  topic: string | null;
  gcid: string | null;
  excerpt: string | null;
};

export type HomeData = {
  categories: HomeCategory[];
  shortcutCategories: HomeCategory[];
  cities: HomeCity[];
  trending: HomeTrend[];
  guides: HomeGuide[];
  topics: HomeTopic[];
  /** Silent IP→city hint from edge headers; null when the platform sends none. */
  detectedLocation: string | null;
  /** Total live indexed search documents, derived from facet entity counts. */
  authorityCount: number;
  totals: { professionals: number; locations: number; brands: number };
  results: SearchDoc[];
};

type Facets = {
  categories?: { gcid: string; label: string; count: number }[];
  cities?: { city: string; state: string | null; count: number }[];
  kinds?: { entity_type: string; count: number }[];
};

export const getHomeData = createServerFn({ method: "GET" }).handler(async (): Promise<HomeData> => {
  const sb = publicClient();
  const db = sb as unknown as { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> };
  const { detectAreaFromRequest } = await import("@/lib/geo.server");
  const detectedLocation = (await detectAreaFromRequest())?.label ?? null;

  const [facetsRes, shortcutsRes, guidesRes, topicsRes, resultsRes] = await Promise.all([
    Promise.resolve(db.rpc("search_docs_facets", {})).catch(() => ({ data: null })),
    sb
      .from("gbp_categories")
      .select("gcid, display_name")
      .in("gcid", [
        "gcid:restaurant",
        "gcid:coffee_shop",
        "gcid:plumber",
        "gcid:dentist",
        "gcid:auto_repair_shop",
        "gcid:tourist_attraction",
        "gcid:real_estate_agents",
        "gcid:veterinarian",
        "gcid:spa",
      ]),
    sb
      .from("content_items")
      .select("id, title, slug, excerpt, gcid, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(6),
    sb
      .from("exp_voce_article")
      .select("id, title, slug, topic, gcid, body_excerpt, published_on")
      .not("published_on", "is", null)
      .order("published_on", { ascending: false })
      .limit(6),
    Promise.resolve(
      db.rpc("search_docs", {
        p_loc: detectedLocation || undefined,
        p_sort: "rating",
        p_limit: 8,
        p_offset: 0,
      }),
    ).catch(() => ({ data: [] })),
  ]);

  const facets = (facetsRes.data as Facets | null) ?? {};
  const categories: HomeCategory[] = (facets.categories ?? [])
    .filter((c) => c.gcid && c.label)
    .map((c) => ({ gcid: c.gcid, label: c.label, count: Number(c.count ?? 0) }))
    .sort((a, b) => b.count - a.count);
  const cities: HomeCity[] = (facets.cities ?? [])
    .filter((c) => c.city)
    .map((c) => ({ city: c.city, state: c.state ?? null, count: Number(c.count ?? 0) }));

  const kinds = new Map((facets.kinds ?? []).map((k) => [k.entity_type, Number(k.count ?? 0)]));
  const authorityCount = Array.from(kinds.values()).reduce((sum, count) => sum + count, 0);
  const categoryCounts = new Map(categories.map((category) => [category.gcid, category.count]));
  const shortcutCategories: HomeCategory[] = ((shortcutsRes.data ?? []) as { gcid: string; display_name: string }[])
    .filter((category) => category.gcid && category.display_name)
    .map((category) => ({
      gcid: category.gcid,
      label: category.display_name,
      count: categoryCounts.get(category.gcid) ?? 0,
    }));

  const topCategory = categories[0];
  const trending: HomeTrend[] = topCategory
    ? cities.slice(0, 8).map((c) => ({
        label: `${topCategory.label} in ${[c.city, c.state].filter(Boolean).join(", ")}`,
        gcid: topCategory.gcid,
        loc: [c.city, c.state].filter(Boolean).join(", "),
        count: c.count,
      }))
    : [];

  const guideRows = (guidesRes.data ?? []) as Record<string, unknown>[];
  const topicRows = (topicsRes.data ?? []) as Record<string, unknown>[];

  return {
    categories,
    shortcutCategories,
    cities: cities.slice(0, 8),
    trending,
    guides: guideRows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      slug: (r.slug as string | null) ?? null,
      excerpt: (r.excerpt as string | null) ?? null,
      gcid: (r.gcid as string | null) ?? null,
      published_at: (r.published_at as string | null) ?? null,
    })),
    topics: topicRows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      slug: (r.slug as string | null) ?? null,
      topic: (r.topic as string | null) ?? null,
      gcid: (r.gcid as string | null) ?? null,
      excerpt: (r.body_excerpt as string | null) ?? null,
    })),
    detectedLocation,
    authorityCount,
    totals: {
      professionals: kinds.get("professional") ?? 0,
      locations: kinds.get("location") ?? 0,
      brands: kinds.get("brand") ?? 0,
    },
    results: ((resultsRes.data ?? []) as SearchDoc[]).map((row) => ({
      ...row,
      name: String(row.name ?? "")
        .replace(/&#0?34;|&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&amp;|&#0?38;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    })),
  };
});
