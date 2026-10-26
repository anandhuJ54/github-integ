# Articles Score — Standalone Method v1 (RULED 2026-07-12)

Per-profile, 0–85 points. NOT tethered to reviews. Category enters via EAA (exp_category_eaa).
Engagement (views/likes/shares) and article quality are DELIBERATELY EXCLUDED (orphaned to Signals/dashboards).

## The three lines
1. **EAA** = clamp(annual_transactions / 12, 18, 40)     ← per category
2. **AVE** = Σ over articles of max(0, 1 − age_months / 18)   ← 18-month linear decay to zero, exact per-article
3. **Articles Score** = 85 × min(1, AVE / EAA)

Verified: 100 articles, avg age 8mo → AVE 55.6 → 85/85 in every band (mortgage EAA 18, cap EAA 40).

## Ruled
- 85-pt cap, 18-month linear decay, 18/40 clamp, /12 cadence anchor, standalone three-line form.
- Maintainability property (ruled intent): prolific authors above the cap hold 85 at steady state.
- Both-lane: professional profiles read eaa_professional; non_authored categories floored + flagged.

## Provenance
- `ruled`: the three-line form, 85 cap, 18-mo decay, 18/40 clamp.
- `prior`: /12 cadence anchor, 18/40 values — launch, first validation targets.
- `fitted` (future): replace with per-category cadence regressed on real ranking outcomes.
