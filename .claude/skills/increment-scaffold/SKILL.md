---
name: increment-scaffold
description: Create a new increment folder (intent, spec, contracts, plan, evidence) for a Surface from the shared templates plus the Surface's template additions. Use at the start of any feature, fix or schema change.
---

# Increment scaffold

1. Identify the owning Surface from `.github/CODEOWNERS` (path → Surface). If the change spans Surfaces, scaffold in the Surface that owns the write, and list the other Surfaces' contracts it uses.
2. Choose a short kebab-case slug. Create `spec/<surface>/<slug>/`.
3. Copy `templates/intent.md`, `spec.md`, `plan.md`, `evidence.md` into it. Put any machine-readable interface schemas for the increment under `contracts/<surface>/`.
4. If the Surface ships a `spec/<surface>/template-additions.md`, append each listed section to the matching file **without removing any shared section**.
5. Fill the header table in `intent.md` (Surface, increment id, status `draft`, date).
6. Start Define: fill `intent.md` with cited sources (Live / Repo / Programme input / Target). List open decisions touched; never resolve them.
7. Stop for human approval of `intent.md` before writing `spec.md`.
