# Spec: Serve the Happyflow SRS page from the local database, keeping SRS v5 as is

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [plan](./plan.md) (not written yet) · contracts: `contracts/srp/openapi.json` (one new response, see Data)

Status of this spec: **draft for approval**. Decisions N1 to N8 in the decision log are choices this spec makes that need your confirmation.
It extends `srp/home-page-schema` (tables, seed, helpers); it changes nothing the Home increment decided.

## Behaviour
Deterministic code decides everything; no model is involved. Reads are `SELECT` only. The only database change is one new table and one new column in
`srp_cleanup` (local database `v3_local` only) plus the mock rows the seed writes. The scoring system stays SRS v5: 850 points, the 10 lanes and budgets in
`home_score_lanes`. The legacy `srs_config_*`, `user_search_rank_scores` and `ai_authority_stats` are not read or changed.

1. **The read.** `GET /srp/seat/professional/{pro_id}/srs`: a local sign-in session, its own seat only (403 `not_your_seat` otherwise; ownership is checked
   before anything else), `set transaction read only` first, one connection; a database error answers 503 `database_unavailable`; a Supabase session gets 501
   `not_implemented`. It reads the seat's newest snapshot and the rows in Data and returns the response in step 2.
2. **The response** (`SrsResponse`). Every value is a stored value or a computed one (step 3); nothing is invented.
   - `as_of` (server time), `data` = `"mock"` or `"live"` (from `home_seat_state.is_mock`), `ready` (false when the seat has no seat state or no snapshot; every other section is then `null`).
   - `score`: `{ total, max, band: {name, min_points, next: {name, min_points, points_needed} | null}, as_of, open_total }`.
   - `rank`: `{ position, of, city }`; `rival`: `{ name, score, points_to_first, review_count, review_avg } | null` (same rule as Home).
   - `lanes`: one entry per lane, ordered by open points (descending), ties by lane position:
     `{ key, name, short_name, earned, max, open, status, you_text, rival_text, note, action_label, action_target }`.
   - `counts`: `{ all, missing, fix, strong }` (the filter chips); `notes`: up to three `{ title, body, cta, action }` (NORA's notes).
3. **What is computed (never stored):**
   - `earned` = the lane's points in the newest snapshot; `open` = `max` minus `earned`; `score.total` = the snapshot total (equal to the sum of the earned values, which the database already enforces); `score.open_total` = `max` total minus `total`.
   - `status`: `Strong` when `earned / max` is at least 0.75 (constant `STRONG_SHARE`, N3); otherwise `Missing` when the stored `is_missing` is true (N4); otherwise `Fix · locked` when the lane belongs to a feature in `home_locked_features` whose plan is above the seat's plan; otherwise `Fix`.
   - `band`, `next.points_needed` (= next band's minimum minus total), `rank`, `rival`: the same functions Home uses (`seat/home.py`: `_band`, `_rank`, `_rival`), so SRS and Home cannot disagree (N8).
   - `counts` from `status` (`Fix · locked` counts as `fix`, as the screen does today).
   - `notes` (N1), in this order, each with authoritative numbers only:
     1. The lane with the most open points: if its `open` is at least the points needed for the next band, "{short_name} gets you to {next band}." with "It's {open} points open, and you only need {points_needed} to cross {next min}."; otherwise "{short_name} is your biggest gap." with "It's {open} points open." CTA and action from the lane.
     2. The lane with the most open points among lanes with a `rival_text` and not used in note 1: "Your {short_name} is costing you {open} points." with "{rival name}: {rival_text}. You: {you_text}."
     3. The `Strong` lane with the highest earned share: "{short_name} is already strong." with the lane's `note` or `you_text`.
     A note is dropped when its lane does not exist (a seat with fewer qualifying lanes shows fewer notes).
4. **The UI** (`surface-ui/srp/src/`):
   - `utils/srs-model.ts` holds `SrsModel` and `srsModel(response)`; `sampleSrsModel()` is built from the current constants in `screens/srs.tsx` (`LANES`, `THINKS`, the band, rank and rival values) so the sample view is unchanged and the existing `srs.test.ts` passes unchanged.
   - `screens/srs.tsx` reads lanes, counts, notes, ring, band bar, rank, rival and the calculation-dialog numbers from the model; layout, colours and copy that are not data stay as they are. The filter chips and lane order follow the model.
   - `components/happyflow/srs-page.tsx` (new, mirrors `home-page.tsx`): a real local seat renders `SrsScreen` with the API model; otherwise the sample page inside `SampleData`. `routes/_authenticated/seat.$kind.$id.nora.tsx` renders it (URL unchanged). The Happyflow components still make no fetch (existing source guard, file count updated).
   - Buttons keep changing on-screen state only; nothing is written.
   - Static copy that names a market ("#1 lender in Davenport") takes the city from `rank.city`; the word "lender" stays UI copy, as in the prototype.
5. **The seed** (`seat/seed_home.py` and `seed_home_plan.py`, extended; same guards: mandatory `--backup-to`, schema guard, one repeatable-read transaction, `--as-of`):
   it writes `srs_lane_gaps` for every seat with a snapshot, 10 rows each, deterministic, labelled mock, and sets `home_score_lanes.short_name`.
   The Reviews and Articles rows are built from the same hashed values as `home_snapshots.review_count` / `home_competitors.review_count` / `article_count`, and a test checks that the numbers in their texts equal those columns (N2). A second run with the same date changes nothing.

## Acceptance criteria
1. `GET .../srs` for the signed-in user's own seat returns 200 with the shape in step 2; another user's seat id returns 403 `not_your_seat` before any other read; a Supabase session returns 501; a database error returns 503 `database_unavailable`.
2. The read uses a read-only transaction and issues only `SELECT`; the table list it touches is exactly the Home tables it needs plus `srs_lane_gaps` (a test asserts the SQL, as for Home).
3. For a seat with a snapshot, `lanes` has 10 entries, `sum(max) = 850`, `earned + open = max` for every lane, `sum(earned) = score.total`, and the order is open points descending, ties by lane position.
4. Status: a lane at 75% or more earned is `Strong`; below that, `is_missing` gives `Missing`; below that, a lane behind a feature of a higher plan gives `Fix · locked`; otherwise `Fix`. Boundary tests at 74%, 75% and 76%.
5. `counts` equals the number of lanes per group, and `counts.all = 10`.
6. `notes` follow step 3 with the exact numbers from the rows; a seat without a rival text lane gets no note 2; a seat with no `Strong` lane gets no note 3.
7. For the same seat, `score.total`, `band`, `rank` and `rival` in the SRS response equal the Home response (a real-Postgres test calls both).
8. A seat with no seat state or no snapshot returns `ready: false` and `null` sections; the UI then shows the sample page.
9. The database enforces: one gap row per seat and lane; `action_target` is one of `profile, voce, website, connections, reviews, chat, billing`; the lane and seat exist; a gap row cannot name a lane that is not one of the 10 (foreign key); the existing triggers keep a snapshot's lanes at 10, each within its budget and summing to the total.
10. The seed writes 10 gap rows per seat and the 10 short names; a second run reports 0 changes; reviewer or person names are not written; the Reviews and Articles texts agree with the snapshot and competitor columns (N2).
11. UI: with a real seat the SRS page shows the model's values and no "Sample data" notice for the numbers; with no real seat it is the sample page and `srs.test.ts` passes unchanged; mutation-style tests for each computed field (ring, band marker, counts, filter, order, notes).
12. The local-token scope lists exactly six routes (the five today plus `.../srs`); any other route still refuses a local token (extended `test_local_token_scope.py`).
13. The legacy tables `srs_config_*`, `user_search_rank_scores`, `ai_authority_stats` are unchanged (row counts and a catalog diff before and after).
14. `cd surface-api && SRP_TEST_DATABASE_URL=… uv run pytest` passes except the 3 known `test_migrations_security` failures; `ruff`, `bun test`, both `tsc` runs are clean.

## Data
- **Read** (owner SRP, schema `srp_cleanup`, all local): `tier_agents` and `users` (ownership, person), `home_seat_state`, `home_snapshots`, `home_snapshot_lanes`, `home_score_lanes`, `home_score_bands`, `home_competitors`, `home_locked_features`, `home_plans`, and the new `srs_lane_gaps`.
- **Written**: only by the seed, only to `srs_lane_gaps` and `home_score_lanes.short_name`. The endpoint writes nothing.
- **New objects and the existing object each extends** (`extend-never-duplicate`; checked in the repo and in `v3_local` `pg_class`: no table holds a lane comparison, action or short label):
  - `srs_lane_gaps` extends the `home_` lane model: `id bigint identity`, `tier_agent_id bigint` FK `tier_agents`, `lane_id bigint` FK `home_score_lanes`, `you_text varchar(200)`, `rival_text varchar(200)`, `note varchar(200) null`, `is_missing boolean not null default false`, `action_label varchar(60)`, `action_target varchar(16)` with CHECK, `is_mock boolean`, unique `(tier_agent_id, lane_id)`, index on `tier_agent_id` and `lane_id`.
  - `home_score_lanes.short_name varchar(24) null` is a column on our own table from the previous increment (the only ALTER; no legacy table is altered).
  - The notes are **computed**, not stored (N1): `home_nora_insights` cannot serve them (its `action` check allows only `voce`, `reviews`, `insights`, and its rows are Home-specific).
- **Migration intent**: a local SQL script `surface-api/srp/db/local/srs_schema.sql` outside Alembic and outside the closed `surface-api/migrations/` stream (same stance as `home_schema.sql`): one transaction, additive, idempotent, with a commented rollback; no RLS; `grant select, insert, update, delete … to v3_app` only, nothing to anon, authenticated or PUBLIC. Run order: schema-only `pg_dump` backup of `srp_cleanup` outside the repo (mode 600), run, catalog diff, seed with `--backup-to`, JOIN checks, rows of the 17 Home tables unchanged. It needs your explicit go-ahead.
- **Provenance / trust tier**: all rows are mock (`is_mock`, label "Mock"); trust tier `self_declared` at most; nothing claims to be a real score.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | `GET /seat/professional/{id}/srs`, as of the newest snapshot; an unknown value stays `null` (a seat without a snapshot is `ready: false`, not 0) |
| Capabilities | none (read-only); a future "fix this lane" action would be a separate capability with an entitlement |
| Events | none |
| Entitlement | the `Fix · locked` status reads the seat's plan against `home_locked_features`; the unmet experience is the lane's action `billing` |
| Explanation | the three note templates in step 3, authoritative numbers only |
| Value loop | gap lane → note and action → seat does the task → new snapshot → lane points rise → status and notes change |

## Security and scope
- Principal: a local sign-in session for its own seat only; delegation and impersonation are not served (the existing local-token rules). Tenant scope: the seat id from the token, never from the request path alone (403 first).
- Grants: new table and column to `v3_app` only; no RLS on new tables (owner ruling 2026-10-26); the hardening script revokes the new trigger function from PUBLIC, anon, authenticated.
- Untrusted input: only the path id (`[0-9]{1,18}`), validated before use; all values bound as parameters; no content from the table is used as instruction.
- Shared core touched: only the route list in `surface-api/tests/test_local_token_scope.py` (five to six routes); the route uses the existing `current_srp_user` check, so `_base/auth.py` is not changed. Called out in the evidence.

## Compliance
No output is published or sent. The note and lane texts are display copy of mock data. Nothing offers a guarantee of rank or a rate; the page keeps the "Mock data" notice. Server-side category compliance applies when content generation is added later (out of scope).

## Canon review
Run 2026-10-27 on this spec (live catalog read-only; nothing applied):

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Ownership | PASS | writes only `srs_lane_gaps` and `home_score_lanes.short_name` in the SRP-owned local schema; no other Surface's table is read or written |
| 2 | Extend, never duplicate | PASS | Data section; plan.md "Extend-never-duplicate check"; N2 flags the one deliberate repeat of two counts, guarded by a test |
| 3 | Identifiers | N/A | no gcid, record id or link table is used |
| 4 | Governed writes | N/A | no graph or category table is written |
| 5 | Security | PASS | no RLS on the new table, grants to `v3_app` only, nothing for anon/authenticated/PUBLIC, no `(true)` policy, no secrets |
| 6 | Model vs code | PASS | all computed in code; notes are templates; `ready: false` instead of faked output |
| 7 | Gated actions | PASS | no cron, indexing, enrichment or dirty-queue use |
| 8 | Compliance | N/A | nothing is published or sent |
| 9 | Scoring / rings | CONFLICT (flagged) | mock lane points are SRS v5 shaped but not produced by `exp_score_v5_*`; no ring logic |
| 10 | Open decisions | FLAGGED | scoring ownership, band thresholds, O5, Strong threshold (N3), `srp_cleanup` name |

Verdict: clear locally; merge blocked by: scoring and identity ownership, band thresholds, the Strong threshold, `srp_cleanup` schema name, O5.

### Canon review of the finished diff (2026-10-27)

Run with the `canon-review` skill on the finished code (`srs_schema.sql`, `srs.py`, the seed, the UI model and screen). Same result as the spec run: items 1 PASS, 2 PASS (reuses `home.parse_ids`, `owner_of`, `_band`, `_rank`, `_rival`; one table and one column), 3 N/A, 4 N/A, 5 PASS (`srs_schema.sql:63-64` revoke from anon, authenticated, PUBLIC and grant to `v3_app` only; no RLS, policy, function or `SECURITY DEFINER`; ownership and the read-only transaction come first, `srs.py:102-103`), 6 PASS, 7 PASS, 8 N/A, 9 CONFLICT flagged (mock lane points are not produced by `exp_score_v5_*`), 10 FLAGGED (scoring and identity ownership, band thresholds, O5, the Strong threshold N3, the stored `is_missing` flag N4, lane texts, the `srp_cleanup` name). The only shared-core file touched is the route list in `surface-api/tests/test_local_token_scope.py`.

Verdict: clear locally; merge blocked by scoring and identity ownership, band thresholds, the Strong threshold, O5 and the `srp_cleanup` schema name.

## Second-model review

An independent subagent reviewed the code with no access to my conclusions (spec, DDL, service, route, seed, UI model and screen, and the tests that claim to cover them), read-only, and ran the SRS tests (191 passed). Findings and how each was reconciled:

| # | Finding (severity) | Checked by | Outcome |
|---|---|---|---|
| 1 | Seeded gap rows contradict the lane points: lanes flagged `is_missing` earn up to their full budget, so the page shows them as Strong (Medium) | Re-ran its query on `v3_local`: of 61 missing-flagged lane rows on the newest snapshots, 49 earn at least 75% (Audio 20 of 20, Videos 14 of 14, Q&A 12 of 13, Articles 3 of 14) | **Real. Fixed in the seed plan, tests first:** a lane the seat has none of (`_absent`) gets a zero cap in the allocation, so it earns 0 in every snapshot; the Home brief's first-article flag is the same fact for Articles. Two new tests fail without the fix; mutation checks caught. **The live data still has the old rows: it needs a seed re-run on `v3_local` (your go-ahead).** My trace missed it because its SQL expectation applies the same status rule as the service, so it could not see that the seed data contradicted itself |
| 2 | A null band shows an empty pill and a blank bar label (Low) | Read the code: `_band` returns None below the lowest minimum | **Real, fixed:** the pill is drawn only when there is a band; test added. The blank bar label is left (it only appears with no band) |
| 3 | The UI hides lanes the API counts as unknown, so the chip says All 10 while 9 rows show (Low) | Read `srsModel` | Accepted: decision N9; the page says "1 lane without points yet" |
| 4 | The callout is built in the UI, separately from the server's note 1 (Low) | Read `srsModel` | Accepted: both use the same open-points order today; a drift risk, recorded in evidence |

It checked and found fine: ownership before any read and malformed ids refused with no query, per-seat SQL scoping and the newest snapshot, the Strong/Missing/locked arithmetic and boundaries, unknown stays unknown, bar and race percentages, the DDL (idempotent, one transaction, grants, no RLS), the seed (400 rows, backup list, no names), the sample constants only in `sample-srs.ts`, and that the service tests are not vacuous.


## Decision log entries
| # | Date | Decision | What it blocks |
|---|---|---|---|
| N1 | 2026-10-27 | NORA's three notes on SRS are computed templates from lane and rival rows, not a table | a stored, editable note set |
| N2 | 2026-10-27 | `srs_lane_gaps` holds all 10 lanes per seat (not 8); the Reviews and Articles texts repeat counts that also live in `home_snapshots` / `home_competitors`, guarded by a seed test | a single source for those two counts (needs a ruling on a real review and article source) |
| N3 | 2026-10-27 | "Strong" is an earned share of at least 0.75 (constant); needs a ruling | the real status rule |
| N4 | 2026-10-27 | `Missing` is a stored fact (`is_missing`), not "zero earned": the sample has Articles with 18 points earned and no articles | deriving it from real counts |
| N5 | 2026-10-27 | The local token is accepted on a sixth route (`.../srs`); the change is the route list in the shared scope test (`tests/test_local_token_scope.py`), not `_base/auth.py` | none, but needs shared-core review |
| N6 | 2026-10-27 | `home_score_lanes.short_name` is added by ALTER of our own table | none |
| N7 | 2026-10-27 | Lane order is computed (open points descending), as the screen shows it | a fixed lane order |
| N8 | 2026-10-27 | `srs.py` imports the score, rank and rival helpers from `home.py` (no copy), so SRS and Home agree | moving them to a shared module (only if an import cycle forces it) |
| N9 | 2026-10-27 | A lane with no points in the newest snapshot is unknown: `earned`, `open` and `status` are `null` (never 0), it sorts last and is counted only in `counts.all`; `short_name`, texts and action are `null` when missing, and the UI falls back | none |
| N10 | 2026-10-27 | A lane the seat has none of (`is_missing`) earns 0 points in every seeded snapshot (second review finding 1); the Strong rule still wins over Missing if real data ever disagrees | none |
| N11 | 2026-10-27 | `srp_cleanup` tables are a local schema outside Alembic and the closed SQL stream and get **no** `docs/ETL-Enhancements.md` entry; this covers the Home, SRS, Profile and Insights increments (ruled 2026-10-27). | none |
