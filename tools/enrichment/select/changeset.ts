// SelectionResult -> proposal-shaped objects for the existing proposals table. Pure.
// Loader adds the table's bookkeeping columns (batch, gcid, lane, created_by); this file only shapes
// {op, target_table, target_key, payload, before, rationale, rule}.
import { slugify, wordingDiffers } from "./normalize";
import type { ChangeProposal, ExistingRow, Json, Obj, RowOutcome, SelectionResult } from "./types";

const TABLE = "exp_taxonomy" as const;
const fmt = (n: number | null) => (n === null ? "no volume" : n.toLocaleString("en-US"));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface ChangeSet {
  proposals: ChangeProposal[];
  warnings: string[];
}

export function buildChangeSet(result: SelectionResult, existing: ExistingRow[]): ChangeSet {
  const cfg = result.config;
  const gcid = result.gcid;
  const proposals: ChangeProposal[] = [];
  const warnings: string[] = [];
  const rows = new Map(existing.map((r) => [r.id, r]));
  const taken = new Set<string>(); // `${level}|${term_slug}` for adds (unique-index guard)
  for (const r of existing) taken.add(`${r.level ?? cfg.keywordLevel}|${r.term_slug ?? slugify(r.term)}`);

  const addProposal = (level: string, p: Obj, rationale: string, rule: string, label: string) => {
    const slug = p.term_slug as string;
    const k = `${level}|${slug}`;
    if (!slug || taken.has(k)) {
      warnings.push(`add skipped (${label}): ${level}/${slug || "(empty slug)"} already exists or is already proposed`);
      return;
    }
    taken.add(k);
    proposals.push({
      op: "add",
      target_table: TABLE,
      target_key: { gcid, level, term_slug: slug },
      payload: p,
      before: {},
      rationale,
      rule,
    });
  };

  // ---- ADD: new selected terms ------------------------------------------------------------------
  for (const a of result.adds) {
    const slug = slugify(a.term);
    const payload: Obj = {
      level: cfg.keywordLevel,
      term: a.term,
      term_display: a.term,
      term_slug: slug,
      ...(cfg.entityScope ? { entity_scope: cfg.entityScope } : {}),
      source: a.source,
      search_intent: a.intent,
      search_volume_monthly: a.volume,
      validated: !a.hidden_volume,
      priority: a.rank,
      is_required: false,
      ...(a.concept_slug ? { concept_slug: a.concept_slug } : {}),
      volume_source: a.volume_source,
      volume_as_of: a.volume_as_of,
      evidence: a.evidence as unknown as Obj,
    };
    const why = a.hidden_volume
      ? `Tier B (hidden volume): no volume reported, autocomplete position ${a.evidence.ac_best_position}, sources ${a.evidence.sources.join("+")}`
      : `Tier A: measured ${fmt(a.volume)}/mo (${a.volume_source ?? a.source}${a.volume_as_of ? ", as of " + a.volume_as_of : ""})`;
    addProposal(
      cfg.keywordLevel,
      payload,
      `${why}; rank ${a.rank}/${cfg.n}, band ${a.band}, family ${a.family || "-"}${a.evidence.cluster?.length ? `; represents ${a.evidence.cluster.length} identical-volume variant(s)` : ""}`,
      a.hidden_volume ? "KW.add_hidden_volume" : "KW.add_measured",
      a.term,
    );
  }

  // ---- per existing row ------------------------------------------------------------------------
  const byRow = new Map(result.selected.filter((s) => s.row_id).map((s) => [s.row_id as string, s]));
  const setFor = (o: RowOutcome, want: Obj, rule: string, rationale: string) => {
    const row = rows.get(o.id);
    if (!row) return;
    const set: Obj = {};
    const before: Obj = {};
    for (const [k, v] of Object.entries(want)) {
      if (same(row[k], v)) continue;
      set[k] = v;
      before[k] = (row[k] ?? null) as Json;
    }
    if (!Object.keys(set).length) return;
    proposals.push({ op: "set", target_table: TABLE, target_key: { id: o.id }, payload: set, before, rationale, rule });
  };

  for (const o of result.outcomes) {
    const row = rows.get(o.id);
    switch (o.outcome) {
      case "KEEP_TOP": {
        const s = byRow.get(o.id);
        if (!s || !row) break;
        const want: Obj = { priority: s.rank };
        if (s.evidence.volume_origin === "candidates" && s.volume !== null) {
          want.search_volume_monthly = s.volume;
          want.volume_source = s.volume_source;
          want.volume_as_of = s.volume_as_of;
          want.validated = true;
        }
        if (s.intent) want.search_intent = s.intent;
        if (wordingDiffers(row.term, s.term)) {
          const slug = slugify(s.term);
          const clash = existing.some((r) => r.id !== row.id && (r.level ?? cfg.keywordLevel) === (row.level ?? cfg.keywordLevel) && (r.term_slug ?? slugify(r.term)) === slug);
          if (clash) warnings.push(`reword skipped for ${row.id}: slug ${slug} already used by another row`);
          else Object.assign(want, { term: s.term, term_display: s.term, term_slug: slug });
        }
        setFor(o, want, "KW.set_top", `rank ${s.rank}/${cfg.n}; ${s.hidden_volume ? "hidden volume (Tier B)" : "measured " + fmt(s.volume)}; band ${s.band}`);
        break;
      }
      case "KEEP_LONG_TAIL":
      case "KEEP_LONG_TAIL_UNVERIFIED": {
        const want: Obj = { priority: 100 };
        const v = o.evidence;
        if (o.outcome === "KEEP_LONG_TAIL" && v && v.volume_origin === "candidates" && v.volume !== null) {
          want.search_volume_monthly = v.volume;
          want.volume_source = v.volume_source;
          want.volume_as_of = v.volume_as_of;
          want.validated = true;
        }
        setFor(o, want, "KW.set_long_tail", o.reason);
        break;
      }
      case "MERGE":
        proposals.push({
          op: "merge",
          target_table: TABLE,
          target_key: { id: o.id },
          payload: { into: o.into as string, reason: o.reason },
          before: { term: o.term },
          rationale: o.reason,
          rule: o.merge_kind === "cluster" ? "KW.merge_cluster" : "KW.merge_duplicate",
        });
        break;
      case "RETIRE":
        proposals.push({
          op: "retire",
          target_table: TABLE,
          target_key: { id: o.id },
          payload: { reason: o.reason_code as string },
          before: { term: o.term },
          rationale: o.reason,
          rule: `KW.retire_${o.reason_code}`,
        });
        break;
      case "MOVE": {
        const lane = o.to_lane as string;
        const slug = slugify(o.canonical ?? o.term);
        const payload: Obj = {
          level: lane,
          term: o.canonical ?? o.term,
          term_display: o.canonical ?? o.term,
          term_slug: slug,
          ...(cfg.entityScope ? { entity_scope: cfg.entityScope } : {}),
          source: (row?.source as string | undefined) ?? "existing",
          search_intent: (row?.search_intent ?? null) as Json,
          search_volume_monthly: (row?.search_volume_monthly ?? null) as Json,
          ...(typeof row?.priority === "number" ? { priority: row.priority } : {}),
          evidence: { moved_from: { id: o.id, level: row?.level ?? cfg.keywordLevel, term: o.term }, judge_reason_code: o.reason_code ?? null },
        };
        addProposal(lane, payload, `moved from ${cfg.keywordLevel} lane: ${o.reason}`, "KW.move", o.term);
        proposals.push({
          op: "retire",
          target_table: TABLE,
          target_key: { id: o.id },
          payload: { reason: `moved to ${lane}` },
          before: { term: o.term },
          rationale: o.reason,
          rule: "KW.move",
        });
        break;
      }
      case "KEEP_TEMPLATE":
        break;
    }
  }

  const opRank = { add: 0, set: 1, merge: 2, retire: 3 } as const;
  proposals.sort(
    (a, b) =>
      opRank[a.op] - opRank[b.op] ||
      ((a.payload.priority as number | undefined) ?? 1e9) - ((b.payload.priority as number | undefined) ?? 1e9) ||
      cmpStr(JSON.stringify(a.target_key), JSON.stringify(b.target_key)),
  );
  return { proposals, warnings };
}
