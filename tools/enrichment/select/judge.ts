// Judge interface. The real judge (brands, ambiguity, families, lane routing) is another component;
// this library only consumes its output. `stubJudge` exists for tests and dry runs.
import type { JudgeLookup, JudgeResult } from "./types";

export const termKey = (t: string): string => t.toLowerCase().trim().replace(/\s+/g, " ");

export function judgeLookup(j: JudgeResult[] | JudgeLookup): JudgeLookup {
  if (typeof j === "function") return j;
  const m = new Map<string, JudgeResult>();
  for (const r of j) m.set(termKey(r.term), r);
  return (term) => m.get(termKey(term));
}

/**
 * Trivial stand-in judge: terms listed in `table` take their (partial) result; every other term is
 * `keep` with family = its first word (or has no result when opts.unlisted = "none"). Test/dry-run use only — it decides nothing about brands.
 */
export function stubJudge(
  table: Record<string, Partial<JudgeResult>> = {},
  opts: { unlistedFamily?: (term: string) => string; unlisted?: "keep" | "none" } = {},
): JudgeLookup {
  const t = new Map(Object.entries(table).map(([k, v]) => [termKey(k), v]));
  const fam = opts.unlistedFamily ?? ((term: string) => termKey(term).split(" ")[0] ?? "");
  return (term) => {
    const hit = t.get(termKey(term));
    if (opts.unlisted === "none" && !hit) return undefined;
    return {
      term,
      decision: "keep",
      reason_code: "ok",
      family: fam(term),
      ...hit,
    } as JudgeResult;
  };
}
