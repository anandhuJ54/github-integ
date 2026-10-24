/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import {
  getContract,
  listContracts,
  loadInvoices,
  loadNotifications,
  loadRenewals,
  loadSkus,
  loadUsage,
} from "@v3/sales/lib/contracts";
import { getAccountCsm, listActiveCsms, listCsmCandidates } from "@v3/sales/lib/csm";

// sales S2 contracts: every read in surface-ui/sales/src/lib/contracts.ts and lib/csm.ts (the
// legacy modules from PARITY_LEGACY_REF, direct supabase-js as the signed-in user) against the
// ported functions, which call GET /sales/contracts/* and /sales/csm/*; plus the inline exp_contracts
// read in routes/_authenticated/sales.quotes.$quoteId.tsx and the public m4_signer_fetch in
// routes/sign.$token.tsx (copied verbatim) against their endpoints.
// Reads only: the m4_* functions, m4_record_signature, the special-terms and notification
// updates and the CSM writes are covered by compiled-SQL unit tests
// (surface-api/sales/queries/{contracts,csm,sign}_test.py), never run here.
// m4_signer_fetch is a pure read (select signature by token, select contract; no update), and
// runs here only with a token that cannot exist.
// Row counts at port time: contracts 12, activity 38, renewals 3, invoices 6, invoice lines 5,
// usage meters 2, order SKUs 13, notifications 10, CSM assignments 0.

const CONTRACTS = "surface-ui/sales/src/lib/contracts.ts";
const CSM = "surface-ui/sales/src/lib/csm.ts";
const RICH = "346343a2-4d92-4ec8-b358-a34fbc9494c2"; // activity, recipients, documents, lines, invoices, usage
const SIGNED = "521e790b-04be-4329-be7a-d2f87bc7e82c"; // an org, a version, a signature, a renewal
const INVOICED = "00ff513b-43e2-4354-afeb-9f74ba7f8945"; // 4 invoices, a renewal
const NO_CONTRACT = "00000000-0000-4000-8000-000000000000";
const QUOTE = "1950e9d3-0793-4fc8-ab80-1e8994760051"; // two contracts from this quote
const ORG = "c18f4cb2-47be-4484-9d23-0f1f74dcf38c";
const BAD_TOKEN = "parity-invalid-token-00000000000000000000";

const strict = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

/** Ties on the sort key come back in any order: put them in id order (stable for the rest). */
const tiesById = (key: string, desc: boolean) => (rows: any[]) =>
  [...(rows ?? [])].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x !== y) {
      if (x == null) return desc ? -1 : 1; // Postgres: nulls first when descending
      if (y == null) return desc ? 1 : -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    }
    return String(a.id).localeCompare(String(b.id));
  });
const byId = (rows: any[]) => [...(rows ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));

export const cases: ParityCase[] = [
  {
    name: "listContracts → GET /sales/contracts",
    legacyModule: CONTRACTS,
    legacyExport: "listContracts",
    current: () => listContracts(),
    // contracts tie on created_at (seeded together): id order; `latest` is the newest activity per
    // contract, so a tie on occurred_at could pick either row on either side
    normalize: tiesById("created_at", true),
  },
  {
    name: `getContract(rich) → GET /sales/contracts/:id`,
    legacyModule: CONTRACTS,
    legacyExport: "getContract",
    legacyArgs: [RICH],
    current: () => getContract(RICH),
    // child rows with no order (line items, documents) or tied sort keys come back in any order
    normalize: (d: any) => ({
      ...d,
      lineItems: byId(d.lineItems),
      documents: byId(d.documents),
      activity: tiesById("occurred_at", true)(d.activity),
      recipients: tiesById("signing_order", false)(d.recipients),
    }),
  },
  {
    name: `getContract(signed, with org + renewal) → GET /sales/contracts/:id`,
    legacyModule: CONTRACTS,
    legacyExport: "getContract",
    legacyArgs: [SIGNED],
    current: () => getContract(SIGNED),
    normalize: (d: any) => ({
      ...d,
      documents: byId(d.documents),
      activity: tiesById("occurred_at", true)(d.activity),
      recipients: tiesById("signing_order", false)(d.recipients),
    }),
  },
  {
    name: "getContract(unknown) → both throw Contract not found",
    legacyModule: CONTRACTS,
    legacyExport: "getContract",
    legacyArgs: [NO_CONTRACT],
    current: () => getContract(NO_CONTRACT),
    expectRefusal: true,
  },
  {
    name: "loadRenewals → GET /sales/contracts/renewals",
    legacyModule: CONTRACTS,
    legacyExport: "loadRenewals",
    current: () => loadRenewals(),
    normalize: tiesById("renewal_date", false),
  },
  {
    name: "loadNotifications(20) → GET /sales/contracts/notifications",
    legacyModule: CONTRACTS,
    legacyExport: "loadNotifications",
    legacyArgs: [20],
    current: () => loadNotifications(20),
    normalize: tiesById("created_at", true),
  },
  {
    name: "loadSkus → GET /sales/contracts/skus",
    legacyModule: CONTRACTS,
    legacyExport: "loadSkus",
    current: () => loadSkus(),
  },
  ...[INVOICED, RICH].map(
    (id): ParityCase => ({
      name: `loadInvoices(${id.slice(0, 8)}) → GET /sales/contracts/:id/invoices`,
      legacyModule: CONTRACTS,
      legacyExport: "loadInvoices",
      legacyArgs: [id],
      current: () => loadInvoices(id),
      normalize: (invs: any[]) => tiesById("issued_at", true)(invs).map((i: any) => ({ ...i, lines: byId(i.lines) })),
    }),
  ),
  {
    name: "loadUsage(rich) → GET /sales/contracts/:id/usage",
    legacyModule: CONTRACTS,
    legacyExport: "loadUsage",
    legacyArgs: [RICH],
    current: () => loadUsage(RICH),
    normalize: tiesById("period_start", true),
  },
  {
    name: "quote page: contract for a quote → GET /sales/contracts/by-quote/:id",
    // sales.quotes.$quoteId.tsx:188 (two contracts share this quote: the newest one)
    legacy: (sb) =>
      strict(
        (sb as any).from("exp_contracts").select("id").eq("quote_id", QUOTE).order("created_at", { ascending: false }).limit(1),
      ),
    api: { method: "GET", path: `/sales/contracts/by-quote/${QUOTE}` },
  },
  {
    name: "quote page: a quote name (not a uuid) → both refuse",
    // the page passes its route param (a quote name like Q-18788); quote_id is a uuid column
    legacy: (sb) =>
      strict(
        (sb as any).from("exp_contracts").select("id").eq("quote_id", "Q-18788").order("created_at", { ascending: false }).limit(1),
      ),
    api: { method: "GET", path: "/sales/contracts/by-quote/Q-18788" },
    expectRefusal: true,
  },
  {
    name: "listActiveCsms → GET /sales/csm/assignments",
    legacyModule: CSM,
    legacyExport: "listActiveCsms",
    current: () => listActiveCsms(),
  },
  {
    name: "getAccountCsm(org) → GET /sales/csm/assignments/:orgId",
    legacyModule: CSM,
    legacyExport: "getAccountCsm",
    legacyArgs: [ORG],
    current: () => getAccountCsm(ORG),
  },
  {
    name: "listCsmCandidates → GET /sales/csm/candidates (super_admin only)",
    legacyModule: CSM,
    legacyExport: "listCsmCandidates",
    current: () => listCsmCandidates(),
    // a non-super_admin parity user: list_control_users raises 'forbidden' on both sides
    expectRefusal: true,
  },
  {
    name: "sign page: m4_signer_fetch(invalid token) → POST /sales/sign/fetch",
    // sign.$token.tsx:39 — a pure read; this token matches no signature row
    legacy: (sb) => strict((sb as any).rpc("m4_signer_fetch", { p_token: BAD_TOKEN })),
    api: { method: "POST", path: "/sales/sign/fetch", body: { token: BAD_TOKEN } },
  },
];
