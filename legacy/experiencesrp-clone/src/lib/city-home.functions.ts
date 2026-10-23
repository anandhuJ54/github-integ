import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { EMPTY_FACETS, decodeName, type Facets, type SearchDoc } from "@/lib/search";
import { withCoordinates } from "@/lib/geo-coords";

/**
 * City-scoped public reads for the consumer home.
 * Every value here is a live read; empty data renders as an empty state.
 */
function publicClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export const CITY_PAGE_SIZE = 10;

export type CityContext = {
  city: string;
  state: string | null;
  label: string;
  timezone: string | null;
  /** Visitor-local weekday, used for the "this weekend / this week" wording. */
  isWeekend: boolean;
  /**
   * City the results/collections/map are scoped to. Unincorporated detected
   * places carry little or no inventory, so discovery falls back to the nearest
   * city that does — the displayed location stays the detected place.
   */
  scopeCity: string;
  scopeLabel: string;
};

export type CityResult = SearchDoc & { nodeCount: number; categoryLabel: string | null };
export type CitySponsored = CityResult & { advertiserName: string | null };

export type CityCollection = {
  key: string;
  title: string;
  q: string;
  gcid: string;
  count: number;
};

export type CityArticle = {
  id: string;
  title: string;
  slug: string | null;
  topic: string | null;
  excerpt: string | null;
  authorName: string | null;
  publishedOn: string | null;
};

export type CityLink = { label: string; to: string; q?: string; gcid?: string; loc?: string };

export type CityHomeData = {
  context: CityContext;
  page: number;
  pageSize: number;
  total: number;
  results: CityResult[];
  sponsored: CitySponsored[];
  facets: Facets;
  categoryLabels: { gcid: string; label: string; count: number }[];
  collections: CityCollection[];
  articles: CityArticle[];
  guides: { id: string; title: string; slug: string | null; excerpt: string | null }[];
  nearby: { label: string; count: number }[];
  popular: string[];
};

type Query = {
  area?: string;
  page?: number;
  gcid?: string;
  rating?: number;
  claimed?: "any" | "yes" | "no";
};

const KEYWORDS: { key: string; title: string; words: string[] }[] = [
  {
    key: "eat",
    title: "Great Places to Eat Near You",
    words: ["restaurant", "cafe", "coffee", "pizza", "bakery", "bar", "grill", "food", "deli"],
  },
  {
    key: "home",
    title: "Trusted Home Services",
    words: [
      "plumb",
      "electric",
      "roof",
      "hvac",
      "heating",
      "landscap",
      "clean",
      "contractor",
      "handyman",
      "pest",
      "remodel",
      "garage",
    ],
  },
  {
    key: "todo",
    title: "Things to Do",
    words: ["park", "museum", "attraction", "tour", "golf", "theat", "brewery", "gym", "bowling", "zoo"],
  },
];

function splitArea(area: string) {
  const [city = "", state = ""] = area.split(",").map((part) => part.trim());
  return { city, state: state || null };
}

function weekendIn(timezone: string | null) {
  try {
    const day = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: timezone ?? undefined,
    }).format(new Date());
    return ["Fri", "Sat", "Sun"].includes(day);
  } catch {
    const day = new Date().getUTCDay();
    return day === 5 || day === 6 || day === 0;
  }
}

export const getCityHome = createServerFn({ method: "GET" })
  .inputValidator((input: Query | undefined) => input ?? {})
  .handler(async ({ data }): Promise<CityHomeData> => {
    const sb = publicClient();
    const db = sb as unknown as {
      rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }>;
    };
    const anyDb = sb as unknown as { from: (table: string) => { select: (cols: string) => any } };

    const { detectAreaFromRequest } = await import("@/lib/geo.server");
    const detected = await detectAreaFromRequest().catch(() => null);
    const areaLabel = data.area?.trim() || detected?.label || "";
    const { city, state } = splitArea(areaLabel);

    // Nearby is anchored on coarse coordinates, never on the detected place
    // name — unincorporated places are absent from the city reference.
    const { nearbyFor } = await import("@/lib/geo.functions");
    const nearby = city ? await nearbyFor(city, state, 8).catch(() => []) : [];

    // Scope discovery to the nearest city that actually carries inventory when
    // the detected place has none of its own.
    let scopeCity = city;
    let scopeLabel = areaLabel;
    if (city) {
      const own = await Promise.resolve(
        db.rpc("search_docs_count", { p_loc: city }),
      ).catch(() => ({ data: 0 }));
      if (Number(own.data ?? 0) === 0 && nearby.length) {
        scopeLabel = nearby[0]!.label;
        scopeCity = splitArea(scopeLabel).city;
      }
    }

    const context: CityContext = {
      city,
      state,
      label: areaLabel,
      timezone: detected?.timezone ?? null,
      isWeekend: weekendIn(detected?.timezone ?? null),
      scopeCity,
      scopeLabel,
    };

    const page = Math.max(1, Number(data.page ?? 1));
    const base = {
      p_loc: scopeCity || undefined,
      p_gcid: data.gcid || undefined,
      p_min_rating: data.rating && data.rating > 0 ? data.rating : undefined,
      p_claimed: !data.claimed || data.claimed === "any" ? undefined : data.claimed === "yes",
    };

    const [rowsRes, countRes, facetsRes, mapRes, guidesRes] = await Promise.all([
      Promise.resolve(
        db.rpc("search_docs", {
          ...base,
          p_sort: "rank",
          p_limit: CITY_PAGE_SIZE,
          p_offset: (page - 1) * CITY_PAGE_SIZE,
        }),
      ).catch(() => ({ data: [] })),
      Promise.resolve(db.rpc("search_docs_count", base)).catch(() => ({ data: 0 })),
      Promise.resolve(db.rpc("search_docs_facets", base)).catch(() => ({ data: null })),
      Promise.resolve(
        db.rpc("search_docs", { ...base, p_sort: "rank", p_limit: 60, p_offset: 0 }),
      ).catch(() => ({ data: [] })),
      Promise.resolve(
        anyDb
          .from("content_items")
          .select("id, title, slug, excerpt, published_at")
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(5),
      ).catch(() => ({ data: [] })),
    ]);

    const facets = (facetsRes.data as Facets | null) ?? EMPTY_FACETS;
    const categoryLabels = (facets.categories ?? []).map((c) => ({
      gcid: c.gcid,
      label: c.label,
      count: Number(c.count ?? 0),
    }));
    const labelByGcid = new Map(categoryLabels.map((c) => [c.gcid, c.label]));

    const rawRows = ((rowsRes.data ?? []) as SearchDoc[]).map((row) => ({
      ...row,
      name: decodeName(row.name),
    }));
    const mapRows = ((mapRes.data ?? []) as SearchDoc[]).map((row) => ({
      ...row,
      name: decodeName(row.name),
      categoryLabel: row.gcid ? labelByGcid.get(row.gcid) ?? null : null,
    }));

    // Node counts break Search Rank Score ties; read-only count from the graph.
    const nodeCounts = new Map<string, number>();
    const entityIds = rawRows.map((row) => row.entity_id).filter(Boolean);
    if (entityIds.length) {
      const nodesRes = await Promise.resolve(
        anyDb
          .from("graph_nodes")
          .select("entity_id")
          .in("entity_id", entityIds)
          .eq("is_active", true)
          .limit(5000),
      ).catch(() => ({ data: [] }));
      for (const row of (nodesRes.data ?? []) as { entity_id: string }[]) {
        nodeCounts.set(row.entity_id, (nodeCounts.get(row.entity_id) ?? 0) + 1);
      }
    }

    const results: CityResult[] = rawRows
      .map((row) => ({
        ...row,
        nodeCount: nodeCounts.get(row.entity_id) ?? 0,
        categoryLabel: row.gcid ? labelByGcid.get(row.gcid) ?? null : null,
      }))
      .sort(
        (a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0) || b.nodeCount - a.nodeCount,
      );

    /* --------------------------- sponsored placements -------------------------- */
    let sponsored: CitySponsored[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const slotsRes = await Promise.resolve(
      anyDb
        .from("exp_sponsored_slots")
        .select("gcid, geo_type, geo_value, position, advertiser_name, starts_on, ends_on")
        .eq("status", "active")
        .order("position", { ascending: true })
        .limit(50),
    ).catch(() => ({ data: [] }));
    const slots = ((slotsRes.data ?? []) as {
      gcid: string;
      geo_type: string | null;
      geo_value: string | null;
      position: number | null;
      advertiser_name: string | null;
      starts_on: string | null;
      ends_on: string | null;
    }[]).filter(
      (slot) =>
        (!slot.starts_on || slot.starts_on <= today) && (!slot.ends_on || slot.ends_on >= today),
    );
    if (slots.length && scopeCity) {
      const zips = slots.filter((s) => s.geo_type === "zip" && s.geo_value).map((s) => s.geo_value!);
      const docsRes = await Promise.resolve(
        anyDb
          .from("search_documents")
          .select(
            "id, entity_type, entity_id, slug, gcid, name, title, city, state, zip, lat, lng, rating, review_count, claimed, rank_score, completeness_pct, photo_url",
          )
          .ilike("city", scopeCity)
          .in("gcid", slots.map((s) => s.gcid))
          .limit(60),
      ).catch(() => ({ data: [] }));
      const docs = (docsRes.data ?? []) as SearchDoc[];
      sponsored = slots
        .flatMap((slot) => {
          const doc = docs.find(
            (d) =>
              d.gcid === slot.gcid &&
              (slot.geo_type !== "zip" || !slot.geo_value || d.zip === slot.geo_value) &&
              (!zips.length || true),
          );
          if (!doc) return [];
          return [
            {
              ...doc,
              name: decodeName(doc.name),
              nodeCount: 0,
              categoryLabel: doc.gcid ? labelByGcid.get(doc.gcid) ?? null : null,
              advertiserName: slot.advertiser_name ? decodeName(slot.advertiser_name) : null,
            },
          ];
        })
        .filter(
          (row, index, all) => all.findIndex((other) => other.id === row.id) === index,
        )
        .slice(0, 3);
    }

    /* ------------------------------- collections ------------------------------- */
    const match = (words: string[]) =>
      categoryLabels.filter((c) => words.some((word) => c.label.toLowerCase().includes(word)));
    const collections: CityCollection[] = [];
    for (const group of KEYWORDS) {
      const hits = match(group.words);
      if (!hits.length) continue;
      const top = hits[0]!;
      collections.push({
        key: group.key,
        title:
          group.key === "todo"
            ? `Things to Do This ${context.isWeekend ? "Weekend" : "Week"}`
            : group.title,
        q: group.key === "eat" ? `best ${top.label.toLowerCase()} near me` : group.title,
        gcid: hits.length === 1 ? top.gcid : "",
        count: hits.reduce((sum, hit) => sum + hit.count, 0),
      });
    }
    const professionalCount =
      (facets.kinds ?? []).find((kind) => kind.entity_type === "professional")?.count ?? 0;
    if (professionalCount > 0) {
      collections.splice(1, 0, {
        key: "experts",
        title: "Top-Rated Experts",
        q: "highly rated experts near me",
        gcid: "",
        count: Number(professionalCount),
      });
    }

    /* --------------------------------- articles -------------------------------- */
    let articles: CityArticle[] = [];
    if (mapRows.length) {
      const authorIds = mapRows.map((row) => row.entity_id).filter(Boolean).slice(0, 200);
      const articlesRes = await Promise.resolve(
        anyDb
          .from("exp_voce_article")
          .select("id, title, slug, topic, body_excerpt, author_name, published_on")
          .in("author_entity_id", authorIds)
          .not("published_on", "is", null)
          .order("published_on", { ascending: false })
          .limit(6),
      ).catch(() => ({ data: [] }));
      articles = ((articlesRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ""),
        slug: (row.slug as string | null) ?? null,
        topic: (row.topic as string | null) ?? null,
        excerpt: (row.body_excerpt as string | null) ?? null,
        authorName: (row.author_name as string | null) ?? null,
        publishedOn: (row.published_on as string | null) ?? null,
      }));
    }

    const popular = categoryLabels
      .slice(0, 6)
      .map((c) => `best ${c.label.toLowerCase()} in ${scopeCity || "your area"}`);

    return {
      context,
      page,
      pageSize: CITY_PAGE_SIZE,
      total: Number(countRes.data ?? 0),
      results,
      sponsored,
      facets,
      categoryLabels,
      collections,
      articles,
      guides: ((guidesRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ""),
        slug: (row.slug as string | null) ?? null,
        excerpt: (row.excerpt as string | null) ?? null,
      })),
      nearby,
      popular,
    };
  });

/** Coordinates for the map card, scoped to the same city as the list. */
export const getCityMapPins = createServerFn({ method: "GET" })
  .inputValidator((input: { area?: string; gcid?: string } | undefined) => input ?? {})
  .handler(
    async ({
      data,
    }): Promise<{ pins: (SearchDoc & { categoryLabel: string | null })[] }> => {
      const sb = publicClient();
      const db = sb as unknown as {
        rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }>;
      };
      const { city, state } = splitArea(data.area ?? "");
      // Same nearest-inventory scope as the list, so pins are never empty.
      let scopeCity = city;
      if (city) {
        const own = await Promise.resolve(
          db.rpc("search_docs_count", { p_loc: city }),
        ).catch(() => ({ data: 0 }));
        if (Number(own.data ?? 0) === 0) {
          const { nearbyFor } = await import("@/lib/geo.functions");
          const nearby = await nearbyFor(city, state, 1).catch(() => []);
          if (nearby.length) scopeCity = splitArea(nearby[0]!.label).city;
        }
      }
      const base = { p_loc: scopeCity || undefined, p_gcid: data.gcid || undefined };
      const [rowsRes, facetsRes] = await Promise.all([
        Promise.resolve(
          db.rpc("search_docs", { ...base, p_sort: "rank", p_limit: 80, p_offset: 0 }),
        ).catch(() => ({ data: [] })),
        Promise.resolve(db.rpc("search_docs_facets", base)).catch(() => ({ data: null })),
      ]);
      const labels = new Map(
        ((facetsRes.data as Facets | null)?.categories ?? []).map((c) => [c.gcid, c.label]),
      );
      return {
        pins: (
          await withCoordinates(
            sb as never,
            (rowsRes.data ?? []) as SearchDoc[],
          ).catch(() => (rowsRes.data ?? []) as SearchDoc[])
        )
          .filter((row) => row.lat !== null && row.lng !== null)
          .map((row) => ({
            ...row,
            name: decodeName(row.name),
            categoryLabel: row.gcid ? labels.get(row.gcid) ?? null : null,
          })),
      };
    },
  );
