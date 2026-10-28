# Intent: Serve the Happyflow Profile page from the local database, read-only

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/profile-page-schema |
| Status | draft |
| Date | 2026-10-27 |

## Problem
The Profile page (`/seat/professional/{id}/profile`, "Every fact NORA knows about you, with its source") is a sample page. Only four values on it come from the signed-in
person's account (name, title, mobile, email, through the persona override); every other fact is a prototype constant: the bio ("Thin"), year started, office phone,
address, hours, NMLS number, licensed states, the nine loan products, service areas, designations, awards, education, the profile photo, "4.9 (130)" reviews, "64% complete",
the company and city in the public preview, the "67 facts from 6 sources" expertise graph and its six bars, and the **source line on every fact** ("From LinkedIn",
"Confirmed by you · Oct 16", "From Google", "From NMLS"). The page also holds sample suggestions from NORA (a bio draft, "2 certifications on LinkedIn"). A signed-in person sees someone
else's facts next to their own name, and the source and trust of each fact, which the platform says every fact must carry, is only text in the page.

## Outcome
When a signed-in person opens their own Profile page:
1. They see the **existing Profile design**, with every fact, its source line and its date read from the local database (`srp_cleanup`) through a read-only endpoint for their own seat.
2. Facts that already live in existing tables (name, title, photo, year started, office and mobile phone, email, bio, address) keep coming from `tier_agents`, `users` and `locations`;
   the facts that have no home today (NMLS, licensed states, hours text, loan products, service areas, designations, awards, education, and the source and trust tier of each fact)
   live in **one new table** (`profile_facts`), with labelled mock rows written by the seed. No second copy of a value that already exists.
3. The preview's figures that Home already stores (rating and review count, profile strength) are read from the same rows Home reads, so the two pages cannot disagree;
   counts that are computed on screen (credentials "N of 3 added", facts per group in the expertise graph, "N facts from M sources", fields still missing) are computed by deterministic code from the rows.
4. **Read-only.** The editing flows (type or dictate a note, Review changes, the NORA bio draft, "Add 2 certifications") keep changing only the on-screen (browser) state, exactly as today. Nothing is written to the database.
5. With no real seat, the Profile page is exactly the sample page it is today.

## Signals and sources
Read from code or the database on 2026-10-27; nothing was run as part of writing this intent.

| Source | Label | What it shows |
|---|---|---|
| Programme input, 2026-10-27 | Programme input | "start profile" (next page after SRS); confirmed: read-only, one `profile_facts` table plus the existing tables |
| `surface-ui/srp/src/components/happyflow/screens/profile.tsx`, `profile-voice.ts`, `profile-store.ts` | Repo | The 15 editable facts (`INITIAL`), five cards (Identity, Contact, Licences, Services and areas, Credentials) and the expertise graph; sources are literals; edits are kept in `localStorage` (`hf-demo-profile`) |
| `surface-ui/srp/src/components/happyflow/persona.ts`, `demo-data.ts` | Repo | The persona override takes name, title, email, mobile from the seat; everything else (company, city, rating, reviews, NMLS, photo) is `PERSONA`; `PRODUCTS` is the nine loan products |
| `v3_local` `srp_cleanup.tier_agents` (40 seats) | Live | Has `description` (bio), `year_started`, `phone_number`, `mobile_number`, `business_hours`, `awards`, `license`, `specialties`, `memberships`, `achievements`, `zipcode`, `profile_photo`; the mock values are generic ("Mock description for tier_agents #34", `{"n": 34, "mock": true}`), the fill rates are 28 to 40 of 40 |
| `srp_cleanup.users`, `tier_locations`, `locations` | Live | email, names; the seat's office address (`address_line_1`, `city`, `state_id`, `postal_index_code`) |
| `srp_cleanup.education_details` (25), `service_areas` (25), `services` (25), `tier_agent_details.certifications` | Live | Closest existing structures for education, service areas, loan products and designations; they are keyed by ids into reference tables that are not loaded (`university_id`, `university_degree_id`), or by `resource_id` / `resource_type`; none holds a source, a trust tier or a date |
| `home_snapshots.review_avg`, `review_count`, `profile_strength_pct` | Live | The rating, review count and "64% complete" the preview needs; already read by Home |
| `surface-api/srp/src/seat/local.py` (`professional_seat`) | Repo | The seat read already returns name, title, slug, tag line, description, photo, phone, email and the office city and state for a local session |
| `AGENTS.md` §3 | Repo | "Every fact carries provenance and a trust tier: self_declared < imported < platform_observed < authority_verified < owner_verified"; no RLS on new tables; extend, never duplicate |
| `surface-spec/srp/srs-page-schema/`, `home-page-schema/` | Repo | The previous two increments: same method (local SQL script, labelled mock seed, read-only endpoint, view model, sample parity, trace) |

## Success measure
- For 3 seats, every fact, source line, date, count and preview figure on the Profile page can be traced to a row in `srp_cleanup`, recorded in `evidence.md` with independently written SQL and a deliberately wrong control that is caught.
- A fact that exists in an existing table is shown from there; a test proves no value is stored twice in `profile_facts`.
- Every fact row carries a source label and one of the five trust tiers (a CHECK in the database), and the page shows the source line from the row.
- The preview's rating, review count and profile strength equal Home's for the same seat (tested).
- The sample view (no real seat) is unchanged: the existing Profile tests and render tests pass unchanged, and the edit flows still change only browser state (a source guard proves the page makes no write).
- The endpoint reads only the signed-in user's own seat, writes nothing, and answers only a local sign-in token.
- Observe: a displayed fact that is neither a row nor computed from rows is a finding that becomes a new test.

## Open decisions touched
Listed, never resolved here:
- **O5 (completeness calibration):** "64% complete" is a stored mock percentage (Home's `profile_strength_pct`), not computed from the facts; the facts-based count ("N of 3 added") is a different, simpler figure.
- **Identity registry and the claim/identity ownership (`AGENTS.md` §5, unassigned):** the persona fields (name, title, email, phones) come from `users` and `tier_agents`; this increment takes no ownership position.
- **Trust tiers and provenance:** the five tiers are in `AGENTS.md`; which source labels earn which tier (for example "From NMLS" as `authority_verified`) is a mock mapping here and needs a ruling before any real write exists.
- **Licences and compliance:** NMLS is displayed (mortgage rule: display the NMLS ID); no rate or approval claim is shown. Server-side compliance applies when generated text is saved or published (out of scope: read-only).
- **The `srp_cleanup` schema name** and the real data sources (LinkedIn, Google, NMLS) remain unruled; the sources are mock labels.

## Out of scope
- Any write from the Profile: saving edits, approving the NORA bio draft, adding LinkedIn certifications, uploading a photo stay on-screen only; no POST route, no trust-tier or audit design.
- Changing the design, the layout, voice dictation or the edit sheets, or the sample view.
- Real data sources (LinkedIn, NMLS, Google), the real scorer, `public`, Supabase, an Alembic migration, and any change to an existing `srp_cleanup` table other than the seed correcting the mock values in the existing columns the page reads.
- The other sample pages (Insights, Web analytics, Connections, Network, Settings).
