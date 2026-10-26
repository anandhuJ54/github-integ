# Volume-Lane Governing Rule (RULED 2026-07-12)

One pattern behind Reviews, Articles, Posts, Videos, Q&A:

**Score = MaxPoints × min(1, DecayedCount ÷ CategoryTarget)**

- **DecayedCount** = Σ each item's freshness = max(0, 1 − age ÷ decay_window). (Q&A: no decay, freshness=1.)
- **CategoryTarget** = clamp(annual_transactions ÷ divisor, floor, ceiling). Bounded so most categories bind floor/cap.
- **min(1, …)**: cap reachable and holdable; excess = headroom vs decay, not overflow.

| Lane | MaxPts | Decay window | Clamp (÷divisor, floor–ceiling) | Table |
|------|--------|--------------|--------------------------------|-------|
| Reviews | 187 | 12.5 months | ÷4 (25%), 50–1200 | exp_category_ear |
| Articles | 85 | 18 months | ÷12, 18–40 | exp_category_eaa |
| Posts | 51 | 90 days | ÷12, 12–20 | exp_category_eap |
| Videos | 17 | 24 months | ÷48, 6–15 | exp_category_eav |
| Q&A | 34 | none | ÷24, 10–25 | exp_category_eaq |

Principle: **"are you currently as active as a healthy business in your category, on this content type?"**
Slower/heavier content → longer decay window, smaller clamp band (rarer per business). Sustained presence,
not lifetime accumulation (except Q&A). Category-relative via transactions.

Provenance: all divisors/clamps/windows = `prior` (launch, pending validation). Point weights + the rule form = `ruled`.
