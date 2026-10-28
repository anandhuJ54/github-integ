# Spec: Serve the Happyflow Network page from the local database, read-only

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · plan (not written yet) · contracts: `contracts/srp/openapi.json` (one new response, see Data)

Status of this spec: **draft for approval**. Decisions N1 to N16 in the decision log are choices this spec makes that need your confirmation. **N9 to N12 are rules the seed keeps so the Network page agrees with the Connections, Home and Profile pages;** unlike the Connections increment, this one corrects no existing row: the Network rows are new.
It extends `srp/home-page-schema`, `srp/srs-page-schema`, `srp/profile-page-schema`, `srp/insights-page-schema`, `srp/web-analytics-page-schema` and `srp/connections-page-schema` (tables, seed, helpers, method); it changes no schema of an existing table.

## Behaviour
Deterministic code decides everything; no model is involved. Reads are `SELECT` only. The database change is two new tables in `srp_cleanup` (local `v3_local` only) plus the mock rows the seed writes. Every button (Accept, Decline, Promote, Save, Remove, Create a group, Nudge, Nudge all, Call, View, Ask for a referral, the demo video and slides) changes only what the browser shows; nothing is sent, invited, fetched, stored or written.

1. **The read.** `GET /srp/seat/professional/{pro_id}/network`: a local sign-in session, its own seat only (403 `not_your_seat` otherwise; ownership first through `home.owner_of`), `set transaction read only` first, one connection; a database error answers 503 `database_unavailable`; a Supabase session gets 501 `not_implemented`.
2. **The response** (`NetworkResponse`). Every value is a stored value or a computed one (step 3); nothing is invented.
   - `as_of`, `data` = `"mock"` or `"live"` (`"mock"` when any row is mock), `ready` (false when the seat has no `network_partners` and no `network_referrals` row; every other section is then `null`).
   - `slots`: the number of promoted-partner slots (8, reference).
   - `partners`: `[{ id, name, company, role, state, reason }]` in stored order; `state` is `promoted`, `request`, `suggested` or `saved`; `reason` is computed text or null (step 3).
   - `referrals`: `{ received, requested, given }`, each `[{ id, name, detail, meta, status, label, cta, partner_id }]`; `status` is one of `new, followed, closed, waiting, replied, thanked, done`.
   - `ask`: `{ count } | null`, the number of past clients the "Ask for a referral" sheet says it picked.
3. **What is computed (never stored):**
   - **Partner reason** (N5) from the stored `reason_kind`, `reason_count` and `reason_on`: `asked` "Asked to promote you on their profile"; `zillow` "Named in {n} of your Zillow reviews"; `closings` "Co-listed on {n} of your closings this year"; `saved` "Saved {Mon D}"; promoted partners have none.
   - **Referral meta and label** (N6): `meta` (shown after the detail, as `"{detail} · {meta}"`) is, for a received referral, `"From {partner name}"` when it names a partner and `"From your profile"` otherwise, then `" · {Mon D}"` of `occurred_on`; requested: `"Asked {Mon D}"`; given: `"{Mon D}"`. `label` per status: `new` "New · I texted them a welcome", `followed` "I followed up twice", `closed` "Closed", `waiting` `"No reply · {n} days"` (`n` = whole days from `occurred_on` to the read's UTC date, at least 1; `"1 day"` for 1), `replied` "Referred a friend", `thanked` "Thanked you", `done` "Done"; `cta` per status: `new` Call, `waiting` Nudge, every other View.
   - **`ask.count`** (N8): `min(6, review_count)` from the seat's newest `home_snapshots` row; null when the seat has no snapshot (never 0 for unknown); 0 when the seat has no reviews.
   - **The counts and sentences** are computed in the UI model from these rows (step 4): the tab counters, "N of 8", the header sentence and NORA's two notes.
4. **The UI** (`surface-ui/srp/src/`):
   - `utils/network-model.ts` (`NetworkModel`, `networkModel(response, seatId)`, `useNetworkApi`), `components/happyflow/sample-network.ts` (the prototype's sample as the same model, built from today's constants so the sample view is unchanged), `network-context.tsx` and `network-page.tsx` (mirror the Connections page); the `network` route renders it and fetches only on that route.
   - `screens/network.tsx` reads the model for: the partner groups (promoted with "N of 8", requests, suggestions, saved), each reason, the three referral lists with their meta, pills and buttons, the tab counters, the header sentence (N7), NORA's two notes (N7) and the "Ask for a referral" count (N8). The partners' avatar colours and initials are computed (the page's palette by order, the first letters of the name). A missing section draws nothing. Layout, colours and icons are unchanged.
   - **The buttons stay in the browser:** the screen's local state starts from the stored states and changes only on-screen; the Happyflow source guard (no `fetch`, no write call) still passes and its file count is updated.
   - **Sentences** (N7): header: with requests, `{first names of the requests, joined with " and " (more than two: "A, B and C")} asked to promote you` then, when there are suggestions, `, and I found {n} more partner{s} worth adding.`, otherwise `.`; with none, "Your partner list is up to date. I will tell you when someone new asks."; after "Accept both" or Accept: "Done, they are on your profile now." then, with suggestions, `{first names of the first two suggestions} {is|are} next.`. Notes: one per group that has rows: requests `{names} want{s} to promote you.` / "Partners who promote you send buyers to your page." (cta "Show me"); waiting referrals `{first names} {has|have} not replied.` / "I drafted a short, friendly nudge for {it|both|all}." (cta "Show me"). The real text drops the prototype's claim that promoters add to the Connections lane (N10); the sample page keeps the prototype's text.
   - The notice above a real page is Home's ("Mock data · these values come from the local database and are not your real score or activity." when the data is mock).
5. **The seed** (`seat/seed_home.py` with a new pure builder `seat/seed_network_plan.py`; same CLI, guards, mandatory `--backup-to`, one repeatable-read transaction, `--as-of`): writes the partner and referral rows per seat, deterministic and labelled mock, from the Home, Profile and Connections plans (it runs after them). Counts follow the seat's Home layout (a day-1 seat has few rows, a day-24 seat more: partners 1 to 10 in total, at most 8 promoted; received 0 to 4, requested 0 to 3, given 0 to 2). The rules it keeps (each a test over the written rows):
   - **Zillow (N9):** a `zillow` reason exists only for a seat whose Zillow is matched, and its count is between 1 and the seat's newest `review_count`.
   - **Closings (N10):** a closing claim (a `closings` reason, a `closed` referral status, a detail that says "closed in {Month}" or "closing") exists only for a seat whose Loan system is connected.
   - **Partners of the same seat (N11):** a received referral that names a partner, and every given referral, points to a `promoted` partner of the same seat; names are unique within a seat's partners; a request or suggestion has no referral rows pointing to it.
   - **Dates (N12):** every date is on or before the day and within 120 days of it; a `waiting` referral was asked at least 1 day before.
   - Every row's source and trust tier follow its kind (N13); same date twice changes nothing; a later date moves only the dates (relative to the day), never a state; backups cover both tables.

## Acceptance criteria
1. `GET .../network` for the signed-in user's own seat returns 200 with the shape in step 2; another seat's id returns 403 `not_your_seat` before any other read; a Supabase session 501; a database error 503.
2. The read uses a read-only transaction, issues only `SELECT`, and reads only `tier_agents`, `users`, `home_snapshots`, `network_partners` and `network_referrals` (a test asserts the SQL; no `pin_partner_profiles`, `referral_*`, `partners` or `invite_*`).
3. The reasons, metas, labels and ctas follow step 3 for every state and kind, with the day count for `waiting` and plural forms; unknown stays unknown (`ask.count` null with no snapshot, never 0).
4. A seat with no partner and no referral row is `ready: false` with null sections; a missing section is empty or null, never invented.
5. For every seed seat: no `zillow` reason without a matched Zillow and none above the seat's review count; no closing claim without a connected Loan system; every referral that names a partner points to a promoted partner of the same seat; no more than 8 promoted partners; all dates in range (a real-Postgres test over the written rows, calling the Connections read and the Home read).
6. `ask.count` equals `min(6, review_count)` from the Home snapshot the Home page shows, for every seeded seat.
7. The database enforces: the four partner states and which reason kinds each allows, the three referral lists and which statuses each allows, the roles, the unique order within a seat (partners) and within a list (referrals), the seat foreign key, the partner foreign key, the five tiers, no blank names.
8. The seed writes the rows; a second run changes 0 rows; a later date moves only dates; the backup holds the old rows; the seed's text names no person who works on this project.
9. UI model: `networkModel` maps every section; the sample model equals every constant it replaces (a table of values including the 8 partners with their states and reasons, the 9 referrals with metas and pills, the 2 notes, the header sentence and the counters); the sentence variants.
10. UI screen: a real seat shows its stored values and none of the prototype's (a list of sample constants that must not appear); with no real seat the page is the prototype's and the existing tests pass unchanged; the sample markup rendered with the old and the new `network.tsx` is identical.
11. The local token reaches exactly eleven routes (the ten today plus `.../network`); every other token-checking route still refuses a local token; no existing table's schema changes (catalog diff); no existing row changes (the legacy `pin_partner_profiles`, `referral_*`, `partners` and `invite_*` rows are untouched).
12. `cd surface-api && SRP_TEST_DATABASE_URL=… uv run pytest` passes except the 3 known `test_migrations_security` failures; `ruff`, `bun test`, both `tsc` runs are clean.

## Data
- **Read** (owner SRP, schema `srp_cleanup`, all local): `tier_agents`, `users` (ownership), `home_snapshots` (the review count) and the two new tables.
- **Written**: only by the seed; the endpoint writes nothing.
- **New objects and the existing objects they do not extend** (`extend-never-duplicate`; checked in the repo and in `v3_local` `pg_class` on 2026-10-28: no `network_*` table exists and no file names one):
  - `network_partners`: `id bigint identity`, `tier_agent_id` FK `tier_agents`, `position integer` (order, from 1), `name varchar(80)`, `company varchar(80)`, `role varchar(10)` CHECK in `Agent, Title, Inspector`, `state varchar(9)` CHECK in `promoted, request, suggested, saved`, `reason_kind varchar(8) null` CHECK in `asked, zillow, closings, saved`, `reason_count integer null`, `reason_on date null`, `source varchar(60)`, `trust_tier varchar(20)` CHECK in the five tiers, `is_mock`; unique `(tier_agent_id, position)` and `(tier_agent_id, name)`; CHECKs: names not blank; `promoted` has no reason; `request` has kind `asked`; `suggested` has kind `zillow` or `closings`; `saved` has kind `saved` and a date; `reason_count` is set (at least 1) exactly for `zillow` and `closings`; `reason_on` is set exactly for `saved`.
  - `network_referrals`: `id bigint identity`, `tier_agent_id` FK `tier_agents`, `list_key varchar(9)` CHECK in `received, requested, given`, `position integer`, `name varchar(80)`, `detail varchar(80)`, `partner_id bigint null` FK `network_partners(id)`, `status varchar(8)` CHECK in the seven statuses, `occurred_on date`, `source varchar(60)`, `trust_tier varchar(20)` CHECK in the five tiers, `is_mock`; unique `(tier_agent_id, list_key, position)`; CHECKs: `received` has status `new, followed` or `closed`; `requested` has `waiting` or `replied` and no partner; `given` has `thanked` or `done` and a partner; names and details not blank.
  - **Nearest existing structures and why they are not extended:** `pin_partner_profiles` (25 legacy rows: two seat ids and two dates; no name, company, role, state, reason, source or tier, and its pinned ids are seats, not the page's people), `referral_sents` and `referral_requests` (random mock recipients, resend and archive counters, no list, no status vocabulary, no partner link), `referral_histories` and `referral_emails` (5 and 25 event rows with integer codes), `partners` and `invite_partners`/`invite_signups` (partner-company groups and email invites). Adding the page's columns to them would change existing tables (out of scope) and rewrite their random rows; they stay untouched and unread.
  - **Reused, not duplicated:** `home.parse_ids`, `owner_of`, `_iso`, `monthDay`, the seed's guards and backup, the Home, Profile and Connections plans (the layout, the review count, Zillow and the Loan system), the scratch-schema fixtures, the contract generator, and the Connections page's model, context, page and route pattern.
- **Migration intent**: a local SQL script `surface-api/srp/db/local/network_schema.sql` outside Alembic and the closed `surface-api/migrations/` stream (and with no `docs/ETL-Enhancements.md` entry, ruled 2026-10-27): one transaction, additive, idempotent, commented rollback; no RLS; `revoke all … from anon, authenticated, public` and `grant select, insert, update, delete … to v3_app` only. Run order: schema-only `pg_dump` outside the repo (mode 600), run, catalog diff, seed with `--backup-to`, JOIN checks. It needs your explicit go-ahead.
- **Provenance / trust tier** (N13): a promoted partner or a received referral "From your sign-in" (owner_verified); a request "Asked by the partner" (platform_observed); a suggestion "Suggested by NORA" (platform_observed); a saved partner "Saved by you" (owner_verified); a requested or given referral "From your sign-in" (owner_verified); a mock mapping.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | `GET /seat/professional/{id}/network`, as of the read; unknown stays unknown (a seat with no rows is `ready: false`, `ask.count` null without a snapshot) |
| Capabilities | none (read-only); a future "promote a partner", "ask for a referral" or "nudge" would be capabilities that send messages, gated (O2), owned by a Surface that is not yet assigned, and subject to the compliance gate |
| Events | none |
| Entitlement | none: "Referral network" is a Core plan item, so every seat has the page |
| Explanation | the header sentence, the reasons, the status labels and the two note templates in steps 3 and 4, authoritative counts only |
| Value loop | NORA names a partner worth adding or a client who has not replied → the person accepts, promotes or nudges → promoted partners show on the profile and send buyers → referrals come back and close |

## Security and scope
- Principal: a local sign-in session for its own seat only; delegation and impersonation are not served. Ownership is checked before any other read (`home.owner_of`).
- Grants: the two new tables to `v3_app` only; no RLS on new tables (owner ruling 2026-10-26); the script revokes from anon, authenticated and PUBLIC; no function and no trigger.
- No message text, email address, phone number or contact detail of any person is stored: the partner rows hold a display name, a company and a role; the referral rows hold a display name and a short detail. (Legacy tables with such columns stay untouched.) Untrusted input: only the path id (`[0-9]{1,18}`), validated first; all values bound as parameters; stored text is rendered as text. In a real feed, partner and referral content would be untrusted inbound content (out of scope).
- Shared core touched: only the route list in `surface-api/tests/test_local_token_scope.py` (ten to eleven routes).

## Compliance
Nothing is published, sent or invited. The page shows who NORA suggests and what stands open; it promises no outcome and offers no payment or benefit for a referral. Anything NORA later sends (a referral ask, a nudge, a welcome text, a partner invite) is outbound content that must pass `content_compliance_rules` and `exp_category_compliance` server-side before it is sent (mortgage: RESPA, no referral fee or thing of value for a referral, no steering, NMLS display; real estate: Fair Housing, no steering by protected class), and no side system (CRM, sequencing) is introduced. Out of scope here: nothing is sent. The status "New · I texted them a welcome" is a mock label, not a record of a text.

## Canon review
Pending (run the `canon-review` skill on this spec before plan approval).

## Second-model review
Pending (independent review of the finished increment, which must check the seeded data against every rule the page applies, including the cross-page rules of step 5).

## Decision log entries
| # | Date | Decision | What it blocks |
|---|---|---|---|
| N1 | 2026-10-28 | Two new tables, `network_partners` and `network_referrals`, hold the page's people and referrals per seat; the legacy `pin_partner_profiles`, `referral_*`, `partners` and `invite_*` tables are not used or changed | a real partner and referral model (owned by another Surface) |
| N2 | 2026-10-28 | The database enforces the vocabulary: partner states and which reason kinds each allows, referral lists and which statuses each allows (a given referral has a partner, a requested one has none) | the real status rules |
| N3 | 2026-10-28 | Partners are mock people (a display name, a company and a role) with no contact detail; no email, phone or message text is stored | identity and partner ownership |
| N4 | 2026-10-28 | At most 8 promoted partners ("N of 8" is a reference constant, kept by the seed and tested) | the real slot rule |
| N5 | 2026-10-28 | A partner's reason is computed from a stored kind, count and date, with "their" in place of a guessed pronoun | none |
| N6 | 2026-10-28 | A referral's meta, status label and button are computed from its list, status and date; "No reply · N days" counts from the stored date to the read's UTC day | the real referral lifecycle |
| N7 | 2026-10-28 | The header sentence and NORA's two notes are computed in the UI model from the rows; the real text drops the claim that promoters add to the Connections lane; the sample keeps the prototype's text | whether promoters add to a lane (unruled) |
| N8 | 2026-10-28 | The "Ask for a referral" count is `min(6, review_count)` from the Home snapshot (null when unknown), and the real sheet text no longer says "who closed in the last year and left 5★" | the real "past clients" source |
| N9 | 2026-10-28 | A Zillow reason exists only for a seat whose Zillow is matched, and cites no more reviews than the seat has | the real Zillow match rule |
| N10 | 2026-10-28 | A closing claim (a closings reason, a closed referral, a "closed in {Month}" detail) exists only for a seat whose Loan system is connected | where closing data comes from (an integration, O2) |
| N11 | 2026-10-28 | A referral that names a partner, and every given referral, points to a promoted partner of the same seat | the real partner identity |
| N12 | 2026-10-28 | All dates are on or before the day and within 120 days of it; a waiting referral is at least 1 day old | none |
| N13 | 2026-10-28 | Trust tier and source by kind (see Data); a mock mapping | the real tier rules |
| N14 | 2026-10-28 | Every button, the sheets and the demo video and slides stay on-screen simulations: nothing is sent, invited or stored | O2 and an unassigned partner Surface |
| N15 | 2026-10-28 | The local token is accepted on an eleventh route (`.../network`); the change is the route list in the shared scope test | none, but needs shared-core review |
| N16 | 2026-10-28 | No existing row or schema changes: this increment only adds rows to two new tables | none |
