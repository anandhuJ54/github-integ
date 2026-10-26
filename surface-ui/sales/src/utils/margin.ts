/**
 * Margin math for CPQ. LOCKED RULE — do not "improve" this:
 *
 *   sale       = list * (1 - discount_pct)
 *   token cost = cost_value% of LIST  (fixed — does not shrink when discounted)
 *   pass-thru  = cost_value% of SALE  (e.g. boosts: 70% of the sale goes to GDN)
 *   cost       = token + pass-through
 *   net        = sale - cost
 *   margin_pct = net / sale
 */

export type DiscountTier = {
  tier: string;
  max_discount: number;
  requires_approval?: boolean;
};

export type CostConfig = {
  costType: string | null;
  costValue: number | null;
  floorMarginPct: number | null;
  discountTiers: DiscountTier[];
};

export type MarginState = "green" | "yellow" | "red" | "unknown";

/** How far above the floor counts as healthy. Below this but above floor = yellow. */
export const TARGET_BUFFER = 0.1;

export type LineMargin = {
  list: number;
  sale: number;
  discountPct: number;
  tokenCost: number;
  passthruCost: number;
  cost: number;
  net: number;
  marginPct: number | null;
  floor: number | null;
  target: number | null;
  breach: boolean;
  state: MarginState;
  tier: DiscountTier | null;
  requiresApproval: boolean;
};

export function marginState(marginPct: number | null, floor: number | null): MarginState {
  if (marginPct === null || floor === null) return "unknown";
  if (marginPct < floor) return "red";
  if (marginPct < floor + TARGET_BUFFER) return "yellow";
  return "green";
}

export function tierForDiscount(discountPct: number, tiers: DiscountTier[]): DiscountTier | null {
  const sorted = [...tiers].sort((a, b) => Number(a.max_discount) - Number(b.max_discount));
  return sorted.find((t) => discountPct <= Number(t.max_discount)) ?? null;
}

export function computeLineMargin(input: {
  qty: number;
  unitPrice: number;
  discountPct: number;
  cost: CostConfig;
}): LineMargin {
  const list = Number(input.qty || 0) * Number(input.unitPrice || 0);
  const discountPct = Math.min(Math.max(Number(input.discountPct || 0), 0), 1);
  const sale = list * (1 - discountPct);
  const cv = Number(input.cost.costValue ?? 0);
  const tokenCost = input.cost.costType === "token_pct" ? cv * list : 0;
  const passthruCost = input.cost.costType === "passthrough_pct" ? cv * sale : 0;
  const cost = tokenCost + passthruCost;
  const net = sale - cost;
  const marginPct = sale > 0 ? net / sale : null;
  const floor = input.cost.floorMarginPct == null ? null : Number(input.cost.floorMarginPct);
  const tiers = input.cost.discountTiers ?? [];
  const tier = tierForDiscount(discountPct, tiers);
  const breach = floor != null && marginPct != null && marginPct < floor;

  return {
    list,
    sale,
    discountPct,
    tokenCost,
    passthruCost,
    cost,
    net,
    marginPct,
    floor,
    target: floor == null ? null : floor + TARGET_BUFFER,
    breach,
    state: marginState(marginPct, floor),
    tier,
    requiresApproval: breach || tier == null || !!tier.requires_approval,
  };
}

export type DealMargin = {
  sale: number;
  cost: number;
  tokenCost: number;
  passthruCost: number;
  net: number;
  marginPct: number | null;
  floor: number | null;
  state: MarginState;
  breachedLines: number;
  requiresApproval: boolean;
};

/** Deal-level roll-up. Deal floor = sale-weighted blend of the per-line floors. */
export function rollupDeal(lines: LineMargin[]): DealMargin {
  const sale = lines.reduce((s, l) => s + l.sale, 0);
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  const tokenCost = lines.reduce((s, l) => s + l.tokenCost, 0);
  const passthruCost = lines.reduce((s, l) => s + l.passthruCost, 0);
  const net = sale - cost;
  const marginPct = sale > 0 ? net / sale : null;
  const floored = lines.filter((l) => l.floor != null && l.sale > 0);
  const flooredSale = floored.reduce((s, l) => s + l.sale, 0);
  const floor =
    flooredSale > 0
      ? floored.reduce((s, l) => s + (l.floor as number) * l.sale, 0) / flooredSale
      : null;
  const breachedLines = lines.filter((l) => l.breach).length;
  const belowFloor = floor != null && marginPct != null && marginPct < floor;
  return {
    sale,
    cost,
    tokenCost,
    passthruCost,
    net,
    marginPct,
    floor,
    state: marginState(marginPct, floor),
    breachedLines,
    requiresApproval: belowFloor || breachedLines > 0 || lines.some((l) => l.requiresApproval),
  };
}

/* ─────────── Presentation tokens (margin colour is a first-class signal) ─────────── */

export const MARGIN_SKIN: Record<
  MarginState,
  { text: string; chip: string; bar: string; track: string; label: string }
> = {
  green: {
    text: "text-[#0f5132]",
    chip: "bg-[#e6f4ea] text-[#0f5132] border-[#b7e1c4]",
    bar: "bg-[color:var(--color-g-green)]",
    track: "bg-[#0f5132]/12",
    label: "At or above target",
  },
  yellow: {
    text: "text-[#7a4f01]",
    chip: "bg-[#fef7e0] text-[#7a4f01] border-[#f3dfa2]",
    bar: "bg-[color:var(--color-g-yellow)]",
    track: "bg-[#7a4f01]/12",
    label: "Approaching floor",
  },
  red: {
    text: "text-[#8c1d18]",
    chip: "bg-[#fce8e6] text-[#8c1d18] border-[#f3b7b1]",
    bar: "bg-[color:var(--color-g-red)]",
    track: "bg-[#8c1d18]/12",
    label: "Below floor — approval required",
  },
  unknown: {
    text: "text-[color:var(--color-ink-2)]",
    chip: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)] border-[color:var(--color-hairline)]",
    bar: "bg-[color:var(--color-ink-3)]",
    track: "bg-[color:var(--color-surface-3)]",
    label: "No margin basis",
  },
};

export const pctFmt = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
