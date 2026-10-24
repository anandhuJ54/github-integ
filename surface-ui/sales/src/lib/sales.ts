import { api } from "@v3/ui/lib/server-fn";
import {
  computeLineMargin,
  rollupDeal,
  type CostConfig,
  type DiscountTier,
  type LineMargin,
} from "@v3/sales/lib/margin";

// FastAPI: surface-api/sales/routers/core_data.py (runs as the signed-in user).
const CORE = "/sales/core";
// exp_contract_provision is the CPQ router's allow-listed RPC (surface-api/sales/routers/cpq_data.py).
const PROVISION = "/sales/cpq/rpc/exp_contract_provision";
const enc = encodeURIComponent;

/* ─────────── Config ─────────── */

/** Tier bands by agent count. Defaults — change here, everything follows. */
export const TIER_BANDS = {
  individual: { min: 0, max: 4, label: "Individual" },
  smb: { min: 5, max: 100, label: "Small Business" },
  mm: { min: 101, max: 999, label: "Mid-Market" },
  ent: { min: 1000, max: Infinity, label: "Enterprise" },
} as const;

export type Tier = keyof typeof TIER_BANDS;

/** Book capacity per seller, by tier. Drives the staffing model. */
export const CAPACITY = { smb: 250, mm: 40, ent: 8 } as const;

export const SELLER_ROLES = {
  srx: {
    label: "Search Rank Expert",
    blurb:
      "Bottom-up. Territory is a third of the group's individuals plus dedicated logos. Works new claims, failed claim attempts, Nora engagement and the engaged-not-upgraded call list.",
  },
  smb: {
    label: "Small-Business Seller",
    blurb: "Accounts of 5–100 agents, up to 250 accounts. Inbound leads route to the owner.",
  },
  mid_market: {
    label: "Mid-Market Seller",
    blurb: "Accounts of 101–1,000 agents. Leads with the most-adopted logos and success stories into demos.",
  },
  enterprise: {
    label: "Enterprise Seller",
    blurb: "Accounts of 1,000+ agents and team leaders. Contracts live here.",
  },
} as const;

export type SellerRole = keyof typeof SELLER_ROLES;

export function tierForAgentCount(n: number): Tier {
  if (n >= TIER_BANDS.ent.min) return "ent";
  if (n >= TIER_BANDS.mm.min) return "mm";
  if (n >= TIER_BANDS.smb.min) return "smb";
  return "individual";
}

/* ─────────── Types ─────────── */

export type Rep = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  group_key: string;
  photo_url: string | null;
  is_demo: boolean | null;
};


export type Assignment = {
  id: string;
  rep_id: string | null;
  group_key: string;
  assignment_type: string;
  target_ref: string | null;
};

export type ActivityEvent = {
  id: string;
  event_type: string;
  subject_type: string | null;
  subject_id: string | null;
  account_id: string | null;
  logo: string | null;
  location: string | null;
  actor: string | null;
  value: Record<string, unknown> | null;
  occurred_at: string | null;
};

export type AccountTier = {
  account_id: string;
  agent_count: number | null;
  tier: string;
  group_key: string | null;
};

export type PriceBookRow = {
  id: string;
  product_key: string | null;
  scope: string | null;
  unit: string | null;
  list_price: number | null;
  contract_price: number | null;
  billing_type: string | null;
  notes: string | null;
  cost_type: string | null;
  cost_value: number | null;
  floor_margin_pct: number | null;
  discount_tiers: DiscountTier[] | null;
  credit_cost_per_unit?: number | null;
};

export type Contract = {
  id: string;
  org_id: string | null;
  account_id: string | null;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  token_package: number | null;
  mrr: number | null;
  created_by: string | null;
  sold_by: string | null;
  net: number | null;
  cost: number | null;
  margin_pct: number | null;
  approval_state: string | null;
  approval_note: string | null;
  is_demo: boolean | null;
};

export type LineItem = {
  id: string;
  contract_id: string | null;
  product_key: string | null;
  qty: number | null;
  unit_price: number | null;
  term: string | null;
  notes: string | null;
  discount_pct: number | null;
  cost: number | null;
  net: number | null;
  margin_pct: number | null;
};


export type Signature = {
  id: string;
  contract_id: string | null;
  signer_name: string | null;
  signer_email: string | null;
  status: string | null;
  signed_at: string | null;
};

export type Renewal = {
  id: string;
  contract_id: string | null;
  renewal_date: string | null;
  reminder_state: string | null;
  notes: string | null;
};

/* ─────────── Reps + territory ─────────── */

export async function loadReps(): Promise<Rep[]> {
  return api.get<Rep[]>(`${CORE}/reps`);
}

export async function loadAssignments(): Promise<Assignment[]> {
  return api.get<Assignment[]>(`${CORE}/assignments`);
}

export type Territory = {
  logos: string[];
  accountIds: string[];
  individualShare: string | null;
};

export function territoryFor(repId: string | null, assignments: Assignment[]): Territory {
  const mine = assignments.filter((a) => a.rep_id === repId);
  return {
    logos: mine.filter((a) => a.assignment_type === "logo").map((a) => a.target_ref ?? "").filter(Boolean),
    accountIds: mine
      .filter((a) => a.assignment_type === "account")
      .map((a) => a.target_ref ?? "")
      .filter(Boolean),
    individualShare: mine.find((a) => a.assignment_type === "individual_share")?.target_ref ?? null,
  };
}

export function inTerritory(e: ActivityEvent, t: Territory | null) {
  if (!t) return true;
  if (!t.logos.length && !t.accountIds.length) return true; // individuals-only territory
  return (
    (e.logo != null && t.logos.includes(e.logo)) ||
    (e.account_id != null && t.accountIds.includes(e.account_id))
  );
}

/* ─────────── Activity ─────────── */

export async function loadActivity(days = 30): Promise<ActivityEvent[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // newest first, at most 1000 rows (PostgREST always cut the old limit(5000) to 1000)
  return api.get<ActivityEvent[]>(`${CORE}/activity`, { params: { since } });
}

export type SubjectRollup = {
  subjectId: string;
  name: string;
  logo: string | null;
  location: string | null;
  office: string | null;
  accountId: string | null;
  claims: number;
  failedClaims: number;
  engagements: number;
  upgrades: number;
  downgrades: number;
  lastActivity: string | null;
  lastEngagement: string | null;
};

export function rollupSubjects(events: ActivityEvent[]): SubjectRollup[] {
  const map = new Map<string, SubjectRollup>();
  for (const e of events) {
    if (!e.subject_id) continue;
    const cur =
      map.get(e.subject_id) ??
      ({
        subjectId: e.subject_id,
        name: (e.value?.["display_name"] as string) ?? "Unnamed",
        logo: e.logo,
        location: e.location,
        office: e.actor,
        accountId: e.account_id,
        claims: 0,
        failedClaims: 0,
        engagements: 0,
        upgrades: 0,
        downgrades: 0,
        lastActivity: null,
        lastEngagement: null,
      } satisfies SubjectRollup);
    if (e.value?.["display_name"]) cur.name = e.value["display_name"] as string;
    if (e.event_type === "claim_created") cur.claims += 1;
    if (e.event_type === "claim_failed") cur.failedClaims += 1;
    if (e.event_type === "nora_engagement") {
      cur.engagements += 1;
      if (!cur.lastEngagement || (e.occurred_at ?? "") > cur.lastEngagement)
        cur.lastEngagement = e.occurred_at;
    }
    if (e.event_type === "upgrade") cur.upgrades += 1;
    if (e.event_type === "downgrade") cur.downgrades += 1;
    if (!cur.lastActivity || (e.occurred_at ?? "") > cur.lastActivity) cur.lastActivity = e.occurred_at;
    map.set(e.subject_id, cur);
  }
  return [...map.values()];
}

export type CallReason = { label: string; weight: number };

export type CallTarget = SubjectRollup & { reasons: CallReason[]; priority: number };

/** "Who to call and why" — the prime list. */
export function buildCallList(rollups: SubjectRollup[]): CallTarget[] {
  const out: CallTarget[] = [];
  for (const r of rollups) {
    const reasons: CallReason[] = [];
    if (r.engagements > 0 && r.upgrades === 0)
      reasons.push({ label: `Engaged ${r.engagements}× in 30d, not upgraded`, weight: 50 + r.engagements * 4 });
    if (r.failedClaims > 0)
      reasons.push({ label: `${r.failedClaims} failed claim attempt${r.failedClaims > 1 ? "s" : ""}`, weight: 40 });
    if (r.claims > 0 && r.upgrades === 0)
      reasons.push({ label: "New claim, no upgrade yet", weight: 25 });
    if (r.downgrades > 0) reasons.push({ label: "Downgraded — save call", weight: 45 });
    if (!reasons.length) continue;
    out.push({ ...r, reasons, priority: reasons.reduce((s, x) => s + x.weight, 0) });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export type AdoptionNode = {
  key: string;
  label: string;
  claimed: number;
  upgraded: number;
  engaged: number;
  people: number;
  children?: AdoptionNode[];
};

/** logo → location → person */
export function buildAdoptionTree(rollups: SubjectRollup[]): AdoptionNode[] {
  const logos = new Map<string, Map<string, SubjectRollup[]>>();
  for (const r of rollups) {
    const logo = r.logo ?? "Unassigned";
    const loc = r.location ?? "Unknown location";
    const byLoc = logos.get(logo) ?? new Map<string, SubjectRollup[]>();
    byLoc.set(loc, [...(byLoc.get(loc) ?? []), r]);
    logos.set(logo, byLoc);
  }
  const agg = (rows: SubjectRollup[]) => ({
    claimed: rows.filter((r) => r.claims > 0).length,
    upgraded: rows.filter((r) => r.upgrades > 0).length,
    engaged: rows.filter((r) => r.engagements > 0).length,
    people: rows.length,
  });
  return [...logos.entries()]
    .map(([logo, byLoc]) => {
      const children = [...byLoc.entries()]
        .map(([loc, rows]) => ({
          key: `${logo}::${loc}`,
          label: loc,
          ...agg(rows),
          children: rows.map((r) => ({
            key: r.subjectId,
            label: r.name,
            claimed: r.claims > 0 ? 1 : 0,
            upgraded: r.upgrades > 0 ? 1 : 0,
            engaged: r.engagements > 0 ? 1 : 0,
            people: 1,
          })),
        }))
        .sort((a, b) => b.people - a.people);
      const all = [...byLoc.values()].flat();
      return { key: logo, label: logo, ...agg(all), children };
    })
    .sort((a, b) => b.people - a.people);
}

/* ─────────── Account tiers + staffing ─────────── */

export async function loadAccountTiers(): Promise<AccountTier[]> {
  return api.get<AccountTier[]>(`${CORE}/account-tiers`);
}

export async function loadAccountNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const data = await api.post<{ id: string; name: string }[]>(`${CORE}/organizations/names`, { ids });
  return Object.fromEntries(data.map((o) => [o.id, o.name]));
}

/** Recompute tiers from live agent counts per root account. */
export async function recomputeAccountTiers(groupKey = "insurance") {
  // Each read is cut to 1000 rows, as PostgREST cut the old limit(20000) (follow-up 1j).
  const { orgs, pros } = await api.get<{
    orgs: { id: string; name: string; parent_org_id: string | null }[];
    pros: { id: string; primary_org_id: string | null }[];
  }>(`${CORE}/account-tiers/inputs`);
  const childrenOf = new Map<string, string[]>();
  orgs.forEach((o) => {
    if (!o.parent_org_id) return;
    childrenOf.set(o.parent_org_id, [...(childrenOf.get(o.parent_org_id) ?? []), o.id]);
  });
  const prosOf = new Map<string, number>();
  pros.forEach((p) => {
    if (!p.primary_org_id) return;
    prosOf.set(p.primary_org_id, (prosOf.get(p.primary_org_id) ?? 0) + 1);
  });
  const roots = orgs.filter((o) => !o.parent_org_id);
  const rows = roots.map((root) => {
    let agents = 0;
    const walk = (id: string) => {
      agents += prosOf.get(id) ?? 0;
      (childrenOf.get(id) ?? []).forEach(walk);
    };
    walk(root.id);
    return {
      account_id: root.id,
      agent_count: agents,
      tier: tierForAgentCount(agents),
      group_key: groupKey,
    };
  });
  // upsert on account_id; the server stamps updated_at
  await api.put(`${CORE}/account-tiers`, { rows });
  return rows.length;
}

export function staffingModel(tiers: AccountTier[]) {
  const counts = { individual: 0, smb: 0, mm: 0, ent: 0 } as Record<Tier, number>;
  tiers.forEach((t) => {
    if (t.tier in counts) counts[t.tier as Tier] += 1;
  });
  return {
    counts,
    needed: {
      smb: Math.ceil(counts.smb / CAPACITY.smb),
      mm: Math.ceil(counts.mm / CAPACITY.mm),
      ent: Math.ceil(counts.ent / CAPACITY.ent),
    },
  };
}

/* ─────────── Price book ─────────── */

export async function loadPriceBook() {
  const { book, products } = await api.get<{
    book: PriceBookRow[];
    products: { product_key: string; name: string; sort: number | null }[];
  }>(`${CORE}/price-book`);
  const names = Object.fromEntries(products.map((p) => [p.product_key, p.name]));
  const order = Object.fromEntries(products.map((p) => [p.product_key, p.sort ?? 100]));
  return book
    .map((r) => ({ ...r, productName: names[r.product_key ?? ""] ?? r.product_key ?? "—" }))
    .sort(
      (a, b) =>
        (order[a.product_key ?? ""] ?? 999) - (order[b.product_key ?? ""] ?? 999) ||
        (a.scope ?? "").localeCompare(b.scope ?? ""),
    );
}

export async function savePrice(
  id: string,
  patch: Partial<Pick<PriceBookRow, "list_price" | "contract_price" | "credit_cost_per_unit">>,
) {
  await api.patch(`${CORE}/price-book/${enc(id)}`, patch);
}

/* ─────────── Contracts / CPQ ─────────── */

export async function loadContracts() {
  // contracts throw on error; line items, signatures and renewals come back [] on error, as before
  const bundle = await api.get<{
    contracts: Contract[];
    lineItems: LineItem[];
    signatures: Signature[];
    renewals: Renewal[];
  }>(`${CORE}/contracts`);
  const contracts = bundle.contracts;
  const accountIds = [...new Set(contracts.map((c) => c.account_id ?? c.org_id).filter(Boolean))] as string[];
  const names = await loadAccountNames(accountIds);
  return {
    contracts: contracts.map((c) => ({
      ...c,
      accountName: names[(c.account_id ?? c.org_id) ?? ""] ?? "—",
    })),
    lineItems: bundle.lineItems,
    signatures: bundle.signatures,
    renewals: bundle.renewals,
  };
}

export function contractMrr(items: LineItem[]) {
  return items
    .filter((li) => (li.term ?? "monthly") === "monthly")
    .reduce((s, li) => s + Number(li.qty ?? 0) * Number(li.unit_price ?? 0), 0);
}

export async function syncContractMrr(contractId: string, items: LineItem[]) {
  await api.patch(`${CORE}/contracts/${enc(contractId)}`, { mrr: contractMrr(items) });
}

export async function createContract(input: {
  name: string;
  accountId: string;
  startDate?: string | null;
  endDate?: string | null;
  tokenPackage?: number;
  createdBy?: string | null;
}) {
  // created_by stays the caller's value: duplicateContract passes the original's creator
  const data = await api.post<{ id: string }>(`${CORE}/contracts`, {
    name: input.name,
    account_id: input.accountId,
    org_id: input.accountId,
    status: "draft",
    start_date: input.startDate ?? null,
    end_date: input.endDate ?? null,
    token_package: input.tokenPackage ?? 0,
    mrr: 0,
    created_by: input.createdBy ?? null,
  });
  return data.id;
}

export async function addLineItem(input: {
  contractId: string;
  productKey: string;
  qty: number;
  unitPrice: number;
  term: string;
  discountPct?: number;
  notes?: string | null;
}) {
  await api.post(`${CORE}/line-items`, {
    rows: [
      {
        contract_id: input.contractId,
        product_key: input.productKey,
        qty: input.qty,
        unit_price: input.unitPrice,
        term: input.term,
        discount_pct: input.discountPct ?? 0,
        notes: input.notes ?? null,
      },
    ],
  });
}

export async function setLineDiscount(id: string, discountPct: number) {
  await api.patch(`${CORE}/line-items/${enc(id)}`, { discount_pct: discountPct });
}

export async function removeLineItem(id: string) {
  await api.delete(`${CORE}/line-items/${enc(id)}`);
}

export async function setContractStatus(id: string, status: string) {
  await api.patch(`${CORE}/contracts/${enc(id)}`, { status });
  if (status === "active") {
    // DB trigger provisions on status change; call explicitly so late line-item
    // edits are always reflected in entitlements.
    await api.post(PROVISION, { args: { p_contract: id } });
  }
}

export async function provisionContract(id: string) {
  return api.post<number>(PROVISION, { args: { p_contract: id } });
}

export async function duplicateContract(contract: Contract, items: LineItem[]) {
  const newId = await createContract({
    name: `${contract.name} (copy)`,
    accountId: (contract.account_id ?? contract.org_id) ?? "",
    startDate: contract.start_date,
    endDate: contract.end_date,
    tokenPackage: contract.token_package ?? 0,
    createdBy: contract.created_by,
  });
  if (items.length) {
    await api.post(`${CORE}/line-items`, {
      rows: items.map((li) => ({
        contract_id: newId,
        product_key: li.product_key,
        qty: li.qty,
        unit_price: li.unit_price,
        term: li.term,
        notes: li.notes,
      })),
    });
  }
  await syncContractMrr(newId, items);
  return newId;
}

export async function sendSignature(input: {
  contractId: string;
  signerName: string;
  signerEmail: string;
}) {
  await api.post(`${CORE}/signatures`, {
    contract_id: input.contractId,
    signer_name: input.signerName,
    signer_email: input.signerEmail,
    status: "sent",
  });
}

export async function markSigned(signatureId: string) {
  // status "signed"; the server stamps signed_at
  await api.post(`${CORE}/signatures/${enc(signatureId)}/signed`);
}

export async function upsertRenewal(input: {
  contractId: string;
  renewalDate: string;
  reminderState?: string;
  notes?: string | null;
}) {
  await api.post(`${CORE}/renewals`, {
    contract_id: input.contractId,
    renewal_date: input.renewalDate,
    reminder_state: input.reminderState ?? "scheduled",
    notes: input.notes ?? null,
  });
}

export async function setRenewalState(id: string, reminder_state: string) {
  await api.patch(`${CORE}/renewals/${enc(id)}`, { reminder_state });
}

/* ─────────── Revenue rollup (Home + Sales dashboards) ─────────── */

export type RevenueRollup = {
  activeContracts: number;
  mrr: number;
  arr: number;
  expiring90: number;
  pendingSignatures: number;
};

export async function loadRevenue(): Promise<RevenueRollup> {
  const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  // the active rows throw on error; a failed count comes back null, as before
  const r = await api.get<{
    active: { mrr: number | null }[];
    expiring: number | null;
    pendingSignatures: number | null;
  }>(`${CORE}/revenue`, { params: { today, in90 } });
  const mrr = r.active.reduce((s, c) => s + Number(c.mrr ?? 0), 0);
  return {
    activeContracts: r.active.length,
    mrr,
    arr: mrr * 12,
    expiring90: r.expiring ?? 0,
    pendingSignatures: r.pendingSignatures ?? 0,
  };
}

/* ─────────── Margin-aware CPQ ─────────── */

export type PricedRow = PriceBookRow & { productName: string };

/**
 * Cost config for a line. Line items carry only product_key, so we resolve the
 * price-book row for that product (preferring the row whose list price matches
 * the quoted unit price, then the first row by scope).
 */
export function costConfigFor(book: PricedRow[], line: LineItem): CostConfig {
  const candidates = book.filter((r) => r.product_key === line.product_key);
  const exact = candidates.find(
    (r) => Number(r.list_price ?? -1) === Number(line.unit_price ?? -2),
  );
  const row = exact ?? candidates[0];
  return {
    costType: row?.cost_type ?? null,
    costValue: row?.cost_value ?? null,
    floorMarginPct: row?.floor_margin_pct ?? null,
    discountTiers: (row?.discount_tiers ?? []) as DiscountTier[],
  };
}

export type QuotedLine = { line: LineItem; margin: LineMargin; productName: string };

export function quoteLines(items: LineItem[], book: PricedRow[]): QuotedLine[] {
  return items.map((line) => {
    const cost = costConfigFor(book, line);
    return {
      line,
      productName:
        book.find((r) => r.product_key === line.product_key)?.productName ?? line.product_key ?? "—",
      margin: computeLineMargin({
        qty: Number(line.qty ?? 0),
        unitPrice: Number(line.unit_price ?? 0),
        discountPct: Number(line.discount_pct ?? 0),
        cost,
      }),
    };
  });
}

export function quoteDeal(quoted: QuotedLine[]) {
  return rollupDeal(quoted.map((q) => q.margin));
}

/** Persist per-line cost/net/margin and the deal-level roll-up. */
export async function persistQuoteMargins(contractId: string, quoted: QuotedLine[]) {
  for (const q of quoted) {
    if (q.line.id === "tmp") continue;
    await api.patch(`${CORE}/line-items/${enc(q.line.id)}`, {
      cost: round2(q.margin.cost),
      net: round2(q.margin.net),
      margin_pct: q.margin.marginPct == null ? null : Number(q.margin.marginPct.toFixed(4)),
    });
  }
  const deal = quoteDeal(quoted);
  await api.patch(`${CORE}/contracts/${enc(contractId)}`, {
    cost: round2(deal.cost),
    net: round2(deal.net),
    margin_pct: deal.marginPct == null ? null : Number(deal.marginPct.toFixed(4)),
    approval_state: deal.requiresApproval ? "required" : "not_required",
  });
  return deal;
}

function round2(n: number) {
  return Number(n.toFixed(2));
}

export async function requestMarginApproval(contractId: string, note: string) {
  await api.patch(`${CORE}/contracts/${enc(contractId)}`, { approval_state: "pending", approval_note: note });
}

export async function setMarginApproval(
  contractId: string,
  state: "approved" | "rejected" | "required",
  note?: string | null,
) {
  await api.patch(`${CORE}/contracts/${enc(contractId)}`, {
    approval_state: state,
    ...(note != null ? { approval_note: note } : {}),
  });
}

export async function setContractSeller(contractId: string, repId: string | null) {
  await api.patch(`${CORE}/contracts/${enc(contractId)}`, { sold_by: repId });
}

/* ─────────── Per-product credit consumption config (exp_products) ─────────── */
export async function saveCreditConfig(
  productKey: string,
  patch: { consumes_llm_credits: boolean; est_credits_per_professional: number | null; est_credits_per_location: number | null },
) {
  await api.patch(`${CORE}/products/${enc(productKey)}/credit-config`, patch);
}
