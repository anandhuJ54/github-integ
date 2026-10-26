/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as sales from "@v3/sales/lib/sales";
// moved (surface audit 2026-10-25): accounts.ts and its API are admin's now
import * as accounts from "@v3/admin/lib/accounts";

// sales S2 core: every read in surface-ui/sales/src/lib/sales.ts and accounts.ts. The legacy lib
// (direct supabase-js, from PARITY_LEGACY_REF) against the current one (same lib, rows from
// FastAPI /sales/core/* and /admin/accounts/*), plus the raw rows of the reads the lib reshapes
// (price book, revenue) and of the capped hierarchy reads against their endpoint. Inline legacy
// reads are verbatim copies from sales.ts / accounts.ts at PARITY_LEGACY_REF (line refs to that
// file there).
// Reads only: every write (price book, credit config, contracts, line items, signatures,
// renewals, account tiers, entitlements, the login-as audit row) and exp_contract_provision are
// covered by compiled-SQL / fake-connection unit tests (sales/queries/core_test.py,
// admin/queries/accounts_test.py), never run.
// moved (surface audit 2026-10-25): the Accounts pages, accounts.ts and /sales/accounts/* are
// admin's now (surface-ui/admin/src/lib/accounts.ts, /admin/accounts/*); URLs unchanged.
//
// The 1000-row cap (follow-up 1j): organizations (38k rows) and professionals (116k) are read
// with limit(5000) / limit(20000) and NO ORDER BY, so PostgREST returned an arbitrary 1000 of
// them and the API returns an arbitrary 1000 too. Those cases compare counts and row shape (and
// the deterministic parts exactly), not the rows themselves.
// Rows at port time: reps 21, assignments 12, activity 138, account tiers 3, price book 42,
// contracts 12, line items 13, signatures 2, renewals 3, entitlements 12; 0 root organizations
// among the 1000 organizations the cap returns, so loadAccounts is [] on both sides today.

const SALES = "surface-ui/sales/src/lib/sales.ts";
// the legacy file at PARITY_LEGACY_REF (still under sales there)
const ACCOUNTS = "surface-ui/sales/src/lib/accounts.ts";
const C = "/sales/core";
// moved (surface audit 2026-10-25): /sales/accounts → /admin/accounts
const A = "/admin/accounts";

const strict = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...(rows ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
/** Rows compared as a set: for reads with no ORDER BY or a sort key with ties. */
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);
/** An arbitrary (capped, unordered) row set: its size and its columns. */
const shape = (rows: any) =>
  Array.isArray(rows) ? { n: rows.length, keys: rows[0] ? Object.keys(rows[0]).sort() : [] } : rows;

const lib = (
  module: string,
  name: string,
  exp: string,
  args: unknown[],
  current: () => Promise<unknown>,
  extra: Partial<ParityCase> = {},
): ParityCase => ({ name, legacyModule: module, legacyExport: exp, legacyArgs: args, current, ...extra });

/** A legacy lib export called with arguments from `prepare`. */
const legacyCall = (module: string, exp: string) => async (_sb: any, ctx: any) =>
  ((await (globalThis as any).__legacyModule(module)) as any)[exp](...ctx);

const today = new Date().toISOString().slice(0, 10);
const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

/* ─── sales.ts ─── */
const salesCases: ParityCase[] = [
  // order("group_key").order("role"): reps share a (group_key, role)
  lib(SALES, "sales: loadReps", "loadReps", [], () => sales.loadReps(), { normalize: unordered }),
  // no ORDER BY
  lib(SALES, "sales: loadAssignments", "loadAssignments", [], () => sales.loadAssignments(), { normalize: unordered }),
  // occurred_at desc has ties (seeded events); `since` is computed per call, ms apart
  lib(SALES, "sales: loadActivity(30)", "loadActivity", [30], () => sales.loadActivity(30), { normalize: unordered }),
  // agent_count desc may tie
  lib(SALES, "sales: loadAccountTiers", "loadAccountTiers", [], () => sales.loadAccountTiers(), { normalize: unordered }),
  {
    name: "sales: loadAccountNames(the contracts' accounts)",
    prepare: async (sb: any) => {
      const rows = (await strict(sb.from("exp_contracts").select("account_id,org_id"))) as any[];
      return [[...new Set(rows.map((c) => c.account_id ?? c.org_id).filter(Boolean))]];
    },
    legacy: legacyCall(SALES, "loadAccountNames"),
    current: (ctx: any) => sales.loadAccountNames(ctx[0]),
  },
  {
    // recomputeAccountTiers' two reads (sales.ts:370), verbatim; capped and unordered: shape only
    name: "sales: recomputeAccountTiers inputs → GET /sales/core/account-tiers/inputs (count + shape)",
    legacy: async (sb: any) => {
      const [orgsRes, prosRes] = await Promise.all([
        sb.from("organizations").select("id,name,parent_org_id").limit(20000),
        sb.from("professionals").select("id,primary_org_id").limit(20000),
      ]);
      if (orgsRes.error) throw orgsRes.error;
      if (prosRes.error) throw prosRes.error;
      return { orgs: orgsRes.data ?? [], pros: prosRes.data ?? [] };
    },
    api: { method: "GET", path: `${C}/account-tiers/inputs` },
    normalize: (r: any) => (r && typeof r === "object" ? { orgs: shape(r.orgs), pros: shape(r.pros) } : r),
  },
  // the joined, sorted price book (ties: a product's rows can share a scope)
  lib(SALES, "sales: loadPriceBook", "loadPriceBook", [], () => sales.loadPriceBook(), { normalize: unordered }),
  {
    // loadPriceBook's two reads (sales.ts:428), verbatim: every price as the page received it
    name: "sales: price book rows → GET /sales/core/price-book",
    legacy: async (sb: any) => {
      const [pbRes, prodRes] = await Promise.all([
        sb
          .from("exp_price_book")
          .select(
            "id,product_key,scope,unit,list_price,contract_price,billing_type,notes,cost_type,cost_value,floor_margin_pct,discount_tiers,credit_cost_per_unit",
          ),
        sb.from("exp_products").select("product_key,name,sort").order("sort"),
      ]);
      if (pbRes.error) throw pbRes.error;
      if (prodRes.error) throw prodRes.error;
      return { book: pbRes.data ?? [], products: prodRes.data ?? [] };
    },
    api: { method: "GET", path: `${C}/price-book` },
    // book has no ORDER BY; products.sort has one tie
    normalize: (r: any) => (r && typeof r === "object" ? { book: unordered(r.book), products: unordered(r.products) } : r),
  },
  lib(SALES, "sales: loadContracts", "loadContracts", [], () => sales.loadContracts(), {
    // contracts by name (names may repeat); line items, signatures, renewals have no ORDER BY
    normalize: (r: any) =>
      r && typeof r === "object"
        ? {
            contracts: unordered(r.contracts),
            lineItems: unordered(r.lineItems),
            signatures: unordered(r.signatures),
            renewals: unordered(r.renewals),
          }
        : r,
  }),
  lib(SALES, "sales: loadRevenue", "loadRevenue", [], () => sales.loadRevenue()),
  {
    // loadRevenue's three reads (sales.ts:657), verbatim, with the same dates on both sides
    name: "sales: revenue rows → GET /sales/core/revenue",
    legacy: async (sb: any) => {
      const [active, expiring, sigs] = await Promise.all([
        sb.from("exp_contracts").select("mrr").eq("status", "active"),
        sb
          .from("exp_contracts")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .gte("end_date", today)
          .lte("end_date", in90),
        sb.from("exp_contract_signatures").select("id", { count: "exact", head: true }).eq("status", "sent"),
      ]);
      if (active.error) throw active.error;
      return { active: active.data ?? [], expiring: expiring.count ?? null, pendingSignatures: sigs.count ?? null };
    },
    api: { method: "GET", path: `${C}/revenue?today=${today}&in90=${in90}` },
    normalize: (r: any) => (r && typeof r === "object" ? { ...r, active: unordered(r.active) } : r),
  },
];

/* ─── accounts.ts ─── */
const ORG_COLS =
  "id,name,slug,entity_type,parent_org_id,hierarchy_depth,is_active,claimed,search_rank_score,address_city,address_state";
const PRO_COLS = "id,display_name,first_name,last_name,slug,primary_org_id,claimed,search_rank_score,job_title";

/** orgs / pros: capped and unordered (shape only); contracts: exact, as a set (no ORDER BY). */
const rowsShape = (r: any) =>
  r && typeof r === "object" ? { orgs: shape(r.orgs), pros: shape(r.pros), contracts: unordered(r.contracts) } : r;

const rowsCase = (name: string, path: string, contractCols: string): ParityCase => ({
  // accounts.ts:50 (loadAccounts) / :128 (loadAccount), verbatim
  name,
  legacy: async (sb: any) => {
    const [orgsRes, prosRes, contractsRes] = await Promise.all([
      sb.from("organizations").select(ORG_COLS).limit(5000),
      sb.from("professionals").select(PRO_COLS).limit(5000),
      sb.from("exp_contracts").select(contractCols),
    ]);
    if (orgsRes.error) throw orgsRes.error;
    if (prosRes.error) throw prosRes.error;
    return { orgs: orgsRes.data ?? [], pros: prosRes.data ?? [], contracts: contractsRes.data ?? [] };
  },
  api: { method: "GET", path },
  normalize: rowsShape,
});

const DISCOVERED_NAMES = ["Keller", "Coldwell*Banker", "zz-no-such-entity"];

const accountCases: ParityCase[] = [
  rowsCase("accounts: loadAccounts rows → GET /admin/accounts/list-rows (orgs/pros count + shape)", `${A}/list-rows`, "account_id,org_id,status,mrr"),
  rowsCase(
    "accounts: loadAccount rows → GET /admin/accounts/tree-rows (orgs/pros count + shape)",
    `${A}/tree-rows`,
    "id,name,account_id,org_id,status,mrr,token_package,start_date",
  ),
  // the summaries are built from the capped, arbitrary organizations: count + shape
  lib(ACCOUNTS, "accounts: loadAccounts (count + shape)", "loadAccounts", [], () => accounts.loadAccounts(), {
    normalize: shape,
  }),
  {
    // accounts.ts:81 / :158, verbatim: one exact count per name
    name: "accounts: discovered counts → POST /admin/accounts/discovered-counts",
    legacy: async (sb: any) =>
      Promise.all(
        DISCOVERED_NAMES.map(async (name) => {
          const { count } = await sb
            .from("exp_entity")
            .select("*", { count: "exact", head: true })
            .ilike("display_name", `%${name}%`);
          return count ?? null;
        }),
      ),
    api: { method: "POST", path: `${A}/discovered-counts`, body: { names: DISCOVERED_NAMES } },
  },
  {
    // an organization from the first page; the account itself, its contracts and its discovered
    // count are exact; the tree and the counts built from the capped rows are compared by type
    name: "accounts: loadAccount(an organization) (account, contracts, discovered exact; tree by shape)",
    prepare: async (sb: any) => {
      const rows = (await strict(sb.from("organizations").select("id").limit(1))) as any[];
      return [rows[0]?.id];
    },
    legacy: legacyCall(ACCOUNTS, "loadAccount"),
    current: (ctx: any) => accounts.loadAccount(ctx[0]),
    normalize: (r: any) =>
      r && typeof r === "object"
        ? {
            account: r.account,
            contracts: unordered(r.contracts),
            discoveredCount: r.discoveredCount,
            tree: typeof r.tree,
            orgCount: typeof r.orgCount,
            userCount: typeof r.userCount,
          }
        : r,
  },
  lib(
    ACCOUNTS,
    "accounts: loadAccount(unknown) → null",
    "loadAccount",
    ["00000000-0000-4000-8000-000000000000"],
    () => accounts.loadAccount("00000000-0000-4000-8000-000000000000"),
  ),
  {
    name: "accounts: loadEntitlements(an organization with entitlements)",
    prepare: async (sb: any) => {
      const rows = (await strict(
        sb.from("exp_entitlements").select("subject_id").eq("subject_type", "organization").limit(1),
      )) as any[];
      return [rows[0]?.subject_id ?? "00000000-0000-4000-8000-000000000000"];
    },
    legacy: legacyCall(ACCOUNTS, "loadEntitlements"),
    current: (ctx: any) => accounts.loadEntitlements(ctx[0]),
    // products by sort (one tie)
    normalize: unordered,
  },
];

export const cases: ParityCase[] = [...salesCases, ...accountCases];
