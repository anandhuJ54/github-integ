/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as admin from "@v3/sales/lib/catalog-admin";
import * as cpq from "@v3/sales/lib/cpq-catalog";
import * as depth from "@v3/sales/lib/cpq-depth";
import * as comp from "@v3/sales/lib/comp";
import * as cs from "@v3/admin/lib/console-surfaces";
import * as ph from "@v3/etl/lib/pipeline-health";

// sales S1 catalog & pricing: catalog-admin.ts, cpq-catalog.ts, cpq-depth.ts, comp.ts (sales) and
// @v3/ui console-surfaces.ts (money loaders → sales /sales/catalog/*, platform counts → etl
// /etl/platform/*). The legacy lib (direct supabase-js, from PARITY_LEGACY_REF) against the
// current one (same lib, rows from FastAPI), plus the raw rows of the quote-builder reads against
// their endpoint, so every price / numeric is compared as the page received it.
// Reads only: the writes (product insert/update, pricing-config value, volume tiers, comp rate)
// change real prices and are covered by compiled-SQL / fake-connection unit tests
// (sales/queries/catalog_test.py), never run.
// Rows at port time: products 25, price book 42, pricing config 10, comp plans 4, contracts 12,
// entitlements 12; graph_nodes ~3.0M (exact count ~2 s as authenticated, under the 8 s timeout,
// so the legacy count completes too); disco_jobs is RLS-empty for a non-architect user.
const ADMIN = "surface-ui/sales/src/lib/catalog-admin.ts";
const CPQ = "surface-ui/sales/src/lib/cpq-catalog.ts";
const COMP = "surface-ui/sales/src/lib/comp.ts";
const CS = "surface-ui/_base/src/lib/console-surfaces.ts";

const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...(rows ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
/** Rows compared as a set: for reads with no ORDER BY or a sort key with ties. */
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);

const lib = (
  module: string,
  name: string,
  exp: string,
  current: () => Promise<unknown>,
  extra: Partial<ParityCase> = {},
): ParityCase => ({ name, legacyModule: module, legacyExport: exp, legacyArgs: [], current, ...extra });

/* ─── catalog-admin.ts ─── */
const adminCases: ParityCase[] = [
  // exp_products.sort: 24 distinct values over 25 rows (one tie)
  lib(ADMIN, "catalog admin: products", "listAdminProducts", () => admin.listAdminProducts(), { normalize: unordered }),
  lib(ADMIN, "catalog admin: pricing config", "listPricingConfig", () => admin.listPricingConfig()),
];

/* ─── cpq-catalog.ts / cpq-depth.ts ─── */
const cpqCases: ParityCase[] = [
  // the filled runtime CATALOG (packages, add-ons, enterprise, config, products with prices)
  lib(CPQ, "cpq: loadCatalog → CATALOG", "loadCatalog", () => cpq.loadCatalog()),
  {
    // cpq-catalog.ts loadCatalog's three reads, verbatim (no ORDER BY: compared as sets)
    name: "cpq: catalog rows → GET /sales/catalog/cpq",
    legacy: async (sb: any) => {
      const [p, b, c] = await Promise.all([
        sb
          .from("exp_products")
          .select("product_key,name,description,lane,price_monthly,price_monthly_location,active,creditable,discountable,passthrough,min_charge,package_includes"),
        sb.from("exp_price_book").select("product_key,scope,unit,list_price,billing_type"),
        sb.from("exp_pricing_config").select("key,value,value_json"),
      ]);
      if (p.error) throw p.error;
      if (b.error) throw b.error;
      if (c.error) throw c.error;
      return { products: p.data ?? [], book: b.data ?? [], config: c.data ?? [] };
    },
    api: { method: "GET", path: "/sales/catalog/cpq" },
    normalize: (r: any) => (r && typeof r === "object" ? { products: unordered(r.products), book: unordered(r.book), config: unordered(r.config) } : r),
  },
  {
    // cpq-depth.ts loadPricingContext, verbatim (its module imports siblings by relative path,
    // so it is copied here rather than loaded from PARITY_LEGACY_REF)
    name: "cpq depth: loadPricingContext",
    legacy: async (sb: any) => {
      const [b, p] = await Promise.all([
        sb
          .from("exp_price_book")
          .select("product_key,scope,unit,list_price,billing_type,cost_type,cost_value,floor_margin_pct,discount_tiers,credit_cost_per_unit"),
        sb
          .from("exp_products")
          .select("product_key,name,billing_type,consumes_llm_credits,est_credits_per_professional,est_credits_per_location")
          .order("sort"),
      ]);
      if (b.error) throw b.error;
      if (p.error) throw p.error;
      return { tiers: [], book: b.data ?? [], products: p.data ?? [] };
    },
    current: () => depth.loadPricingContext(),
    // book has no ORDER BY; products.sort has one tie
    normalize: (r: any) => (r && typeof r === "object" ? { ...r, book: unordered(r.book), products: unordered(r.products) } : r),
  },
];

/* ─── comp.ts ─── */
const compCases: ParityCase[] = [lib(COMP, "comp: plans", "loadCompPlans", () => comp.loadCompPlans())];

/* ─── @v3/ui console-surfaces.ts ─── */
/** loadProductCatalog: products.sort has one tie, price_book.product_key repeats per scope. */
const productCatalogOrder = (r: any) =>
  r && typeof r === "object"
    ? {
        ...r,
        entries: sortRows((r.entries ?? []).map((e: any) => ({ ...e, pricing: sortRows(e.pricing) }))),
        priceRows: sortRows(r.priceRows),
      }
    : r;
/** loadBilling: contracts.created_at has 6 distinct values over 12 rows, entitlements.granted_at 2 over 12. */
const billingOrder = (r: any) =>
  r && typeof r === "object"
    ? {
        ...r,
        contracts: sortRows(r.contracts),
        real: sortRows(r.real),
        demo: sortRows(r.demo),
        entitlements: sortRows(r.entitlements),
      }
    : r;
/** loadNoraOs (now loadPipelineHealth): disco_jobs.updated_at ties; lastTick is the max either way. */
const noraOrder = (r: any) => (r && typeof r === "object" ? { ...r, jobs: sortRows(r.jobs) } : r);

const csCases: ParityCase[] = [
  lib(CS, "console: product catalog (sales)", "loadProductCatalog", () => cs.loadProductCatalog(), { normalize: productCatalogOrder }),
  lib(CS, "console: billing (sales)", "loadBilling", () => cs.loadBilling(), { normalize: billingOrder }),
  lib(CS, "console: report metrics, 14 exact counts (etl)", "loadReportMetrics", () => cs.loadReportMetrics()),
  lib(CS, "console: pipeline health, disco jobs + counts (etl)", "loadNoraOs", () => ph.loadPipelineHealth(), { normalize: noraOrder }),
  lib(CS, "console: organization stats (etl)", "loadOrgStats", () => cs.loadOrgStats()),
];

export const cases: ParityCase[] = [...adminCases, ...cpqCases, ...compCases, ...csCases];
