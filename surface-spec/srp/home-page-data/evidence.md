# Evidence: Show real data on the Happyflow Home page from `srp_cleanup`

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md) · PR: not opened (nothing is committed)

**Progress: all 7 tasks are done (the mock-data seed; the Home read service and its SQL; the route, allowlist and contract; the UI
types, mapping, hook and provider; the Home page; the three-user trace; the canon and second-model reviews, task 7). Merge is blocked on
the rulings named in the spec's canon review; "What remains unverified" is still open.**

## Acceptance criteria results
| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | Endpoint returns 200 with exactly the documented keys | Route test (fake database, real service): 200, exactly the 8 keys, and the body round-trips through the published `HomeResponse` schema unchanged; live HTTP on the seeded `v3_local` (user 7, seat 34: 200, same 8 keys) | **Pass** |
| 2 | Another/malformed seat, deleted/deactivated user: 403, ownership query first | Unit, real Postgres and route tests (another seat 403 with exactly one query; another user 403; malformed ids 403 with no query); live HTTP: seat 19 and `abc` for user 7 are 403 `not_your_seat` | **Pass** |
| 3 | Supabase session 501, no token 401, flag off 401 | Route tests: a non-local session gets 501 `not_implemented` with no query; no token is refused (the framework answers 403 "Not authenticated", as on every SRP route); a local token with the flag off is 401 with no query; a garbage token 401; live HTTP: no token 403, tampered token 401 | **Pass.** The spec says "401/403" for no token, which this meets; the Supabase-session 501 was not run live (no Supabase token here) |
| 4 | Only `SELECT`, one connection, no lock | Unit: every recorded statement starts with `select`/`with`, no `for update`, one connection; real Postgres: row counts unchanged after a read | Pass |
| 5 | Score total, max, categories, basis; all-NULL is an unknown total | Unit and real Postgres (all-NULL seat has `total` null and 4 categories; max = sum of known config maximums = 20; shared helper also used by the seat read) | Pass |
| 6 | Rank: null rules, position, ties | Real Postgres with 12 peers and two ties: tied seats share position 1, the next is 3; <10 peers, no zipcode, all-NULL scores, a ghost row and a soft-deleted seat are not ranked / not peers | Pass |
| 7 | VOCE excludes archived; website latest row; AI latest or null | Real Postgres (archived article excluded, draft not published, newest website and AI rows, none gives null) | Pass |
| 8 | Credentials and year started | Unit and real Postgres (non-array JSON is 0; "n/a" year is null) | Pass |
| 9 | `unavailable` is the fixed list | Unit | Pass |
| 10 | Exactly five routes accept a local token; every other token-checking route refuses it | `tests/test_local_token_scope.py` (allowlist now five; the 516+ other routes, the review routes and the `optional_user` routes still return 401); live HTTP: dashboard, `/srp/me`, location seat with a local token are 401 | **Pass** |
| 11 | The contract has the path and its schema | `contracts/srp/openapi.json` regenerated (+457 lines, 0 removed): the path with 200/403/422/501, `HomeResponse` and 8 nested schemas, `basis` fixed to `cleanup_config`; `tests/test_contracts.py` and a route test that reads the file pass | **Pass** |
| 12 | The seed is idempotent and gives every seat coherent data, backs up first, prints counts only | Unit (`test_seed_home.py`, 18 tests: determinism, order independence, bounds, peer groups, variety, labels, backup file, CLI); real Postgres (`test_seed_home_integration.py`, 7 tests in a scratch schema: coverage, old rows replaced, **second run changes nothing, ids included**, backup contents, dry run writes nothing, existing backup stops the run first, deactivated users skipped); live run on `v3_local` (below) | **Pass** |
| 13 | `homeView` returns a value or `unavailable` per tile; no denominator without a source | `utils/home-data.test.ts` (31 tests): sample vs real; score with and without a known maximum, null total and null section unavailable, never 0, never "850"; categories (an unknown score reads "Unknown"); rank with a city or a ZIP; VOCE singular/plural and a real zero; website without "of 102"; AI authority by name without "of 7", one known number is enough; credentials; the fixed list of 15 unconnected items including the 8 the API names; `realParts` order | **Pass** |
| 14 | Rendered Home shows real values and none of the demo constants; null sections say Not connected yet | `screens/home-real.test.ts` (19 render tests): for day 1, day 7, day 7 with events and day 24 with full data, the page contains the real score, "OF 29", "#2 of 14", the city, "Website score 91", "Authority score 49 · 5 answers", "3 of 4 articles published", "2 credentials", the year, "5 of 5" and "Unknown", and none of 22 demo figures (390, 418, 471, 571, "9 of 49", "4.9", "128 reviews", "64%", "127 points", Riverbend, Davenport, "Day N of 30", Trial, Compare plans, NORA recommends, Maria L., Up 28 and others), no "of 850" and no "of 102"; all 15 unconnected items are named with "Not connected yet"; with score, rank, website and AI sections null each shows it instead of a number; no articles reads "No articles yet"; the year picker is disabled, preselected and says saving isn't connected; a missing year reads "Not set"; day 1 and day 7 render the same text. Browser as user 7 (day 1 and `?day=7`): zero demo figures on the page, 17 "Not connected yet", the score ring "20 of 29" labelled "Score (cleanup schema)", "#2 of 14 in Denver", ten categories ("5 of 5", "3 of 7", "Unknown"...) | **Pass** |
| 15 | With no seat the Home is exactly today's page | The existing render tests pass unchanged; new tests render the sample day 1 (Riverbend, 384 before the count-up, "Day 1 of 30", Compare plans, Trial) and day 7 (418, "Day 7 of 30") with no data; the other Happyflow pages (checked: Profile) keep their sample notice | **Pass** |
| 16 | Happyflow components make no fetch; data reaches them through the context only | The loader and hook live in `utils/home-data.ts`; the layout calls the hook and hands the data to `HfHomeProvider`; the Happyflow source guard passes (file-count raised 24 to 25 for `home-context.tsx`); provider tests: sample outside a provider, sample with no data, real with data | **Pass** |
| 17 | Browser traces for two users: every number on the wired tiles matches a row in `srp_cleanup` | Three users signed in through the real form, each landing on their own seat; every figure the Home showed was read from the page and traced to raw SQL written separately from the app's queries (a window-function `rank()` for the rank, plain sums, joins and counts): **80 items, 0 mismatches**. Full output in `trace-2026-10-27.txt` (names masked). A negative control (four figures deliberately wrong) is flagged four times | **Pass** |
| 18 | Static checks (backend rows below; UI: `bun test` 249 passed, `tsc` clean for the app and `srp`) | `ruff` clean; `pytest` 1,839 passed, 38 skipped (real-Postgres tests need `SRP_TEST_DATABASE_URL`; with it `srp` and `tests` pass, 322), 3 failed (the migration-security tests that failed before this work) | Pass. After task 7: `pytest` 1,901 passed with `SRP_TEST_DATABASE_URL` set, 3 failed (the same three); `ruff` clean; `bun test` 249 passed; contract regenerated, `tests/test_contracts.py` 16 passed; no scratch schema left |

## Trace: what the Home showed against `srp_cleanup` (2026-10-27)
Three users signed in with the real sign-in form and each landed on their own seat. The Home was read from the page (not from the API),
and each figure was compared with SQL run straight against `v3_local`, written independently of the app's queries. Items traced per user:
the seat in the URL, the sidebar name, the score total and its maximum, rank position, peers and market, website score, AI authority score and
answers (or "Not connected yet"), articles published and total, credentials, year started (text and picker), all 10 categories, and that none of the 22
demo figures appears.

| User | Seat | Score (cleanup) | Rank | Website | AI authority | Articles | Credentials | Year | What the user shows |
|---|---|---|---|---|---|---|---|---|---|
| 7 | 34 | 20 of 29 | #2 of 14, city shown | 91 | 49 · 5 answers | 3 of 4 published | 2 | 2008 | full data |
| 4 | 19 | 17 of 29 | #7 of 14, city shown | 88 | 29 · 2 answers | 3 of 4 published | none (real zero) | 2017 | a user with two seats lands on the lowest, 19 (the other is 37) |
| 10 | 30 | 13 of 29 | #10 of 13, **"ZIP 52803"** (the seat has no location city) | 93 | **Not connected yet** (no AI row) | 0 of 1 published | none (real zero) | 2020 | the edge case: no AI row, an unpublished article, no city |

Results: **80 items, 0 mismatches**. Also seen: each page has 17 "Not connected yet" (the 15 named tiles, the header's plan chip and the section
heading), and 18 for user 10 (the AI tile too). Categories with no known maximum read "Unknown" in all three (categories 3, 5, 6 and 8 in the
config); category 10 reads "0 of 0". Sign-out and sign-in worked each time through the new Sign out button.

How the trace is known to be able to fail: a copy of user 7's readings with four figures changed (total 21, rank 3, one category, one demo figure)
reported exactly those four mismatches.

## CI gates
No CI run; nothing is pushed. Local: `ruff` all checks passed; `pytest` as above; all real-Postgres tests (seed and Home read) were run against `v3_local`
in scratch schemas and passed, and left none behind.

**Do the tests catch mistakes?** The real-Postgres Home tests were checked by breaking the SQL on purpose, eight ways (ties counted
as higher, archived articles counted, oldest website row picked, deactivated user allowed, null totals counted, peer minimum lowered,
soft-deleted seats counted as peers, ghost seats counted). All eight are now caught; the soft-deleted-seat case first survived, so a
fixture for it was added and the break re-checked.

## Task 7: canon review and second-model review
Both are recorded in `spec.md` ("Canon review", "Second-model review", decisions R1 to R3). The independent review raised 12 findings:
9 fixed with a test each, 2 documented (seed market drift and the vertical mismatch; missing indexes, finding 6, accepted for local mock data),
none rejected. Read side, new real-Postgres scenarios: a two-market seat, a null-zip seat, duplicate and unknown-category score rows, a deleted
location, NULL published/refresh times, AI-row id tie-break, a soft-deleted peer, and a write refused inside the read-only transaction;
the seed got tests for the mandatory backup, the schema guard, the printed target, one snapshot and the rank-less warning. Mutation check
on the read side: 8 deliberate breaks, all caught.

**Live recheck on `v3_local` after the fixes** (the Home read run for the three traced users): same figures as the trace (seat 34: 20 of 29, #2 of 14,
website 91, AI 49 and 5 answers, 3 of 4 articles, 2 credentials, 2008; seat 19: 17, #7 of 14, 88, 29 and 2, 3 of 4, 0, 2017; seat 30: 13, #10 of 13, 93,
no AI row, 0 of 1, 0, 2020). **One visible change:** the market city is now `null` for all three, because the city must belong to the ranked
zipcode and no mock location carries it, so the Home shows "ZIP …" where the trace showed "Denver" for seats 34 and 19 (that city belonged to the seat's
first location, not to its market; finding 5). The seed's dry run on `v3_local` prints the target and plans 40 seats; a real run without `--backup-to`
is refused with nothing changed. The browser trace itself was not re-run after the fixes.

## Evals (Skills / NORA / AI output only)
Not applicable.

## Live verification (data changes only)
`v3_local`, schema `srp_cleanup`, after running `uv run python -m surfaces.srp.seat.seed_home` (dry run first, then a real run with a
backup, then a second real run):

| Check | Before | After |
|---|---|---|
| Seats with a score row | 28 | 40 of 40 seats |
| Seats with a score for **every** score category | not all | 40 (10 categories each) |
| Score rows above their category maximum | n/a | 0 |
| Known-maximum categories with a NULL score | some | 0 (an unknown maximum stays NULL on purpose) |
| Old non-seed score rows left for seats | many | 0 |
| Peer groups (same zipcode and vertical) | zipcodes mostly empty | 3 groups of 14, 13 and 13 seats (all at least 10) |
| Seat totals | random | 10 to 22, 13 distinct values, so ranks spread; config maximum sums to 29 |
| VOCE articles per seat | random | 0 to 5 (spread 5, 12, 6, 5, 5, 7 seats), 3 archived |
| Website rows per seat | 25 rows, some seats 2 | exactly 1 per seat |
| Seats with no AI-authority row | n/a | 9 of 40 (the empty case is visible) |
| Seat columns | year/zip/photo random | year started 2003 to 2022, zipcode set, photo NULL (an `example.test` URL cannot load) |
| Tables in schema `public` | 0 | 0 (unchanged) |
| Run 1 / run 2 | n/a | inserted 508, updated 137, deleted 47 / **inserted 0, updated 0, deleted 0** |

The Home read itself (`surfaces.srp.seat.home.home`) was then run on the seeded data for two seats and matched raw SQL (seat 34: total 20 of config
max 29, rank 2 of 14, 3 of 4 articles published, website 91, AI 49, 2 credentials). The planned rank SQL (spec step 2) ran on the seeded data: seat 34 is position 2 of 14 with a total of 20 against a config maximum of 29.
The existing seat read still works (`score.total_score` for seat 34 is now 20).

## Applied changes
- **Mock-data seed, applied 2026-10-27 to `v3_local` only, under decision D5 (approved):** mock rows in `user_search_rank_scores`, `voce_articles`,
  `website_analytics_data`, `ai_authority_stats`, `tier_agent_details` and three columns of `tier_agents`. The previous rows (184 lines: 50 scores,
  25 articles, 25 website, 19 AI, 25 details, 40 seat rows) are in `~/Documents/exp-v3/srp_cleanup_home_seed_backup_20261027.jsonl`
  (mode 600, outside the repo).
- No migration, table or column; nothing in `public` or Supabase. The Home read is a new module (`seat/home.py`) behind a new route `GET /srp/seat/professional/{pro_id}/home` (local sign-in sessions only) and a shared
  `seat/score_query.py`, which the existing local seat read now also uses: **its score changed in one case**, a seat whose scores are all NULL now has
  `total_score` null (unknown) instead of 0.
- The SRP-only API on port 8000 was restarted with the new route and a new signing key, so earlier browser sessions need a new sign-in.
- Code is uncommitted on branch `srp/local-login-srp-home`.

## What remains unverified
- The browser trace (80 items) predates the task 7 fixes; it was re-checked at the API level for three users, not in the browser, so the "ZIP …"
  wording for seats 34 and 19 has not been seen on the page. Merge needs the rulings listed in the canon review (items 3, 4 and 9).
- Finding 6 (indexes on `user_search_rank_scores(zipcode, vertical_id)`, `voce_articles(tier_agent_id)`, `tier_agent_details(tier_agent_id)`) is a known limitation;
  nothing was timed at volume.
- **What a real seat sees is a different page** (spec S1): a new `screens/home-real.tsx`. The sample hero ("Pass Riverbend…", the gap bar, the band label, "since you claimed"),
  NORA's board, the stat tiles, the locked-feature cards, the peer panel and the day 7 drafts are not shown for a real seat; the sample page is unchanged for a seat with no
  data. The header's "Day N of 30" chip becomes "Plan: Not connected yet" and the trial banner is not shown. `ScoreRing` gained a `max` (an unknown maximum draws no arc).
- The notice above a real Home is one line and can be cut short ("…Everything els…"); its full text is also the banner's tooltip.
- The seat layout now waits for the Home data as well as the seat before showing a professional's pages (so no demo number flashes first);
  a failed Home load (a Supabase session gets 501) shows the pages with the sample view. A slow Home read would delay the pages; no timeout is set.
- (Fixed in task 7: a seat whose score rows span more than one market now has no rank.)
- The trace covers the day 1 page for three users and `?day=7` for one (the same page); other seats, other days and mobile layout were not traced.
  The trace script is a scratch tool, not part of the repo.
- The seed was run on one database (`v3_local`); other databases with a different `srp_cleanup` content were not tried.
- The seed deletes old mock rows for seated users (backed up). Restoring from the backup file has no tool yet, only the file.

## Change log
Not required: no DB function, table, trigger, cron or ETL change; mock data in a local schema only.
