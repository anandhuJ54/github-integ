import { api } from "@v3/ui/lib/server-fn";

/* ────────────────────────────────────────────────────────────
   Shared live loaders for the depth-pass console surfaces.
   Real-only policy: every number here comes from a table read.
   Absent data surfaces as null and the UI renders an honest
   "instrument to activate" state — never a fabricated figure.
   Through FastAPI, as the signed-in user: the money reads (products, price book, contracts,
   entitlements) from sales (/sales/catalog/*), the platform counts and the discovery job list
   from etl (/etl/platform/*). Each loader is one request; counts are exact.
   ──────────────────────────────────────────────────────────── */

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
  const res = await api.get<{ products: ProductRow[]; price_book: PriceBookRow[] }>("/sales/catalog/product-catalog");

  const priceRows = res.price_book ?? [];
  const byKey = new Map<string, PriceBookRow[]>();
  for (const r of priceRows) {
    const list = byKey.get(r.product_key) ?? [];
    list.push(r);
    byKey.set(r.product_key, list);
  }

  const entries: ProductCatalogEntry[] = (res.products ?? []).map((p) => ({
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
  const res = await api.get<{
    contracts: ContractRow[];
    entitlements: EntitlementRow[];
    products: { product_key: string; name: string }[];
  }>("/sales/catalog/billing");

  const all = res.contracts ?? [];
  const real = all.filter((c) => !c.is_demo);
  const demo = all.filter((c) => c.is_demo);
  const entitlements = res.entitlements ?? [];
  const productNames = new Map((res.products ?? []).map((p) => [p.product_key, p.name]));

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

export type ReportMetrics = {
  categories: number;
  launched: number;
  fieldModels: number;
  graphNodes: number;
  scored: number;
  orgs: number;
  pros: number;
  registry: number;
  contracts: number;
  entitlements: number;
  devTeams: number;
  devProjects: number;
  leads: number;
  pages: number;
};

/** Fourteen exact counts, one request (etl: GET /etl/platform/report-metrics). */
export async function loadReportMetrics(): Promise<ReportMetrics> {
  const m = await api.get<ReportMetrics>("/etl/platform/report-metrics");
  return {
    categories: m.categories,
    launched: m.launched,
    fieldModels: m.fieldModels,
    graphNodes: m.graphNodes,
    scored: m.scored,
    orgs: m.orgs,
    pros: m.pros,
    registry: m.registry,
    contracts: m.contracts,
    entitlements: m.entitlements,
    devTeams: m.devTeams,
    devProjects: m.devProjects,
    leads: m.leads,
    pages: m.pages,
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

export async function loadPipelineHealth() {
  const r = await api.get<{
    jobs: DiscoJob[];
    counts: {
      proposals: number;
      llm: number;
      siteContracts: number;
      engineRequests: number;
      engineSnapshots: number;
      enginePrompts: number;
    };
  }>("/etl/platform/pipeline-health");
  const { proposals, llm, siteContracts: contract, engineRequests: engineReq, engineSnapshots: engineSnap, enginePrompts: prompts } =
    r.counts;

  const rows = r.jobs ?? [];
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

/** Six exact organizations counts, one request (etl: GET /etl/platform/org-stats). */
export async function loadOrgStats() {
  const { total, real, demo, claimed, scored, gbp } = await api.get<{
    total: number;
    real: number;
    demo: number;
    claimed: number;
    scored: number;
    gbp: number;
  }>("/etl/platform/org-stats");
  return { total, real, demo, claimed, scored, gbp };
}
