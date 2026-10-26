/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as now from "@v3/admin/utils/search-console";

// Moved to admin (surface audit 2026-10-25): the loaders now read /admin/search-console/*.

// Search control plane loaders: legacy (git, direct supabase-js) vs current (rows from
// /admin/search-console/*), end to end, as the signed-in user. Reads only: the indexing / sponsored /
// ads buttons write (and three are gated indexing actions), so they are never run here.
const SC = "surface-ui/search/src/lib/search-console.ts"; // legacy path at the parity ref

const fn = (exportName: string, current: () => Promise<unknown>, name: string, extra: Partial<ParityCase> = {}): ParityCase => ({
  name,
  legacyModule: SC,
  legacyExport: exportName,
  current,
  ...extra,
});

// Rows with equal sort keys come back in any order: compare row lists in one order. Only lists
// where every element is a row with an id/key are sorted; positional arrays (e.g. a slot group's
// `positions`, where the index is the position and empty spots are null) keep their order.
const keyOf = (r: any) => String(r.id ?? r.key ?? r.gcid);
const isRowList = (o: any[]) =>
  o.length > 0 && o.every((r) => r && typeof r === "object" && !Array.isArray(r) && ("id" in r || "key" in r));
const sortListsDeep = (o: any): any => {
  if (Array.isArray(o)) {
    const items = o.map(sortListsDeep);
    return isRowList(o) ? items.sort((a, b) => keyOf(a).localeCompare(keyOf(b))) : items;
  }
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
