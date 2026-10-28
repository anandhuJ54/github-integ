# Intent: Serve the Happyflow Web analytics page from the local database, read-only

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/web-analytics-page-schema |
| Status | draft |
| Date | 2026-10-27 |

## Problem
The Web analytics page (`/seat/professional/{id}/website`, titled "Website Analytics", "audits your own page and turns each failure into a fix NORA can hand to your webmaster") is a sample page. Every value is a prototype constant:
the address under the title (the sample persona's site), "Last checked Oct 16", the Site health gauge ("40 of 102"), three tiles (Speed "LCP 3.1 s", Markup "Missing · +42 open", AI readiness "2 of 5"), ten checks with a result line,
points and a state ("Entity and markup: No structured data on the page, +42 open"; "Name, address, phone: Matches the profile, 30 of 30"; "Indexing: Indexed; no sitemap, 10 of 20"; "Service pages: No pages for FHA or VA loans, 0 of 10";
Speed, AI readiness, Content, Conversion, Reviews on site and Security without points), NORA's two notes ("Markup is worth 42 points", "AI can't read your page yet"), and a ready-made JSON-LD snippet with the sample persona's name,
phone and address. A signed-in person sees someone else's audit under their own name, and the page disagrees with their own SRS page and Home: the "40 of 102" is the SRS v5 website lane (max 102), which the SRS page already stores
per seat, while Home's Website tile reads an older random column (`website_analytics_data.total_score`) over the same 102, so today Home, SRS and this page can show three different numbers for one seat.

## Outcome
When a signed-in person opens their own Web analytics page:
1. They see the **existing design** (the header and Re-check button, the scan status line, the Site health gauge, the three tiles, the ten checks with their All / Failing / Needs work / Passing filters and the fix sheet, the
   webmaster hand-off panel and the code snippet), with every figure, line and state read from the local database (`srp_cleanup`) through a read-only endpoint for their own seat.
2. **The gauge is the SRS v5 website lane of the seat's newest snapshot** (earned of 102, `home_snapshot_lanes` and `home_score_lanes`), so it equals the SRS page. Home's Website tile, which reads the older mock column
   `website_analytics_data.total_score`, is corrected by the seed to the same figure (a backed-up change of mock values in an existing table, as the Profile seed did for `tier_agents`), so Home, SRS and this page agree.
3. **The ten checks are stored in one new table** (one row per seat and check: state fail / warn / pass, the result line, the points earned and available where the check is scored, a source label and a trust tier), written with
   labelled mock rows by the seed. The site address and the last-scan date come from `website_analytics_data` (`website_url`, `last_refreshed_time`), which already exists.
4. **Figures computed on screen** are computed by deterministic code from those rows and never typed: the filter counts, "+N open" (available minus earned), the Markup, Speed and AI readiness tiles (each a view of its check),
   the "points worth" in NORA's first note, and the JSON-LD snippet (a template over the Profile's name, phone and address facts, so it cannot disagree with the Profile). The four scored checks add up to the lane's points.
5. **Read-only.** "Re-check" (a simulated progress bar), "Send to my webmaster" and the hand-off steps keep changing only what the browser shows; nothing is fetched, sent or written. With no real seat, the page is exactly the
   sample page it is today.

## Signals and sources
Read from code or the database on 2026-10-27; nothing was run as part of writing this intent.

| Source | Label | What it shows |
|---|---|---|
| Programme input, 2026-10-27 | Programme input | "Web analytics"; confirmed: the gauge is the SRS v5 website lane of the newest snapshot (with Home's Website tile corrected to match), and the ten checks go in one new table |
| `surface-ui/srp/src/components/happyflow/screens/website.tsx` (685 lines), `primitives.tsx` (`HealthGauge`, defaults 40 of 102) | Repo | All values are literals (`CHK`, `TILES`, `HANDOFF`, `CODE_SAMPLE`, `THINKS`, "Last checked Oct 16"); Re-check and the hand-off are timers; the four scored checks add up to the gauge: 0 + 30 + 10 + 0 = 40 earned, 42 + 30 + 20 + 10 = 102 available |
| `v3_local` `srp_cleanup.home_snapshot_lanes`, `home_score_lanes` (`website`, max 102) | Live | The seat's website lane points per snapshot (the SRS page reads them); `srs_lane_gaps` already holds a website gap text ("No markup" / "full markup", action "Fix my website") |
| `srp_cleanup.website_analytics_data` (40 rows, one per seat) | Live | `website_url` (`https://example.test/seat-N`), `last_refreshed_time`, a random `total_score` (16 to 93) that Home reads for its Website tile and that disagrees with the lane points, and mostly empty percentage columns (`nap`, `load_time`, `html_data`, `site_security`, `reviews_on_page`) |
| `srp_cleanup.agents_website_data` (25 rows), `website_analytics_categories` (5 rows), `audits` (60 rows, a generic change log) | Live | A legacy crawl snapshot (title tag, robots tag, security flag...), the legacy category list and a generic audit log: none holds a per-seat check result, state or points, so none is extended |
| `srp_cleanup.profile_facts` (`address`, `office_phone`, name from `users`) | Live | The facts the "Name, address, phone: Matches the profile" check and the JSON-LD snippet use |
| `AGENTS.md` §3, §5 | Repo | Every fact carries provenance and a trust tier; no RLS on new tables; gated actions (enrichment `engine_v1`, indexing, crons) stay off; inbound external content (a fetched page, robots.txt) is untrusted data; O2 (enrichment) is open |
| `surface-spec/srp/insights-page-schema/`, `profile-page-schema/`, `srs-page-schema/`, `home-page-schema/` | Repo | The previous four increments: the same method (local SQL script, labelled mock seed with a backup, read-only endpoint, view model, sample parity, trace, two reviews that also check the seed data against the page's rules) and the ruling that `srp_cleanup` tables get no `docs/ETL-Enhancements.md` entry |

## Success measure
- For 3 seats, every number, line, state, date and URL on the page can be traced to a row in `srp_cleanup`, recorded in `evidence.md` with independently written SQL and a deliberately wrong control that is caught.
- On the same seat, the gauge equals the SRS page's website lane (earned of 102) and Home's Website tile (tested and traced); the four scored checks add up to that figure and to 102 available; the Profile's name, phone and
  address are the ones in the snippet.
- The stored data agrees with itself (a test over the written rows, the earlier reviews' lesson): a check's state agrees with its points (a scored check at full points passes, at none fails, in between needs work); a
  failing or partial check has points open; no passing scored check has points open; every seat has all ten checks; the tiles agree with their checks.
- The sample view (no real seat) is unchanged: the existing website and render tests pass unchanged, the sample markup is identical before and after, and the page makes no write (source guard).
- The endpoint reads only the signed-in user's own seat, writes nothing, and answers only a local sign-in token.

## Open decisions touched
Listed, never resolved here:
- **O2 (enrichment) and the gated actions:** a real re-check would fetch and parse the person's website, `robots.txt` and page markup and measure speed: a crawl and an enrichment that stay off (`engine_v1`, indexing and crons are
  not touched). The stored audit is mock; the "Re-check" button stays a simulation and the page says nothing was fetched.
- **Real sources** for the audit (a crawler, a speed test, an AI-readiness test, an indexing check) are integrations with unassigned ownership (`AGENTS.md` §5); here they are mock labels only. What they would return is untrusted
  inbound content.
- **Scoring ownership and the website lane:** the SRS v5 website lane (102 points: markup 42, name-address-phone 30, indexing 20, service pages 10 in the prototype) is a mock split of a lane whose real rules belong to the scorer;
  the split and which checks are scored are unruled. The seat's lane points stay the SRS page's figure.
- **Trust tiers and provenance** of each check: each row says where it came from (for example "From your site scan") and its tier is a mock mapping, as on the Profile and Insights pages.
- **The webmaster hand-off** (sending the fix, "opened", "installed", "verified") would be an outbound message and a webhook; no such table or send exists, and none is added here.
- **The Home Website tile:** correcting the older mock `total_score` to the lane's points changes existing mock rows (backed up); which of the two is the product's "website score" is a scoring-ownership ruling.

## Out of scope
- Any write or send from the page: Re-check, Send to my webmaster, Code copied, the hand-off steps and the fix sheet's button stay on-screen only; no POST route, no email, no webhook.
- A real crawl, speed test, indexing check or AI-readiness test, the enrichment engine, the Google integrations, `public`, Supabase, an Alembic migration, and any schema change to an existing `srp_cleanup` table (only the
  mock values of `website_analytics_data.total_score` are corrected).
- Changing the design or the layout, the sample view, and the legacy `agents_website_data`, `website_analytics_categories` and `audits` tables.
- The other sample pages (Connections, Network, Settings).
