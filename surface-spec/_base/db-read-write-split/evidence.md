# Evidence: Read/write database split (primary + read replica)

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md) · PR: <link>

> Status: **implemented, unit-verified.** Routing + RLS wiring covered by unit tests
> (no live DB). Integration against a real primary+replica pair and pool lifecycle under
> load remain unverified — see below. Do not merge until those are addressed or explicitly
> accepted by the shared-core reviewers.

## Acceptance criteria results
All in `surface-api/_base/core/db_test.py` (7 tests, `uv run pytest _base/core/db_test.py` → 7 passed).

| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | Replica set → `read_connection` uses replica, `write_connection` uses primary | `test_replica_set_routes_reads_to_replica`, `test_read_connection_fresh_uses_primary` | pass |
| 2 | Replica unset → both resolve to primary (no behaviour change) | `test_replica_unset_falls_back_to_primary` | pass |
| 3 | `read_connection(fresh=True)` resolves to primary even with replica set | `test_read_connection_fresh_uses_primary` | pass |
| 4 | `claims` set → RLS context applied; `claims` None → not applied | `test_lease_sets_rls_context_when_claims_present`, `test_lease_skips_rls_context_when_no_claims` | pass |
| 5 | Legacy `connection()` / `rls_connection()` still work | `test_legacy_aliases_exist_and_route_to_primary` + full suite (87 passed) | pass |
| 6 | Pools created lazily and reused per URL | `test_pool_is_lazy_and_reused_per_url` | pass |

## CI gates
Local: `uv run pytest` → **87 passed**; `uv run ruff check _base/` → **All checks passed**.
CI run link: <link> (pending PR).

## Evals (Skills / NORA / AI output only)
N/A — no model output in this increment.

## Live verification (data changes only)
N/A — no data or schema change. Routing-only. (Optional gated integration test against a
primary+replica pair verifies read-after-write on `fresh=True`; record its result here if run.)

## Applied changes
Code only (no migration, no DB object):
- `surface-api/_base/core/db.py` — pooled `read_connection` / `write_connection` + `_lease`,
  `_primary_url` / `_replica_url`, `connection` / `rls_connection` kept as primary aliases.
- `surface-api/_base/core/db_test.py` — new unit tests.
- `surface-api/pyproject.toml` — added `psycopg-pool>=3.2` (`uv sync` → psycopg-pool 3.3.3).
- New config name `DATABASE_READ_URL` (secret, by reference only; unset = primary-only).

## What remains unverified
Be explicit. Untested paths, assumptions, things only production will show.

- Behaviour against a real hot-standby replica (lag characteristics; `set_config(..., true)`
  acceptance on standby) — only a gated integration test and production will show this.
- **Pool lifecycle**: pools open lazily but are not explicitly closed on app shutdown
  (no open-on-startup / close-on-shutdown hook in `app_factory.create_app` yet). Pool sizing
  under real concurrency is also untuned (defaults).
- That every existing read-after-write caller path opts into `fresh=True` — no caller has
  been migrated to `read_connection` yet; current callers still use the primary aliases, so
  no behaviour changed, but the replica is not exercised until callers opt in.

## Change log
`docs/ETL-Enhancements.md` entry — N/A for code-only routing change with no DB function/table/
cron/ETL change. (Confirm at PR time; add an entry if any live DB object ends up touched.)
