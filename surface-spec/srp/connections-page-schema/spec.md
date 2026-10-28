# Spec: Serve the Happyflow Connections page from the local database, read-only

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [plan](./plan.md) · [evidence](./evidence.md) · [trace](./trace.md) · contracts: `contracts/srp/openapi.json` (one new response, see Data)

Status of this spec: **approved (2026-10-27); canon review recorded 2026-10-28**. Decisions C1 to C16 in the decision log are choices this spec makes that need your confirmation. **C9 to C12 change existing mock values of the earlier increments** (the Web analytics Indexing source, the SRS Connections lane text) so the pages agree; they are backed up by the seed.
It extends `srp/home-page-schema`, `srp/srs-page-schema`, `srp/profile-page-schema`, `srp/insights-page-schema` and `srp/web-analytics-page-schema` (tables, seed, helpers, method); it changes no schema of an existing table.

## Behaviour
Deterministic code decides everything; no model is involved. Reads are `SELECT` only. The database change is one new table in `srp_cleanup` (local `v3_local` only) plus the mock rows the seed writes, and the corrections of existing mock values named in C9 to C12. "Connect" (the card button and NORA's note buttons) changes only what the browser shows;
nothing is signed in, fetched, stored or written, and no token or secret is kept anywhere.

1. **The read.** `GET /srp/seat/professional/{pro_id}/connections`: a local sign-in session, its own seat only (403 `not_your_seat` otherwise; ownership first through `home.owner_of`), `set transaction read only` first, one connection; a database error answers 503 `database_unavailable`; a Supabase session gets 501 `not_implemented`.
2. **The response** (`ConnectionsResponse`). Every value is a stored value or a computed one (step 3); nothing is invented.
   - `as_of`, `data` = `"mock"` or `"live"` (`"mock"` when any row is mock), `ready` (false when the seat has no `connected_accounts` row; every other section is then `null`).
   - `accounts`: the eleven accounts in the page's order `google_business, search_console, youtube, facebook, instagram, linkedin, x, zillow, yelp, website_cms, loan_system`: `[{ key, name, state, status, powers, synced_at }]`; `state` is `connected`, `available` (the page's "connect"), `matched` or `partial`; only the accounts that have a row.
   - `summary`: `{ connected, matched }`: the number of `connected` accounts, and of `matched` plus `partial` ones (the prototype's "2 matched" is Zillow matched and Yelp partial).
   - `suggest`: the accounts among Search Console and Website / CMS that are `available`, as `[{ key, name }]` (drives the summary sentence and the notes).
   - `notes`: `[{ title, body, cta, connect }]`, NORA's notes, `connect` the account's key.
   - `locked`: `{ title, text } | null`, the directories card.
3. **What is computed (never stored):**
   - `name` is the account's label (the page's, fixed per key). `status` per account (C4): `connected` Google Business Profile `"Connected · synced {Mon D}"` (`"Connected"` when it has no sync time), `connected` YouTube `"Connected through Google"`, any other `connected` `"Connected"`; `available` Search Console `"Part of the Google sign-in, not yet granted"`, any other `available` an empty string; `matched` `"Matched, no sign-in needed"`; `partial` `"Match found · replies need Yelp's partner access"`.
   - `powers` per account is the page's fixed text, except Google Business Profile: `"GBP lane ({earned} of {max}), hours, photos, reviews"` from the seat's SRS v5 `gbp` lane in its newest snapshot (`"GBP lane, hours, photos, reviews"` when the lane is unknown, never 0) (C5).
   - `summary` as above; `suggest` in the order Search Console, Website / CMS.
   - `notes` (C6): for each account in `suggest`, in that order: Search Console `"Search Console is one tap away."` with `"It's part of your Google sign-in. It shows me which searches find your page."` and cta `Connect it`; Website / CMS `"Your Website / CMS would let me apply fixes."` with `"Right now I can only hand them to your webmaster."` and cta `Connect it`.
   - `locked` (C7): shown when the seat's plan (`home_seat_state` and `home_plans`) is `core`; `null` for `engage` and `amplify` (Engage is included in Amplify) and when the plan is unknown; the text is the prototype's ("Publish your details to Apple Maps, Bing and 28 directories." / "Unlock with Engage, included in Amplify.").
4. **The UI** (`surface-ui/srp/src/`):
   - `utils/connections-model.ts` (`ConnectionsModel`, `connectionsModel(response, seatId)`, `useConnectionsApi`), `components/happyflow/sample-connections.ts` (the prototype's sample as the same model, built from today's constants so the sample view is unchanged), `connections-context.tsx` and `connections-page.tsx` (mirror the Web analytics page); the `connections` route renders it and fetches only on that route.
   - `screens/connections.tsx` reads the model for: the summary sentence (`<b>{connected} connected, {matched} matched.</b>` and, from `suggest`: both unconnected, the prototype's sentence; one, `Connect <b>{name}</b> and I can {purpose}.` with the purposes "see which searches find your page" and "apply your website fixes myself"; none, no second sentence) (C8), the eleven cards (monogram and colour of the page, name, powers, status, pill, Connect button), the notes and the directories card. A missing account or section draws nothing. Layout, colours and icons are unchanged.
   - **Connect stays in the browser:** the button and the notes only set the shell's `connected` state ("Connected just now", the toast), as today; the header count is the stored count plus those clicks, as the prototype's `4 + connected`. The Happyflow source guard (no `fetch`, no write call) still passes and its file count is updated.
   - The notice above a real page is Home's ("Mock data · these values come from the local database and are not your real score or activity." when the data is mock).
5. **The seed** (`seat/seed_home.py` with a new pure builder `seat/seed_connections_plan.py`; same CLI, guards, mandatory `--backup-to`, one repeatable-read transaction, `--as-of`): writes eleven `connected_accounts` rows per seat, deterministic and labelled mock, and corrects existing mock values (C9 to C12). It builds from the Home, Profile and Web plans and runs after them. The rules it keeps (each a test over the written rows):
   - **Google (C9):** Google Business Profile is `connected` for every seat (the SRS `gbp` gap says "Connected" for all 40, and the Profile and Insights figures labelled "From Google" need it), synced within the 7 days before `as_of`; YouTube and Search Console can be `connected` only when it is (they are part of the Google sign-in).
   - **LinkedIn (C10):** LinkedIn is `connected` for every seat whose Profile has a fact "From LinkedIn" (all 40 today); it is the one social account the Profile depends on.
   - **Social count (C11):** the connected social accounts (Facebook, Instagram, LinkedIn, X) equal the SRS Connections lane's "you" count; the seed corrects that SRS text to the count (it was 0 to 4 at random, so 12 seats with a LinkedIn-sourced Profile said "0"), keeping the gap to the rival text.
   - **Search Console (C12):** the Web analytics Indexing check says "From Google Search Console" (imported) only for a seat whose Search Console is `connected`, otherwise "From your site scan" (platform_observed).
   - **Videos (C13):** a seat whose SRS Videos lane has a last video has YouTube `connected`; a seat with "No videos" may have either.
   - `matched` and `partial` only for Zillow and Yelp; `synced_at` null exactly for `available` accounts; every seat has all eleven rows; same date twice changes nothing; a later date moves `synced_at` only; backups cover the new table and the corrected values.

## Acceptance criteria
1. `GET .../connections` for the signed-in user's own seat returns 200 with the shape in step 2; another seat's id returns 403 `not_your_seat` before any other read; a Supabase session 501; a database error 503.
2. The read uses a read-only transaction, issues only `SELECT`, and reads only `tier_agents`, `users`, `home_snapshots`, `home_snapshot_lanes`, `home_score_lanes`, `home_seat_state`, `home_plans` and `connected_accounts` (a test asserts the SQL; no `social_media_connections`).
3. The GBP "powers" figures equal the SRS page's `gbp` lane (earned and max) for every seeded seat; unknown stays unknown (no snapshot gives no numbers).
4. The summary counts equal the rows (connected; matched plus partial); `suggest` lists exactly the unconnected Search Console and Website / CMS; the notes follow `suggest`; the directories card follows the plan.
5. The connected social accounts equal the SRS Connections lane count for every seed seat (a real-Postgres test calls the SRS read); a seat with a Profile fact "From LinkedIn" has LinkedIn connected.
6. The Indexing check's source follows Search Console; Google Business Profile is connected for every seat with a Google-sourced fact; the statuses agree with their states; a seat whose Videos lane has a video has YouTube connected.
7. A seat with no `connected_accounts` row is `ready: false` with null sections; a missing account is absent, never invented.
8. The database enforces: one row per seat and account, the eleven keys, the four states, matched or partial only for Zillow and Yelp, `synced_at` null exactly for `available`, the five tiers, the seat foreign key.
9. The seed writes the rows and the corrections; a second run changes 0 rows; a later date moves `synced_at` only; the backup holds the old rows and old values; the seed's text names no person.
10. UI model: `connectionsModel` maps every section; the sample model equals every constant it replaces (a table of values including the 11 cards, the header sentence and the notes); the summary sentence variants.
11. UI screen: a real seat shows its stored values and none of the prototype's (a list of sample constants that must not appear); with no real seat the page is the prototype's and the existing tests pass unchanged; the sample markup rendered with the old and the new `connections.tsx` is identical.
12. The local token reaches exactly ten routes (the nine today plus `.../connections`); every other token-checking route still refuses a local token; no existing table's schema changes (catalog diff), and the only existing rows that change are the corrections of C9 to C12.
13. `cd surface-api && SRP_TEST_DATABASE_URL=… uv run pytest` passes except the 3 known `test_migrations_security` failures; `ruff`, `bun test`, both `tsc` runs are clean.

## Data
- **Read** (owner SRP, schema `srp_cleanup`, all local): `tier_agents`, `users` (ownership), `home_snapshots`, `home_snapshot_lanes` and `home_score_lanes` (the `gbp` lane), `home_seat_state` and `home_plans` (the plan) and the new `connected_accounts`.
- **Written**: only by the seed; the endpoint writes nothing.
- **New object and the existing objects it extends** (`extend-never-duplicate`; checked in the repo and in `v3_local` `pg_class` on 2026-10-27: no table holds a per-seat account state; `social_media_connections` is polymorphic (`profile_id`, `profile_type`), has no seat key, no account name and no state, and holds a few random legacy rows; `account_users` and `google_analytics` are unrelated):
  - `connected_accounts`: `id bigint identity`, `tier_agent_id` FK `tier_agents`, `provider varchar(20)` CHECK in the eleven keys, `state varchar(9)` CHECK in `connected, available, matched, partial`, `synced_at timestamp null`, `source varchar(60)`, `trust_tier varchar(20)` CHECK in the five tiers, `is_mock`; unique `(tier_agent_id, provider)`, index on `tier_agent_id`; CHECKs: `state in ('matched','partial')` only for `zillow` and `yelp`, and `(synced_at is null) = (state = 'available')` (C2, C3). It holds no token, no secret and no account identifier.
  - **Reused, not duplicated:** the lane tables (GBP figures), `home_seat_state` and `home_plans` (the directories card), `home.parse_ids`, `owner_of`, `_iso`, `monthDay`, the seed's guards and backup.
  - **Corrected mock values in existing tables** (no schema change; backed up by the seed): `web_checks.source` and `trust_tier` of the `indexing` check (C12); the `you_text` and `rival_text` of the `connections` row of `srs_lane_gaps` (C11).
- **Migration intent**: a local SQL script `surface-api/srp/db/local/connections_schema.sql` outside Alembic and the closed `surface-api/migrations/` stream (and with no `docs/ETL-Enhancements.md` entry, ruled 2026-10-27): one transaction, additive, idempotent, commented rollback; no RLS; `revoke all … from anon, authenticated, public` and `grant select, insert, update, delete … to v3_app` only. Run order: schema-only `pg_dump` outside the repo (mode 600), run, catalog diff, seed with `--backup-to`, JOIN checks. It needs your explicit go-ahead.
- **Provenance / trust tier** (C3): `connected` ("From your sign-in", owner_verified), `matched` and `partial` ("Matched by NORA", platform_observed), `available` ("Not connected", self_declared); a mock mapping.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | `GET /seat/professional/{id}/connections`, as of the newest snapshot; unknown stays unknown (a seat with no accounts is `ready: false`, a missing account is absent, GBP numbers only with a known lane) |
| Capabilities | none (read-only); a future "connect an account" capability would be an OAuth sign-in and a sync, gated (O2) and owned by an integrations Surface |
| Events | none |
| Entitlement | the directories card reads the seat's plan; the unmet experience is "Unlock →" |
| Explanation | the summary sentence and the two note templates in step 3, authoritative counts only |
| Value loop | NORA names an unconnected account → the person connects it → NORA can use it (search queries, website fixes) → the pages that cite it (Indexing, Profile sources, lanes) are fed by a real source |

## Security and scope
- Principal: a local sign-in session for its own seat only; delegation and impersonation are not served. Ownership is checked before any other read (`home.owner_of`).
- Grants: the new table to `v3_app` only; no RLS on new tables (owner ruling 2026-10-26); the script revokes from anon, authenticated and PUBLIC; no function and no trigger.
- **No credentials:** the table stores no token, secret, client id or account identifier (secrets live only in Secret Manager or Vault, referenced by name, `AGENTS.md` §3); a real connection would keep its token there.
- Untrusted input: only the path id (`[0-9]{1,18}`), validated first; all values bound as parameters; stored text is rendered as text. In a real feed, what an account returns would be untrusted inbound content (out of scope).
- Shared core touched: only the route list in `surface-api/tests/test_local_token_scope.py` (nine to ten routes).

## Compliance
Nothing is published, sent or signed in. The page states which accounts NORA could use and what they power; it promises no ranking or outcome. The directories card is the prototype's locked-feature copy (publishing to directories is out of scope here). Anything NORA later posts or replies to through an account passes `content_compliance_rules` and `exp_category_compliance` server-side before it is published (out of scope: nothing is posted here).

## Canon review
Run on the finished diff, 2026-10-28 (`canon-review`):

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Ownership | PASS | The only table written is `srp_cleanup.connected_accounts` (and the corrections of two existing SRP mock tables, `web_checks` and `srs_lane_gaps`), by the seed (`seed_home.py:384`, `:582`); the read service reads only `srp_cleanup` tables of the SRP Surface (`connections.py`, no `public.`); the UI calls only its own route; no cross-Surface import or event |
| 2 | Extend, never duplicate | PASS | Result recorded in [plan.md](./plan.md) (live catalog and repo checked: `social_media_connections` is polymorphic with no seat key or state, so it is not extended); helpers, seed machinery, lane tables, plan tables reused |
| 3 | Identifiers | N/A | No gcid, record id or link table involved; the seat id is `tier_agents.id` |
| 4 | Governed writes | N/A | Nothing written to `graph_nodes`, `search_documents` or category tables; no category data changed |
| 5 | Security | PASS | `connections_schema.sql:60-61` revokes all from `anon, authenticated, public` and grants `v3_app` only; no RLS or policy, no function, no trigger (also asserted by `test_connections_schema.py`); no token, secret, sign-in or account identifier is stored (column list asserted exactly); the read is ownership-first and read-only, errors answer a plain 503, a Supabase session gets 501; the local token reaches exactly ten routes |
| 6 | Model vs code | PASS | No model; the statuses, summary, suggestions, notes and directories card are deterministic code over stored rows; missing behaviour is `501 not_implemented` (Supabase session) or an absent section, never faked |
| 7 | Gated actions | PASS | No cron, indexing, enrichment engine or dirty-queue draining; Connect is an on-screen simulation |
| 8 | Compliance | N/A | Nothing is published, sent or signed in; anything NORA would later post through an account must pass the server-side compliance gate (stated in Compliance above) |
| 9 | Scoring / rings | PASS | The SRS v5 `gbp` lane is read as stored, not recomputed; the Connections lane text is corrected to the connected count in the seed only; no ring logic, no `exp_ring`, no change to a score |
| 10 | Open decisions | FLAGGED | Depends on, and does not resolve: O2 (real connections, tokens in the vault, sync: enrichment and integrations stay gated), scoring and identity ownership (unassigned), the real Connections lane and indexing-source rules (C11, C12), whether a Profile fact may come from LinkedIn by import (C10), the plan rule for the directories card (C7), the Zillow and Yelp match rules (C2), the trust-tier mapping (C3), and the `srp_cleanup` name |

**Verdict: clear to proceed locally; merge blocked by:** the rulings in row 10 (O2, scoring and identity ownership, C7, C10 to C12) and the shared-core review of the token-scope list (C14).

## Second-model review
Run 2026-10-28 by a fresh, read-only reviewer agent that was given the files and the rules but not my conclusions; it queried the live data and read the code (it did not run the tests or render the page). **No high-severity defect.** Findings and what was done:

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | Medium | The Home event "Your Facebook connection expires Friday" existed on 5 seats whose Facebook is not connected (seats 4, 12, 14, 25, 29): a cross-page contradiction the seed's alignments did not cover | **Fixed**: `align_home` keeps that event only for a seat whose Facebook is connected; tests first (a plan test with both outcomes, a real-Postgres JOIN test, the older stored-rows test updated); re-seeded (5 events deleted), re-traced |
| 2 | Low-medium | The header count added a Connect click on the shell's "sources" sheet even for an account that was already connected | **Fixed**: `clickedCount` counts only accounts not yet connected; test first, and the fix was mutated and caught. The sheet itself is a hard-coded shell list: recorded |
| 3 | Low | The SRS Connections lane's points do not follow the connected count | Recorded (pre-existing mock behaviour, not introduced here) |
| 4 | Low | A failed read shows the labelled sample page | Recorded (the same behaviour as the other pages) |
| 5 | Low | The status line's month used a locale-dependent format | **Fixed**: a fixed English table, with a test per month |
| 6 | Low | Some UI assertions were weak or vacuous | **Fixed**: tightened (the Connect button count, a positive card count and a pattern that fails without the card, a sample-only list that no longer contains a legitimate real string) |

Checked by the reviewer and found fine: every rule listed in step 5 on the live 40 seats (0 violations), the table (no secret column, no RLS, grants), ownership first, the read-only transaction, bound parameters, plain 503, the token-scope list, the summary, suggestions, notes and card, the idempotence and non-mutation of both alignments, the sample model. Not checked by the reviewer: running the tests, rendering the page, the seed's idempotence and the schema setting (covered here by the test runs, the browser trace and the seed runs above).

## Decision log entries
| # | Date | Decision | What it blocks |
|---|---|---|---|
| C1 | 2026-10-27 | One new table `connected_accounts`, one row per seat and account, holding the state, the sync time and a source and tier; the legacy `social_media_connections` is not used | a real integrations model (owned by another Surface) |
| C2 | 2026-10-27 | The database enforces the vocabulary, "matched" and "partial" only for Zillow and Yelp (listings found without a sign-in), and a sync time exactly when the account is not `available` | the real match rules |
| C3 | 2026-10-27 | Trust tier by state: connected owner_verified, matched or partial platform_observed, not connected self_declared (mock) | the real tier rules |
| C4 | 2026-10-27 | The status lines are computed from the state, the account and the sync time, not stored | stored, editable status text |
| C5 | 2026-10-27 | The Google Business Profile "powers" line shows the seat's SRS GBP lane (earned of max), computed; the other lines are the page's fixed text | the real lane rules |
| C6 | 2026-10-27 | NORA's notes are computed templates, one per unconnected account among Search Console and Website / CMS | a stored note set |
| C7 | 2026-10-27 | The directories card is shown for the `core` plan only (Engage is included in Amplify), with the prototype's text including its "28 directories" | plan and pricing rulings |
| C8 | 2026-10-27 | The header's second sentence follows which of Search Console and Website / CMS is unconnected (the prototype's sentence when both, a short one when one, none when neither); the count line is the stored count plus browser clicks | none |
| C9 | 2026-10-27 | Google Business Profile is connected for every seat (the SRS GBP gap says so for all 40, and Profile and Insights figures cite Google); YouTube and Search Console can be connected only then | the real Google connection model |
| C10 | 2026-10-27 | LinkedIn is connected for every seat whose Profile has a fact "From LinkedIn" (all 40) | whether a Profile fact may come from LinkedIn by import without a connection |
| C11 | 2026-10-27 | The connected social accounts equal the SRS Connections lane's "you" count; the seed corrects that mock text (12 seats said 0), keeping the gap to the rival text | the real Connections lane rule |
| C12 | 2026-10-27 | The Web analytics Indexing check is "From Google Search Console" only for a seat with Search Console connected, otherwise "From your site scan" | the real indexing source |
| C13 | 2026-10-27 | A seat whose SRS Videos lane has a last video has YouTube connected | none |
| C14 | 2026-10-27 | The local token is accepted on a tenth route (`.../connections`); the change is the route list in the shared scope test | none, but needs shared-core review |
| C15 | 2026-10-27 | Connect (the buttons and the notes) stays an on-screen simulation: no sign-in, token, sync or write | O2 and an integrations Surface |
| C16 | 2026-10-27 | The table holds no token, secret or account identifier (secrets live in the vault, by name) | none |
