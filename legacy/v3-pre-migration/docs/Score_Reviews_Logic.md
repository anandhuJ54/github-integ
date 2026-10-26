# Reviews Bucket — Scoring Logic (v1, the template for all buckets)

## The one category-specific input: ERV
Expected Review Velocity (reviews/month a healthy top performer generates), derived from the
economics layer: ERV = monthly_transactions × review_conversion_rate, floored at 2, capped at 600.
Lives in exp_category_economics (gcid, monthly_transactions, avg_ticket, review_conversion_rate,
erv, pricing_index, evidence) — ONE research pass feeds both scoring normalization AND pricing.
Anchors: restaurant ERV=30 · realtor ERV=4 · convenience store ERV=high-cap.

## Per-review weighted mass
mass(review) = star_factor × age_factor × reply_factor
- star: 5★=1.00 · 4★=0.60 · 3★=0.15 · ≤2★=0 (creation credit)
- age: current (≤30d)=1.0 · recent (31d–12mo)=0.5 · old (>12mo)=0
- reply: replied=1.0 · unreplied=0.5
- negative-reply recovery: replying to a ≤3★ review earns flat +0.20 mass
  (capped at 10% of TargetMass) — negatives never score as reviews, but answering them does.
- burst cap: max countable current-month reviews = 2×ERV; anomalies flag to Curator.

## Score
TargetMass = 6.5 × ERV   (steady state: this month's ERV at ×1.0 + 11 prior months at ×0.5)
Score_reviews = 200 × min(1, Σ mass / TargetMass)
Overflow above the cap is NOT wasted: every point of excess mass accrues to Expertise Signals
(the unbounded number) at 1:1.

## Why 6.5×ERV is the right target (the math honors the brief)
A restaurant doing exactly 30 five-star replied reviews every month holds, at steady state,
30×1.0 (current) + 330×0.5 (recent) = 195 mass = TargetMass → 200/200. A realtor doing 4/month
reaches the same 200/200 — but only after ~12 months of consistency ("eventually gets there").
Equal effort relative to trade velocity = equal score. Volume trades aren't advantaged;
low-velocity trades aren't punished.

## Behavior the shape drives
- Stop generating → current bucket empties in 30 days (−7.7% immediately), then glides to
  zero over 12 months as recents expire. No cliff, no coasting.
- 4★ mix hurts visibly: 30×4★ replied = 120/200. Quality over volume.
- Ignore replies: everything halves → 100/200 max. Answer everything.
- Old-review hoards score 0 → fresh generation is the only path (= the Review Management pitch,
  verbatim: "your 200 reviews are worth nothing to your rank until the engine restarts them").

## Storage & compute
exp_profile_scores.components->'reviews' = {mass, target, current_n, recent_n, replied_rate,
star_mix, score}; pure function over review instances in the graph; config_version tagged;
recompute on review ingest/reply/age tick (nightly).

## Open dials (need a ruling)
star factors (esp. 4★=0.6) · unreplied ×0.5 · negative-recovery +0.20/10% cap ·
burst cap 2×ERV · ERV floor/ceiling (2/600) · reply response-time curve (v2, Curator-tuned)
