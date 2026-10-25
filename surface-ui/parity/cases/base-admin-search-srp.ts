/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import { api } from "@v3/ui/lib/server-fn";
import { DEFAULT_QUERY, runSearch, suggest, type SearchDoc, type SearchQuery } from "@v3/ui/lib/search";
import { loadAllArticles, loadAuthorArticles, loadFeaturedArticle, loadHubArticles } from "@v3/ui/lib/voce";
import { withCoordinates } from "@v3/ui/lib/geo-coords";

// _base libs served by admin (roles.tsx) and search (search.ts, voce.ts, geo-coords.ts).
// moved (surface audit 2026-10-25): geo-coords.ts now calls /search/geo/city-centroids (was /srp/...).
// Reads only: bootstrap_control_super_admin, the exp_admin_audit insert and the voce boost update
// are covered by compiled-SQL unit tests, never run here. The voce boost update moved to admin
// (surface audit 2026-10-25).
// Signed out: run the harness without PARITY_EMAIL/PARITY_PASSWORD; every case then compares the
// anon results (the grants case expects [] on both sides).
const SEARCH = "surface-ui/_base/src/lib/search.ts";
const VOCE = "surface-ui/_base/src/lib/voce.ts";
const GEO = "surface-ui/_base/src/lib/geo-coords.ts";

const byId = (rows: any[]) => [...(rows ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));

// --- roles.tsx -----------------------------------------------------------------------------------

type GrantRow = { id: string; role: string; scope_type: string; scope_id: string; is_primary: boolean };

/** roles.tsx grantScopeLabel() (unchanged by the port). */
function grantScopeLabel(g: GrantRow & { scope_label?: string }): string {
  if (g.scope_label) return g.scope_label;
  if (g.scope_type === "global") return "Platform Administration";
  if (g.scope_type === "entity") return "Entity workspace";
  if (g.scope_type === "control_node") return "Control node workspace";
  return g.scope_type;
}

/** roles.tsx (legacy) load() grants read + resolveScopeLabels(), verbatim, without the bootstrap
 * RPC (a write). Signed out the provider never mounted; the same read as anon returns []. */
async function legacyGrants(sb: any) {
  const uid = (await sb.auth.getUser()).data.user?.id;
  const q = sb.from("exp_control_grants").select("id, role, scope_type, scope_id, is_primary");
  const { data } = uid ? await q.eq("user_id", uid) : await q;
  const rows = (data ?? []) as GrantRow[];
  const entityIds = rows.filter((r) => r.scope_type === "entity").map((r) => r.scope_id);
  const nodeIds = rows.filter((r) => r.scope_type === "control_node").map((r) => r.scope_id);
  const names = new Map<string, string>();
  if (entityIds.length > 0) {
    const { data } = await sb.from("exp_entity").select("entity_id, display_name").in("entity_id", entityIds);
    for (const e of data ?? []) names.set(e.entity_id as string, e.display_name as string);
  }
  if (nodeIds.length > 0) {
    const { data } = await sb.from("exp_control_nodes").select("node_id, name").in("node_id", nodeIds);
    for (const n of data ?? []) names.set(n.node_id as string, n.name as string);
  }
  return rows.map((r) => ({
    ...r,
    scope_label: r.scope_type === "global" ? "Platform Administration" : (names.get(r.scope_id) ?? grantScopeLabel(r)),
  }));
}

/** roles.tsx (ported) load(): GET /admin/me/grants + resolveScopeLabels(payload). */
async function currentGrants() {
  const payload = await api
    .get<{ grants: GrantRow[]; entities: any[]; nodes: any[] }>("/admin/me/grants")
    .catch(() => ({ grants: [], entities: [], nodes: [] }));
  const names = new Map<string, string>();
  for (const e of payload.entities) names.set(e.entity_id, e.display_name);
  for (const n of payload.nodes) names.set(n.node_id, n.name);
  return payload.grants.map((r) => ({
    ...r,
    scope_label: r.scope_type === "global" ? "Platform Administration" : (names.get(r.scope_id) ?? grantScopeLabel(r)),
  }));
}

// --- search.ts -----------------------------------------------------------------------------------

const query = (over: Partial<SearchQuery>): SearchQuery => ({ ...DEFAULT_QUERY, ...over });

const search = (why: string, s: SearchQuery): ParityCase => ({
  name: `search: runSearch ${why}`,
  legacyModule: SEARCH,
  // legacy search.ts calls the legacy withCoordinates(client, docs)
  legacyDeps: [GEO],
  legacyExport: "runSearch",
  legacyArgs: [s],
  current: () => runSearch(s),
  // search_docs ties on the sort key come back in any order within the page
  normalize: (r: any) => ({ ...r, results: byId(r.results) }),
});

// --- geo-coords.ts -------------------------------------------------------------------------------

/** Docs without coordinates in cities that exist in several states (and one that doesn't). */
const DOCS: SearchDoc[] = [
  ["Springfield", "IL"],
  ["Springfield", "MO"],
  ["Springfield", "MA"],
  ["Portland", "OR"],
  ["Portland", "ME"],
  ["Austin", "TX"],
  ["Nowhere Town", "ZZ"],
].map(([city, state], i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  entity_type: "professional",
  entity_id: `00000000-0000-4000-8000-00000000010${i}`,
  slug: null,
  gcid: null,
  name: `Doc ${i}`,
  title: null,
  city: city!,
  state: state!,
  zip: null,
  lat: null,
  lng: null,
  rating: null,
  review_count: null,
  claimed: null,
  rank_score: null,
  completeness_pct: null,
  photo_url: null,
}));

export const cases: ParityCase[] = [
  {
    name: "roles: the signed-in user's grants with scope labels",
    legacy: (sb: any) => legacyGrants(sb),
    current: () => currentGrants(),
    // neither side orders the grants (the provider sorts by role rank, ties in any order)
    normalize: byId,
  },

  search("q + category + area (Springfield) + claimed, rank sort", query({
    q: "insurance",
    gcid: "gcid:insurance_agency",
    loc: "Springfield, IL",
    claimed: "no",
    sort: "rank",
  })),
  // ratings are sparse today: this one exercises p_min_rating (likely 0 rows on both sides)
  search("q + rating 4 + claimed yes, rating sort", query({
    q: "insurance",
    rating: 4,
    claimed: "yes",
    sort: "rating",
  })),
  search("q only, relevance, page 2", query({ q: "insurance", page: 2 })),
  search("category only, reviews sort", query({ gcid: "gcid:mortgage_broker", sort: "reviews" })),
  search("no match (empty facets, zero count)", query({ q: "zzqxjv nothing" })),
  {
    name: "search: suggest('insur')",
    legacyModule: SEARCH,
    legacyDeps: [GEO],
    legacyExport: "suggest",
    legacyArgs: ["insur"],
    current: () => suggest("insur"),
  },

  {
    name: "voce: loadAuthorArticles by id (Dana Whitfield)",
    legacyModule: VOCE,
    legacyExport: "loadAuthorArticles",
    legacyArgs: ["aaaaaaa2-0000-4000-8000-000000000001", "Dana Whitfield"],
    current: () => loadAuthorArticles("aaaaaaa2-0000-4000-8000-000000000001", "Dana Whitfield"),
  },
  {
    name: "voce: loadAuthorArticles by name only (demo row, unknown id)",
    legacyModule: VOCE,
    legacyExport: "loadAuthorArticles",
    legacyArgs: ["00000000-0000-4000-8000-000000000000", "Demo Agent"],
    current: () => loadAuthorArticles("00000000-0000-4000-8000-000000000000", "Demo Agent"),
  },
  {
    name: "voce: loadHubArticles category",
    legacyModule: VOCE,
    legacyExport: "loadHubArticles",
    legacyArgs: ["gcid:insurance_agency", null],
    current: () => loadHubArticles("gcid:insurance_agency", null),
  },
  {
    name: "voce: loadHubArticles category + topic",
    legacyModule: VOCE,
    legacyExport: "loadHubArticles",
    legacyArgs: ["gcid:mortgage_broker", "refinancing"],
    current: () => loadHubArticles("gcid:mortgage_broker", "refinancing"),
  },
  {
    name: "voce: loadFeaturedArticle('refinance', mortgage)",
    legacyModule: VOCE,
    legacyExport: "loadFeaturedArticle",
    legacyArgs: ["refinance", "gcid:mortgage_broker"],
    current: () => loadFeaturedArticle("refinance", "gcid:mortgage_broker"),
  },
  {
    name: "voce: loadFeaturedArticle(gcid only)",
    legacyModule: VOCE,
    legacyExport: "loadFeaturedArticle",
    legacyArgs: ["", "gcid:mortgage_broker"],
    current: () => loadFeaturedArticle("", "gcid:mortgage_broker"),
  },
  {
    name: "voce: loadAllArticles (boost manager; staff read all, others the published ones)",
    legacyModule: VOCE,
    legacyExport: "loadAllArticles",
    current: () => loadAllArticles(),
    // ties on published_on come back in any order
    normalize: byId,
  },

  {
    name: "geo: withCoordinates for cities in several states (Springfield, Portland)",
    legacy: async (sb: any) => {
      const run = (globalThis as any).__legacyModule as (p: string) => Promise<any>;
      const mod = await run(GEO);
      return mod.withCoordinates(sb, DOCS);
    },
    current: () => withCoordinates(DOCS),
  },
];
