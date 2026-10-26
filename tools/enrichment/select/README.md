# Keyword-lane selection engine

Turns collected search evidence into the **keyword lane** for one category (`gcid`) and assigns an outcome to every
existing keyword row. Pure and deterministic: no network, no DB, no model calls, no clock. A thin CLI reads/writes JSON.

```
candidates + existing rows + intents + map-pack flags + JUDGE output
  -> group (dedupe key) -> canonical wording -> judge gate -> tier A / tier B
  -> ranked selection (family caps, informational cap, Google-cluster collapse) -> bands + tags
  -> one outcome per existing row  +  ADD records  ->  proposal-shaped change set  +  scorecard
```

The library never decides brands, ambiguity, families or lane routing. That is the **judge's** job; the engine only
consumes its output through `JudgeResult`.

```
bun test tools/enrichment/select
bun tools/enrichment/select/cli.ts input.json [outDir]   # writes selection.json, change_set.json, scorecard.json
```

```ts
import { selectKeywordLane, buildChangeSet, scorecard, aggregateTemplates, stubJudge } from "./index";
const result = selectKeywordLane({ gcid, existing, candidates, intents, local_pack, judge, config });
const { proposals, warnings } = buildChangeSet(result, existing);   // pass the same existing rows
const card = scorecard(result);
```

## Input contract

| field | shape | notes |
|---|---|---|
| `gcid` | string | exactly as stored (`gcid:xxx`); used only in `target_key` of adds. Never transformed. |
| `existing` | `ExistingRow[]` | `{id, term, ...}`. For `set` proposals to carry a correct `before`, include `term_display, term_slug, level, priority, search_volume_monthly, volume_source, volume_as_of, search_intent, validated`. A missing field is treated as `null`. |
| `candidates` | `Candidate[]` | `{term, volume: number\|null, source, domain?, position?, volume_as_of?}`. One entry per (term, source, domain). `source` is any string; the pipeline uses `keyword_ideas`, `competitor`, `autocomplete`, `lookup`. `position` is the 0-based autocomplete order. `volume: null` means "not reported", never zero. Candidates containing `{placeholders}` are ignored (warning). |
| `intents` | `{term: label}` | labels: head/local/service/transactional/question/informational/comparison/urgency. Looked up by the canonical wording, then each variant. |
| `local_pack` | `{term: boolean}` | map-pack flag per term. Passed through (group is `true` if any variant is `true`). |
| `judge` | `JudgeResult[]` or `(term) => JudgeResult\|undefined` | see below. |
| `config` | `Partial<SelectConfig>` | defaults in `engine.ts` (`DEFAULT_CONFIG`). |

### Judge interface

```ts
interface JudgeResult {
  term: string;
  decision: "keep" | "exclude";
  reason_code: string;   // required for exclude: brand, other_category, off_intent, geo, amenity, compliance, portal_owned, informational ...
  family: string;        // drives per-family caps + cluster collapse. Modifiers (near me, best, cheap ...) are tags, never families.
  to_lane?: string;      // exclude only: destination lane -> MOVE instead of RETIRE
  concept_slug?: string; // keep only: passed to the add payload
}
```

* Verdicts are matched on the canonical wording, then on every variant and every raw spelling in the group.
* An `exclude` with an empty `reason_code` is ignored with a warning (never retire without a reason).
* A **candidate** (new term) with no judge result is **not selected** and is listed in `result.unjudged`
  (`config.unjudgedCandidates: "keep"` selects it with an empty family instead). An **existing row** with no
  judge result has no objection and is kept.
* `exclude` + lane (`to_lane`, or `config.moveLaneByReason[reason_code]`, default `informational -> guide`) = `MOVE`; any other exclude = `RETIRE`.
* `stubJudge(table, opts)` is a test/dry-run stand-in: everything is `keep`, family = first word.

### Config (defaults)

`n 50`, `floor 300`, `tierBCap 12`, `tierBMaxPosition 4`, `tierBCorroboratedMaxPosition` (= `tierBMaxPosition`),
`familyCap 5`, `headFamilyCap 8`, `headFamily` (default: family of the highest-volume eligible term),
`informationalCap 5`, `informationalIntents ["informational","question"]`, `canonicalExistingRatio 0.9`,
`bandHigh 0.15`, `bandMedium 0.35`, `clusterJaccard 0.34`, `clusterFamilyMinSharedTokens 1`,
`unjudgedCandidates "skip"`, `tags` (`DEFAULT_TAGS`), `pluralModifierHeads`, `moveLaneByReason`,
`keywordLevel "keyword"`, `entityScope`, `volumeAsOf`.

## Behavior

1. **Dedupe key** (`normalizeKey`): lower-case; apostrophes dropped, other punctuation to space; radius phrases
   ("within 5 mi") removed; stopwords (`the a an of in for to my that are is i you with at on and or any some`) and digit-only
   tokens dropped; stem (`deliver/delivers/delivering/deliveries -> delivery`, `ies -> y`, trailing `s` unless `ss`, words of 3 letters or fewer untouched);
   proximity words (`near me nearby closest local around closeby area`) -> one `NEAR` token; unique tokens sorted.
   Same key = one group; group volume = max over variants (fresh candidate volume; stored volume of existing rows only when no candidate reported one).
2. **Canonical wording** (`cleanWording`, `chooseCanonical`): every wording is first cleaned (radius stripped, leading
   "near me" moved to the end, doubled "near me" collapsed, trailing "near" -> "near me", plural noun-adjunct before a head noun
   singularised). Then: an existing row's wording if its volume >= 90% of the best; else the autocomplete-confirmed variant;
   else the shortest. Rules 2 and 3 only draw from variants within 90% of the best measured volume.
3. **Google cluster collapse**: while selecting (and in a sweep over the rest), a Tier A group with a volume identical to
   an already-selected representative, and (token Jaccard >= 0.34 **or** same judge family with >= 1 shared non-NEAR token),
   is recorded in the representative's `cluster` and not selected. On a volume tie, a group that already has a row is the
   representative, then fewer tokens, then shorter text.
4. **Tiers**: Tier A = measured volume >= floor. Tier B = null volume and best autocomplete position <= 4 (or <=
   `tierBCorroboratedMaxPosition` when two or more distinct sources agree). Tier B capped at 12 and flagged `hidden_volume`.
5. **Selection**: Tier A by volume; Tier B reserves `min(tierBCap, available)` slots so hidden-volume terms are not crowded
   out, and unused reserve is backfilled with Tier A. Per-family caps (judge families; head family 8), informational cap 5,
   fills to `n`. Fewer than `n` is legal (niche categories): `short_by` and `skipped.*` explain it. Final order: Tier A by
   volume, then Tier B by autocomplete position.
6. **Tags**: `tags[]` from the configurable list (default: near me, best, top, cheap, affordable, open now, delivery, online,
   same day, 24 hour, for sale, emergency, free, mobile); `local_intent` = NEAR token or `{city} {state} {zip} {neighborhood} {county}`;
   `local_pack` passed through.
7. **Bands** (measured selected only): High = top 15%, Medium = next 35%, Low = rest (identical volumes share the higher
   band); Tier B = `Unknown`.
8. **Templates**: existing rows with `{city}/{state}/{zip}` placeholders are `KEEP_TEMPLATE`, outside the top N.
   `aggregateTemplates(templates, variants)` sums measured volume of city-specific variants per template (most specific
   template wins; normalised duplicates count once at their larger volume; nulls counted, not summed).
9. **Existing row outcomes** (exactly one each): `KEEP_TOP`, `KEEP_TEMPLATE`, `KEEP_LONG_TAIL` (measured, not selected),
   `KEEP_LONG_TAIL_UNVERIFIED` (no volume, no objection), `MERGE` (`into`), `MOVE` (`to_lane`), `RETIRE` (`reason_code`).
   Each has `reason` and `evidence`. Missing data never retires a row.
10. **ADD**: selected groups with no existing row (`result.adds`): source, volume, volume_as_of, intent, band, tags, evidence.

## Output contract

`SelectionResult`: `selected[]`, `adds[]`, `outcomes[]` (sorted by id), `templates[]`, `excluded[]`, `unjudged[]`, `short_by`,
`skipped{below_floor,family_cap,informational_cap,tier_b_cap,no_evidence,clustered}`, `head_family`, `warnings[]`.
Band, tags, tier, cluster, family and the other evidence travel in `evidence` (the add payload has no columns for them).

### Change set (`buildChangeSet(result, existing)` -> `{proposals, warnings}`)

Each proposal is `{op, target_table: "exp_taxonomy", target_key, payload, before, rationale, rule}`. The loader adds the
proposals table's bookkeeping columns (`batch`, `gcid`, `lane`, `created_by`).

| op | target_key | payload | before |
|---|---|---|---|
| `add` | `{gcid, level, term_slug}` | `level, term, term_display, term_slug, [entity_scope], source, search_intent, search_volume_monthly, validated, priority, is_required, [concept_slug], volume_source, volume_as_of, evidence` | `{}` |
| `set` | `{id}` | only the keys that change: `priority`, `search_volume_monthly`, `volume_source`, `volume_as_of`, `validated`, `search_intent`, and `term/term_display/term_slug` when the wording was defective | the current value of every key in the payload |
| `merge` | `{id}` | `{into: <uuid>, reason}` | `{term}` |
| `retire` | `{id}` | `{reason}` (the judge `reason_code`, or `moved to <lane>`) | `{term}` |

* `priority` = rank `1..N` for the selected set, `100` for the long tail.
* `term_slug` = lower-case, runs of non-alphanumerics -> one `_`, trimmed. `validated` = true for measured volume, false for hidden volume.
* MOVE = `add` in the new lane (its own `target_key.level`) + `retire` with reason `moved to <lane>`.
* Rules: `KW.add_measured`, `KW.add_hidden_volume`, `KW.set_top`, `KW.set_long_tail`, `KW.merge_duplicate`, `KW.merge_cluster`, `KW.retire_<reason_code>`, `KW.move`.
* A unique index forbids two open proposals with the same `target_key`: an add whose `(level, term_slug)` already exists
  (existing rows or earlier adds) is skipped with a warning; a reword whose new slug would collide is skipped with a warning.

### Scorecard (`scorecard(result)`)

Counts by outcome (incl. `ADD`), `tier_a`, `tier_b`, `measured_share` (Tier A / selected), `wording_mix`
(existing / autocomplete / shortest), `families` + `family_count` + `head_family`, `local_intent_share`, `local_pack_count`,
`informational_count`, `bands`, `templates`, `short_by`.

## Files

`types.ts` contract; `normalize.ts` key/wording; `tags.ts`; `judge.ts` lookup + stub; `engine.ts` selection;
`templates.ts`; `changeset.ts`; `scorecard.ts`; `index.ts`; `cli.ts`; `select.test.ts`.
