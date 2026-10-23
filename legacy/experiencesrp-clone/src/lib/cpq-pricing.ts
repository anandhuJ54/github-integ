/**
 * CPQ pricing engine — pure functions. Formulas live here; every number they
 * use (prices, package inclusions, volume schedule, platform-fee bands,
 * write-down floors, minimum charges) comes from the DB-built CATALOG.
 */
import { CATALOG, laneOf } from "./cpq-catalog";
import type { QuoteState } from "./cpq-state";

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function calculateBundleAnnual(state: QuoteState): number {
  if (!state.packageId) return 0;
  const pkg = CATALOG.packages[state.packageId];
  return safeNumber(state.professionals) * pkg.professionalMonthly * 12 + safeNumber(state.locations) * pkg.locationMonthly * 12;
}

/** Quantities a base package includes at $0 (from its package_includes). */
export function includedAddOnQuantities(state: Pick<QuoteState, "packageId" | "professionals" | "locations">) {
  const inc = state.packageId ? CATALOG.packages[state.packageId].includeKeys : [];
  const listings = inc.includes("listings");
  const voce = inc.includes("voce");
  return {
    listings: listings
      ? { professionals: safeNumber(state.professionals), locations: safeNumber(state.locations) }
      : { professionals: 0, locations: 0 },
    voce: voce ? { users: safeNumber(state.professionals) + safeNumber(state.locations) } : { users: 0 },
  };
}

export function calculateAddOnsAnnual(state: QuoteState): number {
  const included = includedAddOnQuantities(state);
  let total = 0;
  const lp = Math.max(0, safeNumber(state.addOns.listingsProfessionals) - included.listings.professionals);
  const ll = Math.max(0, safeNumber(state.addOns.listingsLocations) - included.listings.locations);
  total += lp * CATALOG.addOns.listings.professionalAnnual;
  total += ll * CATALOG.addOns.listings.locationAnnual;
  const vq = Math.max(0, safeNumber(state.addOns.voceUsers) - included.voce.users);
  total += vq * CATALOG.addOns.voce.perUserAnnual;
  if (state.addOns.sponsoredSearchSelected) {
    total += safeNumber(state.addOns.sponsoredSearchZips) * (safeNumber(state.addOns.sponsoredSearchMonthlyRate) || CATALOG.addOns.sponsoredSearch.monthlyPerZipStart) * 12;
  }
  if (state.addOns.conversionAgentsSelected) {
    total += safeNumber(state.addOns.conversionAgentProfessionals) * CATALOG.addOns.conversionAgents.professionalAnnual;
    total += safeNumber(state.addOns.conversionAgentLocations) * CATALOG.addOns.conversionAgents.locationAnnual;
  }
  return total;
}

export function voceCreditsCost(state: QuoteState): number {
  if (!state.enterprise.voceCredits.selected) return 0;
  const users = safeNumber(state.enterprise.voceCredits.users);
  const credits = users * CATALOG.enterprise.voceCredits.creditsPerUser;
  return credits * safeNumber(state.enterprise.voceCredits.pricePerCredit);
}

/** VOCE First-Party Publishing: billed at its min_charge floor or the credit value, whichever is higher. */
export function voceEnterpriseFirstCost(state: QuoteState): number {
  const base = voceCreditsCost(state);
  return state.enterprise.voceCredits.selected ? Math.max(CATALOG.enterprise.voceEnterpriseFirst.minimumAnnual, base) : 0;
}

export function calculateEnterpriseAnnual(state: QuoteState): number {
  let total = 0;
  const e = state.enterprise;
  if (e.platformFee.pricingMode !== "included") {
    total += safeNumber(e.platformFee.users) * CATALOG.enterprise.platformFee.perUserAnnual;
  }
  if (e.engageCredits.selected) total += safeNumber(e.engageCredits.users) * safeNumber(e.engageCredits.pricePerUser);
  if (e.amplifyCredits.selected) total += safeNumber(e.amplifyCredits.users) * safeNumber(e.amplifyCredits.pricePerUser);
  if (e.voceCredits.selected) {
    total += voceCreditsCost(state);
    total += voceEnterpriseFirstCost(state);
  }
  if (e.conversionAgents.selected) total += safeNumber(e.conversionAgents.packagePrice);
  if (e.sponsoredSearch.selected) total += safeNumber(e.sponsoredSearch.zips) * (safeNumber(e.sponsoredSearch.monthlyRate) || CATALOG.enterprise.sponsoredSearch.monthlyPerZipStart) * 12;
  if (e.campaigns5Pack.selected) total += safeNumber(e.campaigns5Pack.quantity) * CATALOG.enterprise.campaigns5Pack.annual;
  if (e.benchmarkCampaign.selected) total += safeNumber(e.benchmarkCampaign.quantity) * CATALOG.enterprise.benchmarkCampaign.annual;
  if (e.customIntegration.selected) total += safeNumber(e.customIntegration.quantity) * CATALOG.enterprise.customIntegration.annual;
  if (e.customDevelopment.selected) total += safeNumber(e.customDevelopment.hours) * CATALOG.enterprise.customDevelopment.hourly;
  return total;
}

/* ─────────── Deal pricing rules (config-driven) ─────────── */

/** Volume schedule percent (0–100) for a unit count (professionals + locations). */
export function volumeTierPct(units: number): number {
  const t = CATALOG.config.volumeTiers.find((x) => safeNumber(units) >= x.min);
  return t ? t.pct : 0;
}

/** Platform fee: rate 1 on net up to the band, rate 2 above it, capped. */
export function platformFee(net: number): number {
  const c = CATALOG.config;
  const base = safeNumber(net);
  const fee = Math.min(base, c.platformFeeBand) * c.platformFeeRate1 + Math.max(0, base - c.platformFeeBand) * c.platformFeeRate2;
  return Math.round(Math.min(fee, c.platformFeeCap) * 100) / 100;
}

export type DealLine = { productKey: string; net: number };

export interface DealPricing {
  subtotal: number;
  volumePct: number;
  volumeDiscount: number;
  writeDown: number;
  writeDownPct: number;
  net: number;
  platformFee: number;
  passthrough: number;
  acv: number;
  /** Net less passthrough — the commission base. */
  commissionable: number;
}

/**
 * subtotal → volume tier (discountable product/base lines only) → voluntary
 * write-down (discountable, non-passthrough) → net → tiered platform fee on
 * net (passthrough excluded) → ACV = net + platform fee + passthrough.
 * Enterprise-lane lines take no volume tier (they carry their own tiers);
 * passthrough lines are billed exactly, with no discount.
 */
export function priceDeal(lines: DealLine[], units: number, writeDownInput: number, opts: { volume?: boolean } = {}): DealPricing {
  const pct = opts.volume === false ? 0 : volumeTierPct(units);
  let subtotal = 0, passthrough = 0, volumeBase = 0, discountableNet = 0;
  for (const l of lines) {
    const p = laneOf(l.productKey);
    const amt = safeNumber(l.net);
    if (p.passthrough || p.lane === "passthrough") { passthrough += amt; continue; }
    subtotal += amt;
    const volumeOk = p.discountable && (p.lane === "base" || p.lane === "product");
    if (volumeOk) volumeBase += amt;
    if (p.discountable) discountableNet += volumeOk ? amt * (1 - pct / 100) : amt;
  }
  const volumeDiscount = Math.round(volumeBase * (pct / 100) * 100) / 100;
  const writeDown = Math.min(safeNumber(writeDownInput), discountableNet);
  const net = subtotal - volumeDiscount - writeDown;
  const fee = platformFee(net);
  const acv = net + fee + passthrough;
  return {
    subtotal, volumePct: pct, volumeDiscount, writeDown,
    writeDownPct: subtotal - volumeDiscount > 0 ? (writeDown / (subtotal - volumeDiscount)) * 100 : 0,
    net, platformFee: fee, passthrough, acv, commissionable: net,
  };
}

export interface QuoteSummary extends Partial<DealPricing> {
  bundle: number;
  addOns: number;
  enterprise: number;
  /** Voluntary write-down (dollars). */
  discount: number;
  /** = ACV (net + platform fee + passthrough). */
  estimatedArr: number;
}

/** Category totals plus the full deal waterfall; `lines` default to state-derived categories. */
export function calculateSummary(state: QuoteState, lines?: DealLine[]): QuoteSummary {
  const bundle = calculateBundleAnnual(state);
  const addOns = calculateAddOnsAnnual(state);
  const enterprise = calculateEnterpriseAnnual(state);
  const dealLines = lines ?? [
    { productKey: state.packageId ?? "nora", net: bundle },
    { productKey: "listings", net: addOns },
    { productKey: "platformFee", net: enterprise },
  ];
  const d = priceDeal(dealLines, safeNumber(state.professionals) + safeNumber(state.locations), state.discount);
  return { bundle, addOns, enterprise, discount: d.writeDown, estimatedArr: d.acv, ...d };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateState(state: QuoteState): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const included = includedAddOnQuantities(state);
  const e = state.enterprise;

  if (state.packageId && safeNumber(state.professionals) + safeNumber(state.locations) < 1) {
    errors.push("Package requires at least one professional or location");
  }
  if (state.addOns.sponsoredSearchSelected && safeNumber(state.addOns.sponsoredSearchZips) < 1) {
    errors.push("Sponsored Search requires at least one ZIP");
  }
  if (state.packageId && CATALOG.packages[state.packageId].includeKeys.length) {
    const pkgName = CATALOG.packages[state.packageId].name;
    if (safeNumber(state.addOns.listingsProfessionals) < included.listings.professionals) {
      errors.push(`Listings professionals cannot be reduced below the quantity included by ${pkgName}`);
    }
    if (safeNumber(state.addOns.listingsLocations) < included.listings.locations) {
      errors.push(`Listings locations cannot be reduced below the quantity included by ${pkgName}`);
    }
    if (safeNumber(state.addOns.voceUsers) < included.voce.users) {
      errors.push(`VOCE users cannot be reduced below the quantity included by ${pkgName}`);
    }
  }
  if (state.enterpriseEnabled) {
    if (e.engageCredits.selected) {
      if (!(safeNumber(e.engageCredits.users) > 0)) errors.push("Engage Credits requires users");
      if (!(safeNumber(e.engageCredits.pricePerUser) > 0)) errors.push("Engage Credits requires a price per user");
    }
    if (e.amplifyCredits.selected) {
      if (!(safeNumber(e.amplifyCredits.users) > 0)) errors.push("Amplify Credits requires users");
      if (!(safeNumber(e.amplifyCredits.pricePerUser) > 0)) errors.push("Amplify Credits requires a price per user");
    }
    if (e.voceCredits.selected) {
      if (!(safeNumber(e.voceCredits.users) > 0)) errors.push("VOCE Credits requires users");
      if (!(safeNumber(e.voceCredits.pricePerCredit) > 0)) errors.push("VOCE Credits requires a price per credit");
      const min = CATALOG.enterprise.voceEnterpriseFirst.minimumAnnual;
      if (voceCreditsCost(state) < min) {
        warnings.push(`${CATALOG.enterprise.voceEnterpriseFirst.name || "VOCE First-Party Publishing"} applies a $${min.toLocaleString("en-US")} minimum charge`);
      }
    }
    if (e.conversionAgents.selected) {
      if (!(safeNumber(e.conversionAgents.agents) > 0)) errors.push("Conversion Agents requires at least one agent");
      if (!(safeNumber(e.conversionAgents.packagePrice) > 0)) errors.push("Conversion Agents requires a package price");
    }
    if (e.sponsoredSearch.selected && !(safeNumber(e.sponsoredSearch.zips) > 0)) {
      errors.push("Enterprise Sponsored Search requires at least one ZIP");
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}
