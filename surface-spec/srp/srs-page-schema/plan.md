# Plan: Serve the Happyflow SRS page from the local database, keeping SRS v5 as is

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

Status: **plan for approval, no code, no SQL run**. `intent.md` and `spec.md` are approved (2026-10-27, including N1 to N8). Root `AGENTS.md` §1 allows no
implementation until this plan is approved. Nothing is committed; the repo's edit-guard hook file is missing, so repo files are written through the shell (as allowed).
**Two gates need your explicit go-ahead during Develop:** running the DDL on `v3_local` (task 2) and the first real seed run (task 4).

## Tasks
Small tasks (≤ ~400 changed lines), in dependency order, each starting from its failing test.

| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|
| 0 | `intent.md`, `spec.md` approved; this plan | `surface-spec/srp/srs-page-schema/` | n/a (documents) | — |
| 1 | **DONE 2026-10-27 (not run on v3_local).** DDL script: `srs_lane_gaps` (constraints, indexes, comments, grants), `home_score_lanes.short_name`, commented rollback. No trigger or function is added: the foreign key to `home_score_lanes` already makes a gap row name one of the 10 lanes (spec criterion 9). Re-runnable, one transaction | `surface-api/srp/db/local/srs_schema.sql` (new, ~120 lines), `surface-api/srp/tests/test_srs_schema.py` (new) | Applies Home scripts then this one to a scratch schema (same fixture as `test_home_schema_hardening.py`) and checks: table and column exist, unique (seat, lane), CHECK on `action_target`, FKs refuse bad rows, no RLS, no anon/authenticated/PUBLIC grant, `v3_app` has the four privileges, second run is a no-op, existing 17 tables unchanged | 0 |
| 2 | **DONE 2026-10-27 (go-ahead given).** Apply on `v3_local`: schema-only `pg_dump` backup, run the script, verify | none in the repo; backup outside it (`~/Documents/exp-v3/`, mode 600) | Before/after catalog diff: only `srs_lane_gaps` and `short_name` are new; the 17 Home tables' rows and the legacy `srs_config_*` / `user_search_rank_scores` / `ai_authority_stats` row counts unchanged (criterion 13) | 1, your go-ahead |
| 3 | **DONE 2026-10-27.** Seed plan (pure): the 10 gap rows per seat and the 10 short names, deterministic, from the same hashed values as snapshots and competitors | `seat/seed_home_plan.py` (extend, ~120 lines), `tests/test_seed_home_plan.py` | Invariants: 10 rows per seat, one per lane, `action_target` in the CHECK list, `is_missing` only on the lanes that can be absent (Articles, Q&A, Videos, Audio; Articles is missing exactly when the Home brief says no first article), the Reviews and Articles texts carry the same numbers as `review_count` / `article_count` (criterion 10), same input same output, no person's name | 1 |
| 4 | **DONE 2026-10-27 (go-ahead given; live run: inserted 400, updated 10, deleted 0; second run 0 changes).** Seed apply: `srs_lane_gaps` in `_TABLES`/`_SEAT_COLUMN`, `apply_plan`/`_sync`, `_backup_rows`, short names in the reference pass; then run on `v3_local` (dry run, real run with `--backup-to`, second run) | `seat/seed_home.py` (extend), `tests/test_seed_home.py`, `tests/test_seed_home_integration.py` (add the table) | Real Postgres in a scratch schema: coverage, second run changes 0 rows ids included, backup holds old rows, a real run without `--backup-to` refused; live: row counts and JOIN counts (every seated user has 10 gap rows), re-run 0 changes | 2, 3, your go-ahead for the live run |
| 5 | **DONE 2026-10-27.** SRS read: ownership, `ready`, `score`, `rank`, `rival`, `lanes` (earned/open/status/order), `counts`, `notes` | `seat/srs.py` (new, ~220 lines; imports `_band`, `_rank`, `_rival`, `_forbidden`, `_iso`, `_ID` from `home.py`), `seat/schemas.py` (`SrsResponse`), `tests/test_seat_srs.py` | Fake-DB unit tests (SQL markers, read-only, only `SELECT`) and formulas: status boundaries 74/75/76%, missing, locked, order and ties, counts, each note template and its drop rule, `ready` false | 2 |
| 6 | **DONE 2026-10-27.** Route, contract, token scope | `seat/router.py` (route, 403/501/503 as Home), `contracts/srp/openapi.json` (regenerate), `tests/test_seat_srs_route.py`, `surface-api/tests/test_local_token_scope.py` (six routes) | 200 shape, 403 before any other read, 501 for Supabase, 503 without driver text, a local token refused on every other route, contract test passes | 5 |
| 7 | **DONE 2026-10-27.** Real-Postgres read tests incl. SRS = Home equality | `tests/test_seat_srs_integration.py` (new) | Scratch schema with the Home and SRS scripts: criteria 3, 7, 8, 9 (lane sum 850, `earned + open = max`, same total/band/rank/rival as `home.home`, no snapshot → `ready` false, constraints refuse bad rows) | 5, 6 |
| 8 | **DONE 2026-10-27.** UI model: `SrsModel`, `srsModel(response)`, `sampleSrsModel()` from the current constants, `useSrsApi` | `surface-ui/srp/src/utils/srs-model.ts` (new), `utils/srs-model.test.ts`, `utils/seat-wait.ts` or a sibling hook, `home-context.tsx` pattern reused | Sample model equals every constant it replaces (table of values); `srsModel` maps every field, handles `ready` false, null rival, fewer than 3 notes, `Fix · locked` counted as Fix | 6 |
| 9 | **DONE 2026-10-27.** `srs.tsx` reads the model; `srs-page.tsx`; route `nora.tsx`; guard counts | `screens/srs.tsx` (~1,070 lines, touched where literals are), `components/happyflow/srs-page.tsx` (new), `routes/_authenticated/seat.$kind.$id.nora.tsx`, `happyflow-guard.test.ts`, `screens/srs.test.ts` (existing, unchanged) + new render tests | Existing `srs.test.ts` and render tests pass unchanged for the sample; real-model render tests: ring, band marker, rank, rival, 10 lanes in order, counts, filters, notes, dialog numbers, none of the sample constants; no `fetch` in Happyflow; `tsc` app and `srp`; mutation checks on each computed field | 8 |
| 10 | Click-through and evidence: restart the SRS API and UI, sign in as a day 1, a day 7 and a day 24 seat, trace every SRS value to a row with independent SQL, compare with Home, negative control; fill `evidence.md`; update `schema-by-page.md` | `evidence.md`, `trace.md`, `surface-spec/srp/schema-by-page.md` | Trace per user; a copy with deliberate errors is caught | 9 |
| 11 | **DONE 2026-10-27 (live data fix waits for a go-ahead).** `canon-review` on the finished diff and an independent second-model review of the DDL, seed, formulas and ownership check; reconcile and record | `spec.md` (Second-model review), `evidence.md` | Each finding fixed with a test that fails without the fix, or recorded; mutation checks | 10 |

## Extend-never-duplicate check
Checked 2026-10-27, read-only, against the live `v3_local` catalog and the repo:
- **Live:** relations matching `gap`, `lane` or `short`: only `home_score_lanes` and `home_snapshot_lanes` (this increment extends the first); functions matching `lane` or `srs`: only
  `home_snapshot_lane_check` and `home_lane_max_check` (the Home triggers, reused unchanged). No table holds a lane comparison, action or short label.
- **Repo:** no file outside the Home increment names `srs_lane_gaps` or a lane `short_name`.
- **Nearest existing structures and why they are not extended:** `srs_config_*` and `user_search_rank_scores` (the legacy 29-point model the user asked to leave untouched), `home_nora_insights`
  (its `action` check allows only `voce`, `reviews`, `insights`; Home-specific), `home_locked_features` (read for the locked status, not changed), `ai_authority_stats` (no denominator).
- **Reused, not duplicated:** `seat/home.py` (`_band`, `_rank`, `_rival`, `_forbidden`, `_iso`, `_ID`, read-only transaction), `seed_home.py` / `seed_home_plan.py` (`_sync`, hash helpers, backup, guards, `--as-of`),
  the scratch-schema test fixtures, the contract generator, `home-model.ts` and `home-page.tsx` patterns, `local.is_local_session`, `current_srp_user`.
- **No new** route family, role system, outbox, entitlement table or price constant. No SRS v5 function is touched; `public` is not read.

## Migration plan
Not an Alembic migration and not part of the closed SQL stream (same stance as `home_schema.sql`: `srp_cleanup` is a local schema, no change-log entry).
- **File:** `surface-api/srp/db/local/srs_schema.sql`; `if not exists` / guarded `do` blocks throughout; one `begin ... commit`; runs after `home_schema.sql` and `home_schema_hardening.sql`.
- **Backup:** `pg_dump --schema-only --schema=srp_cleanup v3_local` to a private file outside the repo (mode 600) before the run; the seed's `--backup-to` covers the new rows afterwards.
- **Apply:** only on `v3_local`, only after your go-ahead (task 2), as the owner role `anandhu`.
- **Verify:** catalog query (new table and column, constraints, indexes, grants, no RLS, legacy tables and the 17 Home tables unchanged); after the seed, JOIN counts: every seated active user has 10 gap rows, each joined to a lane.
- **Rollback:** commented block at the end of the script: `drop table srp_cleanup.srs_lane_gaps`, `alter table srp_cleanup.home_score_lanes drop column short_name`, drop the new trigger function; nothing else is dropped. The schema-only backup is the second fallback.

## Test plan
- **Backend unit** (no database): `test_seed_home_plan.py`, `test_seed_home.py`, `test_seat_srs.py` (SQL markers, formulas, status boundaries, notes).
- **Backend real Postgres** (skipped unless `SRP_TEST_DATABASE_URL`; scratch schemas `srp_it_*`, dropped after, 0 left): `test_srs_schema.py`, `test_seed_home_integration.py`, `test_seat_srs_integration.py`. Fixtures run the real scripts, so the scripts themselves are tested.
- **Route and contract:** `test_seat_srs_route.py`, `test_local_token_scope.py` (six routes), `tests/test_contracts.py` after regenerating the contract.
- **UI** (`bun test`, SSR render, no DOM): `srs-model.test.ts`, existing `srs.test.ts` unchanged, new real-model render tests, the Happyflow guard, `tsc` for the app and `srp`.
- **Mutation checks** (break on purpose, confirm a test fails): the 0.75 boundary, the status order, lane order and ties, the notes' drop rules, the ownership check, the SRS = Home equality.
- **Browser** (built-in): three users on three layouts; the trace script is a scratch tool outside the repo.
- Acceptance criteria map: 9 and 13 to tasks 1-2; 10 to tasks 3-4; 1-6 and 8 to tasks 5-7; 7 to task 7; 12 to task 6; 11 to tasks 8-9; 14 to every task.

## Risks
- **Two sources for two counts** (N2): the Reviews and Articles texts repeat counts that also live in Home columns; the seed test is the guard, and a later real source replaces both.
- **Sample parity:** the sample view must stay byte for byte the same; the existing `srs.test.ts` and render tests guard it. `srs.tsx` has many literals (notes, dialog, subtitle); a literal missed leaves a sample number on a real page, so the render tests list the constants that must not appear.
- **Status rule is a guess** (N3, N4): 0.75 and `is_missing` are not ruled; the page says mock. A real scorer would replace both.
- **Shared-core touch:** the six-route scope test; reviewed for all Surfaces.
- **Order and ties:** equal open points order by lane position; tested so the screen is stable.
- **Mock scorer / merge:** merge stays blocked on the rulings listed in the spec's canon review; local use is fine.
- **Gates:** tasks 2 and 4 change the database; they do not start without your go-ahead; a failed run rolls back (one transaction) and backups are taken first.
