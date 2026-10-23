import { supabase } from "@v3/ui/integrations/supabase/client";

/* ────────────────────────────────────────────────────────────
   Shared live loaders for the depth-pass console surfaces.
   Real-only policy: every number here comes from a table read.
   Absent data surfaces as null and the UI renders an honest
   "instrument to activate" state — never a fabricated figure.
   ──────────────────────────────────────────────────────────── */

const db = supabase as unknown as {
  from: (table: string) => any;
};

async function countOf(table: string, apply?: (q: any) => any): Promise<number> {
  let q: any = db.from(table).select("*", { count: "exact", head: true });
  if (apply) q = apply(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${(Number(n) * 100).toFixed(digits)}%`;

export const num = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");

/* ─────────── Products + price book ─────────── */

export type ProductRow = {
  product_key: string;
  name: string;
  description: string | null;
  entity_scope: string | null;
  billing_type: string | null;
  price_monthly: number | null;
  price_monthly_location: number | null;
  price_unit: number | null;
  is_addon: boolean | null;
  active: boolean | null;
  sort: number | null;
};

export type PriceBookRow = {
  id: string;
  product_key: string;
  scope: string | null;
  unit: string | null;
  list_price: number | null;
  contract_price: number | null;
  billing_type: string | null;
  cost_type: string | null;
  cost_value: number | null;
  floor_margin_pct: number | null;
  discount_tiers: unknown;
  description: string | null;
};

export type ProductCatalogEntry = ProductRow & { pricing: PriceBookRow[] };

export async function loadProductCatalog() {
  const [prods, pb] = await Promise.all([
    supabase
      .from("exp_products")
      .select(
        "product_key, name, description, entity_scope, billing_type, price_monthly, price_monthly_location, price_unit, is_addon, active, sort",
      )
      .order("sort", { ascending: true }),
    supabase
      .from("exp_price_book")
      .select(
        "id, product_key, scope, unit, list_price, contract_price, billing_type, cost_type, cost_value, floor_margin_pct, discount_tiers, description",
      )
      .order("product_key", { ascending: true }),
  ]);
  if (prods.error) throw prods.error;
  if (pb.error) throw pb.error;

  const priceRows = (pb.data ?? []) as PriceBookRow[];
  const byKey = new Map<string, PriceBookRow[]>();
  for (const r of priceRows) {
    const list = byKey.get(r.product_key) ?? [];
    list.push(r);
    byKey.set(r.product_key, list);
  }

  const entries: ProductCatalogEntry[] = ((prods.data ?? []) as ProductRow[]).map((p) => ({
    ...p,
    pricing: byKey.get(p.product_key) ?? [],
  }));

  const margins = priceRows
    .map((r) => r.floor_margin_pct)
    .filter((v): v is number => v != null);

  return {
    entries,
    priceRows,
    stats: {
      total: entries.length,
      active: entries.filter((p) => p.active).length,
      addons: entries.filter((p) => p.is_addon).length,
      pricedScopes: priceRows.length,
      unpriced: entries.filter((p) => p.pricing.length === 0).length,
      floorMin: margins.length ? Math.min(...margins) : null,
      floorMax: margins.length ? Math.max(...margins) : null,
    },
  };
}

/* ─────────── Billing ─────────── */

export type ContractRow = {
  id: string;
  name: string | null;
  org_id: string | null;
  account_id: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  mrr: number | null;
  net: number | null;
  cost: number | null;
  margin_pct: number | null;
  approval_state: string | null;
  token_package: number | null;
  is_demo: boolean | null;
};

export type EntitlementRow = {
  id: string;
  subject_type: string | null;
  subject_id: string | null;
  product_key: string | null;
  state: string | null;
  source: string | null;
  tokens_included: number | null;
  granted_at: string | null;
  expires_at: string | null;
};

export async function loadBilling() {
  const [contracts, ents, products] = await Promise.all([
    supabase
      .from("exp_contracts")
      .select(
        "id, name, org_id, account_id, status, start_date, end_date, mrr, net, cost, margin_pct, approval_state, token_package, is_demo",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("exp_entitlements")
      .select(
        "id, subject_type, subject_id, product_key, state, source, tokens_included, granted_at, expires_at",
      )
      .order("granted_at", { ascending: false }),
    supabase.from("exp_products").select("product_key, name"),
  ]);
  if (contracts.error) throw contracts.error;
  if (ents.error) throw ents.error;
  if (products.error) throw products.error;

  const all = (contracts.data ?? []) as ContractRow[];
  const real = all.filter((c) => !c.is_demo);
  const demo = all.filter((c) => c.is_demo);
  const entitlements = (ents.data ?? []) as EntitlementRow[];
  const productNames = new Map(
    ((products.data ?? []) as { product_key: string; name: string }[]).map((p) => [
      p.product_key,
      p.name,
    ]),
  );

  const sum = (rows: ContractRow[], key: "mrr" | "net") =>
    rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const activeReal = real.filter((c) => c.status === "active");
  const activeDemo = demo.filter((c) => c.status === "active");

  const stateCounts = entitlements.reduce<Record<string, number>>((acc, e) => {
    const k = e.state ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    contracts: all,
    real,
    demo,
    entitlements,
    productNames,
    stats: {
      realContracts: real.length,
      realActive: activeReal.length,
      /** null when there is no real (non-demo) contract to derive from. */
      realMrr: activeReal.length ? sum(activeReal, "mrr") : null,
      realArr: activeReal.length ? sum(activeReal, "mrr") * 12 : null,
      realNet: activeReal.length ? sum(activeReal, "net") : null,
      demoContracts: demo.length,
      demoMrr: activeDemo.length ? sum(activeDemo, "mrr") : null,
      entitlementsTotal: entitlements.length,
      entitlementsActive: stateCounts["active"] ?? 0,
      entitlementsUnconfigured: stateCounts["entitled_unconfigured"] ?? 0,
      tokensCommitted: entitlements.reduce((a, e) => a + Number(e.tokens_included ?? 0), 0),
      stateCounts,
    },
  };
}

/* ─────────── Reports index ─────────── */

export async function loadReportMetrics() {
  const [
    categories,
    launched,
    fieldModels,
    graphNodes,
    scored,
    orgs,
    pros,
    registry,
    contracts,
    entitlements,
    devTeams,
    devProjects,
    leads,
    pages,
  ] = await Promise.all([
    countOf("gbp_categories"),
    countOf("gbp_categories", (q) => q.eq("is_launched", true)),
    countOf("exp_category_schema", (q) => q.eq("is_launched", true)),
    countOf("graph_nodes"),
    countOf("search_rank_scores"),
    countOf("organizations", (q) => q.not("is_demo", "is", true)),
    countOf("professionals", (q) => q.not("is_demo", "is", true)),
    countOf("exp_vertical_node_registry"),
    countOf("exp_contracts", (q) => q.not("is_demo", "is", true)),
    countOf("exp_entitlements", (q) => q.eq("state", "active")),
    countOf("exp_dev_teams"),
    countOf("exp_dev_projects"),
    countOf("exp_web_leads"),
    countOf("exp_web_pages"),
  ]);

  return {
    categories,
    launched,
    fieldModels,
    graphNodes,
    scored,
    orgs,
    pros,
    registry,
    contracts,
    entitlements,
    devTeams,
    devProjects,
    leads,
    pages,
  };
}

/* ─────────── Nora OS / discovery pipeline ─────────── */

export type DiscoJob = {
  job_id: number;
  category_slug: string | null;
  step: string | null;
  status: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function loadNoraOs() {
  const [jobs, proposals, llm, contract, engineReq, engineSnap, prompts] = await Promise.all([
    supabase
      .from("disco_jobs")
      .select("job_id, category_slug, step, status, note, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100),
    countOf("disco_proposals"),
    countOf("disco_llm_requests"),
    countOf("disco_site_contract"),
    countOf("exp_engine_requests"),
    countOf("exp_engine_snapshots"),
    countOf("exp_engine_prompts"),
  ]);
  if (jobs.error) throw jobs.error;

  const rows = (jobs.data ?? []) as unknown as DiscoJob[];
  const byStatus = rows.reduce<Record<string, number>>((acc, j) => {
    const k = j.status ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const byStep = rows.reduce<Record<string, number>>((acc, j) => {
    const k = j.step ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    jobs: rows,
    byStatus,
    byStep,
    counts: {
      proposals,
      llm,
      siteContracts: contract,
      engineRequests: engineReq,
      engineSnapshots: engineSnap,
      enginePrompts: prompts,
    },
    lastTick: rows[0]?.updated_at ?? null,
    awaitingHuman: rows.filter((j) => j.status === "awaiting_human").length,
  };
}

/* ─────────── Organizations ─────────── */

export type OrgRow = {
  id: string;
  name: string;
  slug: string | null;
  gcid: string | null;
  entity_type: string | null;
  parent_org_id: string | null;
  claimed: boolean | null;
  is_active: boolean | null;
  is_demo: boolean | null;
  search_rank_score: number | null;
  score_updated_at: string | null;
  address_city: string | null;
  address_state: string | null;
  phone: string | null;
  website_url: string | null;
  hierarchy_depth: number | null;
  gbp_connected: boolean | null;
};

export const ORG_COLUMNS =
  "id, name, slug, gcid, entity_type, parent_org_id, claimed, is_active, is_demo, search_rank_score, score_updated_at, address_city, address_state, phone, website_url, hierarchy_depth, gbp_connected";

export async function loadOrgStats() {
  const [total, real, demo, claimed, scored, gbp] = await Promise.all([
    countOf("organizations"),
    countOf("organizations", (q) => q.not("is_demo", "is", true)),
    countOf("organizations", (q) => q.eq("is_demo", true)),
    countOf("organizations", (q) => q.eq("claimed", true)),
    countOf("organizations", (q) => q.not("search_rank_score", "is", null)),
    countOf("organizations", (q) => q.eq("gbp_connected", true)),
  ]);
  return { total, real, demo, claimed, scored, gbp };
}
