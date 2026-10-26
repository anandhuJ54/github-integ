# Review batch 1 — deterministic cleanup (`det-20261011-1`)

Generated 2026-10-11 by tools/enrichment/propose.ts. Nothing has been inserted or applied.

## What is proposed

| Rule | Rows | Categories | Op |
|---|---:|---:|---|
| K1 | 233 | 162 | set |
| R2.retire_dup | 21 | 21 | retire |
| R2.set_person | 383 | 383 | set |
| R3 | 1 | 1 | retire |
| T2 | 257 | 13 | retire |
| T3.relabel_geo | 18 | 16 | relabel |
| T3.retire_alias | 18 | 16 | retire |
| T3.retire_dup | 4 | 4 | retire |
| T3.retire_slot | 91 | 32 | retire |
| T5 | 2480 | 182 | relabel |
| **Total** | **3506** | **584** | |

Nothing dropped.

## Sample (20, stratified by rule, deterministic)

| # | Rule | Category | Before | After |
|---:|---|---|---|---|
| 1 | T2 | ceiling_supplier | keyword: `ceiling supplier gbp storefront address verified` | retired (is_active=false) |
| 2 | T2 | comprehensive_secondary_school | industry_term: `gbp signal school name match contribution score` | retired (is_active=false) |
| 3 | T2 | fishing_store | keyword: `fishing store gbp website match` | retired (is_active=false) |
| 4 | T3.relabel_geo | netball_club | keyword: `netball club wifi facilities {suburb}` | `netball club wifi facilities {neighborhood}` |
| 5 | T3.relabel_geo | aadhar_center | keyword: `aadhaar center {pin_code}` | `aadhaar center {zip}` |
| 6 | T3.retire_slot | pediatric_endocrinologist | question: `what is dr. {name}'s success rate with insulin pump patients?` | retired (is_active=false) |
| 7 | T3.retire_slot | french_restaurant | content_title: `private dining at {business_name}: venues and packages` | retired (is_active=false) |
| 8 | T3.retire_alias | pediatric_pulmonologist | alias: `dr. {city} pediatric pulmonologist` | retired (is_active=false) |
| 9 | T3.retire_alias | physiatrist | alias: `dr. {city} physiatrist` | retired (is_active=false) |
| 10 | T3.retire_dup | christmas_market | keyword: `best christmas markets {region}` | retired (is_active=false) |
| 11 | T5 | pet_trainer | question: `How long does it take to train a dog` | `How long does it take to train a dog?` |
| 12 | T5 | glass_repair_service | question: `Can a cracked windshield be repaired or does it need replacement` | `Can a cracked windshield be repaired or does it need replacement?` |
| 13 | T5 | tool_and_die_shop | question: `How do I choose a tool and die shop for precision automotive parts` | `How do I choose a tool and die shop for precision automotive parts?` |
| 14 | K1 | cosmetic_dentist | "Request a Second Opinion from Dr. {name}" → `RequestQuoteAction` | `AskAction` |
| 15 | K1 | clergyman | "Message Me Directly" → `potentialAction` | `CommunicateAction` |
| 16 | K1 | assistante_maternelle | "Contacter directement la professionnelle" → `ContactAction` | `CommunicateAction` |
| 17 | K1 | power_plant_consultant | "Request RFP Response" → `RequestQuote` | `AskAction` |
| 18 | R2.set_person | cardiovascular_and_thoracic_surgeon | Occupation Detail (Occupation.hasOccupation) | schema_type = Person |
| 19 | R2.retire_dup | forensic_consultant | Occupation Detail (Occupation.hasOccupation) | retired (is_active=false) |
| 20 | R3 | insurance_agent | Google Review Count (shared.aggregateRating) | retired (is_active=false); keeps location `google_review_count` |

## Rules in one line each

- **K1** — conversion_actions schema_action is not a schema.org type (checked against exp_schemaorg_types); mapped deterministically to a valid Action.
- **R2.retire_dup** — category already has an active Person.hasOccupation node in this ring; the Occupation-typed copy is redundant.
- **R2.set_person** — hasOccupation is a property of Person, not Occupation; subject corrected.
- **R3** — shared node duplicates the scoped node of the same name and ring; the scoped node is the specific one and is kept.
- **T2** — engine_v1 leaked internal GBP-verification jargon into consumer taxonomy; not a term a consumer searches or reads.
- **T3.relabel_geo** — geo-synonym slot rewritten to the standard slot the geo pages render ({city} {neighborhood} {state} {zip} {county}).
- **T3.retire_alias** — an alias must be a bare profession name; a templated slot makes it unusable for matching.
- **T3.retire_dup** — geo-synonym slot rewrite would duplicate an existing term in the same category and level.
- **T3.retire_slot** — entity/person slot ({name}, {professional_name}, {abbey}, {brand} …) cannot be filled at category level.
- **T5** — question-level term missing its question mark.

## Judgement calls to confirm

- T2 matches the word `gbp` only; 15 engine_v1 terms saying "google business" are left alone.
- T3 treats `{county}` as a standard slot alongside city/neighborhood/state/zip; `{region}`/`{prefecture}` map to `{state}`, `{suburb}`/`{district}` to `{neighborhood}`.
- K1 maps quote requests to `AskAction` (the curated precedent) rather than `QuoteAction` (schema.org: the *business* quotes a price).
- R2 retires instead of fixing when the category already has a Person.hasOccupation node in the same ring.
- Some conversion-action labels themselves contain slots ("…from Dr. {name}"); K1 only fixes schema_action, not labels.

## Decision

Approve all / approve by rule / reject by rule, plus any row numbers to exclude. On approval Claude runs
`proposals_det-20261011-1.insert.sql`, then `exp_category_proposal_review('det-20261011-1', NULL, true, '<note>', 'scott')`
and `exp_category_proposal_apply('det-20261011-1')`. Each category is snapshotted first, every change is ledgered,
and a category whose validation regresses is rolled back and marked failed. Nothing is hard-deleted.
