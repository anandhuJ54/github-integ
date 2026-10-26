# Reviews Lane — Formula Spec (v2, 2026-07-08 — rescaled to 187 by ruling: 200 was illustrative)

Lane budget: 187 points (= 22% of 850: created 16% + responses 6%)
  = 140 Current-Period creation + 37 Standing + 10 Response-behavior pool.

## Category normalizer
EAR = clamp( annual_transactions × 0.25, min=50, max=1200 )   -- Expected Annual Reviews
  · mortgage_broker: 48×0.25=12 → floor → 50
  · restaurant: velocity → cap → 1200
Source: exp_category_economics.annual_transactions (economics research layer; Curator-maintained).

## Per-review birth value
star_factor: 5.0★=1.00 · 4.5★=0.90 · 4.0★=0.80 · 3.5★=0.70 · ≤3.0★=0.00   (RULED: ≤3★ earns no creation credit)
reply_factor: replied=1.00 · unreplied=0.75
birth_value = star_factor × reply_factor

## Decay (RULED: linear)
value(t_months) = birth_value × max(0, 1 − 0.08 × t)   → worthless at 12.5 months
Average lifetime value ≈ 0.52 × birth over the window → steady-state effective mass
of a consistent operator = monthly_volume × 6.5.

## Current-Period pool (160)
points_per_review = 140 ÷ ( (EAR/12) × 6.5 )
current_score = min( 140, Σ_reviews value(t) × points_per_review )
Guards: monthly countable reviews cap at 2×(EAR/12), excess at steep discount + Curator anomaly flag;
platform-diversity ×1.05 when mass spans 2+ connected sources.

## Standing pool (37) — never decays (RULED)
standing = 37 × min(1, log10(lifetime_count) / log10(2000)) × (lifetime_avg_stars / 5)
  · 4,000 reviews @4.8★ → ~35.5/37 permanent
  · 100 reviews @4.5★ → ~20.2/37
Lifetime volume + lifetime average are first-class differentiators; history floors you up,
never carries you to the top. All lifetime mass also accrues 1:1 to Expertise Signals (unbounded).

## Response-behavior pool (10)
reply_rate × speed curve: ≤7d full · 8–30d half · >30d minimal; negative-review (≤3★) replies
earn here at full value (capped 25% of pool) — negatives never score as reviews, answering them pays.

## Worked steady states (all 5★, all replied)
mortgage (EAR 50): ~4.2/mo → 27.1 effective × 5.17 pts = 140 ✓ (~12 months to fill)
restaurant (EAR 1200): 100/mo → 650 effective × 0.215 pts = 140 ✓
new realtor, month 1: 4 current reviews → ~21 pts current + ~9 standing = ~30 and climbing ✓
veteran coasting (0 new, 4,000 lifetime @4.8): 0 current + ~36 standing (+ response pool if replying) — visible, beatable ✓

## Dependency
EAR requires annual_transactions per category → the economics research batch (also feeds pricing).
v1 launch interim: archetype-level defaults until per-category research lands (Curator upgrades).
