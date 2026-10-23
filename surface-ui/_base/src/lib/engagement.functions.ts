// Client shim: the server implementation moved to FastAPI (surface-api/conversion_agents).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

type Any = { from: (table: string) => { select: (cols: string) => any } };

export type CardAction = {
  phone: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
};

export type CompareEntity = {
  id: string;
  entityId: string;
  name: string;
  slug: string | null;
  entityType: string;
  photoUrl: string | null;
  categoryLabel: string | null;
  location: string | null;
  rating: number | null;
  reviewCount: number | null;
  rankScore: number | null;
  score: number | null;
  band: string | null;
  components: { label: string; value: string }[];
  specialties: string[];
  languages: string[];
  credentials: string[];
  actions: CardAction;
};

export const getCardActions = serverFn<Record<string, CardAction>>("conversion_agents", "getCardActions");
export const getCompareEntities = serverFn<CompareEntity[]>("conversion_agents", "getCompareEntities");
export const getRelatedSearches = serverFn<{ terms: string[] }>("conversion_agents", "getRelatedSearches");
