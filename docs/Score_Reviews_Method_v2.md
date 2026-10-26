# Reviews Score — Simplified Method v2 (RULED 2026-07-12)

Per-profile score, 0–187 points. Category enters through ONE input: EAR (exp_category_ear).

## The five lines
1. **EAR** = clamp(0.25 × annual_transactions, 50, 1200)   ← per category, from economics batch
2. **RVE** = reviews_12mo × (avg_rating ÷ 5) × (1 − avg_age_months ÷ 12.5)
3. **Current** (max 140) = 140 × min(1, RVE ÷ (0.54 × EAR))
4. **Standing** (max 37) = 37 × min(1, log₁₀(lifetime_reviews) ÷ 3.3) × (lifetime_avg ÷ 5)
5. **Response** (max 10) = 10 × reply_rate

**Reviews Score = Current + Standing + Response**  (verified: Joe = 179)

## Ruled refinements
- **≤3★ tail exactness (Ruling 1):** profiles with ≥15% of reviews at ≤3★ use the exact per-review star
  ladder (5★=1.0, 4.5=0.9, 4=0.8, ≤3★=0) in place of avg_rating÷5, which is too kind to bad-review tails.
  Per-review data is retained at ingestion, so this is a compute choice.
- **Both-lane (Ruling 4):** professional-entity profiles read ear_professional; establishment profiles read ear.
- **non_reviewable categories:** floored EAR, flagged — infrastructure/civic objects don't get customer reviews.

## Provenance (honesty tags)
- `ruled`: star ladder, 12.5-mo decay, 187/140/37/10 split, the five-line form.
- `prior` (launch values, awaiting the validation program — NOT proven to predict search outcomes):
  25% conversion rate, 50/1200 clamps, 0.54 equilibrium factor (6.5-mo horizon), log₁₀ standing curve, linear response.
- `fitted` (future): replace priors with values regressed on observed search outcomes + transaction_signals data.

## Gates still open before this faces a user
Contract questions unresolved: (1) is the public promise *prediction*? (2) split Score from Signals?
(3) fund the validation program? The EAR table + method are BUILT; whether the number ships is gated on these.
