# Multi-Category Composition Contract (locked 2026-07-06)
A profile = 1 primary category + up to 9 secondary (GBP model). The person's
environment is COMPOSED from selected categories; nothing renders from unselected ones.

## Merge rules
1. UNION the selected categories' node registries and taxonomies, deduped by slug.
2. Slug collision with identical schema path -> one node (universal: licenses, NPN, E&O).
3. Slug collision with DIFFERENT schema paths -> PRIMARY CATEGORY WINS; secondary's
   variant is dropped with provenance note (never two truths for one fact — canon).
4. Ring membership, connection_method, and required flags come from the winning row.
5. Conversion actions union across categories; duplicate schema_action+label collapse.

## Intra-category dormancy (person layer)
Within a category, nodes bind to the person's declared specializations/services:
undeclared -> dormant (exists in template, never renders as an empty field).
A chiropractor who doesn't treat children never sees pediatric fields; a P&C agent
never sees life fields because life_insurance_agency was never selected (inter-
category) — two mechanisms, one guarantee: no blank irrelevant fields, ever.

## Projection consequence
Signup forms and profile pages project from the COMPOSED registry, not any single
category. exp_category_schema stores per-category projections; the person-level
projection composes at render time using these rules.
