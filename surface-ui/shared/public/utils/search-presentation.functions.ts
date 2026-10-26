// Client shim: the server implementation moved to FastAPI (surface-api/search).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/state/api/server-fn";

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

export const getSearchPresentation = serverFn<SearchPresentationData>("search", "getSearchPresentation");
