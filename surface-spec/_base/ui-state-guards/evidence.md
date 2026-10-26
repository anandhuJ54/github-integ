# Evidence: UI store and layout guards; setup and docs follow the UI restructure

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · PR: see the PR for branch `fix/ui-state-guards`

## Acceptance criteria results
| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | A Surface importing another Surface or `@v3/shell` fails | `state/boundaries.test.ts`, planted `reports/src/state/bad.ts` | fails as expected; file removed |
| 2 | A Surface slice named or read across Surfaces fails | same planted file (`name: "admin"`, `s.sales`) | fails as expected |
| 3 | API calls in a Surface's `src/state/` fail | same planted file (`api.get`) | fails as expected |
| 4 | Today's code passes the guards | `cd surface-ui && bun test` | 57 pass, 0 fail |
| 5 | `./setup.sh --check` works on a fresh checkout | fresh worktree, no `.venv`/`node_modules`/`.env` | env files created at `surface-api/.env`, `surface-ui/.env`; ruff clean; tsc for the app + 15 Surfaces; bun test 57/57 |
| 6 | The app still builds | `cd surface-ui && bun run build` | built |
| 7 | No behaviour change | parity, `tools/parity`, all 10 suites, API on :8011 | 524/524 (3 legacy-side DB timeouts under parallel load passed when re-run alone) |

## CI gates
`core-gates` has not run on PRs into `main` (Actions setting; no checks on #5–#9). Run locally instead, above.

## Evals (Skills / NORA / AI output only)
None: no model output.

## Live verification (data changes only)
None: no data change.

## Applied changes
None: no migration, no DB change.

## What remains unverified
- `pytest` after merging `main` (#9): 1,608 pass, **3 fail**, and they fail the same on `main` without this
  branch: `test_new_tables_are_closed_to_anon_by_grants` for `_base` 140d9efec771, `campaigns` ec94892239fd and
  `xmp` bee7556b77dd. The migrations have no `REVOKE ALL ON <table> FROM anon, authenticated, PUBLIC`.
  Owned by #9's authors; not changed here.
- The guards are static regex checks: a selector written in an unusual shape can slip past.
- Parity ran against the branch before the merge of #9; #9 changes no route parity covers except through
  `_base/db/sql.py`, which pytest covers.

## Change log
No `docs/ETL-Enhancements.md` entry: no DB function, table, trigger, cron or ETL change.
