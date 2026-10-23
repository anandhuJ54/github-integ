import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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

const documentSchema = z.object({
  id: z.string(),
  entity_type: z.enum(["professional", "location", "brand"]),
  entity_id: z.string(),
  slug: z.string().nullable(),
  gcid: z.string().nullable(),
  name: z.string(),
  title: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  rating: z.number().nullable(),
  review_count: z.number().nullable(),
  claimed: z.boolean().nullable(),
  rank_score: z.number().nullable(),
  completeness_pct: z.number().nullable(),
  photo_url: z.string().nullable(),
});

export const getSearchPresentation = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ gcid: z.string().max(160).nullable(), results: z.array(documentSchema).max(20) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { loadSearchPresentation } = await import("@/lib/search-presentation.server");
    return loadSearchPresentation(data.gcid, data.results as SearchDoc[]);
  });