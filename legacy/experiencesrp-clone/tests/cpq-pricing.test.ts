import { describe, expect, it } from "bun:test";
import { initialState, normalizePackageInclusions } from "../src/lib/cpq-state";
import {
  calculateAddOnsAnnual,
  calculateBundleAnnual,
  calculateEnterpriseAnnual,
  calculateSummary,
  validateState,
  voceCreditsCost,
  voceEnterpriseFirstCost,
  volumeTierPct,
  platformFee,
  priceDeal,
} from "../src/lib/cpq-pricing";
import { applyCatalog } from "../src/lib/cpq-catalog";
import { buildLineItems } from "../src/lib/sales-cpq";

/* Fixture = live reconciled catalog rows (exp_products / exp_price_book / exp_pricing_config). */
const P = (product_key: string, lane: string, extra: Record<string, unknown> = {}) => ({
  product_key, name: product_key, description: null, lane, price_monthly: null, price_monthly_location: null, active: true,
  creditable: false, discountable: true, passthrough: false, min_charge: null, package_includes: null, ...extra,
});
const SKILLS = ["expertise_graph", "reviews", "public_profile", "network", "map_rank_tracker", "llm_monitor", "website_analysis", "multipost"];
const B = (product_key: string, scope: string, list_price: number, unit = "month") => ({ product_key, scope, unit, list_price, billing_type: "subscription" });
applyCatalog({
  products: [
    P("nora", "base", { name: "NORA Engage", package_includes: SKILLS }),
    P("nora_amplify", "base", { name: "NORA Amplify", package_includes: [...SKILLS, "listings", "voce"] }),
    P("listings", "product", { name: "Listings Management" }),
    P("voce", "product", { name: "VOCE — AI Publishing Platform", creditable: true }),
    P("sponsored", "product", { name: "Sponsored Search" }),
    P("conversion_agents", "product", { name: "Conversion Agents" }),
    P("enterprise_first_publishing", "enterprise", { name: "VOCE First-Party Publishing", min_charge: 15000 }),
    P("voce_boosts", "passthrough", { name: "VOCE Boosts", passthrough: true, discountable: false }),
    ...SKILLS.map((k) => P(k, "included", { discountable: false })),
  ],
  book: [
    B("nora", "professional", 59), B("nora", "location", 99), B("nora_amplify", "professional", 89), B("nora_amplify", "location", 129),
    B("listings", "professional", 29), B("listings", "location", 99), B("sponsored", "professional", 59), B("sponsored", "location", 129),
    B("conversion_agents", "professional", 69), B("conversion_agents", "location", 99), B("custom_development", "enterprise", 125, "hour"),
  ],
  config: [
    ["llm_cost_basis", 0.02], ["credit_price", 0.14], ["platform_fee_rate_1", 0.2], ["platform_fee_rate_2", 0.1], ["platform_fee_band", 50000],
    ["platform_fee_cap", 50000], ["discount_floor_seller", 15], ["discount_floor_manager", 25], ["credit_floor_pct", 60],
  ].map(([key, value]) => ({ key: key as string, value: value as number, value_json: null }))
    .concat([{ key: "volume_tiers", value: null as unknown as number, value_json: [{ min: 1000, pct: 40 }, { min: 500, pct: 30 }, { min: 250, pct: 25 }, { min: 100, pct: 20 }, { min: 50, pct: 15 }, { min: 25, pct: 10 }, { min: 0, pct: 0 }] }]),
});

const base = () => {
  const s = initialState();
  s.addOns.sponsoredSearchSelected = false;
  s.addOns.conversionAgentsSelected = false;
  return s;
};
const amplifySample = () => {
  const s = base();
  s.packageId = "amplify";
  s.professionals = 400;
  s.locations = 50;
  s.discount = 0;
  s.enterpriseEnabled = false;
  return normalizePackageInclusions(s);
};

describe("CPQ pricing (DB catalog)", () => {
  it("amplify bundle from catalog", () => {
    expect(calculateBundleAnnual(initialState())).toBe(250 * 89 * 12 + 35 * 129 * 12);
  });
  it("normalizePackageInclusions fills package_includes", () => {
    const s = base();
    s.addOns.listingsProfessionals = 0;
    s.addOns.listingsLocations = 0;
    s.addOns.voceUsers = 0;
    const n = normalizePackageInclusions(s);
    expect([n.addOns.listingsProfessionals, n.addOns.listingsLocations, n.addOns.voceUsers]).toEqual([250, 35, 285]);
  });
  it("amplify included not double-billed", () => {
    expect(calculateAddOnsAnnual(normalizePackageInclusions(base()))).toBe(0);
  });
  it("excess listings above amplify billed at price book", () => {
    const s = normalizePackageInclusions(base());
    s.addOns.listingsProfessionals = 251;
    s.addOns.listingsLocations = 36;
    expect(calculateAddOnsAnnual(s)).toBe(29 * 12 + 99 * 12);
  });
  it("sponsored uses catalog rate when none set", () => {
    const s = base();
    s.addOns.sponsoredSearchSelected = true;
    s.addOns.sponsoredSearchMonthlyRate = 0;
    expect(calculateAddOnsAnnual(normalizePackageInclusions(s))).toBe(12 * 59 * 12);
  });
  it("no per-user platform fee", () => {
    const s = initialState();
    Object.values(s.enterprise).forEach((v) => "selected" in v && (v.selected = false));
    expect(calculateEnterpriseAnnual(s)).toBe(0);
  });
  it("VOCE First min_charge floor is $15,000", () => {
    const s = initialState();
    s.enterprise.voceCredits = { selected: true, users: 100, pricePerCredit: 0.5 };
    expect(voceCreditsCost(s)).toBe(5000);
    expect(voceEnterpriseFirstCost(s)).toBe(15000);
    s.enterprise.voceCredits.selected = false;
    expect(voceEnterpriseFirstCost(s)).toBe(0);
  });
  it("volume schedule and tiered platform fee", () => {
    expect([volumeTierPct(24), volumeTierPct(25), volumeTierPct(450), volumeTierPct(1000)]).toEqual([0, 10, 25, 40]);
    expect(platformFee(40000)).toBe(8000);
    expect(platformFee(378450)).toBe(42845);
    expect(platformFee(10_000_000)).toBe(50000);
  });
  it("sample: NORA Amplify 50 locations + 400 professionals", () => {
    const s = amplifySample();
    const m = calculateSummary(s, buildLineItems(s));
    expect(m.subtotal).toBe(504600);
    expect(m.volumePct).toBe(25);
    expect(m.net).toBe(378450);
    expect(m.platformFee).toBe(42845);
    expect(m.acv).toBe(421295);
    expect(m.estimatedArr).toBe(421295);
  });
  it("passthrough billed exactly, outside platform fee and commission", () => {
    const d = priceDeal([{ productKey: "nora_amplify", net: 100000 }, { productKey: "voce_boosts", net: 5000 }], 450, 0);
    expect(d.passthrough).toBe(5000);
    expect(d.net).toBe(75000);
    expect(d.platformFee).toBe(platformFee(75000));
    expect(d.acv).toBe(75000 + platformFee(75000) + 5000);
    expect(d.commissionable).toBe(75000);
  });
  it("write-down above manager ceiling is routed for approval rather than invalidating the quote", () => {
    const s = amplifySample();
    s.discount = 378450 * 0.3;
    expect(validateState(s).valid).toBe(true);
    const lines = buildLineItems(s).map((line) => ({ ...line, tier: null, baseUnitPrice: line.unitPrice, baseNet: line.net }));
    expect(evaluateApproval(lines, s.discount, [], 0.3).triggers.some((e) => e.includes("deal desk"))).toBe(true);
    s.discount = 378450 * 0.2;
    expect(validateState(s).valid).toBe(true);
  });
});

/* ─────────── Pricing depth (cpq-depth) ─────────── */
import { applyVolumeTiers, creditCogs, evaluateApproval, matchTier, projectTopUp, sellerMaxDiscount } from "../src/lib/cpq-depth";

const TIERS3 = [
  { tier: "standard", max_discount: 0.2 },
  { tier: "enterprise", max_discount: 0.5 },
  { tier: "strategic", max_discount: 0.75, requires_approval: true },
];
const bookRow = (k: string, scope: string) => ({ product_key: k, scope, unit: "month", list_price: 29, billing_type: "subscription", cost_type: "token_pct", cost_value: 0.1, floor_margin_pct: 0.4, discount_tiers: TIERS3, credit_cost_per_unit: null });

describe("cpq-depth", () => {
  it("matches a tier band with null max as ∞ and none otherwise", () => {
    const tiers = [{ product_key: "listings", entity_type: "professional", min_qty: 100, max_qty: null, unit_price: 20 }];
    expect(matchTier(tiers, "listings", "professional", 150)?.unit_price).toBe(20);
    expect(matchTier(tiers, "listings", "professional", 50)).toBeNull();
    expect(matchTier([], "listings", "professional", 150)).toBeNull();
  });
  it("leaves lines untouched when no tier exists", () => {
    const l = [{ productKey: "listings", label: "Listings · professionals (billable)", qty: 10, unitPrice: 388, net: 3880, entityType: "professional" as const }];
    const out = applyVolumeTiers(l, { tiers: [], book: [] });
    expect(out[0].net).toBe(3880);
    expect(out[0].tier).toBeNull();
  });
  it("seller limit is the highest non-approval band", () => {
    expect(sellerMaxDiscount(TIERS3)).toBe(0.5);
  });
  it("flags lines above the seller limit and names them", () => {
    const l = applyVolumeTiers([{ productKey: "listings", label: "Listings", qty: 10, unitPrice: 100, net: 1000, entityType: "professional" }], { tiers: [], book: [] });
    const ok = evaluateApproval(l, 100, [bookRow("listings", "professional")]);
    expect(ok.needsApproval).toBe(false);
    const bad = evaluateApproval(l, 600, [bookRow("listings", "professional")]);
    expect(bad.needsApproval).toBe(true);
    expect(bad.triggers.some((t) => t.startsWith("Voluntary write-down"))).toBe(true);
  });
  it("credit COGS uses the LLM cost basis ($0.02/credit)", () => {
    expect(creditCogs(100000)).toBe(2000);
  });
  it("top-up needs estimates", () => {
    expect(projectTopUp(1000, 10, 1, []).kind).toBe("unset");
    const p = projectTopUp(1200, 10, 0, [{ product_key: "nora", name: "NORA", billing_type: "subscription", consumes_llm_credits: true, est_credits_per_professional: 10, est_credits_per_location: null }], new Date(2026, 0, 1));
    expect(p.kind === "projected" && Math.round(p.months)).toBe(12);
  });
});

/* ─────────── Enterprise volume tiers (fixtures = live exp_price_tiers seed) ─────────── */
import { priceEnterpriseTier, useEnterpriseTiers, type PriceTier } from "../src/lib/cpq-depth";

const T = (p: Partial<PriceTier> & Pick<PriceTier, "product_key" | "tier_kind" | "variant" | "min_qty">): PriceTier => ({
  entity_type: null, max_qty: null, unit_price: null, list_per_user: null, discount_pct: null, platform_fee_annual: null,
  addl_user_monthly: null, setup_fee: null, included_campaigns: null, pooled_credits: null, overage_rate: null, label: String(p.min_qty), sort: null, ...p,
});
const amplify = [
  [10, 7200, 60, 1620, 1], [25, 16200, 54, 3240, 2], [50, 30600, 51, 6120, 3], [100, 57600, 48, 10080, 3],
  [250, 135000, 45, 20250, 5], [500, 252000, 42, 34020, 5], [1000, 432000, 36, 43200, 8],
].map(([m, pf, add, setup, c]) => T({ product_key: "nora", tier_kind: "platform_overage", variant: "amplify", min_qty: m, platform_fee_annual: pf, addl_user_monthly: add, setup_fee: setup, included_campaigns: c }));
const engage = [T({ product_key: "nora", tier_kind: "platform_overage", variant: "engage", min_qty: 10, platform_fee_annual: 4800, addl_user_monthly: 40, setup_fee: 1008, included_campaigns: 1 }),
  T({ product_key: "nora", tier_kind: "platform_overage", variant: "engage", min_qty: 25, platform_fee_annual: 10800, addl_user_monthly: 36, setup_fee: 2160, included_campaigns: 2 })];
const listings = [[1, 99, 325], [100, 249, 275], [250, 499, 250], [500, null, 225]].map(([a, b, u]) =>
  T({ product_key: "listings", tier_kind: "per_unit", variant: "enterprise", min_qty: a as number, max_qty: b, unit_price: u, label: b == null ? `${a}+` : `${a}-${b}` }));
const vocePooled = [[1, 720, 5000, 150], [10, 2880, 20000, 475], [25, 4800, 40000, 750], [50, 9600, 80000, 1440], [100, 12960, 120000, 1950], [250, 19200, 200000, 2880]].map(([m, pf, pc, s]) =>
  T({ product_key: "voce", tier_kind: "credit_pool", variant: "pooled", min_qty: m, platform_fee_annual: pf, pooled_credits: pc, overage_rate: 0.15, setup_fee: s }));

describe("enterprise tiers", () => {
  it("NORA Amplify 250", () => {
    const r = priceEnterpriseTier(amplify, 250)!;
    expect(r.bandLabel).toBe("250");
    expect([r.platformFeeAnnual, r.overageUsers, r.annualSubtotal]).toEqual([135000, 0, 135000]);
  });
  it("NORA Amplify 120 → band 100 + overage", () => {
    const r = priceEnterpriseTier(amplify, 120)!;
    expect(r.bandMinQty).toBe(100);
    expect(r.overageUsers).toBe(20);
    expect(r.overageAnnual).toBe(20 * 48 * 12);
    expect(r.annualSubtotal).toBe(69120);
    expect(r.setupOneTime).toBe(10080);
  });
  it("NORA Engage 10", () => {
    const r = priceEnterpriseTier(engage, 10)!;
    expect([r.annualSubtotal, r.setupOneTime, r.includedCampaigns]).toEqual([4800, 1008, 1]);
  });
  it("Listings 300 locations", () => {
    const r = priceEnterpriseTier(listings, 300)!;
    expect(r.bandLabel).toBe("250-499");
    expect(r.perLocationRate).toBe(250);
    expect(r.annualSubtotal).toBe(75000);
  });
  it("VOCE pooled 100", () => {
    const r = priceEnterpriseTier(vocePooled, 100)!;
    expect([r.platformFeeAnnual, r.pooledCredits, r.overageRate, r.setupOneTime]).toEqual([12960, 120000, 0.15, 1950]);
  });
  it("enterprise threshold", () => {
    expect(useEnterpriseTiers(9, true)).toBe(false);
    expect(useEnterpriseTiers(10, true)).toBe(true);
    expect(useEnterpriseTiers(500, false)).toBe(false);
  });
});
