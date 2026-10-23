// Scorecard over a SelectionResult. Pure.
import type { Band, CanonicalBasis, Scorecard, SelectionResult } from "./types";

export function scorecard(r: SelectionResult): Scorecard {
  const outcomes: Record<string, number> = {};
  for (const o of r.outcomes) outcomes[o.outcome] = (outcomes[o.outcome] ?? 0) + 1;
  if (r.adds.length) outcomes.ADD = r.adds.length;

  const wording: Record<CanonicalBasis, number> = { existing: 0, autocomplete: 0, shortest: 0 };
  const bands: Record<Band, number> = { High: 0, Medium: 0, Low: 0, Unknown: 0 };
  const families: Record<string, number> = {};
  let tierA = 0;
  let tierB = 0;
  let local = 0;
  let pack = 0;
  let info = 0;
  const infoSet = new Set(r.config.informationalIntents.map((s) => s.toLowerCase()));
  for (const s of r.selected) {
    if (s.tier === "A") tierA++;
    else tierB++;
    wording[s.canonical_basis]++;
    bands[s.band]++;
    const f = s.family || "(none)";
    families[f] = (families[f] ?? 0) + 1;
    if (s.local_intent) local++;
    if (s.local_pack) pack++;
    if (s.intent && infoSet.has(s.intent.toLowerCase())) info++;
  }
  const n = r.selected.length;
  const share = (x: number) => (n ? Math.round((x / n) * 1000) / 1000 : 0);
  return {
    selected: n,
    requested: r.config.n,
    short_by: r.short_by,
    outcomes,
    tier_a: tierA,
    tier_b: tierB,
    measured_share: share(tierA),
    wording_mix: wording,
    families,
    family_count: Object.keys(families).filter((f) => f !== "(none)").length,
    head_family: r.head_family,
    local_intent_share: share(local),
    local_pack_count: pack,
    informational_count: info,
    bands,
    templates: r.templates.length,
  };
}
