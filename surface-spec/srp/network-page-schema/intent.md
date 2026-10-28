# Intent: Serve the Happyflow Network page from the local database, read-only

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/network-page-schema |
| Status | draft |
| Date | 2026-10-28 |

## Problem
The Network page (`/seat/professional/{id}/network`, "The partners who send you buyers, and the referrals between you") is a sample page. All of it is prototype constants: two tabs, **Partners** and **Referrals**.
- **Partners** shows eight named people from other firms (agents, a title company, an inspector) in four groups: "Promoted on your profile" (3 of 8 slots), "Want to promote you" (2 requests, each with a reason, Accept or Decline), "NORA suggests" (2, each with a reason such as "Named in 3 of your Zillow reviews" or "Co-listed on 4 of your closings this year") and "Saved for later" (1); a NORA summary sentence ("Priya and Luis asked to promote you, and I found 2 more partners worth adding."), a "Create a group" button, and an SRS demo video and slides card.
- **Referrals** shows three lists, "Sent to you" (4), "You asked for" (3) and "You sent" (2), each row with a name, a detail line, a source and date, a status pill ("New · I texted them a welcome", "I followed up twice", "Closed", "No reply · 5 days", "Referred a friend", "Thanked you", "Done") and a button (Call, View, Nudge); the tab counters ("3 promoted", "4 received"); an "Ask for referrals" card; and two NORA notes.

A signed-in person sees someone else's partners and referrals. The page also disagrees with the rest of the seat's data: the suggestion "Named in 3 of your Zillow reviews" appears for a seat whose Zillow is not matched on the Connections page; "Co-listed on 4 of your closings" and "Past client · closed in August" are not backed by any stored closing or client; the NORA note says promoters "add to your Connections lane", while the SRS Connections lane now counts connected social accounts; and the "Ask for a referral" sheet offers "6 past clients who left 5★" whatever the seat's reviews are.

## Outcome
When a signed-in person opens their own Network page:
1. They see the **existing design** (both tabs, the four partner groups, the three referral lists, the cards and notes), with every partner, request, suggestion, referral, status, count and note read from the local database (`srp_cleanup`) through a read-only endpoint for their own seat.
2. **The partners and referrals live in the database, per seat**, written with labelled mock rows by the seed (each with a source and a trust tier, as on the other pages). Which tables hold them is the spec's decision after the extend-never-duplicate check: the legacy `pin_partner_profiles`, `referral_requests`, `referral_sents`, `referral_histories`, `referral_emails`, `partners` and `invite_partners` already exist in `srp_cleanup` (random mock rows, no per-seat states), and nothing new is created if one of them can carry the page.
3. **Counts, summary sentence, tab counters and NORA's notes are computed** from the rows, never stored; the status pills and buttons follow each row's state.
4. **The seed makes the pages agree:** a suggestion's reason cites only what the seat's own data supports (a Zillow reason only for a seat whose Zillow is matched; a closings or past-client reason only if closings or past clients are stored); the partner people are real rows of the seat set or clearly labelled mock people, never invented identifiers; the "Ask for referrals" card's count of past clients follows the seat's review counts; and the note that promoters add to the Connections lane agrees with what that lane counts. Where today's mock data breaks one of these, the seed corrects the existing mock value (backed up), as the Connections increment did.
5. **Read-only.** Accept, Decline, Promote, Save, Remove, Create a group, Nudge, Call, the video and slides buttons and "Ask for a referral" keep changing only what the browser shows (toasts, counters, the sheet); no message is sent, no partner is invited, nothing is written. With no real seat, the page is exactly the sample page it is today.

## Signals and sources
Read from code or the database on 2026-10-28; nothing was run as part of writing this intent except read-only queries.

| Source | Label | What it shows |
|---|---|---|
| Programme input, 2026-10-28 | Programme input | "Network" (start the next page after Connections) |
| `surface-ui/srp/src/components/happyflow/screens/network.tsx` (913 lines) | Repo | Constants `PARTNERS` (8 people: id, name, company, role, colour), `WHY` (reasons), `INITIAL_NET` (state per partner: promoted, request, suggested, saved, gone), `STS` (8 referral statuses with label, colours and button), `refRows` (9 referral rows in three lists), `THINKS` (2 notes); the headline counts ("N of 8", the tab counters) and the summary sentence are literals or derived from the constants; every button only sets browser state (`hf.toast`, `hf.openSheet`, local `useState`) |
| `v3_local` `srp_cleanup.pin_partner_profiles` | Live | 25 legacy rows: `tier_agent_id` pins `pinned_agent_id` (both `tier_agents.id`), random mock; 19 seats have one or two pins, all pinned ids are in the 1 to 40 seat set; no state beyond "pinned" (a natural fit for "Promoted on your profile") |
| `srp_cleanup.referral_sents`, `referral_requests`, `referral_histories`, `referral_emails` | Live | 25, 25, 5 and 25 legacy rows with random mock values (recipient names like "Mock referral sents 1", counts of resends and follow-ups, archive flags, `professional_id`, `tier_agent_id`, an integer `resource` and `delivery_status`); no per-seat status vocabulary like the page's |
| `srp_cleanup.partners`, `invite_partners`, `invite_signups` | Live | 25 legacy rows each: partner-company profile groups and email invites, random mock; not per-seat partner cards |
| `srp_cleanup.home_plans` | Live | "Referral network" is a Core plan item (so every plan includes it); no gating of the page by plan is needed |
| `srp_cleanup.connected_accounts` (Zillow) and `srs_lane_gaps` (Connections) | Live | Zillow is matched on 21 seats and available on the other 19 (partial exists only for Yelp); the Connections lane's "you" count equals the connected social accounts |
| `AGENTS.md` §3, §5 | Repo | Every fact carries provenance and a trust tier; no RLS on new tables; inbound external content (reviews, customer text, partner messages) is untrusted; gated actions stay off; no side systems (no external CRM or sequencing tool); O2 (enrichment) and identity ownership are open |
| `surface-spec/srp/connections-page-schema/`, `web-analytics-page-schema/` and earlier increments | Repo | The method (local SQL script, labelled mock seed with a backup, read-only endpoint, view model, sample parity, browser trace, two reviews that also check the seed against the page's rules and the other pages) and the ruling that `srp_cleanup` tables get no `docs/ETL-Enhancements.md` entry |

## Success measure
- For 3 seats, every partner, request, suggestion, referral, status, count and note on the page traces to a row in `srp_cleanup`, recorded in `evidence.md` with independently written SQL and a deliberately wrong control that is caught.
- The stored data agrees with itself and with the other pages (a test over the written rows, the earlier reviews' lesson): a Zillow-based reason only where Zillow is matched; no reason that cites a closing or a past client unless it is stored; the referral counts and the tab counters equal the rows; "N of 8" equals the promoted rows; the "Ask for referrals" count follows the seat's reviews; the promoters note and the Connections lane say the same thing.
- The sample view (no real seat) is unchanged: the existing Network and render tests pass unchanged, the sample markup is identical before and after, and the page makes no write (source guard).
- The endpoint reads only the signed-in user's own seat, writes nothing, and answers only a local sign-in token (the token-scope list grows by one route).

## Open decisions touched
Listed, never resolved here:
- **Identity and partner ownership:** who a "partner" is (another seat, a company, an external person) and which Surface owns partner and referral data is unassigned (`AGENTS.md` §5, identity registry); here partners are mock people, and the pinned ids are the existing seat set only.
- **O2 and the gated actions:** a real "ask for a referral", "nudge", invite or "texted them a welcome" is an outbound message (an enrichment, a send): none is sent or built, and no side system (CRM, sequencing) is added.
- **Compliance of referral content:** referral asks and nudges are generated or outbound text; before any real send they must pass `content_compliance_rules` and `exp_category_compliance` server-side (mortgage: RESPA, no referral fees or steering, NMLS display). Nothing is sent here, and the stored mock texts are not used as sendable content.
- **Trust tiers** of a partner or referral row are a mock mapping, as on the other pages.
- **What the referral statuses mean** (new, followed, closed, waiting, nudged, replied, thanked, done) and how a referral becomes "closed" is the prototype's vocabulary, unruled.
- **Whether promoters add to a lane** (the prototype note) is unruled; the SRS Connections lane currently counts connected social accounts only.
- **Scoring ownership:** nothing here changes a score or a lane's points.

## Out of scope
- Any write or send from the page: Accept, Decline, Promote, Save, Remove, Create a group, Nudge, Call, Ask for a referral, the demo video and slides stay on-screen; no email or text is sent, no invite is created, no webhook, no POST route.
- Real partner discovery, matching, referral tracking or closing data (enrichment is gated), the legacy `partners` and `invite_*` tables as a feed, `public`, Supabase, an Alembic migration, and any schema change to an existing `srp_cleanup` table (a column is added only if the spec's extend-never-duplicate check requires it, with its own approval).
- Changing the design or the layout, and the sample view.
- The Settings page (a later increment) and the Interview page (left as it is).
