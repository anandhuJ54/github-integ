# Intent: Serve the Happyflow Insights page from the local database, read-only

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/insights-page-schema |
| Status | draft |
| Date | 2026-10-27 |

## Problem
The Insights page (`/seat/professional/{id}/insights`, "How buyers find you, and who they find first") is a sample page. Its two live tabs, **Visibility** and **Competitors**, show prototype constants:
six Google figures ("Search views 1,240", "Maps views 860", "Calls 41", "Directions 18", "Website clicks 57", "Experience.com profile views 312"), a 49-spot map-rank grid "around 100 Main St" with
"One-time scan · Oct 16" and, for the selected spot, a top-3 list built by a made-up rotation rule over five sample rivals, an "AI visibility" card ("Named in 1 of 7 answers", ChatGPT 1 of 3, Gemini 0 of 2,
Perplexity 0 of 2, each with a note), a competitor table of six lenders with rating, review count and average map position ("Riverbend Bank & Trust 4.7 (412) 2.1" ... "Alex Sample (you) 4.9 (128) 7.8"),
a yes/no question "Is Riverbend Bank & Trust who you lose deals to?", NORA's two notes, and two locked-feature cards. A signed-in person sees someone else's numbers and rivals under their own name, and the page
disagrees with their own Home (which already stores a map scan, an "N of 7" AI figure and five competitors for the seat).

## Outcome
When a signed-in person opens their own Insights page:
1. They see the **existing design** (the two live tabs, the map grid, the spot detail, the AI card, the competitor table, the notes, the locked cards), with every figure, name, date and list read from the local database
   (`srp_cleanup`) through a read-only endpoint for their own seat.
2. What Home already stores is **read, not copied**: the 49 map ranks and the scan date (`home_map_cells`, `home_snapshots`), the "N of 7" AI figure (`home_snapshots`), and the competitors with their rating, review count and
   article count (`home_competitors`), the office address from the Profile's address fact. So the Insights map, AI total and competitors cannot disagree with Home.
3. What no table holds today lives in **new tables** written with labelled mock rows by the seed: the six 30-day visibility figures, the per-engine AI rows (with their notes), the average map position of each competitor
   and of the seat, and the top 3 businesses at each of the 49 map spots.
4. Figures computed on screen (the "N of 7" total from the engine rows, the seat's place in the competitor table, "points to #1" style gaps if shown, NORA's two notes, the locked cards a plan still hides) are computed by
   deterministic code from those rows, never typed.
5. **Read-only.** The yes/no "who do you lose deals to" question, "Add a competitor" and the tab switches keep changing only what the browser shows; nothing is written. With no real seat, the page is exactly the sample page it is today.

## Signals and sources
Read from code or the database on 2026-10-27; nothing was run as part of writing this intent.

| Source | Label | What it shows |
|---|---|---|
| Programme input, 2026-10-27 | Programme input | "insights"; confirmed: new insights table with mock rows for the visibility figures (not `google_analytics`), and the top 3 per spot stored (not computed in code) |
| `surface-ui/srp/src/components/happyflow/screens/insights.tsx` (561 lines), `demo-data.ts` (`GRID`, `RIVALS`) | Repo | Tabs Visibility and Competitors are live; Actions, Reputation, NORA impact and Reports only toast "not part of this prototype"; all figures are literals; the spot top 3 is a rotation of `RIVALS` with "You" inserted at the seat's rank |
| `v3_local` `srp_cleanup.home_map_cells` (1,960 rows), `home_snapshots.map_scanned_at`, `ai_cited`, `ai_checked` | Live | The seat's 49 map ranks, scan date and "N of 7" AI figure already exist per snapshot (written by the Home seed) |
| `srp_cleanup.home_competitors` (200 rows: 5 per seat) | Live | name, score, review count and average, article count, market-leader flag; **no average map position** |
| `srp_cleanup.google_analytics` (25 rows) | Live | Keyed by a polymorphic `resource_type` / `resource_id` (not a seat), with mostly empty impression columns and no profile-views column; not used (decision above) |
| `srp_cleanup.profile_facts` (`address`) | Live | The seat's office address, already shown on the Profile |
| `home_locked_features`, `home_plans` | Live | Which features a seat's plan still locks (Map Rank tracking, AI-citation monitoring belong to the top plan) |
| `AGENTS.md` §3, §5 | Repo | Every fact carries provenance and a trust tier; no RLS on new tables; gated actions (enrichment engine `engine_v1`, indexing, crons) stay off; inbound external content is untrusted data; O2 (enrichment) is open |
| `surface-spec/srp/profile-page-schema/`, `srs-page-schema/`, `home-page-schema/` | Repo | The previous three increments: same method (local SQL script, labelled mock seed, read-only endpoint, view model, sample parity, trace, two reviews that also check the seed data against the page's rules) |

## Success measure
- For 3 seats, every number, name, date and list on the Visibility and Competitors tabs (including the top 3 of the selected map spots) can be traced to a row in `srp_cleanup`, recorded in `evidence.md` with independently
  written SQL and a deliberately wrong control that is caught.
- On the same seat, the Insights map (49 ranks, scan date, "N of 49 in the top 3"), AI total ("N of 7") and the competitors' names, ratings and review counts equal Home's and the Profile's (tested and traced).
- The stored data agrees with itself: the per-engine AI rows add up to Home's `ai_cited` and `ai_checked`; at every map spot the top 3 contains "You" at the seat's stored rank exactly when that rank is 1 to 3; the seat's
  row sits in the competitor table by its average position (a test over the written rows, the SRS and Profile reviews' lesson).
- The sample view (no real seat) is unchanged: the existing Insights tests and render tests pass unchanged, the sample markup is identical before and after, and the page makes no write (source guard).
- The endpoint reads only the signed-in user's own seat, writes nothing, and answers only a local sign-in token.

## Open decisions touched
Listed, never resolved here:
- **O2 (enrichment) and the gated actions:** the AI figures and the map scan are mock rows; running a real AI-citation check or a map scan would be an enrichment or crawl and stays off (`engine_v1`, indexing, crons are not touched).
- **Real sources** for Google Business Profile figures, map-rank scans and AI-answer checks are integrations (unassigned ownership, `AGENTS.md` §5); here they are mock labels only. Inbound content from them would be untrusted data.
- **Competitor identity:** the competitors are generic mock business names; who counts as a seat's competitor, and the market definition behind the average map position, are unruled.
- **Trust tiers and provenance** of these figures: each row says where it came from (for example "From Google") and its tier is a mock mapping, as on the Profile.
- **Plan gating** of Map Rank tracking and AI-citation monitoring (which plan unlocks them) is the Home's mock rule; the pricing and the plan names are unruled.
- **The `srp_cleanup` schema name** remains unruled.

## Out of scope
- Any write from the page: answering the competitor question, adding a competitor, saving a note stay on-screen only; no POST route.
- The four tabs that are not part of the prototype (Actions, Reputation, NORA impact, Reports), changing the design or the layout, and the sample view.
- Real Google, map-scan or AI-answer integrations, the enrichment engine, `public`, Supabase, an Alembic migration, and any change to an existing `srp_cleanup` table.
- The other sample pages (Web analytics, Connections, Network, Settings).
