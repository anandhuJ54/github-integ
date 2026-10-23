// Local templates ({city}/{state}/{zip} placeholders): aggregate measured demand of city-specific variants
// ("realtors austin", "realtor in dallas tx") per template pattern. Pure.
import { NEAR, orderedPairs, orderedTokens } from "./normalize";
import type { TemplateDemand } from "./types";

interface Compiled {
  template: string;
  toks: string[];
  slots: number;
  literals: number;
}

function compile(template: string): Compiled | null {
  const toks = orderedTokens(template);
  const slots = toks.filter((t) => t.startsWith("{")).length;
  return slots ? { template, toks, slots, literals: toks.length - slots } : null;
}

/** Match template tokens against variant tokens; each slot takes 1+ tokens. Returns captured raw words per slot. */
function match(tpl: string[], toks: Array<{ tok: string; raw: string }>, ti = 0, vi = 0): string[][] | null {
  if (ti === tpl.length) return vi === toks.length ? [] : null;
  const t = tpl[ti];
  if (!t.startsWith("{")) {
    return vi < toks.length && toks[vi].tok === t ? match(tpl, toks, ti + 1, vi + 1) : null;
  }
  for (let end = vi + 1; end <= toks.length; end++) {
    const cap = toks.slice(vi, end);
    if (cap.some((c) => c.tok === NEAR)) break; // "near me" is not a place
    const rest = match(tpl, toks, ti + 1, end);
    if (rest) return [cap.map((c) => c.raw), ...rest];
  }
  return null;
}

/**
 * Assign every variant to the single most specific matching template (most slots, then most literal tokens)
 * and sum measured volume per template. Variants that normalise to the same text ("realtors austin" /
 * "realtor in austin") count once, at their larger volume. Null volumes are counted separately, never as zero.
 * Variants that match no template are returned in `unmatched`.
 */
export function aggregateTemplates(
  templates: string[],
  variants: Array<{ term: string; volume: number | null }>,
): { templates: TemplateDemand[]; unmatched: Array<{ term: string; volume: number | null }> } {
  const comps = templates.map(compile).filter((c): c is Compiled => c !== null);
  const byTemplate = new Map<string, TemplateDemand>(
    comps.map((c) => [c.template, { template: c.template, total_volume: 0, measured_count: 0, null_count: 0, variants: [] }]),
  );
  const unmatched: Array<{ term: string; volume: number | null }> = [];
  const placed = new Map<string, { agg: TemplateDemand; v: TemplateDemand["variants"][number] }>();

  for (const v of [...variants].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))) {
    const pairs = orderedPairs(v.term);
    const text = pairs.map((p) => p.tok).join(" ");
    let best: { c: Compiled; caps: string[][] } | null = null;
    for (const c of comps) {
      const caps = match(c.toks, pairs);
      if (!caps) continue;
      if (!best || c.slots > best.c.slots || (c.slots === best.c.slots && c.literals > best.c.literals)) best = { c, caps };
    }
    if (!best) {
      unmatched.push(v);
      continue;
    }
    const agg = byTemplate.get(best.c.template)!;
    const slots: Record<string, string> = {};
    best.c.toks.filter((t) => t.startsWith("{")).forEach((t, i) => (slots[t.slice(1, -1)] = best!.caps[i].join(" ")));
    const k = `${best.c.template}|${text}`;
    const prev = placed.get(k);
    if (prev) {
      if (v.volume !== null && (prev.v.volume === null || v.volume > prev.v.volume)) {
        if (prev.v.volume === null) {
          agg.null_count--;
          agg.measured_count++;
        }
        agg.total_volume += v.volume - (prev.v.volume ?? 0);
        prev.v.volume = v.volume;
        prev.v.term = v.term;
      }
      continue;
    }
    const entry = { term: v.term, volume: v.volume, slots };
    agg.variants.push(entry);
    placed.set(k, { agg, v: entry });
    if (v.volume === null) agg.null_count++;
    else {
      agg.measured_count++;
      agg.total_volume += v.volume;
    }
  }
  return {
    templates: [...byTemplate.values()].sort((a, b) => b.total_volume - a.total_volume || (a.template < b.template ? -1 : 1)),
    unmatched,
  };
}
