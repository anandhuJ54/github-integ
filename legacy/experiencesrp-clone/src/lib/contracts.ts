import { supabase } from "@/integrations/supabase/client";

/* Module 4 — Contracts. Reads exp_contract_* tables; every lifecycle write goes through m4_* RPCs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export type Contract = {
  id: string;
  org_id: string | null;
  account_id: string | null;
  name: string;
  status: string;
  stage: string | null;
  contract_number: string | null;
  quote_id: string | null;
  opportunity_id: string | null;
  parent_contract_id: string | null;
  contract_type: string | null;
  acv: number | null;
  mrr: number | null;
  net: number | null;
  payment_terms: string | null;
  billing_frequency: string | null;
  auto_renew: boolean | null;
  renewal_term_months: number | null;
  notice_period_days: number | null;
  notice_deadline: string | null;
  special_terms: string | null;
  current_version: number | null;
  signing_version: number | null;
  is_locked: boolean | null;
  executed_at: string | null;
  document_hash: string | null;
  terms: Record<string, any> | null;
  created_by: string | null;
  sold_by: string | null;
  created_at: string;
  start_date?: string | null;
  end_date?: string | null;
  is_demo: boolean | null;
  billing_mode?: string | null;
  total_recurring?: number | null;
  total_one_time?: number | null;
  expiration_at?: string | null;
  renewal_uplift_pct?: number | null;
  master_agreement_url?: string | null;
  master_agreement_version?: string | null;
};

export type Org = { id: string; name: string; logo_url: string | null };
export type Activity = { id: string; contract_id: string; event_type: string; actor: string | null; detail: any; occurred_at: string };
export type Renewal = {
  id: string;
  contract_id: string;
  renewal_date: string | null;
  notice_deadline: string | null;
  owner: string | null;
  current_acv: number | null;
  expansion_est: number | null;
  utilization_pct: number | null;
  status: string;
  renewal_contract_id: string | null;
};

export type ContractRow = Contract & {
  orgName: string | null;
  logoUrl: string | null;
  latest: Activity | null;
  renewal: Renewal | null;
};

async function rows<T>(q: Promise<{ data: T[] | null; error: any }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function orgsById(ids: string[]): Promise<Map<string, Org>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const list = await rows<Org>(db.from("organizations").select("id,name,logo_url").in("id", uniq));
  return new Map(list.map((o) => [o.id, o]));
}

export async function listContracts(): Promise<ContractRow[]> {
  const contracts = await rows<Contract>(db.from("exp_contracts").select("*").order("created_at", { ascending: false }));
  const ids = contracts.map((c) => c.id);
  const [orgs, acts, rens] = await Promise.all([
    orgsById(contracts.map((c) => c.org_id ?? c.account_id ?? "")),
    ids.length
      ? rows<Activity>(db.from("exp_contract_activity").select("*").in("contract_id", ids).order("occurred_at", { ascending: false }).limit(2000))
      : Promise.resolve([] as Activity[]),
    ids.length ? rows<Renewal>(db.from("exp_contract_renewals").select("*").in("contract_id", ids)) : Promise.resolve([] as Renewal[]),
  ]);
  const latest = new Map<string, Activity>();
  for (const a of acts) if (!latest.has(a.contract_id)) latest.set(a.contract_id, a);
  return contracts.map((c) => {
    const o = orgs.get(c.org_id ?? "") ?? orgs.get(c.account_id ?? "");
    return {
      ...c,
      orgName: o?.name ?? (c.terms?.quote_state?.accountName as string | undefined) ?? null,
      logoUrl: o?.logo_url ?? null,
      latest: latest.get(c.id) ?? null,
      renewal: rens.find((r) => r.contract_id === c.id && (r.status === "upcoming" || r.status === "in_progress")) ?? rens.find((r) => r.contract_id === c.id) ?? null,
    };
  });
}

export type ContractDetail = {
  contract: Contract;
  org: Org | null;
  lineItems: { id: string; product_key: string; name_snapshot: string | null; scope: string | null; qty: number | null; unit_price: number | null; discount_pct: number | null; net: number | null; line_type?: string | null; product_code?: string | null; billing_mode?: string | null; subtotal?: number | null; is_base?: boolean | null }[];
  versions: { id: string; version_no: number; label: string | null; kind: string | null; source: string | null; uploaded_by: string | null; change_summary: any; approval_state: string | null; is_signing_copy: boolean | null; created_at: string }[];
  recipients: { id: string; party: string; person_name: string | null; email: string | null; role: string | null; signing_order: number | null }[];
  approvals: { id: string; approver_role: string; approver_name: string | null; email: string | null; status: string; reason: string | null; requested_at: string | null; decided_at: string | null }[];
  signatures: { id: string; signer_name: string | null; signer_email: string | null; party: string | null; role: string | null; signing_order: number | null; token: string; status: string; sent_at: string | null; signed_at: string | null; signed_ip?: string | null; identity_method?: string | null; viewed_at?: string | null; email_verified?: boolean | null; version_no: number | null; version_hash: string | null }[];
  activity: Activity[];
  documents: { id: string; doc_type: string; title: string; auto_generated: boolean | null; conditional_on: string | null; content: any; template_key?: string | null }[];
  renewal: Renewal | null;
};

export async function getContract(id: string): Promise<ContractDetail> {
  const { data: contract, error } = await db.from("exp_contracts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!contract) throw new Error("Contract not found");
  const by = (t: string, order?: string, asc = false) => {
    let q = db.from(t).select("*").eq("contract_id", id);
    if (order) q = q.order(order, { ascending: asc });
    return rows<any>(q);
  };
  const [orgs, lineItems, versions, recipients, approvals, signatures, activity, documents, renewals] = await Promise.all([
    orgsById([contract.org_id ?? contract.account_id ?? ""]),
    by("exp_contract_line_items"),
    by("exp_contract_versions", "version_no"),
    by("exp_contract_recipients", "signing_order", true),
    by("exp_contract_approvals", "requested_at"),
    by("exp_contract_signatures", "signing_order", true),
    by("exp_contract_activity", "occurred_at"),
    by("exp_contract_documents"),
    by("exp_contract_renewals"),
  ]);
  return {
    contract,
    org: orgs.get(contract.org_id ?? "") ?? orgs.get(contract.account_id ?? "") ?? null,
    lineItems,
    versions,
    recipients,
    approvals,
    signatures,
    activity,
    documents,
    renewal: renewals[0] ?? null,
  };
}

export type RenewalRow = Renewal & { contract: Pick<Contract, "id" | "name" | "acv" | "end_date"> | null };

export async function loadRenewals(): Promise<RenewalRow[]> {
  const rens = await rows<Renewal>(
    db.from("exp_contract_renewals").select("*").in("status", ["upcoming", "in_progress"]).order("renewal_date", { ascending: true }),
  );
  const ids = [...new Set(rens.map((r) => r.contract_id))];
  const cs = ids.length ? await rows<Contract>(db.from("exp_contracts").select("*").in("id", ids)) : [];
  return rens.map((r) => {
    const c = cs.find((x) => x.id === r.contract_id);
    return { ...r, contract: c ? { id: c.id, name: c.name, acv: c.acv, end_date: c.end_date ?? null } : null };
  });
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const createContractFromQuote = (quoteId: string, createdBy: string | null) =>
  rpc<string>("m4_create_contract_from_quote", { p_quote_id: quoteId, p_created_by: createdBy });
export const addVersion = (contractId: string, kind: string, label: string, uploadedBy: string | null, changes: unknown, source: string) =>
  rpc<number>("m4_add_version", { p_contract: contractId, p_kind: kind, p_label: label, p_uploaded_by: uploadedBy, p_changes: changes, p_source: source });
export const requestApproval = (contractId: string, role: string, name: string | null, email: string | null, actor: string | null) =>
  rpc<string>("m4_request_approval", { p_contract: contractId, p_role: role, p_name: name, p_email: email, p_actor: actor });
export const decideApproval = (approvalId: string, status: string, reason: string | null, actor: string | null) =>
  rpc<void>("m4_decide_approval", { p_approval: approvalId, p_status: status, p_reason: reason, p_actor: actor });
export const finalizeContract = (contractId: string, actor: string | null) =>
  rpc<{ ok: boolean; checklist: unknown }>("m4_finalize", { p_contract: contractId, p_actor: actor });
export const sendForSignature = (contractId: string, actor: string | null) =>
  rpc<number>("m4_send_for_signature", { p_contract: contractId, p_actor: actor });
export const startRenewal = (contractId: string, actor: string | null) =>
  rpc<string>("m4_start_renewal", { p_contract: contractId, p_actor: actor });

export async function updateSpecialTerms(contractId: string, text: string) {
  const { error } = await db.from("exp_contracts").update({ special_terms: text || null }).eq("id", contractId);
  if (error) throw new Error(error.message);
}

export type Notification = { id: string; user_ref: string | null; kind: string; title: string; body: string | null; link: string | null; entity_id: string | null; read_at: string | null; created_at: string };
export const loadNotifications = (limit = 20) =>
  rows<Notification>(db.from("exp_notifications").select("*").order("created_at", { ascending: false }).limit(limit));
export async function markNotificationRead(id: string) {
  const { error } = await db.from("exp_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── shared derivations ── */
export type Bucket = "needs_me" | "negotiating" | "awaiting_signature" | "active" | "renewing" | "expired";
const stageOf = (c: Contract) => (c.stage ?? c.status ?? "").toLowerCase();

export function bucketsFor(c: ContractRow): Bucket[] {
  const s = stageOf(c);
  const st = (c.status ?? "").toLowerCase();
  const out: Bucket[] = [];
  if (s === "draft" || s === "review" || st === "draft") out.push("needs_me");
  if (s === "negotiating") out.push("negotiating");
  if (s === "out_for_signature" || s === "final" || s === "signature") out.push("awaiting_signature");
  if (st === "active") out.push("active");
  if (c.renewal && c.renewal.status === "upcoming") out.push("renewing");
  if (c.end_date && new Date(c.end_date) < new Date() && st !== "active") out.push("expired");
  return out;
}

export function nextAction(c: ContractRow): { text: string; nora: boolean } {
  const s = stageOf(c);
  const ev = c.latest?.event_type ?? "";
  if (ev.includes("redline")) return { text: "Customer redline returned", nora: true };
  if (ev.includes("approval_requested")) return { text: "Awaiting legal approval", nora: true };
  if (s === "out_for_signature") return { text: "Nudge signer", nora: true };
  if (c.renewal?.status === "upcoming" && c.renewal.renewal_date) {
    const d = Math.ceil((new Date(c.renewal.renewal_date).getTime() - Date.now()) / 86400000);
    return { text: `Renewal due in ${d} days`, nora: true };
  }
  if (s === "draft") return { text: "Send for approval", nora: false };
  if (s === "negotiating") return { text: "Review redline / finalize", nora: false };
  if (s === "review" || s === "final") return { text: "Finalize & send", nora: false };
  if ((c.status ?? "") === "active") return { text: "—", nora: false };
  return { text: ev ? ev.replace(/_/g, " ") : "—", nora: false };
}

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const money = (n: number | null | undefined) => (n == null ? "—" : usd.format(Number(n)));
export const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

/* ── order-form editing (exp_order_sku + m4_add_line / m4_remove_line / m4_add_recipient / m4_remove_recipient) ── */
export type Sku = {
  code: string; name: string; family: string | null; edition: string | null;
  line_type: "recurring" | "one_time" | string; default_billing_mode: "annual" | "monthly" | string | null;
  unit: string | null; annual_unit_price: number | null; monthly_unit_price: number | null;
  is_base_package: boolean | null; included_credits: number | null; overage_unit: string | null;
  overage_rate_annual: number | null; overage_rate_monthly: number | null; overage_method: string | null;
  exhibit_key: string | null; nora_product_key: string | null; active: boolean | null;
};
export const loadSkus = () =>
  rows<Sku>(db.from("exp_order_sku").select("*").eq("active", true).order("family", { ascending: true }).order("name", { ascending: true }));

const currentEmail = async () => (await supabase.auth.getUser()).data.user?.email ?? null;

export const addLine = async (contractId: string, code: string, qty: number, unitPrice: number | null, discountPct: number, termMonths: number | null, billingMode: string | null) =>
  rpc<string>("m4_add_line", { p_contract: contractId, p_code: code, p_qty: qty, p_unit_price: unitPrice, p_discount_pct: discountPct, p_term_months: termMonths, p_billing_mode: billingMode, p_actor: await currentEmail() });
export const removeLine = async (lineId: string) => rpc<void>("m4_remove_line", { p_line: lineId, p_actor: await currentEmail() });
export const addRecipient = async (contractId: string, party: string, name: string, email: string, role: string, order: number | null) =>
  rpc<string>("m4_add_recipient", { p_contract: contractId, p_party: party, p_name: name, p_email: email, p_role: role, p_order: order, p_actor: await currentEmail() });
export const removeRecipient = async (id: string) => rpc<void>("m4_remove_recipient", { p_recipient: id, p_actor: await currentEmail() });

/* ── Phases B/D/E/F: documents, invoices, usage, addenda, renewal notices ── */
export type InvoiceLine = { id?: string; invoice_id: string; description: string | null; product_code: string | null; qty: number | null; unit: string | null; unit_price: number | null; amount: number | null };
export type Invoice = { id: string; contract_id: string; number: string | null; invoice_type: string; status: string | null; period_start: string | null; period_end: string | null; total: number | null; billing_contact_email: string | null; issued_at: string | null; due_at: string | null; lines: InvoiceLine[] };
export type UsageMeter = { id?: string; contract_id: string; product_code: string; metric: string; period_start: string | null; period_end: string | null; included_qty: number | null; measured_qty: number | null; high_water_qty: number | null };

export async function loadInvoices(contractId: string): Promise<Invoice[]> {
  const invs = await rows<Omit<Invoice, "lines">>(db.from("exp_invoice").select("*").eq("contract_id", contractId).order("issued_at", { ascending: false, nullsFirst: true }));
  const ids = invs.map((i) => i.id);
  const lines = ids.length ? await rows<InvoiceLine>(db.from("exp_invoice_line").select("*").in("invoice_id", ids)) : [];
  return invs.map((i) => ({ ...i, lines: lines.filter((l) => l.invoice_id === i.id) }));
}
export const loadUsage = (contractId: string) =>
  rows<UsageMeter>(db.from("exp_usage_meter").select("*").eq("contract_id", contractId).order("period_start", { ascending: false }));

export const assembleDocument = async (id: string) => rpc<unknown>("m4_assemble_document", { p_contract: id, p_actor: await currentEmail() });
export const generateInvoice = async (id: string, type: string, ps: string | null, pe: string | null) =>
  rpc<string>("m4_generate_invoice", { p_contract: id, p_type: type, p_ps: ps, p_pe: pe, p_actor: await currentEmail() });
export const recordUsage = async (id: string, code: string, metric: string, ps: string, pe: string, measured: number, highWater: number | null) =>
  rpc<string>("m4_record_usage", { p_contract: id, p_code: code, p_metric: metric, p_period_start: ps, p_period_end: pe, p_measured: measured, p_high_water: highWater, p_actor: await currentEmail() });
export const createAddendum = async (parentId: string, kind: string, title: string | null) =>
  rpc<string>("m4_create_addendum", { p_parent: parentId, p_kind: kind, p_title: title, p_actor: await currentEmail() });
export const generateRenewalNotice = async (id: string) => rpc<string>("m4_generate_renewal_notice", { p_contract: id, p_actor: await currentEmail() });
