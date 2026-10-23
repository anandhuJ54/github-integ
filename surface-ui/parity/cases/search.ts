/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as now from "@v3/search/lib/search-console";

// Search control plane loaders: legacy (git, direct supabase-js) vs current (rows from
// /search/console/*), end to end, as the signed-in user. Reads only: the indexing / sponsored /
// ads buttons write (and three are gated indexing actions), so they are never run here.
const SC = "surface-ui/search/src/lib/search-console.ts";

const fn = (exportName: string, current: () => Promise<unknown>, name: string, extra: Partial<ParityCase> = {}): ParityCase => ({
  name,
  legacyModule: SC,
  legacyExport: exportName,
  current,
  ...extra,
});

// rows with equal sort keys come back in any order: compare lists in one order
const byId = (rows: any[]) => [...rows].sort((a, b) => String(a.id ?? a.key ?? a.gcid).localeCompare(String(b.id ?? b.key ?? b.gcid)));
const sortListsDeep = (o: any): any => {
  if (Array.isArray(o)) return o.length && typeof o[0] === "object" && o[0] && ("id" in o[0] || "key" in o[0]) ? byId(o).map(sortListsDeep) : o.map(sortListsDeep);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sortListsDeep(v)]));
  return o;
};

export const cases: ParityCase[] = [
  fn("loadCategoryLabels", () => now.loadCategoryLabels(), "category labels (Map; 1000-row cap on both)"),
  fn("loadLaunchedCategories", () => now.loadLaunchedCategories(), "launched categories"),
  fn("loadSearchOverview", () => now.loadSearchOverview(), "overview: rollup, totals, volume", { normalize: sortListsDeep }),
  fn("loadIndexing", () => now.loadIndexing(), "indexing: agents, queue, partitions, log, config, coverage", { normalize: sortListsDeep }),
  fn("loadSponsored", () => now.loadSponsored(), "sponsored: pricing, slots, groups, stats", { normalize: sortListsDeep }),
  fn("loadSearchAds", () => now.loadSearchAds(), "ads: list + stats", { normalize: sortListsDeep }),
];
