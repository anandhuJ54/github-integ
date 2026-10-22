---
name: nora-ready-contract
description: Write the NORA-ready contract (state read, capabilities, events, entitlement, explanation templates, value loop) for a feature, and the matching JSON Schema / OpenAPI files under contracts/.
---

# NORA-ready contract

For the feature in `spec.md`, define and write to `specs/<slug>/contracts/` (and publish to `contracts/<nn>-<surface>/` on merge):

1. **State read** — typed status object per entity, `as_of`, explicit `unknown`; no UI scraping.
2. **Capabilities** — one per action: name, typed input/output (JSON Schema), idempotency key, dry-run supported, declared side effects, entitlement checked inside, principal + delegation + tenant/entity/site scope, typed errors, emitted event.
3. **Events** — `<domain>.<fact>` past tense, `v<N>`, payload schema; envelope `{id, type, schema_version, owner, aggregate_id, aggregate_version, occurred_at, actor, causation_id, correlation_id}`; mark whether it may wake NORA.
4. **Entitlement** — gate, limits, usage, unmet experience (upgrade path).
5. **Explanation templates** — domain words NORA uses; numbers only from authoritative state.
6. **Value loop** — trigger signal → skill → capability → outcome event → next signal.
Rules: no capability without idempotency; side-effecting actions (send, publish, charge, settings) require confirmation; generated SQL is never a capability.
