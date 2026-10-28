# Spec: Keep the Happyflow Home design and serve every value on it from the local database

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [plan](./plan.md) (not written yet) · contracts: `contracts/srp/openapi.json` (the Home response changes, see Data)

Status of this spec: **draft for approval**. Items N1 to N4 in the decision log are choices this spec makes that need your explicit confirmation.
Supersedes, for the Home only: S1, D1 and "no table, column or migration" from `srp/home-page-data`.

## Behaviour
Deterministic code decides everything; no model is involved. Reads are `SELECT` only. The only database change is the new `home_*` tables in
`srp_cleanup` (local database `v3_local` only) and the mock rows the seed writes into them.

1. **The read.** `GET /srp/seat/professional/{pro_id}/home` (same route, same rules as today): a local sign-in session, its own seat only (403
   `not_your_seat` otherwise, ownership checked before anything else), `set transaction read only` first, one connection, a database error answers 503
   `database_unavailable`, a Supabase session gets 501. It reads the seat's rows from the tables in Data and returns the response in step 2.
2. **The response** (`HomeResponse`; replaces the previous eight sections). Every value is a stored value or a computed one (step 3); nothing is invented.
   - `as_of` (server time, `Z`), `data` = `"mock"` or `"live"` (from `home_seat_state.is_mock`), `ready` (false when the seat has no `home_seat_state` row or no snapshot).
     When `ready` is false every other section is `null`.
   - `day`: `{ n, trial_days, layout: "day1" | "day7" | "day24", over }`.
   - `person`: `{ first_name, full_name, title, photo_url, year_started, credentials }` from `users`, `tier_agents` and `tier_agent_details`.
   - `trial`: `{ plan: {key, name, tag}, started_at, nora_text_day }`.
   - `score`: `{ total, max, band: {name, min_points, next: {name, min_points} | null}, as_of, since_claim, week_delta, lanes: [{key, name, points, max}] }`.
   - `rank`: `{ position, of, city, first_position | null }` (`first_position` = the earliest snapshot's position, for the recap).
   - `rival`: `{ name, initial, score, points_to_first, review_count, review_avg, article_count } | null` (the market leader; `null` when no competitor outscores the seat).
   - `competitors`: `{ count }`.
   - `board`: `{ latest: {label, points, status, started_at, completed_at} | null, done: [{label, points}], done_count, since_claim_points, next_moves: [{icon, title, subtitle, recommended, target, points}], moves: {done, goal}, streak_weeks, needs_you_count }`.
   - `tiles`: `{ map: {scanned_at, top3, total, cells: [{row, col, rank}]}, ai: {cited, checked, checked_at}, reviews: {avg, count, as_of}, profile_strength: {pct, previous_pct}, website: {score, max, url}, articles: {published, total} }`.
   - `locked`: `{ features: [{key, title, description, points_waiting, plan}], points_waiting }`.
   - `peers`: `{ band_from, median_gain, horizon_days, cohort_size, cohort_period, reached_next_band, of } | null`.
   - `brief`: `{ week_start, points_total, items: [{label, points}], next_move: {label, points, target}, away: {new_reviews, bio_live, first_article} } | null` (day 7 and day 24 layouts).
   - `drafts`: `[{id, reviewer_label, rating, review_text, draft_text, compliance_status, status}]` (open ones: status `draft`); `events`: `[{kind, title, body, action_label, expires_at}]`; `insights`: `[{title, body, cta, action}]`.
   - `recap`: `{ days, things_done, tiles: [{label, from, to, delta}], articles, replies } | null` (only on the day 24 layout).
   - `plans`: `[{key, name, tag, highlight, items}]` for the Compare-plans window.
3. **What is computed (never stored):**
   - `day.n` = whole days from `trial_started_at` (date of the server clock, UTC) to today, plus 1, at least 1; `over` is true when `n > trial_days`, and `n` is then shown as `trial_days`.
   - `day.layout`: `n` 1 to 6 is `day1`, 7 to 23 is `day7`, 24 and above is `day24`. The `?day=` URL value overrides it (as today).
   - `score.total` and `score.lanes` = the newest snapshot (`as_of`, then id); `score.max` = the sum of `home_score_lanes.max_points`; `band` = the band with the highest `min_points` not above the total.
   - `score.since_claim` = total minus the total of `home_seat_state.claim_snapshot_id` (`null` when none); `board.since_claim_points` = the sum of the `points` of done activities.
   - `score.week_delta` = total minus the total of the newest snapshot at least 7 days older than the newest (`null` when none).
   - `rival.points_to_first` = leader score minus total (never negative; `rival` is `null` when the leader does not outscore the seat).
   - `board.done_count` = number of done activities; `needs_you_count` = number of drafts with status `draft`.
   - `locked.features[].points_waiting` = the feature lane's `max_points` minus its points in the newest snapshot (at least 0; `null` when the feature has no lane, which is why `home_locked_features.lane_id` may be null, as for Map Rank tracking, which shows no points); a feature is listed only when its `plan` is above the seat's plan (`home_plans.position`); `locked.points_waiting` = their sum.
   - `tiles.map.top3` = cells with rank 1 to 3; `total` = number of cells. `tiles.website.score` = the latest `website_analytics_data.total_score`, `max` = the website lane's `max_points`. `tiles.articles` = counts of non-archived `voce_articles` (published, total).
   - `recap` = from the earliest snapshot to the newest (score, rank, profile strength), `things_done` = done activities, `articles` = published articles, `replies` = drafts with status `posted`.
4. **The UI** (`surface-ui/srp/src/components/happyflow/`):
   - `home-day1.tsx`, `home-day7.tsx` and the Home parts of `shell.tsx` (plan banner and chip, plan window, recap window, launcher texts) read one `HomeModel` instead of constants.
     `sampleHomeModel()` is built from today's constants, so the sample view (no real seat, or `ready` false) is byte for byte what it is today.
     `homeModel(data)` in `utils/home-data.ts` maps the response to the same shape. The layout follows `day.layout` unless `?day=` is present.
   - `home-real.tsx` and its tests are removed. The hero, ring, board, tiles, locked cards, peer panel, brief, drafts, banners, moves and recap show the stored values.
   - The first-task animation (today 384 to 390) plays on the day 1 layout when `board.latest.status` is `done`: it starts at total minus `latest.points` and ends at the total.
   - The ring label is "OF {score.max}". The header chip is "Day {n} of {trial_days}". The Home components still make no fetch (the existing source guard).
   - Buttons keep changing on-screen state only: approve and edit a draft, dismiss the banner or the peer panel, save the year, reconnect Facebook, Compare plans. Nothing is written.
   - The notice above a real Home says the numbers come from the local database and are mock when `data` is `mock`: "Mock data · these values come from the local database and are not your real score or activity."
5. **The seed** (`surface-api/srp/src/seat/seed_home.py`, extended; run with `uv run python -m surfaces.srp.seat.seed_home --backup-to FILE [--as-of YYYY-MM-DD]`):
   it keeps its guards (mandatory `--backup-to` for a real run, schema guard, printed target, one repeatable-read transaction) and, in the same run, writes:
   - the reference rows (10 lanes summing to 850, bands, three plans, peer benchmarks);
   - for every active user with a seat: a seat state, 2 to 4 snapshots (claim, a week earlier, now) with lane points that sum to the total, 49 map cells for the newest, 5 competitors with one market leader above the seat, activities (one `done` latest), 3 next moves, locked features, a weekly brief with items, 0 to 3 review drafts, 0 to 2 events, 3 insights.
   - Everything is deterministic (hash of seed tag, seat and key), labelled mock, names nobody (reviewer labels like "Reviewer A. (mock)"; competitor names are business names), and dated relative to `--as-of` (default today, printed), so a second run with the same date changes nothing.
   - Trial start dates are spread so seats land on the day 1, day 7 and day 24 layouts.

## Acceptance criteria
1. The script `surface-api/srp/db/local/home_schema.sql` creates exactly the 17 tables listed in Data in `srp_cleanup`, in one transaction, and touches no existing table (checked by a catalog diff of the other 81 tables' columns before and after).
2. No table is created outside `srp_cleanup`; no RLS; no grant to `anon`, `authenticated` or `PUBLIC`; `v3_app` has select, insert, update and delete on each new table and nothing else is added.
3. Every foreign key and check constraint in Data exists; a row violating one is refused (tested on a scratch schema).
4. The seed run twice with the same `--as-of` leaves the database identical to once (ids included); a real run without `--backup-to` is refused; the backup contains the previous rows of every new table.
5. Seed invariants hold for every seated active user: lane points sum to the snapshot total; total is within 0 to 850 and non-decreasing over time; the claim snapshot is the earliest; `rank_position <= rank_of`; the market leader outscores the seat; exactly one activity is the latest; the 49 map cells are unique; locked points waiting are non-negative.
6. The seed produces seats on each of the three layouts for the same `--as-of`.
7. `GET .../home` with a local token for the user's own seat returns 200 with exactly the sections in step 2; another seat, a non-numeric id or a deactivated user is 403 with the ownership query first; a Supabase session gets 501; a database error gets 503 with no driver text; only `SELECT` runs and the first statement is `set transaction read only`.
8. A seat with no `home_seat_state` row returns `ready` false and every other section `null`.
9. Computed values follow step 3, each tested on real Postgres with known rows: layout boundaries (days 1, 6, 7, 23, 24, 31), band edges, `since_claim` null without a claim snapshot, `week_delta` null without an older snapshot, `rival` null when nobody outscores, locked features hidden when the seat's plan is high enough, no negative `points_waiting`.
10. The route-table test still lists exactly five routes that accept a local token.
11. `contracts/srp/openapi.json` contains the new `HomeResponse` and `tests/test_contracts.py` passes.
12. `homeModel(data)` returns a value for every item on the page; the sample model equals today's constants (a test compares them).
13. Rendered for a real seat on each layout, the page contains the real figures and texts, none of the previous "Not connected yet" placeholders, and none of the sample constants that real rows replace when the real values differ (390 and 418 are checked only against seats whose stored totals differ).
14. Rendered with no real seat (or `ready` false), the Home is byte for byte what it is today: the existing render tests pass unchanged.
15. The Happyflow components still make no fetch call (source guard); data reaches them through the context only.
16. In the browser, signed in as users on a day 1, a day 7 and a day 24 seat, every number and text on the Home matches a row in `srp_cleanup` (independent SQL), recorded in `evidence.md`, with a control that is caught.
17. `ruff`, `pytest`, `bun test` and `tsc` for the app and `srp` pass; the three migration-security tests that failed before this work are the only failures; no `srp_it_*` scratch schema is left.

## Data
**Read (existing, SRP-owned, schema `srp_cleanup`):** `users`, `tier_agents` (name, title, photo, `year_started`, `claimed_at`, `zipcode`), `tier_agent_details` (credentials), `voce_articles`, `website_analytics_data`.
The legacy `user_search_rank_scores`, `srs_config_*` and `ai_authority_stats` are no longer read by the Home; the seat read still uses them. No existing table or column changes.

**New tables** (extend-never-duplicate: no existing table holds a score history, band, rival, trial date, review, map scan, activity, brief, draft or event; `persona_features`/`user_personas` hold a different plan model, `alerts` has no seat-facing contract). All in `srp_cleanup`, prefix `home_`:

| Table | Columns (types; `bigint` ids are `generated by default as identity`; `timestamp` is UTC without zone) | Constraints |
|---|---|---|
| `home_score_lanes` | id, key varchar(40), name varchar(80), max_points integer, position integer | unique key; max_points >= 0 |
| `home_score_bands` | id, name varchar(40), min_points integer, position integer | unique min_points; min_points between 0 and 850 |
| `home_plans` | id, key varchar(20), name varchar(40), tag varchar(40), position integer, highlight boolean, items jsonb | unique key |
| `home_peer_benchmarks` | id, band_id, median_gain integer, horizon_days integer, cohort_size integer, cohort_period varchar(40), reached_next_band integer, cohort_of integer | fk band_id; reached_next_band <= cohort_of |
| `home_seat_state` | id, tier_agent_id bigint, plan_id, trial_started_at timestamp, trial_days integer, moves_done integer, moves_goal integer, streak_weeks integer, nora_text_day varchar(40), claim_snapshot_id bigint, is_mock boolean, created_at, updated_at | unique tier_agent_id; fk tier_agent_id, plan_id; trial_days > 0 |
| `home_snapshots` | id, tier_agent_id, as_of timestamp, total integer, band_id, rank_position integer, rank_of integer, rank_city varchar(120), profile_strength_pct integer, review_avg numeric(2,1), review_count integer, map_scanned_at timestamp, ai_cited integer, ai_checked integer, ai_checked_at timestamp, created_at, updated_at | unique (tier_agent_id, as_of); fk tier_agent_id, band_id; total 0 to 850; position <= of; pct 0 to 100; ai_cited <= ai_checked |
| `home_snapshot_lanes` | id, snapshot_id, lane_id, points integer | unique (snapshot_id, lane_id); fks cascade on snapshot; points >= 0 |
| `home_map_cells` | id, snapshot_id, row_no smallint, col_no smallint, rank integer (null = "20+") | unique (snapshot_id, row_no, col_no); row/col 0 to 6; fk cascade |
| `home_competitors` | id, tier_agent_id, name varchar(160), score integer, is_market_leader boolean, review_count integer, review_avg numeric(2,1), article_count integer, position integer | fk tier_agent_id; score 0 to 850 |
| `home_activity` | id, tier_agent_id, label varchar(200), points integer (null ok), status varchar(10), started_at timestamp, completed_at timestamp, created_at | status in (`doing`,`done`); fk |
| `home_next_moves` | id, tier_agent_id, position integer, icon varchar(30), title varchar(120), subtitle varchar(300), recommended boolean, target varchar(20), points integer (null ok) | target in (`voce`,`website`,`profile`); fk |
| `home_locked_features` | id, tier_agent_id, feature_key varchar(40), title varchar(80), description varchar(300), lane_id, plan_id | unique (tier_agent_id, feature_key); fks |
| `home_weekly_briefs` | id, tier_agent_id, week_start timestamp, next_move_label varchar(120), next_move_points integer, next_move_target varchar(20), away_new_reviews integer, away_bio_live boolean, away_first_article boolean | fk |
| `home_weekly_brief_items` | id, brief_id, position integer, label varchar(160), points integer | fk cascade |
| `home_review_drafts` | id, tier_agent_id, reviewer_label varchar(80), rating smallint, review_text text, draft_text text, compliance_status varchar(12), status varchar(10), created_at | rating 1 to 5; compliance in (`passed`,`needs_edit`); status in (`draft`,`approved`,`posted`); fk |
| `home_events` | id, tier_agent_id, kind varchar(12), title varchar(160), body varchar(300), action_label varchar(40), expires_at timestamp, created_at | kind in (`review`,`facebook`); fk |
| `home_nora_insights` | id, tier_agent_id, position integer, title varchar(160), body text, cta varchar(80), action varchar(12) | action in (`voce`,`reviews`,`insights`); fk |

- Indexes: `idx_<table>_<column>` on every `tier_agent_id`, `snapshot_id`, `brief_id`, `lane_id` and `plan_id`. Each table and column has a `comment`.
- **Not stored:** the 34-above-you figure, the points-to-#1, the week delta, the done count and the other values in step 3.
- **Migration intent:** a plain, re-runnable SQL script `surface-api/srp/db/local/home_schema.sql` (`create ... if not exists`), outside Alembic and outside `surface-api/migrations/` (the same stance as the sign-in increment: `srp_cleanup` is a local schema, no change-log entry). Run only on `v3_local`, after a schema-only `pg_dump` backup, in one transaction, then verified by a catalog query and by JOIN counts after the seed.
- **Provenance / trust tier:** every row is mock (`self_declared` level); `home_seat_state.is_mock` says so and the page says so.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | A typed read with `as_of`; `ready` false and `null` sections mean unknown, never zero. For the signed-in browser session, not published to NORA. |
| Capabilities | None. |
| Events | None. |
| Entitlement | The plan decides which features are locked (`home_plans.position`); no gate is enforced here. |
| Explanation | Fixed labels only; every number comes from a row or from a step 3 formula. The NORA insight cards are stored mock text, not generated. |
| Value loop | Not applicable to this increment. |

## Security and scope
- **Principal:** a local sign-in session; **scope:** its own seat only; no delegation. The route and the five-route local-token allowlist do not change.
- Queries are parameterised; the schema name comes from `SRP_LOCAL_SCHEMA` (already validated); read-only transaction; no lock.
- **DDL:** the new tables have no RLS and no policy; access is by grant: `revoke all ... from anon, authenticated, PUBLIC`, then `grant select, insert, update, delete ... to v3_app`. No grant on the schema changes. No secret anywhere.
- The seed backup file is private (mode 600) and outside the repo; a real seed run needs `--backup-to`.
- **Untrusted input:** the seat id (digits only, checked before any query). Stored text (names, drafts, events) is mock and rendered as text, never as HTML.

## Compliance
Nothing is generated or published. The review draft replies are stored mock text; the "Compliant" chip shows only when `compliance_status` is `passed` (a stored value, not computed here).
A real reply would have to pass `content_compliance_rules` and `exp_category_compliance` server-side before it is posted (`AGENTS.md` §3); that is not built here and the page cannot post. The score, rank and band are shown with the mock notice and must not be read as the product's official SRS v5 result.

## Canon review
Author's check (the `canon-review` skill and a second-model review run in the last task). Conflicts are flagged, not resolved:
- **Ownership:** only SRP-owned data in the local schema; no other Surface imported; no `public` table.
- **Extend, never duplicate:** each new table names the existing one it could have extended and why it cannot (see Data). Open question for review: `home_snapshots` stores an AI "cited of checked" pair that `ai_authority_stats` lacks.
- **Identifiers:** `tier_agent_id` is a raw seat id and `srp_cleanup` is not the Surface schema `srp` (carried over, still flagged). No `gcid` involved.
- **Security (§3):** new tables without RLS, access by grants only, as ruled on 2026-10-26.
- **Governed writes:** the seed writes the 17 new `home_*` tables **and still writes the five existing tables it wrote before** (`user_search_rank_scores`, `voce_articles`, `website_analytics_data`, `ai_authority_stats`, `tier_agent_details`, plus three `tier_agents` columns), because the Home reads three of them and the seat read reads the scores; the Home no longer reads `user_search_rank_scores` or `ai_authority_stats`. `user_search_rank_scores` is a `*_scores` table (flagged, as before). Backup, one transaction and the schema guard cover all of it. *(Corrected in task 4: the first draft said the seed would stop writing the legacy tables.)*
- **Scoring (§3, canon 9):** an 850-point mock score is not produced by SRS v5. Flagged; labelled mock. Bands: placeholder thresholds, flagged.
- **No names (§3):** reviewer labels are generic; competitor names are business names; no person's name is written.
- **Open decisions:** O1 (related), O5, unassigned scoring and identity ownership, band thresholds, the plan and trial rule, the `srp_cleanup` name. None resolved here.

## Second-model review
Not yet run. To run in the last task on the DDL (types, constraints, grants), the seed invariants and idempotence, the computed formulas and their edge cases (layout boundaries, nulls), and the ownership check.

## Decision log entries
Ruled 2026-10-27 (answered in the planning step):
- **R1.** The Home keeps its original design; every value comes from the local database.
- **R2.** Score tables are 850-point SRS v5 shaped (10 lanes, bands, history); the legacy 29-point tables are untouched.
- **R3.** The layout day comes from trial dates in the database; `?day=` stays as an override.
- **R4.** Read-only: no write route in this increment.
- **R5.** This supersedes S1, D1 and "no table, column or migration" from `srp/home-page-data`, for the Home only.
- **R6.** `srp_cleanup` tables are a local schema outside Alembic and the closed SQL stream and get **no** `docs/ETL-Enhancements.md` entry; this covers the Home, SRS, Profile and Insights increments (ruled 2026-10-27).

Needs your confirmation:
- **N1.** Mock band thresholds: Building 0 to 399, Established 400 to 599, Leading 600 to 749, Elite 750 to 850 (the design only names Building and Established; the only written definition is on the stale 1000-point scale).
- **N2.** When no competitor outscores the seat, `rival` is `null` and the hero says "You lead {city}" with the bar showing only the seat; this copy is new and not in the design. The seed gives every seat a leader, so it appears only in tests.
- **N3.** After day 30 (`over`), the day 24 layout stays, the chip reads "Day 30 of 30", and no extra "trial ended" copy is added.
- **N4.** The notice text above a real Home (step 4). The design's "Sample data" notice stays for the sample view.

Plan correction: the approved plan said 16 new tables; the list has 17 (it counted `home_weekly_brief_items` inside the brief).

Deferred, still blocking other things: real SRS v5 scores and bands (O1, scoring ownership), profile strength rule (O5), plan and trial rule, writes from the Home, the chat canned answers and the full Map, VOCE and upgrade panels.

## Reviews at the end of Develop (task 15, 2026-10-27)

### Canon review (skill `canon-review`, whole increment)
| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Ownership | PASS | New tables are all in the Surface's own schema `srp_cleanup`; the read touches only that schema (`home.py`); no other Surface's table is named. The schema name `srp_cleanup` (not `srp`) is the earlier open ruling. |
| 2 | Extend, never duplicate | PASS | Data section names, per table, the existing table it could have extended and why not; `exp_*`/`graph_*`/`search_*` are absent from `v3_local` and from the new code (grep: no match). |
| 3 | Identifiers | N/A | No gcid, record id or entity link is stored or created. |
| 4 | Governed writes | PASS | No `graph_nodes`, `search_documents` or category table is written (grep: no match). |
| 5 | Security | PASS | Live catalog: 17 `home_*` tables in `srp_cleanup`, 0 with row-level security, grants only to `v3_app` (select/insert/update/delete), 0 grants to anon, authenticated or PUBLIC, none in `public`. The read opens `set transaction read only` first, answers 403 for another user's seat and 501 for a Supabase session. No secret in the code or the docs. |
| 6 | Model vs code | PASS | Every figure is computed in deterministic Python or SQL; no model call; missing data is null or "—", never a demo number (one exception found by the second review and fixed, see below). |
| 7 | Gated actions | PASS | No cron, indexing, enrichment engine or dirty-queue draining (grep: no match). |
| 8 | Compliance | PASS (nothing built) | The page cannot post; draft replies are mock rows labelled mock with a stored compliance state. Server-side compliance before any real publish is still to be built. |
| 9 | Scoring / rings | FLAG | The 850-point mock score is not produced by SRS v5; the lane names and maxima could not be compared with the live scorer because `exp_score_v5_*` is not in `v3_local`. No ring logic is used. |
| 10 | Open decisions | FLAG | O1 (rings, not used), O5 (profile strength rule, mock), band thresholds (placeholders), scoring and identity ownership, the `srp_cleanup` schema name, the plan and trial rule. None resolved here. |

**Verdict: clear to proceed locally; merge blocked by** O5, band thresholds, the plan/trial rule, scoring and identity ownership, the `srp_cleanup` name, and the live-scorer lane comparison.

### Independent second-model review
A fresh reviewer (a separate model session with no access to my conclusions) read the constitution, this spec and the code (read-only) and reported 13 findings and no high-severity defect. It confirmed: ownership checked first, read-only transaction first, no SQL injection (schema name validated, ids parsed to integers), no driver text in errors, the DDL grants and re-runnability, the seed invariants by construction, idempotence, and the computed values against step 3.

| # | Finding (severity) | Checked | Disposition |
|---|---|---|---|
| 1 | Day 1 shows a task as finished when the latest activity is `doing` (medium) | Real: seeds give about 1 in 6 seats a running task | **Fixed.** A running task stays "DOING NOW", note "In progress", no count-up, not in the done list. Tests added (2 renders, facts). |
| 2 | `_board` sort fails when an activity has both times null (medium) | Real: the DDL allows it; Python raises `TypeError` | **Fixed** (undated rows sort first). Test added. |
| 3 | The seed still writes the five legacy tables and some `tier_agents` columns (medium) | True, and by design from the earlier increment (`home-page-data`), backed up in one transaction | **Accepted, recorded.** R2 protects the legacy *score* tables; the seed's other writes were already in the earlier ruling. Needs a ruling before merge. |
| 4 | Layout is `hash(seat) % 3`, so a small seat set may miss a layout (low-medium) | True for small sets; 30+ live seats cover all three | **Accepted.** The seed docs and the evidence say so. |
| 5 | Start-year picker shows the demo 2014 when the year is null (low-medium) | Real | **Fixed.** A real seat with no year starts on an empty "Year" option; the sample keeps 2014. Test added. |
| 6 | Band marker can pass 100% (low) | Real | **Fixed** (clamped). Test added. |
| 7 | "▲ -5 since you claimed" for a fall (low) | Real | **Fixed** ("▼ 5", "−5 points"). Test added. |
| 8 | No hero sentence when a rival exists but rank is null (low) | Real, rare | **Fixed** ("{rival} is #1 in your market — here's your gap."). Test updated. |
| 9 | The DDL does not enforce invariants the seed upholds: claim snapshot of another seat, lane points above the lane maximum, lane sum equals total, no unique keys on position columns and per seat-week (low) | True | **Fixed:** `home_schema_hardening.sql`, written with tests first and run on `v3_local` on 2026-10-27 (see evidence.md). |
| 10 | A pool timeout would be a 500 (low) | **Not real:** `PoolTimeout` is a `psycopg.OperationalError`, so it is already a 503 | No change; a regression test was added. |
| 11 | Events past their `expires_at` are dropped (low) | True, a design choice not in the spec | **Accepted, recorded** (a seed run with a past `--as-of` hides them). |
| 12 | The backup file stays after a failed run, so the next run stops (low) | True, safe direction | **Accepted** (the message says to pick a new file). |
| 13 | A plan's `items` stored as an object would return its keys (low) | Real | **Fixed** (non-list becomes an empty list). Test added. |

Results after the fixes: backend 2,089 passed with real Postgres (the same 3 known `test_migrations_security` failures), ruff clean, 0 scratch schemas left; UI `bun test` 328 pass, `tsc` clean.
