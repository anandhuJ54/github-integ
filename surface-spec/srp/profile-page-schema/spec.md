# Spec: Serve the Happyflow Profile page from the local database, read-only

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [plan](./plan.md) (not written yet) · contracts: `contracts/srp/openapi.json` (one new response, see Data)

Status of this spec: **draft for approval**. Decisions N1 to N12 in the decision log are choices this spec makes that need your confirmation; **N2 changes the intent** (two new tables, not one).
It extends `srp/home-page-schema` and `srp/srs-page-schema` (seed, helpers, method); it changes nothing they decided.

## Behaviour
Deterministic code decides everything; no model is involved. Reads are `SELECT` only. The database changes are two new tables in `srp_cleanup` (local `v3_local` only) and the mock rows
the seed writes into them and into the existing mock columns the page reads (N4). The edit flows write nothing.

1. **The read.** `GET /srp/seat/professional/{pro_id}/profile`: a local sign-in session, its own seat only (403 `not_your_seat` otherwise; ownership is checked first through `home.owner_of`),
   `set transaction read only` first, one connection; a database error answers 503 `database_unavailable`; a Supabase session gets 501 `not_implemented`.
2. **The response** (`ProfileResponse`). Every value is a stored value or a computed one (step 3); nothing is invented.
   - `as_of`, `data` = `"mock"` or `"live"` (from the fact rows' `is_mock`), `ready` (false when the seat has no `profile_facts` row at all; every other section is then `null`).
   - `facts`: one entry per field, always all 18 in this fixed order: `name, title, photo, bio, year_started, office_phone, mobile_phone, email, address, hours, nmls, licensed_in, products,
     service_areas, designations, awards, education, company`. Each is `{ field, present, value, source, trust_tier, confirmed_at, source_line }`. `present` is false when the seat has none of that fact:
     then `value`, `source`, `trust_tier`, `confirmed_at` and `source_line` are `null` and the page says "Missing". `value` is a string, or a list of strings for `products`.
   - `preview`: `{ title, company, city, rating, reviews, nmls, strength_pct, photo_url }`.
   - `credentials`: `{ added, of }` (`of` is always 3).
   - `graph`: `{ groups: [{ key, facts }], facts_total, sources }`, groups in the order identity, contact, licence, products, reviews, presence.
3. **Where each fact's value comes from (N1, N3):**
   - **Existing tables, read as they are** (the fact row only supplies the source line and tier): `name` (`users.first_name` + `last_name`), `title` (`tier_agents.title`), `photo` (`tier_agents.profile_photo`), `bio` (`tier_agents.description`),
     `year_started` (`tier_agents.year_started`), `office_phone` (`tier_agents.phone_number`), `mobile_phone` (`tier_agents.mobile_number`), `email` (`users.email`). A fact is present when its column is not null and not blank after trimming.
   - **`profile_facts.value`** (no coherent home in the existing tables): `address`, `hours`, `nmls`, `licensed_in`, `products`, `service_areas`, `designations`, `awards`, `education`, `company`. Present when a row exists with a non-blank value.
   - The database enforces "no second copy": a `profile_facts` row has a `value` if and only if its field is one of those ten (a CHECK), so a value of an existing-table field can never be stored again.
4. **What is computed (never stored):**
   - `source_line`: the source label, plus ` · Mon D` when `confirmed_at` is set (UTC date, same formatter as Home's `monthDay`): "Confirmed by you · Oct 16", "From LinkedIn".
   - `credentials.added` = how many of `designations`, `awards`, `education` are present.
   - `graph.facts_total` = the sum of the group counts; `graph.sources` = how many groups have more than 0 facts ("67 facts from 6 sources").
   - `preview.rating` and `preview.reviews` = the newest `home_snapshots` row's `review_avg` and `review_count`; `strength_pct` = its `profile_strength_pct`; `city` = its `rank_city` (the seat's market, the same city Home shows); `title` and `photo_url` as in step 3; `nmls` and `company` from their facts (null when absent). With no snapshot, rating, reviews, strength and city are `null` (unknown, never 0).
5. **The UI** (`surface-ui/srp/src/`):
   - `utils/profile-model.ts` (`ProfileModel`, `profileModel(response)`, `useProfileApi`), `components/happyflow/sample-profile.ts` (the prototype's sample as a `ProfileModel`, built from today's constants so the sample view is unchanged),
     `profile-context.tsx` and `profile-page.tsx` (mirror `srs-page.tsx`); the `profile` route renders it and fetches the data only on that route.
   - `screens/profile.tsx` reads the model for: the initial value of each of the 15 editable facts, each row's source line and colour, the Photo row and avatar (initials when there is no photo; never the sample photo), the preview (title, company, city, rating, reviews, NMLS, "% complete"),
     the nine product chips and the "N loan products" note, the "N of 3 added" credentials note, the expertise graph bars and "N facts from M sources", and the quick actions' "Reviews (N)" and "★ rating".
     Layout, colours, voice dictation and the edit sheets are unchanged.
   - **Source colour** follows the trust tier: `owner_verified` and `authority_verified` are green, the others grey (the prototype coloured by the words "Confirmed/Verified/Updated/Approved"; the sample model carries the tier that reproduces it) (N8).
   - **Missing facts** show "Missing" and "Not found anywhere yet" as today. **The bio** row shows NORA's draft when the bio is missing or thin (under 60 characters, N5); the draft is a fixed template over the facts, never generated text:
     `{name} has helped {city} families buy and refinance homes for {years} years, with a focus on first-time buyers and {first two products}.` with `years` = the year of `as_of` minus `year_started`; a part whose fact is missing is left out.
   - **No invented offer (N6):** for a real seat the "I found 2 certifications on LinkedIn. Add them?" card is not shown (nothing in the database says anything was found); the Credentials card keeps its "Missing" note and its edit sheet. The sample page keeps the offer.
   - **Edits stay in the browser.** Review changes, Save and the demo edit store only change on-screen state. For a real seat the browser store key is per seat (`hf-demo-profile:{id}`, N7) so one person's local edits never show on another's profile; the sample key is unchanged. The page makes no write call (the Happyflow source guard).
   - The notice above a real Profile is the Home's: "Mock data · these values come from the local database and are not your real score or activity." when the data is mock.
6. **The seed** (`seat/seed_home.py` and a new pure builder `seat/seed_profile_plan.py` imported by it; same CLI, guards, mandatory `--backup-to`, one repeatable-read transaction, `--as-of`):
   - writes `profile_facts` for every seat (rows for the facts the seat has; some seats lack some facts, so Missing shows) and `profile_graph_groups` (6 rows per seat), all deterministic, labelled mock, and **corrects the mock junk in the existing columns the page reads** for the seeded seats:
     `tier_agents.title`, `description` (some seats get a thin or missing bio), `phone_number`, `mobile_number` (some null), and `profile_photo` (some null); `year_started` is already written by the Home seed (N4).
   - Names are the existing mock users' names; no person is named in any text the seed writes (the company, the address and the sources are generic: "Mock Lending Co.", "100 Example Street", "From LinkedIn").
   - the same `--as-of` twice changes nothing; a later date moves `confirmed_at` dates and nothing else; backups cover both new tables and the corrected columns.

## Acceptance criteria
1. `GET .../profile` for the signed-in user's own seat returns 200 with the shape in step 2 (all 18 facts in order); another seat's id returns 403 `not_your_seat` before any other read; a Supabase session 501; a database error 503.
2. The read uses a read-only transaction, issues only `SELECT`, and reads only `tier_agents`, `users`, `profile_facts`, `profile_graph_groups` and `home_snapshots` (a test asserts the SQL; no legacy `srs_*`, `locations`, `tier_locations`, `agent_locations`).
3. Table-backed facts are read from their existing column (and an existing-column fact with a blank value is `present: false`); `profile_facts`-backed facts come from the row; each present fact has a `source_line` built from its row (label, and the date only when `confirmed_at` is set).
4. `credentials` counts the present ones of designations, awards, education; `graph.facts_total` is the sum of the groups and `graph.sources` the number of groups above 0.
5. `preview.rating`, `reviews`, `strength_pct` and `city` equal Home's `tiles.reviews`, `tiles.profile_strength` and `rank.city` for the same seat (a real-Postgres test calls both); with no snapshot they are `null`.
6. A seat with no `profile_facts` row is `ready: false` with null sections.
7. The database enforces: one row per seat and field; `field` is one of the 18; `trust_tier` is one of the five; `value` is null exactly for the eight existing-table fields; `value` is a JSON string or array of strings; one row per seat and group, with `group_key` one of the six and `facts >= 0`; both seat foreign keys.
8. The seed writes the rows and the corrected columns; a second run with the same date changes 0 rows; a later date moves dates only; the backup holds the old rows and the old column values; no table other than these two and the listed columns of `tier_agents` changes; the seed's text contains no person's name.
9. UI model: `profileModel` maps every fact, the preview, credentials and graph; a missing fact is `Missing`; no photo gives initials; the bio draft is the template; the colour follows the tier; null rating/strength stay unknown; `sampleProfileModel` equals every constant it replaces (a table of values).
10. UI screen: a real seat shows its stored facts and none of the prototype's (a seat whose every fact differs, rendered; a list of sample constants that must not appear); with no real seat the page is the prototype's and the existing profile tests and render tests pass unchanged; the LinkedIn offer is absent for a real seat and present in the sample.
11. Edits: the demo edit flows still change only browser state; for a real seat the store key includes the seat id (a test with two seats); the Happyflow source guard (no `fetch`, no write call) passes and its file count is updated.
12. The local token reaches exactly seven routes (the six today plus `.../profile`); every other token-checking route still refuses a local token.
13. The seat read's other fields, the legacy tables, `locations`, `tiers` and every other existing table are unchanged (row counts and a catalog diff before and after; the only changed data in existing tables are the listed `tier_agents` columns).
14. `cd surface-api && SRP_TEST_DATABASE_URL=… uv run pytest` passes except the 3 known `test_migrations_security` failures; `ruff`, `bun test`, both `tsc` runs are clean.

## Data
- **Read** (owner SRP, schema `srp_cleanup`, all local): `tier_agents`, `users` (ownership and the existing-table facts), `profile_facts`, `profile_graph_groups`, `home_snapshots` (rating, reviews, strength, city).
- **Written**: only by the seed; the endpoint writes nothing. The seed writes the two new tables and the columns `title`, `description`, `phone_number`, `mobile_number`, `profile_photo` of `tier_agents` (mock values only, with a backup first).
- **New objects and the existing object each extends** (`extend-never-duplicate`; checked in the repo and in `v3_local` `pg_class` on 2026-10-27: no table holds a fact source, trust tier or per-seat fact; `education_details`, `service_areas` and `services` are keyed by ids into reference tables that are not loaded and hold no source or tier; `tier_agent_details.certifications` is a bare list):
  - `profile_facts`: `id bigint identity`, `tier_agent_id bigint` FK `tier_agents`, `field varchar(20)` CHECK in the 18, `value jsonb null` CHECK (null exactly for the eight existing-table fields; else a JSON string or array of strings), `source varchar(60) not null`, `trust_tier varchar(20) not null` CHECK in the five tiers, `confirmed_at timestamp null`, `is_mock boolean not null default true`, unique `(tier_agent_id, field)`, index on `tier_agent_id`. It extends the existing profile columns by adding what they lack (source, tier, date, and the ten facts with no coherent home); it does not copy their values.
  - `profile_graph_groups` (N2): `id bigint identity`, `tier_agent_id` FK, `group_key varchar(12)` CHECK in `identity, contact, licence, products, reviews, presence`, `facts integer not null` CHECK `>= 0`, `is_mock`, unique `(tier_agent_id, group_key)`, index. The per-source fact counts of the "Expertise graph" card; no graph table exists in the local schema, and the real graph is written only by the governed path (`AGENTS.md` §3), which this page does not touch.
  - **Reused, not duplicated:** `tier_agents` and `users` columns (above), `home_snapshots` (rating, reviews, strength, city), `home.owner_of` and `parse_ids`, Home's `monthDay` formatter, the seed's guards and backup, the scratch-schema test fixtures, the persona override for the other screens.
- **Migration intent**: a local SQL script `surface-api/srp/db/local/profile_schema.sql` outside Alembic and the closed `surface-api/migrations/` stream (same stance as `srs_schema.sql`): one transaction, additive, idempotent, commented rollback; no RLS; `grant select, insert, update, delete … to v3_app` only, nothing to anon, authenticated or PUBLIC. Run order: schema-only `pg_dump` of `srp_cleanup` outside the repo (mode 600), run, catalog diff, seed with `--backup-to`, JOIN checks. It needs your explicit go-ahead.
- **Provenance / trust tier**: every fact row carries a source label and one of `self_declared < imported < platform_observed < authority_verified < owner_verified`. The mock mapping: "From LinkedIn" and "From Google" are `imported`, "From NMLS" is `authority_verified`, "Confirmed by you" is `owner_verified`, "Added by you" is `self_declared` (N8). All rows are mock (`is_mock`).

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | `GET /seat/professional/{id}/profile`; unknown stays unknown (a missing fact is `present: false`, a seat with no rows is `ready: false`, no snapshot gives null rating, not 0) |
| Capabilities | none (read-only); a future "save fact" capability would need an entitlement, a trust-tier rule and compliance on text |
| Events | none |
| Entitlement | none for the read |
| Explanation | the bio-draft template and the source line, authoritative values only |
| Value loop | missing or thin fact → NORA's prompt → the person adds or confirms it → the fact's source and tier rise → profile strength and the Completeness lane change on the next scan |

## Security and scope
- Principal: a local sign-in session for its own seat only; delegation and impersonation are not served. Ownership is checked before any other read (`home.owner_of`).
- Grants: both tables to `v3_app` only; no RLS on new tables (owner ruling 2026-10-26); the script revokes from anon, authenticated and PUBLIC; no function and no trigger.
- Untrusted input: only the path id (`[0-9]{1,18}`), validated first; all values bound as parameters; stored text is rendered as text (React escapes it), never as markup or instruction.
- Shared core touched: only the route list in `surface-api/tests/test_local_token_scope.py` (six to seven routes).

## Compliance
Nothing is published or sent. The page displays the NMLS number (the mortgage rule: display the NMLS ID); the bio draft is a fixed template with no rate, approval or price claim and no steering language; stored mock text contains none. When generated text is saved or published later (out of scope), `content_compliance_rules` and `exp_category_compliance` apply server-side.

## Canon review
Run 2026-10-27 on this spec (live catalog read-only; nothing applied):

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Ownership | PASS | writes only the two new tables and mock columns of SRP-owned `tier_agents` in the local schema; no other Surface's table is read or written |
| 2 | Extend, never duplicate | PASS | Data section; plan.md "Extend-never-duplicate check"; `value` is stored only for fields with no coherent home and the database refuses a second copy (CHECK) |
| 3 | Identifiers | N/A | no gcid, record id or link table is used |
| 4 | Governed writes | N/A | no graph or category table is written; `profile_graph_groups` is a local mock count table, not the governed graph |
| 5 | Security | PASS | no RLS on new tables, grants to `v3_app` only, nothing for anon/authenticated/PUBLIC, no function or trigger, no secrets, stored text rendered as text |
| 6 | Model vs code | PASS | the bio draft is a fixed template; authorization and presence rules are code; unknown stays unknown |
| 7 | Gated actions | PASS | no cron, indexing, enrichment or dirty-queue use |
| 8 | Compliance | PASS (as scoped) | NMLS displayed; nothing published or sent; the template has no rate, approval or price claim; saving generated text is out of scope |
| 9 | Scoring / rings | N/A | no score rule or ring logic; "% complete" is Home's stored value (O5) |
| 10 | Open decisions | FLAGGED | O5, identity and claim ownership (unassigned), trust-tier rules, the seat's office location, the `srp_cleanup` name |

Verdict: clear locally; merge blocked by identity and claim ownership, O5, the trust-tier rules, the office-location ruling and the `srp_cleanup` schema name.

### Canon review of the finished diff (2026-10-27)

Run with the `canon-review` skill on the finished code (`profile_schema.sql`, `profile.py`, the route, the seed plan and its apply step, the UI model, store and screen). Same result as the spec run: 1 PASS (only SRP-owned tables, nothing from another Surface, `profile.py:13-20`), 2 PASS (reuses `home.parse_ids`, `owner_of`, `_iso`; a CHECK makes a second copy of an existing value impossible), 3 N/A, 4 N/A, 5 PASS (`profile_schema.sql:85-88` revokes anon, authenticated and PUBLIC and grants `v3_app` only; no RLS, policy, function, trigger or `SECURITY DEFINER`; ownership and the read-only transaction come first, `profile.py:79-80`), 6 PASS, 7 PASS, 8 PASS as scoped, 9 N/A, 10 FLAGGED (identity and claim ownership, O5, trust-tier rules, the seat's office location, the `srp_cleanup` name). No people's names, no legacy table reads, no change to `_base/`, `app/` or `tools/`; the only shared-core file touched is the route list in `surface-api/tests/test_local_token_scope.py`.

Verdict: clear locally; merge blocked by identity and claim ownership, O5, the trust-tier rules, the office-location ruling and the `srp_cleanup` schema name.

## Second-model review

An independent subagent reviewed the code with no access to my conclusions, read-only, and was told to check the **live seeded data** against every rule the page and service apply (the SRS review's lesson). It ran 232 backend and 184 UI tests (all passed) and found no authorization, SQL, jsonb, grant or RLS defect. Findings and how each was reconciled (each re-checked by me on the data or the code):

| # | Finding (severity) | Checked by | Outcome |
|---|---|---|---|
| 1 | Seeded full bios name "FHA and VA loans" but the same seat's products list may lack them (Medium, seed data) | Query on `v3_local`: 21 full bios, 7 with a products list lacking FHA or VA, 3 with no products | **Real. Fixed in the seed plan, tests first:** a full bio names no loan product. Test fails without the fix |
| 2 | Licence facts are not coupled (NMLS without a licensed state or the reverse), and the graph groups ignore the facts (Medium, seed data) | Query: 1 seat with NMLS and no state, 2 with a state and no NMLS; 4 seats with a products group above 0 and no products fact | **Real. Fixed:** a licensed state goes with an NMLS number (one presence draw); the products group is 0 when there is no products fact and the licence group is 0 when there is no licence fact. Tests fail without it. Left as is: "52 facts from 6 sources" beside 11 visible rows (the graph counts facts across all sources, as the prototype does) |
| 3 | The screen kept one seat's edits when the seat changed under it (two seats of the same user), writing them into the other seat's store key (Low-medium, UI) | Read the code: the edit state is initialised once from `useState`, and the route does not remount | **Real. Fixed:** `ProfileForSeat` renders the screen with `key={storeKey}` so it remounts; a structural test (the key is in the source) and a mutation check. Not run in a browser |
| 4 | The saved edit store froze every fact, so a later database change was hidden under a fresh source line (Low, UI) | Read `saveStored` and `loadStored` | **Real. Fixed, tests first:** only the edited fields are kept; the rest come from the current data. One existing test was updated to the new behaviour |
| 5 | NORA's "bio is thin" note and the preview NMLS do not react to edits (Low, UI) | Read the code; the prototype's preview and note did not react either | Accepted: unchanged prototype behaviour, noted in evidence |
| 6 | "Approved by you" (owner verified, dated) sits on a thin bio the page hides behind "NORA draft ready" (Low, seed data) | Query: 6 seats | **Real. Fixed:** a thin bio takes "From LinkedIn" or "Added by you"; a full bio can be approved. Test fails without it |
| 7 | Tests that cannot fail: the market-rules test only used the default market; the store key test was a regex (Low) | Read the tests | **Fixed:** the market test now runs all four markets with their zip codes, and an integration test checks the written rows (address city equals the Home market city, licence coupling, graph, thin-bio source); the store and remount tests have mutation checks. Cosmetic mock quirks (an Iowa ZIP range on Illinois addresses, area codes ignoring the state) are accepted |

It checked and found fine: the CHECKs, keys, grants and no RLS (live), ownership before any read, the snapshot choice (same as Home's), `ready: false` and null figures, jsonb strings staying strings (`_wrap` precedence), the backup of the corrected columns, idempotence, tier and date agreement on all 549 live rows, thin and full bio limits, address city and state against the Home market, phone formats, photos null for every seat, no people's names, and no gated action.

**Applied live:** the seed was re-run on `v3_local` with your go-ahead and a backup (inserted 1, updated 40, deleted 2; second run 0); the JOIN checks and the Profile trace were repeated and pass (see `trace.md`).


## Decision log entries
| # | Date | Decision | What it blocks |
|---|---|---|---|
| N1 | 2026-10-27 | `profile_facts` holds a source, trust tier and date for all 18 fields; its `value` is stored only for the ten fields with no coherent home, enforced by a CHECK (no second copy) | a single source for provenance across the platform |
| N2 | 2026-10-27 | **Changes the intent:** a second small table `profile_graph_groups` holds the expertise-graph per-source counts (the prototype's 12, 9, 6, 11, 15, 14); computed totals come from it | a real source for those counts (the governed graph) |
| N3 | 2026-10-27 | `address`, `hours` and `company` live in `profile_facts`: the legacy links from a seat to a location (`agent_locations`, `tier_locations`) are random in the mock and disagree with the seat's market, `business_hours` has no known shape (`{"n": 34, "mock": true}`) and `tiers.name` is junk | which location is a seat's office (an identity ruling) |
| N4 | 2026-10-27 | The seed corrects the mock junk in `tier_agents.title`, `description`, `phone_number`, `mobile_number`, `profile_photo` for seeded seats (backed up first) | nothing else; these are mock columns |
| N5 | 2026-10-27 | A bio under 60 characters is thin and shows NORA's draft (a mock rule) | the real completeness rule (O5) |
| N6 | 2026-10-27 | A real seat shows no "found on LinkedIn" offer | real source integrations |
| N7 | 2026-10-27 | For a real seat the browser edit store is keyed by seat id | none |
| N8 | 2026-10-27 | Source colour follows the trust tier; the label-to-tier mapping is mock | the real source-to-tier rules |
| N9 | 2026-10-27 | `preview.city` is the Home snapshot's market city, not a legacy location | a ruling on the seat's office location |
| N10 | 2026-10-27 | The local token is accepted on a seventh route (`.../profile`); the change is the route list in the shared scope test | none, but needs shared-core review |
| N11 | 2026-10-27 | "64% complete" is Home's stored `profile_strength_pct`, not computed from the facts (O5 open) | calibration (O5) |
| N12 | 2026-10-27 | `bio` draft is a deterministic template, not model text | any generated bio (needs compliance and a model call) |
| N13 | 2026-10-27 | A full bio names no loan product, a licensed state goes with an NMLS number, the products and licence graph groups are 0 when the seat has no such fact, and a thin bio is never "Approved by you" (second review findings 1, 2 and 6) | none |
| N14 | 2026-10-27 | The browser store keeps only the edited facts, and the screen remounts per seat (second review findings 3 and 4) | none |
| N15 | 2026-10-27 | `srp_cleanup` tables are a local schema outside Alembic and the closed SQL stream and get **no** `docs/ETL-Enhancements.md` entry; this covers the Home, SRS, Profile and Insights increments (ruled 2026-10-27). | none |
