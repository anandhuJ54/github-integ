# Spec: <increment title>

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · contracts: [./contracts/](./contracts/)

## Behaviour
What the system does, step by step. Distinguish what the **model** decides from what **deterministic code** decides.

## Acceptance criteria
Numbered, each one testable (becomes a test in Develop).
1.

## Data
- Tables / schemas read and written (owning Surface for each). Writes only to this Surface's schema.
- New objects: for each, name the existing object it extends, or prove none exists (`extend-never-duplicate` result).
- Migration intent (additive only; backup + JOIN verification plan).
- Provenance / trust tier for any fact written.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | typed read, as-of semantics, unknown stays unknown |
| Capabilities | name, typed I/O, idempotency key, dry-run, side effects, entitlement |
| Events | name, version, payload schema, wakes NORA? |
| Entitlement | gate, limits, unmet experience |
| Explanation | templates (authoritative numbers only) |
| Value loop | signal → skill → action → outcome → next signal |

## Security and scope
Principal, delegation, tenant / entity / site scope, RLS impact, grants. Untrusted inputs.

## Compliance
Category compliance rules applied server-side before publish/send (if any output is user-facing).

## Canon review
Result of the `canon-review` skill: conflicts found (flagged, not resolved).

## Second-model review
Summary of the independent review and how disagreements were reconciled.

## Decision log entries
Rulings made for this spec (date, decision, what it blocks).
