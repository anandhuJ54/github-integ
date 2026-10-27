# Plan: Wire the Happyflow Home page to `srp_cleanup`

<!-- Stage: Develop. Shared template — do not remove sections. DRAFT: written before intent.md and spec.md, which must be approved first. -->

Links: [local sign-in increment](../local-login-srp-home/intent.md) · intent: not written yet · spec: not written yet

Status: **tasks 1 to 7 done, nothing committed**. Decisions D1 to D5 and S1 approved 2026-10-27; `intent.md` and `spec.md` approved.

## Goal and scope
The Home page (`/seat/professional/{id}`, day 1 and the day 7 / 24 variants) shows real numbers from the local
`srp_cleanup` schema wherever a source exists, and says **"Not connected yet"** where one does not, instead of showing
demo numbers as if they were the person's.

**In scope (7 items, all read-only):** score and its per-category breakdown, rank among peers, VOCE article counts,
website score, AI-authority numbers, profile photo and credentials, year started.
**Out of scope:** everything with no source in `srp_cleanup` (plan/trial, bands, score history and "since you claimed",
competitors, NORA's board, map rank, reviews, listings, the peer benchmark); the other Happyflow pages; saving the
"year started" answer (a write, a later increment); any change to `public`, Supabase or the SRS v5 scorer.

## What the Home needs today, and where it comes from
Full inventory of the 22 day-1 items is in the 2026-10-27 review (3 connected, 2 not wired, 7 derivable, 10 missing).
This plan wires the **2 not wired + 5 of the 7 derivable**:

| Home item | Source in `srp_cleanup` | Planned |
|---|---|---|
| Score ring, "390 of 850" | `user_search_rank_scores.srs_category_score` (sum), `srs_config_categories.score` (maximum) | Wire total; **maximum needs a ruling** (D1) |
| Per-category lines (SRS gap list entry) | same two tables | Wire |
| "#6 of 41 in Davenport" | peers' sums grouped by `user_search_rank_scores.zipcode` and `vertical_id`; city from `locations.city` | Wire; **market definition needs a ruling** (D2) |
| "VOCE +85 / No articles yet", "Start publishing" | `voce_articles` (`published`, `published_at`, `article_archived_at`) | Wire |
| "Fix my website · health 40 of 102" | `website_analytics_data.total_score`, `last_refreshed_time`, `website_url` | Wire the score; **"of 102" has no source** (D3) |
| "AI citations 1 of 7" | `ai_authority_stats` (`ai_authority_score`, `total_answer`, `ai_topics`) | Wire the numbers; the "of 7" meaning is unclear (D4) |
| Avatar photo | `tier_agents.profile_photo` | Wire, with a fallback to initials when the URL does not load |
| "Add your credentials" | `tier_agent_details.certifications` | Wire the count |
| "When did you start in mortgage?" | `tier_agents.year_started` | Read only (preselect the saved year) |
| "Profile strength 64%" | a completeness rule | **Not wired** until O5 is ruled; shows "Not connected yet" |

## Endpoint
One new read, same rules as the local seat read (`srp/src/seat/local.py`): a local sign-in session only, the user's own
seat only (403 otherwise), the API's own database login, no `authenticated` role, nothing written.

`GET /srp/seat/professional/{pro_id}/home` → 200

```jsonc
{
  "as_of": "2026-10-27T10:00:00Z",          // server time of the read
  "score": {                                  // null when the seat has no score rows
    "total": 410,                             // SUM(srs_category_score), NULLs ignored
    "max": 29,                                // SUM(srs_config_categories.score); see D1
    "categories": [ { "id": 7, "name": "…", "score": 5, "max": 6 } ],
    "updated_at": "2026-09-01T10:00:00Z"
  },
  "rank": {                                   // null when the seat has no zipcode or vertical
    "position": 6, "of": 41,
    "market": { "zipcode": "11732", "vertical_id": 7, "city": "Austin" }
  },
  "voce":    { "published": 3, "total": 3, "last_published_at": "…" },       // zeros are real zeros
  "website": { "score": 40, "url": "…", "last_refreshed_at": "…" },          // null when no row
  "ai":      { "authority_score": 12, "answers": 1, "topics": ["…"], "updated_at": "…" },   // null when no row
  "profile": { "photo_url": "…", "year_started": 2014, "certifications": 2 },
  "unavailable": ["profile_strength", "bands", "competitors", "since_claimed", "map_rank", "reviews", "listings", "plan"]
}
```

Rules: a section with no rows is `null`, never a made-up number; `unavailable` names what this endpoint cannot provide at
all, so the page can show "Not connected yet" for those tiles; a Supabase session gets 501 `not_implemented` (the existing
`public` reads are unchanged); the route is added to the local-token allowlist test (now five routes) and to
`contracts/srp/openapi.json`.

## SQL (all values parameters; `{s}` is `SRP_LOCAL_SCHEMA`, already validated)
```sql
-- score and breakdown
select s.srs_config_category_id as id, c.display_name as name, s.srs_category_score as score, c.score as max,
       s.updated_at
from {s}.user_search_rank_scores s
left join {s}.srs_config_categories c on c.id = s.srs_config_category_id
where s.tier_agent_id = %s;               -- total = sum(score) over non-null; max = (select sum(score) from {s}.srs_config_categories)

-- rank among peers in the same zipcode and vertical (ties share a position)
with mine as (select max(zipcode) zip, max(vertical_id) vert from {s}.user_search_rank_scores where tier_agent_id = %s),
     totals as (
       select tier_agent_id, sum(srs_category_score) total
       from {s}.user_search_rank_scores, mine
       where zipcode = mine.zip and vertical_id = mine.vert
       group by tier_agent_id)
select (select count(*) from totals t where t.total > (select total from totals where tier_agent_id = %s)) + 1 as position,
       (select count(*) from totals) as of;   -- null when mine.zip or mine.vert is null

-- VOCE
select count(*) filter (where published and article_archived_at is null) as published,
       count(*) filter (where article_archived_at is null) as total, max(published_at) as last_published_at
from {s}.voce_articles where tier_agent_id = %s;

-- website (latest row)
select total_score, website_url, last_refreshed_time
from {s}.website_analytics_data where tier_agent_id = %s order by last_refreshed_time desc nulls last limit 1;

-- AI authority (latest row)
select ai_authority_score, total_answer, ai_topics, updated_at
from {s}.ai_authority_stats where agent_id = %s order by updated_at desc limit 1;

-- profile
select ta.profile_photo, ta.year_started, coalesce(jsonb_array_length(d.certifications), 0) as certifications
from {s}.tier_agents ta left join {s}.tier_agent_details d on d.tier_agent_id = ta.id
where ta.id = %s and ta.user_id = %s and ta.deleted_at is null;   -- also the ownership check
```
Read order: ownership/profile first (403 on no row), then the five section queries on one connection, no lock, no write.

## Mock data first (it is not usable as it is)
Checked in `v3_local`: only 28 of the 50 users' seats have any score row, 1 to 3 rows each, several with NULL scores; `zipcode`
is mostly empty; the category maximums sum to 29, not 850. Wired to this, the Home would show a rank of nothing and a score of 7.
Task 1 adds a **deterministic scenario seed** (seat-scoped, `srp_cleanup` only, re-runnable, backs up what it replaces)
that gives every seated user: a full set of category scores that sum to a plausible total, a shared zipcode and vertical with
at least 10 peers, 0 to 5 VOCE articles, a website row, an AI-authority row, a credentials list, a year started. It is
labelled mock data like the rest.

## UI wiring
- `useHomeData(seatId)`: a React Query read of the endpoint, in the seat layout next to the seat read (data stays in
  React Query, per `surface-ui/state/README.md`); the Happyflow components stay free of fetch calls (their guard test stays green).
- `HfHomeProvider` / `useHfHome()` (same pattern as the persona context) hands the data to the Home screens.
- A pure `homeView(data)` turns the response into what each tile shows: a value, or `{ state: "unavailable" }`; tested without a DOM.
- Day 1 and day 7 tiles use real values; a tile whose section is `null` or whose item is in `unavailable` shows
  **"Not connected yet"** (no demo number). With no real data at all (the sample persona, no seat) the page is exactly as today.
- The scripted "first task" animation and its 384 to 390 count stay in sample mode only.
- The banner text changes from "Your name and title come from your account…" to list what is real: name, score, rank, articles,
  website, AI authority, photo.

## Tasks
Small tasks (≤ ~400 changed lines), in dependency order, each starting from its failing test.

| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|
| 0 | `intent.md`, `spec.md`; canon review; decisions D1 to D5 ruled | `surface-spec/srp/home-page-data/` | n/a (documents) | — |
| 1 | **DONE 2026-10-27.** Scenario seed for the Home data | `surface-api/srp/src/seat/seed_home.py`, `srp_cleanup.{user_search_rank_scores, voce_articles, website_analytics_data, ai_authority_stats, tier_agent_details, tier_agents}` | Seed is idempotent, deterministic, scoped to seated users; every seat gets a score, peers and a rank | 0 |
| 2 | **DONE 2026-10-27.** Home read service: the six queries and the shaping | `surface-api/srp/src/seat/home.py` | Fake-database unit tests per section (rows, no rows, NULL scores, ties, no zipcode, ownership 403) plus a real-Postgres test in a scratch schema (rank and ties, the max, a seat with no rows) | 1 |
| 3 | **DONE 2026-10-27.** Route, local-session guard, allowlist, contract | `surface-api/srp/src/seat/router.py`, `tests/test_local_token_scope.py` (5 routes), `contracts/srp/openapi.json` | A local token reaches it for its own seat only; another seat 403; Supabase session 501; every other route still refuses a local token | 2 |
| 4 | **DONE 2026-10-27.** UI types, `homeView`, query hook, provider | `surface-ui/srp/src/utils/home-data.ts`, `components/happyflow/home-context.tsx` | Pure mapping: values, nulls, `unavailable`, number formats, ties wording | 3 |
| 5 | **DONE 2026-10-27.** Wire day 1 and day 7 tiles; "Not connected yet"; banner text | `screens/home-day1.tsx`, `home-day7.tsx`, `shell.tsx`, `sample-data.tsx` | Render tests: real data shows real numbers and no demo number; null section shows the label; no seat is unchanged; guard test (no fetch in Happyflow) stays green | 4 |
| 6 | **DONE 2026-10-27.** Click-through and evidence | `evidence.md`, screenshots | Signed in as two different users; every tile traced to a row | 1 to 5 |
| 7 | **DONE 2026-10-27.** Canon review and a second-model review of the new SQL, the ownership check and the seed | `spec.md` (Canon review, Second-model review, R1 to R3), fixes in `home.py`, `score_query.py`, `router.py`, `seed_home.py` | 12 findings reconciled: 9 fixed with tests, 2 documented, 1 known limitation; merge blocked on rulings | 6 |

## Extend-never-duplicate check (to be redone in task 0 against the live catalog)
- The seat read already returns `score` (the same sum); the home read reuses its ownership rule and its `connection`, and the
  score query moves to a shared helper so the two cannot disagree (**extend**, not copy).
- No new table, function, column or migration. `SRS v5` (`exp_score_v5_*`) is not touched.

## Test plan
Backend: fake-database unit tests per section; real-Postgres tests (skipped unless `SRP_TEST_DATABASE_URL`) in a scratch
schema for rank, ties and NULLs; route-table scope test (5 allowlisted routes). UI: pure `homeView` tests, render tests for day 1
and day 7 with real, partial and no data, the existing Happyflow guard tests. Browser: two users, every tile traced to a row.
Static: `ruff`, `pytest`, `bun test`, `tsc` for the app and `srp`.

## Decisions needed before code (proposals, not rulings)
- **D1. Score maximum and the SRS source.** `srp_cleanup`'s legacy config is not SRS v5 (850 points, 10 lanes in the platform
  tables). *Proposal:* show the total from `user_search_rank_scores` with the sum of the config maximums, labelled as the
  cleanup schema's score, and flag it; do not claim "of 850" until the scorer source is ruled (canon item 9, O1).
- **D2. What a "market" is for the rank.** *Proposal:* peers in the same `zipcode` and `vertical_id`, at least 10 of them, else no rank.
- **D3. "Health 40 of 102".** No source for the 102. *Proposal:* show the score without a denominator.
- **D4. "AI citations 1 of 7".** *Proposal:* show `total_answer` and `ai_authority_score` with their column names, not the "of 7" wording.
- **D5. Mock data.** *Proposal:* approve the scenario seed (task 1) so the Home has coherent numbers to show.
- **Deferred, still blocking other tiles:** O5 (completeness), the plan and trial rule, band thresholds, a score-history table, competitors.

## Risks
- The legacy score config may not mean what the Home implies; the numbers will be consistent with each other but not with
  the product's real scorer. Labelled, not hidden.
- Scenario mock data can make the page look more real than it is; the banner and the "Not connected yet" tiles say what is real.
- The Home is animated and timer-driven; real values must not restart the animation or flash demo numbers (the seat layout
  already waits for the seat to load).
- A new local-token route widens the reach of a local token by one read; the allowlist test and the own-seat rule bound it.
- `tools/hooks/guard.py` and `tools/lint/` are still missing in this checkout, so edits go through the shell and the repo lint cannot run.

## What stays unconnected after this (shown as "Not connected yet" for a real seat; see spec S1)
Plan and trial ("Day N of 30", Compare plans), bands ("Building", "Established"), "since you claimed", the rival and "points to
#1", NORA's board and moves, "Done · N things", map rank and the grid, reviews, listings, profile strength, the peer benchmark panel,
and on day 7 the "While you were away" banner, the weekly brief, the streak and the review drafts.
