/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";

// sales S1 CPQ: every read in surface-ui/sales/src/lib/sales-cpq.ts (line refs below are to
// that file at PARITY_LEGACY_REF), copied verbatim from
// PARITY_LEGACY_REF (direct supabase-js, as the signed-in user) against GET /sales/cpq/*.
// Inline copies because the legacy module's relative imports (./cpq-catalog, ./cpq-pricing …)
// don't resolve from .legacy/. Reads only: the quote save, the contract / line-item writes,
// exp_contract_provision, the tier and promo writes are covered by compiled-SQL unit tests
// (surface-api/sales/queries/cpq_test.py), never run.
// Row counts at port time: quotes 1, accounts 31, contracts 12, price tiers 38, promo codes 2,
// redemptions 1.

const C = "/sales/cpq";
const QUOTE_NAME = "Q-18788"; // the one saved quote (has state)
const OPPORTUNITY = "2de8379f-5832-45ac-99f9-042d0733d6f5"; // an opportunity with no quote: null
const CONTRACT = "81afa085-750c-4314-9700-b039fe0df431"; // approved, with an approval note
const NO_CONTRACT = "00000000-0000-4000-8000-000000000000";
const PROMO_COLS =
  "id,code,active,applies_to_products,discount_kind,amount,discount_pct,pricing_type,duration_months,starts_at,expires_at,scope_type,applies_to_scope,seller_id";

const strict = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

/** Rows in the page's order with ties (same sort keys) put in id order: Postgres returns ties
 * in any order (accounts can share a name, price tiers share product_key + min_qty across
 * variants, promo codes may share created_at). */
const byKeys =
  (...keys: [string, boolean][]) =>
  (rows: any) =>
    Array.isArray(rows)
      ? [...rows].sort((a, b) => {
          for (const [k, desc] of keys) {
            const x = a[k];
            const y = b[k];
            if (x === y) continue;
            if (x == null) return 1; // nulls last
            if (y == null) return -1;
            return (x < y ? -1 : 1) * (desc ? -1 : 1);
          }
          return String(a.id ?? a.code).localeCompare(String(b.id ?? b.code));
        })
      : rows;

export const cases: ParityCase[] = [
  {
    name: "listQuotes → GET /sales/cpq/quotes",
    // sales-cpq.ts:35
    legacy: (sb) =>
      strict(
        sb
          .from("exp_quotes")
          .select("id,name,status,summary,updated_at,account_id,opportunity_id")
          .order("updated_at", { ascending: false, nullsFirst: false }),
      ),
    api: { method: "GET", path: `${C}/quotes` },
    normalize: byKeys(["updated_at", true]),
  },
  {
    name: `loadQuote(${QUOTE_NAME}) → GET /sales/cpq/quotes/state`,
    // sales-cpq.ts:68
    legacy: (sb) =>
      strict(
        sb
          .from("exp_quotes")
          .select("state")
          .eq("name", QUOTE_NAME)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ),
    api: { method: "GET", path: `${C}/quotes/state?name=${encodeURIComponent(QUOTE_NAME)}` },
  },
  {
    name: "loadQuote(unknown) → GET /sales/cpq/quotes/state (null)",
    legacy: (sb) =>
      strict(
        sb
          .from("exp_quotes")
          .select("state")
          .eq("name", "Q-00000")
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ),
    api: { method: "GET", path: `${C}/quotes/state?name=Q-00000` },
  },
  {
    name: "prepareOpportunityQuote (existing-quote read) → GET /sales/cpq/quotes/by-opportunity/:id",
    // sales-cpq.ts:124
    legacy: (sb) =>
      strict(
        sb
          .from("exp_quotes")
          .select("name")
          .eq("opportunity_id", OPPORTUNITY)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ),
    api: { method: "GET", path: `${C}/quotes/by-opportunity/${OPPORTUNITY}` },
  },
  {
    name: "listAccounts → GET /sales/cpq/accounts",
    // sales-cpq.ts:188
    legacy: (sb) => strict(sb.from("exp_accounts").select("id,name,org_id,industry,account_type,city,region").order("name")),
    api: { method: "GET", path: `${C}/accounts` },
    normalize: byKeys(["name", false]),
  },
  {
    name: "loadContractApproval → GET /sales/cpq/contracts/:id/approval",
    // sales-cpq.ts:489
    legacy: (sb) => strict(sb.from("exp_contracts").select("approval_state,approval_note").eq("id", CONTRACT).maybeSingle()),
    api: { method: "GET", path: `${C}/contracts/${CONTRACT}/approval` },
  },
  {
    name: "loadContractApproval(unknown) → GET /sales/cpq/contracts/:id/approval (null)",
    legacy: (sb) => strict(sb.from("exp_contracts").select("approval_state,approval_note").eq("id", NO_CONTRACT).maybeSingle()),
    api: { method: "GET", path: `${C}/contracts/${NO_CONTRACT}/approval` },
  },
  {
    name: "listPriceTiers (raw rows) → GET /sales/cpq/price-tiers",
    // sales-cpq.ts:359 (the numeric mapping after it stays in the browser, unchanged)
    legacy: (sb) => strict(sb.from("exp_price_tiers").select("*").order("product_key").order("min_qty")),
    api: { method: "GET", path: `${C}/price-tiers` },
    normalize: byKeys(["product_key", false], ["min_qty", false]),
  },
  {
    name: "listPromos → GET /sales/cpq/promos",
    // sales-cpq.ts:431
    legacy: (sb) => strict(sb.from("exp_promo_codes").select(PROMO_COLS).order("created_at", { ascending: false, nullsFirst: false })),
    api: { method: "GET", path: `${C}/promos` },
  },
  {
    name: "redemptionCounts (raw codes) → GET /sales/cpq/promo-redemptions",
    // sales-cpq.ts:450 (counted in the browser, unchanged)
    legacy: (sb) => strict(sb.from("exp_promo_redemptions").select("code")),
    api: { method: "GET", path: `${C}/promo-redemptions` },
    normalize: byKeys(["code", false]),
  },
  ...["smb20c", "SMB*", "nope"].map(
    (code): ParityCase => ({
      name: `findPromo(${code}) (raw row) → GET /sales/cpq/promos/find`,
      // sales-cpq.ts:459 (the date-window check after it stays in the browser, unchanged)
      legacy: (sb) =>
        strict(sb.from("exp_promo_codes").select(PROMO_COLS).ilike("code", code.trim()).eq("active", true).limit(1).maybeSingle()),
      api: { method: "GET", path: `${C}/promos/find?code=${encodeURIComponent(code)}` },
    }),
  ),
];
