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
| **SRS** (`/nora`; the SRS tab and the shell's NORA chat window open from it) | Score only | the score ring and count-up use the latest `home_snapshots.total` (through the Home model); the 10 lanes, the gap list, the race to #1 and "how it is calculated" are sample constants | the Home read |
| **Profile** (`/profile`), **Settings** (`/settings`), **Website** (`/website`), **Find you** (`/find`), **Interview** (`/interview`) | Identity only | `tier_agents`, `users`, `tiers`, `tier_locations`, `locations`, `states`, and the legacy score rows (for the name, title, photo, email, phone, city and state) | `GET /srp/seat/professional/{id}` |
| **Insights**, **Connections**, **Network** | Sample | none (Insights' "AI citations" figure is on the Home page, from `home_snapshots`) | none |
| Listings, Reviews, Graph, Team, Reporting, Multi-post, `dashboard.*` | Not served for a local sign-in | none (these read other tables through routes that need a Supabase sign-in; a local token is not accepted there) | `/srp/seat/location/...`, `/srp/dashboard/...` |

Every professional seat is opened by its owner only: another user's seat answers 403 and the page shows the sample.

## APIs used by each page

All routes are under `/srp` on the FastAPI service. "Local OK" means a local sign-in token is accepted (five routes only: `/srp/auth/me`, `/srp/rpc/{name}`, `/srp/seat/professional/{id}`, `/srp/seat/professional/{id}/home` and `/srp/seat/listings`); the others need a Supabase sign-in and answer 401 to a local token.

| Page | API calls | Local OK | Response notes |
|---|---|---|---|
| **Sign in** (`/sign-in`) | `POST /srp/auth/login`; then `GET /srp/auth/me` (user and landing seat) | yes | wrong password 401 |
| **Every seat page** (shared layout `seat/{kind}/{id}`) | `GET /srp/seat/professional/{id}`: name, title, photo, email, phone, office, city and state, legacy score | yes | another user's seat 403 (page falls back to the sample) |
| **Home** (`/`) | the layout call above, plus `GET /srp/seat/professional/{id}/home` | yes | 403 not your seat, 501 for a Supabase session, 503 database unavailable; any failure shows the sample page |
| **SRS** (`/nora`) | none of its own: the layout call and the Home call (the score ring uses the Home total) | yes | same as Home |
| **Profile**, **Settings**, **Website**, **Find you**, **Insights**, **Connections**, **Network** | none of their own: the layout call (and the Home call, which the shell also reads for the trial banner and chips) | yes | |
| **Interview** (`/interview`) | the layout call, plus `GET /srp/interview/subject/{kind}/{id}`, `GET /srp/interview/claim/{id}` and the category-brief server function | no | needs a Supabase sign-in |
| **Listings** (`/listings`) | `GET /srp/seat/listings?entity_type&entity_id`, `POST /srp/rpc/exp_office_mode` | yes (a local session gets an empty list) | |
| **Team**, **Reporting**, **Graph**, **Multi-post** (location seats) | `GET /srp/seat/location/{id}` (a professional seat uses the professional read) | no | needs a Supabase sign-in |
| **Reviews**, dashboard routes (`/dashboard/...`) | `GET /srp/dashboard/me`, `/dashboard/home`, `/dashboard/content`, `/dashboard/listings`, `/dashboard/reviews` | no | needs a Supabase sign-in |

The contract for the Home call is `contracts/srp/openapi.json` (`HomeResponse`).

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

What is on the page and where it comes from today:

| On the page | Source today | Table that could feed it (not wired yet) |
|---|---|---|
| Score ring and count-up | latest `home_snapshots.total` (via the Home model) | already wired |
| Band bar and the "#1 target race" | sample constants | `home_score_bands`, `home_competitors` |
| The 10 lanes (Reviews 187, Completeness 182, Website 102, Articles 103, GBP 68, Directories 90, Q&A 34, Connections 51, Videos 27, Audio 6 = 850) with points earned and open | sample constants (`LANES` in `screens/srs.tsx`) | `home_score_lanes` (names and maxima) with `home_snapshot_lanes` (points of a snapshot) |
| Gap list order and NORA's note | sample constants | derived from the lanes |
| "How your score is calculated" | sample text | none |

The seat read (`GET /srp/seat/professional/{id}`) also returns the **legacy 29-point score** (the sum of the newest `user_search_rank_scores.srs_category_score` per category in `srs_config_categories`); it is not SRS v5 and the Happyflow pages do not display it.

## 4. Profile, Settings, Website, Find you, Interview

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

Everything else on those pages (profile facts, website audit, interview answers, the NORA chat answers) is sample data today, with no table behind it.

## 5. Insights, Connections, Network
Sample pages. No table feeds them. (The AI-citation figure that Insights links to is shown on the Home page from `home_snapshots.ai_cited` and `ai_checked`.)

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

Reading it: everything per seat hangs off `tier_agents.id` (`tier_agent_id`); a snapshot has its lane points and its map cells; a brief has its items; the reference tables (`home_score_lanes`, `home_score_bands`, `home_plans`) are shared by all seats.

## 8. Open points
- **SRS lanes are not wired** to `home_score_lanes` and `home_snapshot_lanes` yet; the SRS page's lane list is still sample data. The tables already hold the 10 lanes and 10 points per snapshot, so wiring it is a read plus a view model, like the Home.
- **Other pages** (Profile, Insights, Website, Connections, Network, Settings) have no tables; each would need its own increment (intent, spec, plan) with a schema proposal.
- **Rulings still open** for the Home tables: scoring and identity ownership, band thresholds (placeholders), the profile-strength rule (O5), the plan and trial rule, and the `srp_cleanup` schema name. The 850-point mock score is not produced by the real SRS v5 scorer.
