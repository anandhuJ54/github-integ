# Intent: Serve the Happyflow SRS page from the local database, keeping SRS v5 as is

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/srs-page-schema |
| Status | draft |
| Date | 2026-10-27 |

## Problem
The Home page now reads `srp_cleanup` through the read-only Home endpoint, but the Search Rank Score (SRS) page does not. It is rendered at
`/seat/professional/{id}/nora` inside `SampleData` and shows hard-coded sample values: the 390 of 850 ring, the band bar, "#6 of 41 in Davenport",
the rival (571), ten lane rows (open points, status, "you vs rival" text, action), NORA's three notes and the numbers in the "How your score is
calculated" dialog. A signed-in person sees the same SRS page as everyone, and it can disagree with their own Home page. Most of the data this page
needs is already in the Home tables; what is missing is the per-lane comparison text, the per-lane action and a short lane label.

## Outcome
When a signed-in person opens the SRS page for their own seat:
1. They see the **existing SRS design and the existing SRS v5 scoring system** (850 points, the same 10 lanes and budgets), with every score, rank, rival,
   lane value, status, comparison and note read from the local database (`srp_cleanup`) through a read-only endpoint for their own seat.
2. The SRS page and the Home page show the same total, band, rank and rival for the same seat, because both are built from the same rows by the same code.
3. The schema gains only what SRS lacks (a per-seat per-lane comparison and action table, and a short lane label); no second score store, and the
   legacy `srs_config_*` / `user_search_rank_scores` tables are neither changed nor read by this page.
4. With no real seat, the SRS page is exactly the sample page it is today.

## Signals and sources
Read from code or the database on 2026-10-27; nothing was run as part of writing this intent.

| Source | Label | What it shows |
|---|---|---|
| Programme input, 2026-10-27 | Programme input | "do the DB connect and schema correctness for SRS, keep the existing srs scoring system"; confirmed: keep SRS v5 as is |
| `surface-ui/srp/src/components/happyflow/screens/srs.tsx`, `srs.test.ts` | Repo | The page: 10 lanes with budgets (850), open points, status, comparison, action; calc dialog; tests pin the lanes and the 390 earned |
| `surface-ui/srp/src/routes/_authenticated/seat.$kind.$id.nora.tsx` | Repo | The SRS screen is mounted here inside `SampleData`; no data is fetched |
| `v3_local` `srp_cleanup.home_score_lanes`, `home_score_bands`, `home_snapshots`, `home_snapshot_lanes`, `home_competitors`, `home_nora_insights` | Live | 10 lanes (850), bands, 122 snapshots with 1,220 lane rows, competitors and insights for 40 seats: the score, rank, rival and lane points SRS needs |
| `v3_local` `srp_cleanup.srs_config_*` (20/10/20/40/30 rows), `user_search_rank_scores` (400) | Live | The legacy configuration: 10 mock categories whose budgets add to 29, mock names; used only by the seat read (`seat/score_query.py`) |
| `AGENTS.md` §3; `docs/PLATFORM_HANDOFF_2026-10-12.md` §2.6 | Repo | SRS v5 is the live scorer: 850 points over 10 lanes |
| `surface-spec/srp/home-page-schema/` | Repo | The Home increment whose tables, seed and read this one extends |

## Success measure
- For 3 seats (day 1, 7, 24 layouts) every value on the SRS page can be traced to a row, with independently written SQL and a wrong control that is caught.
- On the same seat, the SRS and Home pages agree on total, band, rank and rival (tested).
- Lane budgets add to 850 and each lane's earned + open equals its budget (tested, and enforced in the database).
- The sample view (no real seat) is unchanged: the existing SRS tests pass unchanged.
- The endpoint reads only the signed-in user's own seat, writes nothing, and answers only a local sign-in token.
- Observe: a displayed figure that is neither a row nor computed from rows is a finding that becomes a new test.

## Open decisions touched
Listed, never resolved here:
- **Scoring (`AGENTS.md` §3, canon item 9; related to O1):** the mock lane points are SRS v5 shaped but not produced by the real scorer.
- **Fix / Strong threshold:** the share of a lane's budget that makes it "Strong" has no ruling; a constant is used and flagged.
- **Band thresholds** and **O5 (completeness calibration)** remain as in the Home increment.
- **Unassigned ownership (`AGENTS.md` §5)** of scoring and identity; **the `srp_cleanup` schema name**.

## Out of scope
- Any write from the SRS page; buttons keep changing on-screen state only.
- Changing the design or layout, the real SRS v5 scorer, the legacy `srs_config_*` tables, `public`, Supabase, an Alembic migration.
- The other Happyflow pages (Profile, Insights, Web analytics, Connections, Network, Settings), which stay sample.
