# Intent: Keep the Happyflow Home design and serve every value on it from the local database

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/home-page-schema |
| Status | draft |
| Date | 2026-10-27 |

## Problem
The Home page design (day 1, day 7, day 24) is the design the product wants to keep: the "Pass Riverbend" mission hero with the rival bar,
the 390 OF 850 ring with its band and "since you claimed", NORA's board, the stat tiles (map spots, AI citations, reviews, profile strength),
the locked-feature cards, the peer panel, and on day 7 the weekly brief, review drafts, "while you were away", moves and streak, and the day 24
recap. The previous increment (`srp/home-page-data`) wired what `srp_cleanup` could feed and, because `srp_cleanup` has no source for most of
the page, made a signed-in person see a different page: a simpler layout with 15 "Not connected yet" tiles. The data those tiles need does not
exist in the local database: no 850-point score or lanes, no bands or score history, no rival or competitor, no plan or trial dates, no
reviews, no map scan, no NORA moves or activity, no brief, drafts or events. The sample numbers sit as constants in
`surface-ui/srp/src/components/happyflow/` and some contradict each other (128 vs 130 reviews; a claim baseline of 298 vs a landing score of 384).

## Outcome
When a signed-in person opens their own Home page (`/seat/professional/{id}`):
1. They see the **original design**, not the "Not connected yet" variant, and every figure, name, list item and date on it comes from the
   local database (`srp_cleanup`), through the existing read-only Home endpoint for their own seat.
2. `srp_cleanup` gains a set of Home tables (new tables only, no change to any existing table) holding an 850-point, SRS v5 shaped score
   (10 lanes, bands, history), market rank, competitors, trial and plan, NORA activity and next moves, locked features, weekly brief, review
   drafts, events and the other Home inputs, filled with labelled mock data by the seed.
3. Values that are computed on screen (points to #1, since you claimed, this week's change, "Done N things", points waiting, band position)
   are computed by deterministic code from those rows, so they cannot disagree with each other.
4. Which layout opens (day 1, day 7, day 24) follows the trial dates in the database; the `?day=` switch stays as a demo override.
5. With no real seat, the Home is exactly the sample page it is today.

## Signals and sources
Claims below were read from code or the database on 2026-10-27; none was run as part of writing this intent.

| Source | Label | What it shows |
|---|---|---|
| Programme input, 2026-10-27 | Programme input | "Keep this UI design... create schema for this... only for Home we should connect local DB and map all the values in UI from DB via API... change schema for this only in local DB"; score tables 850-point SRS v5 shaped; layout day from trial dates; read-only |
| `surface-ui/srp/src/components/happyflow/screens/home-day1.tsx`, `home-day7.tsx`, `shell.tsx`, `demo-data.ts` | Repo | Inventory of every displayed value: rival (571), score by day (390 / 418 / 471), baselines 298 and 384, "#6 of 41", "9 of 49", "1 of 7", "4.9 from 128 / 130", "64% / 72%", "127 points", NORA board items, brief lines, review drafts, banners, recap tiles, peer panel |
| `surface-ui/srp/src/utils/home-data.ts:36-52`, `surface-api/srp/src/seat/home.py:29` | Repo | The 15 `UNCONNECTED` tiles and the 8 `UNAVAILABLE` names the previous increment left without a source |
| `v3_local`, schema `srp_cleanup` (81 tables, none named `home_*`) | Live | Nearest existing tables: `persona_features` (12 rows) and `user_personas` (4) for plans, `alerts` (40) for needs-you, `social_media_connections` (25) and `google_analytics` (25) for connections; none holds a score history, rival, trial date, review, map scan or brief |
| `docs/PLATFORM_HANDOFF_2026-10-12.md:139-143`; `AGENTS.md` §3 | Repo | SRS v5 is the live scorer: 850 points over 10 lanes (Reviews 187, Completeness 182, Website 102, Articles 103, GBP 68, Directories 90, Q&A 34, Connections 51, Videos 27, Audio 6) |
| `docs/Score_Architecture_Spec.md:37` | Repo | The only definition of bands (0-99 Unranked, 100-399 Building, 400-699 Established, 700-899 Leading, 900+ Elite) is on the stale 1000-point scale; the design uses Building and "400 · Established" |
| `surface-spec/srp/home-page-data/` | Repo | The previous increment and the rulings this one supersedes (S1, D1, "no table or column") |
| `surface-spec/srp/local-login-srp-home/spec.md:118-120` | Repo | `srp_cleanup` is a local schema outside the Alembic stream; no migration, no change-log entry |

## Success measure
- For users whose seats are on day 1, day 7 and day 24, every number and text on the Home can be traced to a row in `srp_cleanup`, recorded in
  `evidence.md`, with independently written SQL and a deliberately wrong control that is caught.
- The rendered real Home contains none of the previous "Not connected yet" placeholders and none of the sample constants that the data replaces;
  a render test per day checks it.
- The sample view (no real seat) is byte for byte what it is today (the existing render tests pass unchanged).
- The Home endpoint still reads only the signed-in user's own seat, writes nothing, and answers only a local sign-in token.
- Observe: a displayed figure that is neither traceable to a row nor computed from rows is a finding that becomes a new test.

## Open decisions touched
Listed, never resolved here:
- **Scoring (`AGENTS.md` §3, canon item 9; related to O1):** the mock score is 850-point SRS v5 shaped but is not produced by the real scorer
  (`exp_score_v5_*`). It is labelled mock; where a real score comes from is not decided.
- **Band thresholds:** only a stale 1000-point document defines bands. The mock thresholds are placeholders that need a ruling.
- **O5 (completeness calibration):** profile strength is stored as a mock percentage, not computed.
- **Unassigned ownership (`AGENTS.md` §5):** scoring and the identity registry are unassigned; this increment takes no ownership position.
- **The `srp_cleanup` schema name** (already flagged by the sign-in and Home increments) and the plan and trial rule remain unruled.

## Out of scope
- Any write from the Home: approving a draft, dismissing a banner, saving the year started and reconnecting Facebook stay on-screen only.
- Changing the design, the layout, the animations or the sample view.
- Chat canned answers in the NORA panel and the full Map, VOCE and upgrade panels beyond the numbers shown on the Home.
- The other Happyflow pages, the real SRS v5 scorer, `public`, Supabase, an Alembic migration, and any change to an existing `srp_cleanup` table.
