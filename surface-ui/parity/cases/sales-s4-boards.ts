/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as desk from "@v3/sales/lib/seller-desk";
import * as sellerBoard from "@v3/sales/lib/seller-board";
import * as board from "@v3/sales/lib/sales-board";
import * as story from "@v3/sales/lib/sales-story";
import * as nav from "@v3/sales/lib/sales-nav";
import * as spine from "@v3/sales/lib/sales-spine";

// sales S4 (boards): every read in surface-ui/sales/src/lib/seller-desk.ts, seller-board.ts,
// sales-board.ts, sales-story.ts, sales-nav.ts and sales-spine.ts. The legacy lib (direct
// supabase-js as the signed-in user, from PARITY_LEGACY_REF) against the current one (same lib,
// rows from FastAPI /sales/boards/*, /sales/nav/*, /sales/spine/*), plus the capped and chunked
// reads raw, verbatim (line refs to the file at PARITY_LEGACY_REF), against their endpoint.
// The writes (addNote, setCallbackPriority, requestReferral: exp_sales_notes) are covered by
// compiled-SQL unit tests (surface-api/sales/queries/boards_test.py), never run.
//
// The 1000-row cap (follow-up 1j), kept 1:1. exp_claim_events has 3,474 rows (1,964 distinct
// occurred_at): sales-board.ts:170 (newest 1000) and sales-spine.ts:82 (oldest) / :242 (newest)
// are cut at a unique occurred_at, so the sets are deterministic; ties inside the set are in any
// order, so they are compared as sets. Reads with no ORDER BY that the cap can cut
// (sales-nav.ts:90 activity events, 138 rows; :392 the brand's claim events, 950 rows; the
// graph_nodes chunks at sales-spine.ts:350) are compared by count and row shape.
// Ties and unordered reads (rows at port time): exp_sales_reps by name (21 rows / 20 names),
// exp_sales_quotas by period_start, exp_sales_notes by created_at, exp_sales_rep_metrics by
// period_start (one rep has two rows for one period), and every read with no ORDER BY: compared
// as sets, and lists the libs sort by a count (logos, categories, teams) by their key.
// countNewProfiles: the window starts at the browser's clock in the legacy, the server's in the
// API (the same unless a profile is created between the two reads).

const DESK = "surface-ui/sales/src/lib/seller-desk.ts";
const SBOARD = "surface-ui/sales/src/lib/seller-board.ts";
const BOARD = "surface-ui/sales/src/lib/sales-board.ts";
const STORY = "surface-ui/sales/src/lib/sales-story.ts";
const NAV = "surface-ui/sales/src/lib/sales-nav.ts";
const SPINE = "surface-ui/sales/src/lib/sales-spine.ts";

const SRE = "c1000000-0000-4000-8000-000000000001"; // 926 claim events, no territory
const TERR_REP = "0fa83805-40db-4bab-ba80-32664eea2449"; // sells a territory (real_estate)
const SEAT_REP = "c1000000-0000-4000-8000-000000000003"; // a seat and a territory, account assignment
const BRAND = "bbbbbbb1-0000-4000-8000-000000000001"; // 19,882 offices, 1,850 claim events
const PRO = "56d35654-1bcd-4ee6-97e3-3571ef61c8f1"; // has a territory and a score row
const NO_ID = "00000000-0000-4000-8000-000000000000";

const strict = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...(rows ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
/** Rows compared as a set: for reads with no ORDER BY or a sort key with ties. */
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);
/** An unordered read cut by the 1000-row cap: the count and the row shape. */
const countAndShape = (r: any) =>
  Array.isArray(r) ? { n: r.length, keys: r.length ? Object.keys(r[0]).sort() : [] } : r;
const by = (k: string) => (r: any) => (Array.isArray(r) ? [...r].sort((a, b) => String(a?.[k]).localeCompare(String(b?.[k]))) : r);
/** Every array in an object compared as a set. */
const allSets = (r: any) =>
  r && typeof r === "object" && !Array.isArray(r) ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, unordered(v)])) : r;

const lib = (
  module: string,
  name: string,
  exp: string,
  args: unknown[],
  current: () => Promise<unknown>,
  extra: Partial<ParityCase> = {},
): ParityCase => ({ name, legacyModule: module, legacyExport: exp, legacyArgs: args, current, ...extra });

/** A legacy lib export called with arguments from `prepare`. */
const legacyCall = (module: string, exp: string, deps: string[] = []) => async (_sb: any, ctx: any) =>
  ((await (globalThis as any).__legacyModule(module, deps)) as any)[exp](...ctx.args);

/* ─── seller-desk.ts ─── */
const deskNorm = (d: any) =>
  d && typeof d === "object"
    ? { ...d, territories: unordered(d.territories), events: unordered(d.events), demos: unordered(d.demos), revenue: unordered(d.revenue) }
    : d;

const deskCases: ParityCase[] = [
  ...[
    ["a territory seller", TERR_REP],
    ["SRE: 926 claim events, no territory", SRE],
    ["a seat holder", SEAT_REP],
  ].map(([label, id]) => lib(DESK, `desk: loadSellerDesk(${label})`, "loadSellerDesk", [id], () => desk.loadSellerDesk(id), { normalize: deskNorm })),
  lib(DESK, "desk: loadSellerDesk(unknown) → null", "loadSellerDesk", [NO_ID], () => desk.loadSellerDesk(NO_ID)),
  lib(DESK, "desk: loadSellerDesk(not a uuid) → null", "loadSellerDesk", ["not-a-uuid"], () => desk.loadSellerDesk("not-a-uuid")),
  ...([7, 365] as const).map(
    (days): ParityCase => ({
      name: `desk: countNewProfiles(every territory, ${days}d)`,
      prepare: async (sb: any) => {
        const terrs = (await strict(sb.from("exp_territories").select("id").order("id"))) as any[];
        return { args: [terrs.map((t) => t.id), days] };
      },
      legacy: legacyCall(DESK, "countNewProfiles"),
      current: (ctx: any) => desk.countNewProfiles(ctx.args[0], days),
    }),
  ),
  lib(DESK, "desk: countNewProfiles(no territory) → 0", "countNewProfiles", [[], 30], () => desk.countNewProfiles([], 30)),
];

/* ─── seller-board.ts / sales-story.ts ─── */
const sellerBoardNorm = (r: any) =>
  r && typeof r === "object"
    ? { ...r, cards: by("repId")(r.cards), groups: unordered(r.groups), roles: unordered(r.roles) }
    : r;

const boardCases: ParityCase[] = [
  lib(SBOARD, "seller board: loadSellerBoard", "loadSellerBoard", [], () => sellerBoard.loadSellerBoard(), { normalize: sellerBoardNorm }),
  {
    // loadSellerBoard's reads (seller-board.ts:108), verbatim
    name: "seller board: rows → GET /sales/boards/seller-board",
    legacy: async (supabase: any) => {
      const [repsRes, quotaRes, pipeRes] = await Promise.all([
        supabase.from("exp_sales_reps").select("id,name,role,group_key,is_demo").order("name"),
        supabase
          .from("exp_sales_quotas")
          .select("rep_id,period_type,period_start,target,actual,is_demo")
          .eq("period_type", "month")
          .order("period_start", { ascending: false }),
        supabase.from("exp_sales_pipeline").select("owner,stage,value,is_demo"),
      ]);
      return { reps: repsRes.data ?? [], quotas: quotaRes.data ?? [], pipeline: pipeRes.data ?? [] };
    },
    api: { method: "GET", path: "/sales/boards/seller-board" },
    normalize: allSets,
  },
  lib(STORY, "story: loadRoster", "loadRoster", [], () => story.loadRoster(), {
    normalize: (r: any) => (r && typeof r === "object" ? { ...r, rows: by("repId")(r.rows), groups: by("key")(r.groups), roles: unordered(r.roles) } : r),
  }),
  lib(STORY, "story: loadCategoryStory", "loadCategoryStory", [], () => story.loadCategoryStory(), {
    normalize: (r: any) => (r && typeof r === "object" ? { ...r, rows: by("groupKey")(r.rows) } : r),
  }),
  lib(BOARD, "board: loadBoardData", "loadBoardData", [], () => board.loadBoardData(), {
    normalize: (r: any) => (r && typeof r === "object" ? allSets(r) : r),
  }),
  {
    // the claim events (sales-board.ts:170), verbatim: .limit(20000) cut to the newest 1000
    name: "board: claim events (capped) → GET /sales/boards/board .events",
    legacy: async (supabase: any) =>
      strict(
        supabase
          .from("exp_claim_events")
          .select(
            "id,entity_label,entity_type,group_key,seller_id,territory_id,logo_org_id,event_type,nora_engagement,upgraded,contact_phone,contact_email,state,is_demo,occurred_at",
          )
          .order("occurred_at", { ascending: false })
          .limit(20000),
      ),
    api: { method: "GET", path: "/sales/boards/board" },
    normalize: (r: any) => unordered(Array.isArray(r) ? r : r?.events),
  },
];

/* ─── sales-nav.ts ─── */
const overviewNorm = (r: any) => (r && typeof r === "object" ? { ...r, teamKeys: unordered(r.teamKeys) } : r);
const browseNorm = (r: any) => (r && typeof r === "object" ? { ...r, rows: unordered(r.rows) } : r);

const navCases: ParityCase[] = [
  ...(["month", "quarter", "year"] as const).map((p) =>
    lib(NAV, `nav: loadOverview(${p})`, "loadOverview", [p], () => nav.loadOverview(p), { normalize: overviewNorm }),
  ),
  {
    // loadOverview's activity events (sales-nav.ts:90), verbatim: .limit(5000), no ORDER BY
    name: "nav: overview activity events (capped, unordered) → GET /sales/nav/overview .events",
    prepare: async () => ({ since: nav.periodStart("year") }),
    legacy: async (supabase: any, ctx: any) =>
      strict(
        supabase
          .from("exp_activity_events")
          .select("id,event_type,account_id,logo,is_demo,occurred_at")
          .gte("occurred_at", `${ctx.since}T00:00:00Z`)
          .limit(5000),
      ),
    api: (ctx: any) => ({ method: "GET", path: `/sales/nav/overview?period=year&since=${ctx.since}` }),
    normalize: (r: any) => countAndShape(Array.isArray(r) ? r : r?.events),
  },
  ...(
    [
      { tab: "categories", q: "", page: 1 },
      { tab: "categories", q: "agent", page: 1 },
      { tab: "categories", q: "", page: 2 },
      { tab: "teams", q: "", page: 1 },
      { tab: "teams", q: "real", page: 1 },
      { tab: "sellers", q: "", page: 1 },
      { tab: "sellers", q: "srx", page: 2 },
      { tab: "professionals", q: "", page: 1 },
      { tab: "professionals", q: "smith", page: 1, gcid: "gcid:insurance_agency" },
      { tab: "brands", q: "", page: 1 },
      { tab: "brands", q: "state", page: 1, includeDemo: true },
      { tab: "locations", q: "farm", page: 1, gcid: "gcid:insurance_agency" },
    ] as Omit<nav.BrowseArgs, "pageSize">[]
  ).map((a) => {
    const args: nav.BrowseArgs = { ...a, pageSize: 6 };
    return lib(NAV, `nav: browse(${JSON.stringify(a)})`, "browse", [args], () => nav.browse(args), { normalize: browseNorm });
  }),
  {
    ...lib(NAV, "nav: browse past the last page → both refuse (416)", "browse",
      [{ tab: "categories", q: "zzzzqqxx", page: 3, pageSize: 6 }],
      () => nav.browse({ tab: "categories", q: "zzzzqqxx", page: 3, pageSize: 6 })),
    expectRefusal: true,
  },
  lib(NAV, "nav: loadScore(scored)", "loadScore", [PRO], () => nav.loadScore(PRO)),
  lib(NAV, "nav: loadScore(none) → null", "loadScore", [NO_ID], () => nav.loadScore(NO_ID)),
  lib(NAV, "nav: loadOrg(brand)", "loadOrg", [BRAND], () => nav.loadOrg(BRAND)),
  lib(NAV, "nav: loadOrg(none) → null", "loadOrg", [NO_ID], () => nav.loadOrg(NO_ID)),
  // locations: name ties inside the 500 compared as a set
  lib(NAV, "nav: loadBrandRollup(brand, 19,882 offices)", "loadBrandRollup", [BRAND], () => nav.loadBrandRollup(BRAND), {
    normalize: (r: any) => (r && typeof r === "object" ? { ...r, locations: unordered(r.locations) } : r),
  }),
  lib(NAV, "nav: loadBrandRollup(none)", "loadBrandRollup", [NO_ID], () => nav.loadBrandRollup(NO_ID)),
  {
    // loadBrandRollup's claim events (sales-nav.ts:392), verbatim: .limit(10000), no ORDER BY
    name: "nav: brand claim events (capped, unordered) → GET /sales/nav/organizations/:id/brand-rollup .claims",
    legacy: async (supabase: any) => {
      const db = supabase as unknown as { from: (t: string) => any };
      return strict(db.from("exp_claim_events").select("entity_id,entity_type,event_type").eq("logo_org_id", BRAND).in("event_type", ["claimed", "engaged", "upgraded"]).limit(10000));
    },
    api: { method: "GET", path: `/sales/nav/organizations/${BRAND}/brand-rollup` },
    normalize: (r: any) => countAndShape(Array.isArray(r) ? r : r?.claims),
  },
  lib(NAV, "nav: loadProfessional", "loadProfessional", [PRO], () => nav.loadProfessional(PRO)),
  lib(NAV, "nav: loadProfessional(none) → null", "loadProfessional", [NO_ID], () => nav.loadProfessional(NO_ID)),
  ...[
    { label: "subject", opts: { subjectId: "42c8fecb-0db1-475b-857d-c3021d867dc0" } },
    { label: "account", opts: { accountId: BRAND } },
    { label: "logo", opts: { logo: "State Farm" } },
    { label: "location", opts: { location: "Tempe, AZ" } },
    { label: "subject wins over account", opts: { subjectId: NO_ID, accountId: BRAND } },
    { label: "no filter", opts: {} },
  ].map(({ label, opts }) =>
    // occurred_at desc can tie
    lib(NAV, `nav: loadEventsFor(${label})`, "loadEventsFor", [opts], () => nav.loadEventsFor(opts), { normalize: unordered }),
  ),
  ...[SEAT_REP, SRE].map((id) =>
    lib(NAV, `nav: loadSeller(${id})`, "loadSeller", [id], () => nav.loadSeller(id), {
      normalize: (r: any) => (r && typeof r === "object" ? { ...r, quotas: unordered(r.quotas), assignments: unordered(r.assignments) } : r),
    }),
  ),
  lib(NAV, "nav: loadSeller(none)", "loadSeller", [NO_ID], () => nav.loadSeller(NO_ID)),
  {
    name: "nav: loadSellerBook(the account assignments' accounts)",
    prepare: async (sb: any) => {
      const rows = (await strict(sb.from("exp_sales_assignments").select("target_ref").eq("assignment_type", "account"))) as any[];
      return { args: [[...new Set(rows.map((r) => r.target_ref).filter(Boolean))]] };
    },
    legacy: legacyCall(NAV, "loadSellerBook"),
    current: (ctx: any) => nav.loadSellerBook(ctx.args[0]),
    normalize: allSets,
  },
  lib(NAV, "nav: loadSellerBook([])", "loadSellerBook", [[]], () => nav.loadSellerBook([])),
  ...["gcid:insurance_agency", "gcid:no_such_category"].map((g) =>
    lib(NAV, `nav: loadCategoryDashboard(${g})`, "loadCategoryDashboard", [g], () => nav.loadCategoryDashboard(g), {
      normalize: (r: any) => (r && typeof r === "object" ? { ...r, sampleOrgs: unordered(r.sampleOrgs) } : r), // name ties
    }),
  ),
  ...["real_estate", "insurance", "no_such_group"].map((g) =>
    lib(NAV, `nav: loadTeam(${g})`, "loadTeam", [g], () => nav.loadTeam(g), { normalize: allSets }), // role ties
  ),
];

/* ─── sales-spine.ts ─── */
const scopeNorm = (r: any) =>
  r && typeof r === "object"
    ? {
        ...r,
        claims: unordered(r.claims),
        categories: by("key")(r.categories),
        logos: by("id")(r.logos),
        teams: unordered(r.teams),
        teamRows: unordered(r.teamRows),
        reps: by("id")(r.reps),
        teamsLive: by("groupKey")(r.teamsLive),
        pipelineStages: by("stage")(r.pipelineStages),
      }
    : r;
const worklistNorm = (r: any) =>
  r && typeof r === "object"
    ? {
        ...r,
        reps: by("id")(r.reps),
        claims: unordered(r.claims),
        attempted: unordered(r.attempted),
        warm: unordered(r.warm),
        outside: unordered(r.outside),
        upgrades: unordered(r.upgrades),
        logos: by("id")(r.logos),
        promos: unordered(r.promos),
        opportunities: unordered(r.opportunities),
      }
    : r;
// the legacy spine sees the legacy seller board (also ported here)
const SPINE_DEPS = [SBOARD];

const spineCases: ParityCase[] = [
  lib(SPINE, "spine: loadScopeDashboard(all)", "loadScopeDashboard", [{ kind: "all" }], () => spine.loadScopeDashboard({ kind: "all" }), {
    normalize: scopeNorm,
    legacyDeps: SPINE_DEPS,
  }),
  ...["real_estate", "insurance"].map((g) => {
    const scope = { kind: "team", teamId: g, label: g } as spine.SalesScope;
    return lib(SPINE, `spine: loadScopeDashboard(team ${g})`, "loadScopeDashboard", [scope], () => spine.loadScopeDashboard(scope), {
      normalize: scopeNorm,
      legacyDeps: SPINE_DEPS,
    });
  }),
  {
    // the scope's claim events (sales-spine.ts:82), verbatim: .limit(10000) cut to the oldest 1000
    name: "spine: scope claim events (capped) → GET /sales/spine/scope .claims",
    legacy: async (supabase: any) => {
      const db = supabase as unknown as { from: (table: string) => any };
      return strict(db.from("exp_claim_events").select("id,entity_id,entity_label,entity_type,event_type,group_key,logo_org_id,nora_engagement,occurred_at,seller_id,state,contact_phone,contact_email,upgraded,is_demo").order("occurred_at", { ascending: true }).limit(10000));
    },
    api: { method: "GET", path: "/sales/spine/scope" },
    normalize: (r: any) => unordered(Array.isArray(r) ? r : r?.claims),
  },
  ...[
    ["no rep", null],
    ["SRE", SRE],
    ["a seat holder", SEAT_REP],
    ["a territory seller", TERR_REP],
  ].map(([label, id]) =>
    lib(SPINE, `spine: loadWorklist(${label})`, "loadWorklist", [id], () => spine.loadWorklist(id), {
      normalize: worklistNorm,
      legacyDeps: SPINE_DEPS,
    }),
  ),
  {
    // the worklist's claim events (sales-spine.ts:242), verbatim: .limit(10000) cut to the newest 1000
    name: "spine: worklist claim events (capped) → GET /sales/spine/worklist .claims",
    legacy: async (supabase: any) => {
      const db = supabase as unknown as { from: (table: string) => any };
      return strict(db.from("exp_claim_events").select("id,entity_id,entity_label,entity_type,event_type,group_key,logo_org_id,nora_engagement,occurred_at,seller_id,state,contact_phone,contact_email,upgraded,is_demo").order("occurred_at", { ascending: false }).limit(10000));
    },
    api: { method: "GET", path: "/sales/spine/worklist" },
    normalize: (r: any) => unordered(Array.isArray(r) ? r : r?.claims),
  },
  {
    // loadProfileMeta's chunk loop (sales-spine.ts:346), verbatim, over the worklist claims'
    // entity ids: the scores as a set, the graph_nodes rows (each chunk cut at 1000, no ORDER BY)
    // by count and shape
    name: "spine: profile meta, 200-id chunks → POST /sales/spine/profile-meta",
    prepare: async (sb: any) => {
      const rows = (await strict(sb.from("exp_claim_events").select("entity_id").order("occurred_at", { ascending: false }).limit(10000))) as any[];
      return { ids: [...new Set(rows.map((r) => r.entity_id).filter((id: string | null): id is string => !!id))] };
    },
    legacy: async (supabase: any, ctx: any) => {
      const db = supabase as unknown as { from: (table: string) => any };
      const ids: string[] = ctx.ids;
      const scores: unknown[] = [];
      const nodes: unknown[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const [s, n] = await Promise.all([
          db.from("search_rank_scores").select("entity_id,total_score").in("entity_id", chunk),
          db.from("graph_nodes").select("entity_id").in("entity_id", chunk).eq("is_active", true).limit(10000),
        ]);
        scores.push(...((s.data ?? []) as unknown[]));
        nodes.push(...((n.data ?? []) as unknown[]));
      }
      return { scores, nodes };
    },
    api: (ctx: any) => ({ method: "POST", path: "/sales/spine/profile-meta", body: { ids: ctx.ids } }),
    normalize: (r: any) => (r && typeof r === "object" ? { scores: unordered(r.scores), nodes: countAndShape(r.nodes) } : r),
  },
  {
    // loadWorklist's per-logo location count (sales-spine.ts:294), verbatim, for the brand and an
    // unknown org
    name: "spine: per-logo location counts → POST /sales/spine/location-counts",
    legacy: async (supabase: any) => {
      const db = supabase as unknown as { from: (table: string) => any };
      const out: Record<string, number | null> = {};
      for (const id of [BRAND, NO_ID]) {
        const locationsQ = await db.from("organizations").select("id", { count: "exact", head: true }).eq("parent_org_id", id);
        out[id] = locationsQ.error ? null : locationsQ.count ?? 0;
      }
      return out;
    },
    api: { method: "POST", path: "/sales/spine/location-counts", body: { ids: [BRAND, NO_ID] } },
  },
];

export const cases: ParityCase[] = [...deskCases, ...boardCases, ...navCases, ...spineCases];
