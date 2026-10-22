# Spec: Read/write database split (primary + read replica)

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · contracts: [./contracts/](./contracts/)

## Behaviour
What the system does, step by step. Distinguish what the **model** decides from what **deterministic code** decides.

The model decides nothing here — routing is fully deterministic code.

1. Configuration (deterministic):
   - `DATABASE_URL` → primary (writes). Required.
   - `DATABASE_READ_URL` → read replica (reads). Optional; if unset, reads fall back to the
     primary URL so dev / single-node is unchanged.
2. Pooling (deterministic): one lazily-created `ConnectionPool` per distinct URL, reused
   across requests. Rows stay `dict_row`, matching today.
3. Choosing a connection at the call site (deterministic):
   - `write_connection(claims)` → leases from the **primary** pool.
   - `read_connection(claims)` → leases from the **replica** pool.
   - `read_connection(claims, fresh=True)` → leases from the **primary** pool
     (read-after-write; caller opts in explicitly).
4. RLS context (deterministic, unchanged): when `claims` is provided, the lease runs
   `select set_config('request.jwt.claims', <json>, true)` exactly as today, on whichever
   node it landed on. `set_config(..., is_local=true)` is permitted on a hot-standby replica.
5. Backward compatibility (deterministic): existing `connection()` and `rls_connection()`
   names remain as thin aliases so current callers (`migrate.py`, `compliance.py`) do not
   break; new code uses `read_connection` / `write_connection`.

## Acceptance criteria
Numbered, each one testable (becomes a test in Develop).
1. With `DATABASE_READ_URL` set, `read_connection()` leases from the replica pool and
   `write_connection()` from the primary pool (asserted via the resolved URL / pool identity).
2. With `DATABASE_READ_URL` **unset**, both `read_connection()` and `write_connection()`
   resolve to the primary URL (no behaviour change vs today).
3. `read_connection(fresh=True)` resolves to the primary URL even when a replica is configured.
4. When `claims` is passed, the connection has `request.jwt.claims` set (RLS applies);
   when `claims` is `None`, it is not set (service/platform path), matching current semantics.
5. Legacy `connection()` and `rls_connection()` still work and are covered by existing callers.
6. Pools are created lazily and reused (a second call does not open a new pool for the same URL).

## Data
- Tables / schemas read and written (owning Surface for each). Writes only to this Surface's schema.
  - No schema change. This increment touches **connection routing only**. Reads/writes target
    the same tables as today, through the same RLS + governed-function boundary.
- New objects: for each, name the existing object it extends, or prove none exists
  (`extend-never-duplicate` result).
  - Extends `surface-api/_base/core/db.py` in place — no new table, function, or role system.
    No new DB object of any kind. (Catalog check recorded in plan.md.)
- Migration intent (additive only; backup + JOIN verification plan).
  - None. No migration.
- Provenance / trust tier for any fact written.
  - N/A — no facts written by this increment.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | N/A — infra routing; no new typed read surface |
| Capabilities | N/A — no new capability; existing capabilities just lease via the new helpers |
| Events | None |
| Entitlement | None (infrastructure) |
| Explanation | None |
| Value loop | signal (read load on primary) → action (route reads to replica) → outcome (primary headroom) → next signal (connection-source metrics) |

## Security and scope
Principal, delegation, tenant / entity / site scope, RLS impact, grants. Untrusted inputs.

- Principal/scope unchanged: RLS context is still set from the verified JWT on every
  user-scoped lease; the replica enforces the same RLS policies as the primary.
- New secret: `DATABASE_READ_URL` lives in Secret Manager / Vault, referenced by name,
  never committed (root AGENTS.md §3). The replica credential should be a read-only role.
- Write boundary unchanged: writes remain governed functions + service role on the primary.
  No `USING (true)` / grant changes.
- No untrusted input is introduced.

## Compliance
Category compliance rules applied server-side before publish/send (if any output is user-facing).

- N/A — no user-facing output; infrastructure change only.

## Canon review
Result of the `canon-review` skill: conflicts found (flagged, not resolved).

- Ran 2026-10-23. **No canon conflicts.** Checks 1, 2, 4, 5, 6, 7 PASS; 3, 8, 9 N/A.
- Flagged (not resolved): **O12** (new `DATABASE_READ_URL` secret) and **unassigned
  shared-runtime ownership** (`_base` change → all-Surface review + a named owner required).
- Advisory: the replica credential **must** be provisioned as a read-only DB role (the spec
  previously said "should"); treat as a hard requirement at O12 time.
- Governed-write boundary and RLS are preserved (`db.py` adds no DML, policy or grant);
  verdict **clear to proceed on canon**, blocked only on the process items above.

## Second-model review
Summary of the independent review and how disagreements were reconciled.

- Pending.

## Decision log entries
Rulings made for this spec (date, decision, what it blocks).

- None yet. Blocked pending shared-core ownership + O12 acknowledgement for the new secret.
