# Spec: Serve the Happyflow Web analytics page from the local database, read-only

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [plan](./plan.md) (not written yet) · contracts: `contracts/srp/openapi.json` (one new response, see Data)

Status of this spec: **draft for approval**. Decisions W1 to W20 in the decision log are choices this spec makes that need your confirmation. **W3 and W4 change existing mock rows of the earlier increments** (Home's Website tile
column, the SRS website gap text and the Home "Fix my website" move text) so the pages agree; they are backed up by the seed. It extends `srp/home-page-schema`, `srp/srs-page-schema`, `srp/profile-page-schema` and
`srp/insights-page-schema` (tables, seed, helpers, method); it changes no schema of an existing table.

## Behaviour
Deterministic code decides everything; no model is involved. Reads are `SELECT` only. The database change is one new table in `srp_cleanup` (local `v3_local` only) plus the mock rows the seed writes, and three corrections of
existing mock values (W3, W4). The page's write-looking controls (Re-check, Send to my webmaster, Code copied, the check sheet's button, the hand-off steps, the filters) change only what the browser shows; nothing is fetched or sent.

1. **The read.** `GET /srp/seat/professional/{pro_id}/website`: a local sign-in session, its own seat only (403 `not_your_seat` otherwise; ownership is checked first through `home.owner_of`), `set transaction read only` first,
   one connection; a database error answers 503 `database_unavailable`; a Supabase session gets 501 `not_implemented`.
2. **The response** (`WebAnalyticsResponse`). Every value is a stored value or a computed one (step 3); nothing is invented.
   - `as_of`, `data` = `"mock"` or `"live"` (`"mock"` when any `web_checks` row is mock), `ready` (false when the seat has no `web_checks` row; every other section is then `null`).
   - `site`: `{ url, last_checked }`: `url` is `website_analytics_data.website_url` with the scheme and a trailing slash removed (`null` when there is none); `last_checked` is its `last_refreshed_time` (`null` when none).
   - `health`: `{ earned, max, open }`: the seat's `website` lane points in its newest snapshot (`home_snapshot_lanes`) and the lane's `max_points` (`home_score_lanes`); `null` when the seat has no snapshot or no lane row. Never 0 for unknown.
   - `checks`: the ten checks in the page's order `entity_markup, nap, indexing, service_pages, speed, ai_readiness, content, conversion, reviews_on_site, security`:
     `[{ key, group, state, result, points, max, points_text, source, trust_tier }]`; `group` is the page's label ("Entity and markup", "Name, address, phone", "Indexing", "Service pages", "Speed", "AI readiness", "Content",
     "Conversion", "Reviews on site", "Security"); `points` and `max` are `null` for the six unscored checks.
   - `counts`: `{ all, fail, warn, pass }` (the filter pills).
   - `tiles`: three, in order Speed, Markup, AI readiness: `[{ key, label, value, note, state, check }]` (`check` is the check key the tile opens).
   - `top_fix`: `{ open, snippet }` or `null` (see step 3).
   - `notes`: `[{ title, body, cta, action }]`, NORA's notes, `action` one of `send` or `close`.
   - `facts`: `{ name, company, phone, address }` (the Profile's, each `null` when missing; used only to build the snippet text).
3. **What is computed (never stored):**
   - `health.open` = `max - earned`.
   - `points_text` per check: a scored check shows `"+{open} open"` when it is `entity_markup` and has points open, otherwise `"{points} of {max}"`; an unscored check shows `"Pass"` when its state is `pass` and `"—"` otherwise (W13).
   - `counts` from the states.
   - Tiles: **Speed**: `value` = the check's `headline` ("LCP 3.1 s"), `note` = the state label; **Markup**: `value` = "Missing" (fail), "Partial" (warn) or "Complete" (pass), `note` = `"+{open} open"` when points are open, else "Passing";
     **AI readiness**: `value` = the check's `headline` ("2 of 5"), `note` = the state label. The state labels are "Failing", "Needs work" and "Passing".
   - `top_fix` is present when `entity_markup` is not `pass`: `open` = its `max - points`, `snippet` the JSON-LD text built from `facts` (below); `null` otherwise.
   - `snippet` (W16): `<script type="application/ld+json">` then `{ "@type": "FinancialService",` and one line each for `name` (`"{name} – {company}"`, or `"{name}"` without a company), `telephone` and `address`, each only when its fact is
     present, every value JSON-escaped, `}` and `</script>`. With no name at all there is no snippet.
   - `notes` (W15), authoritative numbers only, in this order: (1) when `top_fix` is present: `"Markup is worth {open} points."`, body `"I've written the code — your webmaster only needs to paste it in."`, cta `Send to my webmaster`, action
     `send`; (2) when `ai_readiness` is not `pass`: `"AI can't read your page yet."` when it fails and `"AI can only partly read your page."` when it needs work, body the check's own `result` line followed by a full stop, cta `See the checks`, action `close`.
4. **The UI** (`surface-ui/srp/src/`):
   - `utils/web-analytics-model.ts` (`WebAnalyticsModel`, `webAnalyticsModel(response, seatId)`, `useWebAnalyticsApi`; the API builds the snippet, so the UI builds none for a real seat), `components/happyflow/sample-web-analytics.ts` (the prototype's sample as the same model, built from today's
     constants so the sample view is unchanged), `web-analytics-context.tsx` and `web-analytics-page.tsx` (mirror the Insights page); the `website` route renders it and fetches the data only on that route.
   - `screens/website.tsx` reads the model for: the address under the title, "Last checked {Mon D}" (or "Not checked yet"), the gauge (`HealthGauge` already takes `value` and `max`), its aria label, the three tiles, the filter pills
     and their counts, the check rows, the fix sheet's text (the check's group and result), the top-fix card (heading `Top fix · +{open} points`, the snippet, Send and Copy) and the hand-off panel, and NORA's notes. A missing section draws
     nothing (not zero). Layout, colours, icons and sheets are unchanged. The state colours and icons are the page's (fail red x, warn amber alert, pass green check).
   - **Edits stay in the browser:** Re-check (the progress bar), Send, Copy and the hand-off steps only change on-screen state; the page still says nothing about a real fetch. The Happyflow source guard (no `fetch`, no write call) still
     passes and its file count is updated.
   - The notice above a real page is Home's: "Mock data · these values come from the local database and are not your real score or activity." when the data is mock.
5. **The seed** (`seat/seed_home.py` with a new pure builder `seat/seed_web_plan.py`; same CLI, guards, mandatory `--backup-to`, one repeatable-read transaction, `--as-of`): writes ten `web_checks` rows per seat, deterministic and labelled mock,
   and corrects three existing mock values (W3, W4). It builds from the Home plan (lane points, articles), the Profile plan (facts) and the website row, and runs after them. The rules it keeps (each a test over the written rows):
   - **The four scored checks add up to the seat's website lane** (W5, W6): `nap` is 10 points for each of name, address and office phone present in the Profile (so 30 with an address, 20 without); the rest of the lane's points, `lane − nap`,
     are shared over `entity_markup` (42), `indexing` (20) and `service_pages` (10) within their caps. The split of 102 into 42, 30, 20 and 10 is the prototype's (mock, unruled). This is feasible on the live data (checked 2026-10-27): every seat's newest lane is at least 31 and at most 102, and the 7 seats with no address have 89 or fewer (the most the other three checks can hold when `nap` is 20 is 92); the seed refuses a seat where it would not be.
   - **A check's state agrees with its points** (W8): full points pass, none fail, in between warn; the database enforces it.
   - **Markup agrees with the other pages** (W4): `entity_markup` points 0 means SRS says "No markup" and Home says "Markup is missing on your site"; between 1 and 41 "Partial markup" and "Markup is incomplete on your site"; 42 "Full markup"
     and "Your markup is complete". (Today the SRS text and the Home move text are drawn independently of the lane points and of each other.)
   - **Speed** (W9): the result lists LCP, INP and CLS; the state is the worst of the three by the web-vitals thresholds (LCP good up to 2.5 s, poor above 4 s; INP good up to 200 ms, poor above 500 ms; CLS good up to 0.1, poor above
     0.25); the headline is the metric that sets the state (`LCP 3.1 s`, `INP 420 ms` or `CLS 0.31`; the LCP when all three are good).
   - **AI readiness** (W10): five signals (GPTBot allowed in robots.txt, llms.txt, an FAQ, content in the page HTML, clear title and description tags); the result names all five as present or missing, the headline is `{k} of 5` with `k`
     the present ones, and the state is pass at 5, warn at 2 to 4, fail at 0 or 1.
   - **Content** (W11): the state and the result follow the seat's published articles (the count Home shows): 3 or more pass ("Blog with N posts"), 1 or 2 warn, none fail ("No blog").
   - **Service pages** (W12): a failing result names only products the seat has in its Profile (or says "No service pages" when it has none).
   - **Conversion** (click-to-call and a booking link), **Reviews on site** (widget installed or not) and **Indexing** (indexed, sitemap) have results that agree with their state (pass, warn, fail). **Security** follows the site's own address: `https://` passes and `http://` fails (W21).
   - **Home follows the markup** (W22, W23): the "Fix my website" move and the weekly brief's next move are worth what markup has open (the brief at least 1); the brief's "Website markup fixed" is kept beside complete markup, becomes "Website markup improved" beside partial markup and is dropped (its points go to the first item left) beside no markup.
   - Same date twice changes nothing; a later date changes no `web_checks` row (nothing in them is dated); backups cover the new table and the three corrected values.

## Acceptance criteria
1. `GET .../website` for the signed-in user's own seat returns 200 with the shape in step 2; another seat's id returns 403 `not_your_seat` before any other read; a Supabase session 501; a database error 503.
2. The read uses a read-only transaction, issues only `SELECT`, and reads only `tier_agents`, `users`, `home_snapshots`, `home_snapshot_lanes`, `home_score_lanes`, `website_analytics_data`, `profile_facts` and `web_checks` (a test asserts the SQL;
   no `agents_website_data`, `website_analytics_categories`, `audits`, `google_analytics`).
3. The gauge equals the SRS page's `website` lane (earned and max) and Home's Website tile for the same seat (a real-Postgres test calls the three).
4. The four scored checks' points add up to `health.earned` and their maxima to `health.max` for every seeded seat; `nap` is 10 per element of name, address and phone present in the Profile.
5. For every seeded seat the ten checks exist; a scored check's state agrees with its points; the unscored ones have no points; the tiles agree with their checks; `counts` add up to 10.
6. The markup state agrees with the SRS website gap text and the Home "Fix my website" move text for every seat (0, partial, full); the speed, AI readiness, content and service-pages rules of step 5 hold on the written rows.
7. `points_text`, the tiles, the top fix and the two notes follow step 3 with the exact numbers; each drop case (markup passing, AI readiness passing, no snapshot, no website row, no facts) is tested.
8. A seat with no `web_checks` row is `ready: false` with null sections; a missing section is empty or null, never zero.
9. The snippet is built from the Profile's facts only, is JSON-escaped (a quote or backslash in a fact cannot break it) and omits a missing part.
10. The database enforces: one row per seat and check, the ten keys, the three states, the five tiers, scored exactly for the four checks, `0 <= points <= max`, state agrees with points, a headline exactly for `speed` and `ai_readiness`.
11. The seed writes the rows and the corrections; a second run changes 0 rows; the backup holds the old rows and old values; the seed's text names no person.
12. UI model: `webAnalyticsModel` maps every section; unknown stays unknown; the sample model equals every constant it replaces (a table of values); the filter counts and tiles follow the states.
13. UI screen: a real seat shows its stored values and none of the prototype's (a list of sample constants that must not appear); with no real seat the page is the prototype's and the existing website and render tests pass unchanged; the sample markup
    rendered with the old and the new `website.tsx` is identical.
14. The local token reaches exactly nine routes (the eight today plus `.../website`); every other token-checking route still refuses a local token; no existing table's schema changes (catalog diff), and the only existing rows that change are the three corrections of W3 and W4.
15. `cd surface-api && SRP_TEST_DATABASE_URL=… uv run pytest` passes except the 3 known `test_migrations_security` failures; `ruff`, `bun test`, both `tsc` runs are clean.

## Data
- **Read** (owner SRP, schema `srp_cleanup`, all local): `tier_agents`, `users` (ownership, the name, the phone), `home_snapshots` and `home_snapshot_lanes` (the seat's website lane points), `home_score_lanes` (its maximum), `website_analytics_data` (URL and last
  scan), `profile_facts` (address, company) and the new `web_checks`.
- **Written**: only by the seed; the endpoint writes nothing.
- **New object and the existing objects it extends** (`extend-never-duplicate`; checked in the repo and in `v3_local` `pg_class` on 2026-10-27: no table holds a per-seat check result; `agents_website_data` is a legacy crawl snapshot with
  no state or points, `website_analytics_categories` is a 5-row category list, `audits` is a generic change log, `website_analytics_data` holds a URL, dates and mostly empty percentages):
  - `web_checks`: `id bigint identity`, `tier_agent_id` FK `tier_agents`, `check_key varchar(20)` CHECK in the ten, `state varchar(4)` CHECK in `fail, warn, pass`, `result varchar(240)`, `headline varchar(40) null`, `points integer null`,
    `points_max integer null`, `source varchar(60)`, `trust_tier varchar(20)` CHECK in the five tiers, `is_mock`; unique `(tier_agent_id, check_key)`, index on `tier_agent_id`; CHECKs: `(points is null) = (points_max is null)`, `points_max > 0`,
    `points between 0 and points_max`, `(points_max is not null) = (check_key in ('entity_markup','nap','indexing','service_pages'))`, `headline` not null exactly for `speed` and `ai_readiness`, and for a scored check
    `state = case when points = points_max then 'pass' when points = 0 then 'fail' else 'warn' end` (W2, W8).
  - **Reused, not duplicated:** the lane tables (the gauge), `website_analytics_data` (URL and date), `profile_facts` (the snippet and NAP), `home.parse_ids`, `owner_of`, `_iso`, `monthDay`, `HealthGauge`, the seed's guards and backup,
    `_allocate`.
  - **Corrected mock values in existing tables** (no schema change; backed up by the seed): `website_analytics_data.total_score` = the lane points (W3); the `you_text` of the `website` row of `srs_lane_gaps` and the `subtitle` of the
    `website` row of `home_next_moves` follow the markup state (W4).
- **Migration intent**: a local SQL script `surface-api/srp/db/local/web_analytics_schema.sql` outside Alembic and the closed `surface-api/migrations/` stream (and with no `docs/ETL-Enhancements.md` entry, ruled 2026-10-27): one transaction, additive,
  idempotent, commented rollback (drop the table); no RLS; `revoke all … from anon, authenticated, public` and `grant select, insert, update, delete … to v3_app` only. Run order: schema-only `pg_dump` of `srp_cleanup` outside the repo
  (mode 600), run, catalog diff, seed with `--backup-to`, JOIN checks. It needs your explicit go-ahead.
- **Corrected mock values in existing tables, in full** (W3, W4, W21 to W23; no schema change; backed up by the seed): `website_analytics_data.total_score`; the `you_text` of the `website` row of `srs_lane_gaps`; the `subtitle` and `points` of the `website` row of `home_next_moves`; the `next_move_points` of `home_weekly_briefs` and the website item of `home_weekly_brief_items`.
- **Provenance / trust tier**: every check carries a source label and one of the five tiers (a mock mapping: "From your site scan" is `platform_observed`; "From PageSpeed" and "From Google Search Console" are `imported`).

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | `GET /seat/professional/{id}/website`, as of the newest snapshot; unknown stays unknown (no snapshot gives `health: null`, a seat with no checks is `ready: false`, no URL or date is `null`) |
| Capabilities | none (read-only); a future "re-check my site" or "send the fix to my webmaster" capability would be an enrichment (a crawl) and an outbound message, both gated (O2) |
| Events | none |
| Entitlement | none; the page is not plan-gated in the prototype (it shows a plan banner from Home) |
| Explanation | the two note templates in step 3 and the points text, authoritative numbers only |
| Value loop | audit → NORA note and the ready-made code → the person (or the webmaster) installs it → next scan → the check passes, the website lane gains points, the SRS and Home figures rise |

## Security and scope
- Principal: a local sign-in session for its own seat only; delegation and impersonation are not served. Ownership is checked before any other read (`home.owner_of`).
- Grants: the new table to `v3_app` only; no RLS on new tables (owner ruling 2026-10-26); the script revokes from anon, authenticated and PUBLIC; no function and no trigger.
- Untrusted input: only the path id (`[0-9]{1,18}`), validated first; all values bound as parameters. Stored result lines and the Profile facts that go into the snippet are rendered as text, never as markup or instruction; the snippet
  is a text block (`<pre>`) and every inserted value is JSON-escaped. In a real feed, a fetched page, `robots.txt` and header values would be untrusted inbound content (out of scope).
- Shared core touched: only the route list in `surface-api/tests/test_local_token_scope.py` (eight to nine routes).

## Compliance
Nothing is published, sent or fetched. The check lines state what a scan found; they promise no ranking or outcome (the notes say a check is "worth N points" of the seat's own score, not of any search ranking). The snippet is the seat's
own Profile data (name, company, phone, address); for mortgage professionals the Profile's NMLS rule is unchanged and the snippet does not add a rate or approval claim. Generated content passes `content_compliance_rules` and
`exp_category_compliance` server-side before it is ever published (out of scope: nothing is saved or published here).

## Canon review
Run 2026-10-27 on the finished diff (`canon-review` skill). Verdict: **clear to proceed locally; merge blocked by the rulings below** (flagged, not resolved).

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Ownership | PASS | the new code reads and writes only SRP's own `srp_cleanup` tables; `web_analytics.py` imports only `home` from its own Surface and `seed_web_plan.py` only the Home and Profile plans; no `surfaces.<other>` import in the diff |
| 2 | Extend, never duplicate | PASS | `plan.md` records the live catalog and repo search; `website_analytics_data`, `agents_website_data`, `website_analytics_categories` and `audits` were considered and not extended; no schema change to an existing table |
| 3 | Identifiers | N/A | no gcid, record id or link table |
| 4 | Governed writes | N/A | no graph, search or category table written |
| 5 | Security | PASS | `web_analytics_schema.sql:73-74` revoke all from anon, authenticated and public and grant `v3_app` only; no RLS, policy, trigger, function or SECURITY DEFINER (2026-10-26 ruling); the read is read-only and ownership-first (`web_analytics.py:110-111`), the path id is validated and every value is bound; the snippet is JSON-escaped and rendered as text; no secret in the diff |
| 6 | Model vs code | PASS | no model is involved; the notes and the snippet are deterministic; a Supabase session gets `not_implemented` (501) |
| 7 | Gated actions | PASS | no cron, indexing, enrichment or dirty-queue draining; Re-check and the webmaster hand-off stay on-screen simulations, and a real crawl or send is listed as O2 |
| 8 | Compliance | PASS | nothing is published, sent or fetched; the snippet is the seat's own Profile data and adds no rate or approval claim; the notes promise no ranking |
| 9 | Scoring / rings | PASS | SRS v5 and the rings are untouched; the website lane is read, never recomputed |
| 10 | Open decisions | FLAGGED | O2 (a real crawl, audit and webmaster hand-off); unassigned scoring and identity ownership; the split of the 102-point website lane (42, 30, 20, 10 is the prototype's); the `srp_cleanup` name. The change-log point is ruled (no `docs/ETL-Enhancements.md` entry) |

## Second-model review
Run 2026-10-27 by an independent subagent given the code, the spec and `AGENTS.md` (not my conclusions), read-only, with `SELECT`s on `v3_local`. It derived the rules the page applies and the cross-page rules itself and checked the live data against them.

**Rules it checked with 0 violations (40 seats, 400 rows):** ten checks per seat; the scored points add up to the newest snapshot's website lane and their maxima to 102; `total_score` equals the lane; nap is 10 per Profile element; the markup state agrees with the SRS gap text and Home's move text; the speed state is the worst by the thresholds; AI readiness counts its five named signals and the states follow `k`; the content check equals Home's published-not-archived count; a failing service-pages result names only the seat's own products; source and tier mapping and caps; every row mock; no duplicate website row and a URL for every seat; no `\`, `<` or `>` in the facts; no website text in Home events or Insights notes. It also confirmed the grants, the read-only ownership-first read, the planners' determinism, no cross-Surface import and no people's names.

**Fixed (each with a test that fails without the fix; the seed re-run on `v3_local` is pending your go-ahead):**
- **Finding 1 (medium): Security failed with "served over HTTP" for 4 seats whose address is `https://`.** Security now follows the site's address when it is known (W21; all seeded addresses are https, so they all pass). Tests: https and http, case and spaces, and the stored rows by JOIN.
- **Finding 2 (medium): Home's weekly brief said "Website markup fixed" for 22 seats whose markup is failing or partial.** The item now follows the markup state (W23). Tests: the plan's rules, the totals and positions kept, and the stored rows.
- **Finding 3 (medium): Home's "Fix my website" move was worth the whole lane's open points (up to more than markup can be worth) while its subtitle names markup and the page says "+N points".** The move and the brief's next move are now worth what markup has open (W22). Tests: plan, stored rows, and the web read against Home for every seat.
- **Finding 5 (low-medium): the AI note said "AI can't read your page yet." for seats at 4 of 5.** It now says "can only partly read" when the check needs work (W15). Tests: both states.
- **Finding 6 (low): the Speed tile showed the LCP, coloured by a different metric.** The headline is now the metric that sets the state (W9). Tests: the rule and a stored-row check.
- **Finding 8 (low, one part): "I've written the code." was shown with no code.** Hidden when there is no snippet (W25). Test added; the sample markup comparison with `HEAD` was repeated and is identical.
- **Finding 9 (low): an HTML comment opener in a value could swallow the snippet's closing tag.** Written as a JSON escape (W24). Test: the output is valid JSON with the same text.

**Recorded, not changed:**
- **Finding 4 (medium): the SRS Articles gap text and the Content check disagree for 37 of 40 seats.** The Content check follows Home's Articles tile (the published count, W11) as designed; the SRS Articles gap, the Articles lane points and the weekly brief's article flags were drawn independently in the Home increment, so the SRS and Home pages already disagree with each other. Aligning them needs a change to the Home plan's article lane and `voce_articles` together, a Home-increment change; recommended as a follow-up.
- **Finding 7 (low):** the legacy percentage columns of `website_analytics_data` are random mock values that nothing reads; `is_wa_enabled` is false for 8 seats that show a full audit. Not read by the page; recorded.
- **Finding 8, other parts (low):** Re-check says "Last checked just now" without a scan (the prototype's simulation); the screen's last-check state does not follow a refetch of the same seat; a failed read or `ready: false` shows the prototype's sample page as on the earlier pages. Recorded.
- **Finding 10 (low):** the seed cannot split a full lane for a seat with no address (found with more than 40 seats); nothing at read time checks that the scored points sum to the lane if the lane or the Home plan is re-seeded alone (the seed and tests keep them equal; a live drift check is the trace's JOIN). `@type` FinancialService is fixed for every category (W16).

## Decision log entries
| # | Date | Decision | What it blocks |
|---|---|---|---|
| W1 | 2026-10-27 | (confirmed) The gauge is the SRS v5 website lane of the seat's newest snapshot (earned of its maximum) | the real website scoring rule |
| W2 | 2026-10-27 | (confirmed) One new table `web_checks`, one row per seat and check, with the state, result line, optional points and a source and tier | a real audit feed |
| W3 | 2026-10-27 | Home's Website tile reads `website_analytics_data.total_score`; the seed corrects that mock column to the lane points (backed up), so Home, SRS and this page agree | which of the two is the product's website score |
| W4 | 2026-10-27 | The SRS website gap text and the Home "Fix my website" move text are corrected by the seed to follow the markup state (none, partial, full), because today they are drawn independently of the lane points and of each other (12 seats say "No markup" with more than 60 lane points, which the four-check split makes impossible) | the real lane texts |
| W5 | 2026-10-27 | `nap` is 10 points for each of name, address and office phone present in the Profile; the rest of the lane's points go to markup, indexing and service pages within their caps (42, 20, 10) | the real split of the lane |
| W6 | 2026-10-27 | The four scored checks and their maxima (42, 30, 20, 10, adding to the lane's 102) are the prototype's, mock and unruled | scoring ownership |
| W7 | 2026-10-27 | `entity_markup` is full only when the lane leaves it no choice, that is when the other three checks hold their 72 points at most (the whole lane is full for the 6 address-holding seats today); otherwise markup is none or partial. A seat's "No markup" of the Home plan is kept wherever its lane allows it | none |
| W8 | 2026-10-27 | A scored check's state is derived from its points and the database enforces it | none |
| W9 | 2026-10-27 | Speed's state is the worst of LCP, INP and CLS by the web-vitals thresholds; the headline is the metric that sets the state (second review, finding 6; it was the LCP) | the real speed source |
| W10 | 2026-10-27 | AI readiness is five signals; the result names all five (the prototype's line names four and shows "2 of 5"); the headline is `k of 5`; pass at 5, warn at 2 to 4, fail at 0 or 1 | the real readiness checks (O2) |
| W11 | 2026-10-27 | The Content check follows the seat's published articles (Home's count), so the page cannot say "No blog" beside published articles | the real content check |
| W12 | 2026-10-27 | A failing Service pages result names only products the seat has in its Profile | none |
| W13 | 2026-10-27 | Points text: only the markup check shows `+N open`; other scored checks show `earned of max`; unscored show `Pass` or a dash (the prototype's own pattern) | none |
| W14 | 2026-10-27 | The top-fix card (code and Send) is shown only when markup is not passing | none |
| W15 | 2026-10-27 | NORA's two notes are computed templates over the markup and AI readiness checks (the second body is the check's own result line; its title says "can't read" only when the check fails and "can only partly read" when it needs work, second review finding 5), not stored text | a stored, editable note set |
| W16 | 2026-10-27 | The JSON-LD snippet is a template over the Profile's name, company, phone and address, JSON-escaped, with missing parts omitted; the sample page keeps its own snippet | schema.org type per category |
| W17 | 2026-10-27 | Re-check, Send, Copy and the hand-off steps stay on-screen simulations; "Last checked" shows the stored date; no fetch, send or write | O2 and an outbound path |
| W18 | 2026-10-27 | The local token is accepted on a ninth route (`.../website`); the change is the route list in the shared scope test | none, but needs shared-core review |
| W19 | 2026-10-27 | The 6 seats at the full lane keep Home's existing "Fix my website" move (0 points, subtitle "Your markup is complete") and the brief's "Fix my website" next move (1 point); replacing them is a Home change outside this increment, recorded | a Home next-move rule |
| W20 | 2026-10-27 | `last_refreshed_time` is shown as it is (the Home seed's mock dates, months before 2026-10-27 for some seats); correcting it is not part of this increment, recorded | none |
| W21 | 2026-10-27 | (second review, finding 1) Security follows the site's address when it is known (https passes, http fails); the seeded addresses are all https, so every seeded seat passes | the real security source |
| W22 | 2026-10-27 | (second review, finding 3) Home's "Fix my website" move and the brief's next move are worth what markup has open, as the move's subtitle says; they were the whole lane's open points | the real move-points rule |
| W23 | 2026-10-27 | (second review, finding 2) The weekly brief's "Website markup fixed" follows the markup state (kept, "improved", or dropped with its points given to the first item left) | a Home brief rule |
| W24 | 2026-10-27 | (second review, finding 9) The snippet writes a closing script tag and an HTML comment opener inside a value as JSON escapes (`<\/`, `<\u0021--`) | none |
| W25 | 2026-10-27 | (second review, finding 8) The top-fix card says "I've written the code." only when there is code (the Profile has a name) | none |
