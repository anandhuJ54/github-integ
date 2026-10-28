# Intent: Serve the Happyflow Connections page from the local database, read-only

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/connections-page-schema |
| Status | draft |
| Date | 2026-10-27 |

## Problem
The Connections page (`/seat/professional/{id}/connections`, "Every account NORA can use, and what it powers") is a sample page. All of it is prototype constants: eleven accounts (Google Business Profile, Search Console, YouTube, Facebook, Instagram, LinkedIn, X,
Zillow, Yelp, Website / CMS, Loan system (Encompass)), each with a state (connected, matched, partial or not connected), a status line ("Connected · synced today", "Part of the Google sign-in, not yet granted", "Match found · replies need Yelp's partner access")
and a "powers" line ("GBP lane (67 of 68), hours, photos, reviews"), a header sentence "4 connected, 2 matched", and two NORA notes about Search Console and the Website / CMS. A signed-in person sees someone else's accounts, and the page disagrees with
their own other pages: the SRS page already stores the seat's GBP lane points and a Connections lane count ("N connected accounts"), the Web analytics page labels its Indexing check "From Google Search Console" for every seat, and the Profile labels facts
"From LinkedIn" for most seats, none of which depends on whether those accounts are connected.

## Outcome
When a signed-in person opens their own Connections page:
1. They see the **existing design** (the NORA summary, the eleven account cards with their pills, status lines and Connect buttons, the notes), with every state, line and count read from the local database (`srp_cleanup`) through a read-only endpoint for their own seat.
2. **The accounts live in one new table** (one row per seat and account: its state, status line, a source and a trust tier, and when it was last synced), written with labelled mock rows by the seed. The account's name, monogram, colour and what it powers are reference text of the page,
   not per-seat data. The legacy `social_media_connections` table (polymorphic, no seat key, no state) is read by nothing and not extended.
3. **What other pages already store is read, not copied or contradicted:** the "powers" line of Google Business Profile shows the seat's SRS v5 GBP lane (earned of max); the number of connected social accounts (Facebook, Instagram, LinkedIn, X) equals the SRS Connections lane count; the header
   counts and NORA's notes are computed from the rows.
4. **The seed makes the pages agree:** a seat's Indexing check says "From Google Search Console" only when its Search Console is connected (otherwise "From your site scan"), a Profile fact labelled "From LinkedIn" only for a seat whose LinkedIn is connected, and Google-sourced figures (Profile hours and products, the Insights visibility figures)
   only for a seat whose Google Business Profile is connected. Where today's mock data breaks one of these, the seed corrects the existing mock label (backed up), as the Web analytics seed did.
5. **Read-only.** "Connect" (the card button and NORA's note buttons) keeps changing only what the browser shows ("Connected just now"); no sign-in, no token, no sync, no write. With no real seat, the page is exactly the sample page it is today.

## Signals and sources
Read from code or the database on 2026-10-27; nothing was run as part of writing this intent.

| Source | Label | What it shows |
|---|---|---|
| Programme input, 2026-10-27 | Programme input | "leave interview page and start Connections" |
| `surface-ui/srp/src/components/happyflow/screens/connections.tsx` (259 lines) | Repo | Constants `ACC` (11 accounts: name, monogram, colour, type, status, powers), `THINKS` (2 notes), `PILL`; the count `4 + connected` and "2 matched" are literals; `hf.connect(name)` only sets browser state in the shell |
| `v3_local` `srp_cleanup.social_media_connections` | Live | A few legacy rows keyed by `profile_id` and `profile_type` ("Tier"), a `social_media_id`, token flags and random mock values; no seat key, no account name, no state per account: not usable per seat |
| `srp_cleanup.srs_lane_gaps` (`gbp`, `connections`, `videos`), `home_snapshot_lanes` | Live | The GBP lane is "Connected" for all 40 seats; the Connections lane's "you" count is 0 to 4 and its rival text "N connected accounts"; both lanes carry earned points per seat |
| `srp_cleanup.web_checks` (`indexing`) | Live | Source "From Google Search Console" for every seat |
| `srp_cleanup.profile_facts` (sources "From LinkedIn", "From Google") | Live | Many facts are sourced from accounts the Connections page may show as not connected |
| `srp_cleanup.insights_visibility` | Live | Figures sourced "From Google" |
| `AGENTS.md` §3, §5 | Repo | Every fact carries provenance and a trust tier; no RLS on new tables; secrets only in Secret Manager or Vault, never in tables; gated actions stay off; inbound external content is untrusted; O2 (enrichment) is open |
| `surface-spec/srp/web-analytics-page-schema/`, `insights-page-schema/`, `profile-page-schema/` | Repo | The method (local SQL script, labelled mock seed with a backup, read-only endpoint, view model, sample parity, trace, two reviews that also check the seed against the page's rules and the other pages) and the ruling that `srp_cleanup` tables get no `docs/ETL-Enhancements.md` entry |

## Success measure
- For 3 seats, every state, line, count and note on the page traces to a row in `srp_cleanup`, recorded in `evidence.md` with independently written SQL and a deliberately wrong control that is caught.
- On the same seat: the GBP "powers" figures equal the SRS page's GBP lane; the connected social accounts equal the SRS Connections lane count; the header counts equal the number of connected and matched rows (tested and traced).
- The stored data agrees with itself and with the other pages (a test over the written rows, the earlier reviews' lesson): Indexing's source, Profile's "From LinkedIn" facts and the Google-sourced figures follow the account states above; a connected account has a sync time and a not-connected one has none; the statuses agree with their states; every seat has all eleven rows.
- The sample view (no real seat) is unchanged: the existing Connections and render tests pass unchanged, the sample markup is identical before and after, and the page makes no write (source guard).
- The endpoint reads only the signed-in user's own seat, writes nothing, and answers only a local sign-in token.

## Open decisions touched
Listed, never resolved here:
- **O2 and the gated actions:** a real "Connect" is an OAuth sign-in, a token and a sync (an integration and an enrichment); none is built, no token or secret is stored in any table (secrets live only in Secret Manager or Vault), and the Connect button stays a simulation.
- **Real integrations and their ownership** (Google, Meta, LinkedIn, X, Zillow, Yelp, a CMS, a loan system) are unassigned (`AGENTS.md` §5); here they are mock labels only. Data they would return is untrusted inbound content.
- **What "matched" and "partial" mean** (a listing found without a sign-in; a match that needs partner access) is the prototype's wording, unruled.
- **Trust tiers** of an account's state are a mock mapping, as on the other pages.
- **Which pages' labels depend on a connection** (item 4 of the outcome) is this increment's rule; the real rule (can a fact come from LinkedIn without a connection, for example by import) is unruled.
- **Scoring ownership:** the GBP and Connections lanes are the SRS pages' mock lanes; their rules are unruled.

## Out of scope
- Any write or sign-in from the page: Connect, the notes' buttons and "Connected just now" stay on-screen; no OAuth, no token, no webhook, no POST route.
- Real integrations, the enrichment engine, `public`, Supabase, an Alembic migration, the legacy `social_media_connections` table, and any schema change to an existing `srp_cleanup` table (only mock labels and texts are corrected).
- Changing the design or the layout, and the sample view.
- The other sample pages (Network, Settings) and the Interview page (left as it is).
