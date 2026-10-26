/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as teams from "@v3/sales/lib/teams";
import * as setup from "@v3/sales/lib/seller-setup";

// sales S4 (teams): every read in surface-ui/sales/src/lib/teams.ts and lib/seller-setup.ts, and
// the rep-name read in routes/_authenticated/sales.promos.tsx. The legacy lib (direct supabase-js,
// from PARITY_LEGACY_REF) against the current one (same lib, rows from FastAPI /sales/teams/* and
// /sales/seller-setup/*), plus each read the libs reshape or only make while saving, raw, against
// its endpoint. Inline legacy reads are verbatim copies from those files at PARITY_LEGACY_REF (line
// refs to that file there).
// The writes (territory assign/unassign/recount updates, the territory move's four updates, the
// quota update/inserts, the rep insert/update, the vertical insert/delete) are covered by
// compiled-SQL / fake-connection unit tests (sales/queries/teams_test.py, seller_setup_test.py),
// never run.
//
// Ties and unordered reads (rows at port time): exp_sales_reps by name, 21 rows / 20 names;
// exp_territories by tier, seq, 13 rows / 7 distinct (tier, seq) — unique within one group_key;
// exp_territory_brand (5 rows), exp_sales_quotas, exp_sales_rep_verticals and the rep names have
// no ORDER BY. Those are compared as sets. The territory move's office read
// (organizations.parent_org_id, limit(50000) cut to 1000, no ORDER BY; follow-up 1j) on a brand
// with 19,882 offices is compared by count and row shape only: which 1000 rows come back is up to
// Postgres on both sides.
// loadGroupTeams' quota read filters on the current period: the browser's clock in the legacy,
// the server's in the API (the same UTC month unless run across a month boundary).

const TEAMS = "surface-ui/sales/src/lib/teams.ts";
const SETUP = "surface-ui/sales/src/lib/seller-setup.ts";
const GROUPS = "surface-ui/sales/src/lib/category-groups.ts";
const TERRS = "surface-ui/_base/src/lib/territories.ts";
const T = "/sales/teams";
const S = "/sales/seller-setup";
const YEAR = new Date().getUTCFullYear();

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
/** Each team's brands come from the unordered link read: compare them as a set. */
const teamBrands = (t: any) => ({ ...t, brands: unordered(t.brands) });

const lib = (
  module: string,
  name: string,
  exp: string,
  args: unknown[],
  current: () => Promise<unknown>,
  extra: Partial<ParityCase> = {},
): ParityCase => ({ name, legacyModule: module, legacyExport: exp, legacyArgs: args, current, ...extra });

/** A legacy lib export called with arguments from `prepare`. */
const legacyCall = (module: string, exp: string, deps: string[]) => async (_sb: any, ctx: any) =>
  ((await (globalThis as any).__legacyModule(module, deps)) as any)[exp](...ctx.args);

/**
 * Shared input, fetched the legacy way: a territory with an open brand link (its group, its
 * seller), the brand's org, a rep that holds a territory, and every territory id.
 */
const keys = async (sb: any) => {
  const terrs = (await strict(
    sb.from("exp_territories").select("id,group_key,tier,seller_id").order("id"),
  )) as any[];
  const links = (await strict(
    sb.from("exp_territory_brand").select("territory_id,org_id").is("success_handoff_at", null).order("id"),
  )) as any[];
  const linked = terrs.find((t) => links.some((l) => l.territory_id === t.id)) ?? terrs[0];
  const held = terrs.find((t) => t.seller_id) ?? null;
  const reps = (await strict(sb.from("exp_sales_reps").select("id").order("id"))) as any[];
  return {
    territory: linked?.id ?? null,
    group: linked?.group_key ?? "",
    tier: linked?.tier ?? "",
    org: links.find((l) => l.territory_id === linked?.id)?.org_id ?? null,
    heldRep: held?.seller_id ?? reps[0]?.id ?? null,
    rep: reps[0]?.id ?? null,
    territoryIds: terrs.map((t) => t.id),
  };
};

const TEAMS_DEPS = [GROUPS, TERRS];
const SETUP_DEPS = [TEAMS, GROUPS];

/* ─── teams.ts: the lib ─── */
const teamsLibCases: ParityCase[] = [
  // order("name"): one tie
  lib(TEAMS, "teams: loadReps", "loadReps", [], () => teams.loadReps(), {
    legacyDeps: TEAMS_DEPS,
    normalize: unordered,
  }),
  // per-group rows; each group's brandLogos come from the unordered link read
  lib(TEAMS, "teams: loadTeamsSummary", "loadTeamsSummary", [], () => teams.loadTeamsSummary(), {
    legacyDeps: TEAMS_DEPS,
    normalize: (r: any) =>
      r && Array.isArray(r.groups)
        ? { ...r, groups: r.groups.map((g: any) => ({ ...g, brandLogos: unordered(g.brandLogos) })) }
        : r,
  }),
  {
    name: "teams: loadGroupTeams(group with a brand)",
    prepare: async (sb: any) => ({ args: [(await keys(sb)).group] }),
    legacy: legacyCall(TEAMS, "loadGroupTeams", TEAMS_DEPS),
    current: (ctx: any) => teams.loadGroupTeams(ctx.args[0]),
    normalize: (r: any) => (r && Array.isArray(r.teams) ? { ...r, teams: r.teams.map(teamBrands) } : r),
  },
  lib(TEAMS, "teams: loadGroupTeams(no such group)", "loadGroupTeams", ["no-such-group"], () =>
    teams.loadGroupTeams("no-such-group"), { legacyDeps: TEAMS_DEPS }),
  {
    name: "teams: loadTeamDetail(territory with a brand)",
    prepare: async (sb: any) => ({ args: [(await keys(sb)).territory] }),
    legacy: legacyCall(TEAMS, "loadTeamDetail", TEAMS_DEPS),
    current: (ctx: any) => teams.loadTeamDetail(ctx.args[0]),
    normalize: (r: any) => (r && r.team ? { ...r, team: teamBrands(r.team) } : r),
  },
  lib(TEAMS, "teams: loadTeamDetail(no such territory)", "loadTeamDetail",
    ["00000000-0000-4000-8000-000000000000"],
    () => teams.loadTeamDetail("00000000-0000-4000-8000-000000000000"), { legacyDeps: TEAMS_DEPS }),
  lib(TEAMS, "teams: loadAllBrandLinks", "loadAllBrandLinks", [], () => teams.loadAllBrandLinks(), {
    legacyDeps: TEAMS_DEPS,
    normalize: unordered,
  }),
];

/* ─── teams.ts: raw reads (the ones the lib reshapes, or makes only while writing) ─── */
const teamsRawCases: ParityCase[] = [
  {
    // sales.promos.tsx:48, verbatim
    name: "promos: rep names → GET /sales/teams/rep-names",
    legacy: async (sb: any) => {
      const { data, error } = await sb.from("exp_sales_reps").select("id,name");
      if (error) throw error;
      return data ?? [];
    },
    api: { method: "GET", path: `${T}/rep-names` },
    normalize: unordered,
  },
  {
    // loadTeamsSummary (teams.ts:149): every territory by tier, seq (ties across groups)
    name: "teams: territories → GET /sales/teams/territories",
    legacy: async (sb: any) => strict(sb.from("exp_territories").select("*").order("tier").order("seq")),
    api: { method: "GET", path: `${T}/territories` },
    normalize: unordered,
  },
  {
    // loadGroupTeams (teams.ts:209): one group, by tier, seq (unique within a group)
    name: "teams: group territories → GET /sales/teams/territories?group_key",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) =>
      strict(sb.from("exp_territories").select("*").eq("group_key", k.group).order("tier").order("seq")),
    api: (k: any) => ({ method: "GET", path: `${T}/territories?group_key=${encodeURIComponent(k.group)}` }),
  },
  {
    // loadTeamDetail's siblings with a null group (teams.ts:271): eq("group_key", "")
    name: "teams: territories of group \"\" → GET /sales/teams/territories?group_key=",
    legacy: async (sb: any) =>
      strict(sb.from("exp_territories").select("*").eq("group_key", "").order("tier").order("seq")),
    api: { method: "GET", path: `${T}/territories?group_key=` },
  },
  {
    // loadAllBrandLinks (teams.ts:297): no ORDER BY
    name: "teams: all territories → GET /sales/teams/territories/all",
    legacy: async (sb: any) => strict(sb.from("exp_territories").select("*")),
    api: { method: "GET", path: `${T}/territories/all` },
    normalize: unordered,
  },
  {
    // loadTeamDetail (teams.ts:256)
    name: "teams: territory → GET /sales/teams/territories/{id}",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) =>
      strict(sb.from("exp_territories").select("*").eq("id", k.territory).maybeSingle()),
    api: (k: any) => ({ method: "GET", path: `${T}/territories/${k.territory}` }),
  },
  {
    // loadTeamDetail's two counts (teams.ts:265-270), errors ignored
    name: "teams: detail counts → GET /sales/teams/territories/{id}/counts",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const [proCount, officeCount] = await Promise.all([
        sb.from("professionals").select("id", { count: "exact", head: true }).eq("territory_id", k.territory),
        sb
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("territory_id", k.territory)
          .eq("entity_type", "office"),
      ]);
      return { profiles: proCount.count ?? null, offices: officeCount.count ?? null };
    },
    api: (k: any) => ({ method: "GET", path: `${T}/territories/${k.territory}/counts` }),
  },
  {
    // recountTerritories' three counts (teams.ts:316-324), errors ignored
    name: "teams: recount counts → GET /sales/teams/territories/{id}/counts?brands=true",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const id = k.territory;
      const [{ count: brandCount }, { count: officeCount }, { count: agentCount }] = await Promise.all([
        sb.from("exp_territory_brand").select("id", { count: "exact", head: true }).eq("territory_id", id),
        sb
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("territory_id", id)
          .eq("entity_type", "office"),
        sb.from("professionals").select("id", { count: "exact", head: true }).eq("territory_id", id),
      ]);
      return { brands: brandCount ?? null, offices: officeCount ?? null, profiles: agentCount ?? null };
    },
    api: (k: any) => ({ method: "GET", path: `${T}/territories/${k.territory}/counts?brands=true` }),
  },
  {
    // brandsForTerritories (teams.ts:88-122), every territory: the links (unordered), their orgs
    // (unordered), the office count per distinct org and the professional count per link
    name: "teams: brandsForTerritories rows → POST /sales/teams/brands",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const { data, error } = await sb
        .from("exp_territory_brand")
        .select("id,territory_id,lane,org_id")
        .in("territory_id", k.territoryIds)
        .is("success_handoff_at", null);
      if (error) throw error;
      const links = (data ?? []) as any[];
      if (!links.length) return { links: [], orgs: [], offices: [], profiles: [] };
      const orgIds = [...new Set(links.map((l) => l.org_id))];
      const { data: orgs } = await sb
        .from("organizations")
        .select("id,name,slug,account_tier,is_demo,logo_url")
        .in("id", orgIds);
      const offices = await Promise.all(
        orgIds.map(async (id) => {
          const { count } = await sb
            .from("organizations")
            .select("id", { count: "exact", head: true })
            .eq("parent_org_id", id);
          return count ?? null;
        }),
      );
      const profiles = await Promise.all(
        links.map(async (l) => {
          const { count } = await sb
            .from("professionals")
            .select("id", { count: "exact", head: true })
            .eq("territory_id", l.territory_id);
          return count ?? null;
        }),
      );
      return { links, orgs: orgs ?? [], offices, profiles };
    },
    api: (k: any) => ({ method: "POST", path: `${T}/brands`, body: { territory_ids: k.territoryIds } }),
    // the counts follow the link order, which is unordered: pair each with its link / org
    normalize: (r: any) =>
      r && Array.isArray(r.links)
        ? {
            links: sortRows(r.links.map((l: any, i: number) => ({ ...l, profiles: r.profiles[i] }))),
            orgs: unordered(r.orgs),
            offices: sortRows(
              [...new Set(r.links.map((l: any) => l.org_id))].map((id, i) => ({ id, n: r.offices[i] })),
            ),
          }
        : r,
  },
  {
    // loadGroupTeams' quotas (teams.ts:211-215), error ignored; the current period (see above)
    name: "teams: group quotas → GET /sales/teams/quotas",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const d = new Date();
      const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const quotasRes = await sb
        .from("exp_sales_quotas")
        .select("rep_id,target,group_key,period_start")
        .eq("group_key", k.group)
        .eq("period_start", period);
      return quotasRes.data ?? [];
    },
    api: (k: any) => ({ method: "GET", path: `${T}/quotas?group_key=${encodeURIComponent(k.group)}` }),
    normalize: unordered,
  },
  {
    // assignSeller's quota lookup (teams.ts:396-402), error ignored
    name: "teams: quota lookup → GET /sales/teams/quotas/lookup",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const d = new Date();
      const period_start = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const { data: existing } = await sb
        .from("exp_sales_quotas")
        .select("id")
        .eq("rep_id", k.heldRep)
        .eq("group_key", k.group)
        .eq("period_start", period_start)
        .maybeSingle();
      return existing ?? null;
    },
    api: (k: any) => ({
      method: "GET",
      path: `${T}/quotas/lookup?rep_id=${k.heldRep}&group_key=${encodeURIComponent(k.group)}`,
    }),
  },
  {
    // moveBrandTerritory's office ids (teams.ts:363-367), error ignored: limit(50000) cut to 1000
    // by PostgREST (follow-up 1j), no ORDER BY — the count and shape (see above)
    name: "teams: move office ids → GET /sales/teams/organizations/{id}/offices",
    prepare: async (sb: any) => {
      // the brand with the most offices (19,882 at port time), else the linked brand
      const k = await keys(sb);
      const links = (await strict(sb.from("exp_territory_brand").select("org_id").order("id"))) as any[];
      let best = k.org;
      let most = -1;
      for (const l of links) {
        const { count } = await sb
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("parent_org_id", l.org_id);
        if ((count ?? 0) > most) [best, most] = [l.org_id, count ?? 0];
      }
      return { org: best };
    },
    legacy: async (sb: any, k: any) => {
      const { data: officeRows } = await sb
        .from("organizations")
        .select("id")
        .eq("parent_org_id", k.org)
        .limit(50000);
      return officeRows ?? [];
    },
    api: (k: any) => ({ method: "GET", path: `${T}/organizations/${k.org}/offices` }),
    normalize: countAndShape,
  },
];

/* ─── seller-setup.ts ─── */
const setupNormalize = (r: any) =>
  r && typeof r === "object"
    ? {
        ...r,
        reps: unordered(r.reps),
        territories: unordered(r.territories),
        verticals: unordered(r.verticals),
        brandLinks: unordered(r.brandLinks),
        quotas: unordered(r.quotas),
      }
    : r;

const setupCases: ParityCase[] = [
  lib(SETUP, `setup: loadSellerSetup(null, ${YEAR})`, "loadSellerSetup", [null, YEAR],
    () => setup.loadSellerSetup(null, YEAR), { legacyDeps: SETUP_DEPS, normalize: setupNormalize }),
  {
    name: `setup: loadSellerSetup(rep with a territory, ${YEAR})`,
    prepare: async (sb: any) => ({ args: [(await keys(sb)).heldRep, YEAR] }),
    legacy: legacyCall(SETUP, "loadSellerSetup", SETUP_DEPS),
    current: (ctx: any) => setup.loadSellerSetup(ctx.args[0], ctx.args[1]),
    normalize: setupNormalize,
  },
  {
    // a year with quotas, if any (the newest quarter quota's year)
    name: "setup: loadSellerSetup(rep with quarter quotas, their year)",
    prepare: async (sb: any) => {
      const rows = (await strict(
        sb
          .from("exp_sales_quotas")
          .select("rep_id,period_start")
          .eq("period_type", "quarter")
          .not("rep_id", "is", null)
          .order("period_start", { ascending: false })
          .order("rep_id")
          .limit(1),
      )) as any[];
      const k = await keys(sb);
      return rows.length
        ? { args: [rows[0].rep_id, Number(String(rows[0].period_start).slice(0, 4))] }
        : { args: [k.rep, YEAR] };
    },
    legacy: legacyCall(SETUP, "loadSellerSetup", SETUP_DEPS),
    current: (ctx: any) => setup.loadSellerSetup(ctx.args[0], ctx.args[1]),
    normalize: setupNormalize,
  },
  lib(SETUP, "setup: loadSellerSetup(no such rep)", "loadSellerSetup",
    ["00000000-0000-4000-8000-000000000000", YEAR],
    () => setup.loadSellerSetup("00000000-0000-4000-8000-000000000000", YEAR),
    { legacyDeps: SETUP_DEPS, normalize: setupNormalize }),
  {
    // loadSellerSetup's raw reads (seller-setup.ts:101-156), errors ignored
    name: "setup: rows → GET /sales/seller-setup",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const repId = k.heldRep;
      const [repsRes, terrRes] = await Promise.all([
        sb.from("exp_sales_reps").select("id,name,team_name").order("name"),
        sb.from("exp_territories").select("id,label,tier,group_key,seller_id,status,brand_count,agent_count").order("tier").order("seq"),
      ]);
      const [repRes, vertRes, quotaRes] = await Promise.all([
        sb
          .from("exp_sales_reps")
          .select(
            "id,name,email,phone,title,role,group_key,team_name,photo_url,hire_date,on_duty,backup_rep_id,sdrcloud_url,attribution_target,is_demo",
          )
          .eq("id", repId)
          .maybeSingle(),
        sb.from("exp_sales_rep_verticals").select("id,group_key").eq("rep_id", repId),
        sb
          .from("exp_sales_quotas")
          .select("id,period_start,target,actual")
          .eq("rep_id", repId)
          .eq("period_type", "quarter")
          .in("period_start", ["01", "04", "07", "10"].map((m) => `${YEAR}-${m}-01`)),
      ]);
      const linkRes = await sb.from("exp_territory_brand").select("id,territory_id,org_id,lane").is("success_handoff_at", null);
      const links = (linkRes.data ?? []) as any[];
      const orgIds = [...new Set(links.map((l) => l.org_id))];
      let orgs: any[] = [];
      if (orgIds.length) {
        const { data } = await sb.from("organizations").select("id,name,logo_url").in("id", orgIds);
        orgs = data ?? [];
      }
      return {
        reps: repsRes.data ?? [],
        territories: terrRes.data ?? [],
        rep: repRes.data ?? null,
        verticals: vertRes.data ?? [],
        quotas: quotaRes.data ?? [],
        links,
        orgs,
      };
    },
    api: (k: any) => ({ method: "GET", path: `${S}?year=${YEAR}&rep_id=${k.heldRep}` }),
    normalize: (r: any) =>
      r && typeof r === "object"
        ? Object.fromEntries(Object.entries(r).map(([kk, v]) => [kk, unordered(v)]))
        : r,
  },
  {
    // saveSellerSetup's verticals read (seller-setup.ts:267-270), error ignored
    name: "setup: rep verticals → GET /sales/seller-setup/reps/{id}/verticals",
    prepare: async (sb: any) => {
      const rows = (await strict(sb.from("exp_sales_rep_verticals").select("rep_id").order("rep_id").limit(1))) as any[];
      return { rep: rows[0]?.rep_id ?? (await keys(sb)).rep };
    },
    legacy: async (sb: any, k: any) => {
      const { data: existingVerts } = await sb.from("exp_sales_rep_verticals").select("id,group_key").eq("rep_id", k.rep);
      return existingVerts ?? [];
    },
    api: (k: any) => ({ method: "GET", path: `${S}/reps/${k.rep}/verticals` }),
    normalize: unordered,
  },
  {
    // saveSellerSetup's held territories (seller-setup.ts:290-293), error ignored
    name: "setup: rep territories → GET /sales/seller-setup/reps/{id}/territories",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const { data: currentTerrs } = await sb.from("exp_territories").select("id").eq("seller_id", k.heldRep);
      return currentTerrs ?? [];
    },
    api: (k: any) => ({ method: "GET", path: `${S}/reps/${k.heldRep}/territories` }),
    normalize: unordered,
  },
  {
    // saveSellerSetup's link read (seller-setup.ts:315-317), error ignored, no filter, no order
    name: "setup: all links → GET /sales/seller-setup/brand-links",
    legacy: async (sb: any) => {
      const { data: linkRows } = await sb.from("exp_territory_brand").select("id,territory_id,org_id,lane");
      return linkRows ?? [];
    },
    api: { method: "GET", path: `${S}/brand-links` },
    normalize: unordered,
  },
  {
    // saveSellerSetup's parking slots (seller-setup.ts:340-344), error ignored
    name: "setup: slots → GET /sales/seller-setup/slots",
    prepare: async (sb: any) => keys(sb),
    legacy: async (sb: any, k: any) => {
      const { data: slotRows } = await sb
        .from("exp_territories")
        .select("id,group_key,tier,seller_id")
        .eq("group_key", k.group)
        .eq("tier", k.tier);
      return slotRows ?? [];
    },
    api: (k: any) => ({
      method: "GET",
      path: `${S}/slots?group_key=${encodeURIComponent(k.group)}&tier=${encodeURIComponent(k.tier)}`,
    }),
    normalize: unordered,
  },
  {
    // saveSellerSetup's quota ids (seller-setup.ts:366-371), error ignored
    name: "setup: quota ids → GET /sales/seller-setup/reps/{id}/quota-ids",
    prepare: async (sb: any) => {
      const rows = (await strict(
        sb
          .from("exp_sales_quotas")
          .select("rep_id,period_start")
          .eq("period_type", "quarter")
          .not("rep_id", "is", null)
          .order("period_start", { ascending: false })
          .order("rep_id")
          .limit(1),
      )) as any[];
      return rows.length
        ? { rep: rows[0].rep_id, year: Number(String(rows[0].period_start).slice(0, 4)) }
        : { rep: (await keys(sb)).rep, year: YEAR };
    },
    legacy: async (sb: any, k: any) => {
      const starts = ["01", "04", "07", "10"].map((m) => `${k.year}-${m}-01`);
      const { data: existingQ } = await sb
        .from("exp_sales_quotas")
        .select("id,period_start")
        .eq("rep_id", k.rep)
        .eq("period_type", "quarter")
        .in("period_start", starts);
      return existingQ ?? [];
    },
    api: (k: any) => ({ method: "GET", path: `${S}/reps/${k.rep}/quota-ids?year=${k.year}` }),
    normalize: unordered,
  },
];

export const cases: ParityCase[] = [...teamsLibCases, ...teamsRawCases, ...setupCases];
