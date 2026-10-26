/**
 * CPQ persistence: quotes (exp_quotes), entitlement commit (exp_contracts +
 * exp_contract_line_items + exp_contract_provision), volume tiers
 * (exp_price_tiers) and promo codes (exp_promo_codes / exp_promo_redemptions).
 * Pricing is always computed by cpq-pricing — nothing here re-prices.
 */
import type { Json } from "@v3/state/auth/adapters/supabase/types";
import { api } from "@v3/state/api/server-fn";
import { CATALOG, catalogAnnualRate } from "./cpq-catalog";
import type { PriceTier as EnterprisePriceTier, TierKind } from "./cpq-depth";
import { initialState, normalizePackageInclusions, type QuoteState } from "./cpq-state";
import {
  calculateSummary,
  includedAddOnQuantities,
  safeNumber,
  voceCreditsCost,
  voceEnterpriseFirstCost,
  type QuoteSummary,
} from "./cpq-pricing";

const DRAFT_KEY = (id: string) => `cpq-draft:${id}`;

// FastAPI: surface-api/sales/routers/cpq_data.py (runs as the signed-in user).
const CPQ = "/sales/cpq";

/* ─────────── Quotes ─────────── */
export type QuoteRow = {
  id: string;
  name: string | null;
  status: string | null;
  summary: Json | null;
  updated_at: string | null;
  account_id: string | null;
  opportunity_id: string | null;
};

export async function listQuotes(): Promise<QuoteRow[]> {
  return api.get<QuoteRow[]>(`${CPQ}/quotes`);
}

export function newQuoteId() {
  return `Q-${Math.floor(10000 + Math.random() * 89999)}`;
}

export function readLocalDraft(quoteId: string): QuoteState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(quoteId));
    return raw ? (JSON.parse(raw) as QuoteState) : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(state: QuoteState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY(state.quoteId), JSON.stringify(state));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

/** Reads the saved quote (keyed by exp_quotes.name = quoteId); falls back to a local draft, then initialState(). */
export async function loadQuote(quoteId: string): Promise<{ state: QuoteState; saved: boolean }> {
  const data = await api.get<{ state: Json | null } | null>(`${CPQ}/quotes/state`, { params: { name: quoteId } });
  if (data?.state) return { state: { ...(data.state as unknown as QuoteState), quoteId }, saved: true };
  const local = readLocalDraft(quoteId);
  if (local) return { state: { ...local, quoteId }, saved: false };
  return { state: normalizePackageInclusions({ ...initialState(), quoteId, accountName: "", accountId: null }), saved: false };
}

export async function saveQuote(state: QuoteState, summary: QuoteSummary, status = "draft") {
  writeLocalDraft(state);
  // Updates the quote with this name, else inserts it (created_by = the signed-in user); the
  // server stamps updated_at.
  const payload = {
    name: state.quoteId,
    state: state as unknown as Json,
    summary: summary as unknown as Json,
    status,
    account_id: state.accountId ?? null,
    opportunity_id: state.opportunityId ?? null,
  };
  const { id } = await api.put<{ id: string }>(`${CPQ}/quotes`, payload);
  return id;
}

export async function prepareOpportunityQuote(input: {
  opportunityId: string;
  accountId: string | null;
  accountOrgId: string | null;
  accountName: string;
  professionalCount: number;
  locationCount: number;
  productKeys: string[];
}) {
  const existing = await api.get<{ name: string | null } | null>(
    `${CPQ}/quotes/by-opportunity/${encodeURIComponent(input.opportunityId)}`,
  );
  if (existing?.name) return { quoteId: existing.name, created: false };

  const keys = [...new Set(input.productKeys)];
  const state = initialState();
  state.quoteId = newQuoteId();
  state.accountId = input.accountId;
  state.accountOrgId = input.accountOrgId;
  state.accountName = input.accountName;
  state.opportunityId = input.opportunityId;
  state.preselectedProductKeys = keys;
  state.packageId = keys.includes("nora_amplify") ? "amplify" : keys.includes("nora") ? "engage" : null;
  state.professionals = input.professionalCount;
  state.locations = input.locationCount;
  state.discount = 0;
  state.enterpriseEnabled = keys.some((key) => ["campaigns", "enterprise_first_publishing", "platformFee"].includes(key));
  state.addOns = {
    listingsProfessionals: keys.includes("listings") ? input.professionalCount : 0,
    listingsLocations: keys.includes("listings") ? input.locationCount : 0,
    voceUsers: keys.includes("voce") ? input.professionalCount + input.locationCount : 0,
    sponsoredSearchSelected: keys.includes("sponsored"),
    sponsoredSearchZips: 0,
    sponsoredSearchMonthlyRate: 0,
    conversionAgentsSelected: keys.includes("conversion_agents"),
    conversionAgentProfessionals: keys.includes("conversion_agents") ? input.professionalCount : 0,
    conversionAgentLocations: keys.includes("conversion_agents") ? input.locationCount : 0,
  };
  state.enterprise = {
    platformFee: { users: 0, pricingMode: "standard" },
    engageCredits: { selected: false, users: 0, pricePerUser: 0 },
    amplifyCredits: { selected: false, users: 0, pricePerUser: 0 },
    voceCredits: { selected: false, users: 0, pricePerCredit: 0 },
    conversionAgents: { selected: false, agents: 0, packagePrice: 0 },
    sponsoredSearch: { selected: false, zips: 0, monthlyRate: 0 },
    campaigns5Pack: { selected: keys.includes("campaigns"), quantity: keys.includes("campaigns") ? 1 : 0 },
    benchmarkCampaign: { selected: false, quantity: 0 },
    customIntegration: { selected: false, quantity: 0 },
    customDevelopment: { selected: false, hours: 0 },
  };
  const normalized = normalizePackageInclusions(state);
  await saveQuote(normalized, calculateSummary(normalized));
  return { quoteId: normalized.quoteId, created: true };
}

/* ─────────── Entitlement line items ─────────── */
/* ─────────── Customer accounts (exp_accounts, read-only) ─────────── */
export type CpqAccount = {
  id: string;
  name: string;
  org_id: string | null;
  industry: string | null;
  account_type: string | null;
  city: string | null;
  region: string | null;
};

export async function listAccounts(): Promise<CpqAccount[]> {
  return api.get<CpqAccount[]>(`${CPQ}/accounts`);
}

export type CpqLine = { productKey: string; label: string; qty: number; unitPrice: number; net: number; notes?: string; entityType?: "professional" | "location" | null };

/** Every selected, billable item as an annual line. Totals equal calculateSummary (before discount). */
export function buildLineItems(state: QuoteState): CpqLine[] {
  const lines: CpqLine[] = [];
  const add = (productKey: string, label: string, qty: number, unitPrice: number, notes?: string) => {
    const net = qty * unitPrice;
    const l = label.toLowerCase();
    const entityType = l.includes("location") ? "location" : l.includes("professional") ? "professional" : null;
    if (qty > 0 && net > 0) lines.push({ productKey, label, qty, unitPrice, net, notes, entityType });
  };
  const inc = includedAddOnQuantities(state);
  if (state.packageId) {
    const p = CATALOG.packages[state.packageId];
    add(p.productKey, `${p.name} · professionals`, safeNumber(state.professionals), p.professionalMonthly * 12);
    add(p.productKey, `${p.name} · locations`, safeNumber(state.locations), p.locationMonthly * 12);
  }
  const a = state.addOns;
  const A = CATALOG.addOns;
  const pq = state.productQuantities;
  const listingsPro = pq?.listings?.professionals ?? a.listingsProfessionals;
  const listingsLoc = pq?.listings?.locations ?? a.listingsLocations;
  // Older drafts stored VOCE as one combined user count. When VOCE is included
  // by the package, use the package's scoped counts so that legacy state does
  // not create a small, duplicate billable VOCE line.
  const vocePro = pq?.voce?.professionals ?? (inc.voce.users ? state.professionals : a.voceUsers);
  const voceLoc = pq?.voce?.locations ?? (inc.voce.users ? state.locations : 0);
  add("listings", `${A.listings.name} · professionals`, Math.max(0, safeNumber(listingsPro) - inc.listings.professionals), catalogAnnualRate("listings", "professional"));
  add("listings", `${A.listings.name} · locations`, Math.max(0, safeNumber(listingsLoc) - inc.listings.locations), catalogAnnualRate("listings", "location"));
  add("voce", `${A.voce.name} · professionals`, Math.max(0, safeNumber(vocePro) - (inc.voce.users ? state.professionals : 0)), catalogAnnualRate("voce", "professional"));
  add("voce", `${A.voce.name} · locations`, Math.max(0, safeNumber(voceLoc) - (inc.voce.users ? state.locations : 0)), catalogAnnualRate("voce", "location"));
  const sponsored = pq?.sponsored;
  if (sponsored || a.sponsoredSearchSelected) {
    add("sponsored", `${A.sponsoredSearch.name} · professionals`, safeNumber(sponsored?.professionals ?? a.sponsoredSearchZips), catalogAnnualRate("sponsored", "professional"));
    add("sponsored", `${A.sponsoredSearch.name} · locations`, safeNumber(sponsored?.locations), catalogAnnualRate("sponsored", "location"));
  }
  const conversion = pq?.conversion_agents;
  if (conversion || a.conversionAgentsSelected) {
    add("conversion_agents", `${A.conversionAgents.name} · professionals`, safeNumber(conversion?.professionals ?? a.conversionAgentProfessionals), catalogAnnualRate("conversion_agents", "professional"));
    add("conversion_agents", `${A.conversionAgents.name} · locations`, safeNumber(conversion?.locations ?? a.conversionAgentLocations), catalogAnnualRate("conversion_agents", "location"));
  }
  if (state.enterpriseEnabled) {
    const e = state.enterprise;
    const C = CATALOG.enterprise;
    if (e.platformFee.pricingMode !== "included") add(C.platformFee.id, C.platformFee.name, safeNumber(e.platformFee.users), C.platformFee.perUserAnnual);
    if (e.engageCredits.selected) add(C.engageCredits.id, C.engageCredits.name, safeNumber(e.engageCredits.users), safeNumber(e.engageCredits.pricePerUser), `${C.engageCredits.creditsPerUser} credits/user`);
    if (e.amplifyCredits.selected) add(C.amplifyCredits.id, C.amplifyCredits.name, safeNumber(e.amplifyCredits.users), safeNumber(e.amplifyCredits.pricePerUser), `${C.amplifyCredits.creditsPerUser} credits/user`);
    if (e.voceCredits.selected) {
      add(C.voceCredits.id, C.voceCredits.name, 1, voceCreditsCost(state), `${safeNumber(e.voceCredits.users) * C.voceCredits.creditsPerUser} credits`);
      add(C.voceEnterpriseFirst.id, C.voceEnterpriseFirst.name, 1, voceEnterpriseFirstCost(state), "Auto-attached; cannot be waived");
    }
    if (e.conversionAgents.selected) add(C.conversionAgents.id, C.conversionAgents.name, 1, safeNumber(e.conversionAgents.packagePrice), `${safeNumber(e.conversionAgents.agents)} agents × ${C.conversionAgents.creditsPerAgent} credits`);
    if (e.sponsoredSearch.selected) add("sponsored", C.sponsoredSearch.name, safeNumber(e.sponsoredSearch.zips), (safeNumber(e.sponsoredSearch.monthlyRate) || C.sponsoredSearch.monthlyPerZipStart) * 12, "Enterprise");
    if (e.campaigns5Pack.selected) add("campaigns", C.campaigns5Pack.name, safeNumber(e.campaigns5Pack.quantity), C.campaigns5Pack.annual);
    if (e.benchmarkCampaign.selected) add(C.benchmarkCampaign.id, C.benchmarkCampaign.name, safeNumber(e.benchmarkCampaign.quantity), C.benchmarkCampaign.annual);
    if (e.customIntegration.selected) add(C.customIntegration.id, C.customIntegration.name, safeNumber(e.customIntegration.quantity), C.customIntegration.annual);
    if (e.customDevelopment.selected) add(C.customDevelopment.id, C.customDevelopment.name, safeNumber(e.customDevelopment.hours), C.customDevelopment.hourly, "hours");
    const extra = state.enterpriseQuantities ?? {};
    const first = CATALOG.products.enterprise_first_publishing;
    const firstQty = safeNumber(extra.enterprise_first_publishing);
    const firstRate = safeNumber(first?.prices.find((r) => r.unit === "user")?.list_price);
    if (firstQty > 0) {
      const amount = Math.max(safeNumber(first?.min_charge), firstQty * firstRate);
      add("enterprise_first_publishing", first?.name ?? "enterprise_first_publishing", 1, amount, `${firstQty} users × $${firstRate}`);
    }
    const creditsQty = safeNumber(extra.add_credits);
    if (creditsQty > 0) add("add_credits", CATALOG.products.add_credits?.name ?? "add_credits", creditsQty, CATALOG.config.creditPrice, "credits");
    const passthrough = safeNumber(state.adPassthrough);
    if (passthrough > 0) add("voce_boosts", CATALOG.products.voce_boosts?.name ?? "voce_boosts", 1, passthrough, "No discount · non-commissionable");
  }
  return lines;
}

/** Creates a draft contract (or replaces its lines), writes annual line items, then provisions. */
export async function commitEntitlements(
  state: QuoteState,
  contractId?: string | null,
  opts?: { lines?: CpqLine[]; oneTimeLines?: CpqLine[]; summary?: QuoteSummary; approval?: { pending: boolean; note: string } },
) {
  const summary = opts?.summary ?? calculateSummary(state);
  const lines = opts?.lines ?? buildLineItems(state);
  const approvalPatch = opts?.approval?.pending ? { approval_state: "pending", approval_note: opts.approval.note } : {};
  let id = contractId ?? null;
  // Each step is its own request (and transaction), in the order the browser always ran them.
  if (!id) {
    // created_by = the signed-in user (set by the server from the token)
    const data = await api.post<{ id: string }>(`${CPQ}/contracts`, {
      name: `${state.accountName || "Quote"} · ${state.quoteId}`,
      account_id: state.accountId ?? null,
      org_id: state.accountOrgId ?? null,
      status: "draft",
      mrr: Math.round((summary.estimatedArr / 12) * 100) / 100,
      net: summary.estimatedArr,
      terms: { quote_id: state.quoteId, summary, pricing_model: state.pricingModel ?? "ppu" } as unknown as Json,
      ...approvalPatch,
    });
    id = data.id;
  } else {
    await api.delete(`${CPQ}/contracts/${encodeURIComponent(id)}/line-items`);
    await api.patch(`${CPQ}/contracts/${encodeURIComponent(id)}`, {
      mrr: Math.round((summary.estimatedArr / 12) * 100) / 100,
      net: summary.estimatedArr,
      account_id: state.accountId ?? null,
      ...(state.accountOrgId ? { org_id: state.accountOrgId } : {}),
      ...approvalPatch,
    });
  }
  const gross = summary.bundle + summary.addOns + summary.enterprise;
  const discPct = summary.writeDownPct != null ? Math.round(summary.writeDownPct * 100) / 100 : gross > 0 ? Math.round((summary.discount / gross) * 10000) / 100 : 0;
  const oneTime = opts?.oneTimeLines ?? [];
  if (lines.length || oneTime.length) {
    // contract_id comes from the path; the server adds it to every row
    await api.post(`${CPQ}/contracts/${encodeURIComponent(id!)}/line-items`, {
      rows: [...lines.map((l) => ({ l, term: "annual", disc: discPct })), ...oneTime.map((l) => ({ l, term: "one_time", disc: 0 }))].map(({ l, term, disc }) => ({
        product_key: l.productKey,
        qty: l.qty,
        unit_price: l.unitPrice,
        net: l.net,
        term,
        discount_pct: disc,
        notes: [l.label, l.notes].filter(Boolean).join(" — "),
      })),
    });
  }
  const nextState = { ...state, contractId: id } as QuoteState & { contractId: string };
  if (opts?.approval?.pending) {
    // Needs approval: save the contract, but do not provision until a manager approves.
    await saveQuote(nextState, summary, "needs_approval");
    return { contractId: id!, lines: lines.length + oneTime.length, provisioned: null, provisionError: null, pendingApproval: true };
  }
  // A provisioning error is reported, not thrown (as before): the quote is still saved.
  let provisioned: number | null = null;
  let pErr: { message: string } | null = null;
  try {
    provisioned = await api.post<number | null>(`${CPQ}/rpc/exp_contract_provision`, { args: { p_contract: id! } });
  } catch (e) {
    pErr = { message: (e as Error | null)?.message ?? String(e) };
  }
  await saveQuote(nextState, summary, "entitlements_complete");
  return { contractId: id!, lines: lines.length + oneTime.length, provisioned: pErr ? null : (provisioned as number), provisionError: pErr?.message ?? null, pendingApproval: false };
}

/* ─────────── Volume pricing (exp_price_tiers) ─────────── */
export type PriceTier = {
  id: string;
  product_key: string | null;
  entity_type: string | null;
  min_qty: number | null;
  max_qty: number | null;
  unit_price: number | null;
  effective_from: string | null;
};

export type TierRow = EnterprisePriceTier & { id: string; effective_from: string | null };

const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** All exp_price_tiers rows, numerics coerced, mapped to the cpq-depth PriceTier shape (+ id). */
export async function listPriceTiers(): Promise<TierRow[]> {
  const data = await api.get<Record<string, unknown>[]>(`${CPQ}/price-tiers`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    effective_from: (r.effective_from as string | null) ?? null,
    product_key: String(r.product_key ?? ""),
    entity_type: (r.entity_type as string | null) ?? null,
    tier_kind: r.tier_kind as TierKind,
    variant: (r.variant as string | null) ?? null,
    min_qty: Number(r.min_qty ?? 0),
    max_qty: numOrNull(r.max_qty),
    unit_price: numOrNull(r.unit_price),
    list_per_user: numOrNull(r.list_per_user),
    discount_pct: numOrNull(r.discount_pct),
    platform_fee_annual: numOrNull(r.platform_fee_annual),
    addl_user_monthly: numOrNull(r.addl_user_monthly),
    setup_fee: numOrNull(r.setup_fee),
    included_campaigns: numOrNull(r.included_campaigns),
    pooled_credits: numOrNull(r.pooled_credits),
    overage_rate: numOrNull(r.overage_rate),
    label: (r.label as string | null) ?? null,
    sort: numOrNull(r.sort),
  }));
}

export function tiersFor<T extends EnterprisePriceTier>(rows: T[], productKey: string, variant: string | null): T[] {
  return rows.filter((r) => r.product_key === productKey && r.variant === variant && r.tier_kind);
}

/** Per-row save for the Volume tiers tab (numeric schedule fields only). */
export async function updateTierFields(id: string, patch: Partial<Record<"min_qty" | "max_qty" | "unit_price" | "discount_pct" | "platform_fee_annual" | "addl_user_monthly" | "setup_fee" | "included_campaigns" | "pooled_credits" | "overage_rate", number | null>>) {
  await api.patch(`${CPQ}/price-tiers/${encodeURIComponent(id)}`, patch);
}

export async function upsertPriceTier(t: Omit<PriceTier, "id"> & { id?: string }) {
  const { id, ...row } = t;
  if (id) await api.patch(`${CPQ}/price-tiers/${encodeURIComponent(id)}`, row);
  else await api.post(`${CPQ}/price-tiers`, row);
}

export async function deletePriceTier(id: string) {
  await api.delete(`${CPQ}/price-tiers/${encodeURIComponent(id)}`);
}

/* ─────────── Promo codes ─────────── */
export type Promo = {
  id: string;
  code: string | null;
  active: boolean | null;
  applies_to_products: string[] | null;
  discount_kind: string | null;
  amount: number | null;
  discount_pct: number | null;
  pricing_type: string | null;
  duration_months: number | null;
  starts_at: string | null;
  expires_at: string | null;
  scope_type: string | null;
  applies_to_scope: string | null;
  seller_id: string | null;
};

export async function listPromos(): Promise<Promo[]> {
  return api.get<Promo[]>(`${CPQ}/promos`);
}

export async function createPromo(p: Omit<Promo, "id" | "active">) {
  // inserted with active: true by the server
  await api.post(`${CPQ}/promos`, p);
}

export async function setPromoActive(id: string, active: boolean) {
  await api.patch(`${CPQ}/promos/${encodeURIComponent(id)}`, { active });
}

export async function redemptionCounts(): Promise<Record<string, number>> {
  const data = await api.get<{ code: string | null }[]>(`${CPQ}/promo-redemptions`);
  const out: Record<string, number> = {};
  for (const r of data ?? []) if (r.code) out[r.code] = (out[r.code] ?? 0) + 1;
  return out;
}

/** Finds an active, in-window promo by code (case-insensitive). */
export async function findPromo(code: string): Promise<Promo | null> {
  const data = await api.get<Promo | null>(`${CPQ}/promos/find`, { params: { code: code.trim() } });
  if (!data) return null;
  const now = Date.now();
  if (data.starts_at && Date.parse(data.starts_at) > now) return null;
  if (data.expires_at && Date.parse(data.expires_at) < now) return null;
  return data;
}

/**
 * Discount a promo gives on this quote: percent of the gross for the products it
 * applies to (all products when empty); fixed_price sets that gross to `amount`.
 */
export function promoDiscount(promo: Promo, state: QuoteState): number {
  const lines = buildLineItems(state);
  const scope = promo.applies_to_products?.length ? new Set(promo.applies_to_products) : null;
  const gross = lines.filter((l) => !scope || scope.has(l.productKey)).reduce((s, l) => s + l.net, 0);
  const amt = safeNumber(promo.amount ?? promo.discount_pct);
  if (promo.discount_kind === "fixed_price") return Math.max(0, gross - amt);
  return Math.round(gross * (amt / 100) * 100) / 100;
}

/** Approval state + note of a contract (read). */
export async function loadContractApproval(contractId: string) {
  return api.get<{ approval_state: string; approval_note: string | null } | null>(
    `${CPQ}/contracts/${encodeURIComponent(contractId)}/approval`,
  );
}
