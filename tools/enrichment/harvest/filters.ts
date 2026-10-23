// DataForSEO allows at most 8 filter conditions per request. The ranked_keywords filter is
// 1 volume condition + an OR-group of pattern conditions, so patterns are split into groups of 6
// (6 + 1 = 7 conditions, one spare) and the per-group results are merged by the caller.
export const MAX_FILTER_CONDITIONS = 8;
export const PATTERN_GROUP_SIZE = 6;

export type FilterNode = string | number | FilterNode[];

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function splitPatterns(patterns: string[], size = PATTERN_GROUP_SIZE): string[][] {
  const clean = [...new Set(patterns.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  return chunk(clean, Math.max(1, Math.min(size, PATTERN_GROUP_SIZE)));
}

// Count leaf conditions ([field, operator, value] triples); 'and'/'or' strings are connectors.
export function countConditions(filter: FilterNode): number {
  if (!Array.isArray(filter)) return 0;
  const isCondition =
    filter.length === 3 && typeof filter[0] === "string" && typeof filter[1] === "string" && !Array.isArray(filter[2]);
  if (isCondition) return 1;
  return filter.reduce<number>((n, f) => n + countConditions(f), 0);
}

export function rankedFilter(minVolume: number, group: string[]): FilterNode {
  const volume: FilterNode = ["keyword_data.keyword_info.search_volume", ">=", minVolume];
  if (!group.length) return volume;
  const or: FilterNode[] = [];
  group.forEach((p, i) => {
    if (i > 0) or.push("or");
    or.push(["keyword_data.keyword", "like", `%${p}%`]);
  });
  return [volume, "and", or];
}
