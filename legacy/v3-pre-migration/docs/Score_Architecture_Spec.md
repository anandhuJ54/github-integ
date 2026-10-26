# Search Rank Score — Architecture Spec (v1, for review)

## What the score is
A 0–1000 measurement of a profile's expertise graph: completeness × verification strength ×
freshness, computed per category against that category's registry. Three consumers:
the professional (coaching objective: "connect X, gain Y points"), the consumer (trust signal),
the platform (sales motion + Curator objective function). Deterministic, versioned
(score-config-v1), recomputed on graph change — a pure function, never a vibe.

## Structure: ring-weighted, class-profiled
score = Σ_rings ( ring_weight[class] × ring_completion ) × required_gate

- **Ring completion** = Σ points of instantiated nodes / ring point budget, with diminishing
  returns inside a ring (1st citation > 10th; log-scaled after the 3rd similar node).
- **Class weight profiles, not per-category weights.** 4,032 weight sets would be unmaintainable
  fiction. Eight archetypes cover the universe (assignment derived from schema_type lineage +
  entity_type + compliance flags):
  1. regulated-professional (attorney, CPA, financial planner) — authority-heavy
  2. medical-practice (HIPAA class) — authority + reputation
  3. licensed-trade (plumber, electrician, HVAC) — authority + reputation + conversion
  4. venue-hospitality (hotel, restaurant) — reputation + engagement + conversion
  5. retail (stores) — presence + engagement + conversion
  6. local-services (unlicensed) — reputation + presence
  7. civic-faith-community (church, school, museum) — engagement + content
  8. financial-institution (GLBA class) — authority + compliance-linked trust
- **Evidence tiers multiply node points:** verified (oauth/etl) ×1.0 · platform-connected ×0.7 ·
  manual claim ×0.4. The graph's whole point is provable expertise; claims score less than proof.
- **Freshness decay** on activity rings only (reputation, content, engagement): points decay to
  50% over 12 months without new evidence. Identity/authority/location don't decay (a license
  has expires; decay there is handled by the credential's own expiry, not time).

## Required nodes and the gate
Per category: 5–9 required nodes (identity root, address+geo, one presence, one conversion,
plus category-critical authority — license/NPI/bar for regulated classes; the banked reviewer
lists activate here). Missing required nodes do not zero the score; they **cap** it
(cap = 400 "Building"), because a rich-but-unlicensed profile is real but must not rank as
established. Bands: 0–99 Unranked · 100–399 Building · 400–699 Established · 700–899 Leading ·
900+ Elite. v1 is absolute; percentile-within-market ships when population exists (Curator item).

## Point assignment: deterministic first, model second
Node points are a FORMULA, not 4,032 batch outputs:
  points = ring_budget × priority_tier(node.priority) × connection_ceiling(connection_method)
One cheap gated batch decides only what a formula can't: per-category required-node picks and
up to 3 "category-critical" multiplier nodes (NPI for medical, NMLS for mortgage, health
inspection for food). Gauntlet on that batch: required nodes must exist in the category's
registry (slug match), regulated classes MUST require their license node, multipliers only on
authority/reputation rings. Everything else is auditable arithmetic.

## Storage & versioning
- exp_score_class_profiles (8 rows: archetype weights) — hand-authored, the core IP, reviewed line-by-line
- exp_category_score_config (4,032: gcid, archetype, required_slugs[], critical_multipliers, version)
- registry columns activate: required_for_score, score_points (backfilled by formula migration)
- exp_profile_scores (profile_id, gcid, score, band, components jsonb, config_version, computed_at)
- Suite checks: archetype coverage 4,032/4,032; every regulated category requires its license node;
  ring budgets sum to 1000 per archetype; zero required_slugs missing from registries.

## Curator hooks (why this informs the always-on agent)
Score config is a first-class section the Curator audits and proposes against: wrong archetype
assignments, missing required nodes, mispriced multipliers, decay windows per vertical
(restaurant reviews stale in 3 months; attorney credentials don't). Score deltas become the
Curator's impact currency: every proposal reports "affects scored nodes worth N points."

## Build sequence
1. This spec — review (the 4 decisions below)
2. Hand-author the 8 archetype profiles → review line-by-line
3. Deterministic formula migration: score_points + required_for_score backfill, suite-checked
4. Exemplar: real_estate_agents + mortgage_broker configs + 3 synthetic profiles scored
   end-to-end (thin/average/elite) — sanity-check the numbers FEEL right
5. Config batch for 4,032 (required picks + criticals) through the gauntlet
6. Compute function + suite checks + score on the category UI
