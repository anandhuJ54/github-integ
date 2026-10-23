# Search Rank Score — All Lanes (v1 draft for Scott's lane-by-lane review)
# 850 total. Reviews LOCKED (40c9c5c). Every lane: normalizer / factors / decay / formula /
# minimums. Overflow from every capped lane accrues 1:1 to Expertise Signals (unbounded).

## LANE BUDGETS (850)
completeness 153 · reviews 187 · website+schema 102 · GBP connection 68 ·
credentials 68 · articles 85 · directories 51 · posts/freshness 51 · Q&A 34 · social 34 · videos 17
(= the ratified 100-point element model × 8.5, exactly — no rounding drift)

────────────────────────────────────────────────────────────
## 1. REGISTRY COMPLETENESS — 153 · structural, NO DECAY OF ANY KIND (RULED)
Normalizer: the category's OWN registry (point budget over its nodes; expands when the
person adds categories — composed registry is the denominator).
Factors: node points (ring-weighted formula from registry priority) × evidence tier
(verified oauth/etl ×1.0 · platform ×0.7 · manual ×0.4); required nodes double-weighted.
Formula: 153 × Σ(node_pts × tier) / composed_registry_budget   -- no staleness term (RULED)
Minimums: required nodes per category (license/NPI class for regulated); missing required
→ lane uncapped but GLOBAL score caps at 400 (the Building gate, already ruled).

## 2. WEBSITE + SCHEMA (primary citation) — 102 · verified state, punishment-decay only
Sub-budgets: our JSON-LD installed & valid 42 · NAP matches profile exactly 30 ·
crawlable/indexed 20 · category service-page depth 10.
Decay: none while healthy; failed re-crawl/removed schema → −25pts/mo linear until fixed
(broken primary citation bleeds fast — it is the single voice of truth).
Minimums: universal; no category variance. No site at all = 0 (heaviest single miss after reviews).

## 3. GBP CONNECTION — 68 · verified state + category norms
Sub-budgets: oauth verified 38 · Google-side completeness vs category norm 20
(categories match ours, hours, photos ≥ archetype norm: restaurant 30 photos, consultant 5) ·
sync activity 10.
Decay: token death → 30-day grace → 0. Timing: instant on connect.

## 4. CREDENTIALS & AUTHORITY — 68 · no time decay; hard expiry
Normalizer: the category's authority-ring registry (mortgage: NMLS+state license;
physician: license+board+NPI; plumber: contractor license+bond; unregulated: certs/awards).
Factors: regulator-verified ×1.0 · document-upload ×0.6 · self-attested ×0.3;
diminishing after the category's core set (log past 4).
Decay: none — credentials expire (hasCredential.expires); expired = 0 + Curator flag.
Archetype shift: YMYL categories draw +15 here (from posts/social) per the E-E-A-T rule.

## 5. ARTICLES (VOCE) — 85 = 70 current + 15 standing  (unchanged: 10% × 8.5) · the reviews clone, slower clock
Normalizer: EAP (Expected Annual Publications) by category content velocity — floor 6, cap 52.
Birth value: on-taxonomy topic ×1.0 · off-category ×0.4 · syndicated/cited bonus ×1.1.
Decay: linear −5.5pts/mo → worthless at 18 months. Steady-state effective ≈ monthly×9.25.
Formula: pts_per_article = 70 / ((EAP/12) × 9.25); current = min(70, Σ value×pts)
Standing: 15 × min(1, log10(lifetime)/log10(300)) — the library is an asset.

## 6. DIRECTORIES & CITATIONS — 51 · structural, consistency-gated
Normalizer: the category's OWN presence-ring directory list (vertical-correct by construction).
Factors: verified ×1.0 · claimed-unverified ×0.6; NAP-consistent ×1.0 · inconsistent ×0.2
(inconsistency is a negative signal — near-zero beats wrong); diminishing after 5 (log).
Decay: none; recheck failures drop the row. Minimum: 3 consistent citations any category.

## 7. POSTS / SHARING / FRESHNESS — 51 · pure rolling window (90 days), no standing
Normalizer: archetype posting norm (venue 12/mo · trade 4/mo · professional 4/mo · civic 8/mo).
Sub-budgets: cadence vs norm 38 · profile-touch freshness 13 (any verified update ≤30d).
Decay: window IS the decay — activity older than 90 days simply isn't in it.

## 8. Q&A — 34 · coverage model, not velocity
Factors: % of the category's question-taxonomy answered on-profile (24) ·
GBP Q&A ownership — asked-and-answered on Google (10).
Staleness: answers older than 24mo drop ×0.5 until refreshed.
Minimum: 10 questions floor for all categories (every category has ≥10 in taxonomy — floors built).

## 9. SOCIAL PRESENCE — 34 · corroboration + pulse
Factors: verified profiles on category-relevant platforms from the presence ring (24;
diminishing after 3) · account activity pulse (10; dormant >90d halves that account's credit).
Decay: via dormancy only.

## 10. VIDEOS — 17 = 13 current + 4 standing · reviews clone, slowest clock
Normalizer: EAV floor 2/yr, cap 24. Birth: on-category ×1.0, off ×0.4.
Decay: linear → worthless at 24 months. Standing: 4 × log-scale to 100 lifetime.

────────────────────────────────────────────────────────────
## CROSS-LANE RULES
· Every capped lane's overflow → Expertise Signals 1:1 (nothing earned is wasted)
· Evidence tiers everywhere: verified > connected > claimed (0.4 default for claims)
· All velocity normalizers (EAR/EAP/EAV/posting norms) live in exp_category_economics —
  one research batch feeds scoring AND pricing; archetype defaults at launch, Curator upgrades
· All dials are Curator-audited sections; every formula versioned (score-config-v1)
· Global gate: missing category-required credentials → total score caps at 400 (Building)
