/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";

// graph category pages: /categories, /categories/:gcid and its tabs, and the listings catalog.
// The legacy queries are copied verbatim from surface-ui/graph/src (routes/_authenticated/
// categories.index.tsx, categories.$gcid.tsx, components/*-tab.tsx, lib/listings/catalog.ts at
// migrate/api-graph before the port), as the signed-in user, against /graph/categories/*.
// Reads only: the tab writes (taxonomy, node registry, compliance rules, AI config, category
// status) are covered by compiled-SQL unit tests (graph/queries/categories_test.py), never run.

const P = "/graph/categories";
// gcid:insurance_agent / real_estate_agency have two exp_category_knowledge rows (the
// `.maybeSingle()` cases); closed_circuit_television has no listings or scoring rows.
const GCIDS = ["gcid:insurance_agent", "gcid:real_estate_agency", "gcid:closed_circuit_television"];
const enc = encodeURIComponent;

// Lists the page doesn't order (or whose ties come back in any order) are compared in one order.
const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);
/** Every array in an object sorted, except the ones the page shows in the server's order. */
const unorderedKeys = (keep: string[] = []) => (r: any) =>
  r && typeof r === "object"
    ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) && !keep.includes(k) ? sortRows(v) : v]))
    : r;

// categories.index.tsx fetchStats()
async function legacyStats(supabase: any) {
  const base = () =>
    supabase.from("gbp_categories").select("*", { count: "exact", head: true });
  const [t, a, e, l] = await Promise.all([
    base(),
    base().eq("status", "active"),
    base().eq("status", "excluded"),
    base().eq("is_launched", true),
  ]);
  return {
    total: t.count ?? 0,
    active: a.count ?? 0,
    excluded: e.count ?? 0,
    launched: l.count ?? 0,
  };
}

// categories.index.tsx fetchCategories() (before the row mapping, which stays in the page)
async function legacyCategories(supabase: any, search: string, sortKey: string, sortAsc: boolean) {
  let query = supabase
    .from("gbp_categories")
    .select("*")
    .order(sortKey, { ascending: sortAsc, nullsFirst: false })
    .limit(500);

  const q = search.trim().replace(/[,%()]/g, "");
  if (q) query = query.or(`display_name.ilike.%${q}%,gcid.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// categories.$gcid.tsx fetchDetail(): the ten reads, in the API's shape (raw rows; the counts
// are computed by the page from them as before)
async function legacyDetail(supabase: any, gcid: string) {
  const [cat, know, comp, nodes, tax, ui, dirs, secs, groups, validation] = await Promise.all([
    supabase.from("gbp_categories").select("*").eq("gcid", gcid).maybeSingle(),
    supabase.from("exp_category_knowledge").select("*").eq("gcid", gcid),
    supabase.from("exp_category_compliance").select("*").eq("gcid", gcid).maybeSingle(),
    supabase.from("exp_vertical_node_registry").select("ring,entity_scope").eq("gcid", gcid),
    supabase.from("exp_taxonomy").select("gcid").eq("gcid", gcid).limit(1),
    supabase.from("exp_category_ui_config").select("*").eq("gcid", gcid),
    supabase
      .from("exp_category_directories")
      .select("directory_key,directory_name,is_required,priority,schema_type,notes")
      .eq("gcid", gcid)
      .order("priority", { ascending: true }),
    supabase
      .from("exp_category_secondaries")
      .select("secondary_gcid,relevance,notes")
      .eq("primary_gcid", gcid)
      .order("relevance", { ascending: true }),
    (supabase as any)
      .from("exp_category_group_memberships")
      .select("is_primary, exp_category_groups(name,slug)")
      .eq("gcid", gcid),
    (supabase as any).rpc("exp_validate_category_full", { p_gcid: gcid }),
  ]);
  if (cat.error) throw cat.error;
  return {
    category: cat.data,
    knowledge: know.data,
    compliance: comp.data,
    nodes: nodes.data,
    taxonomy: tax.data,
    uiConfigs: ui.data,
    directories: dirs.data,
    secondaries: secs.data,
    groups: groups.data,
    validation: validation.data,
  };
}

// scoring-tab.tsx load(), in the API's shape
async function legacyScoring(supabase: any, gcid: string) {
  const [a, b, c, q, v, cat] = await Promise.all([
    supabase.from("exp_category_ear").select("ear,band,ear_professional,non_reviewable").eq("gcid", gcid).maybeSingle(),
    supabase.from("exp_category_eaa").select("eaa,band,eaa_professional,non_authored").eq("gcid", gcid).maybeSingle(),
    supabase.from("exp_category_completeness").select("total_node_types,core_node_types,expected_m").eq("gcid", gcid).maybeSingle(),
    supabase.from("exp_category_eaq").select("eaq,band,eaq_professional,non_qa").eq("gcid", gcid).maybeSingle(),
    supabase.from("exp_category_eav").select("eav,band,eav_professional,non_video").eq("gcid", gcid).maybeSingle(),
    supabase.from("gbp_categories").select("display_name").eq("gcid", gcid).maybeSingle(),
  ]);
  return { ear: a.data, eaa: b.data, completeness: c.data, eaq: q.data, eav: v.data, category: cat.data };
}

// listings-tab.tsx overlays / crosswalk / family status, in the API's shape
async function legacyListings(supabase: any, gcid: string) {
  const [o, x, f] = await Promise.all([
    supabase.from("exp_listings_overlays").select("overlay").eq("gcid", gcid),
    supabase.from("exp_listings_crosswalk").select("publisher_id,code,label,breadcrumb,confidence").eq("gcid", gcid),
    supabase.from("exp_listings_category_status").select("family,present").eq("gcid", gcid),
  ]);
  return { overlays: o.data, crosswalk: x.data, status: f.data };
}

// lib/listings/catalog.ts fetchCatalogs(client): the two selects, in the API's shape
async function legacyCatalog(client: any) {
  const [p, f] = await Promise.all([
    client
      .from("exp_listings_publishers")
      .select("id,name,kind,subtitle,publishes_to,ops_notes,display_sort,channel_role,role_status"),
    client
      .from("exp_listings_field_map")
      .select(
        "publisher_id,section,section_note,their_field,our_target,rules,applicability,status_default,variant_family,sort",
      )
      .eq("catalog_version", "listings_tab_2026_07"),
  ]);
  return { publishers: p.error ? null : p.data, fieldMap: f.error ? null : f.data };
}

const perGcid = (g: string): ParityCase[] => [
  {
    name: `detail: summary loader ${g}`,
    legacy: (sb: any) => legacyDetail(sb, g),
    api: { method: "GET", path: `${P}/detail?gcid=${enc(g)}` },
    // directories / secondaries tie on priority / relevance; the rest are unordered reads.
    // validation keeps the function's own row order.
    normalize: unorderedKeys(["validation"]),
  },
  {
    name: `compliance tab: compliance row ${g}`,
    legacy: async (supabase: any) => {
      const { data, error } = await supabase.from("exp_category_compliance").select("*").eq("gcid", g).maybeSingle();
      if (error) throw error;
      return data;
    },
    api: { method: "GET", path: `${P}/compliance?gcid=${enc(g)}` },
  },
  {
    name: `compliance tab: rules ${g}`,
    legacy: async (supabase: any) => {
      const { data, error } = await supabase.from("content_compliance_rules").select("*").eq("gcid", g).order("rule_name");
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: `${P}/compliance-rules?gcid=${enc(g)}` },
  },
  {
    name: `ai config tab: knowledge ${g}${g === "gcid:closed_circuit_television" ? "" : " (2 rows: both refuse)"}`,
    expectRefusal: g !== "gcid:closed_circuit_television",
    legacy: async (supabase: any) => {
      const { data, error } = await supabase.from("exp_category_knowledge").select("ai_agents").eq("gcid", g).maybeSingle();
      if (error) throw error;
      return data;
    },
    api: { method: "GET", path: `${P}/ai-config/knowledge?gcid=${enc(g)}` },
  },
  {
    name: `ai config tab: compliance ${g}`,
    legacy: async (supabase: any) => {
      const { data, error } = await supabase
        .from("exp_category_compliance")
        .select("content_restrictions, prohibited_phrases, required_disclaimers")
        .eq("gcid", g)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    api: { method: "GET", path: `${P}/ai-config/compliance?gcid=${enc(g)}` },
  },
  {
    name: `node registry tab: entity type ${g} (error ignored → null)`,
    legacy: async (supabase: any) => {
      const { data } = await supabase.from("exp_category_knowledge").select("entity_type").eq("gcid", g).maybeSingle();
      return data;
    },
    api: { method: "GET", path: `${P}/entity-type?gcid=${enc(g)}` },
  },
  {
    name: `node registry tab: schema type ${g}`,
    legacy: async (supabase: any) => {
      const { data, error } = await supabase.from("exp_category_schema_type").select("schema_type, confidence").eq("gcid", g).maybeSingle();
      if (error) return null;
      return data;
    },
    api: { method: "GET", path: `${P}/schema-type?gcid=${enc(g)}` },
  },
  {
    name: `node registry tab: nodes ${g}`,
    legacy: async (supabase: any) => {
      const { data, error } = await supabase.from("exp_vertical_node_registry").select("*").eq("gcid", g).order("priority", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: `${P}/node-registry?gcid=${enc(g)}` },
    normalize: unordered, // many nodes tie on priority (Postgres returns ties in any order)
  },
  {
    name: `operations tab: nodes ${g}`,
    legacy: async (supabase: any) =>
      (await supabase.from("exp_vertical_node_registry").select("node_name,ring").eq("gcid", g).limit(1000)).data ?? [],
    api: { method: "GET", path: `${P}/operations/nodes?gcid=${enc(g)}` },
    normalize: unordered,
  },
  {
    name: `schema tab: stored schema ${g}`,
    legacy: async (supabase: any) => {
      const { data } = await supabase.from("exp_category_schema").select("schema_json, model").eq("gcid", g).maybeSingle();
      return data;
    },
    api: { method: "GET", path: `${P}/schema?gcid=${enc(g)}` },
  },
  {
    name: `schema tab: active registry ${g}`,
    legacy: async (supabase: any) => {
      const { data, error } = await supabase
        .from("exp_vertical_node_registry")
        .select("node_name, ring, entity_scope, connection_method, schema_type, schema_property, required_for_score, priority")
        .eq("gcid", g)
        .eq("is_active", true);
      if (error) return [];
      return data ?? [];
    },
    api: { method: "GET", path: `${P}/schema/registry?gcid=${enc(g)}` },
    normalize: unordered,
  },
  {
    name: `listings tab: overlays, crosswalk, family status ${g}`,
    legacy: (sb: any) => legacyListings(sb, g),
    api: { method: "GET", path: `${P}/listings?gcid=${enc(g)}` },
    normalize: unorderedKeys(),
  },
  {
    name: `scoring tab: targets ${g}`,
    legacy: (sb: any) => legacyScoring(sb, g),
    api: { method: "GET", path: `${P}/scoring?gcid=${enc(g)}` },
  },
  {
    name: `taxonomy tab: terms ${g}`,
    legacy: async (supabase: any) => {
      const { data, error } = await supabase
        .from("exp_taxonomy")
        .select(
          "id,gcid,level,term,term_display,term_slug,entity_scope,source,validated,priority,search_intent,search_volume_monthly,wikidata_id",
        )
        .eq("gcid", g)
        .order("priority", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: `${P}/taxonomy?gcid=${enc(g)}` },
    normalize: unordered, // terms tie on priority
  },
];

export const cases: ParityCase[] = [
  // --- /categories ---
  {
    name: "index: stat cards",
    legacy: legacyStats,
    api: { method: "GET", path: `${P}/stats` },
  },
  {
    name: "index: first 500 by name",
    legacy: (sb: any) => legacyCategories(sb, "", "display_name", true),
    api: { method: "GET", path: `${P}/list?search=&sort=display_name&asc=true` },
    normalize: unordered, // names can tie at the 500-row boundary only if duplicated
  },
  {
    name: "index: search 'real estate' by profiles desc",
    legacy: (sb: any) => legacyCategories(sb, "real estate", "estimated_profiles", false),
    api: { method: "GET", path: `${P}/list?search=${enc("real estate")}&sort=estimated_profiles&asc=false` },
    normalize: unordered, // ties on estimated_profiles
  },
  {
    name: "index: search 'insur*agent' (PostgREST `*` wildcard) by gcid desc",
    legacy: (sb: any) => legacyCategories(sb, "insur*agent", "gcid", false),
    api: { method: "GET", path: `${P}/list?search=${enc("insur*agent")}&sort=gcid&asc=false` },
  },
  {
    name: "index: tree children",
    legacy: async (supabase: any) => {
      const childGcids = ["gcid:insurance_agent", "gcid:insurance_agency", "gcid:insurance_broker"];
      const { data } = await (supabase as any)
        .from("gbp_categories")
        .select(
          "gcid,display_name,entity_type,status,estimated_profiles,estimated_locations,supports_single_pro_office",
        )
        .in("gcid", childGcids)
        .order("display_name", { ascending: true });
      return data ?? [];
    },
    api: {
      method: "POST",
      path: `${P}/children`,
      body: { gcids: ["gcid:insurance_agent", "gcid:insurance_agency", "gcid:insurance_broker"], view: "tree" },
    },
  },
  {
    name: "detail: children",
    legacy: async (supabase: any) => {
      const ids = ["gcid:real_estate_agency", "gcid:real_estate_agents", "gcid:real_estate_consultant"];
      const { data: kids } = await (supabase as any)
        .from("gbp_categories")
        .select("gcid,display_name,entity_type,estimated_profiles,estimated_locations")
        .in("gcid", ids)
        .order("display_name", { ascending: true });
      return kids ?? [];
    },
    api: {
      method: "POST",
      path: `${P}/children`,
      body: { gcids: ["gcid:real_estate_agency", "gcid:real_estate_agents", "gcid:real_estate_consultant"], view: "detail" },
    },
  },
  // --- /categories/:gcid and its tabs ---
  ...GCIDS.flatMap(perGcid),
  {
    name: "node registry tab: canonical rings",
    legacy: async (supabase: any) => {
      const { data, error } = await (supabase as any)
        .from("exp_rings")
        .select("position, ring_key, ring_name, legacy_key, seo_function, schema_types")
        .order("position", { ascending: true });
      if (error) return null;
      return data;
    },
    api: { method: "GET", path: `${P}/rings` },
  },
  {
    name: "node registry tab: schema ring map InsuranceAgency",
    legacy: async (supabase: any) => {
      const { data, error } = await (supabase as any)
        .from("exp_schema_type_ring_map")
        .select("ring_key, schema_property, inherited_from")
        .eq("schema_type", "InsuranceAgency");
      if (error) return [];
      return data ?? [];
    },
    api: { method: "GET", path: `${P}/schema-ring-map?schema_type=InsuranceAgency` },
    normalize: unordered,
  },
  {
    name: "listings tab: publisher catalog",
    legacy: legacyCatalog,
    api: { method: "GET", path: `${P}/listings/catalog?catalog_version=listings_tab_2026_07` },
    normalize: unorderedKeys(),
  },
];
