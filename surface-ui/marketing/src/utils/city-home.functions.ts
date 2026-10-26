// Client shim: the server implementation moved to FastAPI (surface-api/marketing).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/state/api/server-fn";
import type { Facets, SearchDoc } from "@v3/shared/public/utils/search";

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

export const getCityHome = serverFn<CityHomeData>("marketing", "getCityHome");
export const getCityMapPins = serverFn<{ pins: (SearchDoc & { categoryLabel: string | null })[] }>("marketing", "getCityMapPins");
