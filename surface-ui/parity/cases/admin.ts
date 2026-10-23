/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";

// Legacy queries copied verbatim from surface-ui/admin/src/routes/_authenticated/ at
// migrate/from-experiencesrp-clone (they were inline in components, so nothing to import).

const PAGE_SIZE = 50;
const ORG_COLUMNS =
  "id, name, slug, gcid, entity_type, parent_org_id, claimed, is_active, is_demo, search_rank_score, score_updated_at, address_city, address_state, phone, website_url, hierarchy_depth, gbp_connected";

type ProFilters = {
  search: string; gcidFilter: string; locationFilter: string; claimedFilter: string; scoreRange: string; page: number;
};

// professionals.tsx:177-226
async function legacyProPage(supabase: any, f: ProFilters) {
  const { search, gcidFilter, locationFilter, claimedFilter, scoreRange, page } = f;
  let scopedIds: string[] | null = null;
  let excludeIds: string[] | null = null;
  if (scoreRange !== "all") {
    let sq = supabase.from("search_rank_scores").select("entity_id, total_score").eq("entity_type", "professional");
    if (scoreRange === "0-300") sq = sq.gte("total_score", 0).lte("total_score", 300);
    if (scoreRange === "300-600") sq = sq.gte("total_score", 300).lte("total_score", 600);
    if (scoreRange === "600-850") sq = sq.gte("total_score", 600).lte("total_score", 850);
    const { data: sd, error: se } = await sq;
    if (se) throw se;
    const ids = (sd ?? []).map((r: any) => r.entity_id);
    if (scoreRange === "unscored") excludeIds = ids;
    else scopedIds = ids;
  }
  let q = supabase
    .from("professionals")
    .select(
      "id, first_name, last_name, display_name, slug, photo_url, gcid, job_title, address_city, address_state, primary_org_id, primary_license_number, primary_license_verified, claimed, bio, territory_id",
      { count: "exact" },
    )
    .order("display_name", { ascending: true, nullsFirst: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (search.trim()) {
    const s = `%${search.trim()}%`;
    q = q.or(`display_name.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`);
  }
  if (gcidFilter !== "all") q = q.eq("gcid", gcidFilter);
  if (locationFilter.trim()) {
    const l = `%${locationFilter.trim()}%`;
    q = q.or(`address_city.ilike.${l},address_state.ilike.${l}`);
  }
  if (claimedFilter === "claimed") q = q.eq("claimed", true);
  if (claimedFilter === "unclaimed") q = q.eq("claimed", false);
  if (scopedIds) q = q.in("id", scopedIds.length ? scopedIds : ["00000000-0000-0000-0000-000000000000"]);
  if (excludeIds?.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

const DEFAULT: ProFilters = { search: "", gcidFilter: "all", locationFilter: "", claimedFilter: "all", scoreRange: "all", page: 0 };
const FILTERED: ProFilters = { search: "smith", gcidFilter: "all", locationFilter: "tx", claimedFilter: "unclaimed", scoreRange: "unscored", page: 0 };
const proQuery = (f: ProFilters) =>
  `/admin/professionals?search=${encodeURIComponent(f.search)}&gcid=${encodeURIComponent(f.gcidFilter)}` +
  `&location=${encodeURIComponent(f.locationFilter)}&claimed=${f.claimedFilter}&score=${f.scoreRange}&page=${f.page}`;

/** The first page's ids / org ids / gcids, read the legacy way, for the per-page lookups. */
async function firstPage(supabase: any) {
  const { rows } = await legacyProPage(supabase, DEFAULT);
  return {
    proIds: rows.map((p: any) => p.id),
    orgIds: Array.from(new Set(rows.map((p: any) => p.primary_org_id).filter(Boolean))),
    gcids: Array.from(new Set(rows.map((p: any) => p.gcid).filter(Boolean))),
  };
}

type OrgFilters = { search: string; gcidFilter: string; statusFilter: string; scopeFilter: string; page: number };

// organizations.tsx:119-138
async function legacyOrgPage(supabase: any, f: OrgFilters) {
  const { search, gcidFilter, statusFilter, scopeFilter, page } = f;
  let q = supabase
    .from("organizations")
    .select(ORG_COLUMNS, { count: "exact" })
    .order("search_rank_score", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
  if (gcidFilter !== "all") q = q.eq("gcid", gcidFilter);
  if (statusFilter === "claimed") q = q.eq("claimed", true);
  if (statusFilter === "unclaimed") q = q.not("claimed", "is", true);
  if (statusFilter === "scored") q = q.not("search_rank_score", "is", null);
  if (scopeFilter === "real") q = q.not("is_demo", "is", true);
  if (scopeFilter === "demo") q = q.eq("is_demo", true);
  const { data: rows, count, error } = await q;
  if (error) throw error;
  return { rows: rows ?? [], count: count ?? 0 };
}
const orgQuery = (f: OrgFilters) =>
  `/admin/organizations?search=${encodeURIComponent(f.search)}&gcid=${encodeURIComponent(f.gcidFilter)}` +
  `&status=${f.statusFilter}&scope=${f.scopeFilter}&page=${f.page}`;
const ORG_DEFAULT: OrgFilters = { search: "", gcidFilter: "all", statusFilter: "all", scopeFilter: "real", page: 0 };
const ORG_FILTERED: OrgFilters = { search: "state farm", gcidFilter: "all", statusFilter: "unclaimed", scopeFilter: "all", page: 1 };

export const cases: ParityCase[] = [
  {
    // professionals.tsx:126-142
    name: "professionals: category options",
    legacy: async (supabase) => {
      const out: string[] = [];
      let last: string | null = null;
      for (let i = 0; i < 200; i++) {
        let q = supabase.from("professionals").select("gcid").not("gcid", "is", null);
        if (last !== null) q = q.gt("gcid", last);
        const { data, error } = await q.order("gcid").limit(1);
        if (error) throw error;
        const g = data?.[0]?.gcid;
        if (!g) break;
        out.push(g);
        last = g;
      }
      return out;
    },
    api: { method: "GET", path: "/admin/professionals/categories" },
  },
  {
    // professionals.tsx:147-169
    name: "professionals: stats tiles",
    legacy: async (supabase) => {
      const total = await supabase.from("professionals").select("*", { count: "exact", head: true });
      const active = await supabase.from("professionals").select("*", { count: "exact", head: true }).eq("is_active", true);
      const claimed = await supabase.from("professionals").select("*", { count: "exact", head: true }).eq("claimed", true);
      const verified = await supabase.from("professionals").select("*", { count: "exact", head: true }).eq("primary_license_verified", true);
      return { total: total.count ?? 0, active: active.count ?? 0, claimed: claimed.count ?? 0, verified: verified.count ?? 0 };
    },
    api: { method: "GET", path: "/admin/professionals/stats" },
  },
  {
    name: "professionals: list, default filters, page 0",
    legacy: (supabase) => legacyProPage(supabase, DEFAULT),
    api: { method: "GET", path: proQuery(DEFAULT) },
  },
  {
    name: "professionals: list, search+location+unclaimed+unscored",
    legacy: (supabase) => legacyProPage(supabase, FILTERED),
    api: { method: "GET", path: proQuery(FILTERED) },
  },
  {
    name: "professionals: list, page 3",
    legacy: (supabase) => legacyProPage(supabase, { ...DEFAULT, page: 3 }),
    api: { method: "GET", path: proQuery({ ...DEFAULT, page: 3 }) },
  },
  {
    // professionals.tsx:234-254
    name: "professionals: scores for page 0",
    prepare: firstPage,
    legacy: async (supabase, ctx) => {
      const { data, error } = await supabase
        .from("search_rank_scores")
        .select("entity_id, total_score, max_possible, local_rank, local_rank_of, gaps")
        .eq("entity_type", "professional")
        .in("entity_id", ctx.proIds);
      if (error) throw error;
      const map: Record<string, unknown> = {};
      (data ?? []).forEach((r: any) => {
        map[r.entity_id] = { total: r.total_score, max: r.max_possible ?? 850, rank: r.local_rank ?? null, rankOf: r.local_rank_of ?? null };
      });
      return map;
    },
    api: (ctx) => ({ method: "POST", path: "/admin/professionals/scores", body: { ids: ctx.proIds } }),
  },
  {
    // professionals.tsx:260-278
    name: "professionals: graph depth for page 0",
    prepare: firstPage,
    legacy: async (supabase, ctx) => {
      const { data, error } = await supabase
        .from("graph_nodes")
        .select("entity_id, node_type")
        .eq("entity_type", "professional")
        .eq("is_active", true)
        .in("entity_id", ctx.proIds);
      if (error) throw error;
      const map: Record<string, { products: number; socials: number; credentials: number; total: number }> = {};
      (data ?? []).forEach((r: any) => {
        const d = (map[r.entity_id] ??= { products: 0, socials: 0, credentials: 0, total: 0 });
        d.total += 1;
        const t = r.node_type ?? "";
        if (/product|service|offer/i.test(t)) d.products += 1;
        else if (/social|same_?as/i.test(t)) d.socials += 1;
        else if (/credential|license|certif/i.test(t)) d.credentials += 1;
      });
      return map;
    },
    api: (ctx) => ({ method: "POST", path: "/admin/professionals/depth", body: { ids: ctx.proIds } }),
  },
  {
    // professionals.tsx:310-324
    name: "professionals: org + category names for page 0",
    prepare: firstPage,
    legacy: async (supabase, ctx) => {
      const [orgsRes, catsRes] = await Promise.all([
        ctx.orgIds.length ? supabase.from("organizations").select("id, name").in("id", ctx.orgIds) : Promise.resolve({ data: [] }),
        ctx.gcids.length ? supabase.from("gbp_categories").select("gcid, display_name").in("gcid", ctx.gcids) : Promise.resolve({ data: [] }),
      ]);
      const orgs: Record<string, string> = {};
      ((orgsRes as any).data ?? []).forEach((o: any) => { orgs[o.id] = o.name; });
      const cats: Record<string, string> = {};
      ((catsRes as any).data ?? []).forEach((c: any) => { cats[c.gcid] = c.display_name; });
      return { orgs, cats };
    },
    api: (ctx) => ({ method: "POST", path: "/admin/professionals/extras", body: { orgIds: ctx.orgIds, gcids: ctx.gcids } }),
  },
  {
    // organizations.tsx:103-112
    name: "organizations: category options",
    legacy: async (supabase) => {
      const { data, error } = await supabase.from("organizations").select("gcid").not("gcid", "is", null).limit(5000);
      if (error) throw error;
      const set = new Set((data ?? []).map((r: any) => r.gcid as string));
      return Array.from(set).sort();
    },
    api: { method: "GET", path: "/admin/organizations/categories" },
  },
  {
    name: "organizations: list, default (real), page 0",
    legacy: (supabase) => legacyOrgPage(supabase, ORG_DEFAULT),
    api: { method: "GET", path: orgQuery(ORG_DEFAULT) },
  },
  {
    name: "organizations: list, search+unclaimed+all, page 1",
    legacy: (supabase) => legacyOrgPage(supabase, ORG_FILTERED),
    api: { method: "GET", path: orgQuery(ORG_FILTERED) },
  },
  {
    // compliance.tsx:49-53 (the raw rows; the page joins them the same way on both paths)
    name: "compliance: coverage rows",
    legacy: async (supabase) => {
      const [cats, comp, rules] = await Promise.all([
        supabase.from("gbp_categories").select("gcid, display_name").order("display_name").limit(5000),
        supabase.from("exp_category_compliance").select("*"),
        supabase.from("content_compliance_rules").select("gcid"),
      ]);
      if (cats.error) throw cats.error;
      return { cats: cats.data ?? [], comp: comp.data ?? [], rules: rules.data ?? [] };
    },
    api: { method: "GET", path: "/admin/compliance/coverage" },
  },
  {
    // compliance.tsx:90-107 (the raw rows)
    name: "compliance: entity rows",
    legacy: async (supabase) => {
      const { data, error } = await supabase.from("entity_compliance").select("*").order("compliance_score", { ascending: true }).limit(200);
      if (error) throw error;
      const rows = data ?? [];
      const proIds = rows.filter((r: any) => r.entity_type === "professional").map((r: any) => r.entity_id);
      const orgIds = rows.filter((r: any) => r.entity_type === "organization").map((r: any) => r.entity_id);
      const [pros, orgs, cats] = await Promise.all([
        proIds.length ? supabase.from("professionals").select("id, display_name, first_name, last_name, gcid").in("id", proIds) : Promise.resolve({ data: [] }),
        orgIds.length ? supabase.from("organizations").select("id, name, gcid").in("id", orgIds) : Promise.resolve({ data: [] }),
        supabase.from("gbp_categories").select("gcid, display_name"),
      ]);
      return { rows, pros: (pros as any).data ?? [], orgs: (orgs as any).data ?? [], cats: (cats as any).data ?? [] };
    },
    api: { method: "GET", path: "/admin/compliance/entities" },
  },
  {
    // admin.users.tsx:65-69 — super_admin only
    name: "users: control users (super_admin only)",
    expectRefusal: true,
    legacy: async (supabase) => {
      const { data, error } = await supabase.rpc("list_control_users" as never);
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: "/admin/control-users" },
  },
  {
    // admin.users.tsx:75-81
    name: "users: control grants",
    legacy: async (supabase) => {
      const { data, error } = await supabase.from("exp_control_grants").select("id, user_id, role, scope_type, scope_id, is_primary");
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: "/admin/control-grants" },
  },
];
