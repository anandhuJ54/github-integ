# Completeness Score — Method v1 (RULED 2026-07-12)

Per-profile, 0–153 points. Two multiplicative components: you cannot buy out of an incomplete profile
with volume, but completing the profile unlocks the volume you already built.

## The formula
**Completeness = 153 × Volume_ratio × Core_coverage**
1. **Volume_ratio** = min(1, node_count / M)          ← node_count = the raw total (more is more, everything counts)
2. **Core_coverage** = core_types_present / core_types_expected   ← structural essentials present

M (per category, exp_category_completeness):
  M = total_node_types (registry ceiling) + expected standing volume (EAR reviews + EAA articles + priors)
core_types_expected = identity ring + authority ring + required-for-score node types (median 46, range 26–56).

## Worked example (ruled correct)
Real estate agent: node_count 1600, M 412, missing 30% of core →
  Volume_ratio = min(1, 1600/412) = 1.0 ;  Core_coverage = 0.70
  **Score = 153 × 1.0 × 0.70 = 107.** Volume alone can't exceed 70% while core is 30% gapped.

## The dual-purpose number
The same node_count feeds the UNCAPPED **Graph Count** — the retention/ownership scoreboard shown everywhere
(only goes up, drives behavior, "don't lose what you built") — and this category-normalized capped Completeness.

## Provenance
- `ruled`: multiplicative form, core-gate, 153 cap, category-relative M, core = identity+authority+required.
- `prior`: M volume priors (posts 12 / listings 8 / media 10 / Q&A 6), launch values.
- `fitted` (future): M and core weights regressed on real category profiles + ranking outcomes.
