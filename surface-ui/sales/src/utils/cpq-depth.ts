/**
 * CPQ pricing depth — layered ON TOP of the ported cpq-pricing engine (never
 * changes its math): volume tiers, discount-band / floor approval routing,
 * credit (consumption) lane with COGS + top-up projection, and bundled
 * "Included" lines. Margin/tier classification reuses margin.ts unchanged.
 */
import { api } from "@v3/state/api/server-fn";
import { CATALOG } from "./cpq-catalog";
import type { QuoteState } from "./cpq-state";
import { includedAddOnQuantities, safeNumber, volumeTierPct } from "./cpq-pricing";
import {
  computeLineMargin,
  rollupDeal,
  tierForDiscount,
  type CostConfig,
  type DealMargin,
  type DiscountTier,
  type LineMargin,
} from "./margin";
import type { CpqLine } from "./sales-cpq";

/** LLM cost basis per credit (commission COGS) — exp_pricing_config.llm_cost_basis. */
export const creditCostBasis = () => CATALOG.config.llmCostBasis;

/* ─────────── Context (read-only loads) ─────────── */
export type TierRow = { product_key: string | null; entity_type: string | null; min_qty: number | null; max_qty: number | null; unit_price: number | null };
export type BookRow = {
  product_key: string | null;
  scope: string | null;
  unit: string | null;
  list_price: number | null;
  billing_type: string | null;
  cost_type: string | null;
  cost_value: number | null;
  floor_margin_pct: number | null;
  discount_tiers: unknown;
  credit_cost_per_unit: number | null;
};
export type CreditProduct = {
  product_key: string;
  name: string | null;
  billing_type: string | null;
  consumes_llm_credits: boolean | null;
  est_credits_per_professional: number | null;
  est_credits_per_location: number | null;
};
export type PricingContext = { tiers: TierRow[]; book: BookRow[]; products: CreditProduct[] };

export async function loadPricingContext(): Promise<PricingContext> {
  // exp_price_tiers is DEPRECATED as a pricing source: the single volume
  // schedule is exp_pricing_config.volume_tiers (CATALOG.config.volumeTiers).
  // Both reads in one request (sales: GET /sales/catalog/pricing-context), as the signed-in user.
  const r = await api.get<{ book: BookRow[]; products: CreditProduct[] }>("/sales/catalog/pricing-context");
  return { tiers: [], book: r.book ?? [], products: r.products ?? [] };
}

/* ─────────── 1. Per-product bands (DEPRECATED — always empty; kept for type compatibility) ─────────── */
export function matchTier(tiers: TierRow[], productKey: string, entityType: string | null | undefined, qty: number): TierRow | null {
  if (!entityType) return null;
  return (
    tiers.find(
      (t) =>
        t.product_key === productKey &&
        t.entity_type === entityType &&
        t.unit_price != null &&
        qty >= Number(t.min_qty ?? 0) &&
        (t.max_qty == null || qty <= Number(t.max_qty)),
    ) ?? null
  );
}

export const tierNote = (t: TierRow) => `tier: ${t.min_qty ?? 0}–${t.max_qty ?? "∞"} @ $${Number(t.unit_price)}`;

export type PricedLine = CpqLine & { tier: TierRow | null; baseUnitPrice: number; baseNet: number };

/**
 * Applies a matching exp_price_tiers band. Tier unit_price is on the price
 * book's unit basis (monthly for "month" units), so quote lines (annual) use ×12.
 * No matching tier → the line is untouched.
 */
export function applyVolumeTiers(lines: CpqLine[], ctx: Pick<PricingContext, "tiers" | "book">, annual = true): PricedLine[] {
  return lines.map((l) => {
    const tier = matchTier(ctx.tiers, l.productKey, l.entityType, l.qty);
    if (!tier) return { ...l, tier: null, baseUnitPrice: l.unitPrice, baseNet: l.net };
    const row = ctx.book.find((r) => r.product_key === l.productKey && r.scope === l.entityType);
    const factor = annual && (row?.unit ?? "month") === "month" ? 12 : 1;
    const unitPrice = Number(tier.unit_price) * factor;
    return { ...l, tier, baseUnitPrice: l.unitPrice, baseNet: l.net, unitPrice, net: unitPrice * l.qty, notes: [l.notes, tierNote(tier)].filter(Boolean).join(" · ") };
  });
}

/* ─────────── 2. Approval routing ─────────── */
function bookRowFor(book: BookRow[], productKey: string, entityType?: string | null) {
  const c = book.filter((r) => r.product_key === productKey);
  return c.find((r) => r.scope === entityType) ?? c[0] ?? null;
}

const tiersOf = (r: BookRow | null | undefined) => (Array.isArray(r?.discount_tiers) ? (r!.discount_tiers as DiscountTier[]) : []);

/** Highest discount a seller may give without approval (max non-approval band). */
export function sellerMaxDiscount(tiers: DiscountTier[]): number | null {
  const ok = tiers.filter((t) => !t.requires_approval).map((t) => Number(t.max_discount));
  return ok.length ? Math.max(...ok) : null;
}

export type ApprovalCheck = {
  discountPct: number;
  lines: (PricedLine & { margin: LineMargin; band: string | null })[];
  deal: DealMargin;
  triggers: string[];
  needsApproval: boolean;
};

export function evaluateApproval(lines: PricedLine[], discount: number, book: BookRow[], pctOverride?: number): ApprovalCheck {
  const gross = lines.reduce((s, l) => s + l.net, 0);
  const discountPct = pctOverride != null ? Math.min(1, pctOverride) : gross > 0 ? Math.min(1, safeNumber(discount) / gross) : 0;
  const fallbackTiers = tiersOf(book.find((r) => tiersOf(r).length));
  const triggers: string[] = [];
  const out = lines.map((l) => {
    const row = bookRowFor(book, l.productKey, l.entityType);
    const tiers = tiersOf(row).length ? tiersOf(row) : fallbackTiers;
    const cost: CostConfig = {
      costType: row?.cost_type ?? null,
      costValue: row?.cost_value ?? null,
      floorMarginPct: row?.floor_margin_pct ?? null,
      discountTiers: tiers,
    };
    const margin = computeLineMargin({ qty: l.qty, unitPrice: l.unitPrice, discountPct, cost });

    return { ...l, margin, band: tierForDiscount(discountPct, tiers)?.tier ?? (tiers.length ? "over limit" : null) };
  });
  const sellerFloor = CATALOG.config.discountFloorSeller / 100;
  if (sellerFloor > 0 && discountPct > sellerFloor + 1e-9) {
    triggers.push(`Voluntary write-down ${(discountPct * 100).toFixed(1)}% exceeds the ${(sellerFloor * 100).toFixed(0)}% seller limit — manager approval required`);
  }
  const managerFloor = CATALOG.config.discountFloorManager / 100;
  if (managerFloor > 0 && discountPct > managerFloor + 1e-9) {
    triggers.push(`Voluntary write-down ${(discountPct * 100).toFixed(1)}% exceeds the ${(managerFloor * 100).toFixed(0)}% manager limit — deal desk approval required`);
  }
  const deal = rollupDeal(out.map((l) => l.margin));
  if (deal.floor != null && deal.marginPct != null && deal.marginPct < deal.floor) {
    triggers.push(`Blended margin ${(deal.marginPct * 100).toFixed(1)}% is below the ${(deal.floor * 100).toFixed(1)}% floor`);
  }
  return { discountPct, lines: out, deal, triggers, needsApproval: triggers.length > 0 };
}

/* ─────────── 3. Credits ─────────── */
export function creditRate(book: BookRow[]): { listPerCredit: number | null; costPerCredit: number } {
  // List credit price and cost basis come from exp_pricing_config; a price-book cost override still wins.
  const row = book.find((r) => r.product_key === "add_credits");
  const list = CATALOG.config.creditPrice || null;
  return { listPerCredit: list, costPerCredit: row?.credit_cost_per_unit ?? CATALOG.config.llmCostBasis };
}

/** Credits carried by the PPU quote's enterprise credit products (for COGS). */
export function quoteCredits(state: QuoteState): number {
  if (!state.enterpriseEnabled) return 0;
  const e = state.enterprise;
  const C = CATALOG.enterprise;
  let n = 0;
  if (e.engageCredits.selected) n += safeNumber(e.engageCredits.users) * C.engageCredits.creditsPerUser;
  if (e.amplifyCredits.selected) n += safeNumber(e.amplifyCredits.users) * C.amplifyCredits.creditsPerUser;
  if (e.voceCredits.selected) n += safeNumber(e.voceCredits.users) * C.voceCredits.creditsPerUser;
  if (e.conversionAgents.selected) n += safeNumber(e.conversionAgents.agents) * C.conversionAgents.creditsPerAgent;
  return n;
}

export const creditCogs = (credits: number, costPerCredit = CATALOG.config.llmCostBasis) => safeNumber(credits) * costPerCredit;

/** Consumption lane: platform fee + one credit-pool line instead of per-user products. */
export function consumptionLines(state: QuoteState, book: BookRow[]): CpqLine[] {
  const lines: CpqLine[] = [];
  // Platform fee is tiered on net (added by priceDeal), never a per-user line.
  const { listPerCredit } = creditRate(book);
  const pool = safeNumber(state.creditPool);
  if (pool > 0 && listPerCredit != null) {
    const unit = creditUnitPrice(listPerCredit, safeNumber(state.professionals) + safeNumber(state.locations));
    lines.push({ productKey: "add_credits", label: "Credit pool", qty: pool, unitPrice: unit, net: pool * unit, notes: unit < listPerCredit ? `volume tier ${volumeTierPct(safeNumber(state.professionals) + safeNumber(state.locations))}% off $${listPerCredit}/credit` : "credits" });
  }
  return lines;
}

/** Credit price after the volume tier, never below credit_floor_pct of list. */
export function creditUnitPrice(list: number, units: number): number {
  const floor = list * (CATALOG.config.creditFloorPct / 100);
  return Math.max(floor, list * (1 - volumeTierPct(units) / 100));
}

export function validateConsumption(state: QuoteState, book: BookRow[]): string[] {
  const errs: string[] = [];
  if (!(safeNumber(state.creditPool) > 0)) errs.push("Consumption mode requires a credit pool");
  if (creditRate(book).listPerCredit == null) errs.push("No credit price in pricing assumptions");
  return errs;
}

export type TopUp =
  | { kind: "unset" }
  | { kind: "none"; monthly: 0 }
  | { kind: "projected"; monthly: number; months: number; exhaustsOn: Date; label: string };

export function projectTopUp(pool: number, professionals: number, locations: number, products: CreditProduct[], from = new Date()): TopUp {
  const consuming = products.filter((p) => p.consumes_llm_credits);
  const withEst = consuming.filter((p) => p.est_credits_per_professional != null || p.est_credits_per_location != null);
  if (!withEst.length) return { kind: "unset" };
  const monthly = withEst.reduce(
    (s, p) => s + Number(p.est_credits_per_professional ?? 0) * safeNumber(professionals) + Number(p.est_credits_per_location ?? 0) * safeNumber(locations),
    0,
  );
  if (monthly <= 0) return { kind: "none", monthly: 0 };
  const months = safeNumber(pool) / monthly;
  const d = new Date(from);
  d.setDate(d.getDate() + Math.round(months * 30.4375));
  const label = `≈ Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  return { kind: "projected", monthly, months, exhaustsOn: d, label };
}

/* ─────────── 4. Bundled inclusions (display only) ─────────── */
export type IncludedLine = { label: string; qty: number; reason: string };

export function includedLines(state: QuoteState, products: CreditProduct[]): IncludedLine[] {
  const out: IncludedLine[] = [];
  const inc = includedAddOnQuantities(state);
  if (!state.packageId) return out;
  const pkg = CATALOG.packages[state.packageId];
  const why = `Included by ${pkg.name}`;
  if (inc.listings.professionals) out.push({ label: `${CATALOG.addOns.listings.name} · professionals`, qty: inc.listings.professionals, reason: why });
  if (inc.listings.locations) out.push({ label: `${CATALOG.addOns.listings.name} · locations`, qty: inc.listings.locations, reason: why });
  if (inc.voce.users) out.push({ label: `${CATALOG.addOns.voce.name} users`, qty: inc.voce.users, reason: why });
  const seats = safeNumber(state.professionals) + safeNumber(state.locations);
  for (const key of pkg.includeKeys.filter((k) => k !== "listings" && k !== "voce")) {
    out.push({ label: CATALOG.products[key]?.name ?? products.find((p) => p.product_key === key)?.name ?? key, qty: seats, reason: why });
  }
  return out;
}

/* ─────────── 5. Enterprise volume tiers (verbatim spec) ─────────── */
export type TierKind = 'platform_overage' | 'credit_pool' | 'flat_platform' | 'per_unit';

export interface PriceTier {
  product_key: string;
  entity_type: string | null;
  tier_kind: TierKind;
  variant: string | null;
  min_qty: number;
  max_qty: number | null;
  unit_price: number | null;
  list_per_user: number | null;
  discount_pct: number | null;
  platform_fee_annual: number | null;
  addl_user_monthly: number | null;
  setup_fee: number | null;
  included_campaigns: number | null;
  pooled_credits: number | null;
  overage_rate: number | null;
  label: string | null;
  sort: number | null;
}

export const ADDL_CAMPAIGN_RATE = 1200;   // additional campaign, one-time per campaign
export const ENTERPRISE_MIN_QTY = 10;      // at/above this qty, prefer enterprise tiers over SMB rate card

export interface EnterpriseQuoteLine {
  applies: boolean;
  reason?: string;
  bandLabel: string;
  bandMinQty: number;
  platformFeeAnnual: number;
  overageUsers: number;
  overageAnnual: number;
  setupOneTime: number;
  includedCampaigns: number;
  pooledCredits: number | null;
  overageRate: number | null;
  perLocationRate: number | null;
  annualSubtotal: number;   // recurring: platform + overage (or per-location total)
  oneTimeSubtotal: number;  // setup
}

// Highest band whose min_qty <= qty (for platform/credit/flat kinds).
export function selectTierBand(tiers: PriceTier[], qty: number): PriceTier | null {
  const eligible = tiers.filter(t => t.min_qty <= qty).sort((a, b) => b.min_qty - a.min_qty);
  return eligible[0] ?? null;
}

export function priceEnterpriseTier(tiers: PriceTier[], qty: number): EnterpriseQuoteLine | null {
  if (!tiers.length) return null;
  const kind = tiers[0].tier_kind;

  if (kind === 'per_unit') {
    const band =
      tiers.filter(t => t.min_qty <= qty && (t.max_qty == null || qty <= t.max_qty)).sort((a, b) => b.min_qty - a.min_qty)[0]
      ?? tiers.slice().sort((a, b) => a.min_qty - b.min_qty)[0];
    const rate = safeNumber(band.unit_price);
    return {
      applies: true, bandLabel: band.label ?? '', bandMinQty: band.min_qty,
      platformFeeAnnual: 0, overageUsers: 0, overageAnnual: 0, setupOneTime: 0,
      includedCampaigns: 0, pooledCredits: null, overageRate: null,
      perLocationRate: rate, annualSubtotal: rate * qty, oneTimeSubtotal: 0,
    };
  }

  const band = selectTierBand(tiers, qty);
  if (!band) {
    return {
      applies: false, reason: 'below-smallest-tier', bandLabel: '', bandMinQty: 0,
      platformFeeAnnual: 0, overageUsers: 0, overageAnnual: 0, setupOneTime: 0,
      includedCampaigns: 0, pooledCredits: null, overageRate: null, perLocationRate: null,
      annualSubtotal: 0, oneTimeSubtotal: 0,
    };
  }

  const platform = safeNumber(band.platform_fee_annual);
  const setup = safeNumber(band.setup_fee);
  const included = band.included_campaigns ?? 0;
  const overageUsers = kind === 'platform_overage' ? Math.max(0, qty - band.min_qty) : 0;
  const overageAnnual = kind === 'platform_overage' ? overageUsers * safeNumber(band.addl_user_monthly) * 12 : 0;

  return {
    applies: true, bandLabel: band.label ?? '', bandMinQty: band.min_qty,
    platformFeeAnnual: platform, overageUsers, overageAnnual, setupOneTime: setup,
    includedCampaigns: included,
    pooledCredits: kind === 'credit_pool' ? (band.pooled_credits ?? 0) : null,
    overageRate: kind === 'credit_pool' ? safeNumber(band.overage_rate) : null,
    perLocationRate: null,
    annualSubtotal: platform + overageAnnual,
    oneTimeSubtotal: setup,
  };
}

// Recommend enterprise tiers vs SMB rate card by deal size.
export function useEnterpriseTiers(qty: number, hasTiers: boolean): boolean {
  return hasTiers && qty >= ENTERPRISE_MIN_QTY;
}

/* ─────────── 6. Tier-aware quote lines ─────────── */
export type EnterpriseProduct = "nora" | "listings" | "voce";
export const VOCE_VARIANTS = [
  ["pooled", "Pooled"],
  ["publish_first", "Publish First"],
  ["platform_only", "Platform Only"],
] as const;

export type EnterpriseCard = {
  product: EnterpriseProduct;
  variant: string;
  qty: number;
  hasTiers: boolean;
  recommended: boolean;
  active: boolean; // enterprise pricing in effect (recommended and not forced to SMB)
  quote: EnterpriseQuoteLine | null;
  topUp: TopUp | null;
};

const tiersForLocal = (rows: PriceTier[], k: string, v: string) => rows.filter((r) => r.product_key === k && r.variant === v);

/**
 * Replaces the SMB rate-card line of each tiered product with its enterprise
 * annual subtotal when useEnterpriseTiers() recommends it and the seller has not
 * forced the SMB fallback. baseNet keeps the replaced rate-card net so the
 * summary adjustment is exact. Setup fees go to oneTime (never ARR).
 */
export function applyEnterpriseTiers(
  lines: PricedLine[],
  state: QuoteState,
  rows: PriceTier[],
  products: CreditProduct[] = [],
): { lines: PricedLine[]; cards: EnterpriseCard[]; oneTime: CpqLine[] } {
  const smb = new Set(state.smbFallback ?? []);
  const specs: { product: EnterpriseProduct; variant: string | null; qty: number; match: (l: PricedLine) => boolean; entityType: "professional" | "location"; unitLabel: string }[] = [
    { product: "nora", variant: state.packageId, qty: safeNumber(state.professionals), match: (l) => l.productKey === state.packageId && l.entityType === "professional", entityType: "professional", unitLabel: "professionals" },
    { product: "listings", variant: "enterprise", qty: safeNumber(state.locations), match: (l) => l.productKey === "listings" && l.entityType === "location", entityType: "location", unitLabel: "locations" },
    { product: "voce", variant: state.voceVariant ?? "pooled", qty: safeNumber(state.professionals), match: (l) => l.productKey === "voce", entityType: "professional", unitLabel: "professionals" },
  ];
  let out = lines.slice();
  const cards: EnterpriseCard[] = [];
  const oneTime: CpqLine[] = [];
  for (const sp of specs) {
    const idx = out.findIndex(sp.match);
    if (!sp.variant || idx < 0) continue; // product not on the quote
    const t = tiersForLocal(rows, sp.product, sp.variant);
    const recommended = useEnterpriseTiers(sp.qty, t.length > 0);
    const q = recommended ? priceEnterpriseTier(t, sp.qty) : null;
    const active = recommended && !smb.has(sp.product) && !!q?.applies;
    const topUp = active && q?.pooledCredits != null ? projectTopUp(q.pooledCredits, state.professionals, state.locations, products) : null;
    cards.push({ product: sp.product, variant: sp.variant, qty: sp.qty, hasTiers: t.length > 0, recommended, active, quote: q, topUp });
    if (!active || !q) continue;
    const old = out[idx];
    const net = q.annualSubtotal;
    out[idx] = {
      productKey: sp.product,
      label: `${old.label.replace(/ \(billable\)$/, "")} · enterprise`,
      qty: sp.qty,
      unitPrice: sp.qty ? net / sp.qty : net,
      net,
      entityType: sp.entityType,
      notes: `Enterprise tier — ${q.bandLabel}`,
      tier: null,
      baseUnitPrice: old.baseUnitPrice,
      baseNet: old.baseNet,
    };
    if (q.oneTimeSubtotal > 0) oneTime.push({ productKey: sp.product, label: `${q.bandLabel} · setup (one-time)`, qty: 1, unitPrice: q.oneTimeSubtotal, net: q.oneTimeSubtotal, entityType: sp.entityType });
  }
  out = out.filter((l) => l.net > 0);
  return { lines: out, cards, oneTime };
}
