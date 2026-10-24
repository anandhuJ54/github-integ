/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as terr from "@v3/ui/lib/territories";
import * as admin from "@v3/sales/lib/territory-admin";
import * as cg from "@v3/sales/lib/category-groups";

// sales S4: every read in surface-ui/_base/src/lib/territories.ts,
// surface-ui/sales/src/lib/territory-admin.ts and surface-ui/sales/src/lib/category-groups.ts.
// The legacy lib (direct supabase-js, from PARITY_LEGACY_REF) against the current one (same lib,
// rows from FastAPI /sales/territories/* and /sales/category-groups/*), plus the private reads
// (nextSeq, groupGcid, proposeTerritories' groups, searchBrands' raw rows) inline, verbatim from
// those files at PARITY_LEGACY_REF (line refs to that file there), against their endpoint.
// territory-admin.ts and category-groups.ts import territories.ts, which the port changed: their
// legacy copies import the legacy territories.ts (legacyDeps).
//
// Writes are covered by compiled-SQL / fake-connection unit tests (sales/queries/territories_test.py,
// category_groups_test.py), never run: the slot insert / update / delete, brand links, lane
// assignments, quotas, ramps, seats, proposals (insert + review), rep duty / backup, group members,
// and the two generate functions exp_generate_territories / exp_generate_group_territories
// (allow-listed RPCs that write territories). Write flows that read first (proposeTerritories,
// proposeCategorySplit, saveTerritory) are covered here through their reads only.
//
// Order: several reads sort on keys with ties at port time (exp_territories by tier, seq: the
// catch-all and Real Estate slots share ENT/1 etc.; quotas / metrics by period_start; the RPC
// results and the reads with no ORDER BY). Those cases compare the rows as a set. Unordered capped
// reads (searchBrands limit 20, searchCategories limit 25) compare the count and the row shape.
// Rows at port time: 13 territories, 5 brand links, 0 proposals, 0 ramps, 0 routing rows,
// 91 quotas, 22 rep metrics, 21 reps, 4 groups, 6 members, 2 seats, 13 root organizations.

const TERR = "surface-ui/_base/src/lib/territories.ts";
const ADMIN = "surface-ui/sales/src/lib/territory-admin.ts";
const CG = "surface-ui/sales/src/lib/category-groups.ts";
const T = "/sales/territories";
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
/** An unordered capped read: the count and each row's keys (which rows is arbitrary). */
const countShape = (r: any) =>
  Array.isArray(r) ? { n: r.length, shapes: [...new Set(r.map((x) => Object.keys(x).sort().join(",")))].sort() } : r;
/** loadAllTerritories: rows by id, each row's brand links as a set. */
const territoryRows = (r: any) =>
  Array.isArray(r) ? sortRows(r.map((t) => ({ ...t, brands: sortRows(t.brands) }))) : r;
/** loadCategorySizing: logos as a set; the bins' totals as a multiset (equal-size logos may swap bins). */
const sizing = (s: any) =>
  s && typeof s === "object" && !Array.isArray(s)
    ? { ...s, logos: sortRows(s.logos), bins: s.bins.map((b: any) => b.total).sort((a: number, b: number) => a - b) }
    : s;
/** loadGroupScorecard: sellers by repId (cards with equal pct come in the quotas' tie order). */
const scorecard = (s: any) =>
  s && typeof s === "object" && Array.isArray(s.sellers)
    ? { ...s, sellers: [...s.sellers].sort((a, b) => a.repId.localeCompare(b.repId)).map((c) => ({ ...c, territories: [...c.territories].sort() })) }
    : s;

const lib = (
  module: string,
  name: string,
  exp: string,
  args: unknown[],
  current: () => Promise<unknown>,
  extra: Partial<ParityCase> = {},
): ParityCase => ({ name, legacyModule: module, legacyExport: exp, legacyArgs: args, current, ...extra });

const DEPS = { legacyDeps: [TERR] };

/** A legacy lib export called with arguments from `prepare`. */
const legacyCall = (module: string, exp: string, deps?: string[]) => async (_sb: any, ctx: any) =>
  ((await (globalThis as any).__legacyModule(module, deps)) as any)[exp](...ctx);

/** Shared input: territory ids (all, and one), fetched the legacy way. */
const territoryIds = async (sb: any) => {
  const rows = (await strict(sb.from("exp_territories").select("id").order("id"))) as any[];
  return rows.map((r) => r.id as string);
};

/* ─── territories.ts ─── */
const terrCases: ParityCase[] = [
  lib(TERR, "territories: loadTerritoryCategories", "loadTerritoryCategories", [], () => terr.loadTerritoryCategories()),
  lib(TERR, "territories: loadTerritories()", "loadTerritories", [], () => terr.loadTerritories(), { normalize: unordered }),
  lib(TERR, "territories: loadTerritories('*')", "loadTerritories", ["*"], () => terr.loadTerritories("*"), { normalize: unordered }),
  lib(TERR, "territories: loadTerritoryRules", "loadTerritoryRules", [], () => terr.loadTerritoryRules()),
  lib(TERR, "territories: loadTerritoryReps", "loadTerritoryReps", [], () => terr.loadTerritoryReps()),
  lib(TERR, "territories: loadCurrentQuotas", "loadCurrentQuotas", [], () => terr.loadCurrentQuotas(), { normalize: unordered }),
  lib(TERR, "territories: loadRoutingState", "loadRoutingState", [], () => terr.loadRoutingState(), { normalize: unordered }),
  {
    name: "territories: loadTerritoryBrands(all ids)",
    prepare: async (sb: any) => [await territoryIds(sb)],
    legacy: legacyCall(TERR, "loadTerritoryBrands"),
    current: (ctx: any) => terr.loadTerritoryBrands(ctx[0]),
    normalize: unordered,
  },
  lib(TERR, "territories: loadTerritoryBrands([])", "loadTerritoryBrands", [[]], () => terr.loadTerritoryBrands([])),
  {
    name: "territories: loadTerritoryLabel(first id)",
    prepare: async (sb: any) => [(await territoryIds(sb))[0]],
    legacy: legacyCall(TERR, "loadTerritoryLabel"),
    current: (ctx: any) => terr.loadTerritoryLabel(ctx[0]),
  },
  lib(TERR, "territories: loadTerritoryLabel(no such id)", "loadTerritoryLabel", [NO_ID], () => terr.loadTerritoryLabel(NO_ID)),
  lib(TERR, "territories: loadTerritoryLabel(null)", "loadTerritoryLabel", [null], () => terr.loadTerritoryLabel(null)),
  lib(TERR, "territories: loadAllTerritories", "loadAllTerritories", [], () => terr.loadAllTerritories(), { normalize: territoryRows }),
  {
    name: "territories: loadTerritoryRow(first id)",
    prepare: async (sb: any) => [(await territoryIds(sb))[0]],
    legacy: legacyCall(TERR, "loadTerritoryRow"),
    current: (ctx: any) => terr.loadTerritoryRow(ctx[0]),
    normalize: (r: any) => (r ? { ...r, brands: sortRows(r.brands) } : r),
  },
  lib(TERR, "territories: loadTerritoryRow(no such id)", "loadTerritoryRow", [NO_ID], () => terr.loadTerritoryRow(NO_ID)),
  // limit(20), no ORDER BY: count + shape
  lib(TERR, "territories: searchBrands('re')", "searchBrands", ["re"], () => terr.searchBrands("re"), { normalize: countShape }),
  lib(TERR, "territories: searchBrands('  RE/MAX ')", "searchBrands", ["  RE/MAX "], () => terr.searchBrands("  RE/MAX "), { normalize: countShape }),
  lib(TERR, "territories: searchBrands('r') (too short)", "searchBrands", ["r"], () => terr.searchBrands("r")),
  lib(TERR, "territories: loadProposals()", "loadProposals", [], () => terr.loadProposals()),
  lib(TERR, "territories: loadProposals('pending')", "loadProposals", ["pending"], () => terr.loadProposals("pending")),
  // exp_territory_logo_profiles() has no ORDER BY
  lib(TERR, "territories: loadLogoProfiles", "loadLogoProfiles", [], () => terr.loadLogoProfiles(), { normalize: unordered }),
  {
    // nextSeq (territories.ts:446), verbatim, for a group × tier with slots
    name: "territories: nextSeq read → GET /sales/territories/next-seq",
    legacy: async (sb: any) => {
      const { data } = await sb
        .from("exp_territories")
        .select("seq")
        .eq("group_key", "real_estate")
        .eq("tier", "ENT")
        .order("seq", { ascending: false })
        .limit(1);
      return data ?? [];
    },
    api: { method: "GET", path: `${T}/next-seq?group_key=real_estate&tier=ENT` },
  },
  {
    // groupGcid (territories.ts:457) / proposeCategorySplit (territory-admin.ts:86), verbatim
    name: "territories: groupGcid read → GET /sales/territories/group-gcid",
    legacy: async (sb: any) => {
      const { data } = await sb
        .from("exp_category_group_members")
        .select("gcid")
        .eq("group_key", "bakeries")
        .order("gcid")
        .limit(1);
      return data ?? [];
    },
    api: { method: "GET", path: `${T}/group-gcid?group_key=bakeries` },
  },
  {
    // proposeTerritories' groups (territories.ts:725), verbatim; no ORDER BY
    name: "territories: proposeTerritories groups → GET /sales/territories/groups",
    legacy: async (sb: any) => {
      const groupsRes = await sb.from("exp_category_groups").select("group_key,label,is_catchall");
      return groupsRes.data ?? [];
    },
    api: { method: "GET", path: `${T}/groups` },
    normalize: unordered,
  },
];

/* ─── territory-admin.ts ─── */
const adminCases: ParityCase[] = [
  lib(ADMIN, "admin: loadAdminGroups", "loadAdminGroups", [], () => admin.loadAdminGroups(), DEPS),
  lib(ADMIN, "admin: loadCategorySizing('real_estate')", "loadCategorySizing", ["real_estate"], () => admin.loadCategorySizing("real_estate"), { ...DEPS, normalize: sizing }),
  lib(ADMIN, "admin: loadCategorySizing('insurance_agency')", "loadCategorySizing", ["insurance_agency"], () => admin.loadCategorySizing("insurance_agency"), { ...DEPS, normalize: sizing }),
  lib(ADMIN, "admin: loadCategorySizing('bakeries')", "loadCategorySizing", ["bakeries"], () => admin.loadCategorySizing("bakeries"), { ...DEPS, normalize: sizing }),
  lib(ADMIN, "admin: loadHydration('real_estate')", "loadHydration", ["real_estate"], () => admin.loadHydration("real_estate"), DEPS),
  lib(ADMIN, "admin: loadHydration('bakeries')", "loadHydration", ["bakeries"], () => admin.loadHydration("bakeries"), DEPS),
  lib(ADMIN, "admin: loadHydration(no such group)", "loadHydration", ["no_such_group"], () => admin.loadHydration("no_such_group"), DEPS),
  lib(ADMIN, "admin: loadNoraRep", "loadNoraRep", [], () => admin.loadNoraRep(), DEPS),
  lib(ADMIN, "admin: loadSeats('real_estate')", "loadSeats", ["real_estate"], () => admin.loadSeats("real_estate"), DEPS),
  {
    name: "admin: loadRamps(all ids)",
    prepare: async (sb: any) => [await territoryIds(sb)],
    legacy: legacyCall(ADMIN, "loadRamps", [TERR]),
    current: (ctx: any) => admin.loadRamps(ctx[0]),
    normalize: unordered, // month_offset ties across territories
  },
  lib(ADMIN, "admin: loadRamps([])", "loadRamps", [[]], () => admin.loadRamps([]), DEPS),
];

/* ─── category-groups.ts ─── */
const cgCases: ParityCase[] = [
  lib(CG, "groups: loadCategoryGroups", "loadCategoryGroups", [], () => cg.loadCategoryGroups(), DEPS),
  lib(CG, "groups: loadGroupMembers()", "loadGroupMembers", [], () => cg.loadGroupMembers(), DEPS),
  lib(CG, "groups: loadGroupMembers('bakeries')", "loadGroupMembers", ["bakeries"], () => cg.loadGroupMembers("bakeries"), DEPS),
  lib(CG, "groups: loadGroupTerritories()", "loadGroupTerritories", [], () => cg.loadGroupTerritories(), { ...DEPS, normalize: unordered }),
  lib(CG, "groups: loadGroupTerritories('real_estate')", "loadGroupTerritories", ["real_estate"], () => cg.loadGroupTerritories("real_estate"), { ...DEPS, normalize: unordered }),
  lib(CG, "groups: loadGroupQuotas()", "loadGroupQuotas", [], () => cg.loadGroupQuotas(), { ...DEPS, normalize: unordered }),
  lib(CG, "groups: loadGroupQuotas('real_estate')", "loadGroupQuotas", ["real_estate"], () => cg.loadGroupQuotas("real_estate"), { ...DEPS, normalize: unordered }),
  lib(CG, "groups: loadGroupMetrics()", "loadGroupMetrics", [], () => cg.loadGroupMetrics(), { ...DEPS, normalize: unordered }),
  lib(CG, "groups: loadGroupMetrics('real_estate')", "loadGroupMetrics", ["real_estate"], () => cg.loadGroupMetrics("real_estate"), { ...DEPS, normalize: unordered }),
  lib(CG, "groups: loadGroupsOverview", "loadGroupsOverview", [], () => cg.loadGroupsOverview(), DEPS),
  // limit(25), no ORDER BY: count + shape ('ba' matches 195 categories at port time)
  lib(CG, "groups: searchCategories('bak')", "searchCategories", ["bak"], () => cg.searchCategories("bak"), { ...DEPS, normalize: countShape }),
  lib(CG, "groups: searchCategories('ba')", "searchCategories", ["ba"], () => cg.searchCategories("ba"), { ...DEPS, normalize: countShape }),
  lib(CG, "groups: searchCategories('gcid:bakery')", "searchCategories", ["gcid:bakery"], () => cg.searchCategories("gcid:bakery"), { ...DEPS, normalize: countShape }),
  lib(CG, "groups: searchCategories('b') (too short)", "searchCategories", ["b"], () => cg.searchCategories("b"), DEPS),
  lib(CG, "groups: loadGroupScorecard('real_estate')", "loadGroupScorecard", ["real_estate"], () => cg.loadGroupScorecard("real_estate"), { ...DEPS, normalize: scorecard }),
  lib(CG, "groups: loadGroupScorecard('insurance_agency')", "loadGroupScorecard", ["insurance_agency"], () => cg.loadGroupScorecard("insurance_agency"), { ...DEPS, normalize: scorecard }),
  lib(CG, "groups: loadGroupScorecard(no such group)", "loadGroupScorecard", ["no_such_group"], () => cg.loadGroupScorecard("no_such_group"), { ...DEPS, normalize: scorecard }),
];

export const cases: ParityCase[] = [...terrCases, ...adminCases, ...cgCases];
