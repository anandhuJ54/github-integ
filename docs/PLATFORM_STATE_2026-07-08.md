# Platform State — Foundation Locked (2026-07-08)

**27/27 hard PASS** (`tools/verify_platform.sql` — the only authority on platform state).

## What exists
- **4,032 category environments** (universe 4,041; 9 untyped excluded by directive), each with all seven layers:
  knowledge, logic (lane-tagged agent goals, 6–11 per category), classification (fixture-gated types),
  taxonomy (per-level depth floors: product_service/specialization/question/audience/keyword/topic),
  node registry (**729,505 rows**, 10 canonical rings, entity-type-correct facets),
  schema projection (`registry-projection-linted-v1`, lane-isolated CTAs, location=1 lane / both=2),
  compliance (regulators, prohibited phrases, disclaimers — same-pass generation).
- **Exemplars**: real_estate_agents (149 nodes / 183-field projection), mortgage_broker (141 / 292).
- **Moat measurements**: zero sibling pairs >60% term overlap (sushi↔japanese = 16%); patrol 1 removed
  4,129 defect rows + renamed 518 (0.5% of registry) after three rounds of detector self-correction.

## How it was built (the machine)
Batches API generation → reason-injected retry → union-salvage (monotonic) → gauntlet
(vocabulary, per-hop paths, conventions, entity facets, per-level floors, universe gate,
payload parse-validation) → staged waves → grant-bracketed psql (loud-fail, single-txn)
→ suite verification. Two categories hand-finished rather than shortcut.

## Standing rules (all incident-derived, all executable)
Migration files with DELETE/UPDATE never run through bare psql; every emitted gcid gates against
`reference/gcid_universe.json`; every dollar-quoted payload parses before commit; column names come
from live CREATE TABLE, never memory; no splice via re.sub; tests gate commits.

## Open items (owner)
- Key rotation (Scott — directed, pending).
- SECURITY DEFINER views: KEEP AS DESIGNED, revisit at API-boundary build (docs/SECURITY_ADJUDICATION.md).
- Deny-all RLS INFO findings: trigger = public API boundary.
- Quality patrol cadence: rerun sweeps + sampled expert audits per major data change.
- REVIEW_1/REVIEW_2: proposed closed as superseded by adversarial validation.
- Next build: category-specific conversion agents consuming these environments.
