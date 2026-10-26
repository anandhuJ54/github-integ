// Keyword-lane selection engine. PURE: same input -> same output, no I/O, no clock, no randomness.
//
//   candidates + existing rows + intents + map-pack flags + judge output
//     -> groups (dedupe key) -> canonical wording -> eligibility (judge) -> tiers (A measured / B hidden)
//     -> ranked selection (family caps, informational cap, Google-cluster collapse) -> bands + tags
//     -> one outcome per existing row, ADD records for new terms.
import { termKey, judgeLookup } from "./judge";
import {
  cleanWording,
  hasPlaceholder,
  jaccard,
  normalizeKey,
  NEAR,
  placeholdersOf,
  tokenSet,
} from "./normalize";
import { DEFAULT_TAGS, detectTags, hasLocalIntent } from "./tags";
import type {
  AddRecord,
  Band,
  CanonicalBasis,
  Candidate,
  ClusterMember,
  Evidence,
  ExistingRow,
  JudgeResult,
  OutcomeKind,
  RowOutcome,
  SelectConfig,
  SelectedKeyword,
  SelectInput,
  SelectionResult,
  Tier,
} from "./types";

export const DEFAULT_CONFIG: SelectConfig = {
  n: 50,
  floor: 300,
  tierBCap: 12,
  tierBMaxPosition: 4,
  tierBCorroboratedMaxPosition: 4,
  familyCap: 5,
  headFamilyCap: 8,
  informationalCap: 5,
  informationalIntents: ["informational", "question"],
  canonicalExistingRatio: 0.9,
  bandHigh: 0.15,
  bandMedium: 0.35,
  clusterJaccard: 0.34,
  clusterFamilyMinSharedTokens: 1,
  unjudgedCandidates: "skip",
  tags: DEFAULT_TAGS,
  pluralModifierHeads: [
    "store", "shop", "service", "delivery", "dispensary", "clinic", "center", "office",
    "company", "agency", "restaurant", "place", "spot", "location",
  ],
  moveLaneByReason: { informational: "guide", guide: "guide" },
  keywordLevel: "keyword",
};

export function resolveConfig(c: Partial<SelectConfig> = {}): SelectConfig {
  const out = { ...DEFAULT_CONFIG } as SelectConfig;
  for (const [k, v] of Object.entries(c)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  if (c.tierBCorroboratedMaxPosition === undefined) out.tierBCorroboratedMaxPosition = out.tierBMaxPosition;
  return out;
}

// ---------------------------------------------------------------------------------------------
// canonical wording (pure, exported for tests)
// ---------------------------------------------------------------------------------------------

export interface WordingVariant {
  /** Already passed through cleanWording. */
  text: string;
  volume: number | null;
  has_existing: boolean;
  ac_confirmed: boolean;
  ac_position: number | null;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const volDesc = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);

/**
 * Pick the canonical wording of a group.
 *   1. an existing row's wording when its volume >= ratio * best variant volume
 *   2. else the variant confirmed by autocomplete
 *   3. else the shortest
 * Rules 2-3 draw from variants within ratio of the best measured volume (all variants when none is measured).
 */
export function chooseCanonical(
  variants: WordingVariant[],
  ratio = DEFAULT_CONFIG.canonicalExistingRatio,
): { term: string; basis: CanonicalBasis } {
  if (!variants.length) throw new Error("chooseCanonical: no variants");
  const measured = variants.map((v) => v.volume).filter((v): v is number => v !== null);
  const best = measured.length ? Math.max(...measured) : null;
  const pool = variants.filter((v) => best === null || (v.volume !== null && v.volume >= ratio * best));
  const byVolThenShortThenAlpha = (a: WordingVariant, b: WordingVariant) =>
    volDesc(a.volume, b.volume) || a.text.length - b.text.length || cmpStr(a.text, b.text);

  const ex = pool.filter((v) => v.has_existing).sort(byVolThenShortThenAlpha);
  if (ex.length) return { term: ex[0].text, basis: "existing" };

  const ac = pool
    .filter((v) => v.ac_confirmed)
    .sort(
      (a, b) =>
        volDesc(a.volume, b.volume) ||
        (a.ac_position ?? 99) - (b.ac_position ?? 99) ||
        a.text.length - b.text.length ||
        cmpStr(a.text, b.text),
    );
  if (ac.length) return { term: ac[0].text, basis: "autocomplete" };

  const sh = [...pool].sort(
    (a, b) => a.text.length - b.text.length || volDesc(a.volume, b.volume) || cmpStr(a.text, b.text),
  );
  return { term: sh[0].text, basis: "shortest" };
}

// ---------------------------------------------------------------------------------------------
// internal group model
// ---------------------------------------------------------------------------------------------

interface VariantAcc {
  text: string;
  raws: Set<string>;
  fresh: number | null;
  freshSource: string | null;
  freshAsOf: string | null;
  sources: Set<string>;
  domains: Set<string>;
  ac: number[];
  acConfirmed: boolean;
  rows: ExistingRow[];
}

interface Group {
  key: string;
  tokens: string[];
  variants: Map<string, VariantAcc>;
  rows: ExistingRow[];
  canonical: string;
  basis: CanonicalBasis;
  volume: number | null;
  volumeOrigin: "candidates" | "existing" | "none";
  volumeSource: string | null;
  volumeAsOf: string | null;
  sources: string[];
  domains: string[];
  acBest: number | null;
  judge: JudgeResult | null;
  judgeConflict: boolean;
  family: string;
  intent: string | null;
  localPack: boolean;
  tags: string[];
  localIntent: boolean;
  informational: boolean;
  eligible: boolean;
  tier: Tier | null;
  primary: ExistingRow | null;
  activeRows: ExistingRow[];
  // outcome of the selection pass
  selected: boolean;
  rank: number;
  band: Band;
  collapsedInto: Group | null;
  cluster: ClusterMember[];
  leftOut: string;
}

const lcMap = <T>(m?: Record<string, T>): Map<string, T> => {
  const out = new Map<string, T>();
  for (const [k, v] of Object.entries(m ?? {})) out.set(termKey(k), v);
  return out;
};

const maxNum = (xs: Array<number | null | undefined>): number | null => {
  const m = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return m.length ? Math.max(...m) : null;
};

const candCmp = (a: Candidate, b: Candidate) =>
  cmpStr(termKey(a.term), termKey(b.term)) ||
  cmpStr(a.source, b.source) ||
  cmpStr(a.domain ?? "", b.domain ?? "") ||
  (a.position ?? -1) - (b.position ?? -1) ||
  volDesc(a.volume, b.volume);

// ---------------------------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------------------------

export function selectKeywordLane(input: SelectInput): SelectionResult {
  const cfg = resolveConfig(input.config);
  const judge = judgeLookup(input.judge);
  const intents = lcMap(input.intents);
  const packs = lcMap(input.local_pack);
  const warnings: string[] = [];
  const heads = cfg.pluralModifierHeads;
  const clean = (t: string) => cleanWording(t, heads);

  const existing = [...input.existing].sort((a, b) => cmpStr(a.id, b.id));
  const candidates = [...input.candidates].sort(candCmp);

  const groups = new Map<string, Group>();
  const templateRows: ExistingRow[] = [];
  const unjudged = new Set<string>();

  const groupFor = (raw: string): { g: Group; v: VariantAcc } => {
    const key = normalizeKey(raw);
    let g = groups.get(key);
    if (!g) {
      g = {
        key, tokens: tokenSet(raw), variants: new Map(), rows: [], canonical: "", basis: "shortest",
        volume: null, volumeOrigin: "none", volumeSource: null, volumeAsOf: null, sources: [], domains: [],
        acBest: null, judge: null, judgeConflict: false, family: "", intent: null, localPack: false, tags: [],
        localIntent: false, informational: false, eligible: false, tier: null, primary: null, activeRows: [],
        selected: false, rank: 0, band: "Unknown", collapsedInto: null, cluster: [], leftOut: "",
      };
      groups.set(key, g);
    }
    const text = clean(raw);
    let v = g.variants.get(text);
    if (!v) {
      v = {
        text, raws: new Set(), fresh: null, freshSource: null, freshAsOf: null, sources: new Set(),
        domains: new Set(), ac: [], acConfirmed: false, rows: [],
      };
      g.variants.set(text, v);
    }
    v.raws.add(raw);
    return { g, v };
  };

  for (const row of existing) {
    if (hasPlaceholder(row.term)) {
      templateRows.push(row);
      continue;
    }
    const { g, v } = groupFor(row.term);
    g.rows.push(row);
    v.rows.push(row);
  }

  for (const c of candidates) {
    if (!c.term || !c.term.trim()) continue;
    if (hasPlaceholder(c.term)) {
      warnings.push(`candidate with placeholder ignored: ${c.term}`);
      continue;
    }
    const { g, v } = groupFor(c.term);
    void g;
    v.sources.add(c.source);
    if (c.domain) v.domains.add(c.domain);
    if (c.source === "autocomplete") {
      v.acConfirmed = true;
      if (typeof c.position === "number") v.ac.push(c.position);
    }
    if (typeof c.volume === "number" && Number.isFinite(c.volume) && (v.fresh === null || c.volume > v.fresh)) {
      v.fresh = c.volume;
      v.freshSource = c.source;
      v.freshAsOf = c.volume_as_of ?? cfg.volumeAsOf ?? null;
    }
  }

  // ---- per-group derivation --------------------------------------------------------------
  for (const g of [...groups.values()].sort((a, b) => cmpStr(a.key, b.key))) {
    const vs = [...g.variants.values()];
    const fresh = maxNum(vs.map((v) => v.fresh));
    const stored = maxNum(g.rows.map((r) => r.search_volume_monthly));
    const storedOf = (v: VariantAcc) => maxNum(v.rows.map((r) => r.search_volume_monthly));

    const wv: WordingVariant[] = vs.map((v) => ({
      text: v.text,
      volume: v.fresh ?? storedOf(v),
      has_existing: v.rows.length > 0,
      ac_confirmed: v.acConfirmed,
      ac_position: v.ac.length ? Math.min(...v.ac) : null,
    }));
    const ch = chooseCanonical(wv, cfg.canonicalExistingRatio);
    g.canonical = ch.term;
    g.basis = ch.basis;

    if (fresh !== null) {
      g.volume = fresh;
      g.volumeOrigin = "candidates";
      const top = vs.filter((v) => v.fresh === fresh).sort((a, b) => cmpStr(a.text, b.text))[0];
      g.volumeSource = top.freshSource;
      g.volumeAsOf = top.freshAsOf;
    } else if (stored !== null) {
      g.volume = stored;
      g.volumeOrigin = "existing";
      const top = g.rows.filter((r) => r.search_volume_monthly === stored)[0];
      g.volumeSource = (top?.volume_source as string | null | undefined) ?? "existing";
      g.volumeAsOf = (top?.volume_as_of as string | null | undefined) ?? null;
    }

    g.sources = [...new Set(vs.flatMap((v) => [...v.sources]))].sort();
    g.domains = [...new Set(vs.flatMap((v) => [...v.domains]))].sort();
    const acAll = vs.flatMap((v) => v.ac);
    g.acBest = acAll.length ? Math.min(...acAll) : null;

    // judge: canonical wording first, then variants by volume
    const order = [
      g.canonical,
      ...[...vs].sort((a, b) => volDesc(a.fresh ?? storedOf(a), b.fresh ?? storedOf(b)) || cmpStr(a.text, b.text)).flatMap((v) => [v.text, ...[...v.raws].sort()]),
    ];
    const hits: JudgeResult[] = [];
    for (const t of order) {
      const r = judge(t);
      if (r && !hits.includes(r)) hits.push(r);
    }
    g.judge = hits[0] ?? null;
    g.judgeConflict = hits.some((h) => h.decision !== hits[0].decision);
    if (g.judgeConflict) warnings.push(`judge disagrees across variants of "${g.canonical}"; using the verdict for "${hits[0].term}"`);
    if (g.judge?.decision === "exclude" && !g.judge.reason_code) {
      warnings.push(`judge excluded "${g.canonical}" without a reason_code; objection ignored`);
      g.judge = null;
    }
    g.family = g.judge?.decision === "keep" ? (g.judge.family ?? "") : "";

    const pick = <T>(m: Map<string, T>): T | undefined => {
      for (const t of order) {
        const x = m.get(termKey(t));
        if (x !== undefined) return x;
      }
      return undefined;
    };
    g.intent = pick(intents) ?? null;
    const packVals = order.map((t) => packs.get(termKey(t))).filter((x): x is boolean => x !== undefined);
    g.localPack = packVals.some(Boolean);
    g.tags = detectTags(g.canonical, cfg.tags);
    g.localIntent = hasLocalIntent(g.canonical);
    const infoSet = new Set(cfg.informationalIntents.map((s) => s.toLowerCase()));
    g.informational = g.intent !== null && infoSet.has(g.intent.toLowerCase());

    if (g.judge?.decision === "exclude" && g.localPack && g.judge.reason_code === "portal_owned") {
      warnings.push(`"${g.canonical}" is in the map pack but the judge says portal_owned; judge verdict stands`);
    }

    const hasCandidate = vs.some((v) => v.sources.size > 0);
    if (g.judge === null && g.rows.length === 0 && hasCandidate && cfg.unjudgedCandidates === "skip") {
      for (const v of vs) for (const r of v.raws) unjudged.add(r);
      g.eligible = false;
    } else {
      g.eligible = g.judge?.decision !== "exclude";
    }

    // tier
    if (g.eligible) {
      if (g.volume !== null && g.volume >= cfg.floor) g.tier = "A";
      else if (
        g.volume === null &&
        g.acBest !== null &&
        (g.acBest <= cfg.tierBMaxPosition || (g.acBest <= cfg.tierBCorroboratedMaxPosition && g.sources.length >= 2))
      ) g.tier = "B";
    }
  }

  // ---- row-level judge ---------------------------------------------------------------------
  const rowVerdict = (row: ExistingRow, g: Group | null): JudgeResult | null => {
    const r = judge(row.term) ?? judge(clean(row.term)) ?? g?.judge ?? null;
    if (r && r.decision === "exclude") {
      if (!r.reason_code) {
        warnings.push(`judge excluded row "${row.term}" without a reason_code; objection ignored`);
        return null;
      }
      return r;
    }
    return null;
  };

  for (const g of groups.values()) {
    const live = g.rows.filter((r) => rowVerdict(r, g) === null);
    g.activeRows = live;
    if (live.length) {
      const canon = g.canonical.toLowerCase();
      g.primary = [...live].sort(
        (a, b) =>
          Number(clean(b.term) === canon) - Number(clean(a.term) === canon) ||
          volDesc(a.search_volume_monthly ?? null, b.search_volume_monthly ?? null) ||
          a.term.length - b.term.length ||
          cmpStr(a.id, b.id),
      )[0];
    }
  }

  // ---- selection -----------------------------------------------------------------------------
  const skipped = { below_floor: 0, family_cap: 0, informational_cap: 0, tier_b_cap: 0, no_evidence: 0, clustered: 0 };
  const eligible = [...groups.values()].filter((g) => g.eligible);
  const hasRow = (g: Group) => (g.primary ? 1 : 0);
  const tierA = eligible
    .filter((g) => g.tier === "A")
    .sort(
      (a, b) =>
        volDesc(a.volume, b.volume) ||
        hasRow(b) - hasRow(a) ||
        a.tokens.length - b.tokens.length ||
        a.canonical.length - b.canonical.length ||
        cmpStr(a.canonical, b.canonical),
    );
  const tierB = eligible
    .filter((g) => g.tier === "B")
    .sort(
      (a, b) =>
        (a.acBest ?? 99) - (b.acBest ?? 99) ||
        b.sources.length - a.sources.length ||
        hasRow(b) - hasRow(a) ||
        cmpStr(a.canonical, b.canonical),
    );

  const headFamily =
    cfg.headFamily ??
    ([...tierA, ...tierB].find((g) => g.family)?.family || null);
  const sameFam = (a: string, b: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const capFor = (fam: string) => (headFamily && sameFam(fam, headFamily) ? cfg.headFamilyCap : cfg.familyCap);

  const selA: Group[] = [];
  const selB: Group[] = [];
  const famCount = new Map<string, number>();
  let infoCount = 0;
  const total = () => selA.length + selB.length;

  const clusterRep = (g: Group): Group | null => {
    if (g.volume === null) return null;
    for (const r of selA) {
      if (r.volume !== g.volume) continue;
      const j = jaccard(g.tokens, r.tokens);
      if (j >= cfg.clusterJaccard) return r;
      if (sameFam(g.family, r.family)) {
        const rs = new Set(r.tokens);
        const shared = g.tokens.filter((t) => t !== NEAR && rs.has(t)).length;
        if (shared >= cfg.clusterFamilyMinSharedTokens) return r;
      }
    }
    return null;
  };
  const collapse = (g: Group, rep: Group) => {
    g.collapsedInto = rep;
    rep.cluster.push({ term: g.canonical, key: g.key, volume: g.volume, row_ids: g.activeRows.map((r) => r.id) });
    skipped.clustered++;
  };

  const trySelect = (g: Group, tier: Tier): boolean => {
    if (tier === "A") {
      const rep = clusterRep(g);
      if (rep) {
        collapse(g, rep);
        return false;
      }
    }
    if (g.informational && infoCount >= cfg.informationalCap) {
      g.leftOut = "informational_cap";
      skipped.informational_cap++;
      return false;
    }
    if (g.family && (famCount.get(g.family.toLowerCase()) ?? 0) >= capFor(g.family)) {
      g.leftOut = "family_cap";
      skipped.family_cap++;
      return false;
    }
    g.selected = true;
    if (g.informational) infoCount++;
    if (g.family) famCount.set(g.family.toLowerCase(), (famCount.get(g.family.toLowerCase()) ?? 0) + 1);
    (tier === "A" ? selA : selB).push(g);
    return true;
  };

  const bReserve = Math.min(cfg.tierBCap, tierB.length);
  let ai = 0;
  while (ai < tierA.length && total() < cfg.n - bReserve) trySelect(tierA[ai++], "A");
  for (const g of tierB) {
    if (selB.length >= cfg.tierBCap) {
      g.leftOut = "tier_b_cap";
      skipped.tier_b_cap++;
      continue;
    }
    if (total() >= cfg.n) {
      g.leftOut = "beyond_n";
      continue;
    }
    trySelect(g, "B");
  }
  while (ai < tierA.length && total() < cfg.n) trySelect(tierA[ai++], "A");
  // sweep: everything not yet considered still collapses into an identical-volume cluster
  for (; ai < tierA.length; ai++) {
    const g = tierA[ai];
    const rep = clusterRep(g);
    if (rep) collapse(g, rep);
    else g.leftOut = "beyond_n";
  }
  for (const g of eligible) {
    if (g.selected || g.collapsedInto || g.leftOut) continue;
    if (g.volume !== null && g.volume < cfg.floor) {
      g.leftOut = "below_floor";
      skipped.below_floor++;
    } else if (g.volume === null) {
      g.leftOut = "no_evidence";
      skipped.no_evidence++;
    }
  }

  // ---- bands, ranks ----------------------------------------------------------------------------
  const vols = selA.map((g) => g.volume as number).sort((a, b) => b - a);
  const m = vols.length;
  const eps = 1e-9;
  const highN = Math.ceil(m * cfg.bandHigh - eps);
  const medEnd = Math.ceil(m * (cfg.bandHigh + cfg.bandMedium) - eps);
  const vHigh = highN > 0 ? vols[highN - 1] : Infinity;
  const vMed = medEnd > 0 ? vols[medEnd - 1] : Infinity;
  const ordered = [...selA, ...selB];
  ordered.forEach((g, i) => {
    g.rank = i + 1;
    g.band = g.tier === "B" ? "Unknown" : (g.volume as number) >= vHigh ? "High" : (g.volume as number) >= vMed ? "Medium" : "Low";
  });

  // ---- evidence / records ---------------------------------------------------------------------
  const evidenceFor = (g: Group): Evidence => {
    const variants = [...g.variants.values()]
      .map((v) => ({ term: v.text, volume: v.fresh ?? maxNum(v.rows.map((r) => r.search_volume_monthly)) }))
      .sort((a, b) => volDesc(a.volume, b.volume) || cmpStr(a.term, b.term))
      .slice(0, 12);
    const ev: Evidence = {
      sources: g.sources,
      domains: g.domains,
      volume: g.volume,
      volume_origin: g.volumeOrigin,
      volume_source: g.volumeSource,
      volume_as_of: g.volumeAsOf,
      variants,
      ac_best_position: g.acBest,
      family: g.family || null,
      judge: g.judge ? { decision: g.judge.decision, reason_code: g.judge.reason_code } : null,
      judge_conflict: g.judgeConflict,
      intent: g.intent,
      local_pack: g.localPack,
      local_intent: g.localIntent,
      tags: g.tags,
      canonical_basis: g.basis,
    };
    if (g.tier) {
      ev.tier = g.tier;
      ev.hidden_volume = g.tier === "B";
    }
    if (g.selected) {
      ev.band = g.band;
      ev.rank = g.rank;
    }
    if (g.cluster.length) ev.cluster = g.cluster;
    return ev;
  };

  const sourceOf = (g: Group): string =>
    g.volumeSource && g.volumeOrigin === "candidates"
      ? g.volumeSource
      : g.sources.includes("autocomplete")
        ? "autocomplete"
        : (g.sources[0] ?? "existing");

  const selected: SelectedKeyword[] = ordered.map((g) => ({
    rank: g.rank,
    term: g.canonical,
    key: g.key,
    tier: g.tier as Tier,
    volume: g.volume,
    hidden_volume: g.tier === "B",
    band: g.band,
    family: g.family,
    intent: g.intent,
    tags: g.tags,
    local_intent: g.localIntent,
    local_pack: g.localPack,
    source: sourceOf(g),
    volume_source: g.volumeOrigin === "none" ? null : g.volumeSource,
    volume_as_of: g.volumeAsOf,
    row_id: g.primary?.id ?? null,
    cluster: g.cluster,
    canonical_basis: g.basis,
    evidence: evidenceFor(g),
  }));

  const adds: AddRecord[] = ordered
    .filter((g) => !g.primary)
    .map((g) => ({
      op: "ADD" as const,
      rank: g.rank,
      term: g.canonical,
      source: sourceOf(g),
      volume: g.volume,
      volume_as_of: g.volumeAsOf,
      volume_source: g.volumeOrigin === "none" ? null : g.volumeSource,
      intent: g.intent,
      band: g.band,
      tags: g.tags,
      local_intent: g.localIntent,
      local_pack: g.localPack,
      family: g.family,
      tier: g.tier as Tier,
      hidden_volume: g.tier === "B",
      concept_slug: g.judge?.concept_slug ?? null,
      evidence: evidenceFor(g),
    }));

  // ---- one outcome per existing row ------------------------------------------------------------
  const outcomes: RowOutcome[] = [];
  const fmt = (n: number | null) => (n === null ? "no volume" : n.toLocaleString("en-US"));
  const push = (row: ExistingRow, outcome: OutcomeKind, reason: string, g: Group | null, extra: Partial<RowOutcome> = {}) =>
    outcomes.push({
      id: row.id,
      term: row.term,
      outcome,
      reason,
      evidence: g ? evidenceFor(g) : null,
      ...(g && g.canonical ? { canonical: g.canonical } : {}),
      ...extra,
    });

  const judged = (row: ExistingRow, g: Group | null, r: JudgeResult) => {
    const lane = r.to_lane ?? cfg.moveLaneByReason[r.reason_code];
    if (lane) push(row, "MOVE", `judge: belongs in lane '${lane}' (${r.reason_code})`, g, { to_lane: lane, reason_code: r.reason_code });
    else push(row, "RETIRE", `judge excluded: ${r.reason_code}`, g, { reason_code: r.reason_code });
  };

  for (const row of templateRows) {
    const r = rowVerdict(row, null);
    if (r) {
      judged(row, null, r);
      continue;
    }
    push(row, "KEEP_TEMPLATE", `typed template (${placeholdersOf(row.term).join(" ")}); kept outside the top ${cfg.n}`, null);
  }

  for (const g of [...groups.values()].sort((a, b) => cmpStr(a.key, b.key))) {
    for (const row of g.rows) {
      const r = rowVerdict(row, g);
      if (r) {
        judged(row, g, r);
        continue;
      }
      const primary = g.primary as ExistingRow;
      if (g.selected) {
        if (row.id === primary.id) {
          push(row, "KEEP_TOP", `rank ${g.rank}/${cfg.n}; tier ${g.tier}${g.tier === "B" ? " (hidden volume, autocomplete position " + g.acBest + ")" : ", volume " + fmt(g.volume)}; band ${g.band}`, g, { rank: g.rank, band: g.band });
        } else {
          push(row, "MERGE", `same normalized key as "${g.canonical}" (kept row ${primary.id})`, g, { into: primary.id, merge_kind: "duplicate" });
        }
      } else if (g.collapsedInto) {
        const rep = g.collapsedInto;
        if (rep.primary) {
          push(row, "MERGE", `Google reports one volume (${fmt(g.volume)}) for this cluster; represented by "${rep.canonical}"`, g, { into: rep.primary.id, merge_kind: "cluster" });
        } else {
          push(row, "KEEP_LONG_TAIL", `clusters with "${rep.canonical}" (identical volume ${fmt(g.volume)}) but that keyword has no row to merge into`, g);
        }
      } else if (row.id !== primary.id) {
        push(row, "MERGE", `same normalized key as "${g.canonical}" (kept row ${primary.id})`, g, { into: primary.id, merge_kind: "duplicate" });
      } else if (g.volume !== null) {
        push(row, "KEEP_LONG_TAIL", `measured volume ${fmt(g.volume)}; not in the selected set (${g.leftOut || "outside top " + cfg.n})`, g);
      } else {
        push(row, "KEEP_LONG_TAIL_UNVERIFIED", "no volume reported by any source; nothing says it is wrong, so it stays", g);
      }
    }
  }
  outcomes.sort((a, b) => cmpStr(a.id, b.id));

  const excluded = [...groups.values()]
    .filter((g) => g.judge?.decision === "exclude")
    .map((g) => ({
      term: g.canonical,
      key: g.key,
      reason_code: (g.judge as JudgeResult).reason_code,
      to_lane: (g.judge as JudgeResult).to_lane ?? cfg.moveLaneByReason[(g.judge as JudgeResult).reason_code] ?? null,
      volume: g.volume,
    }))
    .sort((a, b) => volDesc(a.volume, b.volume) || cmpStr(a.term, b.term));

  return {
    gcid: input.gcid,
    config: cfg,
    selected,
    adds,
    outcomes,
    templates: templateRows.map((r) => ({ id: r.id, term: r.term, slots: placeholdersOf(r.term) })),
    excluded,
    unjudged: [...unjudged].sort(),
    short_by: Math.max(0, cfg.n - selected.length),
    skipped,
    head_family: headFamily,
    warnings,
  };
}
