/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import { api } from "@v3/state/api/server-fn";
import { loadExpertiseGraph, type GraphKind } from "@v3/search/utils/expertise-graph";

// graph entity pages: /control-graph (signed in, super_admin for the users list), the
// /:category/:city/:professional page, and the public /p|o|c/:slug/graph expertise graph.
// moved (surface audit 2026-10-25): the profile and expertise graph pages are search's now (API
// still graph's); the claims tab (claims, entities-lite, users) is admin's /claims, under
// /admin/control-claims.
// Reads only: the governed writes (exp_claim_adjudicate, exp_ctrl_create_node,
// exp_ctrl_update_node) are covered by compiled-SQL unit tests, never run here.
const EXPERTISE = "surface-ui/graph/src/lib/expertise-graph.ts"; // legacy path at the parity ref (now in search)

// Lists the page doesn't order (or whose ties come back in any order) are compared in one order.
const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);
const byId = (rows: any[]) => [...(rows ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
/** Expertise graph: own nodes and edges come back unordered (no ORDER BY on either side). */
const graphNorm = (r: any) => (r ? { ...r, nodes: byId(r.nodes), edges: byId(r.edges) } : r);

/** routes/_authenticated/$category.$city.$professional.tsx loadProfile(): its reads, verbatim,
 * in the API's shape (the slug checks and @graph building stay in the page). */
async function legacyProfile(sb: any, slug: string) {
  const { data: prof, error } = await sb.from("v_professional_profile").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!prof) return { profile: null };
  const profId = prof.id as string;
  const [reviewsRes, contentRes, credsRes, proRes, graphNodesRes, taxRes, txRes, aggRes] = await Promise.all([
    sb.from("reviews").select("id, rating, title, body, reviewer_name, review_date, reply_body, reply_date, source, is_verified")
      .eq("entity_type", "professional").eq("entity_id", profId).order("review_date", { ascending: false }).limit(5),
    sb.from("content_items").select("id, title, slug, excerpt, cover_image_url, published_at")
      .eq("author_type", "professional").eq("author_id", profId).eq("status", "published")
      .order("published_at", { ascending: false }).limit(3),
    sb.from("credentials").select("id, credential_type, name, identifier, issuing_org, issuing_org_url, issuing_state, valid_until, verified, schema_credential_category, wikidata_id")
      .eq("professional_id", profId).eq("is_current", true).order("verified", { ascending: false }),
    sb.from("professionals").select("id, canonical_url, phone, email, website_url, address_zip, wikidata_id, primary_org_id")
      .eq("id", profId).maybeSingle(),
    sb.from("graph_nodes").select("node_type, url, title, schema_property, source")
      .eq("entity_type", "professional").eq("entity_id", profId).eq("is_active", true)
      .or("ring.eq.2,schema_property.eq.sameAs"),
    prof.gcid
      ? sb.from("exp_taxonomy").select("term, level, wikidata_id").eq("gcid", prof.gcid)
          .in("level", ["specialization", "topic", "service", "product_service", "product"]).limit(50)
      : Promise.resolve({ data: [] }),
    sb.from("transaction_signals").select("city, state, zip_code, transaction_type").eq("professional_id", profId).limit(50),
    sb.from("aggregate_ratings").select("rating_value, review_count, rating_1, rating_2, rating_3, rating_4, rating_5")
      .eq("entity_type", "professional").eq("entity_id", profId).eq("source", "all").maybeSingle(),
  ]);
  let org = null;
  const orgId = proRes.data?.primary_org_id;
  if (orgId) {
    // loadOrg()
    const { data } = await sb.from("organizations")
      .select("id, name, slug, schema_type, website_url, canonical_url, logo_url, phone, address_street, address_city, address_state, address_zip, address_country, same_as, wikidata_id")
      .eq("id", orgId).maybeSingle();
    org = data;
  }
  return {
    profile: prof,
    reviews: reviewsRes.data ?? [],
    content: contentRes.data ?? [],
    credentials: credsRes.data ?? [],
    pro: proRes.data ?? null,
    graphNodes: graphNodesRes.data ?? [],
    taxonomy: taxRes.data ?? [],
    transactionSignals: txRes.data ?? [],
    aggregateRating: aggRes.data ?? null,
    org,
  };
}
// credentials tie on `verified`; graph nodes, taxonomy and transaction signals are unordered
const profileNorm = (r: any) =>
  r.profile
    ? {
        ...r,
        credentials: sortRows(r.credentials),
        graphNodes: sortRows(r.graphNodes),
        taxonomy: sortRows(r.taxonomy),
        transactionSignals: sortRows(r.transactionSignals),
      }
    : r;

const expertise = (kind: GraphKind, slug: string, why: string, extra: Partial<ParityCase> = {}): ParityCase => ({
  name: `expertise graph ${kind}/${slug} (${why})`,
  legacyModule: EXPERTISE,
  legacyExport: "loadExpertiseGraph",
  legacyArgs: [kind, slug],
  current: () => loadExpertiseGraph(kind, slug),
  normalize: graphNorm,
  ...extra,
});

export const cases: ParityCase[] = [
  // --- /control-graph ---
  {
    // graph-health-card.tsx
    name: "control: graph health (exp_validate_graph)",
    legacy: async (sb: any) => {
      const { data, error } = await sb.rpc("exp_validate_graph");
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: "/graph/control/validate" },
  },
  {
    // claims-tab.tsx (super_admin only; the page shows no emails when refused)
    name: "control: users (list_control_users)",
    legacy: async (sb: any) => {
      const { data, error } = await sb.rpc("list_control_users");
      if (error) return [];
      return data ?? [];
    },
    // claims-tab.tsx: the page turns a refusal (non-super_admin) into [], as the legacy code did
    // moved (surface audit 2026-10-25): the claims tab and its endpoints are admin's now
    current: () => api.get("/admin/control-claims/users").catch(() => []),
  },
  {
    // control-tree-tab.tsx
    name: "control: tree nodes",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_control_nodes")
        .select("node_id, name, node_type, parent_id, is_billing_container, linked_entity_id, status, created_at").order("name");
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: "/graph/control/nodes" },
  },
  {
    // control-tree-tab.tsx
    name: "control: brands",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_entity").select("entity_id, display_name, entity_type")
        .eq("entity_type", "brand").not("status", "in", "(merged,deactivated)").order("display_name").limit(500);
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: "/graph/control/brands" },
  },
  {
    // entities-tab.tsx
    name: "control: entities (newest 1000)",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_entity")
        .select("entity_id, display_name, entity_type, status, claim_state, confidence, created_at, is_demo")
        .order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: "/graph/control/entities" },
    // Bulk loads give many entities one created_at, so the order inside a tie (and which tied rows
    // make the 1000th-row cut) is arbitrary on both sides. Compare what the sort determines: the
    // count, the created_at sequence, and the rows strictly newer than the last (cut) timestamp.
    normalize: (rows: any[]) => {
      const last = rows.at(-1)?.created_at;
      return {
        count: rows.length,
        createdAt: rows.map((r) => r.created_at),
        newer: rows.filter((r) => r.created_at !== last)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.entity_id.localeCompare(b.entity_id))),
      };
    },
  },
  {
    // entities-tab.tsx RelationshipRows, for a subject that has relationships
    name: "control: entity relationships",
    prepare: async (sb: any) => (await sb.from("exp_rel").select("subject_entity_id").limit(1)).data?.[0]?.subject_entity_id,
    legacy: async (sb: any, entityId: string) => {
      const { data, error } = await sb.from("exp_rel")
        .select("rel_id, relationship_type, object_entity_id, object_gcid, status, is_primary, valid_from, valid_to, confidence")
        .eq("subject_entity_id", entityId).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
    api: (entityId: string) => ({ method: "GET", path: `/graph/control/entities/${entityId}/relationships` }),
  },
  {
    // claims-tab.tsx
    name: "control: claims (newest 500)",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_claim")
        .select("claim_id, entity_id, user_id, claim_type, status, evidence, verified_at, created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
    // moved (surface audit 2026-10-25): /graph/control/claims → admin
    api: { method: "GET", path: "/admin/control-claims" },
  },
  {
    // claims-tab.tsx: .limit(2000) unordered → 1000 rows on both sides (gap 1g, kept)
    name: "control: entities lite (1000-row cap on both)",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_entity").select("entity_id, display_name, entity_type").limit(2000);
      if (error) throw error;
      return data ?? [];
    },
    // moved (surface audit 2026-10-25): /graph/control/entities-lite → admin
    api: { method: "GET", path: "/admin/control-claims/entities-lite" },
    normalize: unordered,
  },
  // --- /:category/:city/:professional ---
  // moved (surface audit 2026-10-25): /graph/profile/* → /search/profile-page/*, /graph/profile-services → /search/profile-services
  {
    name: "profile page sf-a9ee009780abff5cc27f (State Farm agent, office)",
    legacy: (sb: any) => legacyProfile(sb, "sf-a9ee009780abff5cc27f"),
    api: { method: "GET", path: "/search/profile-page/sf-a9ee009780abff5cc27f" },
    normalize: profileNorm,
  },
  {
    name: "profile page amber-ernst (reviews, ratings, credentials)",
    legacy: (sb: any) => legacyProfile(sb, "amber-ernst"),
    api: { method: "GET", path: "/search/profile-page/amber-ernst" },
    normalize: profileNorm,
  },
  {
    name: "profile page unknown slug → profile null",
    legacy: (sb: any) => legacyProfile(sb, "does-not-exist-parity"),
    api: { method: "GET", path: "/search/profile-page/does-not-exist-parity" },
  },
  {
    // ServicesSection
    name: "profile page services gcid:insurance_agency",
    legacy: async (sb: any) => (await sb.from("exp_taxonomy").select("id, term, level").eq("gcid", "gcid:insurance_agency")
      .in("level", ["product_service", "specialization"]).order("priority", { ascending: true }).limit(20)).data ?? [],
    api: { method: "GET", path: "/search/profile-services?gcid=gcid:insurance_agency" },
  },
  // --- /p|o|c/:slug/graph (public) ---
  expertise("professional", "sf-a9ee009780abff5cc27f", "State Farm agent: office + brand, 35 nodes"),
  expertise("office", "demo-mortgage-naperville", "office with region + brand above it"),
  expertise("company", "state-farm", "brand"),
  expertise("professional", "does-not-exist-parity", "unknown slug → null"),
  expertise("professional", "amber-ernst", "largest graph: 2,644 active nodes", {
    explained: ["$.nodes", "$.edges", "$.ownCount", "$.liveCount", "$.summary"].map((path) => ({
      path,
      why:
        "uncapped by ruling 2026-10-24: legacy graph_nodes read returned PostgREST's 1000 rows (and its edges/external " +
        "nodes only for those), the API returns all. SQL (2026-10-24): select count(*) from graph_nodes where " +
        "entity_type='professional' and entity_id='22222222-0000-4000-8000-000000000001' and is_active → 2644; edges " +
        "touching them → 51; external nodes → 41. API smoke: ownRows 2644, edges 51, external 41.",
    })),
  }),
];
