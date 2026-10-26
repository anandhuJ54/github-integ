/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import {
  loadOpportunityAuditTrail,
  loadOpportunityFile,
  loadOpportunityList,
  loadStageRequirements,
  loadStages,
} from "@v3/sales/utils/opportunity-file";

// sales S3 opportunities: every read in surface-ui/sales/src/lib/opportunity-file.ts (the legacy
// module from PARITY_LEGACY_REF, direct supabase-js as the signed-in user) against the ported
// functions, which call GET /sales/opportunities/*; plus the AuditPanel reads in
// components/sales/opportunity-automation.tsx (copied verbatim) and the raw rows of the reads the
// lib reshapes (the list's rows, the claim events behind the logo intelligence).
// Reads only: every write (contacts and their links, notes, tasks, activity events, audit_log
// rows, demos, file rows) and the exp_opp_* functions are covered by compiled-SQL unit tests
// (surface-api/sales/queries/opportunity_test.py), never run here.
//
// The 1000-row cap: the claim-events read is `.limit(10000)`, cut to 1000 by PostgREST; BRANDED's
// logo has 1,850 claim events, so both sides see its newest 1000 (occurred_at is unique at the
// cut, so the set is deterministic). The location count (19,882 child organizations) is an exact
// count, not rows.
// Rows at port time: opportunities 91, stages 9, stage requirements 44, accounts 31, reps 21,
// price book 42, products 25, territory seats 2, owner changes 0, promo redemptions 1.

const FILE = "surface-ui/sales/src/lib/opportunity-file.ts";
const O = "/sales/opportunities";
const BRANDED = "800fb845-05e9-4611-916a-b9e868ae34dc"; // brand, 1,850 claim events, territory team, products
const CONTACTS = "42c8fecb-0db1-475b-857d-c3021d867dc0"; // owner by name, account, 2 contacts, note, task, contracts
const NO_ORG = "cd72e28b-2b08-4237-88bc-80d6996c02a3"; // no org / account; a contact, stage history
const NO_OPP = "00000000-0000-4000-8000-000000000000";

const strict = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...(rows ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
/** Rows compared as a set: for reads with no ORDER BY or a sort key with ties. */
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);

const lib = (name: string, exp: string, args: unknown[], current: () => Promise<unknown>, extra: Partial<ParityCase> = {}): ParityCase => ({
  name,
  legacyModule: FILE,
  legacyExport: exp,
  legacyArgs: args,
  current,
  ...extra,
});

/** The file's lists with no ORDER BY (links, products, contracts' rollup inputs, team, seats) as
 *  sets; the ordered ones (notes, tasks, files, events, history, meetings, claim events) as read. */
const fileNorm = (f: any) =>
  f && typeof f === "object"
    ? {
        ...f,
        contacts: unordered(f.contacts),
        products: unordered(f.products),
        team: unordered(f.team),
        stages: unordered(f.stages), // stages can tie on sort
      }
    : f;

export const cases: ParityCase[] = [
  lib("opportunity: loadStages", "loadStages", [], () => loadStages(), { normalize: unordered }),
  // value desc ties (many equal / null values): as a set
  lib("opportunity: loadOpportunityList", "loadOpportunityList", [], () => loadOpportunityList(), {
    normalize: (r: any) => (r && typeof r === "object" ? { rows: unordered(r.rows), stages: unordered(r.stages) } : r),
  }),
  {
    // loadOpportunityList's three row reads (opportunity-file.ts:212), verbatim
    name: "opportunity: list rows → GET /sales/opportunities/list-rows",
    legacy: async (sb: any) => {
      const [oppRes, acctRes, repRes] = await Promise.all([
        sb
          .from("exp_sales_pipeline")
          .select(
            "id,name,owner,stage,value,probability,account_id,org_id,expected_close,product_summary,source_owner,source_channel,lost_reason,win_back,notes,is_demo,created_at,updated_at,created_by",
          )
          .order("value", { ascending: false })
          .limit(500),
        sb.from("exp_accounts").select("id,name"),
        sb.from("exp_sales_reps").select("id,name"),
      ]);
      if (oppRes.error) throw oppRes.error;
      return { opps: oppRes.data ?? [], accounts: acctRes.data ?? [], reps: repRes.data ?? [] };
    },
    api: { method: "GET", path: `${O}/list-rows` },
    normalize: (r: any) =>
      r && typeof r === "object" ? { opps: unordered(r.opps), accounts: unordered(r.accounts), reps: unordered(r.reps) } : r,
  },
  lib("opportunity: loadOpportunityFile(branded: brand, claims, team)", "loadOpportunityFile", [BRANDED], () => loadOpportunityFile(BRANDED), {
    normalize: fileNorm,
  }),
  lib("opportunity: loadOpportunityFile(owner by name, contacts, contracts)", "loadOpportunityFile", [CONTACTS], () => loadOpportunityFile(CONTACTS), {
    normalize: fileNorm,
  }),
  lib("opportunity: loadOpportunityFile(no org)", "loadOpportunityFile", [NO_ORG], () => loadOpportunityFile(NO_ORG), {
    normalize: fileNorm,
  }),
  lib("opportunity: loadOpportunityFile(unknown) → null", "loadOpportunityFile", [NO_OPP], () => loadOpportunityFile(NO_OPP)),
  {
    // the claim-events read (opportunity-file.ts:302), verbatim, against the file's raw `claims`:
    // the logo-intelligence input, capped at 1000 of 1,850 on both sides
    name: "opportunity: claim events (capped) → GET /sales/opportunities/:id/file .claims",
    prepare: async (sb: any) => {
      const opp = (await strict(sb.from("exp_sales_pipeline").select("org_id").eq("id", BRANDED).maybeSingle())) as any;
      return { orgId: opp?.org_id };
    },
    legacy: async (sb: any, ctx: any) =>
      strict(
        sb
          .from("exp_claim_events")
          .select("id,entity_id,entity_label,entity_type,event_type,occurred_at,nora_engagement,upgraded")
          .eq("logo_org_id", ctx.orgId)
          .order("occurred_at", { ascending: false })
          .limit(10000),
      ),
    api: { method: "GET", path: `${O}/${BRANDED}/file` },
    // legacy: the rows; API: the file → its claims
    normalize: (r: any) => (Array.isArray(r) ? r : r?.claims),
  },
  ...["discovery", "proposal", "no-such-stage"].map((stage) =>
    lib(`opportunity: loadStageRequirements(${stage})`, "loadStageRequirements", [stage], () => loadStageRequirements(stage), {
      normalize: unordered, // sort can tie
    }),
  ),
  ...[
    { label: "with a quote that has a promo redemption", promo: true },
    { label: "without a quote", promo: false },
  ].map(
    ({ label, promo }): ParityCase => ({
      // AuditPanel's queryFn (opportunity-automation.tsx:57), verbatim
      name: `opportunity: AuditPanel reads (${label}) → GET /sales/opportunities/:id/audit-trail`,
      prepare: async (sb: any) => {
        const owners = (await strict(sb.from("exp_opportunity_owner_history").select("opportunity_id").limit(1))) as any[];
        const promos = (await strict(sb.from("exp_promo_redemptions").select("subject_id").limit(1))) as any[];
        return { opp: { id: owners[0]?.opportunity_id ?? BRANDED }, quoteId: promo ? promos[0]?.subject_id ?? null : null };
      },
      legacy: async (supabase: any, data: any) => {
        const db = supabase as unknown as { from: (t: string) => any };
        const [owners, promos] = await Promise.all([
          db.from("exp_opportunity_owner_history").select("id,from_owner,to_owner,changed_by,changed_at").eq("opportunity_id", data.opp.id).order("changed_at", { ascending: false }),
          data.quoteId ? db.from("exp_promo_redemptions").select("id,code,redeemed_at").eq("subject_id", data.quoteId) : Promise.resolve({ data: [] }),
        ]);
        return { owners: (owners.data ?? []) as { id: string; from_owner: string | null; to_owner: string | null; changed_by: string | null; changed_at: string }[], promos: (promos.data ?? []) as { id: string; code: string; redeemed_at: string | null }[] };
      },
      current: (data: any) => loadOpportunityAuditTrail(data.opp.id, data.quoteId),
      // promos have no ORDER BY; owner changes can tie on changed_at
      normalize: (r: any) => (r && typeof r === "object" ? { owners: unordered(r.owners), promos: unordered(r.promos) } : r),
    }),
  ),
];
