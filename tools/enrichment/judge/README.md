# Relevance judge (taxonomy enrichment)

Design, prompt, schema, validator, golden set and offline harness for the step that decides, per
category and per lane, whether a noisy candidate term belongs. **Spec only: nothing here calls a
model, a network service or the database.** Say "category", never "vertical".

Pipeline position: search-data tools -> candidate terms (200-300 per call) -> **judge (Haiku, batch)**
-> validator -> keep / exclude / move -> `exp_taxonomy` proposals (through the existing
`exp_category_proposals` review flow in `tools/enrichment/propose.ts`; the judge writes nothing itself).

## Files

| File | What it is |
|---|---|
| `reason-codes.ts` | Single source of truth: 14 lanes, 3 decisions, 13 reason codes with definition, note rule, 2 examples each, precedence order, forbidden family slugs |
| `types.ts` | `JudgeRow` / `JudgeOutput` (the output type), `CategoryContext`, `JudgeCandidate`, `ValidationResult` |
| `schema.ts` -> `judge-output.schema.json` | JSON Schema (draft 2020-12) incl. cross-field `allOf` rules; `structuredOutputsSubset()` drops the conditionals |
| `validate.ts` | `validateJudgeOutput(raw, {lane, candidates, category})`: strict, rejects malformed output and unknown reason codes |
| `prompt.ts` | `buildSystemPrompt`, `buildCategoryBlock`, `buildCandidateBlock`, `toMessagesParams` (2 cache breakpoints), `toBatchRequest`, `chunkCandidates` |
| `cost.ts` | Token measurement + cost model (`bun tools/enrichment/judge/cost.ts`) |
| `golden/golden.json` | 234 labelled rows (86 observed from Scott, 148 synthetic) + the 10 category context fixtures |
| `eval.ts` | Offline harness + CLI + pilot exit gate |
| `judge.test.ts` | 41 tests incl. a mocked model proving validator and harness |

Run: `bun test tools/enrichment/judge`, `bun tools/enrichment/judge/eval.ts --results results.json`,
`bun tools/enrichment/judge/cost.ts`, `bun tools/enrichment/judge/schema.ts` (re-emit schema).

## 1. Output contract

Strict JSON array, one object per candidate, in the order sent, `term` copied verbatim, exactly six keys:

```
{ term, decision: keep|exclude|move, reason_code, family, to_lane, note }
```

* `decision`: `keep` (belongs in this lane), `exclude` (does not), `move` (valuable, wrong lane; only with
  `informational`, `to_lane` in question | topic | content_title).
* `geo_specific` is an `exclude` whose `note` is the template (`realtors {city}`); many geo variants collapse into one template.
* `navigational_brand` is a `keep`; downstream sets `volume_inflated_by_navigation` and discounts the volume. (No extra output key was added.)
* `family`: `<domain>:<slug>`, only on `keep` rows in family-bearing lanes (keyword, product_service, specialization, topic, question,
  content_title, industry_term, alias, profession_title). `null` for exclude/move and for tag, audience, review_aspect, modifier, negative_keyword.
* The validator also enforces what JSON Schema cannot: `portal_owned` is rejected when the candidate had `local_pack=Y`; `duplicate_meaning`
  must name a surviving candidate verbatim; no invented/rewritten terms; no duplicate rows; family domain must belong to the category; an off-menu family is a
  warning (`PROPOSED_FAMILY`, human review), not an error. Rows that pass are returned even when the call fails, so only the failures are re-queued.

### Families (the lesson from the previous version)

Families come from THE CATEGORY'S OWN data (a menu in the category block built from its products/services, specializations and
profession titles). They are always domain-qualified, because "broker" means a different thing in real estate (`real_estate:brokerage`),
mortgage (`mortgage:broker_services`), insurance and investing. Modifiers (best, top, good, cheap, near me, local, open now, 24 hour, free)
are tags, never families: rejected by shape (`best`, `top_rated`, `near_me`, `best_realtor`...). "emergency_repair" is a service and allowed; bare "emergency" is not.

## 2. Reason-code vocabulary (v1, fixed)

| code | decision | meaning | example |
|---|---|---|---|
| `keep` | keep | real search for this category; modifiers do not change it; near-me form of a portal term with a local pack is kept | "dispensary that takes card near me"; "houses for sale near me" (local_pack=Y) |
| `brand_or_business_name` | exclude | a specific company/chain/brand (brand+geo is still brand) | "chipotle mexican grill near me"; "mint dispensary az" |
| `other_category` | exclude | belongs to a different real GBP category; note names it. Not for siblings that share the map pack | "mexican grocery store near me"; "commercial real estate agent" |
| `different_audience` | exclude | job seekers, students, licensing, wrong B2B/B2C side | "dispensary jobs near me"; "realtor classes" |
| `informational` | move | learn/DIY intent; `to_lane` question/topic/content_title | "what is thc"; "margarita recipies" |
| `geo_specific` | exclude | names a place; note = `{city}`/`{state}` template | "yuma realtors"; "plumbers in dallas tx" |
| `ambiguous_meaning` | exclude | the words mean something else | "muscle strains"; "catacombs in paris france" |
| `portal_owned` | exclude | portals own the SERP; only when local_pack is N/unknown | "homes for sale"; "mortgage calculator" |
| `navigational_brand` | keep (flag) | generic word but volume is mostly people seeking a portal/brand | "realtor" (mostly Realtor.com) |
| `amenity_attribute` | exclude | a feature, valid as a tag, not a search | "cannabis store with wifi" |
| `compliance_conflict` | exclude | matches/paraphrases a prohibited phrase or invites steering; note quotes it | "guaranteed mortgage approval"; "safe neighborhoods near me" |
| `off_intent` | exclude | nothing to do with hiring this category | "prayer to sell my house"; "realtor logo" |
| `duplicate_meaning` | exclude | same meaning as a kept candidate (shared Google volume); note names survivor | "plumbers near me" |

Precedence when several apply (rendered into the prompt): compliance_conflict > brand_or_business_name > ambiguous_meaning > off_intent >
different_audience > other_category > geo_specific > informational > portal_owned > amenity_attribute > duplicate_meaning > navigational_brand > keep.

Boundary rule (from the Google map-pack observation): agent, agency, brokerage and broker terms that compete for the same pack are one pool.
The category block marks such siblings `shares_pack`; the prompt tells the judge not to use `other_category` across a pooled pack and not to
exclude "real estate brokerage near me" or "realtor agencies near me" for sounding like a company. Entity types (professional, location, brand) are
listed so the judge does not exclude agent terms because the entity is an office, or the reverse.

## 3. Prompt and caching structure

```
SYSTEM  (identical for every category, lane, chunk)         ~5.1k tokens   <- cache breakpoint 1
  task, decision rules, pooled-pack and local_pack rules, lanes, reason codes + examples,
  family rules, output contract, schema, example
USER #1 CATEGORY block (identical for every lane/chunk of a category)  0.25-0.7k fixtures, ~1.5k assumed real  <- breakpoint 2
  gcid, display name, aliases, group, schema type, entity types, siblings (+belongs, shares_pack),
  compliance flags + prohibited phrases, family menu
USER #2 lane + candidates (never cached)                    ~3.6k tokens for 250 terms
  "LANE TO JUDGE", then term<TAB>volume<TAB>intent<TAB>local_pack(Y/N/?)
```

Nothing volatile (dates, ids, random order) sits in the cached prefix; a test guards that. Candidates are sorted by volume then term so replays are reproducible.
`toBatchRequest` sets `custom_id = gcid|lane|chunk` (batch results arrive in any order). Each call is one category, one lane, 200-300 candidates;
larger lists are split into balanced chunks.

### Token and cost estimate (assumptions are explicit; verify before budgeting)

Measured on the rendered prompts (chars/3.5 heuristic, +-15%): system ~5,070 tokens; category block 240-690 (fixtures; 1,500 assumed for real
categories with 10+ siblings and 40-80 families); 250 candidates ~3,560 tokens (14/term); output ~11.8k tokens per call (~42 tokens per keep row,
~52 per exclude row incl. note, 50% non-keep assumed). So per call: **~10k input (5.1k+1.5k+3.6k), ~11.8k output**.

Assumptions:
* Prices (list, $/MTok input/output): Haiku 4.5 $1/$5; Haiku 5.5 $0.10/$0.50 (prompts <= 100K). Batch API -50% on both. Cache read 0.1x, write 1.25x (5 min) or 2x (1 h) of input price; discounts stack. Batch cache hits are best-effort (concurrent, unordered), assumed 80% for the system prefix and 60% for the category prefix.
* Volume of work: 4,032 categories x 600 candidates each (one lane = keyword; this is a guess, real export sizes unknown) = 2.42M candidates, 3 calls of 250 per category = 12,096 calls = 122.6M input tokens, 142.2M output tokens.
* Minimum cacheable prefix assumed 4,096 tokens for Haiku 4.5: the system block alone (~5.1k) clears it; the category block only caches as part of system+category.

| Scenario (4,032 cat x 600 cand, batch) | Haiku 4.5 | Haiku 5.5 |
|---|---|---|
| no caching | $417 ($0.103/category) | $42 |
| system cached (1 h), 80% hit | $401 | $40 |
| system + category cached, 80%/60% hit | $403 | $40 |
| system + category, 95%/95% hit (best case) | $390 | $39 |
| system cached + compact output (x0.5) | $223 ($0.055/category) | $22 |

Findings: **output tokens are ~87% of the bill**, so caching saves only ~4-6%. Category-block caching does not pay at ~3 calls per
category with a 1 h write (2x) unless hits are very high; cache the system block only, and run a category's chunks adjacent. The only big lever is
cutting output (a compact tuple encoding, open question 4), or the model (5.5 is 10x cheaper per token than 4.5). Replaying the golden set (10 categories, ~39 small calls) costs well under $1 either way.

## 4. Golden set (`golden/golden.json`)

234 rows: **86 observed** (cannabis store 24, Mexican restaurant 28, real estate agent 34; exactly Scott's observations, including the
boundary-lesson keeps "real estate brokerage near me" and "realtor agencies near me" and the "houses for sale near me" local-pack keep) and **148 synthetic**
(real estate other lanes, mortgage lender/broker, plumber, dentist, personal injury lawyer, coffee shop, HVAC), covering every reason code and
13 of 14 lanes (no `negative_keyword`, see open question 7). Each row: category, lane, term, `local_pack` (only where supplied or inferred, noted),
`expected {decision, reason_code, to_lane}`, `family_hint` (domain-qualified, informational), `provenance`, `contested`, `note` (model-style), optional `rationale`.

Lane dependence is built in: "what is thc" is a `move` to question in the keyword lane and a `keep` in the question lane; "wifi" is
`amenity_attribute` as a keyword and a `keep` in the tag lane; "pediatric dentist near me" is `other_category` as a keyword but "pediatric dentistry" is a specialization keep.

Mortgage notes: "VA streamline refinance" / "IRRRL" are keeps (VA Interest Rate Reduction Refinance Loan). A topic judged
**"Veterans Benefits in Austin, TX" must NOT be matched to the VA home loan concept**: "veterans benefits" is overwhelmingly disability compensation, healthcare, GI Bill and burial
(a different category, `gcid:veterans_affairs_department`); the loan is one narrow slice; the overlap on "veterans"/"VA" is lexical; and templating the city
would not fix a wrong meaning. It is `ambiguous_meaning`. By contrast "VA home loan benefits in Austin, TX" names the loan and is only `geo_specific` (template `VA home loan benefits in {city}, {state}`).
The system prompt carries the general rule: shared words, acronyms and substrings are never enough; match on meaning.

Integrity (tests): every gcid and sibling gcid JOINs to `tools/category_brief/out/category_identity_keys.json` (the repo snapshot of the 4,041 real gcids; unmatched = 0),
keys are unique, labels legal, and the golden labels themselves pass the validator, so a perfect mocked model produces valid output.
`contested: true` marks 15 rows I am not certain of (UK "estate agents", cash buyers, calculators, assumed local_pack, pediatric subtype, etc.); `--exclude-contested` scores without them.

## 5. Evaluation harness and pilot exit gate

`eval.ts` reads `{ "calls": [ { gcid, lane, output, candidates? } ] }`, runs every call through the validator, and reports: decision agreement, strict agreement
(decision + reason_code + to_lane for moves), per-reason-code support / predicted / precision / recall / F1, exclude precision and recall (positive class `exclude`) and
the broader exclude|move class, false keeps vs false excludes, a decision confusion matrix and a reason-code confusion matrix (with `<invalid>` and `<missing>`
columns), breakdowns by category, lane and provenance, and every disagreement. Rows from invalid output are never counted as predictions.

**Pilot exit gate (exit code 0/1):** strict agreement >= 95% (`--gate decision` to gate on decision only; `--min` to change), AND >= 99% of golden rows judged,
AND invalid-call rate <= 2%, AND zero `compliance_conflict` rows predicted `keep` (hard zero regardless of the average).

## Open questions I could not resolve

1. **What "agreement" means for the 95% gate.** I gate on strict (decision + reason + to_lane) because reason codes feed routing (other_category, geo templates). Strict is harsh for overlapping codes (brand vs geo, ambiguous vs off_intent); decision-only is the alternative. Scott to choose; the harness supports both.
2. **No code for "different market"** ("estate agents", UK usage). Labelled `off_intent`. Add `other_market`, or accept off_intent?
3. **`move` is only for informational.** Other re-routes the pipeline will want have no decision: amenity -> tag, a discovered alias in the keyword lane, modifier -> tag, geo -> template (currently an `exclude` with a template note). Should `move` be generalised (and `to_lane` widened)?
4. **Output size.** The contract (object per row) makes output ~87% of cost; a compact tuple array would roughly halve it. Also unverified: structured-output support for the chosen Haiku, and whether it accepts the `allOf` schema or needs `structuredOutputsSubset()`.
5. **Subtype siblings.** A general dentist's "pediatric dentist near me": `other_category` in the keyword lane, but a specialization keep. Is that the rule we want for every parent/child GBP pair?
6. **Where `local_pack` comes from.** It needs a SERP feature from the search-data tool; for unknown (`?`) the judge may use `portal_owned`. The precision of `portal_owned` depends on this coverage. Default for unknown? The 3 local_pack values for observed rows other than "houses for sale near me" (Y), "homes for sale" (N), brokerage/agency (Y, per the boundary lesson) are my inference.
7. **`negative_keyword` lane has inverted semantics** (keep = "valid negative"). I did not label it. Recommend deriving negatives from `different_audience` / `off_intent` / `ambiguous_meaning` excludes instead of judging them.
8. **Estimates are heuristic.** chars/3.5 tokens, 600 candidates per category, 50% non-keep, batch cache hit rates; the real candidate counts per category and the tokenizer need a `count_tokens` pass on the pilot. Verify current prices and whether Haiku 5.5 is the target.
9. **Family menus and domains.** The fixtures are hand-written. Real menus must come from `exp_taxonomy` (product_service/specialization), the knowledge model and profession titles, and `family_domains` needs a source (mortgage_lender and mortgage_broker share `mortgage`). Off-menu proposals need a review queue.
10. **Volume and intent are not in the golden set** (not observed, not invented). A faithful replay needs the real export values for those rows.
11. **Duplicate detection is chunk-local.** `duplicate_meaning` only works when both variants are in the same call; recommend a deterministic pre-collapse (plural, stopwords, typos, word order) before judging, which also shrinks the candidate list.
12. **Compliance paraphrase.** The judge sees prohibited phrases and must catch paraphrases; consider a deterministic phrase prefilter too, and a second-pass check (Sonnet) on every `keep` in categories with compliance flags.
13. **Two-stage escalation.** Not designed: route low-confidence or contested codes (ambiguous_meaning, other_category) to a stronger model after the Haiku pass. The output has no confidence field; adding one costs output tokens.
14. **Adjudicate the 15 contested rows** (listed by `contested: true` in the golden file) before the pilot.
15. **Documentation discipline.** No database function, table, trigger, cron or `disco-*` ETL code is touched here, so nothing was added to `docs/ETL-Enhancements.md`; the pilot run (and any wiring into the proposal flow) should add an entry.
