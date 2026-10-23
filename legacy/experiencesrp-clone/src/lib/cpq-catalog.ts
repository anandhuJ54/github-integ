/**
 * CPQ catalog — BUILT FROM THE DATABASE. No prices, package definitions or
 * pricing assumptions live in code: `loadCatalog()` reads exp_products (lanes,
 * flags, package_includes), exp_price_book (per-scope list prices) and
 * exp_pricing_config (global assumptions), then fills the runtime `CATALOG`
 * object in place. The object keeps the shape cpq-pricing / sales-cpq / the
 * quote builder already consume, so formulas stay in cpq-pricing.ts.
 * Until loaded every number is 0 and `CATALOG.loaded` is false.
 */
import { supabase } from "@/integrations/supabase/client";

/** Quote-state package ids (stable). Each maps to a lane='base' product_key. */
export type PackageId = "engage" | "amplify";
export type Lane = "base" | "included" | "product" | "enterprise" | "passthrough" | "retired";

export interface CpqPackage {
  id: PackageId;
  /** exp_products.product_key of this base package. */
  productKey: string;
  name: string;
  tagline: string;
  professionalMonthly: number;
  locationMonthly: number;
  /** Display names of package_includes. */
  includes: string[];
  /** package_includes product_keys (billed at $0 inside this package). */
  includeKeys: string[];
}

export interface CatalogProduct {
  product_key: string;
  name: string;
  description: string | null;
  lane: Lane;
  creditable: boolean;
  discountable: boolean;
  passthrough: boolean;
  min_charge: number | null;
  active: boolean;
  prices: BookPriceRow[];
}

export interface PricingAssumptions {
  llmCostBasis: number;
  creditPrice: number;
  platformFeeRate1: number;
  platformFeeRate2: number;
  platformFeeBand: number;
  platformFeeCap: number;
  /** Percent (e.g. 15). Above this a voluntary write-down needs manager approval. */
  discountFloorSeller: number;
  /** Percent (e.g. 25). Hard ceiling for a voluntary write-down. */
  discountFloorManager: number;
  /** Percent (e.g. 60). Lowest credit price as a share of list. */
  creditFloorPct: number;
  /** Units (professionals + locations) → percent off; sorted by min descending. */
  volumeTiers: { min: number; pct: number }[];
}

type Named = { id: string; name: string };

/** Base-package product_key per quote-state package id (keys are frozen). */
export const PACKAGE_PRODUCT_KEYS: Record<PackageId, string> = { engage: "nora", amplify: "nora_amplify" };

const zeroConfig = (): PricingAssumptions => ({
  llmCostBasis: 0, creditPrice: 0, platformFeeRate1: 0, platformFeeRate2: 0, platformFeeBand: 0, platformFeeCap: 0,
  discountFloorSeller: 0, discountFloorManager: 0, creditFloorPct: 0, volumeTiers: [],
});
const pkg = (id: PackageId): CpqPackage => ({ id, productKey: PACKAGE_PRODUCT_KEYS[id], name: "", tagline: "", professionalMonthly: 0, locationMonthly: 0, includes: [], includeKeys: [] });

/** Runtime catalog. Mutated in place by applyCatalog(); never hand-edit numbers here. */
export const CATALOG = {
  loaded: false,
  packages: { engage: pkg("engage"), amplify: pkg("amplify") } as Record<PackageId, CpqPackage>,
  products: {} as Record<string, CatalogProduct>,
  config: zeroConfig(),
  addOns: {
    listings: { id: "listings", name: "", professionalAnnual: 0, locationAnnual: 0, includedByAmplify: false },
    voce: { id: "voce", name: "", perUserAnnual: 0, includedByAmplify: false },
    sponsoredSearch: { id: "sponsored", name: "", monthlyPerZipStart: 0 },
    conversionAgents: { id: "conversion_agents", name: "", professionalAnnual: 0, locationAnnual: 0, includedByAmplify: false },
  },
  enterprise: {
    // Platform fee is now tiered on net (exp_pricing_config); there is no per-user fee.
    platformFee: { id: "platformFee", name: "Platform fee", required: true, perUserAnnual: 0, includeModeAllowed: true },
    // Credit quantities per user/agent are product sizing, not price.
    engageCredits: { id: "engageCredits", name: "Engage Credits", creditsPerUser: 4000, rateBasis: "per-user" },
    amplifyCredits: { id: "amplifyCredits", name: "Amplify Credits", creditsPerUser: 6000, rateBasis: "per-user" },
    voceCredits: { id: "voceCredits", name: "VOCE Credits", creditsPerUser: 100, rateBasis: "per-credit" },
    voceEnterpriseFirst: { id: "enterprise_first_publishing", name: "", requires: "voceCredits", minimumAnnual: 0, cannotWaive: true },
    conversionAgents: { id: "enterpriseConversionAgents", name: "", creditsPerAgent: 500, rateBasis: "package-total" },
    sponsoredSearch: { id: "enterpriseSponsoredSearch", name: "", rateBasis: "per-zip-month", monthlyPerZipStart: 0 },
    campaigns5Pack: { id: "campaigns", name: "", annual: 0 } as Named & { annual: number },
    benchmarkCampaign: { id: "benchmark", name: "", annual: 0 } as Named & { annual: number },
    customIntegration: { id: "custom_integration", name: "", annual: 0 } as Named & { annual: number },
    customDevelopment: { id: "custom_development", name: "", hourly: 0 },
  },
};

export const STEPS = ["Customer", "Entitlements", "Pricing", "Terms", "Approval", "Preview"];

/* ─────────── Building from rows (pure) ─────────── */
export type ProductRow = {
  product_key: string; name: string | null; description: string | null; lane: string | null;
  price_monthly: number | null; price_monthly_location: number | null; active: boolean | null;
  creditable: boolean | null; discountable: boolean | null; passthrough: boolean | null;
  min_charge: number | null; package_includes: unknown;
};
export type BookPriceRow = { product_key: string | null; scope: string | null; unit: string | null; list_price: number | null; billing_type: string | null };
export type ConfigRow = { key: string; value: number | string | null; value_json: unknown };
export type CatalogRows = { products: ProductRow[]; book: BookPriceRow[]; config: ConfigRow[] };

const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
/** Annualise a price-book list price: monthly units ×12, everything else as-is. */
const annual = (r: BookPriceRow | undefined) => (r ? n(r.list_price) * (["month"].includes(r.unit ?? "") ? 12 : 1) : 0);

export function catalogPrice(productKey: string, scope?: string): BookPriceRow | null {
  const rows = CATALOG.products[productKey]?.prices ?? [];
  return (scope ? rows.find((row) => row.scope === scope) : undefined) ?? rows[0] ?? null;
}

export function catalogAnnualRate(productKey: string, scope?: string): number {
  return annual(catalogPrice(productKey, scope) ?? undefined);
}

export function applyCatalog(rows: CatalogRows): typeof CATALOG {
  const products: Record<string, CatalogProduct> = {};
  for (const p of rows.products) {
    products[p.product_key] = {
      product_key: p.product_key,
      name: p.name ?? p.product_key,
      description: p.description,
      lane: (p.lane ?? "product") as Lane,
      creditable: !!p.creditable,
      discountable: p.discountable !== false,
      passthrough: !!p.passthrough,
      min_charge: p.min_charge == null ? null : n(p.min_charge),
      active: p.active !== false,
      prices: rows.book.filter((r) => r.product_key === p.product_key),
    };
  }
  const name = (k: string) => products[k]?.name ?? k;
  const book = (k: string, scope?: string) => {
    const c = rows.book.filter((r) => r.product_key === k);
    return (scope ? c.find((r) => r.scope === scope) : undefined) ?? c[0];
  };
  const cfg = new Map(rows.config.map((r) => [r.key, r]));
  const c = (k: string) => n(cfg.get(k)?.value);
  const tiersRaw = cfg.get("volume_tiers")?.value_json;
  const config: PricingAssumptions = {
    llmCostBasis: c("llm_cost_basis"),
    creditPrice: c("credit_price"),
    platformFeeRate1: c("platform_fee_rate_1"),
    platformFeeRate2: c("platform_fee_rate_2"),
    platformFeeBand: c("platform_fee_band"),
    platformFeeCap: c("platform_fee_cap"),
    discountFloorSeller: c("discount_floor_seller"),
    discountFloorManager: c("discount_floor_manager"),
    creditFloorPct: c("credit_floor_pct"),
    volumeTiers: (Array.isArray(tiersRaw) ? (tiersRaw as { min: unknown; pct: unknown }[]) : [])
      .map((t) => ({ min: n(t.min), pct: n(t.pct) }))
      .sort((a, b) => b.min - a.min),
  };

  for (const id of ["engage", "amplify"] as PackageId[]) {
    const key = PACKAGE_PRODUCT_KEYS[id];
    const row = rows.products.find((p) => p.product_key === key);
    const includeKeys = Array.isArray(row?.package_includes) ? (row!.package_includes as string[]) : [];
    Object.assign(CATALOG.packages[id], {
      name: row?.name ?? key,
      tagline: row?.description ?? "",
      professionalMonthly: n(book(key, "professional")?.list_price ?? row?.price_monthly),
      locationMonthly: n(book(key, "location")?.list_price ?? row?.price_monthly_location),
      includes: includeKeys.map(name),
      includeKeys,
    });
  }
  const ampInc = CATALOG.packages.amplify.includeKeys;
  Object.assign(CATALOG.addOns.listings, {
    name: name("listings"), professionalAnnual: annual(book("listings", "professional")), locationAnnual: annual(book("listings", "location")), includedByAmplify: ampInc.includes("listings"),
  });
  // VOCE is credit-billed (lane product, creditable); there is no per-user list price.
  Object.assign(CATALOG.addOns.voce, { name: name("voce"), perUserAnnual: 0, includedByAmplify: ampInc.includes("voce") });
  Object.assign(CATALOG.addOns.sponsoredSearch, { name: name("sponsored"), monthlyPerZipStart: n(book("sponsored", "professional")?.list_price) });
  Object.assign(CATALOG.addOns.conversionAgents, {
    name: name("conversion_agents"), professionalAnnual: annual(book("conversion_agents", "professional")), locationAnnual: annual(book("conversion_agents", "location")), includedByAmplify: ampInc.includes("conversion_agents"),
  });
  const E = CATALOG.enterprise;
  Object.assign(E.voceEnterpriseFirst, { name: name("enterprise_first_publishing"), minimumAnnual: n(products["enterprise_first_publishing"]?.min_charge) });
  Object.assign(E.conversionAgents, { name: name("conversion_agents") });
  Object.assign(E.sponsoredSearch, { name: name("sponsored"), monthlyPerZipStart: CATALOG.addOns.sponsoredSearch.monthlyPerZipStart });
  Object.assign(E.campaigns5Pack, {
    name: name("campaigns"),
    annual: rows.book.filter((r) => r.product_key === "campaigns").reduce((sum, r) => sum + n(r.list_price), 0),
  });
  Object.assign(E.benchmarkCampaign, { name: name("benchmark"), annual: annual(book("benchmark")) });
  Object.assign(E.customIntegration, { name: name("custom_integration"), annual: annual(book("custom_integration")) });
  Object.assign(E.customDevelopment, { name: name("custom_development"), hourly: n(book("custom_development")?.list_price) });

  CATALOG.products = products;
  CATALOG.config = config;
  CATALOG.loaded = true;
  return CATALOG;
}

/** Lane facts for a quote line's product key; unknown keys are treated as enterprise items. */
export function laneOf(productKey: string): CatalogProduct {
  const pk = (PACKAGE_PRODUCT_KEYS as Record<string, string>)[productKey] ?? productKey;
  return (
    CATALOG.products[pk] ?? { product_key: pk, name: pk, description: null, lane: "enterprise", creditable: false, discountable: true, passthrough: false, min_charge: null, active: true, prices: [] }
  );
}

/** Reads the three catalog tables and fills CATALOG. */
export async function loadCatalog(): Promise<typeof CATALOG> {
  const [p, b, c] = await Promise.all([
    supabase
      .from("exp_products")
      .select("product_key,name,description,lane,price_monthly,price_monthly_location,active,creditable,discountable,passthrough,min_charge,package_includes"),
    supabase.from("exp_price_book").select("product_key,scope,unit,list_price,billing_type"),
    supabase.from("exp_pricing_config").select("key,value,value_json"),
  ]);
  if (p.error) throw p.error;
  if (b.error) throw b.error;
  if (c.error) throw c.error;
  return applyCatalog({ products: (p.data ?? []) as ProductRow[], book: (b.data ?? []) as BookPriceRow[], config: (c.data ?? []) as ConfigRow[] });
}
