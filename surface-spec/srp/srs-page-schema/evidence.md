# Evidence: Serve the Happyflow SRS page from the local database, keeping SRS v5 as is

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md) · [trace](./trace.md) · PR: not opened (nothing is committed for this increment)

**Progress: tasks 0 to 11 are done.** The DDL script, the seed, and the seed re-run for second review finding 1 were each run on `v3_local` with your go-ahead. The DDL script was run on `v3_local` (task 2) and the seed was run on `v3_local` (task 4), each with your go-ahead, after a schema-only backup and a seed backup. Task 11 is done: the canon review of the finished diff and an independent second-model review are recorded in `spec.md` (13 lines of findings and outcomes); its one real finding (seed data) is fixed in the code and in the live data.

## Acceptance criteria results
| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | `GET .../srs` returns the shape for the own seat; another seat 403 before any other read; Supabase session 501; database error 503 | `srp/tests/test_seat_srs.py` (71 tests, fake database), `test_seat_srs_route.py` (17: 200 shape equals `SrsResponse` exactly, 403 with only the ownership query run, malformed ids 403 with no query, 501 with no query, no token and bad token refused, 503 without host or driver text, pool timeout 503, contract); live: 403 without a token, then 200 on 3 seats | **Pass** |
| 2 | Read-only transaction, only `SELECT`, only the Home tables and `srs_lane_gaps`, nothing legacy | Unit: first statement is `set transaction read only`, every later one starts with select, no `for update`, the table list is asserted and `srs_config_`, `user_search_rank_scores`, `ai_authority_stats`, `public.` must not appear; real Postgres: the service's transaction reports `transaction_read_only = on`, writes nothing, and the database refuses an update inside it | **Pass** |
| 3 | 10 lanes, budgets add to 850, `earned + open = max`, earned adds to the total, order by open points then lane position | Unit (62 cases incl. ties and unknown-last) and `test_seat_srs_integration.py` for all 22 live seats of a 26-seat scratch database; live trace: 10 lanes in the expected order on 3 seats | **Pass** |
| 4 | Status: 75% or more is Strong; else Missing if flagged; else locked behind a higher plan; else Fix; boundaries 74/75/76% | Unit: 74, 75, 76 of 100 and 140, 141 of 187; Missing wins over locked, Strong wins over Missing; a feature of the seat's own plan or lower locks nothing; a feature with no lane locks nothing; integration compares with a separately written rule (exact fractions); a plan upgrade unlocks; only the seat's own locked features count | **Pass** (the 0.75 threshold itself is unruled, N3) |
| 5 | `counts` equals the lanes per group, `all` is 10, locked counts as Fix | Unit and integration; live: chips read from the DOM, seat 20 `All 10, Missing 0, Fix 5, Strong 5` | **Pass** |
| 6 | Notes follow the templates with exact numbers; rules for dropping them | Unit: each template, the next-band rule at, below and above the boundary, no rival, no strong lane, no open lane, no action; live: API vs SQL for the three notes on 3 seats | **Pass**; note wording found in the trace is listed under what remains unverified |
| 7 | SRS equals Home for total, band, rank, rival | `test_seat_srs_integration.py`: all 22 live seats compare total, max, band (and next band's points needed), rank, rival, lane points and mock/live label; still equal after a newer snapshot is added; live: 3 seats via HTTP | **Pass** |
| 8 | No seat state or snapshot gives `ready: false` and null sections; the UI then shows the sample | Unit, route and integration tests; UI: `srsModel` returns null for not ready, missing core sections; the route falls back to the sample | **Pass** |
| 9 | The database enforces: one gap per seat and lane, `action_target` list, seat and lane exist, snapshot lane rules | `test_srs_schema.py` (39 tests on a scratch schema built from the real scripts: columns and types, key, unique, check with all 7 targets and 4 refused values, both foreign keys, no cascade, indexes, comments on every column, no RLS, grants, a second run changes nothing, other tables untouched, rollback present); integration: duplicate and bad target refused, lane points above budget refused; live: catalog diff after the script | **Pass** |
| 10 | The seed writes 10 gap rows per seat and 10 short names; second run 0 changes; no person named; Reviews and Articles texts agree with Home counts | `test_seed_home_plan.py` (45, 11 new), `test_seed_home.py`, `test_seed_home_integration.py` (backup holds old gap rows and short names, a deleted row comes back, second run 0 changes, deactivated users skipped); live: inserted 400, updated 10, deleted 0; second run 0, 0, 0; JOINs: 0 mismatches on Reviews you/rival counts, Articles rival count and Articles-vs-first-article flag | **Pass** |
| 11 | UI: a real seat shows the model's values and none of the prototype's; with no real seat the page is the prototype's; each computed field tested | `utils/srs-model.test.ts` (32), `screens/srs-real.test.ts` (26: figures, bar and race widths, ring label, rows, filters, notes, dialog, no rival, top band, unknown lanes, notice), existing `srs.test.ts` (3) unchanged; the sample SRS markup was rendered with the old and the new `srs.tsx`: identical apart from React's `<!-- -->` text separators; mutation checks (see below); live: 169 of 169 page strings on 3 seats, none of the prototype's | **Pass** |
| 12 | The local token reaches exactly six routes | `surface-api/tests/test_local_token_scope.py` (`.../srs` added to the list; every other token-checking route still answers 401 to a local token) | **Pass** |
| 13 | Legacy tables unchanged | Live before/after catalog diff and row counts after the script and after the seed: `srs_config_*` 10/40/30/20/20 rows, `user_search_rank_scores` 400, `ai_authority_stats` 37, and the 17 Home tables' rows, all unchanged | **Pass** |
| 14 | Suites green | See CI gates | **Pass** except the 3 known failures |

**Second review:** see `spec.md` (Second-model review): 4 findings, 1 Medium fixed in code, 1 Low fixed, 2 Low accepted. After the fixes: `srp` suite 637 passed, `bun test` 388 pass, `tsc` clean, `ruff` clean.

**Mutation checks** (break on purpose, confirm a test fails): the schema script 6 ways (all caught after adding tests for the action-target list), the seed plan 12 (all caught after fixing a hidden-by-another-failure run), the seed apply 7, the service formulas 17 (3 survivors fixed with boundary tests), the SQL queries 9 (1 survivor, other seats' locked features, fixed), the route 5 (the missing `response_model` is caught by the contract freshness test), the UI model 20 (3 survivors fixed), the screen 22 (6 survivors fixed). Each survivor became a test.

## CI gates
No CI run: nothing is committed or pushed for this increment. Local runs on 2026-10-27 (`SRP_TEST_DATABASE_URL=postgresql://anandhu@localhost:5432/v3_local`):
- `cd surface-api && uv run pytest` (run through `.venv/bin/python -m pytest`): 2,270 passed and the 3 known `test_migrations_security` failures (`_base`, `campaigns`, `xmp` migrations, none touched here); `ruff check .`: all checks passed. `srp` alone: 635 passed.
- `cd surface-ui && bun test`: 387 pass, 0 fail; `bunx tsc --noEmit -p .` and `-p srp`: clean.
- No `srp_it_*` scratch schema is left in `v3_local`.
- `python3 tools/lint/lint_all.py`, the secret scan, the AI review and `pr-evidence` were **not run** (no PR); `tools/hooks/guard.py` is missing from this checkout, so repo files were written through the shell, as already allowed.

## Evals (Skills / NORA / AI output only)
None: no model is involved; NORA's notes are deterministic templates.

## Live verification (data changes only)
Read-only queries and the two approved changes, all on `v3_local`:
- **Catalog diff** after `srs_schema.sql`: only `srs_lane_gaps` (10 columns, 5 constraints, 4 indexes, grants to `v3_app` only) and `home_score_lanes.short_name` are new; no existing column, constraint, index, trigger or grant differs; row counts of all 98 existing tables equal; `public` empty; no RLS; a second run of the script is identical.
- **Seed:** dry run planned 400 gap rows; real run inserted 400 and updated 10 (the short names), deleted 0; second run 0, 0, 0; only the `srs_lane_gaps` count changed (0 to 400).
- **JOINs:** 40 seats with exactly 10 gap rows, all 400 joined to a lane, a seat and a seat state; 0 mismatches between the Reviews/Articles gap texts and `home_snapshots`/`home_competitors` counts; 0 between the Articles text and `home_weekly_briefs.away_first_article`; `is_missing` only on Articles (14), Q&A (13), Videos (14), Audio (20); every snapshot's lane points still add to its total.
- **Trace:** [trace.md](./trace.md): API vs independent SQL, 0 mismatches on 3 seats; 169 of 169 page strings found; two negative controls caught. After the seed fix: 0 `is_missing` lanes earn points (was 49 of 61 at Strong), 0 mismatches again, 163 of 165 page strings (the other two are layout labels).

## Applied changes
- `surface-api/srp/db/local/srs_schema.sql` applied to `v3_local` on 2026-10-27 after a schema-only `pg_dump` of `srp_cleanup` (`~/Documents/exp-v3/srp_cleanup_schema_backup_before_srs_20261027.sql`, mode 600, outside the repo), with your go-ahead.
- The seed (`seed_home`, `--as-of 2026-10-27`, with `--backup-to ~/Documents/exp-v3/seed_backup_srs_20261027.jsonl`, mode 600) run on `v3_local`, with your go-ahead.
- The seed re-run for the second review's finding 1 (`--backup-to ~/Documents/exp-v3/seed_backup_srs_fix_20261027.jsonl`, mode 600; inserted 0, updated 916, deleted 0; second run 0, 0, 0), with your go-ahead. It changed lane points only: totals, row counts and the legacy tables are unchanged, and Home's per-lane figures (for example points waiting behind locked features) moved with them.
- Nothing applied anywhere else: no Supabase, no `public`, no Alembic migration, no cron, no indexing, no enrichment. Nothing committed.

## What remains unverified
- **Callout and note 1 are built separately** (UI and server): they use the same order today, but could drift if one side changes.
- **Rulings the page depends on and does not have:** the Strong threshold (3/4 of a lane's budget), the stored `is_missing` flag, band thresholds, scoring and identity ownership, O5, the `srp_cleanup` name. The lane points and texts are mock, not produced by the real SRS v5 scorer.
- **Two sources for two counts (N2):** the Reviews and Articles texts repeat counts that also live in `home_snapshots` and `home_competitors`; a seed test and the live JOINs agree today, but nothing stops them drifting if one side is edited by hand.
- **Mock text quirks:** Completeness says "service areas missing" at 94% profile strength; Articles shows `0 vs 6 articles` with 69 of 103 points earned; a strong lane's note can be a bare number (`Q&A is already strong. 2`). A real source or a lane-text ruling would remove them.
- **NORA's notes are not drawn:** the chat UI is off in the prototype, so the notes were verified only API against SQL, and the `thinks` wiring by unit test.
- **Only 3 of 40 seats** were traced in the browser; all 22 live seats of the scratch database are covered by the integration tests, not by the browser.
- **Layouts:** the table layout (wide) was checked on one seat and a screenshot; the list layout (narrow) on the other two; the mobile layout and dark themes were not checked.
- **Count-up and animation:** not covered by SSR tests (effects do not run); read in the browser after the animation finished.
- **Concurrency and large data:** one seat at a time; no load test.
- **The published artifact** of `schema-by-page.md` was not regenerated.

## Change log
Not applicable, **ruled 2026-10-27**: `srp_cleanup` is a local schema outside the Alembic and numbered SQL streams (same stance as `srp/home-page-schema`), so no `docs/ETL-Enhancements.md` entry is required for this increment. The ruling covers the Home, SRS, Profile and Insights increments.
