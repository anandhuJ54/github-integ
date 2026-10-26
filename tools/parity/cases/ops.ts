/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as devNow from "@v3/ops/utils/dev-progress";
import * as weeklyNow from "@v3/ops/utils/dev-weekly";
import * as wikiNow from "@v3/ops/utils/build-wiki";
import { api } from "@v3/state/api/server-fn";

// Ops loaders: legacy (git, direct supabase-js) vs current (rows from /ops/*), end to end, as the
// signed-in user. Console panels were inline in console.tsx, so their queries are copied verbatim.
const DEV = "surface-ui/ops/src/lib/dev-progress.ts";
const WEEKLY = "surface-ui/ops/src/lib/dev-weekly.ts";
const WIKI = "surface-ui/ops/src/lib/build-wiki.ts";

// Rows with equal sort keys come back in any order: compare lists in one (stable) order.
const byId = (rows: any[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const sortLists = (o: any) =>
  o && typeof o === "object" && !Array.isArray(o)
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) && v[0]?.id ? byId(v) : v]))
    : o;

/** A team with members, a wiki space with docs, and one of its docs — read the legacy way. */
async function sample(supabase: any) {
  const { data: m } = await supabase.from("exp_dev_members").select("team_id").not("team_id", "is", null).limit(1);
  const { data: s } = await supabase.from("exp_wiki_docs").select("space_id, slug, id").not("space_id", "is", null).limit(1);
  const { data: sp } = await supabase.from("exp_wiki_spaces").select("key").eq("id", s?.[0]?.space_id).maybeSingle();
  return { teamId: m?.[0]?.team_id, spaceId: s?.[0]?.space_id, slug: s?.[0]?.slug, docId: s?.[0]?.id, spaceKey: sp?.key };
}

const legacyFn = (module: string, exportName: string, args: (ctx: any) => unknown[], current: (ctx: any) => Promise<unknown>, name: string, extra: Partial<ParityCase> = {}): ParityCase => ({
  name,
  prepare: sample,
  legacy: async (_sb, ctx) => {
    // run the git version of `module` with these args
    const run = (globalThis as any).__legacyModule as (p: string, d?: string[]) => Promise<any>;
    const mod = await run(module, extra.legacyDeps);
    return mod[exportName](...args(ctx));
  },
  current,
  ...extra,
});

const now = new Date();
const iso = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const d7 = iso(7), d14 = iso(14), d60 = iso(60);
const today = (() => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); })();

async function legacyCount(supabase: any, table: string, apply?: (q: any) => any) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (apply) q = apply(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export const cases: ParityCase[] = [
  legacyFn(DEV, "loadOverview", () => [], () => devNow.loadOverview(), "dev: overview", { normalize: sortLists }),
  legacyFn(DEV, "loadTeam", (c) => [c.teamId], (c) => devNow.loadTeam(c.teamId), "dev: team (with members)", { normalize: sortLists }),
  legacyFn(DEV, "loadOpenGates", () => [], () => devNow.loadOpenGates(), "dev: open gates (all teams)", { normalize: byId }),
  {
    // dev.board.tsx loadBoard(): sprints + items (the overview half is the case above)
    name: "dev: board sprints + items",
    legacy: async (supabase) => {
      const [sprintsRes, itemsRes] = await Promise.all([
        supabase.from("exp_dev_sprints").select("*").order("start_date"),
        supabase.from("exp_dev_sprint_items").select("*"),
      ]);
      return { sprints: sprintsRes.data ?? [], items: itemsRes.data ?? [] };
    },
    current: () => api.get("/ops/dev/board"),
    normalize: sortLists,
  },
  legacyFn(WEEKLY, "loadWeekly", () => ["2026-08-24"], () => weeklyNow.loadWeekly("2026-08-24"), "weekly: week of 2026-08-24 (5 updates)", { normalize: sortLists }),
  legacyFn(WEEKLY, "loadWeekly", () => [weeklyNow.weekStartIso()], () => weeklyNow.loadWeekly(), "weekly: this week", { normalize: sortLists }),
  legacyFn(WIKI, "listSpaces", () => [], () => wikiNow.listSpaces(), "wiki: spaces + page counts"),
  legacyFn(WIKI, "getSpace", (c) => [c.spaceKey], (c) => wikiNow.getSpace(c.spaceKey), "wiki: space by key"),
  legacyFn(WIKI, "getSpace", () => ["no-such-space-parity"], () => wikiNow.getSpace("no-such-space-parity"), "wiki: unknown space → null"),
  legacyFn(WIKI, "spaceTree", (c) => [c.spaceId], (c) => wikiNow.spaceTree(c.spaceId), "wiki: space tree", { normalize: (r: any) => ({ ...r, docs: byId(r.docs) }) }),
  legacyFn(WIKI, "getDoc", (c) => [c.spaceId, c.slug], (c) => wikiNow.getDoc(c.spaceId, c.slug), "wiki: doc"),
  legacyFn(WIKI, "docComments", (c) => [c.docId], (c) => wikiNow.docComments(c.docId), "wiki: comments"),
  legacyFn(WIKI, "docRevisions", (c) => [c.docId], (c) => wikiNow.docRevisions(c.docId), "wiki: revisions"),
  legacyFn(WIKI, "searchWiki", () => ["canon"], () => wikiNow.searchWiki("canon"), "wiki: search 'canon' (3 hits)", { normalize: byId }),
  legacyFn(WIKI, "searchWiki", () => ["ring"], () => wikiNow.searchWiki("ring"), "wiki: search 'ring' (1 hit)", { normalize: byId }),
  legacyFn(WIKI, "isWatching", (c) => [{ spaceId: c.spaceId }], (c) => wikiNow.isWatching({ spaceId: c.spaceId }), "wiki: watching a space"),
  {
    // console home moved (surface audit 2026-10-25): /ops/console/* → /admin/console/* (page now in surface-ui/admin)
    // console.tsx useProfiles(): the 14 counts
    name: "console: profile counts",
    legacy: async (sb) => {
      const keys = ["total", "new7", "prev7", "claimed", "claims7", "claimsPrev7", "claimsToday"];
      const f: ((q: any) => any)[] = [
        (q) => q,
        (q) => q.gte("created_at", d7),
        (q) => q.gte("created_at", d14).lt("created_at", d7),
        (q) => q.eq("claimed", true),
        (q) => q.gte("claimed_at", d7),
        (q) => q.gte("claimed_at", d14).lt("claimed_at", d7),
        (q) => q.gte("claimed_at", today),
      ];
      const out: Record<string, number> = {};
      for (const [prefix, table] of [["pros", "professionals"], ["orgs", "organizations"]]) {
        const counts = await Promise.all(f.map((fn) => legacyCount(sb, table, fn)));
        keys.forEach((k, i) => (out[`${prefix}_${k}`] = counts[i]));
      }
      return out;
    },
    api: { method: "GET", path: `/admin/console/profiles?d7=${encodeURIComponent(d7)}&d14=${encodeURIComponent(d14)}&today=${encodeURIComponent(today)}` },
  },
  {
    name: "console: revenue rows",
    legacy: async (sb) => (await sb.from("exp_contracts").select("id,status,mrr,end_date")).data ?? [],
    api: { method: "GET", path: "/admin/console/revenue" },
    normalize: byId,
  },
  {
    name: "console: category intel counts",
    legacy: async (sb) => ({
      active: await legacyCount(sb, "gbp_categories", (q) => q.eq("status", "active")),
      total: await legacyCount(sb, "gbp_categories"),
      etlRunning: await legacyCount(sb, "disco_jobs", (q) => q.in("status", ["queued", "awaiting_ai", "running"])),
      prosToday: await legacyCount(sb, "professionals", (q) => q.gte("created_at", today)),
      orgsToday: await legacyCount(sb, "organizations", (q) => q.gte("created_at", today)),
    }),
    api: { method: "GET", path: `/admin/console/categories?today=${encodeURIComponent(today)}` },
  },
  {
    name: "console: nora events (60 days)",
    legacy: async (sb) => (await sb.from("exp_activity_events").select("event_type,occurred_at").gte("occurred_at", d60)).data ?? [],
    api: { method: "GET", path: `/admin/console/nora-events?since=${encodeURIComponent(d60)}` },
    normalize: (rows: any[]) => [...rows].sort((a, b) => `${a.occurred_at}${a.event_type}`.localeCompare(`${b.occurred_at}${b.event_type}`)),
  },
];
