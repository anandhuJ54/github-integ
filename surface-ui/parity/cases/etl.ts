/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import { api } from "@v3/ui/lib/server-fn";

// ETL /discovery: the legacy queries (copied verbatim from surface-ui/etl/src/components/discovery
// at migrate/from-experiencesrp-clone, where they were inline in components) against the
// /etl/console/* endpoints, as the signed-in user. Reads only: the tab buttons run gated ETL
// functions (schedules, run, reharvest, activate, discover), so no write is exercised here.

const SUBJ = "exp_rel!exp_rel_subject_entity_id_fkey";
const ENTITY_COLS = "entity_id, entity_type, display_name, confidence, claim_state, source, status, created_at";
const PAGE_SIZE = 50;
const SORT_COLS: Record<string, string> = { name: "display_name", type: "entity_type", confidence: "confidence", created: "created_at" };

// hierarchy-data.ts entityQuery()
function entityQuery(db: any, f: any, opts: { cols?: string; head?: boolean; typeOverride?: string | null } = {}) {
  const embeds: string[] = [];
  if (f.gcid) embeds.push(`cls:${SUBJ}!inner(object_gcid)`);
  if (f.brand) embeds.push(`br:${SUBJ}(object_entity_id)`);
  if (f.office) embeds.push(`of:${SUBJ}!inner(object_entity_id)`);
  const sel = [opts.cols ?? ENTITY_COLS, ...embeds].join(", ");
  let q = db.from("exp_entity").select(sel, { count: "exact", head: !!opts.head }).neq("status", "merged").eq("is_demo", false);
  if (f.gcid) q = q.eq("cls.relationship_type", "CLASSIFIED_AS").eq("cls.status", "current").eq("cls.object_gcid", f.gcid);
  if (f.brand)
    q = q.in("br.relationship_type", ["OPERATES_UNDER", "REPRESENTS"]).eq("br.status", "current").eq("br.object_entity_id", f.brand)
      .or(`entity_id.eq.${f.brand},br.not.is.null`);
  if (f.office) q = q.eq("of.relationship_type", "WORKS_AT").eq("of.status", "current").eq("of.object_entity_id", f.office);
  if (f.source) q = q.eq("source", f.source);
  const type = opts.typeOverride !== undefined ? opts.typeOverride : f.type;
  if (type) q = q.eq("entity_type", type);
  if (f.claim) q = q.eq("claim_state", f.claim);
  if (f.q) q = q.ilike("display_name", `%${f.q.replace(/[%_,()]/g, " ")}%`);
  return q;
}
async function incomingCount(db: any, objectId: string, relType: string) {
  const { count, error } = await db.from("exp_rel").select("subject_entity_id", { count: "exact", head: true })
    .eq("object_entity_id", objectId).eq("relationship_type", relType).eq("status", "current");
  if (error) throw error;
  return count ?? 0;
}
async function gcidLabels(db: any, gcids: string[]) {
  const uniq = [...new Set(gcids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await db.from("gbp_categories").select("gcid, display_name").in("gcid", uniq).limit(uniq.length);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r: any) => [r.gcid, r.display_name]));
}

// hierarchy-tab.tsx useTable() queryFn
async function legacyTable(db: any, f: any, page: number, sort: string, dir: string) {
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await entityQuery(db, f, { cols: ENTITY_COLS })
    .order(SORT_COLS[sort], { ascending: dir === "asc", nullsFirst: false }).order("entity_id").range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((r: any) => r.entity_id);
  let rels: any[] = [];
  if (ids.length) {
    const r = await db.from("exp_rel")
      .select("subject_entity_id, relationship_type, object_entity_id, object_gcid, obj:exp_entity!exp_rel_object_entity_id_fkey(display_name)")
      .in("subject_entity_id", ids).in("relationship_type", ["CLASSIFIED_AS", "WORKS_AT", "REPRESENTS", "OPERATES_UNDER"])
      .eq("status", "current").limit(1000);
    if (r.error) throw r.error;
    rels = r.data ?? [];
  }
  const labels = await gcidLabels(db, rels.filter((r) => r.relationship_type === "CLASSIFIED_AS").map((r) => r.object_gcid ?? ""));
  const counts: Record<string, number> = {};
  await Promise.all(rows.filter((r: any) => r.entity_type === "location" || r.entity_type === "brand").map(async (r: any) => {
    counts[r.entity_id] = await incomingCount(db, r.entity_id, r.entity_type === "location" ? "WORKS_AT" : "REPRESENTS");
  }));
  return { rows, total: count ?? 0, rels, labels, counts };
}

// Lists the page doesn't order (or whose ties come back in any order) are compared in one order.
const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...rows].map(deep).sort((a, b) => key(a).localeCompare(key(b)));
function deep(o: any): any {
  if (Array.isArray(o)) return o.map(deep);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) && k !== "rows" ? sortRows(v) : deep(v)]));
  return o;
}
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : deep(r));
const tableNorm = (r: any) => ({ ...deep(r), rels: sortRows(r.rels) });

/** A brand with offices, one of its offices with advisors, and an entity — read the legacy way. */
async function sample(db: any) {
  const { data: rel } = await db.from("exp_rel").select("object_entity_id").eq("relationship_type", "OPERATES_UNDER").eq("status", "current").limit(1);
  const brand = rel?.[0]?.object_entity_id;
  const { data: wk } = await db.from("exp_rel").select("object_entity_id").eq("relationship_type", "WORKS_AT").eq("status", "current").limit(1);
  return { brand, office: wk?.[0]?.object_entity_id };
}

const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

export const cases: ParityCase[] = [
  // --- tabs ---
  {
    name: "ai cost: last 30 days",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_etl_cost_events").select("*").order("occurred_at", { ascending: false }).limit(5000).gte("occurred_at", since30);
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: `/etl/console/ai-cost-events?since=${encodeURIComponent(since30)}` },
  },
  {
    name: "ai cost: all time",
    legacy: async (sb: any) => (await sb.from("exp_etl_cost_events").select("*").order("occurred_at", { ascending: false }).limit(5000)).data ?? [],
    api: { method: "GET", path: "/etl/console/ai-cost-events" },
  },
  {
    // field-yield-tab.tsx loadGate(), in the API's shape (floors, jobs, gcids, counts)
    name: "field yield: floors, jobs, staging counts",
    legacy: async (sb: any) => {
      const [{ data: floors }, { data: jobs }] = await Promise.all([
        sb.from("exp_etl_field_floors").select("*").order("gcid"),
        sb.from("exp_etl_hydrate_jobs").select("*").order("job_key"),
      ]);
      const gcids = Array.from(new Set([...(floors ?? []).map((f: any) => f.gcid), ...(jobs ?? []).map((j: any) => j.gcid)]));
      const count = async (gcid: string, apply: (q: any) => any) => (await apply(sb.from("exp_etl_staging").select("stage_id", { count: "exact", head: true }).eq("gcid", gcid))).count ?? 0;
      const counts: Record<string, any> = {};
      for (const g of gcids as string[]) {
        counts[g] = {
          total: await count(g, (q) => q),
          deep: await count(g, (q) => q.eq("payload->>field_tier", "deep")),
          shallow: await count(g, (q) => q.eq("resolution_status", "shallow")),
        };
      }
      return { floors: floors ?? [], jobs: jobs ?? [], gcids, counts };
    },
    api: { method: "GET", path: "/etl/console/field-yield" },
  },
  {
    name: "required fields: source gcids",
    legacy: async (sb: any) => (await sb.from("exp_etl_sources").select("gcid")).data ?? [],
    api: { method: "GET", path: "/etl/console/source-gcids" },
    normalize: unordered,
  },
  {
    name: "runs: last 200",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_etl_runs")
        .select("run_id, source_id, started_at, finished_at, pages_fetched, pulled, staged, matched, created, conflicted, errors, entities_yielded")
        .order("started_at", { ascending: false, nullsFirst: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: "/etl/console/runs" },
  },
  {
    name: "runs: source domains",
    prepare: async (sb: any) => [...new Set(((await sb.from("exp_etl_runs").select("source_id").limit(200)).data ?? []).map((r: any) => r.source_id).filter(Boolean))],
    legacy: async (sb: any, ids: string[]) => (await sb.from("exp_etl_sources").select("source_id, source_domain").in("source_id", ids)).data ?? [],
    api: (ids: string[]) => ({ method: "POST", path: "/etl/console/source-domains", body: { ids } }),
    normalize: unordered,
  },
  {
    name: "runs: frontier matrix rows (1000-row cap on both)",
    legacy: async (sb: any) => (await sb.from("exp_etl_frontier").select("kind, status")).data ?? [],
    api: { method: "GET", path: "/etl/console/frontier-matrix" },
    normalize: unordered,
  },
  {
    name: "schedules: list (role-checked)",
    expectRefusal: true,
    legacy: async (sb: any) => { const { data, error } = await sb.rpc("exp_etl_cron_list"); if (error) throw error; return data ?? []; },
    api: { method: "GET", path: "/etl/console/schedules" },
  },
  {
    name: "source stats: hierarchy sources",
    legacy: async (sb: any) => (await sb.from("exp_etl_sources").select("source_domain, gcid").eq("role_in_discovery", "hierarchy_source")).data ?? [],
    api: { method: "GET", path: "/etl/console/stats-sources" },
    normalize: unordered,
  },
  {
    name: "source stats: real_estate_agency (role-checked)",
    expectRefusal: true,
    legacy: async (sb: any) => { const { data, error } = await sb.rpc("exp_etl_source_stats", { p_gcid: "gcid:real_estate_agency", p_source: null }); if (error) throw error; return data ?? []; },
    api: { method: "GET", path: "/etl/console/source-stats?gcid=gcid%3Areal_estate_agency" },
  },
  // --- hierarchy ---
  {
    name: "hierarchy: source filter options + labels",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_etl_sources").select("source_domain, gcid").limit(2000);
      if (error) throw error;
      const rows = data ?? [];
      return { rows, labels: await gcidLabels(sb, rows.map((r: any) => r.gcid ?? "")) };
    },
    api: { method: "GET", path: "/etl/console/hierarchy/sources" },
    normalize: (r: any) => ({ ...r, rows: sortRows(r.rows) }),
  },
  {
    name: "hierarchy: category search 'insur'",
    legacy: async (sb: any) => (await sb.from("gbp_categories").select("gcid, display_name").or("display_name.ilike.*insur*,gcid.ilike.*insur*").limit(20)).data ?? [],
    api: { method: "GET", path: "/etl/console/hierarchy/category-search?term=insur" },
    normalize: unordered,
  },
  {
    name: "hierarchy: brands",
    legacy: async (sb: any) => (await sb.from("exp_entity").select("entity_id, display_name").eq("entity_type", "brand").neq("status", "merged").eq("is_demo", false).order("display_name").limit(500)).data ?? [],
    api: { method: "GET", path: "/etl/console/hierarchy/brands" },
  },
  ...([
    ["no filters, newest", {}, 1, "created", "desc"],
    ["no filters, page 3 by name", {}, 3, "name", "asc"],
    ["category insurance_agency + 'smith'", { gcid: "gcid:insurance_agency", q: "smith" }, 1, "name", "asc"],
    ["type location, claim unclaimed", { type: "location", claim: "unclaimed" }, 1, "confidence", "desc"],
  ] as const).map(([label, f, page, sort, dir]): ParityCase => ({
    name: `hierarchy: table ${label}`,
    legacy: (sb: any) => legacyTable(sb, f, page, sort, dir),
    api: { method: "POST", path: "/etl/console/hierarchy/table", body: { filters: f, page, sort, dir } },
    normalize: tableNorm,
  })),
  {
    name: "hierarchy: table by brand (br embed + or)",
    prepare: sample,
    legacy: (sb: any, c: any) => legacyTable(sb, { brand: c.brand }, 1, "created", "desc"),
    api: (c: any) => ({ method: "POST", path: "/etl/console/hierarchy/table", body: { filters: { brand: c.brand }, page: 1, sort: "created", dir: "desc" } }),
    normalize: tableNorm,
  },
  {
    name: "hierarchy: table by office (of embed)",
    prepare: sample,
    legacy: (sb: any, c: any) => legacyTable(sb, { office: c.office }, 1, "name", "asc"),
    api: (c: any) => ({ method: "POST", path: "/etl/console/hierarchy/table", body: { filters: { office: c.office }, page: 1, sort: "name", dir: "asc" } }),
    normalize: tableNorm,
  },
  {
    name: "hierarchy: type counts for insurance_agency",
    legacy: async (sb: any) => {
      const f = { gcid: "gcid:insurance_agency" };
      const res = await Promise.all(["brand", "location", "professional"].map(async (t) => {
        const { count, error } = await entityQuery(sb, f, { cols: "entity_id", head: true, typeOverride: t });
        if (error) throw error;
        return count ?? 0;
      }));
      return { brand: res[0], location: res[1], professional: res[2] };
    },
    api: { method: "POST", path: "/etl/console/hierarchy/counts", body: { gcid: "gcid:insurance_agency" } },
  },
  {
    name: "hierarchy: tree offices of a brand (+ advisor counts)",
    prepare: sample,
    legacy: async (sb: any, c: any) => {
      const { data, count, error } = await sb.from("exp_entity").select(`${ENTITY_COLS}, r:${SUBJ}!inner(object_entity_id)`, { count: "exact" })
        .eq("r.relationship_type", "OPERATES_UNDER").eq("r.status", "current").eq("r.object_entity_id", c.brand)
        .neq("status", "merged").eq("is_demo", false).order("display_name").order("entity_id").range(0, PAGE_SIZE - 1);
      if (error) throw error;
      const rows = await Promise.all((data ?? []).map(async (r: any) => ({ ...r, advisors: await incomingCount(sb, r.entity_id, "WORKS_AT") })));
      return { rows, total: count ?? 0 };
    },
    api: (c: any) => ({ method: "GET", path: `/etl/console/hierarchy/tree/offices?brand=${c.brand}&page=1` }),
  },
  {
    name: "hierarchy: tree advisors of an office",
    prepare: sample,
    legacy: async (sb: any, c: any) => {
      const { data, count, error } = await sb.from("exp_entity").select(`${ENTITY_COLS}, r:${SUBJ}!inner(object_entity_id)`, { count: "exact" })
        .eq("r.relationship_type", "WORKS_AT").eq("r.status", "current").eq("r.object_entity_id", c.office)
        .eq("entity_type", "professional").neq("status", "merged").eq("is_demo", false).order("display_name").order("entity_id").range(0, PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
    api: (c: any) => ({ method: "GET", path: `/etl/console/hierarchy/tree/advisors?office=${c.office}&page=1` }),
  },
  {
    name: "hierarchy: tree unofficed advisors of a brand (w is null)",
    prepare: sample,
    legacy: async (sb: any, c: any) => {
      const { data, count, error } = await sb.from("exp_entity")
        .select(`${ENTITY_COLS}, r:${SUBJ}!inner(object_entity_id), w:${SUBJ}(object_entity_id)`, { count: "exact" })
        .eq("r.relationship_type", "REPRESENTS").eq("r.status", "current").eq("r.object_entity_id", c.brand)
        .eq("w.relationship_type", "WORKS_AT").eq("w.status", "current").is("w", null)
        .eq("entity_type", "professional").neq("status", "merged").eq("is_demo", false).order("display_name").order("entity_id").range(0, PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
    api: (c: any) => ({ method: "GET", path: `/etl/console/hierarchy/tree/advisors?unofficed_brand=${c.brand}&page=1` }),
  },
  {
    // entity-detail-panel.tsx: the four queries, in the API's shape
    name: "hierarchy: entity detail (an office)",
    prepare: sample,
    legacy: async (sb: any, c: any) => {
      const id = c.office;
      const ent = await sb.from("exp_entity").select("entity_id, entity_type, display_name, status, claim_state, confidence, source, identity_keys, attributes, created_at").eq("entity_id", id).maybeSingle();
      const out = await sb.from("exp_rel").select("relationship_type, object_gcid, is_primary, obj:exp_entity!exp_rel_object_entity_id_fkey(entity_id, display_name, entity_type)").eq("subject_entity_id", id).eq("status", "current").limit(200);
      const types = ["WORKS_AT", "REPRESENTS", "OPERATES_UNDER", "FRANCHISE_OF", "BASED_AT", "MEMBER_OF", "SERVES_AREA"];
      const incoming = (await Promise.all(types.map(async (t) => {
        const { data, count } = await sb.from("exp_rel").select("subj:exp_entity!exp_rel_subject_entity_id_fkey(entity_id, display_name, entity_type)", { count: "exact" })
          .eq("object_entity_id", id).eq("relationship_type", t).eq("status", "current").range(0, 19);
        return { type: t, count: count ?? 0, rows: (data ?? []).map((r: any) => r.subj) };
      }))).filter((r) => r.count > 0);
      const staged = await sb.from("exp_etl_staging").select("stage_id, payload, field_tier, observed_at, detail_url").eq("entity_id", id).order("observed_at", { ascending: false, nullsFirst: false }).limit(5);
      return { entity: ent.data, out: out.data ?? [], outLabels: await gcidLabels(sb, (out.data ?? []).map((r: any) => r.object_gcid ?? "")), incoming, staged: staged.data ?? [] };
    },
    api: (c: any) => ({ method: "GET", path: `/etl/console/hierarchy/entities/${c.office}` }),
    normalize: (r: any) => ({ ...deep(r), out: sortRows(r.out), incoming: r.incoming.map((i: any) => ({ ...i, rows: sortRows(i.rows) })) }),
  },

  // ===== group 2: pipeline, site contract, source states, registry, category population =====
  {
    name: "pipeline: sources",
    legacy: async (sb: any) => (await sb.from("exp_etl_sources").select("source_id, source_domain, gcid")).data ?? [],
    api: { method: "GET", path: "/etl/console/pipeline/sources" },
    normalize: unordered,
  },
  {
    name: "pipeline: gcids with staging rows",
    prepare: async (sb: any) => [...new Set(((await sb.from("exp_etl_sources").select("gcid")).data ?? []).map((r: any) => r.gcid).filter(Boolean))].sort(),
    legacy: async (sb: any, gcids: string[]) => {
      const present = await Promise.all(gcids.map(async (g) => {
        const { count } = await sb.from("exp_etl_staging").select("stage_id", { count: "exact", head: true }).eq("gcid", g);
        return (count ?? 0) > 0 ? g : null;
      }));
      return present.filter(Boolean);
    },
    api: (gcids: string[]) => ({ method: "POST", path: "/etl/console/pipeline/staging-gcids", body: { gcids } }),
  },
  ...([["all", {}], ["financial_advisor", { gcid: "gcid:financial_advisor" }]] as const).map(([label, f]): ParityCase => ({
    name: `pipeline: funnel counts (${label})`,
    legacy: async (sb: any) => {
      const keys = ["pending", "matched", "created", "corroborated", "conflicted", "shallow", "rejected"];
      const out: Record<string, number> = {};
      for (const k of keys) {
        let q = sb.from("exp_etl_staging").select("stage_id", { count: "exact", head: true });
        if ((f as any).gcid) q = q.eq("gcid", (f as any).gcid);
        const { count, error } = await q.eq("resolution_status", k);
        if (error) throw error;
        out[k] = count ?? 0;
      }
      return out;
    },
    api: { method: "POST", path: "/etl/console/pipeline/funnel", body: { gcid: (f as any).gcid ?? null } },
  })),
  {
    name: "pipeline: staging page 0 (financial_advisor, created)",
    legacy: async (sb: any) => {
      const { data, error, count } = await sb.from("exp_etl_staging")
        .select("stage_id, source_id, gcid, entity_type, resolution_status, field_tier, observed_at, payload, identity_candidates", { count: "exact" })
        .eq("gcid", "gcid:financial_advisor").eq("resolution_status", "created")
        .order("observed_at", { ascending: false, nullsFirst: false }).range(0, 49);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
    api: { method: "POST", path: "/etl/console/pipeline/page", body: { gcid: "gcid:financial_advisor", status: "created", page: 0 } },
    // equal observed_at values come back in any order (the API adds stage_id as a tiebreak)
    normalize: (r: any) => ({ ...r, rows: sortRows(r.rows) }),
  },
  {
    name: "site contract panel (a hierarchy source)",
    prepare: async (sb: any) => (await sb.from("exp_etl_sources").select("source_id, source_domain, gcid").eq("role_in_discovery", "hierarchy_source").limit(1)).data?.[0],
    legacy: async (sb: any, s: any) => {
      const [c, src, l] = await Promise.all([
        sb.from("disco_site_contract").select("roster_pattern, detail_pattern, profile_sitemaps, detail_entity_type, field_floor, learned_at, site_contract:extraction->site_contract")
          .eq("domain", s.source_domain).eq("category_slug", s.gcid).order("learned_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("exp_etl_sources").select("status, crawl_method, fetch_tier, page_kinds, daily_quota, min_delay_seconds, test_results").eq("source_id", s.source_id).maybeSingle(),
        sb.from("disco_llm_requests").select("summary:response->site_contract_summary").eq("tool", "map_site").eq("prompt_input->>domain", s.source_domain)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return { contract: c.data, source: src.data, summary: l.error ? null : l.data?.summary ?? null };
    },
    api: (s: any) => ({ method: "GET", path: `/etl/console/site-contract?domain=${encodeURIComponent(s.source_domain)}&gcid=${encodeURIComponent(s.gcid)}&source_id=${s.source_id}` }),
  },
  {
    name: "source states (all sources)",
    prepare: async (sb: any) => (await sb.from("exp_etl_sources").select("source_id, source_domain")).data ?? [],
    legacy: async (sb: any, sources: any[]) => {
      const ids = sources.map((s) => s.source_id).sort();
      const domains = [...new Set(sources.map((s) => s.source_domain))];
      const [contracts, runs, reqs, props] = await Promise.all([
        sb.from("disco_site_contract").select("domain, category_slug, detail_pattern, version:extraction->site_contract->>version, record_source:extraction->site_contract->detail_route->>record_source").in("domain", domains),
        sb.from("exp_etl_runs").select("run_id, source_id, started_at").in("source_id", ids).is("finished_at", null),
        sb.from("disco_llm_requests").select("request_id, tool, status, domain:prompt_input->>domain, category:prompt_input->>category, step:response->>map_step, error:response->>error")
          .in("tool", ["map_site", "classify_method"]).in("prompt_input->>domain", domains).order("request_id", { ascending: false }).limit(1000),
        sb.from("disco_proposals").select("category_slug, domain:payload->>domain").eq("kind", "site_map").eq("state", "pending"),
      ]);
      const open = new Set((runs.data ?? []).map((r: any) => r.source_id));
      const queuedByDomain: Record<string, number | null> = {};
      for (const s of sources.filter((x) => open.has(x.source_id))) {
        const { count } = await sb.from("exp_etl_frontier").select("frontier_id", { count: "exact", head: true }).eq("domain", s.source_domain).in("status", ["queued", "fetching"]);
        queuedByDomain[s.source_domain] = count ?? null;
      }
      return { contracts: contracts.data ?? [], runs: runs.data ?? [], reqs: reqs.data ?? [], props: props.data ?? [], queuedByDomain };
    },
    api: (sources: any[]) => ({ method: "POST", path: "/etl/console/source-states", body: { sources } }),
    normalize: (r: any) => ({ ...r, contracts: sortRows(r.contracts), runs: sortRows(r.runs), props: sortRows(r.props) }),
  },
  {
    name: "registry: sources",
    legacy: async (sb: any) => (await sb.from("exp_etl_sources")
      .select("source_id, gcid, source_domain, source_type, authority_rank, freshness, hierarchy_sourceable, entity_types_available, field_coverage, field_count, daily_quota, min_delay_seconds, pull_window, access_method, robots_tos_status, status, notes, crawl_method")
      .order("gcid", { ascending: true }).order("authority_rank", { ascending: true, nullsFirst: false }).limit(2000)).data ?? [],
    api: { method: "GET", path: "/etl/console/registry/sources" },
    // equal (gcid, authority_rank) come back in any order
    normalize: unordered,
  },
  {
    name: "registry: contract field floors",
    legacy: async (sb: any) => (await sb.from("disco_site_contract").select("domain, category_slug, field_floor, learned_at").order("learned_at", { ascending: false }).limit(5000)).data ?? [],
    api: { method: "GET", path: "/etl/console/registry/field-floors" },
  },
  {
    name: "population: category search 'restaurant' (3 lookups)",
    legacy: async (sb: any) => {
      const base = () => sb.from("gbp_categories").select("gcid, display_name");
      const [byId, starts, contains] = await Promise.all([
        base().eq("gcid", "gcid:restaurant").limit(1),
        base().ilike("display_name", "restaurant%").order("display_name").limit(12),
        base().ilike("display_name", "%restaurant%").order("display_name").limit(12),
      ]);
      return { byId: byId.data ?? [], starts: starts.data ?? [], contains: contains.data ?? [] };
    },
    api: { method: "GET", path: "/etl/console/population/category-search?q=restaurant" },
  },
  ...(["gcid:financial_advisor", "gcid:insurance_agent"] as const).flatMap((g): ParityCase[] => [
    {
      name: `population ${g}: job`,
      legacy: async (sb: any) => { const { data, error } = await sb.from("exp_etl_jobs").select("job_id, gcid, stage, status, active").eq("gcid", g).maybeSingle(); if (error) throw error; return data ?? null; },
      api: { method: "GET", path: `/etl/console/population/job?gcid=${encodeURIComponent(g)}` },
    },
    {
      name: `population ${g}: sources`,
      legacy: async (sb: any) => (await sb.from("exp_etl_sources").select("source_id, gcid, source_domain, crawl_method, status, notes, role_in_discovery")
        .eq("gcid", g).eq("role_in_discovery", "hierarchy_source").order("authority_rank", { ascending: true, nullsFirst: false })).data ?? [],
      api: { method: "GET", path: `/etl/console/population/sources?gcid=${encodeURIComponent(g)}` },
      normalize: unordered,
    },
    {
      name: `population ${g}: pending proposal`,
      legacy: async (sb: any) => (await sb.from("disco_proposals").select("proposal_id, payload, decided_domains").eq("category_slug", g).eq("kind", "company_list").eq("state", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle()).data ?? null,
      api: { method: "GET", path: `/etl/console/population/proposal?gcid=${encodeURIComponent(g)}` },
    },
    {
      name: `population ${g}: runs + staged (1000-row cap on both)`,
      prepare: async (sb: any) => ((await sb.from("exp_etl_sources").select("source_id").eq("gcid", g).eq("role_in_discovery", "hierarchy_source")).data ?? []).map((r: any) => r.source_id),
      legacy: async (sb: any, ids: string[]) => ({
        runs: (await sb.from("exp_etl_runs").select("run_id, source_id, started_at, finished_at, pages_fetched, staged, created, matched, entities_yielded").in("source_id", ids).order("started_at", { ascending: false })).data ?? [],
        staged: (await sb.from("exp_etl_staging").select("source_id, entity_type, resolution_status").in("source_id", ids).limit(5000)).data ?? [],
      }),
      current: async (ids: string[]) => ({
        runs: await api.post("/etl/console/population/runs", { ids }),
        staged: await api.post("/etl/console/population/staged", { ids }),
      }),
      // staged: which 1000 rows come back is the same plan on both sides, but compare as sets
      normalize: (r: any) => ({ runs: r.runs, staged: sortRows(r.staged) }),
    },
    {
      name: `population ${g}: done pages per domain`,
      prepare: async (sb: any) => ((await sb.from("exp_etl_sources").select("source_domain").eq("gcid", g).eq("role_in_discovery", "hierarchy_source")).data ?? []).map((r: any) => r.source_domain),
      legacy: async (sb: any, domains: string[]) => Object.fromEntries(await Promise.all(domains.map(async (d) => {
        const { count } = await sb.from("exp_etl_frontier").select("frontier_id", { count: "exact", head: true }).eq("domain", d).eq("kind", "detail_page").eq("status", "done");
        return [d, count ?? 0];
      }))),
      api: (domains: string[]) => ({ method: "POST", path: "/etl/console/done-pages", body: { domains } }),
    },
    {
      name: `population ${g}: discovery running`,
      legacy: async (sb: any) => ((await sb.from("disco_jobs").select("job_id", { count: "exact", head: true }).eq("category_slug", g).eq("step", "discover").in("status", ["queued", "running", "awaiting_ai"])).count ?? 0) > 0,
      api: { method: "GET", path: `/etl/console/population/discover-running?gcid=${encodeURIComponent(g)}` },
    },
  ]),
];
