# Intent: Show real data on the Happyflow Home page from `srp_cleanup`

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/home-page-data |
| Status | draft |
| Date | 2026-10-27 |

## Problem
A person who signs in and opens their Home page sees mostly someone else's numbers. Of the 22 data items on the day 1
Home, only the name and avatar come from the database; the score (390 of 850), the rank (#6 of 41), the VOCE and website
tiles, the AI-citation count, the photo and the credentials are demo constants, shown without any sign that they are not the
person's. The API already returns a score for the seat, and `srp_cleanup` holds rows that could feed six more items, but
the page ignores them. The mock data in `srp_cleanup` is also too thin to show anything meaningful if it were wired.

## Outcome
When a signed-in person opens their own Home page (`/seat/professional/{id}`, day 1 and the day 7 / 24 variants):
1. The score, its per-category breakdown, the rank among peers, the VOCE article counts, the website score, the
   AI-authority numbers, the photo, the credentials count and the year started come from `srp_cleanup`, through one new
   read-only endpoint for the person's own seat.
2. Every item that has no source in `srp_cleanup` says "Not connected yet" instead of showing a demo number. Demo
   numbers appear only in the sample view (no real seat), exactly as today.
3. The page says which of its numbers are real, so no demo figure is mistaken for the person's.
4. The local mock data is rich enough, and consistent enough, for each of those items to show something plausible.

## Signals and sources
Every claim below was read from code or the database on 2026-10-27; none of it was run as part of writing this intent.

| Source | Label | What it shows |
|---|---|---|
| Home page review, 2026-10-27 (browser read of day 1 and `?day=7`, and `home-day1.tsx`, `home-day7.tsx`, `demo-data.ts`) | Repo | 22 day-1 items: 3 connected (name, sidebar name, notice), 2 not wired, 7 derivable, 10 with no source in `srp_cleanup` |
| `surface-ui/srp/src/components/happyflow/demo-data.ts:39-41`, `screens/home-day1.tsx:34-110` | Repo | The score (`SCORE_BY_DAY` 390 / 418 / 471), rival (571), "9 of 49", reviews "4.9 / 128", "64%" and the NORA board are constants |
| `surface-api/srp/src/seat/local.py:112` (`professional_seat`) | Repo | The seat read already returns `score.total_score` as `SUM(user_search_rank_scores.srs_category_score)`; the Home does not use it |
| `v3_local`, schema `srp_cleanup`: `user_search_rank_scores` (12 columns), `srs_config_categories` (6), `voce_articles` (14), `website_analytics_data` (24), `ai_authority_stats` (14), `tier_agent_details` (13) | Live | The tables that could feed the Home; column names as in the schema workbook |
| `v3_local` mock rows | Live | Only 28 of the seated users' seats have a score row, 1 to 3 rows each, some with NULL scores; `zipcode` is mostly empty; `srs_config_categories.score` sums to 29, not 850; seat 34 has 2 website rows, 3 articles, no AI-authority row |
| `AGENTS.md` §3 "Scoring and rings" | Repo | The live scorer is SRS v5 (`exp_score_v5_*`, 850 points, 10 lanes); `srs_config_*` in the cleanup schema is the legacy configuration |
| `surface-spec/srp/local-login-srp-home/` | Repo | The sign-in, the own-seat rule and the local-session allowlist this increment extends |
| Programme input, 2026-10-27 | Programme input | "Wire the Home page data (endpoint shape, SQL, tests)"; decisions D1 to D5 approved as proposed in `plan.md` |

## Success measure
- For two different signed-in users, every number on the wired tiles of the Home can be traced to a row in `srp_cleanup`,
  recorded in `evidence.md`.
- With real data, none of the demo constants for wired or unconnected items appears on the page (390, 418, 571, "9 of 49",
  "4.9", "128", "64%", "127 points", "Riverbend"); a render test checks it.
- With no real seat the page is unchanged from today.
- The endpoint returns only the signed-in user's own seat, writes nothing, and is reachable only with a local sign-in token.
- Observe: any number found on the page that is neither traceable nor marked "Not connected yet" is a finding that becomes a
  new test, per `AGENTS.md` §1.

## Open decisions touched
Listed, never resolved here:
- **Scoring (`AGENTS.md` §3, canon item 9; related to O1):** the page will show a total from the legacy cleanup score, not
  SRS v5. Ruled for this increment (D1): show it with the cleanup schema's own maximum and label it as the cleanup score; do
  not claim "of 850". Which source becomes the real one is not decided and blocks a later increment.
- **O5 (completeness calibration):** "Profile strength" is not wired until it is ruled.
- **Unassigned ownership (`AGENTS.md` §5):** scoring and the identity registry are unassigned; this increment adds read
  queries only and takes no ownership position.
- No other O-number is depended on.

## Out of scope
- Items with no source in `srp_cleanup`: plan and trial, band labels, score history and "since you claimed", competitors
  and "points to #1", NORA's board, map rank, reviews, listings, profile strength, the peer benchmark panel, the day 7
  banner, weekly brief, streak and review drafts. They show "Not connected yet" for a real seat.
- Any write, including saving "when did you start in mortgage".
- The other Happyflow pages, the SRS v5 scorer, `public`, Supabase, any migration or new table.
- Changing the Happyflow layout or design beyond replacing a demo number with the "Not connected yet" state.
