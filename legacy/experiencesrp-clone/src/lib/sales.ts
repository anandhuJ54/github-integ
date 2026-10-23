import { supabase } from "@/integrations/supabase/client";
import {
  computeLineMargin,
  rollupDeal,
  type CostConfig,
  type DiscountTier,
  type LineMargin,
} from "@/lib/margin";

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
  const { data, error } = await supabase
    .from("exp_sales_reps")
    .select("id,name,email,role,group_key,photo_url,is_demo")
    .order("group_key")
    .order("role");

  if (error) throw error;
  return (data ?? []) as Rep[];
}

export async function loadAssignments(): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("exp_sales_assignments")
    .select("id,rep_id,group_key,assignment_type,target_ref");
  if (error) throw error;
  return (data ?? []) as Assignment[];
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
  const { data, error } = await supabase
    .from("exp_activity_events")
    .select("id,event_type,subject_type,subject_id,account_id,logo,location,actor,value,occurred_at")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as ActivityEvent[];
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
  const { data, error } = await supabase
    .from("exp_account_tier")
    .select("account_id,agent_count,tier,group_key")
    .order("agent_count", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AccountTier[];
}

export async function loadAccountNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("organizations").select("id,name").in("id", ids);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((o) => [o.id, o.name]));
}

/** Recompute tiers from live agent counts per root account. */
export async function recomputeAccountTiers(groupKey = "insurance") {
  const [orgsRes, prosRes] = await Promise.all([
    supabase.from("organizations").select("id,name,parent_org_id").limit(20000),
    supabase.from("professionals").select("id,primary_org_id").limit(20000),
  ]);
  if (orgsRes.error) throw orgsRes.error;
  if (prosRes.error) throw prosRes.error;
  const orgs = orgsRes.data ?? [];
  const pros = prosRes.data ?? [];
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
      updated_at: new Date().toISOString(),
    };
  });
  const { error } = await supabase.from("exp_account_tier").upsert(rows, { onConflict: "account_id" });
  if (error) throw error;
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
  const [pbRes, prodRes] = await Promise.all([
    supabase
      .from("exp_price_book")
      .select(
        "id,product_key,scope,unit,list_price,contract_price,billing_type,notes,cost_type,cost_value,floor_margin_pct,discount_tiers,credit_cost_per_unit",
      ),
    supabase.from("exp_products").select("product_key,name,sort").order("sort"),
  ]);
  if (pbRes.error) throw pbRes.error;
  if (prodRes.error) throw prodRes.error;
  const names = Object.fromEntries((prodRes.data ?? []).map((p) => [p.product_key, p.name]));
  const order = Object.fromEntries((prodRes.data ?? []).map((p) => [p.product_key, p.sort ?? 100]));
  return ((pbRes.data ?? []) as PriceBookRow[])
    .map((r) => ({ ...r, productName: names[r.product_key ?? ""] ?? r.product_key ?? "—" }))
    .sort(
      (a, b) =>
        (order[a.product_key ?? ""] ?? 999) - (order[b.product_key ?? ""] ?? 999) ||
        (a.scope ?? "").localeCompare(b.scope ?? ""),
    );
}

export async function savePrice(id: string, patch: Partial<PriceBookRow>) {
  const { error } = await supabase.from("exp_price_book").update(patch).eq("id", id);
  if (error) throw error;
}

/* ─────────── Contracts / CPQ ─────────── */

export async function loadContracts() {
  const [cRes, liRes, sigRes, renRes] = await Promise.all([
    supabase
      .from("exp_contracts")
      .select(
        "id,org_id,account_id,name,status,start_date,end_date,token_package,mrr,created_by,sold_by,net,cost,margin_pct,approval_state,approval_note,is_demo",
      )
      .order("name"),
    supabase
      .from("exp_contract_line_items")
      .select("id,contract_id,product_key,qty,unit_price,term,notes,discount_pct,cost,net,margin_pct"),
    supabase.from("exp_contract_signatures").select("id,contract_id,signer_name,signer_email,status,signed_at"),
    supabase.from("exp_contract_renewals").select("id,contract_id,renewal_date,reminder_state,notes"),
  ]);
  if (cRes.error) throw cRes.error;
  const contracts = (cRes.data ?? []) as Contract[];
  const accountIds = [...new Set(contracts.map((c) => c.account_id ?? c.org_id).filter(Boolean))] as string[];
  const names = await loadAccountNames(accountIds);
  return {
    contracts: contracts.map((c) => ({
      ...c,
      accountName: names[(c.account_id ?? c.org_id) ?? ""] ?? "—",
    })),
    lineItems: (liRes.data ?? []) as LineItem[],
    signatures: (sigRes.data ?? []) as Signature[],
    renewals: (renRes.data ?? []) as Renewal[],
  };
}

export function contractMrr(items: LineItem[]) {
  return items
    .filter((li) => (li.term ?? "monthly") === "monthly")
    .reduce((s, li) => s + Number(li.qty ?? 0) * Number(li.unit_price ?? 0), 0);
}

export async function syncContractMrr(contractId: string, items: LineItem[]) {
  const { error } = await supabase
    .from("exp_contracts")
    .update({ mrr: contractMrr(items) })
    .eq("id", contractId);
  if (error) throw error;
}

export async function createContract(input: {
  name: string;
  accountId: string;
  startDate?: string | null;
  endDate?: string | null;
  tokenPackage?: number;
  createdBy?: string | null;
}) {
  const { data, error } = await supabase
    .from("exp_contracts")
    .insert({
      name: input.name,
      account_id: input.accountId,
      org_id: input.accountId,
      status: "draft",
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      token_package: input.tokenPackage ?? 0,
      mrr: 0,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
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
  const { error } = await supabase.from("exp_contract_line_items").insert({
    contract_id: input.contractId,
    product_key: input.productKey,
    qty: input.qty,
    unit_price: input.unitPrice,
    term: input.term,
    discount_pct: input.discountPct ?? 0,
    notes: input.notes ?? null,
  });
  if (error) throw error;
}

export async function setLineDiscount(id: string, discountPct: number) {
  const { error } = await supabase
    .from("exp_contract_line_items")
    .update({ discount_pct: discountPct })
    .eq("id", id);
  if (error) throw error;
}

export async function removeLineItem(id: string) {
  const { error } = await supabase.from("exp_contract_line_items").delete().eq("id", id);
  if (error) throw error;
}

export async function setContractStatus(id: string, status: string) {
  const { error } = await supabase.from("exp_contracts").update({ status }).eq("id", id);
  if (error) throw error;
  if (status === "active") {
    // DB trigger provisions on status change; call explicitly so late line-item
    // edits are always reflected in entitlements.
    const { error: rpcError } = await supabase.rpc("exp_contract_provision", { p_contract: id });
    if (rpcError) throw rpcError;
  }
}

export async function provisionContract(id: string) {
  const { data, error } = await supabase.rpc("exp_contract_provision", { p_contract: id });
  if (error) throw error;
  return data as number;
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
    const { error } = await supabase.from("exp_contract_line_items").insert(
      items.map((li) => ({
        contract_id: newId,
        product_key: li.product_key,
        qty: li.qty,
        unit_price: li.unit_price,
        term: li.term,
        notes: li.notes,
      })),
    );
    if (error) throw error;
  }
  await syncContractMrr(newId, items);
  return newId;
}

export async function sendSignature(input: {
  contractId: string;
  signerName: string;
  signerEmail: string;
}) {
  const { error } = await supabase.from("exp_contract_signatures").insert({
    contract_id: input.contractId,
    signer_name: input.signerName,
    signer_email: input.signerEmail,
    status: "sent",
  });
  if (error) throw error;
}

export async function markSigned(signatureId: string) {
  const { error } = await supabase
    .from("exp_contract_signatures")
    .update({ status: "signed", signed_at: new Date().toISOString() })
    .eq("id", signatureId);
  if (error) throw error;
}

export async function upsertRenewal(input: {
  contractId: string;
  renewalDate: string;
  reminderState?: string;
  notes?: string | null;
}) {
  const { error } = await supabase.from("exp_contract_renewals").insert({
    contract_id: input.contractId,
    renewal_date: input.renewalDate,
    reminder_state: input.reminderState ?? "scheduled",
    notes: input.notes ?? null,
  });
  if (error) throw error;
}

export async function setRenewalState(id: string, reminder_state: string) {
  const { error } = await supabase.from("exp_contract_renewals").update({ reminder_state }).eq("id", id);
  if (error) throw error;
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
  const [active, expiring, sigs] = await Promise.all([
    supabase.from("exp_contracts").select("mrr").eq("status", "active"),
    supabase
      .from("exp_contracts")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", in90),
    supabase
      .from("exp_contract_signatures")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
  ]);
  if (active.error) throw active.error;
  const mrr = (active.data ?? []).reduce((s, c) => s + Number(c.mrr ?? 0), 0);
  return {
    activeContracts: (active.data ?? []).length,
    mrr,
    arr: mrr * 12,
    expiring90: expiring.count ?? 0,
    pendingSignatures: sigs.count ?? 0,
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
    const { error } = await supabase
      .from("exp_contract_line_items")
      .update({
        cost: round2(q.margin.cost),
        net: round2(q.margin.net),
        margin_pct: q.margin.marginPct == null ? null : Number(q.margin.marginPct.toFixed(4)),
      })
      .eq("id", q.line.id);
    if (error) throw error;
  }
  const deal = quoteDeal(quoted);
  const { error } = await supabase
    .from("exp_contracts")
    .update({
      cost: round2(deal.cost),
      net: round2(deal.net),
      margin_pct: deal.marginPct == null ? null : Number(deal.marginPct.toFixed(4)),
      approval_state: deal.requiresApproval ? "required" : "not_required",
    })
    .eq("id", contractId);
  if (error) throw error;
  return deal;
}

function round2(n: number) {
  return Number(n.toFixed(2));
}

export async function requestMarginApproval(contractId: string, note: string) {
  const { error } = await supabase
    .from("exp_contracts")
    .update({ approval_state: "pending", approval_note: note })
    .eq("id", contractId);
  if (error) throw error;
}

export async function setMarginApproval(
  contractId: string,
  state: "approved" | "rejected" | "required",
  note?: string | null,
) {
  const { error } = await supabase
    .from("exp_contracts")
    .update({ approval_state: state, ...(note != null ? { approval_note: note } : {}) })
    .eq("id", contractId);
  if (error) throw error;
}

export async function setContractSeller(contractId: string, repId: string | null) {
  const { error } = await supabase.from("exp_contracts").update({ sold_by: repId }).eq("id", contractId);
  if (error) throw error;
}

/* ─────────── Per-product credit consumption config (exp_products) ─────────── */
export async function saveCreditConfig(
  productKey: string,
  patch: { consumes_llm_credits: boolean; est_credits_per_professional: number | null; est_credits_per_location: number | null },
) {
  const { error } = await supabase.from("exp_products").update(patch).eq("product_key", productKey);
  if (error) throw error;
}
