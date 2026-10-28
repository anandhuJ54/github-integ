# Spec: Serve the Happyflow Insights page from the local database, read-only

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [plan](./plan.md) (not written yet) · contracts: `contracts/srp/openapi.json` (one new response, see Data)

Status of this spec: **draft for approval**. Decisions N1 to N12 in the decision log are choices this spec makes that need your confirmation; **N2 adds one constraint to an existing table of the Home increment** (`home_competitors`).
It extends `srp/home-page-schema`, `srp/srs-page-schema` and `srp/profile-page-schema` (tables, seed, helpers, method); it changes nothing they decided.

## Behaviour
Deterministic code decides everything; no model is involved. Reads are `SELECT` only. The database changes are four new tables and one added unique constraint in `srp_cleanup` (local `v3_local` only) plus the mock rows the seed writes. The page's
write-looking controls (the yes/no question, "Add a competitor", tab switches, selecting a spot) change only what the browser shows.

1. **The read.** `GET /srp/seat/professional/{pro_id}/insights`: a local sign-in session, its own seat only (403 `not_your_seat` otherwise; ownership is checked first through `home.owner_of`), `set transaction read only` first, one connection;
   a database error answers 503 `database_unavailable`; a Supabase session gets 501 `not_implemented`.
2. **The response** (`InsightsResponse`). Every value is a stored value or a computed one (step 3); nothing is invented.
   - `as_of`, `data` = `"mock"` or `"live"` (`"mock"` when any insights row is mock), `ready` (false when the seat has no row in any of the four insights tables; every other section is then `null`).
   - `visibility`: `[{ metric, value, period_days, source, trust_tier, source_line }]` in the page's order: `search_views, maps_views, calls, directions, website_clicks, profile_views` (only the metrics that have a row; `source_line` = `"Last {period_days} days · {source}"`).
   - `map`: `{ address, scanned_at, spots, top3, cells: [{ row, col, rank, leaders: [{ position, name, is_you }] }] }`, 49 cells of the newest snapshot ordered by row then column; `rank` is `null` for "20+"; `leaders` are the stored top 3 of that spot ordered by position.
   - `ai`: `{ cited, checked, engines: [{ engine, cited, checked, note }] }` in the order `chatgpt, gemini, perplexity` (only the engines that have a row).
   - `competitors`: `[{ place, name, is_you, rating, reviews, avg_position, is_leader }]`, the rivals and the seat in one table (see step 3).
   - `target`: `{ name } | null` (the market leader, for the "who do you lose deals to" question).
   - `locked`: `[{ key, title, text }]`; `notes`: `[{ title, body, cta, action }]` (NORA's notes).
3. **What is computed (never stored):**
   - `map.spots` = the number of cells; `map.top3` = cells with a rank of 1 to 3 (the same figure Home shows as "N of 49"); `map.scanned_at` = the newest snapshot's `map_scanned_at`; `map.address` = the Profile's `address` fact (`profile_facts.value`), `null` when the seat has none (the page then says "around your office").
   - `ai.cited` and `ai.checked` = the sums of the engine rows (they equal Home's `ai_cited` and `ai_checked`; the seed makes it so and a test proves it, N6).
   - **The seat's average map position** = the mean of its 49 stored ranks, a "20+" cell counting as 21, rounded to one decimal (N3). It is not stored. A rival's average position is stored (`insights_competitor_positions`).
   - **The competitor table** has the seat's five rivals and the seat itself, sorted by average position ascending; a rival with no stored position, or a seat with no ranks, sorts last with `avg_position: null`; ties keep the rivals in `home_competitors.position` order and put the seat after them (N9). `place` is the 1-based place in that order; rivals show their stored rating and review count (`home_competitors.review_avg`, `review_count`), the seat shows the newest snapshot's `review_avg` and `review_count` (the same figures Home and the Profile show). `is_leader` marks the market leader.
   - `target` = the `is_market_leader` competitor (`null` when none).
   - `locked` = the two cards the prototype shows ("Map Rank tracking", "AI-citation monitoring") **when the seat's plan is below the top plan** (`home_plans.position` of the seat's plan is lower than the highest position); with the top plan none (N8). The card texts are fixed copy in the service, not data.
   - `notes` (N1), in this order, authoritative numbers only:
     1. When there is a leader: `"{leader short name} wins on volume."` **only when both review counts are known and the leader's is higher than the seat's; otherwise `"{leader short name} is your top rival."`** (second review, N13), with `"{review_count} reviews and {article_count} articles. Your {seat rating} rating is {better than|the same as|below} their {leader rating}."` (a part whose figure is unknown is left out); cta `Start publishing`, action `voce`.
     2. The engine with the lowest cited-to-checked share (ties: the page's order): `"{Engine} names you in {cited} of {checked}."` (`"{Engine} never names you."` when cited is 0) with the engine's stored `note`; cta `Write an article` (it was "Write my first article" in the prototype; 35 of 40 seeded seats already have articles, N14), action `voce`. Counts agree in number ("1 review", "1 article").
4. **The UI** (`surface-ui/srp/src/`):
   - `utils/insights-model.ts` (`InsightsModel`, `insightsModel(response)`, `useInsightsApi`), `components/happyflow/sample-insights.ts` (the prototype's sample as an `InsightsModel`, built from today's constants so the sample view is unchanged),
     `insights-context.tsx` and `insights-page.tsx` (mirror `profile-page.tsx`); the `insights` route renders it and fetches the data only on that route.
   - `screens/insights.tsx` reads the model for: the six visibility figures and their source lines, the map card (heading "Map rank around {address}", "One-time scan · {Mon D}", the 49 cells coloured by rank with `rankColor`, the office pin on the centre cell, "You're #{rank} here" and the stored top 3 of the selected spot), "Named in {cited} of {checked} answers" and the three engine rows, the competitor table (place, name, rating (reviews), avg map; the seat's row highlighted), the question text with the leader's name, NORA's two notes and the locked cards. Layout, colours, tabs and the sheets are unchanged. A missing section shows nothing (not zero).
   - **Edits stay in the browser:** answering the question, adding a competitor and selecting a spot only change on-screen state. The Happyflow source guard (no `fetch`, no write call) still passes and its file count is updated.
   - The notice above a real Insights is the Home's: "Mock data · these values come from the local database and are not your real score or activity." when the data is mock.
5. **The seed** (`seat/seed_home.py` with a new pure builder `seat/seed_insights_plan.py`; same CLI, guards, mandatory `--backup-to`, one repeatable-read transaction, `--as-of`):
   writes, deterministically and labelled mock: six `insights_visibility` rows per seat (a few seats miss a metric so "unknown" shows), three `insights_ai_engines` rows whose `cited` and `checked` add up to the seat's Home `ai_cited` and `ai_checked`
   (each engine has `cited <= checked`), one `insights_competitor_positions` row per rival (the market leader has the lowest average), and the top 3 of every one of the seat's 49 map cells (a cell ranked 1 to 3 has "You" at that position; every other leader is one of the seat's own rivals, no duplicates in a spot).
   Same date twice changes nothing; backups cover the four tables. It needs the Home rows (snapshots, map cells, competitors) to exist first and refuses nothing else.

## Acceptance criteria
1. `GET .../insights` for the signed-in user's own seat returns 200 with the shape in step 2; another seat's id returns 403 `not_your_seat` before any other read; a Supabase session 501; a database error 503.
2. The read uses a read-only transaction, issues only `SELECT`, and reads only `tier_agents`, `users`, `home_snapshots`, `home_map_cells`, `home_competitors`, `home_seat_state`, `home_plans`, `profile_facts` and the four `insights_*` tables (a test asserts the SQL; no legacy `google_analytics`, `ai_authority_stats`).
3. The map equals Home's for the same seat: 49 cells with the stored ranks (`null` for "20+"), `top3` equals Home's "N of 49", `scanned_at` equals Home's map date (a real-Postgres test calls both); `address` equals the Profile's address fact.
4. `ai.cited` and `ai.checked` equal Home's `ai_cited` and `ai_checked` for every seeded seat (computed from the engine rows).
5. The competitor table sorts by average position with the seat's computed average; unknown positions sort last; ties as in step 3; `place` is 1-based and contiguous; the seat's rating and reviews equal Home's.
6. For every cell of every seeded seat the stored top 3 has 3 entries at positions 1, 2, 3; it contains "You" exactly when the cell's rank is 1 to 3, at that position; its other names are the seat's own rivals with no repeats.
7. `notes` follow step 3 with the exact numbers; each rule's drop case (no leader, no engine rows, unknown rating) is tested; `locked` shows the two cards below the top plan and none at the top plan.
8. A seat with no insights rows is `ready: false` with null sections; a section whose table has no row for the seat is empty or null, never zero.
9. The database enforces: one row per seat and metric / engine / competitor / (cell, position); the metric, engine and position vocabularies; `cited <= checked`; non-negative values; a leader row is "You" (null name) or a name, never both; a rival's position row belongs to a competitor of the same seat; trust tiers are the five.
10. The seed writes the rows; a second run with the same date changes 0 rows; a later date moves dates only; the backup holds the old rows; the seed's text names no person.
11. UI model: `insightsModel` maps every section; unknown stays unknown; the sample model equals every constant it replaces (a table of values); the colour of each cell follows the rank.
12. UI screen: a real seat shows its stored figures and none of the prototype's (a seat whose every figure differs, rendered; a list of sample constants that must not appear); with no real seat the page is the prototype's and the existing insights and render tests pass unchanged; the sample markup rendered with the old and the new `insights.tsx` is identical.
13. The local token reaches exactly eight routes (the seven today plus `.../insights`); every other token-checking route still refuses a local token; the only change to an existing table is the unique constraint of N2 (catalog diff), and no existing row changes.
14. `cd surface-api && SRP_TEST_DATABASE_URL=… uv run pytest` passes except the 3 known `test_migrations_security` failures; `ruff`, `bun test`, both `tsc` runs are clean.

## Data
- **Read** (owner SRP, schema `srp_cleanup`, all local): `tier_agents`, `users` (ownership), `home_snapshots` (map scan date, rating, reviews), `home_map_cells` (the 49 ranks), `home_competitors` (rivals), `home_seat_state` and `home_plans` (the plan), `profile_facts` (address), and the four new tables.
- **Written**: only by the seed; the endpoint writes nothing.
- **New objects and the existing object each extends** (`extend-never-duplicate`; checked in the repo and in `v3_local` `pg_class` on 2026-10-27: no table holds a per-seat visibility figure, an AI engine row, a competitor position or a spot leader; `google_analytics` is keyed by a polymorphic resource, mostly empty and has no profile-views column; `ai_authority_stats` is one row per agent with no engine split):
  - `insights_visibility` (N2): `id bigint identity`, `tier_agent_id` FK `tier_agents`, `metric varchar(20)` CHECK in the six, `value integer >= 0`, `period_days integer > 0 default 30`, `source varchar(60)`, `trust_tier varchar(20)` CHECK in the five tiers, `is_mock`, unique `(tier_agent_id, metric)`, index on `tier_agent_id`.
  - `insights_ai_engines`: `id`, `tier_agent_id` FK, `engine varchar(12)` CHECK in `chatgpt, gemini, perplexity`, `cited integer >= 0`, `checked integer >= 0`, CHECK `cited <= checked`, `note varchar(120)`, `is_mock`, unique `(tier_agent_id, engine)`. It extends Home's `home_snapshots.ai_cited`/`ai_checked` by splitting that figure per engine; it does not replace it.
  - `insights_competitor_positions`: `id`, `tier_agent_id` FK, `competitor_id` FK `home_competitors`, `avg_position numeric(3,1)` CHECK `>= 1`, `is_mock`, unique `(competitor_id)`, and a composite foreign key `(competitor_id, tier_agent_id)` to `home_competitors (id, tier_agent_id)` so a position can only belong to a competitor of the same seat. That needs **`unique (id, tier_agent_id)` on `home_competitors`**, the one change to an existing table (our own Home table; same pattern as `uq_home_snapshots_id_seat`, N2).
  - `insights_spot_leaders`: `id`, `cell_id` FK `home_map_cells (id)` on delete cascade, `position smallint` CHECK 1 to 3, `name varchar(160) null`, `is_you boolean`, CHECK `(is_you) = (name is null)`, `is_mock`, unique `(cell_id, position)`, index on `cell_id`. A leader row is the seat ("You", null name) or a rival's name (N5).
  - **Reused, not duplicated:** `home_map_cells`, `home_snapshots` (map, scan date, rating, reviews), `home_competitors` (rival name, rating, review count, article count), `profile_facts` (address), `home_seat_state`/`home_plans` (the plan), `home.parse_ids`, `owner_of`, `_iso`, `rankColor`, the seed's guards and backup.
- **Migration intent**: a local SQL script `surface-api/srp/db/local/insights_schema.sql` outside Alembic and the closed `surface-api/migrations/` stream: one transaction, additive, idempotent, commented rollback (drop the four tables and the one constraint); no RLS; `grant select, insert, update, delete … to v3_app` only, nothing to anon, authenticated or PUBLIC. Run order: schema-only `pg_dump` of `srp_cleanup` outside the repo (mode 600), run, catalog diff, seed with `--backup-to`, JOIN checks. It needs your explicit go-ahead.
- **Provenance / trust tier**: every visibility figure carries a source label and one of the five tiers (a mock mapping: "From Google" is `imported`, "From Experience.com" is `platform_observed`); AI engine rows and competitor positions are mock labelled rows (`is_mock`).

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | `GET /seat/professional/{id}/insights`, as of the newest snapshot; unknown stays unknown (a missing metric or engine is absent, a seat with no rows is `ready: false`, an unknown position sorts last, never 0) |
| Capabilities | none (read-only); a future "re-scan the map" or "check AI answers" capability would be an enrichment action, gated (O2) and entitled to the top plan |
| Events | none |
| Entitlement | the locked cards read the seat's plan against the top plan; the unmet experience is "Unlock →" |
| Explanation | the two note templates in step 3, authoritative numbers only |
| Value loop | insight (a rival wins on volume, an engine never names you) → NORA note → the person publishes or earns reviews → next scan and next AI check → ranks, citations and positions change |

## Security and scope
- Principal: a local sign-in session for its own seat only; delegation and impersonation are not served. Ownership is checked before any other read (`home.owner_of`).
- Grants: the four new tables to `v3_app` only; no RLS on new tables (owner ruling 2026-10-26); the script revokes from anon, authenticated and PUBLIC; no function and no trigger.
- Untrusted input: only the path id (`[0-9]{1,18}`), validated first; all values bound as parameters; stored names and notes are rendered as text, never as markup or instruction (the AI-answer notes stand in for content that would be inbound and untrusted).
- Shared core touched: only the route list in `surface-api/tests/test_local_token_scope.py` (seven to eight routes).

## Compliance
Nothing is published or sent. No rate, approval or ranking guarantee is shown: the page reports where the seat appears and where rivals appear, and the notes do not promise an outcome ("One article changes that" is not used; the template states the stored figures only). Competitor names are generic mock business names. When generated content is saved or published later (out of scope), `content_compliance_rules` and `exp_category_compliance` apply server-side.

## Canon review
Run 2026-10-27 on the finished diff (`canon-review` skill). Verdict: **clear to proceed locally; merge blocked by the rulings below** (flagged, not resolved).

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Ownership | PASS | the new code reads and writes only SRP's own `srp_cleanup` tables; `insights.py` imports only `home` from its own Surface; no `surfaces.<other>` import in the diff |
| 2 | Extend, never duplicate | PASS | `plan.md` records the live catalog and repo search; `google_analytics`, `ai_authority_stats` and `home_snapshots.ai_*` were considered and not extended; the only change to an existing table is the unique constraint of N2 |
| 3 | Identifiers | N/A | no gcid, record id or link table |
| 4 | Governed writes | N/A | no graph, search or category table written |
| 5 | Security | PASS | `insights_schema.sql:143-150` revoke all from anon, authenticated and public and grant `v3_app` only; no RLS, policy, trigger, function or SECURITY DEFINER (2026-10-26 ruling); the read is read-only and ownership-first (`insights.py:127-128`), the path id is validated and every value is bound; no secret in the diff |
| 6 | Model vs code | PASS | no model is involved; the notes are deterministic templates; a Supabase session gets `not_implemented` (501) |
| 7 | Gated actions | PASS | no cron, indexing, enrichment or dirty-queue draining; the "AI check" and "map scan" are mock rows, and a real feed is listed as O2 |
| 8 | Compliance | PASS | nothing is published or sent; the notes state stored figures and promise no outcome |
| 9 | Scoring / rings | PASS | SRS v5 and the rings are untouched |
| 10 | Open decisions | FLAGGED (the change-log point is ruled, N15) | O2 (a real map-scan and AI-check feed); unassigned scoring and identity ownership; the `srp_cleanup` name; and that `insights_schema.sql` is a local script outside Alembic and the closed SQL stream, with no `docs/ETL-Enhancements.md` entry (the second review noted this breaks the letter of §4's change-log rule; **ruled 2026-10-27: it stays out**, as for the Home, SRS and Profile increments, see N15) |

## Second-model review
Run 2026-10-27 by an independent subagent given the code, the spec and `AGENTS.md` (not my conclusions), read-only, with `SELECT`s on `v3_local`. It also derived the rules the page applies and checked the live data against them.

**Fixed (each with a test that fails without the fix):**
- **Finding 1 (medium): "wins on volume" contradicted the numbers beside it** on 3 of 40 seats (the seat had as many or more reviews than the leader). The title now says "wins on volume" only when both counts are known and the leader's is higher; otherwise "is your top rival" (N13). Tests: the boundary 411/412/413/500, unknown seat count, unknown leader count, no snapshot; the integration test applies the same rule to every live seat; live check on the 3 seats.
- **Finding 2 (medium): the second note's call to action said "Write my first article"** while 35 of 40 seats already have articles. It is now "Write an article" (N14). Tests: unit, route and integration. (The sample page keeps the prototype's text.)
- **Finding 6 (low): the screen indexed `cells[spot]` by list position.** The model now sorts the cells by grid place and the screen finds the selected spot by it; with no cell for the spot, nothing about a spot is shown instead of another spot's top three. Tests: shuffled cells, 48 cells, 7 cells; the sample markup comparison with `HEAD` was repeated and is still identical.
- **Found while fixing 1: "1 articles"** was shown on a live seat (leader with one article). Counts now agree in number. Tests: 8 cases.

**Recorded, not changed:**
- **Finding 3 (medium): rivals' stored average positions and their top-3 appearances only loosely agree.** The leaders of a spot are a weighted draw, and the three places of the 39 spots the seat is not in must be filled by the five rivals (about 135 slots), so even the weakest rival appears about as often as, or more often than, the seat's own 6 to 17 spots (the reviewer measured a mean of 12.6 for the weakest bucket); 5 of 200 rival and seat pairs show a rival with a worse average and more top-3 spots than the seat. Appearances are otherwise monotone in the average. The page applies no rule that relates the two, and there is no real model to derive them from; to be revisited with a real scan feed.
- **Finding 4 (medium): the seat's average is on a different scale from the rivals'** (a "20+" cell counts as 21, N3), and the seat sorts last in 28 of 40 seats while showing "You" in the top 3 of 6 to 17 spots. Plausible-looking, not wrong; it is a seed-design choice that needs the average-position convention ruling (N3).
- **Finding 5 (low):** every seat has `ai_checked` 7 (Home's figure), so each engine shows only 2 or 3 checks; 5 seats have 0 of 7, so the note reads "{first engine} never names you" (correct, repetitive).
- **Finding 7 (low):** no `docs/ETL-Enhancements.md` entry for the four tables and the constraint (see canon check 10). **Ruled 2026-10-27: none is needed** (N15); the earlier SRP increments have none either.
- **Finding 8 (low):** 2 seats have more Maps views than Search views and 8 have more website clicks than profile views. The page applies no rule between them; calls, directions and clicks are below Maps views on all 40 seats, which is the rule the seed keeps.

**Rules the reviewer checked on the live data, all with 0 violations:** 3 leaders at places 1, 2, 3 on all 1,960 spots; "You" exactly when the rank is 1 to 3, at that place; no repeated rival in a spot; every leader a rival of the same seat; one market leader per seat with the lowest average; no rival without a position; the vocabulary, source and tier pairs; `cited <= checked` and notes that agree with their counts; engine sums equal Home's; 49 cells on every seat; addresses that parse to a city. The reviewer also confirmed the half-up rounding, the 21 for a "20+" cell, unknown sorted last and never 0, the grants, no cross-Surface import and no people's names in the increment's code, DDL or spec.

## Decision log entries
| # | Date | Decision | What it blocks |
|---|---|---|---|
| N1 | 2026-10-27 | NORA's two notes are computed templates over the competitor, engine and rating rows, not stored text | a stored, editable note set |
| N2 | 2026-10-27 | Four new tables (`insights_visibility`, `insights_ai_engines`, `insights_competitor_positions`, `insights_spot_leaders`) and **one added unique constraint** `(id, tier_agent_id)` on Home's `home_competitors`, so a position row cannot name another seat's rival | a single source for competitor data (needs a ruling on a real competitor model) |
| N3 | 2026-10-27 | The seat's average map position is computed from its 49 stored ranks (a "20+" cell counts as 21), not stored | the real market-scan convention |
| N4 | 2026-10-27 | The top 3 of every map spot is stored (about 147 rows per seat), seeded from the seat's own rivals, not computed in code (confirmed) | a real scan feed |
| N5 | 2026-10-27 | A spot-leader row is the seat (`is_you`, null name) or a rival's name; "You" is shown as "You" | none |
| N6 | 2026-10-27 | The engine rows add up to Home's `ai_cited` and `ai_checked` by seed and test, not by a database trigger | a trigger, if the two ever become one source |
| N7 | 2026-10-27 | Each visibility figure has a source and a tier; "Experience.com profile views" says "From Experience.com" (the prototype labels all six "from Google"); the sample page keeps its labels | the real source and tier rules |
| N8 | 2026-10-27 | The two locked cards are shown below the top plan, with fixed copy; the plan gating is Home's mock rule | plan and pricing rulings |
| N9 | 2026-10-27 | Competitor table order: average position ascending, unknown last, rivals before the seat on ties | the real ranking rule |
| N10 | 2026-10-27 | The local token is accepted on an eighth route (`.../insights`); the change is the route list in the shared scope test | none, but needs shared-core review |
| N11 | 2026-10-27 | The competitor question names the market leader and stays on screen; answering and adding a competitor write nothing | a write path |
| N12 | 2026-10-27 | The centre cell (row 3, column 3) is the office pin and is the default selected spot, as in the prototype | none |
| N13 | 2026-10-27 | (second review) The first note says the leader "wins on volume" only when both review counts are known and the leader's is higher; otherwise "is your top rival" | the real wording of NORA's notes |
| N14 | 2026-10-27 | (second review) The second note's call to action is "Write an article" (the prototype's "Write my first article" is wrong for a seat that has articles) | the real wording of NORA's notes |
| N15 | 2026-10-27 | `srp_cleanup` tables are a local schema outside Alembic and the closed SQL stream and get **no** `docs/ETL-Enhancements.md` entry; this covers the Home, SRS, Profile and Insights increments (ruled 2026-10-27). | none |
