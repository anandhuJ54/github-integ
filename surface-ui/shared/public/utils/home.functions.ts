// Client shim: the server implementation moved to FastAPI (surface-api/marketing).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/state/api/server-fn";
import type { SearchDoc } from "@v3/shared/public/utils/search";

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

export const getHomeData = serverFn<HomeData>("marketing", "getHomeData");
