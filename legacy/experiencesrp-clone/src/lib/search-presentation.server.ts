import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SearchDoc } from "@/lib/search";

export type FacetDefinition = {
  attributeId: string;
  label: string;
  options: string[];
};

export type FacetGroup = { name: string; facets: FacetDefinition[] };
export type SearchEnrichment = { reviewQuote: string | null; tags: string[] };

export type SearchPresentationData = {
  facetGroups: FacetGroup[];
  enrichments: Record<string, SearchEnrichment>;
};

function publicClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

function strings(value: unknown): string[] {
  const labelFor = (item: unknown): string | null => {
    if (typeof item === "string" || typeof item === "number") return String(item).trim() || null;
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const candidate = record.label ?? record.name ?? record.value ?? record.title;
    return typeof candidate === "string" || typeof candidate === "number"
      ? String(candidate).trim() || null
      : null;
  };
  const values = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).map(([key, item]) => labelFor(item) ?? key)
      : [];
  return values.map(labelFor).filter((item): item is string => Boolean(item)).slice(0, 8);
}

export async function loadSearchPresentation(
  gcid: string | null | undefined,
  results: SearchDoc[],
): Promise<SearchPresentationData> {
  const sb = publicClient();
  const db = sb as unknown as {
    from: (table: string) => {
      select: (columns: string) => any;
    };
  };

  const facetQuery = gcid
    ? db
        .from("exp_search_facets_v")
        .select("attribute_id,facet_group,facet_label,value_options")
        .eq("gcid", gcid)
    : Promise.resolve({ data: [] });

  const reviewQueries = results.slice(0, 20).map(async (doc) => {
    const entityType = doc.entity_type === "professional" ? "professional" : "organization";
    const response = await db
      .from("reviews")
      .select("body")
      .eq("entity_type", entityType)
      .eq("entity_id", doc.entity_id)
      .not("body", "is", null)
      .order("is_verified", { ascending: false })
      .order("review_date", { ascending: false })
      .limit(1);
    const row = (response.data ?? [])[0] as { body?: string | null } | undefined;
    return [doc.id, row?.body?.trim() || null] as const;
  });

  const [facetResponse, reviewPairs] = await Promise.all([
    Promise.resolve(facetQuery).catch(() => ({ data: [] })),
    Promise.all(reviewQueries).catch(() => [] as (readonly [string, string | null])[]),
  ]);

  const facetRows = (facetResponse.data ?? []) as {
    attribute_id: string;
    facet_group: string | null;
    facet_label: string | null;
    value_options: unknown;
  }[];
  const grouped = new Map<string, FacetDefinition[]>();
  for (const row of facetRows) {
    const group = row.facet_group?.trim() || "More filters";
    const facets = grouped.get(group) ?? [];
    facets.push({
      attributeId: row.attribute_id,
      label: row.facet_label?.trim() || row.attribute_id,
      options: strings(row.value_options),
    });
    grouped.set(group, facets);
  }

  const enrichments: Record<string, SearchEnrichment> = {};
  for (const doc of results) enrichments[doc.id] = { reviewQuote: null, tags: [] };
  for (const [id, quote] of reviewPairs) {
    if (enrichments[id]) enrichments[id] = { ...enrichments[id], reviewQuote: quote };
  }

  if (gcid && results.length) {
    const mapResponse = await db
      .from("exp_registry_attribute_map")
      .select("attribute_id,node_slug")
      .eq("gcid", gcid);
    const mapRows = (mapResponse.data ?? []) as { attribute_id: string; node_slug: string }[];
    const facetIds = new Set(facetRows.map((row) => row.attribute_id));
    const slugs = mapRows.filter((row) => facetIds.has(row.attribute_id)).map((row) => row.node_slug);
    if (slugs.length) {
      const registryResponse = await db
        .from("exp_vertical_node_registry")
        .select("id,node_slug")
        .eq("gcid", gcid)
        .in("node_slug", slugs);
      const registryRows = (registryResponse.data ?? []) as { id: string; node_slug: string }[];
      const nodeIds = registryRows.map((row) => row.id);
      if (nodeIds.length) {
        const entityIds = results.slice(0, 20).map((doc) => doc.entity_id);
        const nodesResponse = await db
          .from("graph_nodes")
          .select("entity_id,node_registry_id,title")
          .in("entity_id", entityIds)
          .in("node_registry_id", nodeIds)
          .eq("is_active", true)
          .not("title", "is", null)
          .limit(200);
        const byEntity = new Map<string, string[]>();
        for (const row of (nodesResponse.data ?? []) as {
          entity_id: string;
          title: string | null;
        }[]) {
          const value = row.title?.trim();
          if (!value) continue;
          const tags = byEntity.get(row.entity_id) ?? [];
          if (!tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) tags.push(value);
          byEntity.set(row.entity_id, tags.slice(0, 4));
        }
        for (const doc of results) {
          if (enrichments[doc.id]) {
            enrichments[doc.id] = {
              ...enrichments[doc.id],
              tags: byEntity.get(doc.entity_id) ?? [],
            };
          }
        }
      }
    }
  }

  return {
    facetGroups: [...grouped.entries()].map(([name, facets]) => ({ name, facets })),
    enrichments,
  };
}