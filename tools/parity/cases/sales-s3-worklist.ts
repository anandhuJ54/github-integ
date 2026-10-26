/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as sre from "@v3/sales/utils/sre-console";
import * as alerts from "@v3/sales/utils/sales-alerts";

// sales S3: every read in surface-ui/sales/src/lib/sre-console.ts and
// surface-ui/_base/src/lib/sales-alerts.ts. The legacy lib (direct supabase-js, from
// PARITY_LEGACY_REF) against the current one (same lib, rows from FastAPI /sales/sre/* and
// /sales/alerts/*), plus the raw rows of the reads the lib reshapes, against their endpoint.
// Inline legacy reads are verbatim copies from those files at PARITY_LEGACY_REF (line refs to
// that file there).
// worklist-actions.ts has no reads: its three RPCs (exp_claim_set_contact,
// exp_claim_queue_verification, exp_opp_create) are writes. They, the three inserts in
// sre-console.ts, dismissAlert (update + audit_log insert) and the three alert RPCs
// (exp_alert_accept and the two tick functions exp_alerts_generate / exp_task_reminders_tick,
// SF-10) are covered by compiled-SQL / fake-connection unit tests (sales/queries/worklist_test.py,
// sre_test.py, alerts_test.py), never run.
//
// Ties at a LIMIT: rows at port time — open alerts 406 with only 6 distinct created_at (the
// limit(100) newest are an arbitrary pick among the tied rows); the SRE rep's "attempted" queue
// 494 rows / 484 distinct occurred_at (limit 250). Those cases compare the count and, exactly,
// the rows strictly before the last sort-key value (the boundary tie may be any of its rows).
// Other rows at port time: engaged 30, lapsed_no_upgrade 362 (all distinct), 1 active promo code.

const SRE = "surface-ui/sales/src/lib/sre-console.ts";
const ALERTS = "surface-ui/_base/src/lib/sales-alerts.ts";
const S = "/sales/sre";
const REP = "c1000000-0000-4000-8000-000000000001";

const strict = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...(rows ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
/** Rows compared as a set: for reads with no ORDER BY or a sort key with ties. */
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);
/**
 * A LIMITed read sorted by `col` whose last value may tie past the limit: the count, and the
 * rows strictly before that last value (as a set). `col` is the sort key of the read.
 */
const beforeBoundary = (col: string) => (rows: any) => {
  if (!Array.isArray(rows)) return rows;
  const last = rows.length ? rows[rows.length - 1][col] : null;
  return { n: rows.length, rows: sortRows(rows.filter((r) => r[col] !== last)) };
};
const queues = (r: any) =>
  r && typeof r === "object" && !Array.isArray(r)
    ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, beforeBoundary("occurred_at")(v)]))
    : r;
const newestAlerts = beforeBoundary("created_at");

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

/* ─── sre-console.ts ─── */
const sreCases: ParityCase[] = [
  lib(SRE, "sre: loadSreRep", "loadSreRep", [], () => sre.loadSreRep()),
  lib(SRE, "sre: loadPromoCode", "loadPromoCode", [], () => sre.loadPromoCode()),
  {
    // loadPromoCode's read (sre-console.ts:61), verbatim: the raw row the page maps
    name: "sre: promo code row → GET /sales/sre/promo-code",
    legacy: async (sb: any) =>
      strict(
        sb
          .from("exp_promo_codes")
          .select("code, discount_pct, active, seller_id")
          .eq("seller_id", REP)
          .eq("active", true)
          .limit(1)
          .maybeSingle(),
      ),
    api: { method: "GET", path: `${S}/promo-code?seller_id=${REP}` },
  },
  // occurred_at asc, limit 250: "attempted" ties at the boundary (see above)
  lib(SRE, "sre: loadQueues", "loadQueues", [], () => sre.loadQueues(), { normalize: queues }),
  {
    // a rep id with no rows: null on both sides
    name: "sre: loadSreRep(no such rep) → GET /sales/sre/reps/{id}",
    legacy: async (sb: any) =>
      strict(sb.from("exp_sales_reps").select("id, name, role").eq("id", "00000000-0000-4000-8000-000000000000").maybeSingle()),
    api: { method: "GET", path: `${S}/reps/00000000-0000-4000-8000-000000000000` },
  },
];

/* ─── sales-alerts.ts ─── */

/** Shared input: an owner and a few opportunities that have open alerts (fetched the legacy way). */
const openAlertKeys = async (sb: any) => {
  const rows = (await strict(
    sb
      .from("exp_sales_alerts")
      .select("owner_id,opportunity_id")
      .is("dismissed_at", null)
      .is("accepted_task_id", null)
      .not("opportunity_id", "is", null)
      .order("opportunity_id")
      .limit(1000),
  )) as any[];
  const opps = [...new Set(rows.map((r) => r.opportunity_id))];
  const owners = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))].sort();
  return { opp: opps[0] ?? null, opps: opps.slice(0, 5), owner: owners[0] ?? null };
};

const alertCase = (name: string, filter: (k: any) => any, normalize: (r: any) => any): ParityCase => ({
  name,
  prepare: async (sb: any) => [filter(await openAlertKeys(sb))],
  legacy: legacyCall(ALERTS, "loadAlerts"),
  current: (ctx: any) => alerts.loadAlerts(ctx[0]),
  normalize,
});

const alertCases: ParityCase[] = [
  // created_at desc, limit 100, 406 open alerts over 6 created_at values (see above)
  lib(ALERTS, "alerts: loadAlerts({})", "loadAlerts", [{}], () => alerts.loadAlerts({}), { normalize: newestAlerts }),
  alertCase("alerts: loadAlerts({ opportunityId })", (k) => ({ opportunityId: k.opp }), unordered),
  alertCase("alerts: loadAlerts({ ownerId })", (k) => ({ ownerId: k.owner }), newestAlerts),
  alertCase("alerts: loadAlerts({ opportunityIds: 5 })", (k) => ({ opportunityIds: k.opps }), unordered),
  alertCase("alerts: loadAlerts({ opportunityIds: [] })", () => ({ opportunityIds: [] }), unordered),
  alertCase("alerts: loadAlerts({ opportunityId, ownerId: null, opportunityIds })", (k) => ({ opportunityId: k.opp, ownerId: null, opportunityIds: k.opps }), unordered),
];

export const cases: ParityCase[] = [...sreCases, ...alertCases];
