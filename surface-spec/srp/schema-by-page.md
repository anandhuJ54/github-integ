# SRP database schema and tables, page by page

Surface: SRP (`surface-spec/srp`). Database: the **local** Postgres `v3_local`, schema `srp_cleanup`. Written 2026-10-27 from the live catalog (column lists, constraints and row counts below are generated from it, not typed by hand) and from the code that reads the tables.

**All data here is mock data** for local development. Nothing in this document touches Supabase or the `public` schema, and none of it is the product's real score or activity.

**How to read the status column**
- **Database** means the page shows values read from the tables through the API, with no demo number left.
- **Identity only** means the person's name, title, photo, email or phone come from the tables; everything else on the page is the prototype's sample data (the page carries a "Sample data" notice).
- **Sample** means no table feeds the page yet.

## 1. Pages at a glance

| Page (route under `/seat/professional/{id}`) | Status | Tables read today | API |
|---|---|---|---|
| **Home** (`/`, layouts Day 1, Day 7, Day 24) | Database | the 17 `home_*` tables, plus `tier_agents`, `users`, `tier_agent_details`, `voce_articles`, `website_analytics_data` | `GET /srp/seat/professional/{id}/home` |
| **SRS** (`/nora`; the SRS tab and the shell's NORA chat window open from it) | Database | `home_snapshots`, `home_snapshot_lanes`, `home_score_lanes` (with its new `short_name`), `home_score_bands`, `home_competitors`, `home_locked_features`, `home_plans`, `home_seat_state`, and the new `srs_lane_gaps`; `tier_agents` and `users` for ownership | `GET /srp/seat/professional/{id}/srs` |
| **Profile** (`/profile`) | Database | `tier_agents` and `users` (eight facts, as they are), `profile_facts` and `profile_graph_groups` (new), `home_snapshots` (rating, reviews, strength, city) | `GET /srp/seat/professional/{id}/profile` |
| **Web analytics** (`/website`, titled Website Analytics) | Database | `web_checks` (new); `home_snapshots`, `home_snapshot_lanes`, `home_score_lanes` (the gauge); `website_analytics_data` (address and last scan); `profile_facts` (address, company); `tier_agents` and `users` (name, phone) | `GET /srp/seat/professional/{id}/website` |
| **Settings** (`/settings`), **Find you** (`/find`), **Interview** (`/interview`) | Identity only | `tier_agents`, `users`, `tiers`, `tier_locations`, `locations`, `states`, and the legacy score rows (for the name, title, photo, email, phone, city and state) | `GET /srp/seat/professional/{id}` |
| **Insights** (`/insights`) | Database | `insights_visibility`, `insights_ai_engines`, `insights_competitor_positions`, `insights_spot_leaders` (new); `home_snapshots`, `home_map_cells`, `home_competitors`, `home_seat_state`, `home_plans`; `profile_facts` (the address); `tier_agents` and `users` (the seat's name) | `GET /srp/seat/professional/{id}/insights` |
| **Connections** (`/connections`) | Database | `connected_accounts` (new); `home_snapshots`, `home_snapshot_lanes`, `home_score_lanes` (the Google Business Profile line); `home_seat_state`, `home_plans` (the directories card); `tier_agents` and `users` for ownership | `GET /srp/seat/professional/{id}/connections` |
| **Network** | Sample | none | none |
| Listings, Reviews, Graph, Team, Reporting, Multi-post, `dashboard.*` | Not served for a local sign-in | none (these read other tables through routes that need a Supabase sign-in; a local token is not accepted there) | `/srp/seat/location/...`, `/srp/dashboard/...` |

Every professional seat is opened by its owner only: another user's seat answers 403 and the page shows the sample.

## APIs used by each page

All routes are under `/srp` on the FastAPI service. "Local OK" means a local sign-in token is accepted (ten routes only: `/srp/auth/me`, `/srp/rpc/{name}`, `/srp/seat/professional/{id}`, `/srp/seat/professional/{id}/home`, `/srp/seat/professional/{id}/srs`, `/srp/seat/professional/{id}/profile`, `/srp/seat/professional/{id}/insights`, `/srp/seat/professional/{id}/website`, `/srp/seat/professional/{id}/connections` and `/srp/seat/listings`); the others need a Supabase sign-in and answer 401 to a local token.

| Page | API calls | Local OK | Response notes |
|---|---|---|---|
| **Sign in** (`/sign-in`) | `POST /srp/auth/login`; then `GET /srp/auth/me` (user and landing seat) | yes | wrong password 401 |
| **Every seat page** (shared layout `seat/{kind}/{id}`) | `GET /srp/seat/professional/{id}`: name, title, photo, email, phone, office, city and state, legacy score | yes | another user's seat 403 (page falls back to the sample) |
| **Home** (`/`) | the layout call above, plus `GET /srp/seat/professional/{id}/home` | yes | 403 not your seat, 501 for a Supabase session, 503 database unavailable; any failure shows the sample page |
| **SRS** (`/nora`) | the layout call (and the Home call the shell reads for the trial banner), plus `GET /srp/seat/professional/{id}/srs` (made only on this route) | yes | 403 not your seat, 501 for a Supabase session, 503 database unavailable; any failure shows the sample page |
| **Profile** (`/profile`) | the layout call, plus `GET /srp/seat/professional/{id}/profile` (made only on this route) | yes | 403 not your seat, 501 for a Supabase session, 503 database unavailable; any failure shows the sample page; the page writes nothing |
| **Insights** (`/insights`) | the layout call, plus `GET /srp/seat/professional/{id}/insights` (made only on this route) | yes | 403 not your seat, 501 for a Supabase session, 503 database unavailable; any failure shows the sample page; the page writes nothing |
| **Web analytics** (`/website`) | the layout call, plus `GET /srp/seat/professional/{id}/website` (made only on this route) | yes | 403 not your seat, 501 for a Supabase session, 503 database unavailable; any failure shows the sample page; the page writes nothing |
| **Connections** (`/connections`) | the layout call, plus `GET /srp/seat/professional/{id}/connections` (made only on this route) | yes | 403 not your seat, 501 for a Supabase session, 503 database unavailable; any failure shows the sample page; the page writes nothing (Connect only changes what the browser shows) |
| **Settings**, **Find you**, **Network** | none of their own: the layout call (and the Home call, which the shell also reads for the trial banner and chips) | yes | |
| **Interview** (`/interview`) | the layout call, plus `GET /srp/interview/subject/{kind}/{id}`, `GET /srp/interview/claim/{id}` and the category-brief server function | no | needs a Supabase sign-in |
| **Listings** (`/listings`) | `GET /srp/seat/listings?entity_type&entity_id`, `POST /srp/rpc/exp_office_mode` | yes (a local session gets an empty list) | |
| **Team**, **Reporting**, **Graph**, **Multi-post** (location seats) | `GET /srp/seat/location/{id}` (a professional seat uses the professional read) | no | needs a Supabase sign-in |
| **Reviews**, dashboard routes (`/dashboard/...`) | `GET /srp/dashboard/me`, `/dashboard/home`, `/dashboard/content`, `/dashboard/listings`, `/dashboard/reviews` | no | needs a Supabase sign-in |

The contract for the Home, SRS, Profile, Insights, Web analytics and Connections calls is `contracts/srp/openapi.json` (`HomeResponse`, `SrsResponse`, `ProfileResponse`, `InsightsResponse`, `WebAnalyticsResponse`, `ConnectionsResponse`).

## 2. Home page

### 2.1 What on the page comes from which table

| On the page | Table and column(s) | Stored or computed |
|---|---|---|
| Greeting, name, photo | `users.first_name`, `users.last_name`; `tier_agents.profile_photo`, `tier_agents.title` | stored (account) |
| Header chip "Day N of M" and the trial banner day | `home_seat_state.trial_started_at`, `trial_days`; today's date | **computed**: day n = days since the trial start + 1, capped at M |
| Which layout (Day 1 / 7 / 24) | the same | **computed**: n below 7 is Day 1, 7 to 23 is Day 7, 24 and above is Day 24; `?day=7` or `?day=24` overrides it |
| Trial banner: locked list and points waiting | `home_locked_features` (title, plan), `home_plans.position`, `home_score_lanes.max_points`, `home_snapshot_lanes.points` | **computed**: features whose plan is above the seat's plan; waiting = lane maximum less the lane's points in the latest snapshot |
| Plan name and tag, the Compare-plans window | `home_plans` (key, name, tag, highlight, items), `home_seat_state.plan_id` | stored |
| Score (ring, "You 390") | `home_snapshots.total` (the latest by `as_of`) | stored |
| "OF 850" / "/ 850" | `home_score_lanes.max_points` summed | **computed** |
| Band name ("Building", "You're Established") and the marker "400 · Established" | `home_score_bands` (name, min_points) | **computed**: the band with the highest minimum not above the total; next band is the next minimum |
| "▲ N since you claimed" | `home_snapshots.total` less the total of `home_seat_state.claim_snapshot_id` | **computed** |
| "▲ N this week" | latest total less the newest snapshot at least 7 days older (else the earliest) | **computed** |
| Rank "#6 of 41 in Davenport" | `home_snapshots.rank_position`, `rank_of`, `rank_city` (latest) | stored |
| Rival ("Pass Riverbend"), rival score, "N points to #1" | `home_competitors` (name, score, position, review_count, review_avg, article_count) | **computed**: the best-scoring competitor if they outscore the seat; gap = their score less the seat's total |
| "5 competitors" | `home_competitors` | computed (count) |
| NORA's board: task in progress or just finished, the done list and count, "+N points" | `home_activity` (label, points, status, started_at, completed_at) | **computed** from the rows: latest by finish or start time; count and sum of the done ones |
| Up next cards | `home_next_moves` (position, icon, title, subtitle, recommended, target, points) | stored |
| "N of 3 moves this week", streak | `home_seat_state.moves_done`, `moves_goal`, `streak_weeks` | stored |
| Needs you (count and cards), compliance chip | `home_review_drafts` (status, reviewer_label, rating, review_text, draft_text, compliance_status) | count **computed** (drafts with status `draft`) |
| Top-3 map spots "9 of 49" and the mini map | `home_map_cells` (row_no, col_no, rank) of the latest snapshot; `home_snapshots.map_scanned_at` | **computed** (top 3 = rank 1 to 3; total = number of cells) |
| AI citations "1 of 7", last check | `home_snapshots.ai_cited`, `ai_checked`, `ai_checked_at` | stored |
| Reviews "4.9 from 128 reviews" | `home_snapshots.review_avg`, `review_count` | stored |
| Profile strength "64%", "up from 64%" | `home_snapshots.profile_strength_pct` (latest and the week-ago snapshot) | stored (the rule is open decision O5) |
| Website score | `website_analytics_data.total_score` (newest by `last_refreshed_time`); maximum from the `website` lane | stored (existing table) |
| Articles published | `voce_articles` (published, not archived) | stored (existing table) |
| Locked-feature cards and "N points are waiting" | `home_locked_features` and the lanes (as above) | **computed** |
| "Loan officers like you" panel | `home_peer_benchmarks` for the band of the seat's first snapshot | stored |
| Weekly brief (Up N this week, items, next move) | `home_weekly_briefs`, `home_weekly_brief_items` | total **computed** (sum of items) |
| "While you were away" | `home_weekly_briefs.away_new_reviews`, `away_bio_live`, `away_first_article` | text composed in the UI |
| Event banners (2★ review, Facebook) | `home_events` (kind, title, body, action_label, expires_at) | stored; expired ones are not shown |
| NORA's "what I think" cards | `home_nora_insights` | stored |
| Day 24 recap (things done, score and rank and profile from/to) | first and latest `home_snapshots`; `home_activity` | **computed**: from the first to the latest snapshot; rank delta counts a lower number as better |
| Start-year picker | `tier_agents.year_started` | stored |
| Credentials count | `tier_agent_details.certifications` (array length) | computed |

The notice above the page says the values are mock data (`home_seat_state.is_mock`).

### 2.2 How the Home is served
- Backend: `surface-api/srp/src/seat/home.py` (one read-only transaction, ownership check first), `schemas.py` (`HomeResponse`), `router.py`; contract in `contracts/srp/openapi.json`.
- Frontend: `surface-ui/srp/src/utils/home-model.ts` (API to view model), `components/happyflow/home-page.tsx` (layout choice and notice), `screens/home-day1.tsx`, `screens/home-day7.tsx`, `shell.tsx` (trial banner, plans, upgrade and recap windows).
- Seed: `surface-api/srp/src/seat/seed_home.py` and `seed_home_plan.py` (40 seats, relative to the `--as-of` date, with a mandatory backup).
- DDL: `surface-api/srp/db/local/home_schema.sql`, then `home_schema_hardening.sql` (unique keys, claim snapshot of the same seat, lane maximum, lane total).

## 3. SRS page

The SRS page keeps the **SRS v5** scoring (850 points, the 10 lanes in `home_score_lanes`). It adds one table (`srs_lane_gaps`) and one column (`home_score_lanes.short_name`); no second score store. The legacy `srs_config_*`, `user_search_rank_scores` and `ai_authority_stats` are not read by this page and were not changed.

### 3.1 What on the page comes from which table

| On the page | Table and column | Computed how |
|---|---|---|
| Score ring, count-up, "YOUR SCORE · OF 850" | `home_snapshots.total` of the newest snapshot; the maximum is the sum of `home_score_lanes.max_points` | sum of lane budgets |
| Band pill and "N points to <next band>" | `home_score_bands` (highest minimum not above the total, and the next one) | next minimum minus total; "1 point" when one |
| "#6 of 41 in <city>" | `home_snapshots.rank_position`, `rank_of`, `rank_city` | none |
| Band bar (fill, marker, labels) | total, maximum, next band minimum | fill = total / max, marker = next minimum / max |
| Target card: rival, its score, "#1 in <city> · 4.7 from 412 reviews" | `home_competitors` (the best-scoring competitor who outscores the seat): `name`, `score`, `review_avg`, `review_count` | none |
| Race bars, "N points to #1" | total, rival score | you = total / rival score (at most 100%); gap = rival score minus total |
| "N points open across 10 lanes" | the maximum and the total | maximum minus total |
| The 10 lane rows: label | `home_score_lanes.short_name`, else `name` | none |
| earned / max, "N open", the bar | `home_snapshot_lanes.points` of the newest snapshot, `home_score_lanes.max_points` | open = max minus earned |
| "you vs rival" text, note | `srs_lane_gaps.you_text`, `rival_text`, `note` | "you vs rival; note" |
| Status (Missing, Fix, Locked, Strong) | `srs_lane_gaps.is_missing`; `home_locked_features` (lane, plan) with the seat's `home_plans` position; earned and max | Strong from 3/4 of the budget, else Missing if flagged, else locked if behind a higher plan, else Fix |
| Action button | `srs_lane_gaps.action_label`, `action_target` | none (hidden when there is no label) |
| Lane order, filter counts | all of the above | open points descending, ties by lane position; counts by status (locked counts as Fix) |
| The biggest-gap callout and NORA's notes | the lane rows and the rival | templates over those rows (notes are not drawn while the NORA chat UI is switched off) |
| "How your score is calculated" | the same numbers | none |

### 3.2 How the SRS is served

- API: `GET /srp/seat/professional/{id}/srs` (`surface-api/srp/src/seat/srs.py`): own seat only (403 first), read-only transaction, `SELECT` only; shares the band, rank and rival code with the Home read, so the two pages agree for a seat. A lane with no points in the snapshot is unknown (`null`), never 0.
- UI: `utils/srs-model.ts` (`srsModel`), `components/happyflow/sample-srs.ts` (the prototype's sample as a model), `srs-context.tsx`, `srs-page.tsx`, and `screens/srs.tsx` reading the model. With no real seat, or on any failure, the sample page is shown, unchanged.
- Seed: the same `seed_home.py` / `seed_home_plan.py` (400 gap rows for 40 seats, relative to the `--as-of` date, with a mandatory backup).
- DDL: `surface-api/srp/db/local/srs_schema.sql` (after `home_schema.sql` and `home_schema_hardening.sql`).

The seat read (`GET /srp/seat/professional/{id}`) still returns the **legacy 29-point score** (the sum of the newest `user_search_rank_scores.srs_category_score` per category in `srs_config_categories`); it is not SRS v5 and the Happyflow pages do not display it.

## 4. Profile page

The Profile page is read-only: it shows the facts from the database, and its edit flows (typing or dictating a note, Review changes, NORA's bio draft) change only what the browser shows, kept under a per-seat key (`hf-demo-profile:{id}`). Eight facts are read from the existing tables as they are; ten live in `profile_facts`, which also holds the source, trust tier and date of every fact.

### 4.1 What on the page comes from which table

| On the page | Table and column | Computed how |
|---|---|---|
| Name | `users.first_name` + `last_name` | joined; missing when both blank |
| Title, photo, bio, year started | `tier_agents.title`, `profile_photo`, `description`, `year_started` | present when not blank |
| Office phone, mobile | `tier_agents.phone_number`, `mobile_number` | shown as `(563) 555-0100` |
| Email | `users.email` | none |
| Address, hours, NMLS, licensed in, service areas, designations, awards, education, company | `profile_facts.value` (a string) | present when the row has a non-blank value |
| Loan products, "N loan products", the chips | `profile_facts.value` for `products` (a list of strings) | first five chips, `+N` for more |
| Each fact's source line ("Confirmed by you · Oct 16") | `profile_facts.source`, `confirmed_at` | label, plus ` · Mon D` when there is a date |
| The green source dot | `profile_facts.trust_tier` | green for `owner_verified` and `authority_verified` |
| Rating, review count, "58% complete", market city | newest `home_snapshots`: `review_avg`, `review_count`, `profile_strength_pct`, `rank_city` | the same rows Home reads; unknown shows nothing, never 0 |
| "N of 3 added" | designations, awards, education present | count |
| "N facts from M sources", the six bars | `profile_graph_groups.facts` | sum, and groups above 0 |
| NORA's bio draft | the facts | a fixed template (name, market city, years since `year_started`, first two products), offered when the bio is missing or under 60 characters |
| Photo (no photo) | `tier_agents.profile_photo` | initials; the sample photo is never shown for a real seat |

### 4.2 How the Profile is served

- API: `GET /srp/seat/professional/{id}/profile` (`surface-api/srp/src/seat/profile.py`): own seat only (403 first), read-only transaction, `SELECT` only; an existing-table fact with a blank column is missing even if a source row exists; an own fact with no row is missing.
- UI: `utils/profile-model.ts` (`profileModel`), `components/happyflow/sample-profile.ts` (the prototype's sample as a model), `profile-context.tsx`, `profile-page.tsx`, and `screens/profile.tsx` reading the model. With no real seat, or on any failure, the sample page is shown, unchanged.
- Seed: `seed_home.py` with `seed_profile_plan.py` (564 fact rows and 240 group rows for 40 seats, relative to `--as-of`, with a mandatory backup); it also corrects the mock `title`, `description`, `phone_number`, `mobile_number` and `profile_photo` of the seeded seats.
- DDL: `surface-api/srp/db/local/profile_schema.sql` (after the Home and SRS scripts).

## 4b. Settings, Find you, Interview

These show the person's identity from the seat read and the prototype's sample content for everything else.

| Identity shown | Table and column |
|---|---|
| Name | `users.first_name`, `users.last_name` |
| Title / headline / bio | `tier_agents.title`, `tag_line`, `description` |
| Photo | `tier_agents.profile_photo` |
| Email, phone | `users.email`, `tier_agents.phone_number` |
| Public slug | `tier_agents.slug` |
| Office name | `tiers.name` via `tier_agents.tier_id` |
| City, state | `locations.city`, `states.code` via `tier_locations` (the first location of the tier) |

The Interview page also loads its subject and brief through `/srp/interview/...` routes that need a Supabase sign-in; they do not work with a local sign-in.

Everything else on those pages (interview answers, the NORA chat answers) is sample data today, with no table behind it. (The website audit is the Web analytics page, section 5c.)

## 5. Insights page

The Insights page is read-only: it shows the seat's visibility figures, map, AI citations and competitors from the database. The yes/no question, "Add a competitor", the tab switches and the selected map spot change only what the browser shows. Averages, totals, the table order, the locked cards and NORA's two notes are computed from the stored rows, never stored.

### 5.1 What on the page comes from which table

| On the page | Table and column | Computed how |
|---|---|---|
| The six figures (Search views, Maps views, Calls, Directions, Website clicks, Experience.com profile views) | `insights_visibility.value` | thousands separators; a metric with no row is not drawn (never 0) |
| "Last 30 days · From Google" under each figure | `insights_visibility.period_days`, `source` | text |
| "Map rank around 100 Main St" | `profile_facts.value` for `address` | the street before the first comma; "your office" when there is no address |
| "One-time scan · Oct 16" | newest `home_snapshots.map_scanned_at` | "Mon D"; left out when null |
| The 49 coloured spots | newest snapshot's `home_map_cells.rank` | green 1 to 3, yellow 4 to 10, orange 11 to 20, red beyond or no rank; the centre is the office pin |
| "You're #N here" and the spot's top 3 | `insights_spot_leaders` (`position`, `name`, `is_you`) | "You" for the seat; the same rows Home's rank implies (a spot ranked 1 to 3 has "You" at that place) |
| "Top 3 in 9 · 4–10 in 17 · 11–20 in 14 · 20+ in 9" | `home_map_cells.rank` | counts per band |
| "Named in 1 of 7 answers" | `insights_ai_engines.cited`, `checked` | the sums; equal Home's `ai_cited` and `ai_checked` |
| Each engine row ("ChatGPT 1 of 3" and its note) | `insights_ai_engines` | engine order ChatGPT, Gemini, Perplexity |
| The competitor table (rank, name, rating, avg map) | `home_competitors` (name, rating, reviews), `insights_competitor_positions.avg_position`, newest `home_snapshots` (the seat's rating and reviews) and its 49 ranks (the seat's average) | the seat's average is the mean of its ranks with "20+" as 21, rounded half up to one decimal; sorted by average, unknown last, rivals before the seat on a tie; unknown shows a dash |
| "Is Riverbend Bank & Trust who you lose deals to?" | `home_competitors.is_market_leader` | the market leader's name; with none the page asks who the seat loses deals to |
| The two locked cards | `home_seat_state` and `home_plans` | shown when the seat's plan is below the top plan; the first names the market leader's first word |
| NORA's two notes | `home_competitors` (leader's reviews and articles), the seat's rating, `insights_ai_engines` | templates over the stored numbers: "{Leader} wins on volume." (only when both review counts are known and the leader's is higher; otherwise "{Leader} is your top rival.") and the engine with the lowest share |

### 5.2 How the Insights page is served

- API: `GET /srp/seat/professional/{id}/insights` (`surface-api/srp/src/seat/insights.py`): own seat only (403 first), read-only transaction, `SELECT` only; a seat with no row in any of the four tables is `ready: false` with every section null.
- UI: `utils/insights-model.ts` (`insightsModel`), `components/happyflow/sample-insights.ts` (the prototype's sample as a model), `insights-context.tsx`, `insights-page.tsx`, and `screens/insights.tsx` reading the model. With no real seat, or on any failure, the sample page is shown, unchanged.
- Seed: `seed_home.py` with `seed_insights_plan.py` (233 visibility, 120 engine, 200 position and 5,880 leader rows for 40 seats), written after the Home rows because it reads them, with a mandatory backup.
- DDL: `surface-api/srp/db/local/insights_schema.sql` (after the Home, SRS and Profile scripts).

## 5b. Network
A sample page. No table feeds it.

## 5c. Web analytics page

The Web analytics page ("Website Analytics", `/website`) is read-only: it shows the seat's audit from the database. Re-check (a progress bar), Send to my webmaster, Copy code, the hand-off steps and the filters change only what the browser shows; nothing is fetched or sent. The gauge, the points text, the counts, the tiles, the top fix, the snippet and NORA's two notes are computed from the stored rows and the other pages' tables, never stored.

### 5c.1 What on the page comes from which table

| On the page | Table and column | Computed how |
|---|---|---|
| The address under the title | `website_analytics_data.website_url` (newest row) | the scheme and a trailing slash removed; none gives no line |
| "Last checked Oct 16" | `website_analytics_data.last_refreshed_time` | "Mon D"; none gives "Not checked yet" |
| Site health "N of 102" | the seat's `website` lane in its newest `home_snapshots` (`home_snapshot_lanes.points`, `home_score_lanes.max_points`) | none when there is no snapshot or lane row; equals the SRS page's website lane and Home's Website tile |
| The ten check rows (label, result, state colour and icon) | `web_checks.check_key`, `result`, `state` | the page's order and labels |
| The points text ("+42 open", "30 of 30", "Pass", "—") | `web_checks.points`, `points_max`, `state` | markup shows `+N open` while points are open; other scored checks `earned of max`; unscored `Pass` or a dash |
| The filter pills (All, Failing, Needs work, Passing) and their counts | `web_checks.state` | counts |
| The three tiles (Speed, Markup, AI readiness) | the `speed` and `ai_readiness` rows (`headline`, `state`) and the `entity_markup` row | Markup shows Missing, Partial or Complete and `+N open` |
| "Top fix · +N points" and the code block | the `entity_markup` row and the Profile (`users` name, `profile_facts` company and address, `tier_agents.phone_number`) | shown while markup is not passing; the snippet is a JSON-LD template, JSON-escaped, missing parts left out |
| NORA's two notes | the `entity_markup` and `ai_readiness` rows | "Markup is worth N points." and "AI can't read your page yet." (the check's own result line) |

Cross-page rules the seed keeps (each tested on the written rows): the four scored checks add up to the website lane; name, address and phone is 10 points for each of name, address and phone in the Profile; the SRS website gap text and Home's "Fix my website" move text follow the markup points; the content check follows the published articles Home shows; a failing service-pages result names only the seat's own products.

### 5c.2 How the Web analytics page is served

- API: `GET /srp/seat/professional/{id}/website` (`surface-api/srp/src/seat/web_analytics.py`): own seat only (403 first), read-only transaction, `SELECT` only; a seat with no `web_checks` row is `ready: false` with every section null.
- UI: `utils/web-analytics-model.ts` (`webAnalyticsModel`), `components/happyflow/sample-web-analytics.ts` (the prototype's sample as a model), `web-analytics-context.tsx`, `web-analytics-page.tsx`, and `screens/website.tsx` reading the model. With no real seat, or on any failure, the sample page is shown, unchanged.
- Seed: `seed_home.py` with `seed_web_plan.py` (400 rows for 40 seats), built from the Home and Profile plans, with a mandatory backup. It also corrects three existing mock values: `website_analytics_data.total_score` (to the lane), the `website` row of `srs_lane_gaps` and the `website` move of `home_next_moves` (to the markup state).
- DDL: `surface-api/srp/db/local/web_analytics_schema.sql` (after the Home, SRS, Profile and Insights scripts).

## 5d. Connections page

The Connections page (`/connections`) is read-only: it shows which accounts NORA can use for the seat, and what each powers. Connect (the card buttons and NORA's two notes) changes only what the browser shows ("Connected just now", the header count); nothing is signed in, fetched or stored, and no token or secret exists anywhere. The status lines, the powers lines, the summary, the suggestions, the notes and the directories card are computed from the stored rows and the other pages' tables, never stored.

### 5d.1 What on the page comes from which table

| On the page | Table and column | Computed how |
|---|---|---|
| The eleven cards (name, round badge, colour) | `connected_accounts.provider` | the page's order, names, monograms and colours (fixed per account); an account with no row has no card |
| A card's pill and its Connect button | `connected_accounts.state` | `connected` Connected, `matched` Matched, `partial` Partial, `available` shows Connect |
| The status line under a card | `connected_accounts.state`, `synced_at` | Google Business Profile "Connected · synced Oct 24"; YouTube "Connected through Google"; other connected "Connected"; Search Console not connected "Part of the Google sign-in, not yet granted"; matched "Matched, no sign-in needed"; partial "Match found · replies need Yelp's partner access" |
| What each account powers | fixed text per account; Google Business Profile: the seat's `gbp` lane in its newest `home_snapshots` (`home_snapshot_lanes.points`, `home_score_lanes.max_points`) | "GBP lane (68 of 68), hours, photos, reviews"; the numbers are left out when the lane is unknown, never 0; equals the SRS page's GBP lane |
| "N connected, M matched." | `connected_accounts.state` | connected count; matched plus partial count (the page adds the browser's Connect clicks to the first number) |
| The second sentence of the header and NORA's notes | `connected_accounts.state` of Search Console and Website / CMS | both unconnected: the prototype's sentence and two notes; one: "Connect X and I can ..." and one note; none: no sentence and no notes |
| The directories card | `home_seat_state.plan_id`, `home_plans.key` | shown for the `core` plan only; none for engage, amplify or an unknown plan |

Cross-page rules the seed keeps (each tested on the written rows and on the live data): Google Business Profile is connected for every seat and synced within 7 days of the day; YouTube and Search Console only beside it, and YouTube wherever the SRS Videos lane has a video; LinkedIn wherever the Profile has a fact "From LinkedIn"; the connected social accounts (Facebook, Instagram, LinkedIn, X) equal the SRS Connections lane's "you" count; the Web analytics Indexing source is "From Google Search Console" only for a seat whose Search Console is connected.

### 5d.2 How the Connections page is served

- API: `GET /srp/seat/professional/{id}/connections` (`surface-api/srp/src/seat/connections.py`): own seat only (403 first), read-only transaction, `SELECT` only; a seat with no `connected_accounts` row is `ready: false` with every section null.
- UI: `utils/connections-model.ts` (`connectionsModel`), `components/happyflow/sample-connections.ts` (the prototype's sample as a model), `connections-context.tsx`, `connections-page.tsx`, and `screens/connections.tsx` reading the model. With no real seat, or on any failure, the sample page is shown, unchanged.
- Seed: `seed_home.py` with `seed_connections_plan.py` (440 rows for 40 seats), built from the Home and Profile plans, with a mandatory backup. It also corrects two existing mock values: the Indexing source and tier of `web_checks` (14 of 40 seats now say "From your site scan") and the `connections` row of `srs_lane_gaps` (12 seats said 0 connected accounts; the gap to the rival text is kept).
- DDL: `surface-api/srp/db/local/connections_schema.sql` (after the Home, SRS, Profile, Insights and Web analytics scripts).

## 6. Pages not served for the local sign-in
Listings, Reviews, Graph, Team, Reporting, Multi-post and the `dashboard.*` routes read other tables through routes that need a Supabase sign-in; the local sign-in token is not accepted there. They are outside this schema.

## 7. Table reference

### 7.1 The Home tables (created by `home_schema.sql`, hardened by `home_schema_hardening.sql`)
All in schema `srp_cleanup`. No row-level security. Access by grants only: `v3_app` has select, insert, update and delete; nothing for anon, authenticated or PUBLIC. Row counts are today's.


#### `home_score_lanes` (10 rows)

SRS v5 shaped score lanes (reference data): 10 lanes whose maximums sum to 850. Mock until a real source is ruled.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `key` | character varying(40) | no | Stable lane key, for example reviews. |
| `name` | character varying(80) | no | Lane name shown to people. |
| `max_points` | integer | no | Most points the lane can give. |
| `position` | integer | no | Display order. |
| `short_name` | character varying(24) | yes | Short label for the SRS page (GBP, Q&A); null means the page uses name. (Added by `srs_schema.sql`.) |

Rules:
- `ck_home_score_lanes_max`: CHECK ((max_points >= 0))
- `uq_home_score_lanes_key`: UNIQUE (key)
- trigger `trg_home_lane_max_check`

#### `home_score_bands` (4 rows)

Score bands (reference data). Thresholds are mock placeholders awaiting a ruling.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `name` | character varying(40) | no | Band name, for example Established. |
| `min_points` | integer | no | Lowest total that is in the band. |
| `position` | integer | no | Order from lowest to highest band. |

Rules:
- `ck_home_score_bands_min`: CHECK (((min_points >= 0) AND (min_points <= 850)))
- `uq_home_score_bands_min_points`: UNIQUE (min_points)

#### `home_plans` (3 rows)

Plans offered in the Compare-plans window (reference data, mock). Position orders them from the free plan up.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `key` | character varying(20) | no | Stable plan key, for example core. |
| `name` | character varying(40) | no | Plan name. |
| `tag` | character varying(40) | yes | Short tag, for example Free. |
| `position` | integer | no | Order from lowest plan to highest; a feature is locked when its plan is above the seat's plan. |
| `highlight` | boolean | no | Whether the plan is the highlighted one. |
| `items` | jsonb | no | List of the plan's bullet points shown in the window. |

Rules:
- `uq_home_plans_key`: UNIQUE (key)

#### `home_peer_benchmarks` (3 rows)

Peer benchmark for the 'like you' panel: how people who started in a band moved (reference data, mock).

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `band_id` | bigint | no | The band the cohort started in. |
| `median_gain` | integer | no | Median points gained over the horizon. |
| `horizon_days` | integer | no | Length of the window in days. |
| `cohort_size` | integer | no | How many people the figure is based on. |
| `cohort_period` | character varying(40) | no | When the cohort started, for example Jan-Sep 2026. |
| `reached_next_band` | integer | no | How many of cohort_of reached the next band. |
| `cohort_of` | integer | no | The 'of N' used with reached_next_band. |

Rules:
- `ck_home_peer_benchmarks_reached`: CHECK ((reached_next_band <= cohort_of))
- `fk_home_peer_benchmarks_band_id`: FOREIGN KEY (band_id) REFERENCES home_score_bands(id)
- `uq_home_peer_benchmarks_band`: UNIQUE (band_id)

#### `home_snapshots` (122 rows)

A seat's Home numbers at one moment: score total, band, market rank, profile strength, reviews, map scan and AI check dates. Newest wins; the earliest is the claim baseline.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `as_of` | timestamp without time zone | no | When the numbers were taken (UTC). |
| `total` | integer | no | Score total out of 850. |
| `band_id` | bigint | yes | Band label stored for readers; the Home computes the band from total. |
| `rank_position` | integer | yes | Place in the market, 1 is first. |
| `rank_of` | integer | yes | Number of people in the market. |
| `rank_city` | character varying(120) | yes | City of the market, for display. |
| `profile_strength_pct` | integer | yes | Profile strength percentage (mock; the rule is an open decision). |
| `review_avg` | numeric(2,1) | yes | Average review rating. |
| `review_count` | integer | yes | Number of reviews. |
| `map_scanned_at` | timestamp without time zone | yes | When the map was last scanned. |
| `ai_cited` | integer | yes | In how many checked AI answers the seat was named. |
| `ai_checked` | integer | yes | How many AI answers were checked. |
| `ai_checked_at` | timestamp without time zone | yes | When the AI answers were last checked. |
| `created_at` | timestamp without time zone | no | When the row was written (UTC). |
| `updated_at` | timestamp without time zone | no | When the row was last changed (UTC). |

Rules:
- `ck_home_snapshots_ai`: CHECK (((ai_cited >= 0) AND ((ai_checked IS NULL) OR (ai_cited <= ai_checked))))
- `ck_home_snapshots_profile_strength`: CHECK (((profile_strength_pct >= 0) AND (profile_strength_pct <= 100)))
- `ck_home_snapshots_rank`: CHECK (((rank_position >= 1) AND ((rank_of IS NULL) OR (rank_position <= rank_of))))
- `ck_home_snapshots_review_avg`: CHECK (((review_avg >= (0)::numeric) AND (review_avg <= (5)::numeric)))
- `ck_home_snapshots_review_count`: CHECK ((review_count >= 0))
- `ck_home_snapshots_total`: CHECK (((total >= 0) AND (total <= 850)))
- `fk_home_snapshots_band_id`: FOREIGN KEY (band_id) REFERENCES home_score_bands(id)
- `fk_home_snapshots_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_snapshots_id_seat`: UNIQUE (id, tier_agent_id)
- `uq_home_snapshots_seat_as_of`: UNIQUE (tier_agent_id, as_of)
- trigger `trg_home_snapshot_sum_total`

#### `home_snapshot_lanes` (1220 rows)

Points a snapshot earned in each score lane; they sum to the snapshot total.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `snapshot_id` | bigint | no | The snapshot. |
| `lane_id` | bigint | no | The lane. |
| `points` | integer | no | Points earned in the lane. |

Rules:
- `ck_home_snapshot_lanes_points`: CHECK ((points >= 0))
- `fk_home_snapshot_lanes_lane_id`: FOREIGN KEY (lane_id) REFERENCES home_score_lanes(id)
- `fk_home_snapshot_lanes_snapshot_id`: FOREIGN KEY (snapshot_id) REFERENCES home_snapshots(id) ON DELETE CASCADE
- `uq_home_snapshot_lanes_snapshot_lane`: UNIQUE (snapshot_id, lane_id)
- trigger `trg_home_snapshot_lane_check`
- trigger `trg_home_snapshot_sum_lanes`

#### `home_map_cells` (1960 rows)

The 7 by 7 mini map of one snapshot: the seat's rank in each cell (null means 20+).

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `snapshot_id` | bigint | no | The snapshot. |
| `row_no` | smallint | no | Row, 0 to 6 from the top. |
| `col_no` | smallint | no | Column, 0 to 6 from the left. |
| `rank` | integer | yes | Rank in the cell; null means 20 or lower. |

Rules:
- `ck_home_map_cells_col`: CHECK (((col_no >= 0) AND (col_no <= 6)))
- `ck_home_map_cells_rank`: CHECK ((rank >= 1))
- `ck_home_map_cells_row`: CHECK (((row_no >= 0) AND (row_no <= 6)))
- `fk_home_map_cells_snapshot_id`: FOREIGN KEY (snapshot_id) REFERENCES home_snapshots(id) ON DELETE CASCADE
- `uq_home_map_cells_snapshot_cell`: UNIQUE (snapshot_id, row_no, col_no)

#### `home_seat_state` (40 rows)

One row per seat: plan, trial dates, weekly moves, streak, claim baseline. is_mock says the Home data for the seat is mock.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `plan_id` | bigint | no | The seat's plan. |
| `trial_started_at` | timestamp without time zone | no | When the trial started (UTC); the Home day number counts from here. |
| `trial_days` | integer | no | Length of the trial in days. |
| `moves_done` | integer | no | Moves finished this week. |
| `moves_goal` | integer | no | Moves planned this week. |
| `streak_weeks` | integer | no | Consecutive weeks with the moves done. |
| `nora_text_day` | character varying(40) | yes | Day and time NORA texts the person, for example Tuesday early morning. |
| `claim_snapshot_id` | bigint | yes | The snapshot taken when the profile was claimed (the 'since you claimed' baseline). |
| `is_mock` | boolean | no | True when this seat's Home data is mock data. |
| `created_at` | timestamp without time zone | no | When the row was written (UTC). |
| `updated_at` | timestamp without time zone | no | When the row was last changed (UTC). |

Rules:
- `ck_home_seat_state_moves`: CHECK (((moves_done >= 0) AND (moves_goal >= 0) AND (streak_weeks >= 0)))
- `ck_home_seat_state_trial_days`: CHECK ((trial_days > 0))
- `fk_home_seat_state_claim_same_seat`: FOREIGN KEY (claim_snapshot_id, tier_agent_id) REFERENCES home_snapshots(id, tier_agent_id) ON DELETE SET NULL (claim_snapshot_id)
- `fk_home_seat_state_plan_id`: FOREIGN KEY (plan_id) REFERENCES home_plans(id)
- `fk_home_seat_state_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_seat_state_tier_agent_id`: UNIQUE (tier_agent_id)

#### `home_competitors` (200 rows)

Competitors in the seat's market, with the market leader flagged.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `name` | character varying(160) | no | Business name. |
| `score` | integer | no | Competitor's score out of 850. |
| `is_market_leader` | boolean | no | True for the leader of the market. |
| `review_count` | integer | yes | Number of reviews. |
| `review_avg` | numeric(2,1) | yes | Average review rating. |
| `article_count` | integer | yes | Number of published articles. |
| `position` | integer | no | Order in the list. |

Rules:
- `ck_home_competitors_score`: CHECK (((score >= 0) AND (score <= 850)))
- `fk_home_competitors_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_competitors_id_seat`: UNIQUE (id, tier_agent_id) (added by `insights_schema.sql`, so a competitor position cannot name another seat's rival)
- `uq_home_competitors_seat_position`: UNIQUE (tier_agent_id, "position")

#### `home_activity` (322 rows)

What NORA did for the seat: one doing or done item per row. The latest done item feeds 'Just finished'.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `label` | character varying(200) | no | What was done. |
| `points` | integer | yes | Points gained; null when none are shown. |
| `status` | character varying(10) | no | doing or done. |
| `started_at` | timestamp without time zone | yes | When the work started (UTC). |
| `completed_at` | timestamp without time zone | yes | When the work finished (UTC). |
| `created_at` | timestamp without time zone | no | When the row was written (UTC). |

Rules:
- `ck_home_activity_status`: CHECK (((status)::text = ANY ((ARRAY['doing'::character varying, 'done'::character varying])::text[])))
- `fk_home_activity_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_activity_seat_label`: UNIQUE (tier_agent_id, label)

#### `home_next_moves` (120 rows)

The 'Up next' cards on NORA's board.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `position` | integer | no | Order on the board. |
| `icon` | character varying(30) | no | Icon name. |
| `title` | character varying(120) | no | Card title. |
| `subtitle` | character varying(300) | yes | Card text. |
| `recommended` | boolean | no | Shows the NORA recommends badge. |
| `target` | character varying(20) | no | Where the card leads: voce, website or profile. |
| `points` | integer | yes | Points the move is worth; null when not shown. |

Rules:
- `ck_home_next_moves_target`: CHECK (((target)::text = ANY ((ARRAY['voce'::character varying, 'website'::character varying, 'profile'::character varying])::text[])))
- `fk_home_next_moves_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_next_moves_seat_position`: UNIQUE (tier_agent_id, "position")

#### `home_locked_features` (120 rows)

Features locked for the seat's plan. Points waiting are computed from the lane when there is one.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `feature_key` | character varying(40) | no | Stable feature key, for example listings. |
| `title` | character varying(80) | no | Feature name. |
| `description` | character varying(300) | yes | Card text. |
| `lane_id` | bigint | yes | The score lane whose unearned points are waiting; null shows no points. |
| `plan_id` | bigint | no | The plan that unlocks the feature. |

Rules:
- `fk_home_locked_features_lane_id`: FOREIGN KEY (lane_id) REFERENCES home_score_lanes(id)
- `fk_home_locked_features_plan_id`: FOREIGN KEY (plan_id) REFERENCES home_plans(id)
- `fk_home_locked_features_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_locked_features_seat_feature`: UNIQUE (tier_agent_id, feature_key)

#### `home_weekly_briefs` (40 rows)

The weekly brief and the 'while you were away' summary for a seat and week.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `week_start` | timestamp without time zone | no | Start of the week (UTC). |
| `next_move_label` | character varying(120) | yes | The suggested next move. |
| `next_move_points` | integer | yes | Points the next move is worth. |
| `next_move_target` | character varying(20) | yes | Where the next move leads: voce, website or profile. |
| `away_new_reviews` | integer | no | New reviews while the person was away. |
| `away_bio_live` | boolean | no | Whether the bio went live. |
| `away_first_article` | boolean | no | Whether the first article was published. |

Rules:
- `ck_home_weekly_briefs_reviews`: CHECK ((away_new_reviews >= 0))
- `ck_home_weekly_briefs_target`: CHECK (((next_move_target)::text = ANY ((ARRAY['voce'::character varying, 'website'::character varying, 'profile'::character varying])::text[])))
- `fk_home_weekly_briefs_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_weekly_briefs_seat_week`: UNIQUE (tier_agent_id, week_start)

#### `home_weekly_brief_items` (153 rows)

Lines of a weekly brief, each with its points.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `brief_id` | bigint | no | The brief. |
| `position` | integer | no | Order in the brief. |
| `label` | character varying(160) | no | What happened. |
| `points` | integer | yes | Points it gave. |

Rules:
- `fk_home_weekly_brief_items_brief_id`: FOREIGN KEY (brief_id) REFERENCES home_weekly_briefs(id) ON DELETE CASCADE
- `uq_home_weekly_brief_items_brief_position`: UNIQUE (brief_id, "position")

#### `home_review_drafts` (98 rows)

Review replies NORA drafted for the person to approve. Mock text; nothing is posted from here.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `reviewer_label` | character varying(80) | no | Generic reviewer label (mock), never a real name. |
| `rating` | smallint | no | Stars, 1 to 5. |
| `review_text` | text | no | The review. |
| `draft_text` | text | no | NORA's drafted reply. |
| `compliance_status` | character varying(12) | no | passed or needs_edit; set by the server-side compliance check. |
| `status` | character varying(10) | no | draft, approved or posted. |
| `created_at` | timestamp without time zone | no | When the row was written (UTC). |

Rules:
- `ck_home_review_drafts_compliance`: CHECK (((compliance_status)::text = ANY ((ARRAY['passed'::character varying, 'needs_edit'::character varying])::text[])))
- `ck_home_review_drafts_rating`: CHECK (((rating >= 1) AND (rating <= 5)))
- `ck_home_review_drafts_status`: CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'posted'::character varying])::text[])))
- `fk_home_review_drafts_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)

#### `home_events` (18 rows)

Banners on the Home: a review that needs the person, or a connection about to expire.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `kind` | character varying(12) | no | review or facebook. |
| `title` | character varying(160) | no | Banner title. |
| `body` | character varying(300) | yes | Banner text. |
| `action_label` | character varying(40) | yes | Button text. |
| `expires_at` | timestamp without time zone | yes | When the event expires (UTC). |
| `created_at` | timestamp without time zone | no | When the row was written (UTC). |

Rules:
- `ck_home_events_kind`: CHECK (((kind)::text = ANY ((ARRAY['review'::character varying, 'facebook'::character varying])::text[])))
- `fk_home_events_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)

#### `home_nora_insights` (120 rows)

NORA's 'what I think' cards: stored mock text, not generated here.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `position` | integer | no | Order of the cards. |
| `title` | character varying(160) | no | Card title. |
| `body` | text | no | Card text, which can quote rival figures. |
| `cta` | character varying(80) | yes | Link text. |
| `action` | character varying(12) | no | Where the link leads: voce, reviews or insights. |

Rules:
- `ck_home_nora_insights_action`: CHECK (((action)::text = ANY ((ARRAY['voce'::character varying, 'reviews'::character varying, 'insights'::character varying])::text[])))
- `fk_home_nora_insights_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `uq_home_nora_insights_seat_position`: UNIQUE (tier_agent_id, "position")

### 7.1b The SRS table (created by `srs_schema.sql`)
In schema `srp_cleanup`, next to the Home tables. No row-level security. Access by grants only: `v3_app` has select, insert, update and delete; nothing for anon, authenticated or PUBLIC. No trigger and no function: the foreign key to `home_score_lanes` already makes a row name one of the 10 lanes.

#### `srs_lane_gaps` (400 rows: 10 per seat for 40 seats)

SRS page, one row per seat and SRS v5 lane: the you-vs-rival texts and the lane action. Mock text written by the seed; earned and open points come from `home_snapshot_lanes`.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (`tier_agents.id`). |
| `lane_id` | bigint | no | The SRS v5 lane (`home_score_lanes.id`). |
| `you_text` | character varying(200) | no | What the seat has, for example `0 articles`. |
| `rival_text` | character varying(200) | no | What the market leader has, for example `14 articles`. |
| `note` | character varying(200) | yes | An extra line shown on the lane; null when there is none. |
| `is_missing` | boolean | no | True when the seat has none of what the lane measures (the page shows Missing); default false. |
| `action_label` | character varying(60) | no | Button text on the lane. |
| `action_target` | character varying(16) | no | Where the button leads: profile, voce, website, connections, reviews, chat or billing. |
| `is_mock` | boolean | no | True for mock data written by the seed; default true. |

Rules:
- `pk_srs_lane_gaps`: PRIMARY KEY (id)
- `uq_srs_lane_gaps_seat_lane`: UNIQUE (tier_agent_id, lane_id)
- `ck_srs_lane_gaps_action_target`: CHECK (action_target in profile, voce, website, connections, reviews, chat, billing)
- `fk_srs_lane_gaps_tier_agent_id`: (tier_agent_id) REFERENCES tier_agents(id)
- `fk_srs_lane_gaps_lane_id`: (lane_id) REFERENCES home_score_lanes(id) (no cascade: a lane with gap rows cannot be deleted)
- indexes on `tier_agent_id` and `lane_id`

### 7.1c The Profile tables (created by `profile_schema.sql`)
In schema `srp_cleanup`. No row-level security. Access by grants only: `v3_app` has select, insert, update and delete; nothing for anon, authenticated or PUBLIC. No trigger and no function.

#### `profile_facts` (564 rows: 11 to 16 per seat for 40 seats)

Profile page, one row per seat and fact: its source, trust tier and date, and the value only for facts with no home in the existing tables. Mock rows written by the seed.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat (`tier_agents.id`). |
| `field` | character varying(20) | no | One of 18 facts: name, title, photo, bio, year_started, office_phone, mobile_phone, email (value read from `tier_agents` and `users`), or address, hours, nmls, licensed_in, products, service_areas, designations, awards, education, company (value stored here). |
| `value` | jsonb | yes | A string, or a list of strings for products. Null exactly for the eight existing-table facts. |
| `source` | character varying(60) | no | Where the fact came from, as the page shows it (From LinkedIn, Confirmed by you...). |
| `trust_tier` | character varying(20) | no | self_declared, imported, platform_observed, authority_verified or owner_verified. |
| `confirmed_at` | timestamp | yes | When it was confirmed (UTC); null when the source has no date. |
| `is_mock` | boolean | no | True for mock data (default true). |

Rules:
- `uq_profile_facts_seat_field`: UNIQUE (tier_agent_id, field)
- `ck_profile_facts_field`, `ck_profile_facts_trust_tier`: the 18 fields and the 5 tiers
- `ck_profile_facts_value_only_for_own_fields`: `(value is null) = (field in the eight existing-table fields)` (no second copy)
- `ck_profile_facts_value_shape`: a non-blank string, or a non-empty list of strings
- `fk_profile_facts_tier_agent_id` REFERENCES `tier_agents(id)`; index on `tier_agent_id`

#### `profile_graph_groups` (240 rows: 6 per seat)

Profile page Expertise graph, one row per seat and source group. Mock counts written by the seed; the page adds them up.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat (`tier_agents.id`). |
| `group_key` | character varying(12) | no | identity, contact, licence, products, reviews or presence. |
| `facts` | integer | no | Number of facts in the group (zero or more). |
| `is_mock` | boolean | no | True for mock data (default true). |

Rules: `uq_profile_graph_groups_seat_group` UNIQUE (tier_agent_id, group_key); `ck_profile_graph_groups_group_key`; `ck_profile_graph_groups_facts` CHECK (facts >= 0); `fk_profile_graph_groups_tier_agent_id` REFERENCES `tier_agents(id)`; index on `tier_agent_id`.

### 7.1d The Insights tables (created by `insights_schema.sql`)
In schema `srp_cleanup`. No row-level security. Access by grants only: `v3_app` has select, insert, update and delete; nothing for anon, authenticated or PUBLIC. No trigger and no function. The script also adds one unique constraint, `uq_home_competitors_id_seat` UNIQUE (id, tier_agent_id), to `home_competitors` (so a position row cannot name another seat's rival).

#### `insights_visibility` (233 rows: 5 or 6 per seat for 40 seats)

Insights page, one row per seat and visibility metric: the figure for the last period_days days with its source and trust tier. Mock rows written by the seed.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `metric` | character varying(20) | no | Which figure: search_views, maps_views, calls, directions, website_clicks or profile_views. |
| `value` | integer | no | The count for the period (zero or more). |
| `period_days` | integer | no | How many days the count covers (default 30). |
| `source` | character varying(60) | no | Where the figure came from, as the page shows it, for example From Google. |
| `trust_tier` | character varying(20) | no | How far the figure is trusted: self_declared, imported, platform_observed, authority_verified or owner_verified. |
| `is_mock` | boolean | no | True for mock data written by the seed. |

Rules:
- `uq_insights_visibility_seat_metric`: UNIQUE (tier_agent_id, metric)
- `fk_insights_visibility_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `ck_insights_visibility_metric`: CHECK (((metric)::text = ANY ((ARRAY['search_views'::character varying, 'maps_views'::character varying, 'calls'::character varying, 'directions'::character varying, 'website_clicks'::character varying, 'profile_views'::character varying])::text[])))
- `ck_insights_visibility_period_days`: CHECK ((period_days > 0))
- `ck_insights_visibility_trust_tier`: CHECK (((trust_tier)::text = ANY ((ARRAY['self_declared'::character varying, 'imported'::character varying, 'platform_observed'::character varying, 'authority_verified'::character varying, 'owner_verified'::character varying])::text[])))
- `ck_insights_visibility_value`: CHECK ((value >= 0))

#### `insights_ai_engines` (120 rows: 3 per seat)

Insights page, one row per seat and AI engine: answers checked and answers that name the seat. Splits home_snapshots.ai_cited and ai_checked per engine. Mock rows written by the seed.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `engine` | character varying(12) | no | The AI engine: chatgpt, gemini or perplexity. |
| `cited` | integer | no | Answers that name the seat (zero up to checked). |
| `checked` | integer | no | Answers checked on this engine. |
| `note` | character varying(120) | yes | A short note about what the engine says; null when there is none. |
| `is_mock` | boolean | no | True for mock data written by the seed. |

Rules:
- `uq_insights_ai_engines_seat_engine`: UNIQUE (tier_agent_id, engine)
- `fk_insights_ai_engines_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `ck_insights_ai_engines_cited`: CHECK ((cited >= 0))
- `ck_insights_ai_engines_cited_le_checked`: CHECK ((cited <= checked))
- `ck_insights_ai_engines_engine`: CHECK (((engine)::text = ANY ((ARRAY['chatgpt'::character varying, 'gemini'::character varying, 'perplexity'::character varying])::text[])))

#### `insights_competitor_positions` (200 rows: 5 per seat)

Insights page, one row per rival (home_competitors): its average map position. The seat's own average is computed from its map ranks. Mock rows written by the seed.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to; the rival must belong to the same seat. |
| `competitor_id` | bigint | no | The rival (home_competitors.id). |
| `avg_position` | numeric(3,1) | no | The rival's average position on the seat's map, one decimal, 1.0 or more. |
| `is_mock` | boolean | no | True for mock data written by the seed. |

Rules:
- `uq_insights_competitor_positions_competitor`: UNIQUE (competitor_id)
- `fk_insights_competitor_positions_competitor`: FOREIGN KEY (competitor_id, tier_agent_id) REFERENCES home_competitors(id, tier_agent_id)
- `fk_insights_competitor_positions_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `ck_insights_competitor_positions_avg_position`: CHECK ((avg_position >= (1)::numeric))

#### `insights_spot_leaders` (5,880 rows: 3 per map spot, 147 per seat)

Insights page, the top 3 businesses of one map spot (home_map_cells): the seat itself or a rival. Mock rows written by the seed.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `cell_id` | bigint | no | The map spot (home_map_cells.id); the rows go with the cell. |
| `position` | smallint | no | Place in the spot's top 3: 1, 2 or 3. |
| `name` | character varying(160) | yes | The rival's name; null exactly when the row is the seat itself. |
| `is_you` | boolean | no | True when the row is the seat itself (shown as You). |
| `is_mock` | boolean | no | True for mock data written by the seed. |

Rules:
- `uq_insights_spot_leaders_cell_position`: UNIQUE (cell_id, "position")
- `fk_insights_spot_leaders_cell_id`: FOREIGN KEY (cell_id) REFERENCES home_map_cells(id) ON DELETE CASCADE
- `ck_insights_spot_leaders_position`: CHECK ((("position" >= 1) AND ("position" <= 3)))
- `ck_insights_spot_leaders_you_or_name`: CHECK ((is_you = (name IS NULL)))

### 7.1e The Web analytics table (created by `web_analytics_schema.sql`)
In schema `srp_cleanup`. No row-level security. Access by grants only: `v3_app` has select, insert, update and delete; nothing for anon, authenticated or PUBLIC. No trigger and no function. The script alters no existing table.

#### `web_checks` (400 rows: 10 per seat for 40 seats)

Web analytics page, one row per seat and audit check: its state, result line, optional points, source and trust tier. The four scored checks add up to the seat's website lane. Mock rows written by the seed.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `check_key` | character varying(20) | no | Which check: entity_markup, nap, indexing, service_pages, speed, ai_readiness, content, conversion, reviews_on_site or security. |
| `state` | character varying(4) | no | fail, warn or pass. For a scored check it follows the points (full pass, none fail, in between warn). |
| `result` | character varying(240) | no | The result line the page shows for the check, for example Indexed; no sitemap. |
| `headline` | character varying(40) | yes | The short value of the check's tile: LCP 3.1 s for speed, 2 of 5 for ai_readiness; null for every other check. |
| `points` | integer | yes | Points earned (zero up to points_max); null for the six unscored checks. |
| `points_max` | integer | yes | Points available (more than zero); null for the six unscored checks. |
| `source` | character varying(60) | no | Where the result came from, as a label, for example From your site scan. |
| `trust_tier` | character varying(20) | no | How far the result is trusted: self_declared, imported, platform_observed, authority_verified or owner_verified. |
| `is_mock` | boolean | no | True for mock data written by the seed. |

Rules:
- `uq_web_checks_seat_key`: UNIQUE (tier_agent_id, check_key)
- `fk_web_checks_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES tier_agents(id)
- `ck_web_checks_check_key`: CHECK (((check_key)::text = ANY ((ARRAY['entity_markup'::character varying, 'nap'::character varying, 'indexing'::character varying, 'service_pages'::character varying, 'speed'::character varying, 'ai_readiness'::character varying, 'content'::character varying, 'conversion'::character varying, 'reviews_on_site'::character varying, 'security'::character varying])::text[])))
- `ck_web_checks_headline_keys`: CHECK (((headline IS NOT NULL) = ((check_key)::text = ANY ((ARRAY['speed'::character varying, 'ai_readiness'::character varying])::text[]))))
- `ck_web_checks_headline_text`: CHECK (((headline IS NULL) OR (btrim((headline)::text) <> ''::text)))
- `ck_web_checks_points_max`: CHECK (((points_max IS NULL) OR (points_max > 0)))
- `ck_web_checks_points_pair`: CHECK (((points IS NULL) = (points_max IS NULL)))
- `ck_web_checks_points_range`: CHECK (((points IS NULL) OR ((points >= 0) AND (points <= points_max))))
- `ck_web_checks_result`: CHECK ((btrim((result)::text) <> ''::text))
- `ck_web_checks_scored_keys`: CHECK (((points_max IS NOT NULL) = ((check_key)::text = ANY ((ARRAY['entity_markup'::character varying, 'nap'::character varying, 'indexing'::character varying, 'service_pages'::character varying])::text[]))))
- `ck_web_checks_state`: CHECK (((state)::text = ANY ((ARRAY['fail'::character varying, 'warn'::character varying, 'pass'::character varying])::text[])))
- `ck_web_checks_state_follows_points`: CHECK (((points IS NULL) OR ((state)::text =
CASE
    WHEN (points = points_max) THEN 'pass'::text
    WHEN (points = 0) THEN 'fail'::text
    ELSE 'warn'::text
END)))
- `ck_web_checks_trust_tier`: CHECK (((trust_tier)::text = ANY ((ARRAY['self_declared'::character varying, 'imported'::character varying, 'platform_observed'::character varying, 'authority_verified'::character varying, 'owner_verified'::character varying])::text[])))

### 7.1f The Connections table (created by `connections_schema.sql`)
In schema `srp_cleanup`. No row-level security. Access by grants only: `v3_app` has select, insert, update and delete; nothing for anon, authenticated or PUBLIC. No trigger and no function. The script alters no existing table. The table holds no token, secret, sign-in or account identifier.

#### `connected_accounts` (440 rows: 11 per seat for 40 seats)

Connections page, one row per seat and account: its state, last sync, source and trust tier. Holds no token, secret or account identifier. Mock rows written by the seed.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | bigint | no | Row id. |
| `tier_agent_id` | bigint | no | The seat this row belongs to (tier_agents.id). |
| `provider` | character varying(20) | no | Which account: google_business, search_console, youtube, facebook, instagram, linkedin, x, zillow, yelp, website_cms or loan_system. |
| `state` | character varying(9) | no | connected, available (not connected yet), matched or partial (zillow and yelp only: found by NORA, no sign-in). |
| `synced_at` | timestamp | yes | When the account last synced; null exactly when the state is available. |
| `source` | character varying(60) | no | Where the state came from, as a label, for example From your sign-in. |
| `trust_tier` | character varying(20) | no | How far the state is trusted: self_declared, imported, platform_observed, authority_verified or owner_verified. |
| `is_mock` | boolean | no | True for mock data written by the seed. |

Rules:
- `ck_connected_accounts_matchable`: CHECK ((((state)::text = ANY ((ARRAY['connected'::character varying, 'available'::character varying])::text[])) OR ((provider)::text = ANY ((ARRAY['zillow'::character varying, 'yelp'::character varying])::text[]))))
- `ck_connected_accounts_provider`: CHECK (((provider)::text = ANY ((ARRAY['google_business'::character varying, 'search_console'::character varying, 'youtube'::character varying, 'facebook'::character varying, 'instagram'::character varying, 'linkedin'::character varying, 'x'::character varying, 'zillow'::character varying, 'yelp'::character varying, 'website_cms'::character varying, 'loan_system'::character varying])::text[])))
- `ck_connected_accounts_source`: CHECK ((btrim((source)::text) <> ''::text))
- `ck_connected_accounts_state`: CHECK (((state)::text = ANY ((ARRAY['connected'::character varying, 'available'::character varying, 'matched'::character varying, 'partial'::character varying])::text[])))
- `ck_connected_accounts_synced`: CHECK (((synced_at IS NULL) = ((state)::text = 'available'::text)))
- `ck_connected_accounts_trust_tier`: CHECK (((trust_tier)::text = ANY ((ARRAY['self_declared'::character varying, 'imported'::character varying, 'platform_observed'::character varying, 'authority_verified'::character varying, 'owner_verified'::character varying])::text[])))
- `fk_connected_accounts_tier_agent_id`: FOREIGN KEY (tier_agent_id) REFERENCES srp_cleanup.tier_agents(id)
- `uq_connected_accounts_seat_provider`: UNIQUE (tier_agent_id, provider)
- no separate seat index: the unique (tier_agent_id, provider) index already leads with the seat

### 7.2 Existing tables the pages read (columns the code uses)

These are the cleanup schema's own tables; the Home seed also writes five of them for the 40 mock seats (`user_search_rank_scores`, `voce_articles`, `website_analytics_data`, `ai_authority_stats`, `tier_agent_details`) and some `tier_agents` columns (`year_started`, `zipcode`, `profile_photo`). Only the columns below are read by the SRP code named in section 2 and 4.


#### `tier_agents` (40 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `user_id` | bigint |
| `tier_id` | bigint |
| `title` | character varying(300) |
| `slug` | character varying(300) |
| `tag_line` | character varying(255) |
| `description` | text |
| `profile_photo` | text |
| `phone_number` | character varying(255) |
| `year_started` | character varying(255) |
| `zipcode` | character varying(255) |
| `vertical_id` | bigint |
| `website_url` | text |
| `deleted_at` | timestamp without time zone |

#### `users` (50 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `first_name` | character varying(255) |
| `last_name` | character varying(255) |
| `email` | character varying(255) |
| `deleted_at` | timestamp without time zone |
| `deactivated_at` | timestamp without time zone |
| `is_manual_deactivated` | boolean |

#### `tiers` (30 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `name` | character varying(255) |

#### `tier_locations` (40 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `tier_id` | bigint |
| `location_id` | bigint |
| `deleted_at` | timestamp without time zone |

#### `locations` (40 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `city` | character varying(255) |
| `state_id` | bigint |

#### `states` (20 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `code` | character varying(255) |
| `name` | character varying(255) |

#### `tier_agent_details` (40 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `tier_agent_id` | integer |
| `certifications` | jsonb |

#### `user_search_rank_scores` (400 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `tier_agent_id` | integer |
| `srs_config_category_id` | integer |
| `srs_category_score` | integer |
| `zipcode` | character varying(255) |
| `vertical_id` | integer |
| `updated_at` | timestamp without time zone |

#### `srs_config_categories` (10 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `name` | character varying(255) |
| `display_name` | character varying(255) |
| `score` | integer |

#### `voce_articles` (94 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `tier_agent_id` | integer |
| `title` | character varying(255) |
| `slug` | character varying(255) |
| `published` | boolean |
| `article_archived_at` | timestamp without time zone |

#### `website_analytics_data` (40 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `tier_agent_id` | bigint |
| `total_score` | integer |
| `website_url` | character varying(255) |
| `last_refreshed_time` | timestamp without time zone |

#### `ai_authority_stats` (37 rows)

| Column | Type |
|---|---|
| `id` | bigint |
| `agent_id` | integer |
| `ai_authority_score` | integer |
| `total_answer` | integer |
| `ai_topics` | jsonb |
| `updated_at` | timestamp without time zone |

### 7.3 How the Home tables relate

- `home_activity` (tier_agent_id) REFERENCES tier_agents(id)
- `home_competitors` (tier_agent_id) REFERENCES tier_agents(id)
- `home_events` (tier_agent_id) REFERENCES tier_agents(id)
- `home_locked_features` (lane_id) REFERENCES home_score_lanes(id)
- `home_locked_features` (plan_id) REFERENCES home_plans(id)
- `home_locked_features` (tier_agent_id) REFERENCES tier_agents(id)
- `home_map_cells` (snapshot_id) REFERENCES home_snapshots(id) ON DELETE CASCADE
- `home_next_moves` (tier_agent_id) REFERENCES tier_agents(id)
- `home_nora_insights` (tier_agent_id) REFERENCES tier_agents(id)
- `home_peer_benchmarks` (band_id) REFERENCES home_score_bands(id)
- `home_review_drafts` (tier_agent_id) REFERENCES tier_agents(id)
- `home_seat_state` (claim_snapshot_id, tier_agent_id) REFERENCES home_snapshots(id, tier_agent_id) ON DELETE SET NULL (claim_snapshot_id)
- `home_seat_state` (plan_id) REFERENCES home_plans(id)
- `home_seat_state` (tier_agent_id) REFERENCES tier_agents(id)
- `home_snapshot_lanes` (lane_id) REFERENCES home_score_lanes(id)
- `home_snapshot_lanes` (snapshot_id) REFERENCES home_snapshots(id) ON DELETE CASCADE
- `home_snapshots` (band_id) REFERENCES home_score_bands(id)
- `home_snapshots` (tier_agent_id) REFERENCES tier_agents(id)
- `home_weekly_brief_items` (brief_id) REFERENCES home_weekly_briefs(id) ON DELETE CASCADE
- `home_weekly_briefs` (tier_agent_id) REFERENCES tier_agents(id)

- `insights_ai_engines` (tier_agent_id) REFERENCES tier_agents(id)
- `insights_competitor_positions` (competitor_id, tier_agent_id) REFERENCES home_competitors(id, tier_agent_id)
- `insights_competitor_positions` (tier_agent_id) REFERENCES tier_agents(id)
- `insights_spot_leaders` (cell_id) REFERENCES home_map_cells(id) ON DELETE CASCADE
- `insights_visibility` (tier_agent_id) REFERENCES tier_agents(id)
- `web_checks` (tier_agent_id) REFERENCES tier_agents(id)

Reading it: everything per seat hangs off `tier_agents.id` (`tier_agent_id`); a snapshot has its lane points and its map cells; a brief has its items; the reference tables (`home_score_lanes`, `home_score_bands`, `home_plans`) are shared by all seats.

## 8. Open points
- **SRS is wired** (srp/srs-page-schema). Its open rulings: the Strong threshold (a constant of 3/4 of a lane's budget), the stored `is_missing` flag (a fact, not derived), the Reviews and Articles texts that repeat counts also stored on Home, and lane texts without units.
- **Profile is wired** (srp/profile-page-schema), read-only. Its open rulings: identity and claim ownership, O5 ("% complete" is Home's stored figure), the trust-tier rules (label to tier is a mock mapping), which location is a seat's office (address, hours and company live in `profile_facts`), the thin-bio limit of 60 characters, and a real source for the facts. No seat has a photo seeded.
- **Insights is wired** (srp/insights-page-schema), read-only. Its open rulings: the average-position convention (a "20+" cell counts as 21), the plan gating of the two locked cards (Home's mock plan rule), the wording of NORA's two notes, which source and trust tier each visibility figure has (the label-to-tier mapping is mock), a real map-scan and AI-check feed (enrichment is gated, O2), and a real competitor model. The figures, positions and leaders are mock.
- **Web analytics is wired** (srp/web-analytics-page-schema), read-only. Its open rulings: the real website scoring rule and the split of the 102-point lane (42, 30, 20, 10 is the prototype's), the real audit sources and the webmaster hand-off (O2: a crawl and an outbound message stay off), the trust-tier mapping (mock), which of the two website scores is the product's (the seed makes Home's tile, the SRS lane and this page equal), and that the seed cannot split a full lane for a seat with no address (found with more than 40 seats). The checks are mock.
- **Connections is wired** (srp/connections-page-schema), read-only. Its open rulings: the real connection model (OAuth, tokens in the vault, sync: O2 and an integrations Surface), the matched and partial rules for Zillow and Yelp, the trust-tier mapping by state (mock), whether a Profile fact may come from LinkedIn by import without a connection (C10), the real Connections lane and indexing-source rules (C11, C12), and the plan rule for the directories card. The accounts and states are mock.
- **Other pages** (Network, Settings) have no tables; each would need its own increment (intent, spec, plan) with a schema proposal.
- **Ruled 2026-10-27:** the `srp_cleanup` tables (Home, SRS, Profile, Insights, Web analytics and Connections) are a local schema outside Alembic and the closed SQL stream and get no `docs/ETL-Enhancements.md` entry.
- **Rulings still open** for the Home tables: scoring and identity ownership, band thresholds (placeholders), the profile-strength rule (O5), the plan and trial rule, and the `srp_cleanup` schema name. The 850-point mock score is not produced by the real SRS v5 scorer.
