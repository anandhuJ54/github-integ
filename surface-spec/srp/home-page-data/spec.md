# Spec: Show real data on the Happyflow Home page from `srp_cleanup`

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [plan](./plan.md) · contracts: `contracts/srp/openapi.json` (one path added, see Data)

Status of this spec: **approved** on 2026-10-27, including S1; amended the same day after the canon and second-model reviews (task 7).

## Behaviour
Deterministic code decides everything here; no model is involved. Read-only except the mock-data seed.

1. **The read.** `GET /srp/seat/professional/{pro_id}/home` answers a **local sign-in session** for **its own seat only**
   (the id is a `tier_agents.id` the signed-in user owns; anything else is 403 `not_your_seat`, including non-numeric ids and
   deactivated or deleted users). It uses the API's own database login (`connection()`), never the `authenticated` role, one
   connection, no lock, and only `SELECT`; the first statement is `set transaction read only`, so the database itself refuses a write.
   A database error answers 503 `database_unavailable` (the kind is logged, the database's message is not returned). A Supabase
   session gets 501 `not_implemented` (its Home stays as today). *(Amended after the second-model review, see below.)*
2. **The response** (every section is `null` when its table has no row for the seat; `null` means *unknown*, never zero):
   - `as_of`: server time of the read. Timestamps without a zone in the database are sent with a trailing `Z` (the schema stores UTC).
   - `score`: `{ basis: "cleanup_config", total, max, categories: [{id, name, score, max}], updated_at }`. Where a seat has several
     rows for one category, the newest (`updated_at`, then `id`) counts, and rows for a category that is not in the config are ignored.
     `total` is the sum of the non-null `srs_category_score` rows of those latest rows; `max` is the sum of the non-null `srs_config_categories.score`; `basis` says the numbers
     come from the cleanup schema's legacy configuration, not SRS v5 (D1).
   - `rank`: `{ position, of, market: {zipcode, vertical_id, city} }` or `null`. Peers are the **active** seats (seat, user not deleted or
     deactivated) that have a known total and the same non-null `zipcode` and `vertical_id` as this seat, each seat's total taken over its
     latest row per category; a seat whose score rows span more than one market belongs to none and has no rank. `city` is the city of a
     location whose `postal_index_code` equals the zipcode (lowest location id, not deleted), else `null`; it is looked up only when a rank
     exists. `position` is 1 plus the number of peers with a strictly higher
     total (ties share a position); `null` when the seat has no zipcode or vertical, or fewer than 10 peers (D2).
   - `voce`: `{ published, total, last_published_at }`, counting articles that are not archived; zeros are real zeros.
   - `website`: `{ score, url, last_refreshed_at }` from the latest `website_analytics_data` row; no denominator (D3).
   - `ai`: `{ authority_score, answers, topics, updated_at }` from the latest `ai_authority_stats` row; no "of N" (D4).
   - `profile`: `{ photo_url, year_started, certifications }`; `year_started` is an integer or `null` (a non-numeric value is
     `null`), `certifications` is the length of the JSON array (0 when empty or not an array).
   - `unavailable`: always exactly `["profile_strength","bands","competitors","since_claimed","map_rank","reviews","listings","plan"]`,
     the things this endpoint cannot provide at all.
3. **The UI** reads the endpoint once per seat in the seat layout (React Query), hands it to the Home through a context, and a pure
   function `homeView(data)` turns it into what each tile shows: a value, or the state `unavailable`.
4. **What the Home shows for a real seat** (S1, confirmed):
   - **Wired tiles** show the value, or "Not connected yet" when their section is `null`: the score ring and total, the
     per-category lines in the gap list, the rank line, the VOCE article counts (the "VOCE" locked card and "Start publishing"
     sub-line), the website score ("Fix my website"), the AI-authority tile, the avatar photo (initials when the URL does not
     load), the credentials sub-line, and the year-started picker's preselected value.
   - **Unconnected items** (everything in `unavailable`, plus the NORA board, "Done · N things", the trial banner and "Day N of 30",
     the rival bar and "points to #1", the band label, "since you claimed", "Top-3 map spots", reviews, listings, profile strength, the
     peer panel and, on day 7, the "While you were away" banner, weekly brief, streak and review drafts) show a single muted
     "Not connected yet" in place of the demo figure. No demo number is shown for a real seat.
   - The score uses a single label "Score (cleanup schema)", not "of 850" (D1). The scripted first-task animation and its
     384 to 390 count run only in the sample view.
   - The notice above the page lists what is real: name and title, score, rank, articles, website, AI authority, photo and
     credentials.
5. **The sample view** (no real seat, or the seat could not be loaded) is exactly today's page.
6. **The mock-data seed** (`surface-api/srp/src/seat/seed_home.py`, run with `uv run python -m surfaces.srp.seat.seed_home`): for each
   active user that has a seat it writes, deterministically and idempotently, mock rows so every item above has something to show:
   a score row for every `srs_config_categories` row (config maximums rescaled to sum to a plausible total, scores below the maximum),
   a shared `zipcode` and `vertical_id` so that groups of at least 10 seats are peers, 0 to 5 VOCE articles, a website row, an
   AI-authority row for most seats (and none for a few, so the empty case is visible), a credentials list and a year started. It
   **will not run for real without `--backup-to FILE`** (`--dry-run` needs none): it first writes the previous values of every row it
   changes or removes to that new private file, then does everything in one repeatable-read transaction, so a failure changes nothing. A
   schema other than `srp_cleanup` is refused unless named again with `--schema`. It prints the target (host, database, schema; never the
   user or password), counts, and a warning when some seats cannot be ranked. It touches only the local schema (mock rows, labelled
   `mock` in their JSON). A seat's market depends on its position among the seated users, so adding or removing a seat can move others
   to another market on the next run; the score rows carry vertical 1 while `tier_agents.vertical_id` is left as it is. *(Amended after
   the second-model review.)*

## Acceptance criteria
1. `GET /srp/seat/professional/{id}/home` with a local token for the user's own seat returns 200 with exactly the keys in step 2.
2. Another seat's id, a non-numeric id, and a user who is deleted, deactivated or manually deactivated get 403; the response is
   the same shape for a seat that does not exist, and no query was run before the ownership check passed.
3. A Supabase-session token gets 501 `not_implemented`; no token gets 401/403; with `LOCAL_AUTH_ENABLED` unset a local token gets 401.
4. Only `SELECT` statements are issued, on one connection, with no `FOR UPDATE` (checked by the recorded SQL).
5. `score.total` is the sum of the non-null scores (a seat with only NULL scores has `total` `null`, not 0); `score.max` is the sum of
   the non-null config maximums; `categories` has one entry per config category the seat has a row for; `basis` is `"cleanup_config"`.
6. `rank` is `null` when the seat has no zipcode or no vertical, or when fewer than 10 seats share them; otherwise `position` is
   1 + (peers strictly above) and `of` is the peer count, with ties sharing a position. Tested on real Postgres with ties.
7. `voce` excludes archived articles and shows 0 and 0 for a seat with none; `website` is the row with the latest
   `last_refreshed_time` and carries no denominator; `ai` is the latest row, or `null`.
8. `profile.certifications` is 0 for an empty, null or non-array JSON value; `year_started` is `null` for a non-numeric value.
9. `unavailable` equals the fixed list in step 2.
10. The route-table test lists exactly **five** routes that accept a local token (the four existing ones plus this one) and every other
    token-checking route, including the review routes, still refuses it.
11. `contracts/srp/openapi.json` contains the path and its schema; `tests/test_contracts.py` passes.
12. The seed run twice leaves the database identical to once; every seated active user ends with a score row for every config
    category, belongs to a group of at least 10 peers, and has a website row; at least one seat has no AI-authority row; the backup
    file is created first, mode 600, and an existing backup file is never overwritten; the output contains counts only.
13. `homeView(data)` returns, for each tile, a value or `unavailable`; `null` sections and the `unavailable` list map to
    `unavailable`; numbers are formatted without a denominator that has no source.
14. Rendered for a real seat with full data, the day 1 and day 7 Home contain the real score, rank, article counts, website score,
    AI-authority numbers and credentials, and none of the demo constants 390, 418, 471, 571, "9 of 49", "4.9", "128", "64%",
    "127 points" or "Riverbend"; rendered with data whose sections are `null`, each wired tile shows "Not connected yet".
15. Rendered with no seat, the Home is byte-for-byte what it is today (existing render tests unchanged and passing).
16. The Happyflow components still make no fetch call (the existing source guard passes); the data reaches them through the context only.
17. In the browser, signed in as two different users, every number on the wired tiles matches a row in `srp_cleanup`, recorded in `evidence.md`.
18. `ruff`, `pytest`, `bun test` and `tsc` for the app and `srp` pass; the three migration-security tests that failed before this work
    are the only failures.

## Data
- **Read** (SRP-owned data, schema `srp_cleanup`): `tier_agents`, `users`, `user_search_rank_scores`, `srs_config_categories`,
  `locations` and `tier_locations` (city), `voce_articles`, `website_analytics_data`, `ai_authority_stats`, `tier_agent_details`.
- **Write:** none by the endpoint. The seed writes mock rows to `user_search_rank_scores`, `voce_articles`, `website_analytics_data`,
  `ai_authority_stats`, `tier_agent_details` and `tier_agents` (`year_started`, `profile_photo`, `zipcode`), mock data only, backed up first.
- **New objects:** one route, `surfaces.srp.seat.home` (the read) and `surfaces.srp.seat.seed_home`; no table, column, function,
  grant or migration. **Extend, never duplicate:** the score sum already exists in `seat/local.py`; the home read reuses its
  ownership rule and moves the score query into one helper both use, so they cannot disagree.
- **Migration intent:** none. **Provenance / trust tier:** nothing is written as a fact about a professional; the page labels
  the score as the cleanup schema's, and the values are `self_declared`-level mock data until a real source is ruled.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | This endpoint is a typed read with `as_of`; `null` means unknown. It is for the signed-in browser session, not published to NORA. |
| Capabilities | None published. |
| Events | None. |
| Entitlement | None; the plan/trial is "Not connected yet". |
| Explanation | Fixed labels only: "Score (cleanup schema)", "Not connected yet". No computed explanation text. |
| Value loop | Not applicable to this increment. |

## Security and scope
- **Principal:** a local sign-in session; **scope:** its own seat only, as in the local seat read; no delegation.
- The new route is added to the local-token allowlist (five routes). Every other route still refuses a local token, so the
  review routes, the dashboard and the Admin endpoints stay unreachable.
- The queries are parameterised; the schema name comes from `SRP_LOCAL_SCHEMA`, already validated. Read-only, one connection, no
  lock. No grant, RLS or role change. The seed backup file is private (mode 600) and outside the repo.
- **Untrusted input:** the seat id (digits only, checked before any query). No other input.

## Compliance
Nothing generated or published; no ad, review reply or message is produced. Fair Housing and RESPA/TILA rules do not apply. The
page must not present a score or rank as the product's official SRS or market position: it is labelled as the cleanup schema's.

## Canon review
Run with the `canon-review` skill on 2026-10-27 against this spec, `home.py`, `score_query.py`, the route and `seed_home.py`
(the author's check and the skill's table agree). Conflicts are flagged, not resolved.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Ownership | PASS | Reads and writes only SRP-owned tables in the local schema; no other Surface imported (`surface-api/tests/test_boundaries.py` passes). |
| 2 | Extend, never duplicate | PASS (watch) | Reuses the ownership rule and moves the score query into `seat/score_query.py`, used by `seat/local.py` and `home.py`. No table, function, role system or constant added. Watch: `/srp/dashboard/home` already exists for the Supabase path; this route is the local-schema twin and must be merged with it when the local schema is retired. |
| 3 | Identifiers | FLAG | The seat id is a raw `tier_agents.id`, and `srp_cleanup` is not the Surface schema `srp` (carried from the local sign-in increment). No `gcid` is touched. |
| 4 | Governed writes | FLAG | The seed deletes, inserts and updates `user_search_rank_scores`, a `*_scores` table (AGENTS.md §3 protects these). Mitigations: it touches only the throw-away local schema, writes a mandatory private backup first, runs in one transaction and refuses another schema without `--schema`. It never runs in an environment that holds real data; that stays a rule, not a check. No graph, search or category table is written. |
| 5 | Security | PASS | No new table, grant, role or RLS; queries are parameterised and the schema name is validated; read-only transaction; the seed backup is mode 600 and never overwritten; no secret in code or logs; local token still refused on every route except five (allowlist test). |
| 6 | Model vs code | PASS | No model involved; unsourced items return `null` or "Not connected yet" rather than invented figures. |
| 7 | Gated actions | N/A | No cron, indexing, enrichment or queue draining. |
| 8 | Compliance | N/A | Nothing generated or published. |
| 9 | Scoring / rings | FLAG | The peer rank is derived from legacy `srs_config_*` scores, not SRS v5; labelled `cleanup_config`, never "of 850". No ring logic. O1 and O5 stay open. |
| 10 | Open decisions | LIST | O1 (rings, related), O5 (completeness, profile strength stays unconnected), unassigned scoring ownership, unassigned identity registry ownership. None resolved here. |

Verdict: **clear for local use; merge blocked on** the rulings for items 3, 4 and 9 (the legacy score as a rank basis, writes to a
`*_scores` table by the seed, and the `srp_cleanup` schema name).

## Second-model review
An independent model reviewed the Home SQL, the ownership check and the seed on 2026-10-27, without being told what the author expected.
It raised 12 findings. Each was reconciled as below; every code fix has a test that fails without it (checked by breaking the code
on purpose, 8 mutations on the read side, all caught).

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | The seed deletes and overwrites rows; the backup was optional | High | **Fixed.** A real run without `--backup-to` is refused before anything is touched; `--dry-run` is exempt. |
| 2 | Several rows for one category were all summed, so a total could exceed the maximum | High | **Fixed.** The newest row per category counts (`distinct on`), rows for unknown categories are ignored; the same helper serves `local.py`. Tested with duplicate and unknown-category rows. |
| 3 | Rank counted deleted or deactivated peers | High | **Fixed.** Peers are active seats of active users; tested with a soft-deleted peer. |
| 4 | A seat with scores in two markets was ranked in an arbitrary one | Medium | **Fixed.** The seat's rows must all be one zipcode and vertical, otherwise no rank. |
| 5 | City came from the seat's first location, which may not be in the ranked market | Medium | **Fixed.** City is a location matching the zipcode, looked up only when a rank exists. |
| 6 | No indexes on `user_search_rank_scores(zipcode, vertical_id)`, `voce_articles(tier_agent_id)` or `tier_agent_details(tier_agent_id)` | Medium | **Known limitation.** No migration is allowed in this increment; the local schema holds mock data of a few dozen seats, where the scans are fast. Before real volume, an index migration is needed, through its own increment. |
| 7 | The seed's backup and changes could read different rows | Medium | **Fixed.** Everything runs in one repeatable-read transaction, the first statement. |
| 8 | Seeded markets move when seats are added or removed; vertical 1 in scores vs `tier_agents.vertical_id` | Low | **Documented** in the seed's docstring and in this spec; not changed. |
| 9 | The seed could be pointed at another schema by an environment variable | Medium | **Fixed.** A schema other than `srp_cleanup` needs `--schema` naming it again; the target is printed without credentials. |
| 10 | A database error returned the driver's message | Low | **Fixed.** 503 `database_unavailable`; only the error kind is logged. |
| 11 | Naive timestamps were sent without a zone, so a browser read them as local time | Low | **Fixed.** A trailing `Z` is added; tested. |
| 12 | The read could write if a query were later changed | Low | **Fixed.** `set transaction read only` is the first statement; a real-Postgres test shows a write is refused. |

The seed also now warns when some seats cannot be ranked (fewer than 10 in their market or no known score), so a thin scenario is
visible instead of silently rank-less.

## Decision log entries
Ruled 2026-10-27 (approved as proposed in `plan.md`):
- **D1.** Score maximum and source: show the total from `user_search_rank_scores` with the sum of the config maximums, labelled as the
  cleanup schema's score; no "of 850".
- **D2.** A "market" is the same `zipcode` and `vertical_id`, with at least 10 peers, else no rank.
- **D3.** Website health is shown without the "of 102".
- **D4.** AI-authority numbers are shown with their column meanings, not "1 of 7".
- **D5.** The mock-data scenario seed is approved.

Recorded 2026-10-27 after the task 7 reviews:
- **R1.** The Home read is read-only at the database level (`set transaction read only`) and a database error answers 503.
- **R2.** The seed refuses to run for real without a backup file, runs in one repeatable-read transaction, refuses a schema other than
  `srp_cleanup` unless confirmed, and prints its target. The missing indexes (finding 6) are accepted for the local mock data and left to a
  future migration increment.
- **R3.** Merge is blocked until the rulings named in the canon review verdict exist; local use is not.

Confirmed:
- **S1.** For a real seat, every item with no source shows "Not connected yet" instead of its demo content (this removes the rival
  bar, the NORA board, the map grid, the reviews tile and the other demo figures from the real person's Home). The alternative is to
  keep them as demo content under a "sample" marker. This spec takes the first because the plan's goal is that no demo number is
  shown as the person's; the plan's "stays dummy" list is read as "stays unconnected".

Deferred, still blocking other tiles: O5 (completeness), the plan and trial rule, band thresholds, a score-history table, competitors.
