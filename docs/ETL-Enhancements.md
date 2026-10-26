# ETL Enhancements — Scraper Architecture: Gaps, Fixes, and Rollout Plan

Status as of this document: Phase 0, Phase 1, and the first slice of Phase 2 shipped (see below). Phase 3's Fix 1 (generic page→category tagging), Fix 2 (generic deep-extraction prompt/source lookup), and Capability A (find pages / pull ready-made lists) are also shipped; Fix 3 is parked. The rest of Phase 3 (B, C, D), and Phases 4–5, are planned, not yet built. **See "Production dependencies" immediately below for what's open before go-live.**

## Production dependencies (open — track before go-live)

These are standing gates, not one-time TODOs — each stays true until someone explicitly resolves it, so anyone picking up this doc later should check this list first.

1. **`disco_worker_base_url` is a placeholder, not the production URL.** It's currently set to the preview URL (`https://id-preview--f3a72aef-0294-4fdf-bcad-77257ed344ef.lovable.app`). Every function routed through the worker (Phase 1 onward, including both Phase 2 pairs below) calls `net.http_post` against whatever this secret holds — permanently, on every invocation, not just once. **Must be updated via `vault.update_secret` to the real production domain before this project goes to production**, or every worker-routed scrape will silently fail against a stale host. Full detail: §5 Phase 1, change log.
2. **The four Phase 2 functions are deployed but not scheduled.** `exp_etl_start_recon`, `exp_etl_recon_collect`, `exp_etl_fetch_tick`, `exp_etl_fetch_collect` were rewritten to call the worker, but as of this writing none of them appear in `cron.job` (confirmed by querying it directly) — so this code has zero effect on production traffic until either a cron job is added to schedule them, or they're invoked manually. **Before relying on this pipeline in production, decide how/when to schedule these and validate against a handful of real domains end-to-end first.** Full detail: §5 Phase 2, change log.
3. **Harvest throughput is capped per site (scalability block).** `exp_etl_fetch_tick` (cron every minute) fetches at most **one page per domain per tick**, only after `min_delay_seconds` has passed since that domain's last fetch (30 s on the financial-advisor sources; 45 s when empty), and stops for the day once `daily_quota` is reached (100 on every financial-advisor source). The quota counts every fetched frontier row of the domain, sitemaps included. The whole engine allows at most 25 pages in flight (`status='fetching'`). **Effect:** at quota 100, a site with 10,000 profile pages needs about 100 days; even with the quota removed, one page per minute caps a site at 1,440 pages a day (about a week per 10,000 pages). The legacy LLM extraction adds a second cap: `exp_etl_extract_tick` handles 3 pages a minute across all sources (the rule-based harvest planned in Phase B removes it for sources with a site contract). Every fetch also goes through paid Oxylabs (see Master Checklist DR-23), so raising throughput raises cost. **Before any bulk run, decide per source:** the daily quota, the per-site pace (pages per tick and delay), the global in-flight cap, and the proxy budget — all within robots/ToS (Master Checklist DR-24). Found 2026-09-25 while planning the Phase B harvest.


## 0. Why this document exists

`disco-ai-worker.ts` and `disco-webscraper-worker.ts` were just introduced as a TanStack
server-route pair that fetches target websites through Oxylabs (proxy rotation, bot-block
detection, render fallback) instead of a plain `fetch()`. That refactor exposed a bigger,
pre-existing problem: most of this project's actual site-scraping still happens as plain,
unproxied `net.http_get`/`net.http_post` calls made directly from PL/pgSQL functions on a
pg_cron schedule. Those functions were never touched by the disco-ai-worker refactor and
still fetch target sites with no proxy, no bot-block handling, and no render fallback.

This document lays out what was found, what's already fixed, and the phased plan to bring
the rest of the scraping surface onto the same architecture — including making the
StateFarm-only pipeline generic enough to run against any source.

## 1. Gaps identified (audit of every `net.http_*` call site)

Thirteen `public` schema functions call `net.http_*` directly. Seven of them call
first-party APIs (Anthropic, Google's official Business Information API, IndexNow, Google
Indexing API) with proper bearer/API-key auth — those are out of scope for this work, they
aren't scraping arbitrary target websites and don't need Oxylabs:

- `exp_audit_tick`, `exp_audit_tick2`, `exp_etl_extract_tick`, `exp_sec_tick`,
  `exp_engine_tick` — all call `api.anthropic.com` directly.
- `exp_gbp_capture_tick` — calls Google's `mybusinessbusinessinformation` API with a bearer
  token.
- `exp_index_submit_tick` — calls IndexNow and Google's URL Indexing API.

The other six are genuine, unproxied scrapes of arbitrary external company websites, each a
tick/collect pair (tick fires the async `net.http_get`/`post`, collect reads the result back
out of `net._http_response` later):

| Tick function | Collect function | What it scrapes | Notes |
|---|---|---|---|
| `exp_sf_fetch_tick` | `exp_sf_parse_tick` | `exp_etl_staging.detail_url` (insurance_agent detail pages) | Generic-looking, gcid-scoped |
| `sf_tick` | `sf_collect` | StateFarm state-index / city / agent pages (`sf_frontier`) | **Hardcoded to statefarm.com** — see §4 |
| `sfh_tick` | `sfh_collect` | Entity hydration pass over `sfh_frontier` | **Hardcoded to statefarm.com** — see §4 |
| `exp_etl_fetch_tick` | `exp_etl_fetch_collect` | Multi-domain frontier driven by `exp_etl_sources` (kw.com, remax.com, rocketmortgage.com, zillow.com, etc.) | The one genuinely generic, multi-source pipeline today |
| `exp_etl_start_recon` | `exp_etl_recon_collect` | `/robots.txt` for newly added source domains | |
| `exp_probe_methods` | `exp_probe_collect` | Homepage probe to set `exp_etl_sources.crawl_method` | Duplicates `disco-ai-worker.ts`'s `classifyMethod`, less capably (status-code + one regex, no bot-block/JS-shell detection) |

Concrete evidence this isn't theoretical: `exp_etl_sources` already has multiple domains
marked `crawl_method = 'blocked_needs_proxy'` (kw.com, remax.com, rocketmortgage.com,
realtor.com, zillow.com, bhhs.com, howardhanna.com, sothebysrealty.com) that
`exp_etl_fetch_tick` fetches anyway with a plain `net.http_get` — those fetches are almost
certainly failing today.

Four structural problems, not just "add a proxy":

1. **Parsing lives in regex inside SQL.** `sf_collect` and `sfh_collect` extract JSON-LD via
   `regexp_matches(r.content, 'application/ld\+json[''"]>([^<]+)</script>', 'g')` and
   `::jsonb`-cast whatever the regex captured, inside a bare
   `EXCEPTION WHEN OTHERS THEN CONTINUE` that silently drops parse failures. No type
   checking, no unit tests, no visibility into what got dropped.
2. **Backpressure is hand-rolled per function.** `exp_sf_fetch_tick`, `sf_tick`, `sfh_tick`,
   and `exp_gbp_capture_tick` each independently reimplement "count in-flight rows in a
   tracking table, bail if over N" as a copy-pasted guard clause.
3. **No plumbing exists yet for PL/pgSQL to call the project's own worker endpoints.**
   `DISCO_WORKER_KEY` and the project's public base URL currently exist only as
   `process.env` values inside the TanStack server process. `vault.decrypted_secrets` is
   empty; no config table (e.g. `exp_index_config`, which already holds IndexNow/Google
   Indexing credentials the same key/value way) holds a worker key or base URL today. A
   similar convention (`dev-weekly-reminder.ts`, guarded by `x-cron-secret` /
   `DEV_REPORT_CRON_SECRET`) exists in comments but has no actual pg_cron/pg_net caller
   wired up yet either — so there is no working precedent in this codebase for PL/pgSQL
   calling back into the app's own `/api/public/*` routes.
4. **Two tables track "crawl method" with different vocabularies.**
   `exp_etl_sources.crawl_method` uses `blocked_needs_proxy`/`js_needs_api`/`server_crawl`/
   `unprobed`/`unreachable`. `disco_site_contract.method` (see §4) uses the worker's own enum
   verbatim — `needs_proxy`/`needs_js_api`/`server_crawl`/`unreachable`/`unprobed` — enforced
   by a `CHECK` constraint. These are two independent columns on two different tables that
   mean the same thing and don't share spelling. Phase 2's `exp_etl_fetch_tick` already has
   to hand-map between them (`blocked_needs_proxy → needs_proxy`, `js_needs_api →
   needs_js_api`) just to call the worker — see the Phase 2 change log. Not a blocker, not
   being unified now; tracked here so the next person touching either table isn't surprised
   the values don't match.

## 2. Fixes already applied (Phase 0 — shipped)

- **`disco-webscraper-worker.ts`** (new file) — shared Oxylabs fetch layer:
  proxy request/response, bot-block signal detection (captcha, cf-challenge, "access
  denied", rate-limit signals, etc.), automatic render-fallback retry when the plain fetch
  looks blocked, and a typed `ScrapeRequest`/`ScrapeResult` contract. Auth via
  `x-disco-worker-key` header checked against the `DISCO_WORKER_KEY` secret. Reads
  `OXYLABS_USERNAME`/`OXYLABS_PASSWORD` (required) and
  `OXYLABS_ENDPOINT`/`OXYLABS_GEO_LOCATION`/`OXYLABS_USER_AGENT_TYPE`/`OXYLABS_TIMEOUT_MS`/
  `OXYLABS_RENDER_TIMEOUT_MS` (optional) — all confirmed present as secrets on this project.
- **`disco-ai-worker.ts`** (updated) — `classifyMethod` and `mapSite` now delegate every
  target-website fetch to `scrapeWebsite()` in the new worker instead of a raw `fetch()`
  with a hardcoded UA and a 15s timeout. `crawl_method` is threaded through the whole call
  chain and back out in the `map_site` result payload
  (`crawl_method`, `rendered_fetch_possible`).

This closes the gap for the AI-driven discovery path (`discover_companies`,
`classify_method`, `map_site`, driven by `disco_llm_requests`). It does **not** touch any of
the six PL/pgSQL tick/collect pairs in §1 — those still fetch plain. That's Phases 1–5.

## 3. Architecture: what goes in RPCs vs. what goes in TS/JS, and how they talk

**Verdict: not "RPC vs TS" — a split.** Postgres keeps owning state and the safety
boundary; TS/JS owns fetching, parsing, and calling external services.

**Stays in Postgres (RPCs / tables):**
- The queue and state tables themselves — `exp_etl_frontier`, `exp_etl_staging`,
  `exp_etl_sources`, `sf_frontier`/`sfh_frontier` (or their generic replacement, §4),
  `exp_etl_fetch`/`exp_etl_fetch_requests`, etc. This data is inherently relational and
  needs transactional guarantees (dedup via `ON CONFLICT`, `FOR UPDATE SKIP LOCKED`,
  advisory locks) that belong in the database.
- **Governed ingest RPCs** — the only way a worker is allowed to write results back. This is
  the same pattern `disco-ai-worker.ts` already uses (`disco_discover_ingest`,
  `disco_method_ingest`, `disco_map_site_ingest`) and it should extend to the six pairs in
  §1. Proposed new RPCs (names indicative, to be finalized in Phase 2):
  - `exp_etl_stage_ingest(p_source_id, p_gcid, p_entity_type, p_payload, p_identity_candidates, p_detail_url)`
    — replaces the raw `INSERT INTO exp_etl_staging` currently done inline in `sf_collect`.
  - `exp_etl_frontier_discover(p_domain, p_urls[])` — replaces the raw
    `INSERT INTO sf_frontier`/`exp_etl_frontier` done inline during link discovery.
  - `exp_entity_hydrate_ingest(p_entity_id, p_attributes, p_products[])` — replaces the raw
    `UPDATE exp_entity SET attributes = ...` in `sfh_collect`.
  - `exp_etl_recon_ingest(p_source_id, p_robots_result)` — replaces the raw
    `UPDATE exp_etl_sources SET recon = ...` in `exp_etl_recon_collect`.
  - `exp_etl_source_method_ingest(p_source_id, p_method, p_evidence)` — replaces the raw
    `UPDATE exp_etl_sources SET crawl_method = ...` in `exp_probe_collect`. Before building
    this new, check whether the existing `disco_method_ingest` already targets a compatible
    shape and can be reused instead of duplicated — needs inspection, not assumed.
  - These RPCs are where validation belongs (the field-floor / detail-pattern checks that
    already exist for `disco_map_site_ingest` are the model: reject malformed payloads
    rather than silently accepting them).

**Moves to TS/JS (workers, modeled on `disco-ai-worker.ts`):**
- All HTML/JSON-LD parsing currently done via regex inside PL/pgSQL (`sf_collect`,
  `sfh_collect`, `exp_etl_fetch_collect`'s sitemap/entity extraction). A real HTML parser
  (e.g. a DOM/cheerio-style library) replaces the regex-and-hope approach, with proper error
  handling instead of `EXCEPTION WHEN OTHERS THEN CONTINUE`.
- Fetch orchestration: reading the next batch of queued work, calling
  `scrapeWebsite()`/the worker, and writing results back through the governed RPCs above.
- Backpressure/concurrency: one shared, tested implementation instead of four copy-pasted
  in-flight counters.
- `classify_method` duplication: `exp_probe_methods` retires in favor of dispatching a
  `classify_method` job to `disco_llm_requests`, reusing `disco-ai-worker.ts`'s existing,
  better implementation instead of maintaining a second one.

**How they communicate:**
- Postgres → TS stays event-driven via pg_cron + pg_net, same as today, but the *target* of
  `net.http_post` changes from an external site to the project's own `/api/public/*`
  endpoint. This keeps the existing async contract (`net.http_post` returns a `request_id`
  immediately, the real result lands in `net._http_response` later) — no change to the
  tick/collect *shape*, only to what's being called and what's in the response body.
- **Required before any tick function can do this (Phase 1 blocker):** `DISCO_WORKER_KEY`
  and the project's base URL need to be readable from SQL. Recommended: Supabase Vault
  (`vault.secrets`), not a plaintext config-table column — this project already has one
  live example of the plaintext-secret mistake (the `anthropic_key` column on
  `exp_engine_vault`) and shouldn't repeat it for a second credential.
- **Response-shape change every collect function must handle:** today
  `net._http_response.content` is the raw target page body and `.status_code` is the
  target's real HTTP status. Once a tick calls the worker instead, `.status_code` becomes
  the *worker's own* status (200 or 502) and `.content` becomes a JSON envelope
  (`{ok, status_code, content, resolved_url, rendered, error, oxylabs}`) — the real page
  body is now nested at `.content` *inside* that JSON, not the response body directly. Every
  collect function in §1 needs this unwrap step added.
- **`crawl_method` needs to start flowing both directions.** None of the six tick functions
  currently read `exp_etl_sources.crawl_method` before fetching — they all fetch blind. Once
  routed through the worker, the tick should pass the known `crawl_method` in the request
  body (mirroring what `disco-ai-worker.ts`'s drain loop already does), and the collect
  function should persist any `crawl_method`/`rendered` signal the worker returns back onto
  `exp_etl_sources`, closing the loop that `exp_probe_methods` used to serve alone.
- **Timeout/volume mismatch to resolve, not ignore:** the worker's own timeouts (60s
  normal fetch, 180s rendered) are longer than several tick functions' current
  `timeout_milliseconds` (20–45s), and `exp_etl_fetch_tick`/`sf_tick`/`sfh_tick` can have
  70–150 requests in flight on a 1-minute cron cadence against what is currently a
  synchronous, non-queued worker endpoint. This needs a concurrency/timeout decision in
  Phase 2, not a mechanical find-and-replace of the URL being called.

## 4. Making the StateFarm pipeline generic

`sf_tick`/`sf_collect` and `sfh_tick`/`sfh_collect` are hardcoded to one vendor today:

- `sf_collect` hardcodes `WHERE source_domain='statefarm.com' AND gcid='gcid:insurance_agency'`
  and a literal StateFarm URL pattern:
  `'https://www.statefarm.com'||(regexp_matches(r.content, '(/agent/us/'||f.state||'/[a-z-]+)', 'g'))[1]`.
  Every row it writes is hardcoded to `gcid = 'gcid:insurance_agent'` with
  `extraction: 'sf_jsonld'`.
- `sfh_collect` checks a generic schema.org type (`IF b ~ 'InsuranceAgency'`) but only
  operates on entities that already have a StateFarm `detail_url` (fed exclusively by the
  `sf_*` pipeline), and hardcodes the domain when linking products back:
  `exp_etl_map_or_add_product('gcid:insurance_agent', v_prod, 'statefarm.com')`.

This is architecturally different from `exp_etl_fetch_tick`, which is already
source-agnostic and driven entirely by rows in `exp_etl_sources`.

**Decision: `sf_*`/`sfh_*` are left untouched, indefinitely.** Rather than migrating
StateFarm onto a generic model — which would mean rewriting a pipeline that already works,
purely to prove genericness — Phase 3 builds a *parallel* generic, contract-driven crawl
path that any source, new or existing, can opt into. StateFarm's own pipeline keeps running
exactly as it does today, with zero regression risk. If StateFarm is ever migrated onto the
generic path, that's a separate, later, optional decision made only after the generic path
is proven elsewhere.

**No new table needed — `disco_site_contract` already holds exactly this, and it's unused.**
Checked directly against the live schema: `disco_site_contract` has
`UNIQUE(domain, category_slug)` — the same natural key as `exp_etl_sources`'
`source_domain`/`gcid` (confirmed `category_slug` already uses the identical `gcid:*`
format, e.g. `gcid:mortgage_lender` appears in both) — plus `roster_pattern`,
`detail_pattern`, `extraction` (jsonb), `field_floor`, `method`, `learned_by`, `learned_at`.
It's written today by the AI-discovery path (`disco_map_site_ingest`/`disco_method_ingest`)
but currently has zero rows, and other than one completeness-check helper
(`disco_check_method_complete`), nothing reads it for actual crawling. This maps directly
onto what StateFarm hardcodes today:
- **URL-discovery pattern** (currently the literal regex `/agent/us/{state}/[a-z-]+` in
  `sf_collect`) → `roster_pattern`/`detail_pattern`.
- **Accepted JSON-LD type(s)** (currently the literal string `'InsuranceAgency'` in
  `sfh_collect`) → `extraction` (jsonb).
- **Target gcid** — already generic via `exp_etl_sources.gcid`; `disco_site_contract`'s
  `category_slug` uses the same value, so no translation is needed.

Adding a second config table, or bolting these fields onto `exp_etl_sources` directly, would
duplicate a table that already exists for this exact purpose and is sitting unused.

**The actual gap is code, not schema.** `exp_etl_fetch_tick`/`exp_etl_fetch_collect` (the
pipeline Phase 2 rewired) don't yet know how to read or apply a `disco_site_contract` row —
today they only understand sitemap-XML `<loc>` discovery and dumping fetched page text into
the LLM extraction queue. Building the generic path means adding one new branch on the
collect side: when a `disco_site_contract` row exists for a domain, use `roster_pattern` to
pull candidate detail-page URLs out of plain HTML (a configurable version of what
`sf_collect`'s hardcoded regex already does), and use `extraction` to pull structured/
JSON-LD fields directly (a configurable version of what `sf_collect`/`sfh_collect` already
do) — falling back to today's sitemap/LLM behavior when no contract row exists, so nothing
already working regresses. Onboarding a new source becomes inserting one
`disco_site_contract` row and one `exp_etl_sources` row — no new PL/pgSQL function per
source. See §5 Phase 3 for the concrete plan.

## 4A. Full current-architecture map (verified 2026-09-22)

This section was added after reading every ETL-related function body and table schema directly from the live database (not from memory or prior docs), per an explicit request to fully understand the system before any Phase 3 work proceeds. It documents what actually exists and runs today. Nothing in this section is a proposal — it is a description of the current, as-built system.

### 4A.1 The three storage models, and which one is "live"

There are three places entity data can end up, and they are not the same thing:

1. **`organizations` / `professionals`** — the production tables. They carry `search_rank_score`, `claimed`/`claim_method`/`claim_confidence`, GBP sync fields, hierarchy/territory fields. `search_documents` (the actual search index — 39,464 rows) is built almost entirely from these: 19,301 `professional` rows and 20,157 `location` rows. Only 300 of those 39,464 rows trace back to `exp_entity` at all. **This is the table pair the live product actually searches and scores against.**
2. **`exp_entity` / `exp_rel`** — a separate, generic entity-graph model (36,439 entities; relationship types `CLASSIFIED_AS`, `REPRESENTS`, `WORKS_AT`, `OPERATES_UNDER`, `FRANCHISE_OF`, etc., all type-checked against a canon table `exp_rel_types`). It holds two things: (a) a **frozen, one-time copy of StateFarm** — 19,851 professionals + 16,519 locations, `source='etl_statefarm'`, every single row last touched between 15:06 and 19:49 UTC on 2026-08-03, never since (matches: the pipeline that wrote it, `sf_tick`/`sf_collect`/`sf_resolve`, is not in `cron.job`) — and (b) the **RE/MAX pilot**, 23 professionals + 6 brands + 2 locations + 2 teams, `source='etl_remax_pilot'`, also not scheduled. This model is real, working code, but it is **not what the live product reads** — see point 1.
3. **`graph_nodes`** — a separate evidence/scoring ledger (ring/ring_key/ring_layer/score_points columns), keyed to `organizations`/`professionals` IDs (confirmed: `exp_sf_nodalize(p_pro, p_office, ...)` is called with a `professionals.id`/`organizations.id`, not an `exp_entity.entity_id`). This feeds the separate "8-ring expertise graph" content/scoring engine (`exp_engine_*`, `exp_validate_*`, `exp_ring_*`, `exp_xmp_*` — a different subsystem entirely, generating category-level content via its own Anthropic calls, out of scope for this ETL document).

The claim workflow has the same split: `exp_claim`/`exp_claim_request`/`exp_claim_adjudicate` operate only on `exp_entity.claim_state`; `organizations`/`professionals` have their own independent `claimed`/`claim_method`/`claim_confidence` columns, set by a different mechanism not covered by this audit.

### 4A.2 StateFarm: three separate pipelines, only one of them live

StateFarm is not one pipeline. It is three, built at different times, none of which know about each other:

| Pipeline | Writes to | Method | Scheduled? |
|---|---|---|---|
| `sf_tick` → `sf_collect` → `sf_resolve` | `exp_entity`/`exp_rel` (via `exp_graph_create_entity`) | Direct `net.http_get`, no worker, no proxy. Regex-extracts JSON-LD `ItemList` off city pages into `exp_etl_staging`, then `sf_resolve` promotes to `exp_entity`. | No — not in `cron.job`. One-time historical run, frozen since 2026-08-03. |
| `sfh_tick` → `sfh_collect` | `exp_entity.attributes` (light enrichment on top of the above) | Direct `net.http_get`. Regex-extracts `InsuranceAgency`/`Offer` JSON-LD, feeds products through `exp_etl_map_or_add_product`. | No — not in `cron.job`. |
| `exp_sf_fetch_tick` → `exp_sf_parse_tick` (→ `exp_sf_parse` → `exp_sf_apply` → `exp_sf_nodalize`) → `exp_sf_renodalize_tick` | `organizations`/`professionals` + `graph_nodes` | Routed through `disco-webscraper-worker` (proxy + render fallback). Deep HTML scrape (licenses, team, photos) with its own hardcoded quality gate (`gate_passed`/`gate_reasons` inside `exp_sf_parse` — separate from, and unrelated to, `exp_etl_record_complete` below). | Yes — `sf-hydrate-fetch`, `sf-hydrate-parse` (every minute), `sf-renodalize` (every 5 min). This is the one actually running. |

So "the StateFarm pipeline" that Phase 3 keeps untouched, in practice, means: the third row. The first two rows already ran once, already put a full copy of StateFarm into `exp_entity`, and are dormant — worth knowing before assuming `exp_entity` is empty of StateFarm data.

### 4A.3 The RE/MAX pilot: generic-shaped, but not fully generic yet, and dormant

`exp_etl_fetch_tick`/`exp_etl_fetch_collect` (Phase 2 already routed these through the worker) feed `exp_etl_extract_tick`/`exp_etl_extract_collect` (an AI-based extractor — calls `api.anthropic.com` directly with a prompt that says "Extract structured entities from this RE/MAX page text", and `exp_etl_extract_collect` hardcodes `WHERE source_domain='remax.com'`) and a deterministic path (`exp_etl_extract_jsonld`, which defaults `national_brand` to `'RE/MAX, LLC'` when absent). Both feed `exp_etl_staging`. `exp_etl_resolve` then promotes staging rows to `exp_entity`/`exp_rel` — but it is itself RE/MAX-hardcoded (`domain='remax.com'`, `gcid:real_estate_agency`, `source='etl_remax_pilot'`, franchise sub-brand logic specific to RE/MAX's naming). It calls fully generic primitives underneath (`exp_graph_create_entity`, `exp_graph_add_rel`) — so genericizing this outer shell (parameterize domain/gcid/brand instead of hardcoding RE/MAX) is a smaller job than writing new resolve logic from scratch. None of this is scheduled in `cron.job`; total output to date is 23 professional + 6 brand + 2 location + 2 team rows.

### 4A.4 The generic graph primitives (real, reusable, already load-bearing)

These are fully generic today, not proposals:
- **`exp_graph_create_entity(type, name, gcid, identity_keys, source, rationale)`** — dedups by any identity key, creates the `exp_entity` row, auto-creates a `CLASSIFIED_AS` relationship, and requires a non-null `rationale` (every mutation is self-explaining, logged to `exp_curation_ledger`).
- **`exp_graph_add_rel(subject, type, object, ...)`** — validates the relationship type against `exp_rel_types` (a canon table restricting which entity types can be the subject of which relationship), manages "is_primary" singleton semantics, also rationale-mandatory and ledger-logged.
- **`exp_resolve_offices()`** — dedups `location` entities by normalized address, merges, retargets relationships.
- **`exp_guard_attribution()`** (trigger) — refuses to attach a professional/location to a brand if their web domains don't match (an "attribution firewall").
- **`exp_etl_map_fields()`** — generic staging→`exp_entity.attributes` hydrator (any gcid/entity_type).
- **`exp_etl_map_or_add_product(gcid, raw_value, source)`** / **`exp_etl_reconcile_value(...)`** — generic taxonomy reconciliation against `exp_taxonomy`, with unmapped values either auto-added (products) or queued for human ruling via `exp_etl_candidates` (specialties/other) — already shared by both `sfh_collect` (StateFarm) and the RE/MAX extractors.

All of these currently only run through the dormant `sf_resolve`/`exp_etl_resolve` call sites — nothing schedules them today.

### 4A.5 The quality-gate config layer is real but has exactly one row

`exp_etl_source_contract` (gcid, source_domain, expected_fields, required_fields, min_coverage, sample_pass_threshold) backs two generic functions — `exp_etl_record_complete(entity_id)` (checks one `exp_entity` row's `attributes` against its `CLASSIFIED_AS` gcid's contract) and `exp_etl_gate_full_pull(gcid, source)` (blocks scaling up a source until a ≥10-record hydrated sample clears the contract's pass threshold). **This table has exactly one row today: `gcid:insurance_agent` / `statefarm.com`.** (A prior note in this project's own history said 36 rows — that was wrong; verified by direct count just now.) And because these two functions read `exp_entity`/`exp_rel` exclusively, they gate nothing in the live `organizations`/`professionals` StateFarm pipeline — that pipeline's quality gate is the separate, hardcoded `gate_passed` logic inside `exp_sf_parse` (§4A.2, row 3).

### 4A.6 The AI-driven source-onboarding tool exists, is semi-manual, and is currently stalled

A full pipeline for onboarding a brand-new category exists: `exp_etl_activate_category` → `disco_activate` → `disco_dispatch` queues an AI "find the companies in this category" job (`disco_llm_requests`, tool `discover_companies`) → the AI's answer comes back through `disco_discover_ingest` → sits in `disco_proposals` for a **human** to approve via `disco_confirm_companies` → approved domains become `exp_etl_sources` rows → `disco_dispatch` queues one AI "what crawl method does this domain need" job per domain (`classify_method`) → the answer auto-approves through `disco_method_ingest`, which writes `exp_etl_sources.crawl_method` **and** upserts `disco_site_contract.method` → if crawlable, an AI "learn this site's URL/extraction pattern" job (`map_site`) fires automatically, and its answer lands in `disco_site_contract.roster_pattern`/`detail_pattern`/`extraction`/`field_floor` via `disco_map_site_ingest` → once every approved source for the category is resolved, `disco_check_method_complete` queues a `run` job.

This is real, tested code — not vaporware. Job 1 (`gcid:mortgage_lender`) got back a genuine 25-lender AI response back on 2026-08-11. But **nothing automatically answers a `disco_llm_requests` row** — there is no scheduled job that calls an LLM for `discover_companies`/`classify_method`/`map_site` the way `exp_etl_extract_tick` does for RE/MAX extraction; each step needs a human or an external agent to drive it forward. Right now, both categories ever started are stuck: job 1 has sat at `awaiting_human` since 2026-08-15 (nobody ever called `disco_confirm_companies`), and job 5 (`gcid:accountant`) has sat at `awaiting_ai` since 2026-08-22 (nobody/nothing ever answered its `discover_companies` request). **`disco_site_contract` still has zero rows** — no domain has ever completed the full discover → method → map_site loop, even though the machinery for it is built and once worked partway.

`exp_probe_methods`/`exp_probe_collect` is an older, cruder, non-AI crawl-method guesser (status code + one regex) that predates `disco_method_ingest` and duplicates it — already flagged for retirement in Phase 4 above; nothing new found here changes that.

### 4A.7 The admin/console control layer

A parallel, permission-gated (`exp_ctrl_has_role`) admin surface manages sources and categories independently of the AI pipeline: `exp_etl_add_source`, `exp_etl_approve_companies`, `exp_etl_set_source_status`, `exp_etl_set_limits`, `exp_etl_run_source`, `exp_etl_finish_run`, `exp_etl_check_saturation` (a self-healing check that detects and strips a "chrome" value — e.g. a cookie-banner phone number scraped as if it were every agent's real number — when one value repeats across roughly 15–30% or more of a source's records). Every action here is written to `exp_admin_audit`. `exp_etl_jobs` (one row per gcid, with `phase`/`stage`/`status`/`schedule_cron`/`next_run_at`) looks designed to eventually drive a dynamic per-category scheduler, but nothing currently reads `schedule_cron`/`next_run_at` to actually trigger a run — today's only real triggers are the fixed entries in `cron.job` below.

### 4A.8 `cron.job`, confirmed fresh

Only three ETL-related jobs are actually scheduled and running: `sf-hydrate-fetch` (`exp_sf_fetch_tick(50)`), `sf-hydrate-parse` (`exp_sf_parse_tick(300)`), `sf-renodalize` (`exp_sf_renodalize_tick(50)`) — all StateFarm's live, deep pipeline (§4A.2 row 3). Everything else described in this section — `sf_tick`/`sf_collect`/`sf_resolve`, `sfh_tick`/`sfh_collect`, `exp_etl_fetch_tick`/`exp_etl_fetch_collect`, `exp_etl_extract_tick`/`exp_etl_extract_collect`, `exp_etl_start_recon`/`exp_etl_recon_collect`, `exp_probe_methods`/`exp_probe_collect`, all of `disco_dispatch`'s downstream steps — has zero scheduled invocations and only runs if called by hand. (`engine_collect`/`engine_tick`, `index-sitemap-rebuild`, `post-r16-requeue`, `sentinel_arm`/`sentinel_sweep` are also active, but belong to the separate content/scoring/SEO engine, not ETL.)

### 4A.9 What this means for Phase 3, without deciding anything yet

This section doesn't change the Phase 3 plan above — it corrects and fills in the picture it was written against. Two things worth flagging before any Phase 3 code is written:
- Capability B/D's "generic version already exists" claim (§5 Phase 3) is more true than it looked: the underlying primitives (`exp_graph_create_entity`, `exp_graph_add_rel`, `exp_etl_map_fields`, `exp_etl_record_complete`) are genuinely generic and already proven at scale (36,000+ rows through them). What's StateFarm/RE-MAX-specific is only the thin outer shell (`sf_resolve`, `exp_etl_resolve`, `exp_sf_apply`) around them.
- Whatever Phase 3 builds, if it writes to `exp_entity`/`exp_rel` (as B/D's existing generic primitives do), it will not show up in search or scoring by default — `search_documents` is built overwhelmingly from `organizations`/`professionals` today (§4A.1). That's a fact to design around, not a decision this document is making.

### 4A.10 The generic (non-StateFarm) pipeline, traced end to end as it runs today

This traces the actual call chain, in order, for the one pipeline that is meant to work for any category — activate category → find sources → decide crawl strategy → harvest → extract → resolve → quality-check → hydrate. Every function named here was read directly; every "manual step" and "not wired up" claim below was checked against live data (the RE/MAX pilot is the only category that has ever gone through any of it).

1. **Activate a category.** `exp_etl_activate_category(gcid)` upserts `exp_etl_jobs` (phase='build', stage='identify_companies') and calls `disco_activate(gcid)`, which inserts a `disco_jobs` row (step='discover', status='queued') and calls `disco_dispatch()`.
2. **AI discovers companies.** `disco_dispatch()` builds a `disco_llm_requests` row (tool='discover_companies') carrying the category's boundary definition and complexity tier, and sets the job 'awaiting_ai'. **Nothing in the database answers this automatically** — an external agent or a human has to call an LLM and then call `disco_discover_ingest(request_id, companies_json)` with the result.
3. **A human approves the company list.** `disco_discover_ingest` validates the list and parks it in `disco_proposals` (state='pending'), setting the job 'awaiting_human'. A human calls `disco_confirm_companies(proposal_id, approved_domains[])`, which calls `exp_etl_add_source` (creates `exp_etl_domains`/`exp_etl_sources` rows, status='proposed') then `exp_etl_approve_companies` (flips the chosen ones to 'approved'), advances `exp_etl_jobs.stage` to 'method_split', and queues the next `disco_jobs` row (step='method').
4. **Recon (robots.txt) — a separate side channel, not wired into the sequence above.** `exp_etl_start_recon(source_id)` (console/manual call only) fetches `/robots.txt` through the worker; `exp_etl_recon_collect` → `exp_etl_recon_ingest` parses `sitemap:`/`disallow:` lines and writes `exp_etl_sources.recon` and `exp_etl_domains.sitemap_url`/`robots_status`. Confirmed live: this was only ever run for `remax.com` and `zillow.com`, both on 2026-08-02, and never for any other domain — nothing in the discover→approve→method sequence calls it automatically.
5. **AI classifies each approved source's crawl method.** `disco_dispatch()` queues one `disco_llm_requests` row (tool='classify_method') per approved source. Same manual gap as step 2: needs an external LLM answer, then `disco_method_ingest(request_id, domain, method, evidence)`, which writes `exp_etl_sources.crawl_method` and upserts `disco_site_contract(domain, gcid, method)`. If the method is `server_crawl`, it automatically queues a follow-up `map_site` request, then calls `disco_check_method_complete(gcid)`.
6. **AI learns the site's URL/extraction pattern (server_crawl sources only).** Same manual-answer pattern, landing in `disco_map_site_ingest(request_id, contract_json)` — refuses the contract unless it has a `detail_pattern` and `field_floor >= 5`. On success, writes `disco_site_contract.roster_pattern`/`detail_pattern`/`extraction`/`field_floor` and flips `exp_etl_sources.hierarchy_sourceable=true`. Calls `disco_check_method_complete(gcid)` again.
7. **"Strategy" is declared complete, but this only flips a status flag.** Once every approved source for the gcid has a resolved method (and, if server_crawl, a mapped `field_floor`), `disco_check_method_complete` marks the method job 'done' and queues a `run` job. `disco_dispatch()` picks that up and sets it to `status='running'` — it does not itself start any crawling.
8. **Harvesting is two more separate, disconnected steps.** A human calls `exp_etl_run_source(source_id)` (works only if `crawl_method='server_crawl'`; anything needing a proxy or JS rendering is refused here) — this just flips the source to 'active' and logs an `exp_etl_runs` row. Separately, `exp_etl_fetch_tick()` (not in `cron.job` — must be invoked by hand) walks `exp_etl_frontier` rows with `status='queued'` for any active source domain and posts each to the worker. **Nothing found seeds the very first frontier row automatically** — `exp_etl_frontier_discover()` (the only inserter) is only ever called from inside the sitemap-parsing branch of step 9 below, so at least one sitemap URL has to be inserted into `exp_etl_frontier` by hand to start the loop. Confirmed live: `remax.com` currently has 154 frontier rows (120 agent pages + 34 office pages) sitting in `status='queued'`, un-fetched, because nothing is pulling them on a schedule.
9. **Fetch results come back and split two ways.** `exp_etl_fetch_collect()` unwraps the worker's response. A `sitemap`/`sitemap_index` row gets its `<loc>` URLs pulled out and re-queued via `exp_etl_frontier_discover`. Any other page gets its text stripped of HTML and inserted into `exp_etl_extract_queue`. **Real gap found here:** at this exact point the function hardcodes which category a page belongs to — `office_page → gcid:real_estate_agency`, everything else → `gcid:real_estate_agents` — RE/MAX's own taxonomy baked into the one function that's supposed to be generic. A different category would be mis-tagged today.
10. **Deep extraction (AI reads the page text).** `exp_etl_extract_tick()` sends up to 3 queued pages' text to Claude with a prompt that is hardcoded to say "Extract structured entities from this RE/MAX ... page." `exp_etl_extract_collect()` reads the answer back but **only credits it to a source where `source_domain='remax.com'`** — also hardcoded. A separate deterministic path, `exp_etl_extract_jsonld`, defaults the brand name to `'RE/MAX, LLC'` when a page doesn't say otherwise. Confirmed live: only 14 pages have ever made it through this step (`exp_etl_extract_queue`, all `status='done'`), out of the 154 sitting queued in step 8 — so well under 10% of what was ever discovered has actually been extracted.
11. **Resolve into real entities.** `exp_etl_resolve()` is also RE/MAX-hardcoded (creates the RE/MAX national brand, handles RE/MAX-style franchise sub-brands) but calls the fully generic `exp_graph_create_entity`/`exp_graph_add_rel` underneath to write `exp_entity`/`exp_rel` rows. `exp_etl_map_fields()` (genuinely generic) then copies richer fields onto `exp_entity.attributes` and flips `hydration='hydrated'`. `exp_resolve_offices()` (also generic) periodically merges `location` entities that share a normalized address.
12. **Quality check — currently can't run for anything but StateFarm.** `exp_etl_record_complete(entity_id)` and `exp_etl_gate_full_pull(gcid, source)` both look up the entity's gcid in `exp_etl_source_contract` — and that table has exactly one row, for `gcid:insurance_agent`/`statefarm.com` (see §4A.5). Neither `gcid:real_estate_agency` nor `gcid:real_estate_agents` has a contract row, so both functions return `'no_contract'`/refuse for every RE/MAX entity today. The quality-check step exists in code but has never actually been able to fire outside StateFarm.
13. **Hydration.** Already covered in step 11 — `exp_etl_map_fields()` is the hydration step, it is not source-specific, and it is the one piece of this whole chain that is both generic and has been proven to actually run.

**Net picture:** the category-activation → AI-discovery → human-approval → AI-strategy steps (1–7) are real, tested, and mostly automatic apart from the two points that need a human or an external agent to answer an AI request. Everything after that (8–13: harvest, extract, resolve, quality-check, hydrate) is built, but currently only runs when someone manually invokes each function in order, nothing is on a cron schedule, and three of those steps (9's category-tagging, 10's extraction prompt/source filter, 12's quality gate) are either hardcoded to RE/MAX or empty of any config for a non-StateFarm category. Of the 154 pages this pipeline ever discovered for RE/MAX, 14 were extracted and roughly 33 entities were ever created.

## 5. Phased rollout plan

**Phase 0 — Oxylabs proxy layer for the AI-discovery path. SHIPPED.**
`disco-webscraper-worker.ts` created; `disco-ai-worker.ts` updated to route
`classify_method`/`map_site` through it. No PL/pgSQL changes.

**Phase 1 — Plumbing. SHIPPED.**
- `DISCO_WORKER_KEY` and the project's base URL are now stored in Supabase Vault
  (`vault.secrets`, read via `vault.decrypted_secrets`) as `disco_worker_key` and
  `disco_worker_base_url`, replacing the old `process.env`-only plumbing.
- New reader RPC: `public.exp_disco_worker_config()` — `SECURITY DEFINER`, returns
  `(worker_key text, base_url text)`, `EXECUTE` revoked from `PUBLIC`, `anon`, and
  `authenticated` — only reachable from trusted PL/pgSQL, never from PostgREST/API clients.
  Verified both columns resolve non-null.
- **Open production dependency — do not lose track of this:** `disco_worker_base_url` is
  currently set to the preview URL
  (`https://id-preview--f3a72aef-0294-4fdf-bcad-77257ed344ef.lovable.app`), not the
  production domain (`experience.com` or whatever it maps to). Every tick function wired up
  in Phase 2 onward calls `net.http_post` against whatever this secret holds, forever — it
  is a permanent runtime dependency, not a one-time setting. **Before this project goes to
  production (or before Phase 2 wires the first tick function to call the worker, whichever
  comes first), this secret must be updated to the real production base URL** via
  `select vault.update_secret((select id from vault.secrets where name =
  'disco_worker_base_url'), '<production base url>');` — otherwise every scrape routed
  through the worker will silently fail against a stale/wrong host.
- JSON response envelope contract: reconfirmed as the existing `ScrapeResult` type in
  `disco-webscraper-worker.ts` (`{ok, status_code, content, resolved_url, rendered, error,
  oxylabs}`) — no redesign needed.
- Concurrency/timeout policy decided for Phase 2: tick functions calling the worker should
  use a 45–60s `timeout_milliseconds` (matching the worker's own `OXYLABS_TIMEOUT_MS`
  default) and cap in-flight requests per tick at roughly 20–30, down from the current
  70–150, to stay inside Oxylabs' concurrency limits.
- No behavior changes yet — none of the six tick/collect pairs in §1 call the worker yet;
  they still fetch target sites directly. That's Phase 2.

**Phase 2 — Generalize the multi-source pipeline. FIRST SLICE SHIPPED** (`exp_etl_fetch_tick`/`exp_etl_fetch_collect` and `exp_etl_start_recon`/`exp_etl_recon_collect`; `sf_*`/`sfh_*`/`exp_probe_*` are Phase 3/4, untouched).
- Two new governed ingest RPCs, `SECURITY DEFINER`, `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated`:
  - `exp_etl_recon_ingest(p_source_id uuid, p_robots_result jsonb)` — validates the source
    exists and the payload is a JSON object, then does the `exp_etl_sources`/`exp_etl_domains`
    robots-parsing writes that used to be inline in `exp_etl_recon_collect`.
  - `exp_etl_frontier_discover(p_domain text, p_urls text[], p_kind text)` — validates
    `p_domain`, caps the batch at 40 URLs, then does the `exp_etl_frontier` inserts that used
    to be inline in `exp_etl_fetch_collect`'s sitemap-parsing branch.
- `exp_etl_start_recon` and `exp_etl_fetch_tick` now call `net.http_post` against
  `exp_disco_worker_config().base_url || '/api/public/disco-webscraper-worker'` (with the
  `x-disco-worker-key` header from the same config call) instead of `net.http_get` straight
  to the target site. Timeout raised from 30s/45s to 60s, matching Phase 1's decision.
- `exp_etl_fetch_tick` now actually reads `exp_etl_sources.crawl_method` (previously
  ignored) and maps it to the worker's enum: `blocked_needs_proxy → needs_proxy`,
  `js_needs_api → needs_js_api`, `server_crawl` unchanged, anything else (`unprobed`,
  `unreachable`, null) defaults to `server_crawl` — the same blind behavior as before, so
  nothing regresses for sources not yet classified.
- `exp_etl_fetch_tick` now enforces a global in-flight cap (25 concurrent `status='fetching'`
  rows) per the Phase 1 concurrency decision — it previously had no cross-domain cap at all.
- `exp_etl_recon_collect` and `exp_etl_fetch_collect` now unwrap the worker's JSON envelope
  (`resp.content::jsonb->>'content'` for the real body, `->>'status_code'` for the real
  target status, since `resp.status_code` is now the worker's own 200/502) before doing
  anything else, and write only through the two new RPCs above. Their other internal writes
  (frontier status transitions, the `exp_etl_extract_queue` insert for the LLM text
  extractor) are unchanged direct SQL — internal queue bookkeeping, not worker-supplied data
  being trusted blind.
- **Not yet scheduled:** none of these four functions are in `cron.job` today — confirmed
  by querying it directly. This migration has zero effect on production traffic until
  something calls `exp_etl_fetch_tick()`/`exp_etl_start_recon(...)` manually or a cron job
  is added to schedule them. Deciding when/how to schedule them (and validating a handful of
  real domains end-to-end first) is the natural next step before calling this slice done.
- Pre-existing, unchanged by this slice: all four functions are still callable by `anon`/
  `authenticated` roles (default Postgres grants from before this change) — worth a look in
  Phase 5 cleanup, not addressed here.

**Phase 3 — A parallel generic path that covers everything `sf_*`/`sfh_*`/`exp_sf_*` can do (all of it left untouched), plus fixing the three RE/MAX-hardcoded bugs found while tracing the live pipeline end to end (§4A.10).**

**Non-negotiable for this whole phase — verified before and after every single change below, not just at the end:**
- `sf_tick`/`sf_collect`/`sf_resolve`, `sfh_tick`/`sfh_collect`, and the live `exp_sf_fetch_tick`/`exp_sf_parse_tick`/`exp_sf_parse`/`exp_sf_apply`/`exp_sf_nodalize`/`exp_sf_renodalize_tick` chain stay exactly as they are — not touched, not migrated, not retired, not even read-tested against in a way that could change their behavior.
- The RE/MAX pilot's existing data and behavior must keep working identically: the 154 `exp_etl_frontier` rows already queued for remax.com, the 14 already-extracted `exp_etl_extract_queue` rows, and the ~33 entities already created in `exp_entity`/`exp_rel` (§4A.10) must produce the same results after every fix below as they did before it. Every fix in this phase is additive — a new column, a new branch, or a new config row with a fallback to today's hardcoded behavior when that config is absent — never a rewrite of the path RE/MAX already runs through.
- The AI-discovery flow (`disco_*`) and its two in-flight jobs (`gcid:mortgage_lender` sitting `awaiting_human`, `gcid:accountant` sitting `awaiting_ai` — §4A.6) are not reset, reassigned, or auto-advanced by anything built in this phase.
- No function touched or added in this phase gets scheduled in `cron.job` as a side effect — scheduling stays a separate, explicit, later decision, same as Phase 2's.
- Verification standard: before/after row counts on the RE/MAX numbers above (154 / 14 / ~33) must be identical after each change unless that change explicitly intends to move that pipeline forward. No fix in this phase ships on "looks right" — it ships on a matching count.

`sf_tick`/`sf_collect`, `sfh_tick`/`sfh_collect`, and `exp_sf_fetch_tick`/`exp_sf_parse_tick`
are all StateFarm-only pipelines today. Per an explicit decision: **none of them are
touched, migrated, or retired — not in this phase, not later, unless a separate decision is
made after the generic path is proven elsewhere.** Their actual code was read directly (not
assumed), and they turn out to do five separate jobs, so "build a generic version" breaks
into five pieces:

- **A. Find pages, and pull simple lists — SHIPPED (2026-09-22).** `sf_tick`/`sf_collect`'s job: walk from an index page to listing pages, and where a listing page already contains a ready-made list of entities (as StateFarm's city pages do, via embedded JSON-LD), pull it out directly. Built as two new page kinds plugged into Fix 1's existing `page_kinds`/`exp_etl_fetch_collect` machinery, rather than a new lookup path: `index_page` (walks the page's links, filtered by `disco_site_contract.roster_pattern` for that domain+gcid, and adds matches to the frontier as `roster_page` via `exp_etl_frontier_discover`'s existing kind-override parameter) and `roster_page` (if `disco_site_contract.extraction` declares a ready-made JSON-LD list — a convention defined here since that column has never been populated: `{"list_source":"jsonld","json_path":[...],"field_map":{...},"id_field":...,"entity_type":...}` — pulls entities out directly and writes them through the new `exp_etl_stage_ingest`; otherwise falls through to today's normal full-text-to-LLM path, unchanged). Added `exp_etl_stage_ingest(...)`, the checked, safe way to write a found entity into `exp_etl_staging` (skips silently on missing required fields, skips re-inserting the same `detail_url`+`gcid` on a re-fetch) — there wasn't one before; `sf_collect` still inserts directly and is untouched. No schema change: reused `disco_site_contract` and `exp_etl_sources.page_kinds` as-is. Found while building this, not previously documented: `exp_etl_frontier_discover` guesses a page's `kind` from its URL (`%office%`/`%agent%`, else dropped) — another RE/MAX-shaped hardcode. Not fixed here; this work bypasses it using that function's own existing `p_kind` override. Both new kinds are unreachable for any domain today — no source row anywhere has `index_page`/`roster_page` in `page_kinds`, and `disco_site_contract` is still empty — so RE/MAX and StateFarm are unaffected. Verified unchanged: `exp_etl_frontier` remax.com counts (120 `agent_page` + 34 `office_page` queued, 6 `office_page` error, 4 `sitemap` + 2 `sitemap_index` parsed), `exp_etl_extract_queue` (14 `done`, all `gcid:real_estate_agents`), `exp_entity` `source='etl_remax_pilot'` (23 professional, 6 brand, 2 location, 2 team) — all identical before and after. Still needed before this does anything real: a human/AI has to write an actual `disco_site_contract` row (`roster_pattern`, and `extraction` in the shape above) for a real domain, and add `index_page`/`roster_page` to that domain's `exp_etl_sources.page_kinds` — same onboarding step Fix 3 is waiting on.
- **B. Save the entity as a real record.** `exp_sf_apply`'s job: create or update the
  `organizations`/`professionals` rows for a found entity, matching offices by address and
  people by their detail URL. Needs: a generic version of this function, with StateFarm's
  hardcoded brand/name/schema-type defaults replaced by values read from the source's
  config, so it works for any `gcid`.
- **C. Deep extraction with a quality check — the hardest piece, design not settled yet.**
  `exp_sf_parse`'s job: beyond JSON-LD, dig specific details (licenses, hours, team members,
  photos) out of a site's own HTML structure, and only accept the result if it passes a
  quality bar (enough products, a full address, a phone number, etc.). Making this generic
  needs a new way to write down, per source, exactly what to look for and what "good enough"
  means — not just reusing `disco_site_contract.extraction` as currently shaped. This needs
  its own design pass before any function gets built.
- **D. Save hydrated details into `exp_entity`, generically.** Checked `exp_entity` directly:
  it's a real, active table (36,000+ rows, updated as recently as early August 2026), and
  several other live features depend on it — the business-claim flow, the graph-building
  tools, an attribution-safety check, and the audit system. It's a different table from
  `organizations`/`professionals`, so item B's generic save function won't cover it. Needs: a
  separate generic version of what `sfh_collect` does today, so this capability is available
  if/when it's needed later.

**Three concrete bugs to fix in this phase (found while tracing the live pipeline end to end — §4A.10 — these are fixes to code the RE/MAX pilot already runs through, not new capabilities):**

- **Fix 1 — page→category tagging is hardcoded — SHIPPED (2026-09-22).** `exp_etl_fetch_collect` used to decide a fetched page's `gcid` with `office_page → gcid:real_estate_agency, else → gcid:real_estate_agents` — RE/MAX's own shape, not read from any config. Fixed: added `exp_etl_sources.page_kinds` (a plain list of page-kind strings per source row — deliberately not a copy of `gcid`, since the row it sits on already has one; needed only because a handful of domains have more than one `gcid` row) and rewrote `exp_etl_fetch_collect` to look up the `gcid` by matching `(source_domain, kind = ANY(page_kinds))` first, falling back to the old hardcoded case only when no source row declares that kind. Backfilled `page_kinds` for RE/MAX's two existing rows (`['office_page']` for `gcid:real_estate_agency`, `['agent_page']` for `gcid:real_estate_agents`) to reproduce today's exact behavior — confirmed unchanged: the RE/MAX numbers in the non-negotiable list (154 frontier rows, 14 extracted, 23+6+2+2 entities) were byte-for-byte identical before and after. Scope check done while building this: the one-domain/two-gcid ambiguity exists for five domains total — `compass.com`, `exprealty.com`, `kw.com`, `remax.com`, `zillow.com`, all real estate — not just RE/MAX; `page_kinds` is left `NULL` for the other four until/unless they're worked on. StateFarm never had this problem: its one `exp_etl_sources` row for `statefarm.com` is the only row for that domain, and its own pipeline hardcodes a single `gcid` directly rather than deriving one from page kind at all, so there was nothing to fix there.
- **Fix 2 — deep extraction is hardcoded to RE/MAX by name and by domain filter — SHIPPED (2026-09-22).** `exp_etl_extract_tick`'s prompt used to literally say "this RE/MAX ... page," and `exp_etl_extract_collect` only ever credited results to `source_domain='remax.com'`. Fixed: `exp_etl_extract_tick` now joins each queued page back to its `exp_etl_frontier` row and names the actual domain in the prompt instead of a literal brand name; `exp_etl_extract_collect` now resolves the source by looking up that same domain instead of the hardcoded string. **A third hardcode was found and fixed while doing this, not in the original write-up:** every entity the AI tagged `entity_type='professional'` (including roster stub entries) was being force-assigned `gcid:real_estate_agents` no matter what site it came from. Fixed the same way Fix 1 fixed page tagging — looked up via `exp_etl_sources.page_kinds` (reusing Fix 1's config, matching on `'agent_page'`) with a fallback to the old hardcoded value only when no source declares that page kind. Verified unchanged: the RE/MAX numbers (14 extracted, 23+6+2+2 entities, frontier counts) were identical before and after — nothing in `exp_etl_extract_requests`/`exp_etl_extract_queue` is ever reprocessed once `done`, so historical rows were never at risk either way.
- **Fix 3 — the quality gate has no config for any category except StateFarm — PARKED (2026-09-22).** `exp_etl_source_contract` has exactly one row (§4A.5). The plan was to auto-create a starter contract row when a category finishes the AI-discovery "strategy" steps (§4A.10 step 7, `disco_check_method_complete`). Checked whether that's actually buildable before writing any code: looked at `exp_taxonomy` (holds SEO aliases/audiences/products, not field-completeness info) and `exp_category_shape` (holds entity-graph structure — allowed entity types, teams, relationships — not a field list either). Neither gives a real basis for guessing what "good enough" means for a brand-new category; StateFarm's one contract row reads like something written by hand from real domain knowledge, not something derivable from existing config. Decision: don't auto-generate a guessed contract. Parked until a second real category is actually being onboarded, at which point its contract gets written by hand the same way StateFarm's was — from real knowledge of that category, not invented defaults. `exp_etl_record_complete`/`exp_etl_gate_full_pull` keep behaving safely as-is in the meantime — they return `no_contract`/block rather than guess, which is correct, not a bug.

None of A–D, or the three fixes above, touch any file — this is all PL/pgSQL, following the same pattern the existing
`sf_*` code already uses. No TypeScript changes.

**Sequencing, updated:** Fix 1, Fix 2, and Capability A are shipped (see change log). Fix 3 is parked (see above) and no longer sits in this sequence until a second real category is being onboarded. Remaining order: B next, then D. Capability C is designed last, since it was already the biggest open question, and now also carries Fix 3's deferred quality-gate design.

**Validation, updated:** before any of A–D or the three fixes counts as done, run it against a real, non-StateFarm, non-RE/MAX domain and check the output by hand — *and* confirm the RE/MAX numbers in the non-negotiable list above haven't moved. The doc's standing rule (verify with counts, not intent) now applies in both directions: new work must produce correct new counts, and old work must produce exactly the same old counts.

**Phase 4 — Retire the duplicate classifier.**
- Remove `exp_probe_methods`/`exp_probe_collect`.
- Whatever in Phase 2/3 currently needs a source's `crawl_method` determined, dispatches a
  `classify_method` job to `disco_llm_requests` instead, reusing `disco-ai-worker.ts`'s
  existing implementation (bot-block detection, JS-shell detection, model fallback for
  ambiguous cases) rather than the cruder status-code-plus-one-regex check.

**Phase 5 — Cleanup and observability.**
- Replace the remaining hand-rolled in-flight counters with one shared concurrency-limiting
  pattern.
- Add structured logging/metrics for scrape success/failure/blocked rates per source, now
  that failures are typed errors from the TS worker instead of swallowed SQL exceptions.
- Revisit `exp_etl_sources.daily_quota`/`min_delay_seconds` enforcement now that fetches go
  through a shared proxy budget (Oxylabs) rather than being independent per-function.

Each phase should ship with a side-by-side row-count/data-quality comparison against the
prior behavior before the old PL/pgSQL function is deleted, the same way the destination-
database migration in this project was verified — trust the count, not the intent.

## 6. Change log

**Phase 3 — Capability A: find pages, pull ready-made lists (2026-09-22)**
- Added: function `public.exp_etl_stage_ingest(p_source_id, p_gcid, p_entity_type, p_payload, p_identity_candidates, p_field_tier, p_detail_url)` — the checked way to write a found entity into `exp_etl_staging`; validates required fields and skips duplicate `detail_url`+`gcid` inserts. `sf_collect`'s own direct insert into this table is untouched.
- Replaced (same name/signature, `CREATE OR REPLACE`): `exp_etl_fetch_collect` — added two new page kinds, `index_page` (walks a page's links against `disco_site_contract.roster_pattern` for that domain+gcid and queues matches as `roster_page`) and `roster_page` (pulls a ready-made JSON-LD entity list via `disco_site_contract.extraction` when configured, through `exp_etl_stage_ingest`; otherwise falls through to the existing full-text-to-LLM path unchanged). Every other kind's handling is byte-for-byte the same as after Fix 1/Fix 2.
- Defined a convention for `disco_site_contract.extraction`'s shape (`list_source`, `json_path`, `field_map`, `id_field`, `entity_type`) since that column had never been populated and had no existing convention to match.
- Found while building this, not previously documented: `exp_etl_frontier_discover` guesses a page's `kind` from its URL (`%office%`→`office_page`, `%agent%`→`agent_page`, else dropped entirely) — another RE/MAX-shaped hardcode. Not fixed here; this work sidesteps it using that function's existing `p_kind` override parameter.
- No schema change: reused `disco_site_contract` (still 0 rows) and `exp_etl_sources.page_kinds` (Fix 1's column) as-is.
- Verified unchanged: `exp_etl_frontier` remax.com (120 `agent_page` + 34 `office_page` queued, 6 `office_page` error, 4 `sitemap` + 2 `sitemap_index` parsed — 166 rows total, same shape as Fix 1/Fix 2), `exp_etl_extract_queue` (14 `done`, all `gcid:real_estate_agents`), `exp_entity` `source='etl_remax_pilot'` (23 professional, 6 brand, 2 location, 2 team). Both new page kinds are unreachable today — no source row has them in `page_kinds` yet, and `disco_site_contract` remains empty — so nothing could have moved.
- Untouched: `sf_*`/`sfh_*`/`exp_sf_*` (not read, not modified), `disco_*` and its two in-flight jobs, `cron.job` (no new schedule entries).
- Still needed before this capability does anything: a real `disco_site_contract` row (`roster_pattern`, `extraction` in the shape above) and `page_kinds` entries for an actual new domain — an onboarding step, same as Fix 3's parked contract-writing.
- Still open from Phase 3: capabilities B, C, D.

**Phase 3 — Fix 3: parked, not built (2026-09-22)**
- Decision, no code or data changed: do not auto-generate a starter `exp_etl_source_contract` row per category. Checked `exp_taxonomy` and `exp_category_shape` as possible sources for the field lists a starter contract would need — neither holds that information (SEO terms and entity-graph structure, respectively, not field-completeness criteria).
- `exp_etl_source_contract` remains at exactly one row (StateFarm). `exp_etl_record_complete`/`exp_etl_gate_full_pull` continue to return `no_contract`/block for every other category — unchanged, and considered safe, correct behavior while this stays parked.
- Revisit when a second real category is being onboarded: write its contract by hand from real knowledge of that category, the same way StateFarm's was written, rather than guessing ahead of time.
- Untouched: everything — no functions, tables, or data were changed for this entry.

**Phase 3 — Fix 2: generic deep-extraction prompt and source/entity tagging (2026-09-22)**
- Replaced (same name/signature, `CREATE OR REPLACE`): `exp_etl_extract_tick` — the AI prompt now names the page's actual domain (via a new join to `exp_etl_frontier`), not a literal "RE/MAX" string.
- Replaced (same name/signature, `CREATE OR REPLACE`): `exp_etl_extract_collect` — the source lookup now uses the page's actual domain instead of a hardcoded `source_domain='remax.com'`; a `'professional'`-type extracted entity's `gcid` is now looked up via `exp_etl_sources.page_kinds` (Fix 1's config, matched on `'agent_page'`) instead of always being force-set to `gcid:real_estate_agents`.
- Found while building this, fixed in the same change: the `'professional'`-forced-gcid hardcode above — not called out in the original Fix 2 write-up, discovered while tracing the function.
- Tables/objects impacted: 2 functions replaced. No schema changes (reused Fix 1's `page_kinds` column).
- Verified: `exp_etl_extract_queue` (14 `done`, unchanged), `exp_etl_frontier` remax.com counts (unchanged from Fix 1's entry), `exp_entity` counts for `source='etl_remax_pilot'` (23 professional, 6 brand, 2 location, 2 team, unchanged). Nothing reprocesses a `done` extraction row, so historical data was never at risk regardless.
- Untouched: `sf_*`/`sfh_*`/`exp_sf_*`, `disco_*` and its two in-flight jobs, `cron.job` (no new schedule entries).
- Still open from Phase 3: Fix 3 (missing quality-gate contract for non-StateFarm gcids), and capabilities A–D.

**Phase 3 — Fix 1: generic page→category tagging (2026-09-22)**
- Added: column `public.exp_etl_sources.page_kinds` (`text[]`, nullable, no default — existing rows unaffected until backfilled).
- Replaced (same name/signature, `CREATE OR REPLACE`): `exp_etl_fetch_collect` — the RE/MAX-shaped `gcid` guess for a fetched page is now a fallback, tried only after a `page_kinds` lookup on `exp_etl_sources` for the page's `(domain, kind)` comes back empty.
- Data: backfilled `page_kinds` for RE/MAX's two `remax.com` source rows (`office_page`→`gcid:real_estate_agency`, `agent_page`→`gcid:real_estate_agents`) to match prior behavior exactly.
- Tables/objects impacted: 1 column added, 1 function replaced, 2 rows updated.
- Verified: `exp_etl_frontier` (154 queued: 120 `agent_page` + 34 `office_page`; 6 `office_page` error; 4 `sitemap` + 2 `sitemap_index` parsed), `exp_etl_extract_queue` (14 `done`), and `exp_entity` counts for `source='etl_remax_pilot'` (23 professional, 6 brand, 2 location, 2 team) — all identical before and after this change.
- Untouched: `sf_*`/`sfh_*`/`exp_sf_*` (StateFarm's live pipeline — never had this bug, see §4A.10/§5 Phase 3), `disco_*` and its two in-flight jobs, `cron.job` (no new schedule entries).
- Still open from Phase 3: Fix 2 (RE/MAX-hardcoded extraction prompt/source filter), Fix 3 (missing quality-gate contract for non-StateFarm gcids), and capabilities A–D.

**Phase 2 — First slice: generalize the multi-domain fetch + recon pairs (2026-09-22)**
- Added: RPCs `public.exp_etl_recon_ingest(uuid, jsonb)` and
  `public.exp_etl_frontier_discover(text, text[], text)` (`SECURITY DEFINER`, `EXECUTE`
  revoked from `PUBLIC`/`anon`/`authenticated`).
- Replaced (same name/signature, `CREATE OR REPLACE`): `exp_etl_start_recon`,
  `exp_etl_recon_collect`, `exp_etl_fetch_tick`, `exp_etl_fetch_collect` — all four now route
  through `disco-webscraper-worker` via `exp_disco_worker_config()` instead of fetching
  target sites directly; `exp_etl_fetch_tick` also gained a 25-in-flight concurrency cap and
  started respecting `exp_etl_sources.crawl_method`.
- Files changed: none — DB-only, no TS/JS changes needed since the existing
  `disco-webscraper-worker.ts` endpoint already accepted a generic `{url, crawl_method}`
  request.
- Tables/objects impacted: 2 new functions, 4 functions replaced. No table schema changes.
- **Not yet live:** none of the four functions are scheduled via `cron.job` — this is
  deployed but dormant until scheduling is decided.
- Untouched in this slice: `sf_tick`/`sf_collect`/`sfh_tick`/`sfh_collect`
  (StateFarm-hardcoded, Phase 3), `exp_probe_methods`/`exp_probe_collect` (Phase 4),
  `exp_sf_fetch_tick`/`exp_sf_parse_tick` (Phase 3) — all still fetch plain, unaffected.

**Phase 1 — Plumbing (2026-09-22)**
- Added: Supabase Vault secrets `disco_worker_key`, `disco_worker_base_url` (base URL
  currently a **preview-URL placeholder** — see §5 Phase 1 for the required update before
  production).
- Added: RPC `public.exp_disco_worker_config()` (`SECURITY DEFINER`, `EXECUTE` revoked from
  `PUBLIC`/`anon`/`authenticated`).
- Files changed: none — DB-only phase.
- Tables/objects impacted: `vault.secrets` (2 new rows), 1 new function
  (`exp_disco_worker_config`).
- No existing tick/collect function behavior changed; nothing calls the worker yet.
- **Outstanding action before production:** update `disco_worker_base_url` to the real
  production domain via `vault.update_secret`.

**Phase 0 — Oxylabs proxy layer (shipped prior to this doc)**
- Added: `src/routes/api/public/disco-webscraper-worker.ts`.
- Updated: `src/routes/api/public/disco-ai-worker.ts` (`classifyMethod`, `mapSite`, drain
  loop now route through `scrapeWebsite()`; `crawl_method` threaded through).

---

## 2026-09-22 — Removed remaining RE/MAX hardcode from exp_etl_resolve; made exp_etl_frontier_discover contract-aware

**Bug 1 — exp_etl_resolve still special-cased remax.com.** A prior pass (same day) had already made this function derive the domain generically via `exp_etl_staging.source_id -> exp_etl_sources.source_domain`, but it kept two literal `CASE WHEN v_domain = 'remax.com'` branches for the brand name (`'RE/MAX'`) and source tag (`'etl_remax_pilot'`) — effectively still hardcoded, just disguised as generic. Fixed: both `v_brand_name` and `v_source_tag` are now always derived purely from the domain string (`initcap(replace(split_part(domain,'.',1),'-',' '))` and `'etl:' || domain`), with no domain name anywhere in the function. The existing brand entity for any domain (including RE/MAX) is found by matching its stored `identity_keys->>'domain'`, not by name, so this is safe — no brand gets renamed or duplicated. Verified after deploy: RE/MAX's entity counts (23 professional, 6 brand, 2 location, 2 team, all `source='etl_remax_pilot'`) and `exp_etl_frontier` row counts for `remax.com` are unchanged (0 pending remax.com staging rows existed at fix time, so this had no immediate data effect — it only changes tagging for any future remax.com re-crawl).

**Bug 2 — exp_etl_frontier_discover guessed page kind from URL text only.** Fixed: when the caller doesn't pass an explicit `p_kind`, the function now first checks `disco_site_contract` rows for the domain — a URL matching `roster_pattern` becomes `kind='roster_page'`, matching `detail_pattern` becomes `kind='detail_page'`. Only when no contract row exists for the domain, or nothing matches, does it fall back to the original URL-keyword guess (`.xml`→sitemap, `office`→office_page, `agent`→agent_page). `disco_site_contract` has zero rows today, so this is a no-op for every existing domain (remax.com, statefarm.com) until a contract row is added for a new category. New kinds `roster_page`/`detail_page` are already handled safely by `exp_etl_fetch_collect` (roster_page has dedicated logic from an earlier pass; detail_page falls into the same generic extraction path agent_page/office_page already use).

Impacted: `exp_etl_resolve` (function body), `exp_etl_frontier_discover` (function body). No schema changes, no data changes. StateFarm-only functions (`sf_*`, `sfh_*`, `exp_sf_*`) were not touched.

---

## 2026-09-22 — Automated the disco-ai-worker trigger; fixed vault key mismatch

**What changed:**
- New function `exp_disco_ai_worker_tick()`: checks `disco_llm_requests` for any `pending` row; if none, does nothing (no cost); if found, calls `/api/public/disco-ai-worker` once via `net.http_post`, using `exp_disco_worker_config()` for the URL/key (same pattern already used by `exp_etl_fetch_tick`/`exp_etl_start_recon`).
- New cron job `disco-ai-worker-drain` (job id 89), schedule `*/2 * * * *`, runs `SELECT exp_disco_ai_worker_tick();`.
- No table/schema changes. No existing function edited. Purely additive.

**Why:** Activating a category previously queued an AI "discover companies" request that only ran if someone manually called the worker endpoint. `gcid:accountant`'s request had sat `pending` since 2026-08-22 — a month — with nothing to pick it up. Now any activated category is picked up automatically within 2 minutes.

**Bug found and fixed along the way:** the vault secret `disco_worker_key` (read by `exp_disco_worker_config()`) did not match the live `DISCO_WORKER_KEY` the app checks against — every DB-triggered call to `disco-ai-worker` or `disco-webscraper-worker` got 401 Unauthorized. This had never worked from the database side before (confirmed: `exp_etl_fetch_requests` was completely empty). Lovable's agent corrected the vault copy to match.

**Verified working end to end:** after the fix, the cron tick successfully drained both pending requests:
- `gcid:accountant` (job_id 5) → 24 companies discovered → `disco_proposals` id 8, state `pending`, `disco_jobs` status `awaiting_human`.
- `gcid:financial_advisor` (job_id 6, activated as a live test) → 25 companies discovered (Merrill Lynch, Morgan Stanley, Charles Schwab, Fidelity, etc., each with official domain and authority rank) → `disco_proposals` id 9, state `pending`, `disco_jobs` status `awaiting_human`.

**Untouched, confirmed:** RE/MAX `exp_entity` count still 33 (23 professional + 6 brand + 2 location + 2 team). No `sf_*`/`sfh_*`/`exp_sf_*` function touched. `gcid:mortgage_lender`'s existing `awaiting_human` state was not reset (no pending request existed for it, so the tick had nothing to do there). Nothing else in `disco_llm_requests`, `disco_jobs`, or `disco_proposals` was altered beyond the two rows above.

**Not done yet:** company lists are still just proposals awaiting human review/approval (`exp_etl_approve_companies`) — no website crawling has happened, nothing has reached `exp_etl_sources`, `exp_etl_staging`, `organizations`, or `professionals`.

## 2026-09-22 — Wired Category Population's Approve step to the AI-discovery proposals

**Gap found:** Step 2 ("Discover companies") in `category-population-tab.tsx` read its checklist from `exp_etl_sources` (`role_in_discovery='hierarchy_source'`). But the AI-discovery path (`exp_etl_activate_category` → `disco_activate` → `disco-ai-worker` → `disco_discover_ingest`) writes its results to `disco_proposals`, a different table nothing in the UI ever read. Result: after Activate, the screen said "No hierarchy sources registered" even though a real, valid company list was sitting in `disco_proposals`, and there was no Approve action for it. A bridging function, `disco_confirm_companies(proposal_id, approved_domains)`, already existed in the database but was never called from anywhere.

**Also found while wiring this up:** `exp_etl_add_source` (called by `disco_confirm_companies`) never set `role_in_discovery`, so even after confirming, added companies wouldn't have shown up in this same checklist on a future load. Fixed to set `role_in_discovery='hierarchy_source'` (matching every existing hand-added hierarchy source). Confirmed this function has exactly one caller, so the change is isolated.

**What changed:**
- `exp_etl_add_source`: now sets `role_in_discovery='hierarchy_source'` on insert/update (previously left null).
- `category-population-tab.tsx`, Step 2 only: added a query for the category's pending `disco_proposals` row; when present, shows that AI-discovered company list (checked by default) instead of the `exp_etl_sources` list, and its Approve button calls `disco_confirm_companies` instead of `exp_etl_approve_companies` directly. When no pending proposal exists (the categories that already have hand-registered sources — insurance_agency, mortgage_lender, real_estate_agency, real_estate_agent), the screen behaves exactly as before — same query, same checklist, same `exp_etl_approve_companies` call, byte-identical.
- No other step (1, 3, 5), no other tab, no other function changed.

**Verified:** RE/MAX `exp_entity` count unchanged (33) after both changes. `exp_etl_add_source` confirmed single-caller (`disco_confirm_companies`) before editing it.

**Still open:** this closes the Activate → Discover → Approve loop for AI-discovered categories. Method Split and Run (steps 3–4) already read from `exp_etl_sources`, so once a proposal is approved through this new path, those steps should work unchanged — not yet exercised end-to-end on a freshly-discovered category (financial_advisor) as of this entry; that's the next thing to click through and confirm.

## 2026-09-22 — Multi-round approval for AI-discovered company lists; fixed source_type bug

**Bug found and fixed:** `disco_confirm_companies` was calling `exp_etl_add_source(..., 'brand', ...)` but the table's check constraint only allows `brand_site, portal, directory, license_registry, association, social, review_platform, other` — every Approve click was failing with a constraint violation. Fixed to `'brand_site'`, matching every existing hierarchy source.

**Design change (explicit request):** approving a proposal's company checklist used to be all-or-nothing — unchecking a company meant it was silently skipped forever, with no way to come back to it, because the whole `disco_proposals` row flipped straight from `pending` to `approved` regardless of how many companies were actually checked.

**What changed:**
- `disco_proposals`: added column `decided_domains text[] DEFAULT '{}'` — accumulates which domains have been decided across review rounds.
- `disco_confirm_companies`: now adds only newly-approved domains, appends them to `decided_domains`, and re-approves the FULL cumulative set each time (so an earlier round's approvals are never accidentally paused by `exp_etl_approve_companies`'s "pause everything else" behavior). The proposal's `state` only flips to `approved` once every company in the original list has been decided; until then it stays `pending` and keeps showing up. The "method split" job is only queued once, the first time any batch is approved — not duplicated on later rounds.
- `category-population-tab.tsx`, Step 2 proposal branch only: the checklist now shows only the still-undecided companies (checked by default), with a small progress note ("X of Y already approved — Z left to decide") once a prior round exists. Approve only ever sends the currently-visible, still-undecided domains.
- No other step, table, or function changed.

**Verified:** RE/MAX `exp_entity` count unchanged (33). `financial_advisor` proposal (id 9) confirmed still `pending` with `decided_domains=[]` after both fixes — safe to approve now, including partially.

---

## 2026-09-22 — Fixed stage check constraint blocking Approve and Run for every category

**Bug found:** `exp_etl_approve_companies` sets `exp_etl_jobs.stage = 'method_split'` and `exp_etl_run_source` sets `exp_etl_jobs.stage = 'harvest'` — but `exp_etl_jobs_stage_check` never allowed either value. Every Approve click (on any category, old or new) and every Run click has been failing with a check constraint violation. This is pre-existing and unrelated to anything else fixed today — it means Method Split and Run have likely never completed successfully through this console before.

**What changed:** widened `exp_etl_jobs_stage_check` to add `method_split` and `harvest` to its allowed list (now 14 values total). No function, table structure, or frontend code changed — this was purely a stale constraint that never caught up with the code.

**Verified:** RE/MAX `exp_entity` count unchanged (33).

**Net effect of today's four fixes, in order:** (1) `mapSite` extraction-shape mismatch fixed in `disco-ai-worker.ts`; (2) `exp_etl_resolve` and `exp_etl_frontier_discover` de-hardcoded from RE/MAX; (3) the AI-discovery-to-Approve pipeline wired end to end (cron drain, vault key fix, `role_in_discovery` fix, proposal-based checklist, multi-round approval, `brand_site` typo fix); (4) this constraint fix. Category Population should now be usable end to end, for any category, for the first time.

---

## 2026-09-22 — Fixed disco_confirm_companies never dispatching the "method" job

**Bug found:** `disco_activate()` queues its "discover" job and immediately calls `disco_dispatch()` to turn it into real work. `disco_confirm_companies` queued its "method" job the same way but never made the equivalent follow-up call — so the job sat at `status='queued'` forever, no `classify_method` AI requests were ever created, and every approved company's `crawl_method` stayed at the default `'unprobed'`. Confirmed this had never worked for any category, ever: zero `classify_method` rows existed in `disco_llm_requests` before this fix.

**What changed:** `disco_confirm_companies` now calls `PERFORM disco_dispatch();` right after inserting the new "method" job — same pattern `disco_activate()` already uses. No other function or table changed.

**Verified:** manually ran `disco_dispatch()` once to drain the pre-existing stuck job (job 7, financial_advisor) — all 10 `classify_method` requests were created successfully, `pending`, ready for the existing `disco-ai-worker-drain` cron to pick up automatically. RE/MAX `exp_entity` count unchanged (33). Confirmed only this one job was queued system-wide before dispatching, so no other category was affected.

---

## 2026-09-23 — Fixed crawl_method spelling mismatch (disco-ai-worker.ts and disco_site_contract's own constraint)

**Bug found:** `classifyMethod()` in `disco-ai-worker.ts` wrote `needs_proxy` / `needs_js_api`, but `exp_etl_sources_crawl_method_check` and `disco_method_ingest`'s own validation only accepted `blocked_needs_proxy` / `js_needs_api`. Every ambiguous classification for a real domain (UBS, Schwab, Wells Fargo, and others) was failing with "invalid method" and getting stuck as a pending `disco_llm_requests` row, never reaching `exp_etl_sources`.

**What changed:** fixed the 4 literal strings inside `classifyMethod()` to the correct spelling. Separately found the exact same spelling bug a second time, in `disco_site_contract`'s own `disco_site_contract_method_check` constraint (still had the old spelling even after the RPC and `exp_etl_sources` constraint were already correct) — widened it to the same 5-value set (`server_crawl, blocked_needs_proxy, js_needs_api, unreachable, unprobed`).

**Also fixed:** reset the stuck `pending`/`sent` classification requests so they re-ran with the corrected spelling.

**Verified:** RE/MAX `exp_entity` count unchanged (33). No `sf_*`/`sfh_*`/`exp_sf_*` function touched.

---

## 2026-09-23 — Three-tier fetch capability model: fetch_tier column, direct-fetch, FORCE_PROXY, render-rescue

**Problem:** `crawl_method` (`server_crawl` / `blocked_needs_proxy` / `js_needs_api` / `unreachable`) is a readiness label, not a capability record — it couldn't say a domain works with a plain fetch (no proxy cost) vs. only through Oxylabs, vs. only through Oxylabs with rendering. Every "server_crawl" domain was quietly paying for proxy + no-render even when a plain fetch would've worked, and a domain that only needed rendering was being marked unrunnable (`js_needs_api`) without ever actually trying a render.

**What changed (additive, no `crawl_method` behavior removed):**
- New column `exp_etl_sources.fetch_tier` (`direct` / `proxy` / `proxy_render`, nullable) — records the technique actually proven to work, decoupled from the `crawl_method` readiness bucket.
- `disco-ai-worker.ts`'s `classifyMethod()` rewritten into a tiered probe: always attempts a genuine direct (no-proxy) fetch first; falls back to proxy; and — only to rescue an otherwise-`js_needs_api` verdict — tries one more fetch with Oxylabs rendering turned on before giving up. If rendering finds real entity data, the source is marked `server_crawl` with `fetch_tier='proxy_render'` instead of being marked unrunnable.
- `disco-webscraper-worker.ts`: new `directFetch()` helper (plain fetch, no Oxylabs) and a new `'direct'` crawl method. New env var `FORCE_PROXY` (default true / safe): when true, `fetch_tier='direct'` sources still go through the proxy at real harvest time — this only avoids proxy cost during Method Split's own probe, not during actual harvest, until someone explicitly flips it off to test the cost savings. Per explicit instruction, `FORCE_PROXY` does NOT gate the Method Split probe itself — the probe always tries a real direct fetch regardless.
- `exp_etl_fetch_tick()` and `disco_method_ingest()` updated to read/write `fetch_tier` and translate it into the correct fetch instruction sent to the scraper worker.
- `server_crawl` / `blocked_needs_proxy` / `js_needs_api` behavior for every existing domain is byte-for-byte unchanged unless a new `fetch_tier` value is present.

**Verified:** RE/MAX `exp_entity` count unchanged (33). No `sf_*`/`sfh_*`/`exp_sf_*` function touched. The Run gate in `exp_etl_run_source` still only requires `crawl_method='server_crawl'`, unchanged.

**Known, accepted gaps (not fixed, no fix requested):** (1) the roster/detail-page fetch inside `classifyMethod()` always uses the proxy path regardless of which tier the homepage succeeded on, so `direct` is only proven for the homepage, not the pages that will actually be scraped later; (2) when the render-rescue fails, the stored evidence text doesn't distinguish "we tried rendering and it still didn't work" from "we never tried rendering."

---

## 2026-09-23 — Category Population UI: fixed Approve gating bug, added Retry for blocked sources, select-all + title, Last-checked label

**Bug found:** the Discover Companies checklist's checkboxes and Approve button were disabled/hidden based on the category's `step` number, not on whether the current proposal still had undecided companies. After a second approval round started, the checklist showed with no way to check anything and no Approve button — a real regression from the earlier multi-round-approval work.

**What changed:**
- `category-population-tab.tsx`: checkbox `disabled` and Approve button visibility now driven by `pendingCompanies.length` (still-undecided companies) instead of `step`.
- New RPC `disco_retry_method_classification(p_source_id uuid)`: re-queues one specific blocked/unprobed source for classification, with a guard against duplicate in-flight requests for the same domain. New "Retry" button next to blocked sources, calling this RPC.
- Added a title ("N companies to review") and a Select all / Deselect all toggle above the checklist.
- Added a "Last checked: Xm/h/d ago" label under each blocked source, sourced from `disco_site_contract.learned_at` (already reliably updated on every classification — no new column needed).
- While wiring the last-checked label, found `disco_site_contract` had row-level security turned on with zero policies (same class of gap fixed earlier on `disco_proposals`) — added a `super_admin`/`architect`-scoped SELECT policy.

**Verified:** all four changes confirmed via typecheck + diff, scoped to the Blocked/Discover panels only — Ready panel, Refresh section, Step 1, Stepper, and the non-proposal sources checklist branch untouched. 3 real retries observed end-to-end via the existing `disco-ai-worker-drain` cron (Raymond James stayed correctly blocked; UBS's render-rescue was attempted but still found no entity data — a genuine negative result, not a bug). RE/MAX `exp_entity` count unchanged (33).

---

## 2026-09-23 — Gaps found while tracing "Ready → Run → Harvest" and the graph/registry mapping (none fixed yet — reference list for future work)

Two read-only investigations today turned up several real gaps. None of these have been fixed. Listed here so we don't have to re-discover them.

### A. The Run button doesn't actually start a harvest

**Gap A1 — nothing seeds `exp_etl_frontier` when a source goes active.** `exp_etl_run_source()` only sets `status='active'` and `stage='harvest'` — it never inserts a frontier row. The only function that inserts into `exp_etl_frontier` is `exp_etl_frontier_discover()`, and the only caller of that is `exp_etl_fetch_collect()` itself (when parsing an already-fetched sitemap page). That's circular — it can only extend an existing queue, never start one.

**Gap A2 — no cron job runs any of the fetch/extract chain.** Checked the full `cron.job` table: nothing schedules `exp_etl_fetch_tick`, `exp_etl_fetch_collect`, `exp_etl_extract_tick`, `exp_etl_extract_collect`, or `exp_etl_recon_collect`. `exp_engine_tick`/`exp_engine_collect` (which do run every minute) are a separate system (the category-schema design engine, see section C) — unrelated to harvesting.

**Proof this has never run for real:** `exp_etl_runs` (the Run button's own audit table) has 0 rows, ever. All 166 rows in `exp_etl_frontier` are for `remax.com` only, all created in a single 2-minute window on 2026-08-02 — including `kind='sitemap_index'` rows, a kind no code path ever creates (must have been inserted by hand). The current active `remax.com`/`gcid:real_estate_agents` source has `crawl_method='blocked_needs_proxy'`, which the Run gate would never allow — so that `status='active'` was also set by hand. Conclusion: RE/MAX's 19,396 staged rows came from a one-time manual pilot in August, not from the Run button or any cron.

**Currently exposed:** 8 sources are sitting `approved` + `crawl_method='server_crawl'` ("Ready") right now — Ameriprise, Edward Jones, Fidelity, LPL, Merrill Lynch, Morgan Stanley, Schwab, Wells Fargo Advisors. Clicking Run on any of them today will succeed silently and then do nothing.

**Gap A3 — even if seeded, these 8 sources would get mistagged.** `exp_etl_fetch_collect()`'s default branch resolves a fetched page's `gcid` by matching `page_kinds` on `exp_etl_sources`; when nothing matches it falls back to a hardcoded guess: `'office_page' → gcid:real_estate_agency`, everything else `→ gcid:real_estate_agents`. `page_kinds` is null for all 8 financial-advisor sources above (it's never set by any function — only ever set by hand, and only for RE/MAX). Turning on harvesting for them today, without fixing this fallback, would silently file their pages under the real-estate categories.

**Gap A4 — recon discovers the sitemap URL but nothing uses it.** `exp_etl_recon_ingest()` writes `exp_etl_domains.sitemap_url`; no function anywhere reads that column. It's a dead end that could otherwise be the natural seed for Gap A1.

**Also unresolved:** none of the 8 "Ready" sources have ever gone through the recon step (`robots_status='unfetched'` for all of them), and none have a Map Site contract (`disco_site_contract` roster_pattern/detail_pattern) — so `page_kinds` and per-domain URL patterns are missing at every stage, not just at Run.

### B. Two smaller, previously-flagged extraction-quality gaps (accepted, not fixed)

- In `classifyMethod()` (disco-ai-worker.ts), the roster/detail-page fetch always uses the proxy path regardless of which tier the homepage succeeded on — so `fetch_tier='direct'` is only ever proven for the homepage, not the pages that will actually be scraped later.
- When the render-rescue step fails, the stored evidence text is identical to what was passed in — it doesn't say whether a render was actually attempted or not, making it hard to debug from the evidence column alone.
- Unverified housekeeping item: `disco_method_ingest` shows up twice in a `pg_proc` listing of function names — not yet confirmed whether this is a leftover/orphaned overloaded signature worth cleaning up, or a query artifact.

### C. The extraction pipeline and the real production graph are two disconnected systems

**Gap C1 — extraction has no defined, per-category field list.** The LLM extraction prompt (`exp_etl_extract_tick`) says "take everything present" with no fixed or category-aware field list. There is a table built for exactly this (`exp_etl_source_contract.expected_fields`/`required_fields`, keyed by gcid+domain), but it has exactly one row ever (StateFarm/`gcid:insurance_agent`) and nothing in the extraction code reads it.

**Gap C2 — `exp_etl_staging` → `exp_entity` never reaches the real graph.** The whole ETL/disco pipeline traced this week writes into `exp_etl_staging` and then `exp_entity` (33 verified RE/MAX rows). It never touches `graph_nodes` — the actual production graph behind the live site's 39,464 profiles (554,040 rows). These are two separate, unconnected data models today.

**Gap C3 — the registry-to-graph wiring exists in the schema but has never been used.** `exp_vertical_node_registry` is a real, live, per-gcid field dictionary (one row per fixed key, e.g. `fax_number` → `FinancialService.faxNumber`, with `entity_scope` as the location/professional lane). `graph_nodes.node_registry_id` is a foreign key back to it, and `exp_registry_attribute_map` links `(gcid, node_slug)` to a scoring attribute — the design clearly intends registry-driven writes into `graph_nodes`. But the one real function that writes crawled data into `graph_nodes` today, `exp_sf_nodalize` (StateFarm, protected — not to be touched), does not join through the registry at all: it hardcodes its own field list in SQL and never sets `node_registry_id`. So this wiring has never actually been exercised by any crawler — only the AI category-design engine (`exp_engine_apply`, part of `exp_engine_tick`/`exp_engine_collect`) writes into the registry, to define what fields a category should have, not to fill them in from a website.

**Gap C4 — `exp_category_schema` (the console's Schema tab) is a generated projection, not a second source of truth.** Confirmed via `exp_engine_apply()`, which ends by calling `exp_generate_schema_projection(gcid)` to rebuild `exp_category_schema.schema_json`/`field_model_v3` from the registry. Its internal shape also drops the stable `node_slug` key. Any future dynamic mapper should read from `exp_vertical_node_registry`, not from `exp_category_schema`.

**Next step, not yet started:** building a universal, gcid-aware LD-JSON mapper would mean querying `exp_vertical_node_registry` (filtered by gcid + entity_scope) as the field dictionary, and writing extracted values as `graph_nodes` rows keyed by `node_registry_id` — the same shape the live product already understands for scoring and rendering. This has not been designed or built; it's a reference plan for when we pick this up.

---
## 2026-09-24 — Gaps found while tracing discovery-to-harvest scaling for "1000s of pages" (none fixed yet)

Traced the full discovery → harvest chain to answer "how does this cope with thousands of pages per domain." The harvest side (`exp_etl_fetch_tick`) is genuinely designed for scale — one URL fetched per domain per tick, gated by each source's `daily_quota` (100–300/day for every source checked) and `min_delay_seconds` (30s everywhere), plus a global 25-in-flight cap across all domains. That part is sound once the cron gap (logged 2026-09-23) is fixed.

The discovery side is not, and this is a new finding:

**Gap D1 — `exp_etl_frontier_discover()` silently drops everything past the first 40 URLs per call.** The function has a hard `EXIT WHEN v_n >= 40`. It's called exactly once per sitemap/sitemap_index page (`exp_etl_fetch_collect` marks that page `'parsed'` right after and never revisits it), so if a site's sitemap.xml lists more than 40 URLs in one file — completely normal for a real agent/advisor directory — only the first 40 ever reach `exp_etl_frontier`. The rest are dropped permanently: no cursor, no continuation, no re-processing. This only hasn't bitten RE/MAX because their URLs happened to arrive pre-split across many sitemap files with fewer than 40 entries each. For any site with large sitemap files, this cap alone would prevent most of the site from ever being discovered, independent of quota or cron.

**Gap D2 — `pull_window` is configured but never enforced.** `exp_etl_sources.pull_window` (e.g. "02:00-06:00 ET") is set on every source checked, clearly intended to restrict crawling to an off-peak window. `exp_etl_fetch_tick()` never reads this column — fetches would happen at any hour, all day, regardless of the configured window.

**Gap D3 — no pagination support anywhere.** Checked `mapSite()`, `exp_etl_frontier_discover()`, and `exp_etl_fetch_collect()` — none of them look for a "next page" link on a listing/roster page. Discovery only works via a sitemap file or a single roster page's own contents. A site whose professional directory is a paginated listing (page=1, 2, 3…) rather than fully enumerated in a sitemap has no path to full discovery today.

**Also confirmed while tracing this:** the "combined page" question from the roster/stub mechanism — for RE/MAX, only 1 of 18 `professional` staging rows ever came from the office-page roster-stub path (`from_office_page: true`); the other 17 came from their own dedicated `agent_page` fetches. The roster-stub mechanism (marked "R28 skeleton" in the code) has no follow-up: nothing queues a roster stub's own URL into `exp_etl_frontier` for individual hydration, so those stubs stay as name+URL only, forever. Not filed as a numbered gap above since it's a consequence of Gap A1/A2 (already logged) rather than a new independent one — noted here for context since it came up in the same trace.

---

## sameAs field disambiguator — Batch 1 (2026-09-24)

Problem: `exp_vertical_node_registry` has ~23,334 distinct active node_slugs across all gcids where schema_property = 'sameAs'. JSON-LD `sameAs` is a multi-value property (a page lists many external links at once — LinkedIn, Facebook, BrokerCheck, NAPFA, Wikidata, etc.), so the LLM fallback in mapSite() was guessing which of a page's several sameAs URLs belonged to which specific registry field, by name similarity alone, with no verification. On the edwardjones.com test (request_id 29), this produced 28 different node_slugs (LinkedIn, Facebook, Yelp, BrokerCheck, NAPFA, CFP Board, SEC EDGAR, Wikidata, etc.) all "confidently" mapped to the single JSON-LD property `sameAs`, and 14 different credential node_slugs all mapped to `hasCredential` — a single generic property can't actually carry that many distinct claims, so this was not trustworthy as a harvest contract.

Decision: no changes to exp_vertical_node_registry (no new columns, no schema change). Each node_slug stays its own key everywhere — slugs that mean the same real-world thing (e.g. "linkedin_profile_url", "url_linkedin", "partner_linkedin_profile") are intentionally NOT merged/deduped. Instead, built a plain local TypeScript helper, reviewed and built by hand (not LLM-guessed), that recognizes real, identifiable platforms from the slug/node_name text and only assigns a value when an actual URL on the page's own sameAs array matches that platform's real domain.

New file: `src/routes/api/public/sameas-domain-classifier.ts` — standalone, not yet wired into mapSite(). Exports `SAMEAS_PLATFORM_RULES` (an ordered array of {label, slugTest, urlTest}) and `classifySameAsUrl(nodeSlugOrName, candidateUrls)`.

Scope of Batch 1: covers every token that appears >= 8 times across the 23,334 distinct sameAs node_slugs (live registry snapshot, 2026-09-24) — roughly 73% of all sameAs field usages in the registry (43,069 of ~58,889 token occurrences), since frequency directly measures how many fields a given platform recognition helps classify. Purely generic/descriptive tokens with no single fixed platform (e.g. "state", "entity", "locator", "dealer", "authorized", "local", "board") were deliberately left unclassified — those have no one correct domain (a state licensing board differs by state; a local delivery marketplace differs by city), so they correctly keep falling back to the existing LLM step rather than being forced into a wrong static answer.

Remaining work (not done yet): Batch 2 will cover the next tier (tokens appearing 3-7 times, ~1,951 more distinct tokens, another ~14% of usage). Below that, ~5,966 distinct tokens appear only 1-2 times each (~13% of usage) — mostly one-off/ultra-niche fragments; whether to review that tier exhaustively is still an open call. Wiring `classifySameAsUrl()` into mapSite()'s registry-field-mapping pass (so it runs before the LLM call, not just alongside it) is also a separate, not-yet-done step, to be tested against edwardjones.com before wider rollout, consistent with the controlled-rollout approach used for the rest of Phase 0.

## sameAs field disambiguator — Batch 2 (2026-09-24)

Extended `src/routes/api/public/sameas-domain-classifier.ts` (still standalone, still not wired into mapSite()) to cover the next tier down: every token that appears 3-7 times across the registry's 23,334 distinct sameAs node_slugs (~1,951 distinct tokens, another ~14% of usage — cumulative coverage with Batch 1 is now roughly 87%). Reviewed each one by hand and added rules only for the ones that are real, identifiable platforms or registries: more federal agencies (SSA, OSHA, DHS, USCIS, FDIC, NCUA, USPTO, FHWA, NRCS, HHS, National Park Service, and more), professional/credentialing bodies across many verticals (ASCE, ASME, ASTM, ANSI, ABET, NASBA, National Association of Realtors, NAHB, NAIC, NCQA, CFA Institute, and dozens of single-vertical medical/trade associations), and marketplaces/directories spanning automotive (Edmunds, RockAuto, CycleTrader, TractorHouse, TruckPaper, Hemmings, MHVillage), real estate (ApartmentList, BizBuySell), travel/hospitality (KOA, RVshare, Hitched, Bridebook), food (Goldbelly, HalalTrip, Fresha), health/pet (RealSelf, Caring.com, Adopt-a-Pet.com), education (GreatSchools, SchoolDigger, Coursera, Udemy, Skillshare, Upwork, Handshake), reference/media (Forbes, Bloomberg, ProPublica, Wikimedia, DBpedia), and international platforms (Rakuten, Tokopedia, JustDial, Sulekha, Naver, KakaoTalk, italki, IslamicFinder).

Deliberately skipped some real platforms where the recognizing keyword was itself a common English word or a very short acronym with a meaningful collision risk against unrelated slugs (e.g. a bare "guru" or a short 3-letter acronym that also reads as an ordinary word) — those stay on the existing LLM fallback rather than risk a wrong deterministic match.

Result: `SAMEAS_PLATFORM_RULES` now has 377 entries, no duplicate labels, typecheck clean. Nothing else in the file or the worker changed.

Remaining: the long tail below Batch 2 — tokens appearing only 1-2 times each (~5,966 distinct tokens, ~13% of usage) — has not been reviewed; whether to do that exhaustively is still an open call. Wiring `classifySameAsUrl()` into mapSite() is also still a separate, not-yet-done step.

## sameAs field disambiguator — wired into mapSite() (2026-09-24)

Wired the sameAs domain classifier (built in Batch 1 and Batch 2) into the live registry-driven field mapper in src/routes/api/public/disco-ai-worker.ts.

What changed:

1. sameas-domain-classifier.ts: replaced the old classifySameAsUrl(url, platform)|null function with a richer classifySameAs(nodeSlugOrName, candidateUrls) function returning a three-outcome SameAsClassification type:
   - { recognized: false } — slug text doesn't match any known platform; caller falls through to the LLM fallback, same as before.
   - { recognized: true, url: null, platform } — we know exactly which platform this field wants, and this page's own sameAs values positively do NOT include it. This is a confident, deterministic "not found" — not a gap. The caller must not ask the LLM about it.
   - { recognized: true, url, platform } — found it.
   This three-way split was necessary: a plain match/no-match boolean could not distinguish "this platform isn't on this page" (a real answer) from "we don't recognize this slug at all" (an actual gap needing the LLM).

2. disco-ai-worker.ts: added a new collectAllSameAsUrls(blocks) helper right after extractJsonLdBlocks. It walks every JSON-LD block on a page and collects every sameAs URL found anywhere (a page can have more than one @type object, each with its own sameAs array), deduplicated. This is the candidate pool the classifier checks each recognized platform against.

3. disco-ai-worker.ts: rewrote the deterministic pass inside mapSite()'s registry-field-mapping loop. This was the important fix. The existing deterministic pass used deepFindKey(block, row.schema_property) — a plain key-name match. For any row where schema_property === 'sameAs', this would still reproduce the exact same "many fields collapse onto one property" bug that affected the LLM fallback (request_id 29's finding), because deepFindKey just returns the first sameAs array it finds, regardless of which specific field is being asked about. So the fix: rows with schema_property === 'sameAs' now never go through deepFindKey at all. They go through classifySameAs instead:
   - classifier finds a URL → field is set, with the matched platform label and the sample URL recorded (matched_platform, sample_value).
   - classifier recognizes the platform but no matching URL is on this page → field is left unset (a confident "not found"), skipped, and NOT sent to the LLM.
   - classifier doesn't recognize the slug at all (long tail, not yet reviewed) → falls through to the LLM fallback exactly as before.
   All non-sameAs fields are unaffected and still use the original deepFindKey path.

4. disco-ai-worker.ts: the registryFieldMap type was widened with two new optional fields, matched_platform?: string and sample_value?: string, to hold the classifier's output for sameAs fields. This was a necessary follow-on change (TypeScript excess-property checking) rather than a scope change.

Verification done: bunx tsgo --noEmit passes with no errors. Confirmed via grep that classifySameAsUrl no longer exists anywhere in the codebase. Confirmed via targeted view that discoverCompanies, classifyMethod, mapSite's overall structure, CONTRACT_TOOL, the LLM fallback prompt, and mapSite's return statement are all untouched.

Not yet done: this wiring has been typechecked but NOT yet tested against a live map_site request. The next step is to trigger a fresh request for edwardjones.com and confirm the sameAs collapse seen in request_id 29 no longer happens. The hasCredential collapse (14 fields mapped to one generic property, same root cause) is a separate, still-unaddressed gap — it would need an analogous but different fix (matching credential names, not URL domains). The long tail of sameAs slugs (frequency less than 3, ~13% of usage) also remains unreviewed by design, not oversight.

Commit: 58e12f5d04643dea59af5a8ca289c70e38f30d0b

## hasCredential field disambiguator — built and wired into mapSite() (2026-09-24)

Same collapse bug as sameAs, this time on the hasCredential property. request_id=29 (edwardjones.com, gcid:financial_advisor) showed 14 different financial-advisor fields (aif_certification, cfp_certification, cfp_designation, chfc_designation, finra_series_65_license, series_65_license, series_66_license, state_ria_registration, etc.) all mapped onto the single JSON-LD property hasCredential.

Checked hasCredential usage across the whole registry (not just financial_advisor): 43,035 active rows, 30,252 distinct node_slugs, 4,000 gcids. Confirmed via real data (RE/MAX and State Farm pilot records) that the storage convention for this kind of field is free text -- the literal credential name, designation abbreviation, or license number found on the page (examples seen: "ABR", "CA-6010131", "FINRA BrokerCheck") -- never a boolean. The new classifier follows that convention.

Key difference from sameAs: sameAs values are URLs, verifiable against a domain. hasCredential values are free text (a credential or license name, sometimes a number), so matching has to be done on the text of the credential itself, not a URL.

New file: src/routes/api/public/credential-name-classifier.ts, exporting classifyCredential(nodeSlugOrName, candidateTexts), with the same three-outcome contract as classifySameAs: not recognized (falls to the LLM), recognized but this page's credentials don't include it (a confident "not found", skip the LLM), or recognized and found (returns the literal matched text plus a label for the authority/credential).

Built in two batches:
- Batch 1 (freq >= 8 tier, ~82% of all hasCredential token occurrences registry-wide): authority-level rules for OSHA, EPA, USDA, FDA, CPSC, FTC, IRS 501(c)(3), ADA (accessibility-compliance scoped), DOT/CDL, ServSafe, HACCP, Halal, Kosher, food handler cards, TIPS alcohol training, liquor licenses, CPR/First Aid, ASE, AAA-approved auto repair, Apple Independent Repair, NASM, AFAA, notary, cosmetology, veterinary, pesticide applicator, state bar, CPA, seven NAR real-estate designations (ABR, CRS, GRI, SRS, SRES, MRP, e-PRO), general liability, workers' comp, surety bonds, background checks, BBB accreditation.
- Batch 2: two different sources, not just the next frequency tier. (a) Financial-advisor credentials added explicitly regardless of frequency rank -- CFP, CFA, ChFC, CLU, AIF, FLMI, REBC, RHU, RICP, FINRA Series licenses, SEC RIA registration. These are the exact fields from request_id=29 that started this investigation; they were checked and found to be nearly invisible in a registry-wide frequency count because financial credentials concentrate in a handful of finance gcids out of 4,000, diluting into the unreviewed long tail even though they matter. Added by domain knowledge, not frequency. (b) A curated pull of clear, safe, reusable authorities from the freq 3-7 tier: NAR membership, ALTA, AAMVA, IREM, BOMA, NARPM, ICSC, ASID, CISSP, CompTIA Security+, CISA, AKC. The freq 3-7 tier as a whole (2,301 tokens) is far more fragmented than sameAs's equivalent batch -- almost entirely one-off tokens (medical specialties, craft/hobby brands, manufacturer-authorized-dealer programs), each appearing only 3-7 times across the entire registry. Decided NOT to hand-author rules for the rest of that tier, or for the freq<3 long tail (~5,966 tokens) -- left to the LLM fallback, same discipline as sameAs's skips.

Design improvement over the original plan: for ASTM, ANSI, and ISO -- bodies that each issue hundreds of distinct numbered sub-standards (ASTM alone has 260+ distinct registry fields, one per standard number) -- rather than hand-writing one rule per exact number, the classifier extracts the specific standard number directly out of the registry slug (e.g. "f1749" from astm_f1749_product_certification) and builds the text match from that number dynamically. One rule definition per body now covers every number it issues without losing precision: a field asking about ASTM F1749 only matches page text that actually states "ASTM F1749," not just any ASTM mention. The same dynamic approach was used for FINRA Series exam numbers (6, 7, 63, 65, 66, ...).

Wired into disco-ai-worker.ts's mapSite(), mirroring the sameAs wiring exactly: a new collectAllCredentialTexts() helper walks a page's JSON-LD collecting every string found under a hasCredential key (handles a plain string, an array of strings, or an EducationalOccupationalCredential-shaped object with name/credentialCategory/description fields). Rows with schema_property === 'hasCredential' never go through the old deepFindKey key-match path -- they go through classifyCredential instead, exactly parallel to how sameAs rows are handled. No changes were needed to the registryFieldMap type, since the matched_platform/sample_value fields already existed from the sameAs wiring.

Verification done: typechecked clean (bunx tsgo --noEmit), confirmed via targeted review that discoverCompanies, classifyMethod, mapSite's overall structure, the sameAs branch, CONTRACT_TOOL, the LLM fallback prompt, and mapSite's return statement are all untouched.

Not yet done: this has been typechecked but NOT yet tested against a live map_site request. The hasCredential long tail (freq 3-7 tokens beyond the curated Batch 2 picks, and freq<3) remains on the LLM fallback by design. The sameAs long tail also remains on the LLM fallback (unchanged from before this window).

## On-demand Site Remap — button + function for approved sources (2026-09-24)

**What this is:** a manual, on-demand trigger for Station 3 (Site Mapper) on a single already-approved source, instead of needing a one-off test each time. Useful when a site's HTML structure changes, or when a classifier (like the sameAs/hasCredential work above) gets improved and we want existing sources re-learned without waiting for a full re-discovery.

**How it's scoped, relative to the master checklist (docs/Always-On-Profile-Engine-Master-Checklist.md):** this is not Station 9 (Refresh). Refresh is the broader, scheduled, whole-pipeline re-run the checklist marks "to build." This is narrower: it re-runs only the `map_site` step for one source, on demand, by a human click, reusing the exact same governed path (`disco_map_site_ingest`) every real crawl already uses. It required no changes to `mapSite()`, `disco-ai-worker.ts`, or `disco_map_site_ingest` — it only reuses them.

**Database function (`public.disco_request_remap_site(p_source_id uuid) returns bigint`):** validates the source is `status='approved'` and `crawl_method='server_crawl'` (raises a clear exception otherwise, matching the same restriction the real pipeline already enforces on which sources can be mapped), creates a `disco_jobs` row (`step='remap'`) for audit history, then inserts a `disco_llm_requests` row with `tool='map_site'` — the same insert shape `disco_method_ingest` already uses in production. The existing `disco-ai-worker-drain` cron job (runs every 2 minutes) picks it up automatically; nothing new was added to that scheduling path. Returns the new `request_id`.

**UI:** a "Remap" button on the Discovery → Sources tab (`src/components/discovery/source-registry-tab.tsx`), shown only on rows where `status='approved'` and `crawl_method='server_crawl'` (mirrors the function's own guardrails so the button never renders where it would just error). On click it calls the RPC and shows a toast with the returned request id; on failure it shows the RPC's exact exception message. After a request, the row's Status cell shows a small "remap: pending (#id)" indicator that polls `disco_llm_requests` every 15 seconds and flips to "remap: completed," then stops polling. The action is logged to the audit trail as `etl_source_remap`.

**Known limitation, not yet fixed:** the `disco_jobs` row created for a remap (`step='remap'`) never gets marked `done` automatically — the existing completion logic (`disco_check_method_complete`) only watches `step='method'` jobs. The remap itself still runs and writes correctly; only the job-tracking row's status stays stale at `awaiting_ai` in the admin job history. Flagging this now rather than leaving it implicit.

**Verification done:** confirmed the function was created exactly as proposed (byte-for-byte match via `pg_get_functiondef`), confirmed the RE/MAX invariant (`exp_entity` where `source='etl_remax_pilot'` = 33) held before and after, and confirmed the typecheck passed after the UI edit. Not yet done: an actual end-to-end click-through of the new button against a real source (e.g. edwardjones.com) to see a remap complete and the resulting `registry_field_map` update with `matched_platform`/`sample_value` populated.

---

## Roster-link and entity-page detection fixes — Part A (2026-09-24)

**What triggered this:** running the new Remap button against edwardjones.com surfaced two real gaps, traced by reading the live `mapSite()` code line by line. Full diagnosis is in the conversation; summary below.

**Gap 1 — roster-link detection only matched a fixed English keyword list.** `findRosterLink()`'s `ROSTER_HINTS` list (`'find a loan officer'`, `'our agents'`, `'branches'`, etc.) had nothing resembling "financial advisor," so it silently fell back to treating the homepage itself as the roster page for edwardjones.com — and would silently fail the same way for any category whose site copy doesn't happen to match those specific phrases.

**Gap 2 — nothing verified a "detail page" candidate actually described one entity before it was accepted.** The only bar was `hasEntityData()`: JSON-LD present, OR `__NEXT_DATA__`/`__NUXT__` markers, OR more than 2000 characters of text. A rich marketing/search-gate page (Edward Jones' "Find a Financial Advisor" results page, which requires a location or name search before showing any actual advisor) clears that bar easily. Once accepted, the LLM was told this was "the detail page" as settled fact and asked to generalize a pattern from it — it was never asked to judge whether the page was actually a single entity's profile.

**Also found while investigating:** `exp_etl_start_recon` (robots.txt + sitemap discovery) has never run for any of the 11 approved sources in `gcid:financial_advisor` — confirmed via `exp_etl_domains` (`robots_status='unfetched'`, `sitemap_url=null`) across all of them. Its collector, `exp_etl_recon_collect()`, exists and is correctly written but was never scheduled in `cron.job`. That's Part B — a separate SQL change, tracked and applied outside this file's scope (database changes go through the DB approval process, not this doc).

**Fix shipped (Part A, this entry) — `src/routes/api/public/disco-ai-worker.ts`:**

- `getDynamicRosterHints(db, gcid)` — new. Pulls that gcid's `profession_title` terms from `exp_taxonomy` (a floor of 3 terms is already required for every category by the richness gate) and generates phrase variants (`"find a {term}"`, `"our {term}s"`, etc.) at runtime. No code change is needed when a new category is added — the hints regenerate themselves from taxonomy.
- `findRosterLink()` now takes an `extraHints` parameter, merged with the existing static `ROSTER_HINTS` list. The static list is unchanged — those terms (`'locations'`, `'branches'`, `'offices'`, `'our team'`, `'agents'`, etc.) are genuinely cross-category and stay as the baseline, layered with the dynamic taxonomy-driven terms rather than replaced by them.
- `extractAllLinks()` + `pickRosterLinkWithLLM()` — new escalation path. When the combined static+dynamic hints find nothing, the LLM is asked directly which link (if any) leads to a category directory, using the same category-boundary context already used elsewhere in this file. This only runs when deterministic matching fails, not as the default path.
- `hasIdentifiableEntityJsonLd()` — new, stricter check: requires a JSON-LD block with an entity-like `@type` (Person/Organization/LocalBusiness/ProfessionalService/etc., matched by a broad regex, not a fixed list) AND a real `name`. `mapSite()`'s detail-candidate loop now accepts a candidate immediately if this passes; if only the old loose `hasEntityData()` check passes, a new small LLM call (`ENTITY_PAGE_TOOL`) is asked to judge "does this page describe one identifiable entity, or is it a directory/search/marketing page?" and the candidate is only accepted on a yes.
- `mapSite()` now reads `exp_etl_domains.sitemap_url` for the domain and, when one exists, fetches it and puts its `<loc>` URLs at the front of the detail-page candidate list, ahead of homepage-link-guessing (no recursion into sitemap indexes — takes up to 40 `<loc>` entries at that level, same cap `collectDetailUrls` already used). Falls through to prior behavior unchanged when no sitemap exists yet — which, per the gap above, is every source today until Part B ships.
- `classifyMethod()` gained `category`/`boundary` parameters (it previously had no visibility into the category at all) and uses the same combined hints + LLM-escalation path as `mapSite()`.

**Deliberately unchanged:** `ROSTER_HINTS` itself, the CONTRACT_TOOL flow and its prompt, the sameAs/hasCredential classifier branches, `discoverCompanies()`, and `drain()`'s request routing (only the `classifyMethod` call signature changed).

**Verification done:** typecheck (`bunx tsgo --noEmit`) passed clean. RE/MAX invariant (`exp_entity` where `source='etl_remax_pilot'`) reconfirmed at 33, unaffected (this change touches neither RE/MAX's data nor its source config). Not yet done: no live re-run against edwardjones.com or any other source yet — Part A has no effect until Part B (recon wiring, still pending SQL approval) actually populates a `sitemap_url` for at least one domain, and the roster/entity-page fixes haven't been exercised end-to-end against a live category yet either.

---
---

## Backfill — database fixes that shipped without a doc entry (recorded 2026-09-24)

**Why this entry exists:** several database changes went live with a `-- Fix (...)` comment inside the function but no entry in this file, so the "Gaps found" sections above still read "none fixed yet" for gaps that are in fact fixed. Everything below was reconstructed from the live definitions (`pg_get_functiondef`) and `cron.job` on 2026-09-24, not from memory.

**Gap A1 — fixed. `exp_etl_run_source(p_source)`** now seeds `exp_etl_frontier` when Run is clicked, but only if the domain has zero frontier rows (re-clicking Run does nothing). It seeds (a) the latest approved `disco_proposals` `site_map` payload's `sample_roster_url` for that gcid, when that URL contains the domain, classified by `exp_etl_frontier_discover` with no pinned kind; and (b) a sitemap seed. The sitemap seed was a hardcoded guess, `https://{domain}/sitemap.xml`; see the next entry, which replaces it.

**Gap A2 — fixed. `cron.job`** now schedules the fetch/extract/recon chain: `etl-fetch-tick` (90), `etl-fetch-collect` (91), `etl-extract-tick` (92), `etl-extract-collect` (93), `etl-recon-collect` (94), all every minute, plus `etl-recon-retry-sweep` (95) every 15 minutes.

**Gap A3 — fixed. `exp_etl_fetch_collect()`** default branch no longer guesses a gcid from the page kind. If no source for the domain declares that kind in `page_kinds`, the frontier row is marked `error` instead of being filed under a guessed gcid (the old guess could file a financial-advisor page under `gcid:real_estate_agents`). RE/MAX, whose `page_kinds` were already set, is unaffected.

**"page_kinds should come from the flow" — fixed. `disco_map_site_ingest(p_request_id, p_contract)`**: when a contract is accepted (has a `detail_pattern` and `field_floor >= 5`), it now also sets `exp_etl_sources.page_kinds = ['roster_page','detail_page']`, `field_coverage` = the contract's extraction, and `hierarchy_sourceable = true` for that gcid + domain. This is now the only place `page_kinds` is set; it used to be set by hand.

**Part B (recon wiring) — shipped.** New function `exp_etl_recon_retry_sweep()`: picks up to 20 `approved` sources whose domain has `robots_status` `unfetched` or `error` and `last_recon_at` null or older than 6 hours, and calls `exp_etl_start_recon` for each. With cron job 94 collecting results, recon ran for all 11 `gcid:financial_advisor` sources at 2026-09-24 10:09 UTC. That run exposed the status bug fixed in the next entry.

---

## Sitemap capture, selection and seeding — recon + mapSite() + harvest seed (2026-09-24)

**What triggered this:** the 10:09 recon run above gave us real `robots.txt` data for the 11 financial-advisor sources, and checking it showed that sitemaps were being captured, but only one per domain was ever used, sometimes the wrong one, sometimes with an unfetchable URL.

**What was wrong (verified on live data):**

- `exp_etl_recon_ingest` used `trim()`, which in Postgres removes spaces only, so CRLF robots files left a trailing `\r` on every URL (ameriprise.com: `https://www.ameriprise.com/sitemap.xml\r`).
- It kept at most 10 `Sitemap:` lines (zillow.com declares 14; 4 were dropped with no warning) and only read the first 20,000 characters of robots.txt, although sitemap lines usually come last.
- `exp_etl_domains.sitemap_url` was `v_sitemaps[1]`, the first line in the file. For edwardjones.com that was the `.ca` sitemap, not the `.com` one.
- Recon also overwrote `exp_etl_sources.status` unconditionally (`start_recon` set `recon`, then `recon_ingest` set `field_probe`, or `proposed` on a non-200). That is the old onboarding flow. For sources already approved in the disco flow, it un-approved them: after 10:09 all 11 financial-advisor sources were `field_probe`, or `proposed` for wellsfargoadvisors.com (robots.txt 404). Effects: `disco_check_method_complete` counts `status='approved'`, so the category's method step can never complete; the Remap button and `disco_request_remap_site` both require `approved`; and `exp_etl_recon_retry_sweep` can no longer pick those sources up.
- `mapSite()` step 0 read only `sitemap_url`, fetched it, and took the first 40 `<loc>` values with no recursion. edwardjones.com's sitemap is a `<sitemapindex>` whose `<loc>` values are child sitemap files (`/us-en/sitemap/content/sitemap.xml`, `/us-en/sitemap/financial-advisor/sitemap.xml`, `/us-en/sitemap/author/sitemap.xml`), so step 0 was handing XML files to the detail-page loop as candidate profile pages. ameriprise, fidelity, lpl and ml.com each declare two same-host sitemaps (main plus careers/video/research); only one was ever looked at.
- `exp_etl_run_source` seeded the harvest from a guessed `https://{domain}/sitemap.xml` and ignored what recon found.
- No LLM is involved anywhere in sitemap capture or selection. Capture is a string match on robots.txt lines, and the old selection was simply "first line".

**Design decision — who does what:**

- **Recon** captures what robots.txt declares: a cheap, run-once text parse that never fetches a sitemap. It stores the full cleaned list, and it does not decide how many sitemaps get fetched.
- **mapSite()** learns the parsing contract from a *sample*. It needs a few real detail pages, not every page, so it walks sitemap indexes with hard caps and samples children. It does not try to enumerate a site.
- **Harvest** (`exp_etl_fetch_tick` → `exp_etl_fetch_collect` → `exp_etl_frontier_discover`) does full enumeration. It already recurses through sitemap indexes (anything ending `.xml` is re-queued as `kind='sitemap'`, deduped by `ON CONFLICT (url)`) and is throttled per domain by `daily_quota` / `min_delay_seconds` and globally at 25 in flight. A site with one sitemap per city is the harvest's job, not mapSite's. **But see Gap D1 below: the harvest still drops everything past 40 URLs per sitemap file, so full enumeration of large sitemaps does not work yet.**

**Changes shipped:**

1. **`exp_etl_recon_ingest(p_source_id, p_robots_result)`** (database):
   - Strips `\r`/`\n`/`\t` and surrounding whitespace, and accepts `Sitemap:` in any case with leading whitespace.
   - Dedupes, keeping file order. The cap is raised from 10 to 50 and the robots body cap from 20k to 200k characters.
   - New recon keys: `sitemaps_declared` (lines seen before the cap) and `robots_truncated`.
   - `sitemap_url` is now picked by host: the exact domain or `www.` first, then any subdomain of the domain, then the first line as a last resort.
   - `robots_summary` gains `sitemaps_declared`.
   - Status is only changed for sources not in `approved`/`active`/`paused`/`test_pull`. For those sources recon is now a read-only probe.
2. **`exp_etl_start_recon(p_source)`** (database): only moves a source to `recon` if it is not in `approved`/`active`/`paused`/`test_pull`.
3. **`exp_etl_run_source(p_source)`** (database): the harvest sitemap seed now comes from `exp_etl_sources.recon->'sitemaps'`, same-site entries only (the domain or a subdomain of it), with `\r` stripped. `https://{domain}/sitemap.xml` is only the fallback when recon found none. Everything else (the Gap A1 idempotency, the `sample_roster_url` seed) is unchanged.
4. **`mapSite()` step 0** (`src/routes/api/public/disco-ai-worker.ts`, commit `0bba94f6`):
   - It reads `sitemap_url` plus every entry in `recon.sitemaps`, keeps only same-site entries, skips `.gz`, dedupes, and takes up to 5.
   - It walks them breadth-first. A `<sitemapindex>` has its children ranked and the top 3 sampled, up to depth 2. A `<urlset>` has its URLs added to a page pool. There is a hard cap of 8 sitemap fetches per run and 500 `<loc>` read per document.
   - Ranking is deterministic, with no LLM. It uses `sitemapRelevance`: +2 per taxonomy `profession_title` term found in the URL (also hyphen/underscore forms), −3 for generic non-entity words (video, image, news, blog, press, career, job, media, article). Ties keep document order.
   - The page pool is ranked by relevance, then deepest path, and capped at 40.
   - Step 2's existing entity check (`hasIdentifiableEntityJsonLd` plus the `ENTITY_PAGE_TOOL` fallback) still decides whether a candidate really is an entity page.
   - `extraHints` is now computed once at the top of `mapSite()` and reused in step 1.
   - The return value gains a diagnostic `sitemap_trace` (one entry per sitemap fetched: url, depth, index/urlset/error, status, loc count, sampled children). It is stored with the proposal payload and `disco_llm_requests.response`; nothing downstream reads it.
   - Worked example: for `gcid:financial_advisor` the taxonomy term "financial advisor" matches `/sitemap/financial-advisor/sitemap.xml`, so that child of the edwardjones.com index is sampled first.

**Verified:**

- Re-ran recon for all 11 financial-advisor sources after the fix (collected at 11:24 UTC). ameriprise.com's URLs no longer carry `\r`, and edwardjones.com's `sitemap_url` is now `https://www.edwardjones.com/us-en/sitemap_index.xml` (was `.ca`). The other domains are unchanged apart from the new `sitemaps_declared` key.
- The harvest-seed query, run read-only, returns same-site seeds only: edwardjones.com gets only the `.com` index; ameriprise/fidelity/lpl/ml.com get both of their same-host sitemaps.
- The `mapSite()` diff was reviewed line by line against the spec, and `bunx tsgo --noEmit` passes.

**Not yet done / open:**

- **Status restore needed (manual).** The 11 financial-advisor sources are still `field_probe` (wellsfargoadvisors.com: `proposed`) from the 10:09 clobber. The fix stops it happening again but does not undo it. Restoring them to `approved` is a production data write and needs an explicit go-ahead. Until then the Remap button stays hidden for them and the method step cannot complete.
- **No live `map_site` run yet** against any source with the new step 0. That needs the status restore first.
- **Gap D1 is still open, and it now matters directly.** `exp_etl_frontier_discover` stops at 40 URLs per call, and it is called once per sitemap document. So the harvest cannot yet fully enumerate a large sitemap or a sitemap index with more than 40 children (for example, one sitemap per city).
- **`.gz` sitemaps:** mapSite skips them. The harvest would still queue them (`%.xml%` matches `.xml.gz`), and `exp_etl_fetch_collect` would regex a compressed body and find nothing. Affects zillow.com.
- **No sitemap declared:**
  - raymondjames.com declares none, and wellsfargoadvisors.com's robots.txt returns 404, which recon records as `robots_status='error'`. By the robots.txt standard a 404 means "no rules", not a failure.
  - For both, mapSite falls back to homepage link-guessing, and the harvest seed falls back to `/sitemap.xml`.
  - Recon never probes common sitemap paths itself.

## Harvest sitemap walk: Gap D1 fixed, index children, frontier constraints (2026-09-24)

**What triggered this:** the previous entry noted that the harvest stage could not fully enumerate large sitemaps, or sitemap indexes with many children (for example, one sitemap per city), because of Gap D1. This entry fixes that, plus three problems found while testing the fix.

**What was wrong (verified on live data):**

- **Gap D1.** `exp_etl_frontier_discover` had a hard `EXIT WHEN v_n >= 40`, and `exp_etl_fetch_collect` calls it once per fetched sitemap document, then marks the document `parsed`. So every URL past the 40th in any sitemap file was dropped for good. Live example: edwardjones.com's `/us-en/sitemap/financial-advisor/sitemap.xml` is a `<urlset>` listing 500+ advisor URLs (`/us-en/financial-advisor/jim-folmar`, …); only 40 would ever have reached `exp_etl_frontier`. The same limit applied to the children of a `<sitemapindex>`: of 100 city sitemaps, only the first 40 would be walked.
- **Child sitemaps without ".xml" were dropped.** `fetch_collect` passed a sitemap's `<loc>` values to `frontier_discover` with no kind, so a child of an index was only recognised as a sitemap if its URL contained `.xml`. A child like `/sitemap?city=boston` was classified as nothing and dropped.
- **No same-site filter, and `&` was not un-escaped** in `fetch_collect`'s sitemap branch. The sitemap protocol requires `&` to be written as `&amp;`, so captured URLs with query strings were unfetchable.
- **`exp_etl_frontier` CHECK constraints were stale.**
  - `exp_etl_frontier_kind_check` allowed only `sitemap_index`/`sitemap`/`office_page`/`agent_page`. But `frontier_discover` has emitted `roster_page`/`detail_page` since the 2026-09-22 contract-aware change, and `fetch_collect` has branches for `index_page`/`roster_page`.
  - `exp_etl_frontier_status_check` did not allow `done`/`empty`, which `fetch_collect`'s roster_page JSON-LD branch sets.
  - Contracts with patterns already exist for edwardjones.com, schwab.com, lpl.com and morganstanley.com. So the first sitemap fetched for any of them would have raised a check violation inside `fetch_collect`. It has no per-row exception handler, so that would have aborted every run, left the response unprocessed and blocked collection for all domains every minute.
  - Confirmed with a rolled-back test: inserting a contract-matched URL failed with `violates check constraint "exp_etl_frontier_kind_check"`.

**Changes shipped (all database):**

1. **`exp_etl_frontier_discover(p_domain, p_urls, p_kind)`:**
   - The 40 cap is replaced by 50,000, the sitemap protocol's own per-file maximum, kept only as a guard.
   - It is rewritten as one set-based `INSERT … SELECT … ON CONFLICT (url) DO NOTHING` instead of a row-by-row loop.
   - Classification rules are unchanged: the pinned kind wins; otherwise the domain's contract `roster_pattern` → `roster_page`, or `detail_pattern` → `detail_page`; otherwise the old keyword guess.
   - The return value is now rows actually inserted (conflicts excluded). No caller reads it.
2. **`exp_etl_fetch_collect()`**, sitemap branch only; the rest of the function is untouched (applied as an exact text replace of that branch, with a check that aborts if the text wasn't found):
   - It keeps only same-site `<loc>` URLs (the domain or a subdomain of it) and un-escapes `&amp;`.
   - When the fetched document is a `<sitemapindex>`, all its children are pinned to `kind='sitemap'`.
3. **`exp_etl_frontier` constraints:** `kind_check` now also allows `index_page`, `roster_page` and `detail_page`; `status_check` now also allows `done` and `empty`. Both are widened only, and each constraint carries a comment explaining why.
4. **New index `idx_frontier_domain_fetched` on `exp_etl_frontier (domain, fetched_at)`.** Every minute, `exp_etl_fetch_tick` runs a per-domain `count(*)` and `max(fetched_at)` for its quota and delay checks. That was a table scan once the frontier holds thousands of rows per domain, which it now will.

**Verified (rolled-back tests: each ran inside a `DO` block that ends by raising an exception, so nothing persisted; afterwards 0 test rows remained, frontier still 166 rows):**

- 100 child sitemaps + 20 agent pages + 5 unclassifiable URLs + a duplicate + an empty string → 120 inserted (the old code stopped at 40). Re-running the same batch → 0 inserted (conflicts).
- A synthetic `<sitemapindex>` with 60 same-site children like `/sitemap?city=c1&amp;page=1` plus 1 off-site child → 60 queued as `sitemap`; the off-site child was dropped; the first URL came out as `…/sitemap?city=c1&page=1`.
- With a test contract, 300 advisor URLs + 1 directory URL → 300 `detail_page` + 1 `roster_page`, and setting a `roster_page` row to `done` is accepted.
- Scale: one 19,000-URL batch matched by the contract → 19,000 rows inserted in about 2.1 s.

**Not yet done / open:**

- **Crawl rate is now the limit, not discovery.** Every financial-advisor source has `daily_quota = 100` (`min_delay_seconds = 30`), and sitemap fetches count against it. At 100 pages/day a domain with 5,000 advisor pages takes about 50 days. The 30 s delay alone would allow about 2,880/day. Raising quotas is a separate, deliberate decision (politeness, Oxylabs cost, LLM extraction cost per page).
- **Keyword guess still drops profile URLs for domains without a contract.** Pages are only queued if a contract pattern matches, or the URL contains `office`/`agent`. Financial-advisor URLs (`/financial-advisor/<name>`) match neither, so the harvest needs a learned contract first. Four financial-advisor domains have one today; ameriprise/fidelity/ml/wellsfargoadvisors/raymondjames/ubs do not.
- **The contract's `detail_pattern` now matters more.** Any over-broad pattern will queue a whole sitemap's worth of pages, bounded only by `daily_quota`.
- **Very large sitemap bodies are untested end to end.** Nobody has checked whether `disco-webscraper-worker` / Oxylabs return a multi-MB sitemap in full, or truncate it.
- **`mapSite()` `extractLocs` (TypeScript) does not un-escape `&amp;` yet.** Harmless for the edwardjones.com sitemaps checked (no query strings), but it's inconsistent with `fetch_collect`.
- **Still open from the previous entry:** `.gz` sitemaps, and the manual status restore for the 11 financial-advisor sources.

## mapSite() candidate ranking and entity-page check — tested live on edwardjones.com (2026-09-24)

**What triggered this:** first live test of the 2026-09-24 sitemap-walk version of `mapSite()`. The 11 `gcid:financial_advisor` sources were restored to `approved` by hand first (the status reset noted as open in the "Sitemap capture…" entry above is now done), which made the Remap button available again.

**What was wrong (verified on live data):** Remap request #32 (edwardjones.com) walked the sitemap correctly:

- The `sitemap_trace` shows `/us-en/sitemap_index.xml`, then the `financial-advisor` child sampled first (500 advisor URLs), then `content` (500) and `author` (62).
- The learned URL patterns came out right: detail = `/us-en/(financial-advisor|fa)/[a-z0-9-]+/?$`, roster = the advisor search-results page.

But step 2 studied the wrong page. `sample_detail_url` was `/us-en/disclosures/account-agreements/investment-advisory/unified-managed-account-model/manager-brochures`, so `field_floor` and the registry field map were built from a legal document (`firm_name`, `firm_logo` and a batch of `Article.author` fields). There were two causes:

1. **Substring ranking.** `sitemapRelevance` did substring matching, so the taxonomy term "investment advisor" matched "investment-**advisory**". The disclosure URL tied with the real advisor URLs, and the "deepest path first" tie-break put the 7-level disclosure URL ahead of the 3-level profile URLs.
2. **Loose entity check.** `hasIdentifiableEntityJsonLd` accepted any page with an Organization-like JSON-LD node that has a name. Every Edward Jones page carries the firm's own `FinancialService` markup, so the disclosure page passed.

**Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `66a0e5ad`):

- **`sitemapRelevance`** is now token-based:
  - The URL path is split on `/ - _ .`.
  - A term scores +2 only when its words appear as a contiguous run of tokens; a token also matches the word plus "s".
  - It scores −3 once if any token is a negative word.
  - "investment advisor" no longer matches "investment-advisory".
- **`SITEMAP_NEGATIVE`** now also includes `disclosure, legal, privacy, terms, brochure`.
- **Step 0 page-pool ranking.** Each URL carries `fromScore`, the relevance of the sitemap it came from. The pool sorts by own relevance, then `fromScore`, then original order. The path-depth tie-break was removed for sitemap URLs; `collectDetailUrls` keeps its own depth sort.
- **Step 1.** `siteEntityNames = collectSiteEntityNames(home.body)`: the names of every entity-typed JSON-LD node on the homepage, which are the site's own brand/firm names.
- **Step 2.** The candidate loop uses the new `hasPageSpecificEntityJsonLd(html, siteEntityNames)`:
  - It skips nodes under attribution/relationship keys (`author, publisher, creator, contributor, editor, provider, brand, parentOrganization, worksFor, memberOf, sponsor, funder, seller, copyrightHolder, isPartOf, about`).
  - A page counts only if it has an entity-typed node whose name is not one of the site's own names.
  - The `ENTITY_PAGE_TOOL` LLM fallback is unchanged. `hasIdentifiableEntityJsonLd` was removed because nothing used it any more.

**Verified:**

- **Request #33** ran about 20 seconds after the commit, on the not-yet-rebuilt dev deployment. It produced a worse contract (`detail_pattern` = the disclosure URL itself), which was then saved. Lesson: after a worker code change, wait a few minutes for the dev deployment (`project--…-dev.lovable.app`, the `disco_worker_base_url`) to rebuild before testing.
- **Request #34** ran on the new code and **passed**:

| | Result |
|---|---|
| `sample_detail_url` | `https://www.edwardjones.com/us-en/financial-advisor/jim-folmar` (one advisor) |
| `detail_pattern` | `^https://www\.edwardjones\.com/us-en/financial-advisor/[a-z0-9-]+/?$` |
| `roster_pattern` | `^https://www\.edwardjones\.com/us-en/search/financial-advisor/results/?(\?.*)?$` |
| `field_floor` | 10 (was 5) |
| `list_source` / `field_map` | `jsonld`; `name, jobTitle, telephone, description, image, url, worksFor, streetAddress, addressLocality, postalCode, addressCountry` |
| `page_kinds` | `['roster_page','detail_page']` |

- The saved patterns were tested with SQL regex against real URLs. The 3 advisor profiles match the detail pattern. The search page, with and without a query string, matches the roster pattern. The disclosure page, homepage and careers page match neither.
- In the Master Checklist's "Doc vs. reality" section, **DR-7 is resolved for edwardjones.com**. It is still open for lpl.com, morganstanley.com and schwab.com (to be remapped next) and for the 4 sources whose mapping failed.

**Not yet done / open:**

- **The registry field map is still noisy.** The generic `deepFindKey` pass assigns any field whose schema.org property name appears anywhere on the page. So firm-level fields (for example `firm_founding_date` ← `FinancialService.foundingDate`, taken from the nested `worksFor` office) sit alongside the advisor's own fields. This is a known limitation of the key-name matcher, not of this change.
- **Still to remap:** lpl.com, morganstanley.com and schwab.com, then ameriprise/fidelity/ml/wellsfargoadvisors.
- **Run is still not safe to click.** The `gcid:real_estate_agents` fallback in `exp_etl_extract_collect` (Master Checklist DR-13) would mis-tag extracted advisors.

## Extracted professionals no longer fall back to gcid:real_estate_agents — Master Checklist DR-13 fixed (2026-09-24)

**What triggered this:** the "Doc vs. reality" validation (Master Checklist, DR-13) flagged that clicking Run for any non-real-estate category would mis-file every extracted person. It had to be fixed before Run is used for `gcid:financial_advisor`.

**What was wrong (verified on live data):**

- `exp_etl_extract_collect()` picks the gcid for `professional` entities by looking for a source on the same domain whose `page_kinds` contains `agent_page`.
- If none exists, it fell back to a **hardcoded `'gcid:real_estate_agents'`**. That was left over from the RE/MAX pilot: the 2026-09-22 "Fix 2" replaced the hardcoded source lookup but kept this fallback.
- The disco flow (`disco_map_site_ingest`) only ever sets `page_kinds = ['roster_page','detail_page']`. edwardjones.com has exactly that, so every advisor extracted from its profile pages would have been staged under `gcid:real_estate_agents`.
- Only people were affected. Locations and teams use the extract-queue row's own gcid, which was already correct.
- If this had run, cleanup would have been manual. `exp_etl_stage_ingest`/staging treats a record as new when the gcid differs, so re-crawling with the right gcid would have added duplicates, not corrected them.

**Change shipped (database):** `exp_etl_extract_collect()`, one line, applied as an exact text replace that aborts if the line isn't found:

- The fallback is now `v_q.gcid`, the gcid already on the page's `exp_etl_extract_queue` row, instead of the hardcoded value.
- The `agent_page` lookup is kept on purpose. On multi-category domains like remax.com it is what files roster people found on `gcid:real_estate_agency` office pages under `gcid:real_estate_agents`.
- A `-- Fix (DR-13 mis-tag, 2026-09-24)` comment in the function explains this.

**Verified (rolled-back test):** a `DO` block inserted two synthetic pages end to end — frontier row, extract-queue row, fake `net._http_response` with an LLM-style JSON body, and extract-request row. It then ran the real `exp_etl_extract_collect()` and raised an exception at the end so nothing persisted. Afterwards, 0 test rows remained in `exp_etl_frontier`, `exp_etl_extract_queue`, `net._http_response` and `exp_etl_staging`. There were 0 real pending extract requests at the time.

| Test page | Staged as | Before the fix |
|---|---|---|
| edwardjones.com advisor profile (queue gcid `gcid:financial_advisor`) | professional → `gcid:financial_advisor` | `gcid:real_estate_agents` |
| remax.com office page (queue gcid `gcid:real_estate_agency`) | location → `gcid:real_estate_agency` | unchanged |
| a roster agent listed on that remax office page | professional → `gcid:real_estate_agents` | unchanged (via the kept `agent_page` lookup) |

**Not yet done / open:**

- **Other blockers remain before Run is fully meaningful:** staging → graph (`exp_etl_resolve`) is still not wired (DR-15), and there is still no field-yield gate (DR-10). Run will now stage advisors under the right category, but nothing promotes them to profiles yet.
- **Other sources still need remaps:** lpl.com, morganstanley.com and schwab.com, whose contracts point at non-profile pages (DR-7).

## Site mapper learns whether detail pages describe a person or a business — replaces hand-typed agent_page/office_page labels (2026-09-24)

**What triggered this:** a follow-up to the DR-13 fix above. People found on a page were filed under a separate category only when a source had been hand-labelled with `agent_page` in `page_kinds`, and only remax.com had that label, typed in during the RE/MAX pilot. The site mapper never sets it. Any website registered under two categories and learned by the engine itself — for example a brokerage under both `gcid:real_estate_agency` and `gcid:real_estate_agents` (compass.com, exprealty.com, kw.com, remax.com and zillow.com are all registered that way today) — would have had every person and office filed under whichever category the page happened to be crawled for.

**What was wrong (verified on live data):**

- `exp_etl_extract_collect` routes people by `'agent_page' = ANY(page_kinds)`.
- `disco_map_site_ingest` only ever writes `page_kinds = ['roster_page','detail_page']`.
- Only the two remax.com rows carry the hand-typed `agent_page` / `office_page` labels. There is no audit trail for who set them, and the `disco_map_site_ingest` comment says `page_kinds` "used to be set by hand".

**Changes shipped:**

1. **Database — `disco_site_contract.detail_entity_type`** (new column, `CHECK` in `professional` / `location`). It records what one detail page on that domain describes for that category.
2. **Database — `disco_map_site_ingest`** stores `p_contract->>'detail_entity_type'` when it is one of the two allowed values, otherwise NULL.
3. **Database — `exp_etl_extract_collect`**, in this order:
   - **People** → the category of an approved/active contract on the same domain whose `detail_entity_type = 'professional'`. If there is none, the legacy `agent_page` lookup (kept only for remax.com). If there is none of those, the page's own gcid.
   - **Locations** → the category of an approved/active contract whose `detail_entity_type = 'location'`, otherwise the page's own gcid.
   - The page's own category wins ties.
   - Teams keep the page's own gcid.
   - The logic is documented in a `-- Fix (learned page role, 2026-09-24)` comment in the function.
4. **Worker — `mapSite()`** (`src/routes/api/public/disco-ai-worker.ts`, commits `d54fc19c` and `7730f7e4`). The new `detectPageEntityKind` reads the chosen detail page's JSON-LD and applies these rules in order:
   - (a) a `ProfilePage` means a person;
   - (b) a qualifying `mainEntity` decides it;
   - (b2) qualifying nodes whose `url`/`@id` is this page decide it;
   - (c) otherwise, the shallowest qualifying node(s) in a breadth-first walk that skips relationship keys (`worksFor`, `employee`, `member`, `author`…) decide it — a mix of persons and businesses at that depth means undetermined.
   - "Qualifying" uses the same rules as the page-specific entity check: the node is not the site's own brand/firm.
   - If it is still undetermined, one `ENTITY_PAGE_TOOL` call supplies `entity_kind` (person or business). `ENTITY_PAGE_TOOL` gained an optional `entity_kind` field.
   - The contract now returns `detail_entity_type` and a diagnostic `detail_entity_type_source` (`jsonld` / `url_match` / `llm`).

**Verified:**

- **Database, rolled-back test.** A `DO` block created a synthetic domain registered under both `gcid:real_estate_agents` (contract `professional`) and `gcid:real_estate_agency` (contract `location`), plus test pages for edwardjones.com and remax.com. It ran the real `exp_etl_extract_collect()`, then raised an exception so nothing persisted. Afterwards, 0 test rows remained in any table.

| Page crawled | Entity found | Filed under |
|---|---|---|
| synthetic office page (crawled for agency) | the office | `gcid:real_estate_agency` |
| same office page | a roster agent listed on it | `gcid:real_estate_agents` (learned route) |
| synthetic agent page (crawled for agents) | the agent | `gcid:real_estate_agents` |
| same agent page | the office named on it | `gcid:real_estate_agency` (new location routing) |
| edwardjones.com advisor page (one category) | the advisor | `gcid:financial_advisor` |
| remax.com office page (legacy labels) | office / roster agent | `gcid:real_estate_agency` / `gcid:real_estate_agents` (unchanged) |

- **Worker, unit test.** `detectPageEntityKind` was run locally against 7 JSON-LD cases, and all passed:
  - person with `worksFor` → professional;
  - business with `employee` persons → location;
  - `ProfilePage` → professional;
  - `WebPage.mainEntity` business → location;
  - mixed `@graph` → undetermined;
  - only the site's own org → undetermined;
  - article with an author person → undetermined.
- **Worker, live.** Remap request #35 ran the first version: edwardjones.com's advisor page has a person plus a second business node at the same level, so the result was undetermined. After adding (b2) and the LLM tie-break, request #36 returned `detail_entity_type = professional` (source `llm`), and it is saved on edwardjones.com's contract. The sample page and patterns are unchanged from the passing #34 result.

**Not yet done / open:**

- **remax.com is still on the legacy route.** It has no disco contract yet. The `agent_page` fallback can be retired once it is onboarded through the site mapper.
- **LPL, Morgan Stanley and Schwab** still need remapping (Master Checklist DR-7). Each remap now also records `detail_entity_type`.

## New source status `no_profiles_on_site` — site mapper records "this domain has no profile pages for this category" (2026-09-24)

**What triggered this:** remap request #37 on lpl.com failed with "no fetchable entity detail page found (76 candidates)", and that result was correct:

- LPL's sitemaps (`home.sitemap.xml`, `research/sitemap.xml`) list only corporate, recruiting and research pages.
- The investor-facing advisor finder is a JavaScript map with no advisor links in the HTML.
- LPL advisors run their own websites on their own domains.
- The people on `/join-lpl/…/your-recruiter.html` are LPL recruiters, not client-facing financial advisors.

Three problems followed from this:

1. The failure left LPL's old, wrong contract in place (detail pattern = `/about-us/careers/locations/…`), so Run would have crawled careers pages.
2. LPL still showed as Ready (`server_crawl`) with a Run button.
3. A failed remap saved no record of which pages it tried.

`js_needs_api` did not fit either: it means the profiles exist on the site but render via JavaScript, which is a different fix.

**Changes shipped:**

1. **Database — status values.** `exp_etl_sources.crawl_method` and `disco_site_contract.method` CHECK constraints now also allow `no_profiles_on_site` (constraint comments explain it).
2. **Database — `disco_site_contract.method_evidence jsonb`** (new column): why the method was set.
3. **Database — new governed RPC `disco_map_site_no_profiles(p_request_id, p_evidence)`.** The AI proposes; this function decides.
   - It **rejects the write** unless `p_evidence.tried` has at least 3 entries with `ok: true` and `p_evidence.ai_verdict = 'no'`.
   - On success it:
     - **clears the stale layout** (roster/detail patterns NULL, extraction `{}`, `field_floor` 0, `detail_entity_type` NULL);
     - sets `method = no_profiles_on_site` and stores the evidence;
     - sets the source's `crawl_method = no_profiles_on_site`, `page_kinds` NULL and `hierarchy_sourceable` false;
     - adds a `method_class` proposal;
     - completes the request;
     - marks a `remap` job `done` (remap jobs used to stay `awaiting_ai` forever);
     - calls `disco_check_method_complete`, which already counts any method other than `unprobed`/`server_crawl` as resolved.
4. **Database — `disco_request_remap_site`** now also accepts `no_profiles_on_site` sources, so the status is reversible with one Remap click.
5. **Worker — `mapSite()`** (`src/routes/api/public/disco-ai-worker.ts`, commit `619f9b36`):
   - **Tried pages.** Step 2 records every candidate tried, with a reason: fetch failed / accepted / no page-specific JSON-LD entity / LLM: not an entity page — why.
   - **Evidence gate.** When no detail page is found, the gate needs at least 3 candidates fetched OK, plus either a sitemap `urlset` with URLs or link candidates.
   - **AI confirmation.** If the gate passes, one call with the new `NO_PROFILES_TOOL` (`hosts_profiles` yes/no/unsure, `where_profiles_live`, `note`) sees the category, the tried pages with their reasons and up to 50 homepage links. Only a "no" returns `outcome: 'no_profiles_on_site'` with the evidence.
   - **Otherwise** a `MapSiteError` is thrown, carrying diagnostics.
   - **`drain()`** sends the no-profiles outcome to the RPC. Failed requests now keep their diagnostics (tried pages, `sitemap_trace`, roster URL, gate result, AI verdict) in `disco_llm_requests.response`.
6. **UI:**
   - `crawl-method.tsx` has the label "No profiles on site", a reason line, and the status counts as blocked.
   - `source-registry-tab.tsx` shows Remap for approved `server_crawl` **or** `no_profiles_on_site` sources.
   - `category-population-tab.tsx`: the blocked-box badge now shows the real status label instead of a hardcoded "Needs proxy group", and no-profiles sources show a "Where profiles are: …" line from `method_evidence`.

**Verified:**

- **RPC, rolled-back test.** Weak evidence (1 fetched page) was rejected: the request was set to `error` and nothing else changed. Strong evidence (3 pages, verdict `no`) cleared lpl.com's layout, set both statuses, stored the evidence, added the proposal and completed the request. After the rollback, lpl.com was unchanged.
- **Live, request #40 (lpl.com), completed with `no_profiles_on_site`:**
  - Sitemaps read: `home.sitemap.xml` (500 URLs) and `research/sitemap.xml` (213).
  - 5 pages tried, all rejected by the LLM as marketing/white-paper pages or the homepage.
  - AI verdict `no`, where profiles live: "advisors' own independent websites/practice sites, not as pages on lpl.com".
  - The saved contract now has method `no_profiles_on_site`, no patterns and `field_floor` 0. The source is `no_profiles_on_site` and no longer Ready. The remap job is `done`.
  - Method job 7 is still `awaiting_ai`, as expected, because other sources are still unresolved: rwbaird.com is unprobed, and ameriprise/fidelity/ml/wellsfargoadvisors have failed maps.

**Also noted (documentation backfill):** `disco_request_remap_site` contains a block commented `-- NEW:` that starts recon again for the domain when its `robots_status` is `unfetched` or `error` before queueing the remap. That block was not covered by the "On-demand Site Remap" entry above.

**Not yet done / open:**

- **An alternative source for LPL's advisors** (the firm's advisor-search API, or a registry such as FINRA BrokerCheck) is future work under the acquisition ladder's structured-feeds lane.
- **Next remaps:** morganstanley.com and schwab.com (Master Checklist DR-7), then the 4 sources whose mapping failed. Ameriprise is expected to land in `no_profiles_on_site` too (its advisors are on ameripriseadvisors.com).
---

## Site mapper made generic: subdomain profiles, robust link scoring, block detection, pattern check (2026-09-24)

**What triggered this:** remapping morganstanley.com. Its advisor profiles live on a different subdomain of the same company (`advisor.morganstanley.com/aaron.blum`), not on `www`. The mapper first saved a wrong `/profiles/` pattern (executive bios), then marked the site `no_profiles_on_site` (request 42), even though its own AI verdict said "profiles live on advisor.morganstanley.com". The user asked for generic fixes, not per-site ones.

**What was wrong (verified on live runs 42–45):**

- **Profile sitemaps were never stored.** The harvest re-guessed the sitemap every Run.
- **Subdomain homepage links were silently dropped.** `rankRosterLinks()` only matched anchors whose inner HTML was under 400 characters. A "Get Matched with a Financial Advisor" button with an SVG icon was skipped, so the advisor subdomain was never probed (request 42: `subdomain_robots: []`).
- **URL words were not split for matching.** A careers page (`/people/experienced-professionals/financial-advisors`) won the roster pick.
- **Irrelevant sitemap URLs used up every try.** All 6 detail tries went to score-0 sitemap URLs (podcasts, articles); the roster page's links were never tried.
- **Normal pages were read as bot-blocked.** `looksBlocked()` in `disco-webscraper-worker.ts` (and `looksBotBlocked()` in the AI worker) substring-matched phrases such as "captcha" across the whole raw HTML, scripts included. Normal pages with a reCAPTCHA contact form or Cloudflare's injected `/cdn-cgi/challenge-platform` script looked "blocked". Request 43 found the right profile URLs, but every fetch returned `ok:false` with `status:200`.
- **A successful remap kept the stale no_profiles verdict.** It did not clear an earlier `no_profiles_on_site` verdict: after request 44, `disco_site_contract.method` and `exp_etl_sources.crawl_method` still said `no_profiles_on_site`.
- **Nothing checked the AI's detail_pattern.** A pattern matching every one-word page on the host was accepted.

**What changed:**

1. **Database — `disco_site_contract.profile_sitemaps text[]`** (new column).
   - `disco_map_site_ingest` stores the contract's `profile_sitemaps` array.
   - `exp_etl_run_source` seeds the harvest from `profile_sitemaps` first, then the recon same-site sitemaps, then `/sitemap.xml`.
2. **Database — `disco_map_site_ingest(p_request_id, p_contract)`:** when a contract is accepted, it resets a stale `no_profiles_on_site` verdict:
   - `disco_site_contract.method` goes back to `server_crawl` and `method_evidence` is set to NULL;
   - `exp_etl_sources.crawl_method` goes back to `server_crawl` (only when it was `no_profiles_on_site`).
   - Marked `-- Fix (no_profiles reset, 2026-09-24)`.
3. **Worker commit `01aaa9cb`** (`disco-ai-worker.ts`):
   - generic roster-link ranking (`rankRosterLinks`, +3 taxonomy phrase / +1 generic hint / −5 negative, same site incl. subdomains);
   - reads the `robots.txt` of up to 3 other same-site subdomains the best links point to, and walks their sitemaps first (`subdomain_robots` in the result);
   - `hostRelevance` scoring of subdomain names;
   - URL-shape diversification of candidates (`urlTemplate`);
   - shard sitemaps map to their parent index for `profile_sitemaps` (`isShardSitemap`);
   - a category-fit check (`fits_category`) on every candidate detail page.
4. **Worker commit `dff3bfca`:**
   - `rankRosterLinks` now matches anchors of any length, strips svg/script/style, and adds `aria-label`/`title`. URL punctuation becomes spaces before hint matching.
   - More negatives: experienced professionals, students, graduates, internship, hiring, apply now, join our team, join us. More generic hints: find a, find an, locator, near me, near you, directory.
   - Candidate order is now: relevant sitemap URLs (score > 0), then roster-page links, then the rest.
   - The no-profiles AI returns `profiles_url`, and its prompt says subdomains of the site root are part of the site. If that URL is on a same-site host not yet probed, `mapSite()` retries once from it (`self_heal` in the result; `first_pass` in diagnostics if the retry fails).
5. **Worker commit `88e904e9`:**
   - `looksBlocked()` in `disco-webscraper-worker.ts` (now exported) judges phrases only on the page `<title>`, or on the visible text of small pages (< 3000 chars, with script/style/noscript/svg removed). A 401/403/407/429/503 status or empty content still counts as blocked.
   - `looksBotBlocked()` in the AI worker reuses it.
   - Failed-fetch `tried` entries now carry `error`, `body_len` and `rendered`.
6. **Worker commit `62734229`:** `checkDetailPattern()`.
   - After the contract call, the AI's `detail_pattern` must match the accepted detail URL. It must not match the home URL, the roster URL, or any candidate the pipeline rejected.
   - If it fails, the contract is asked for once more with the problems listed, and the better result is kept.
   - The outcome is recorded as `detail_pattern_check` in the contract.

**Verified:**

- **Helper unit tests:** `rankRosterLinks`, `hostRelevance`, `sitemapRelevance`, `urlTemplate`, `isShardSitemap` and `extractRobotsSitemaps` were run locally with tsx against Morgan Stanley-style HTML, including a 40-path SVG button.
- **Rolled-back test of the ingest reset:** re-ingesting request 44 inside a transaction gave method `server_crawl`, `method_evidence` NULL, and source `crawl_method` `server_crawl`, `approved`.
- **Live remap of morganstanley.com, request 45** (`completed`):
  - roster `advisor.morganstanley.com/search`, sample detail `advisor.morganstanley.com/aaron.blum`, `detail_entity_type` `professional`, `field_floor` 8;
  - `profile_sitemaps` `[https://advisor.morganstanley.com/sitemap.xml]`, `subdomain_robots` populated;
  - contract `method` and source `crawl_method` both `server_crawl`, source `approved`.
- `bunx tsgo --noEmit` passed after every commit.

**Still open:**

- **Loose saved pattern.** The saved `detail_pattern` `^https://advisor\.morganstanley\.com/[a-z0-9]+(?:[.-][a-z0-9]+)*/?$` still matches bare one-word pages such as `/search` and team pages such as `/1-centaur-group`. `checkDetailPattern` missed it because the roster URL it tested carries a query string (`?icid=…`) and the pattern ends in `/?$`. Fix next: also test each must-not-match URL with its query string and fragment removed. The harvest checks `roster_pattern` first, so `/search` itself is classified as a roster page, but other one-word pages would be queued as profiles. Do not Run Morgan Stanley until this is fixed.
- The advisor subdomain times out from plain datacenter IPs (seen from the Lovable sandbox); it works through Oxylabs.
- No Edward Jones regression remap has been run yet on the new code.
---

## Detail-pattern check also tests URLs without their query string; Morgan Stanley + Edward Jones re-verified (2026-09-24)

**What triggered this:** the "Still open" item in the previous entry. `checkDetailPattern()` tested the Morgan Stanley roster URL only as `https://advisor.morganstanley.com/search?icid=…`. The loose pattern ends in `/?$`, so it passed even though it matches the bare `/search`.

**Changes shipped:**
- **Worker commit `7b7641a3`** (`disco-ai-worker.ts`, `checkDetailPattern()`): each must-not-match URL is now tested both as-is and with its query string and fragment removed (`new URL(u)`, then `search = ''` and `hash = ''`). The must-match test is unchanged.
- **Checked for duplicates first:** the existing `normalizePageRef()` also removes the scheme and `www.`, so it cannot be used to test full-URL regexes.
- **Not an ETL change:** that commit also added a personal "Approval discipline" section to `CLAUDE.md`. Commit `8c968f4e` removed it again, and `CLAUDE.md` is identical to its state before `7b7641a3` (verified with `get_diff` against `969f7123`).

**Verified:**
- **Locally (node):** the loose pattern `^https://advisor\.morganstanley\.com/[a-z0-9]+(?:[.-][a-z0-9]+)*/?$` tests false on `…/search?icid=ms-nav` and true on the stripped `…/search`, so the new check now flags it.
- **Live remap of morganstanley.com, request 46** (`completed`, `method`/`crawl_method` `server_crawl`):
  - saved `detail_pattern` `^https://advisor\.morganstanley\.com/[a-z0-9]+\.[a-z0-9-]+$`;
  - SQL regex test matches `aaron.blum` and `john.smith-jones`, and does not match `/search`, `/contact`, `/1-centaur-group`, `/aaron.blum/business_planning` or `www…/profiles/melissa-james-managing-director`;
  - `detail_pattern_check.first_problems` was empty, so the corrective retry was not needed on this run.
- **Edward Jones regression, request 47** (`completed`):
  - same detail pattern as before, now written as `^https?://(www\.)?edwardjones\.com/us-en/financial-advisor/[a-z0-9-]+/?$`;
  - `field_floor` 10, `detail_entity_type` `professional`, `method` `server_crawl`;
  - `profile_sitemaps` is now populated (`/us-en/sitemap/financial-advisor/sitemap.xml`; it was NULL before);
  - pattern test: `jeff-hoernschemeyer` matches; `/us-en/financial-advisor/` and the search-results page do not.

**Still open:**
- **Morgan Stanley team pages are not covered.** Pages such as `/1-centaur-group` do not match the saved person pattern. This is consistent with `detail_entity_type = professional`; whether team pages should be harvested as businesses is a separate decision.
- **Corrective retry not yet exercised live.** Neither run above needed the corrective contract retry.

---

## Site contract: JSON-LD + CSS/label rules for universal and taxonomy keys — learned once by the site mapper, reused by the harvest (2026-09-25)

**What triggered this:** a trace of the Run step showed that the harvest sends every page to the LLM and stores free-text keys, and `exp_etl_fetch_collect` strips all scripts, so JSON-LD is lost. Goal: the AI is used mainly to learn a deterministic contract once per site; the harvest applies the same contract without AI.

**What changed:**

1. **Contract module `src/routes/api/public/-disco-site-contract.ts`** (the leading dash keeps it out of the file router; it is not in `routeTree.gen.ts`). Dependency `cheerio` (imported from `cheerio/slim`, host-agnostic). Pure functions, no DB or network. It is also the only JSON-LD reader in the codebase (`extractJsonLdBlocks`, `collectSiteEntityNames`, `hasPageSpecificEntityJsonLd`, `deepFindKey` moved here from the worker). Capabilities:
   - checks every rule on 5 sample detail pages and counts hits; a field is kept when it is found on at least 1 sample;
   - labels each value as person, location (branch) or firm; firm = the site's own entity names or JSON-LD identical on every sample; site-wide values move to firm or are dropped;
   - validates values by type and key: phone, email, url, state, city, postal code, names, job title, fax guard, cross-field clash, multi-line addresses (`parseAddress`), `address_block` derivation;
   - `address_owner`: the address is learned once on the location; the person inherits it when there is no distinct person address;
   - parse-once cache and a 60-second time budget;
   - `applyContractV2(html, pageUrl, contract, siteEntityNames)` — the same function validates rules while learning and extracts values during the harvest.
2. **`mapSite()` in `disco-ai-worker.ts`**, after the detail pattern is accepted: (1) 5 samples from the profile sitemap pool and roster links; (2) JSON-LD tier; (3) one locator AI call for everything JSON-LD did not produce (CSS/label rules, cleaned HTML of 2 samples); (4) must-haves — name, phone or email, city, state — with one corrective call, otherwise `MapSiteError` and the saved contract is left untouched; (5) saved as `extraction.site_contract` (version 3) with `site_contract_summary`.
3. **Tuning from live runs (fixes 1–8, commits `901ce3f3`–`81949ba0`):** key-specific validators (city/state rules had pointed at the phone link); cross-field clash rule; fax guard and fax keys (firm phone had pointed at the fax link); person address no longer duplicates the branch address (later `address_owner`); page chrome removed from the AI prompt (Schwab: the AI saw only the navigation); parse-once cache (CPU); multi-line address parsing; Fix 8 — `location.address_block` with city/state/ZIP derived from it.
4. **Fix 9 — database, `public.exp_disco_ai_worker_tick()`:** the pg_net call to the worker now uses `timeout_milliseconds := 300000` (was 60 s, which cut off map runs). Marked `-- Fix (worker timeout, 2026-09-25)`. Rollback: set the timeout back to 60000.
5. **Fix 10 — worker drain loop (commit `b1797d4e`):** after one `map_site` request the worker returns; remaining pending rows wait for the next tick and are only marked `sent` when their processing starts. Other request types keep the batch of 5.
6. **Consolidation (commit `347339e5`):** `src/lib/etl/contract-v2.ts` moved to the dash file above; the worker's duplicate JSON-LD helpers removed.
7. **Taxonomy layer (commit `bcb623cb`)** — replaces `registry_field_map` and `REGISTRY_FIELD_TOOL`. `mapSite()` loads the category's `exp_vertical_node_registry` keys once (active; `owns_lane` empty or 'website'; not `Question`). Ids are `tax.<node_slug>`; value type from `schema_property`; JSON-LD tier by dotted path; CSS in the same locator call (max 120 rules). Contract keys: `taxonomy_fields`, `taxonomy_unmapped`, `taxonomy_duplicates` (flag only), `taxonomy_candidates`. Universal keys stay separate (dedupe and must-haves).
8. **Taxonomy fixes 11–15 (commit `e074b86d`):** subject from `schema_type` first (Person → person, organization types → firm, other types → location; `entity_scope` only when `schema_type` is empty); shared-property keys get their own item — sameAs via `classifySameAs`, hasCredential via `classifyCredential` (both re-wired; the consolidation had removed their only call site), other shared multi-value properties filtered by the key's distinctive words, else `ambiguous_shared_property`; site-wide rule for taxonomy keys; a URL equal to the page's own URL is rejected; JSON-LD reader accepts an unquoted `type` attribute.
9. **Taxonomy fixes 16–19 (commit `1ce127c4`):** `credential-name-classifier.ts` FINRA Series code now read from long slugs (`series[\s_-]?(\d{1,3})(?!\d)`); classifier matches exempt from the site-wide rule; location-typed keys no longer fall back to firm; label rules anchored on the site's own brand name are rejected.

**Verified (live remaps, all `completed`, must-haves ok):**

| Run | Edward Jones | Morgan Stanley | Schwab |
|---|---|---|---|
| Universal only | #58: 21 fields | #59: 10 fields | stuck at `sent` (#60) before Fixes 9–10 |
| Taxonomy layer | #61: 21 + 29 taxonomy | #62: 19 + 14 | #63: 15 + 10 |
| Fixes 11–15 | #64: 21 + 24 | #65: 18 + 12 | #66: 15 + 15 |
| Fixes 16–19 | #67: 19 + 13 | #68: 19 + 13 | #69: 15 + 13 |

- Schwab: city, state and ZIP derived from the branch address block on 5 of 5 samples.
- After fixes 11–15, sameAs keys no longer share one link and award keys no longer share one list; the CFP classifier matches the 2 of 5 advisors who hold it.
- Series licence keys are correctly not found on these three sites: the pages do not state series numbers (Morgan Stanley writes registrations by name, e.g. "General Securities Representative").
- 170 taxonomy candidates per site; `bunx tsgo --noEmit` and the local tests passed after every commit.

**Still open:**

- **Registry duplicates for the taxonomy owners:** `advisor_name`/`advisor_full_name`, three CFP keys, `primary_office_address`/`primary_service_address`, `job_title_display`/`advisor_job_title`, `toll_free_number`/`phone_number` (same property), `years_in_practice` mapped to `foundingDate`.
- **Schwab `appointment_booking_url`** takes the firm homepage (key has no `schema_type`).
- **Edward Jones `youtube_channel`** (firm channel on every page) is labelled person since classifier matches are exempt from the site-wide rule.
- **Run-to-run variation** in the CSS tier (e.g. Edward Jones fax found in #64, not in #67).
- **Harvest not yet wired:** Phase B (rule-based harvest in the webscraper worker using `applyContractV2`, staging keyed by taxonomy slugs) and Phase C (drift check / remap required) are next.
- **Stuck `sent` requests are never reclaimed** (Master Checklist DR-6): #50, #53, #55, #60.

---

## Phase B code step: rule-based harvest endpoint `disco-harvest-worker` + generic contract names (2026-09-25)

**What triggered this:** the Run trace (see the previous entry's "Harvest not yet wired") showed detail pages are sent to the LLM as script-stripped text and staged with free-text keys. Phase B applies the site contract instead, without AI.

**Changes shipped (commit `4dc8a243`):**

1. **Generic names** in `-disco-site-contract.ts` and `disco-ai-worker.ts`: `applyContractV2` → `applySiteContract`, `finalizeContractV2` → `finalizeSiteContract`, type `ContractV2` → `SiteContract` (alias removed); worker locals and the time-budget constant renamed. The saved `version: 3` stamp in the contract JSON is unchanged (it is data, not a code name).
2. **Contract saves what the harvest needs:** `site_contract.site_entity_names` (homepage entity names) and `site_contract.firm_signatures` (max 50). `jsonLdSignature` now returns a 16-character FNV-1a 64-bit hash of the same JSON string; learning and applying use the same function.
3. **Pure harvest helpers** in `-disco-site-contract.ts`: `applyAddressOwner` (copies the location address into empty person address keys when `address_owner = 'location'`), `recordMustHave` (the contract must-have rule on one page, reusing `computeMustHave`), `buildHarvestRecord` (payload keyed by taxonomy slug plus `_contract {version, learned_at}`; `identity_candidates` with flat universal keys and a `universal` map; `shallow` when a must-have fails or fewer than 70% of `field_floor` values are filled).
4. **New route `POST /api/public/disco-harvest-worker`** (`x-disco-worker-key` required). Body `{url, domain, gcid, crawl_method, frontier_id?}`. Loads the `disco_site_contract` row (cached 10 minutes), checks `detail_pattern`, fetches with `scrapeWebsite`, checks `looksBlocked`, applies the contract and returns `{ok, record, status_code, contract_version}` or `{ok:false, reason}`. No AI calls, no database writes, no HTML in the response. Not yet called by any SQL function.

**Verified:**
- Type check and build passed; the route tree includes the new route and still excludes the dash file; 11 helper/handler tests passed (run outside the repo, since test tooling is not a project dependency).
- Remaps #70–#72 completed (must-haves ok) and saved `site_entity_names` for all three sources (`firm_signatures`: 0 / 0 / 1).
- Live calls to the endpoint (via `net.http_post`, 6 pages not used as mapping samples, nothing written to app tables):

| Page | Must-have | Filled / needed | Result |
|---|---|---|---|
| Edward Jones jason-land | ok | 39 / 7 | staged-ready, address inherited from branch |
| Edward Jones matt-north | ok | 35 / 7 | staged-ready |
| Morgan Stanley miles.a.smith | ok | 24 / 6 | staged-ready (middle-initial URL matched) |
| Morgan Stanley milin.rao | ok | 29 / 6 | staged-ready |
| Schwab michael-blazina | missing city, state | 15 / 5 | shallow — a phone-based branch page with no address (correctly not invented) |
| Schwab mark-symm | ok | 25 / 5 | staged-ready |

**Not yet done / open:**
- **SQL wiring not done:** `exp_etl_fetch_tick` does not call the endpoint and `exp_etl_fetch_collect` does not stage its records yet (structural changes S1–S2, pending separate approval); staging dedupe index (S3) pending.
- **Stage 6 compatibility:** `exp_etl_resolve` (still uncalled, DR-15) reads `payload->>'name'`; harvest payloads are keyed by taxonomy slug and carry the name in `identity_candidates.name`, so the resolver must be adjusted when Stage 6 is wired.
- **Data quality seen:** Edward Jones `firm_name` taxonomy key and `branch_name` hold the advisor's name (the site's branch entity is named after the advisor); Schwab names can include designations ("…, CWS®"); Schwab street is not parsed from its one-line address block; Schwab `appointment_booking_url` is the firm homepage.
- **Tests are not kept in the repo** (tooling would need a package change).

---

## Harvest wired to the site contract: fetch_tick → disco-harvest-worker, fetch_collect stages records, staging dedupe index (2026-09-25)

**What triggered this:** the previous entry shipped `POST /api/public/disco-harvest-worker`, but no SQL function called it; detail pages still went to the webscraper and then to per-page LLM extraction (Master Checklist DR-12), and Edward Jones roster pages would have been staged directly (non-negotiable 1, DR-21).

**Changes shipped (database, each approved separately as S1–S3):**

1. **S1 — `exp_etl_fetch_tick()`** (`-- Fix (contract harvest, 2026-09-25)`): the source lookup also reads `max(gcid)`; the picked frontier row also reads `kind`. When `kind = 'detail_page'` and `disco_site_contract` (same domain, `category_slug` = the source gcid) has `extraction.site_contract.version >= 3`, the page is posted to `/api/public/disco-harvest-worker` with `{url, domain, gcid, crawl_method, frontier_id}` and a 250 s timeout. Every other page still goes to `/api/public/disco-webscraper-worker` with the 60 s timeout. Quota, delay and the 25-in-flight cap are unchanged.
2. **S2 — `exp_etl_fetch_collect()`** (`-- Fix (contract harvest, 2026-09-25)`, two blocks):
   - A new first branch handles harvest responses (JSON with `record` or `reason`): the record is staged through `exp_etl_stage_ingest` (dedupe on `detail_url`, `gcid`) with `field_tier = 'core'`; a record flagged `shallow` (must-have missing, or fewer than 70% of the field floor) is set to `resolution_status = 'shallow'`; the frontier row becomes `done`. Failures become `error` (`not_detail_page` becomes `skipped`). The latest open `exp_etl_runs` row of the source is updated (`pages_fetched`, `entities_yielded`, `staged`, `errors`) — the first code that updates these counters.
   - Roster pages of a source with a site contract now only yield links: hrefs are resolved against the page host, `&amp;` un-escaped, filtered by the contract's `detail_pattern` and queued as `detail_page`; nothing is staged from a roster page. The old `list_source = 'jsonld'` roster staging and the LLM path remain only for sources without a site contract.
3. **S3 — index `idx_staging_detail_url_gcid`** on `exp_etl_staging (detail_url, gcid) WHERE detail_url IS NOT NULL`, backing the dedupe check in `exp_etl_stage_ingest`.

**Checked for duplicates first:** reused the existing tick/collect cron jobs (90, 91), quota/delay/in-flight logic, `exp_etl_stage_ingest`, the existing `shallow` status and the existing `exp_etl_runs` counters. No new table, column, status or cron job.

**Verified:**
- Both function definitions read back after the change; each new block is present exactly as approved and the untouched branches are unchanged. The index exists (`pg_indexes`).
- Rolled-back test (DO block ending in `RAISE EXCEPTION 'ROLLBACK_RESULT …'`): two real harvest responses from the endpoint test were fed to `exp_etl_fetch_collect` — Edward Jones `jason-land` was staged `pending`, `professional`, `gcid:financial_advisor`, 16 payload keys including `_contract`, `identity_candidates.name` "Jason B Land", city "Elko"; Schwab `michael-blazina` was staged `shallow` (no branch address on the page); both frontier rows became `done` and the request links were removed.
- No live source was affected: the only running source (RE/MAX) has no site contract, so its pages still go to the webscraper and LLM path.

**Rollback:** S1 and S2 — reverse the same text replacements (restore the previous `SELECT … max(fetch_tier)` / `SELECT frontier_id, url` lines and the single webscraper `net.http_post`; remove the harvest branch and the roster link-only branch and turn the two `ELSIF`s back into `IF`). S3 — `DROP INDEX public.idx_staging_detail_url_gcid;`.

**Not yet done / open:**
- **Live test not run yet** (needs approval: lower Edward Jones' daily quota for a small test, then Run).
- **Throughput** remains capped per site (Production dependency 3).
- Run still sets the source to `active`, which blocks remap (`disco_request_remap_site` needs `approved`).
- Staging → graph (`exp_etl_resolve`, DR-15) is not wired and must read the name from `identity_candidates` for harvest rows.

---

## Harvest value quality: AI key roles, toll-free guard, firm-level links, URL and address typing, staging page filters (C1–C8, 2026-09-25)

**What triggered this:** the first live harvest (Edward Jones, 18 staged rows) showed values that would carry into profiles: `firm_name` held the advisor's name, `toll_free_number` repeated the main phone, the firm's YouTube channel was attached to every advisor, `contact_action` was an in-page anchor (`#fa-contact-form`), and both address keys were one flat string. The staging page showed "Unnamed record" for harvest rows and had no filters or paging.

**Changes shipped (code only; commits 2376c39c0545a8d7c7883a9cde259ab32f9dc462 for C1–C7, 18b270bb16583831651430f30c4c9ff5030e8476 for C8):**

1. **C1 — AI key roles while mapping** (`-disco-site-contract.ts`, `disco-ai-worker.ts`): the existing locator call also returns `taxonomy_roles` (person / branch / firm / own_page_url) for keys whose registry subject is wrong; saved in the contract and re-applied to the JSON-LD and CSS tiers. A universal alias fallback lets a taxonomy key reuse a universal field with the same schema.org meaning (from the last segment of `schema_property` only). Safety net: a non-person taxonomy value equal to the page's person name is dropped (`equals_person_name`).
2. **C2 — brand-site own-page URL:** a url-typed, non-firm key marked `own_page_url` is saved as `own_page_key`; `disco-harvest-worker` fills it with the page URL when `exp_etl_sources.source_type = 'brand_site'`.
3. **C3 — toll-free guard:** a key whose slug says toll-free must hold a North American toll-free number (800/833/844/855/866/877/888).
4. **C4 — firm-level links:** only credential classifier matches stay exempt from the site-wide rule; a sameAs value identical on every sample becomes firm-level. Each harvest record carries `payload._subjects` (slug → person / branch / firm); `_contract` and `_subjects` are not counted as fields.
5. **C5 / C8 — URL values:** `potentialAction` keys are url-typed. Taxonomy URLs must be URL-shaped (absolute, `//`, `/`, `./`, `../`, `?`; no whitespace or `| < > " { }`; `#…` and `javascript:` rejected; `tel:`/`mailto:` only for action keys); url-typed CSS rules read `href`/`src`/`content`, never element text.
6. **C6 / C8 — structured addresses:** keys on schema.org `address` store `{streetAddress, addressLocality, addressRegion, postalCode, addressCountry, text}` (JSON-LD PostalAddress normalised, strings parsed with `parseAddress`). C8 made address values compatible with the universal address fields in the clash rule (they had all failed validation) and added a safety net: a non-address key equal to the page's address is dropped (`equals_address`).
7. **C7 — staging records page** (`src/components/discovery/pipeline-tab.tsx`): record name from `identity_candidates.name` then `payload.name`; field count skips `_` keys; address objects shown as one line with parts; subject badge per value; Category → Source → Status filters; server-side pages of 50 with a total count; summary cards follow the filters.

**Verified:**
- Type check and build passed after each step; fixture tests passed (C1–C7: 10 tests; C8: 3 tests, 25 checks; run outside the repo).
- The first live check after C1–C7 (remaps #73–#74) found regressions: address keys all failed validation, `contact_action` accepted visible text resolved as a URL ("Contact Me"), and a business-name key held the branch address. C8 fixed these.
- Remaps #75 (Edward Jones, after its status was set back to `approved`), #76 (Morgan Stanley), #77 (Schwab): all completed, must-haves ok; taxonomy fields 14 / 10 / 14.
- Live endpoint calls on one page per site (nothing written to app tables):
  - Edward Jones: `firm_name` no longer mapped (`equals_person_name`); `contact_action` = the advisor's real contact page URL; both address keys are objects with street, city and ZIP; `youtube_channel` labelled firm.
  - Morgan Stanley: `contact_action` (a button with no link) is now unmapped instead of junk.
  - Schwab: address keys are objects with city, state and ZIP; the business-name key that held the address is unmapped (`equals_address`); `website_url` = the branch's locator page.

**Not yet done / open:**
- No own-page key was chosen on any site: the financial-advisor registry has no key meaning "the advisor's own page"; the taxonomy owners need to add one.
- Edward Jones `business_logo` and `firm_logo` hold the advisor photo (the site's branch JSON-LD uses the advisor photo as its image).
- Edward Jones address objects lack `addressRegion` (the state is present in the universal keys); Schwab street is not parsed from its one-line block, whose text also contains the phone.
- Morgan Stanley names can include designations ("…, CFP®, CFA®"); `geo_coordinates` holds latitude only.
- Schwab `appointment_booking_url` is the firm homepage (labelled firm).
- Site-wide rule drops a person value that is identical for every sampled advisor (e.g. an identical job title).
- The AI returned no role overrides on the latest remaps (it did on #73–#74); the safety nets covered the cases seen.
- The 18 Edward Jones staging rows from the first run still hold the old values (staging skips known URLs; the refresh change S6 is pending approval). The staging page filters would benefit from index S5 (pending approval).

---

## Harvest value fixes and brand pass (C9, 2026-09-25)

**What triggered this:** after C1–C8, live checks still showed Edward Jones branch/firm logo keys holding the advisor photo, address objects missing the state, Schwab address text containing the phone, and geo coordinates holding latitude only. Firm data that sits in page headers/footers or on the homepage (main phone, email, head-office address) was never collected, because advisor-page rules deliberately ignore page chrome; Morgan Stanley had no firm fields at all.

**Changes shipped (code only; commits `c48cfc2`, `8f6f1c1`, `05be4f2`, `a100f7b` in `-disco-site-contract.ts`, `ecbb9cb` in `disco-ai-worker.ts` and `disco-harvest-worker.ts`):**

1. **Logo equal to the person's photo is dropped** (universal `*.logo_url` and taxonomy `logo` keys); a key rejected on every sample is unmapped with reason `equals_person_photo`.
2. **Address parts filled from universal keys** when the address object is consistent with them (same postal code or city); existing parts are never overwritten. A trailing phone number is stripped from the address text.
3. **Geo coordinates stored as `{latitude, longitude}`** (JSON-LD GeoCoordinates, a "lat, lng" string, or two locator rules with `part`); a single coordinate is rejected.
4. **Brand pass (firm profile), once per site in `mapSite()`, no extra AI call:** firm ids (`firm.firm_name`, `logo_url`, `phone_main`, `website`, `social_links`, and new universal `firm.email`, `firm.address_block`) and firm-default taxonomy keys not found in JSON-LD are asked for in a separate "FIRM IDS" section of the existing locator call, with the homepage and one sample's header/footer/nav as input (`chromeHtmlForPrompt`). A firm rule is accepted only if its value is identical on the homepage and every sample that has it. Results are saved as `site_contract.firm_profile {values, sources, learned_at}`; `site_contract_summary.firm_profile_fields` counts them. Harvest records carry only `payload._firm_ref {learned_at}`; a person/branch value equal to a firm-profile value is labelled firm. Advisor and branch rules whose matches all sit in header/footer/nav score no hits.

**Verified:**
- Type check and build passed; fixture tests passed (5 tests, 47 checks; run outside the repo).
- Remaps #78 (Edward Jones), #79 (Morgan Stanley), #80 (Schwab): all completed, must-haves ok.
- Live endpoint calls on one page per site (nothing written to app tables): Edward Jones logo keys no longer hold the advisor photo and both address objects now include the state (NV); Morgan Stanley `geo_coordinates` = `{latitude 40.349…, longitude -74.064…}` and both address objects have street, city, state and ZIP; Schwab address text no longer contains the phone.
- `firm_profile`: Edward Jones 5 values and Schwab 5 values (name, logo, website, social links, plus one firm-level taxonomy link), all from JSON-LD or the homepage; Morgan Stanley 0.

**Not yet done / open:**
- **The brand pass found no chrome values yet:** on Edward Jones and Schwab the proposed rules for firm phone, email and head-office address all failed validation (`rule_failed_validation`); on Morgan Stanley no firm rules were proposed at all. The reason is not recorded in the contract (no per-page diagnostics for firm rules). Possible causes to check: homepage and profile pages use different chrome (Morgan Stanley profiles live on a subdomain), or values differ slightly between pages.
- **Run-to-run variation in AI-proposed rules:** on this remap Schwab `phone_number` (taxonomy) was not mapped (the universal phone was), and Morgan Stanley's job-title rule returned only "Vice President,". Remaps currently replace all rules even when the previous ones still validate.
- A key the AI re-assigns to firm in the same call is not included in the brand pass.
- Schwab street is still not parsed from its one-line address block; Schwab `appointment_booking_url` is the firm homepage (now inside `firm_profile`); Morgan Stanley names can include designations.

---

## Brand-pass diagnostics, relaxed firm check, sticky rules on remap, contact fallback (C10, 2026-09-25)

**What triggered this:** after C9 the brand pass found no header/footer values and the contract did not say why; every remap replaced all rules, so values changed from run to run (e.g. Schwab's taxonomy phone key disappeared on #80).

**Changes shipped (code only; commits `3a173ca`, `aeb3472` in `-disco-site-contract.ts`, `bb4dd89` in `disco-ai-worker.ts`):**

1. **Firm-rule diagnostics:** `site_contract.firm_profile.diagnostics` records, per firm rule, the validated and raw values on the homepage and each sample, the outcome (`accepted`, `varies`, `not_found`, `failed_validation`) and a note (e.g. `homepage_differs`, `homepage_missing`, `homepage_only`, `equals_person_or_branch_phone`, `type_clash`, `single_sample`). Capped at 40.
2. **Relaxed firm check:** a firm value identical on at least 2 samples (and every sample that has it) is accepted even when the homepage differs or lacks it; a homepage-only value is accepted when no sample contradicts it; a value on one sample only needs the homepage to match.
3. **Sticky rules:** `mapSite()` first re-validates the previous contract's CSS/label rules (universal, taxonomy, firm) on the new samples; rules that still pass are kept (`kept_from_previous`) and only missing ids go to the AI. A new rule for a kept id becomes its backup. `site_contract_summary.rules_kept` counts them.
4. **Contact fallback:** a branch telephone/email taxonomy key with no branch value aliases the person field (and vice versa); firm keys excluded.

**Verified:**
- Type check and build passed; 6 fixture tests passed (outside the repo).
- Remaps #81 (Edward Jones), #82 (Morgan Stanley), #83 (Schwab): all completed, must-haves ok; `rules_kept` 6 / 26 / 14.
- `firm_profile`: Morgan Stanley now has 4 values from the page chrome (logo, website, social links, YouTube), where it had none; Edward Jones and Schwab keep 5 each.
- Diagnostics explain the remaining gaps: on Edward Jones the proposed "firm" phone and address were the branch's (rejected: equal to the branch phone / different on every page) and no firm email exists on the pages; on Schwab the head-office address was found on the homepage only.
- Live endpoint calls on one page per site (nothing written to app tables): all three records complete, must-haves ok; Schwab `phone_number` is mapped again.

**Not yet done / open:**
- **Sticky rules can keep a valid but incomplete rule:** Morgan Stanley's job-title rule (kept) still returns only "Vice President," — it validates, so it is kept.
- **Value-anchored selector accepted:** Schwab's head-office address rule uses `:contains('<the address text>')`, i.e. the selector contains the value itself; that value also did not reach `firm_profile.values`.
- A key the AI re-assigns in the same call can lose its kept rule; kept category rules are re-checked under their default role.
- **Unrelated file in the same change:** `src/integrations/supabase/previewAuthStorage.ts` was modified in this change set (preview auth storage write-back); it is outside the ETL scope and was not requested.

---

## Cut-off text, value-anchored selectors, homepage-only firm values (C11, 2026-09-25)

**What triggered this:** after C10, a kept Morgan Stanley job-title rule returned only "Vice President,"; Schwab's head-office address rule selected by the address text itself (`:contains(...)`) and its homepage-only value never reached `firm_profile.values`.

**Changes shipped (code only; commits `58c1c4f`, `e27a7c9` in `-disco-site-contract.ts`, `e926295` in `disco-ai-worker.ts`):**

1. **Cut-off text rejected:** a text value (or list item) ending with `,` `;` `:` `-` `–` `—` `/` `|` `&` or an opening bracket, or made only of punctuation, is treated as cut off and rejected. Kept (sticky) rules are re-validated with the same check.
2. **Value-anchored selectors rejected:** CSS rules using `:contains(`, `:-soup-contains(` or `:has-text(`, and any rule whose selector or label contains the value it extracts (6+ characters, case and punctuation ignored), fail validation; firm diagnostics note `value_anchored`. The locator prompt now says to select by structure, never by text content.
3. **Homepage-only firm values kept:** a firm rule accepted as `homepage_only` is flagged so the final contract step no longer drops it for having no sample hits; the value appears in `firm_profile.values` with source `homepage`.

**Verified:**
- Type check and build passed; 6 fixture tests (22 checks) passed outside the repo; only the two files changed (+62/−5).
- Remaps #84 (Edward Jones), #85 (Morgan Stanley), #86 (Schwab): all completed, must-haves ok; `rules_kept` 8 / 30 / 16.
- Schwab `firm_profile` now includes the head-office address ("Charles Schwab & Co., Inc., 3000 Schwab Way Westlake, TX 76262-8104", source homepage) through a structural footer rule (no `:contains`). Morgan Stanley keeps logo, website, social links and YouTube from the chrome; its firm phone and address candidates were rejected as `varies` (they were branch values).
- Live endpoint call on the Morgan Stanley page that returned "Vice President,": the job-title value is now empty instead of cut off; the record is still complete (must-haves ok).

**Not yet done / open:**
- **Multi-part values:** Morgan Stanley lists several job titles in separate elements; the kept rule reads only the first, so on pages where the first part ends with a comma the value is now empty rather than joined.
- Edward Jones pages show no firm phone, email or head-office address (the only candidates were branch values, rejected).
- The unrelated change to `src/integrations/supabase/previewAuthStorage.ts` noted in the C10 entry is still in place.

---

## Territory proposer profile counts (2026-09-25)

**Trigger:** the Territories proposer needed real per-logo profile counts (locations + professionals) to size territories at ~500K profiles.

**What changed:** new read-only function `public.exp_territory_logo_profiles()` (migration `0003_exp_territory_logo_profiles.sql`), returning `(group_key, logo_id, logo_name, logo_gcid, locations, professionals)` per root organization. Locations = descendants of the root in `organizations`; professionals = `professionals` whose `primary_org_id` is in that tree; group = `exp_category_group_members` by the root's gcid, else `_catchall`. SECURITY DEFINER, STABLE, EXECUTE granted to authenticated/service_role only. Reads only organizations, professionals and exp_category_group_members — no graph or taxonomy tables. Packing logic is in-lib (`proposeTerritories` in `src/lib/territories.ts`) and writes pending `exp_territory_proposals` only.

**Verified:** same query run directly: 6 root logos; State Farm 20,182 locations + 19,221 professionals (insurance_agency); RE/MAX, Keller Williams, Coldwell Banker 6 + 24 each (real_estate); two mortgage logos have no group (→ `_catchall`). Type check passed.

**Open:** every current group is below the 250K floor, so live proposals are all "combine small groups" type; the family match (last word of the group label) is a heuristic.

---

## Reference: existing components for website data outside the taxonomy (recorded 2026-09-28, no change made)

**Why this entry exists:** profile pages carry facts that no taxonomy key or universal key covers. This records what already exists in the project for such data, as found by reading the live code and database. Nothing was changed.

**1. `site_contract.unkeyed` (site mapper, `disco-ai-worker.ts` / `-disco-site-contract.ts`)**
- During `mapSite()`, the locator AI call also returns up to 20 labelled facts per site that none of the requested ids cover, each as `{ label, sample }` taken from the sample pages.
- They are saved in `disco_site_contract.extraction.site_contract.unkeyed` and counted in `site_contract_summary.unkeyed`.
- No extraction rule is kept for them: the harvest (`disco-harvest-worker`, `applySiteContract`) does not collect these facts from harvested pages, and they are not written to staging.

**2. Table `exp_field_discovery` (per-gcid list of discovered labels)**
- Columns: `discovery_id`, `gcid`, `element_kind`, `raw_label`, `normalized`, `proposed_ring`, `proposed_schema_property`, `relevance_verdict`, `reason`, `seen_count`, `first_source`, `registered_node_slug`, `status`, `created_at`.
- Constraints: unique `(gcid, element_kind, normalized)`; `relevance_verdict` ∈ `expertise_signal`, `additive`, `chrome_reject`, `needs_review`; `status` ∈ `evaluated`, `registered`, `rejected`, `queued_review`.
- Contents on 2026-09-28: 13 rows, all `element_kind = 'element'` from earlier insurance-agent work (e.g. "Get a Quote", "File a Claim", "Send Payment" from `myagentbrandonlee.com`): 10 `expertise_signal` / `registered`, 2 `chrome_reject` / `rejected`, 1 `needs_review` / `queued_review`.
- The current harvest pipeline does not write to it.

**3. Function `exp_should_insert(p_gcid, p_kind, p_label, p_source)` (the writer for `exp_field_discovery`)**
- Normalises the label and classifies it with keyword rules: site chrome (cookie, privacy, terms, copyright…) → `chrome_reject`; conversion actions (quote, book, appointment, contact, portal…) → `expertise_signal`, ring `conversion`, `potentialAction`; credentials (license, certified, designation, FINRA, NMLS…) → ring `authority`, `hasCredential`; reputation (review, rating, award…) → ring `reputation`, `aggregateRating`; local presence (hours, map, areas served…) → ring `location`; social/content links → `sameAs`; anything else → `needs_review`.
- **Auto-registers:** for an `expertise_signal` with no matching active node in `exp_vertical_node_registry` (same gcid and ring), it immediately inserts a new registry node (`<label>_node`, `entity_scope 'shared'`, description "NEW - discovered by ETL expertise gate from <source> (R40)") and writes an `exp_curation_ledger` entry.
- Upserts the label into `exp_field_discovery` (existing label → `seen_count + 1`) and returns the verdict, ring, schema property and reason.
- No function, cron job or UI currently calls it.

**Status:** parked by decision — the current harvest set-up is unchanged; extra website data is not collected today.

---

## Multi-part text values: join or strip trailing separators (C12, 2026-09-28)

**What triggered this:** after C11, a job title shown as several parts ("Vice President," …) was rejected as cut off, leaving the value empty.

**Changes shipped (code only; commits `5c244de`, `6712368` in `-disco-site-contract.ts`):** a non-`multi` text rule matching several elements whose first text ends with a separator joins the parts (up to 10 parts / 2000 characters); a text value that still ends with a separator has the separator stripped and is kept ("Vice President," → "Vice President"); only a trailing opening bracket or punctuation-only text is still rejected; list items are stripped and deduplicated the same way.

**Verified:** type check passed; 9 fixture tests passed outside the repo. Remap #87 (Morgan Stanley) completed, must-haves ok, 30 rules kept. Live endpoint call on https://advisor.morganstanley.com/milin.rao: the job title is now "Vice President" instead of empty.

**Not yet done / open:** the full title ("Vice President, Financial Advisor, Portfolio Management Director, Family Wealth Advisor") was not joined, because the rule matches only the first title element and the other parts follow it as sibling content in the same container (addressed by C13).

---

## Multi-value keys stored as lists; State Farm reference (C13, 2026-09-28)

**What triggered this:** fields with several values (e.g. several job titles) were stored as one text value or cut off. The State Farm data was checked as a reference for how multi-valued fields were handled before.

**State Farm reference (read-only check, no change):** the State Farm parser (`exp_sf_parse`, mirrored by `parseStateFarmAgent` in `src/lib/etl-statefarm.ts`) captured multi-valued fields as native JSON arrays in `exp_etl_staging.payload.deep` — text arrays (`languages`, `office_hours`) and arrays of objects (`licenses` `{raw, state, number, primary}`, `products`, `team`, `social`); about 45% of agents have more than one language and about 48% more than one license. Hydration copied only `languages` to `professionals.languages` (text[]) and kept one primary license (`primary_license_*`). `exp_sf_nodalize` created one `graph_nodes` row per array element (language, product_service, social_profile, credential, team_member, about), except office hours (one node holding the array). None of these nodes is linked to `exp_vertical_node_registry` (`node_registry_id` NULL), although matching registry keys exist; the only joined strings (`description`, a `·`-joined `bio`) were never split.

**Changes shipped (code only; commits commit not identified):**
1. Multi-valued keys are decided by `schema_property` (last segment): the existing list properties plus `jobTitle`, `affiliation`, `availableLanguage`, `serviceType`, `employee`, `openingHours`, `openingHoursSpecification`. Name, description, address, URL, geo, telephone, email and fax stay single.
2. For list keys, several values are collected from several matched elements, from sibling parts that follow a first part ending in a separator, or from explicit list breaks (line breaks, `•`, `·`, `;`, `|`); commas inside a single text are not split. Items are stripped, trimmed and deduplicated.
3. Universal single-text keys such as `person.job_title` hold the full joined text when sibling parts are found.
4. Harvest records keep lists as arrays in `payload`; the staging records page shows list values as separate chips.

**Verified:** type check passed (`bunx tsgo --noEmit`, exit 0); 12 fixture tests passed outside the repo (4-element list, sibling-part list, 1-item list, comma-in-one-text not split, `;` and `<br>` splits, telephone/email single, universal job_title joined, plus all C12 regressions). Live remap and endpoint verification follow in the next entry.

**Not yet done / open:** Station 6 (node creator) should follow the same pattern as State Farm — one graph node per list item — and additionally link each node to its registry key.

---

## Harvest refresh, staging index and C13 live results (2026-09-28)

**What triggered this**
Re-harvesting a page that was already staged was skipped by `exp_etl_stage_ingest` (one row per detail URL and gcid), so rule improvements (C12/C13) never reached rows staged earlier. Staging page queries filtered by gcid and source and ordered by time needed an index.

**What was wrong (verified on live data)**
- Edward Jones rows staged on 2026-09-25 kept `operating_hours` as one string after C13 because the re-fetch returned early.
- The staging page filters `gcid` + `source_id` ordered by `observed_at` with no matching index.

**Changes shipped**
- S5: index `idx_staging_gcid_source_observed` on `exp_etl_staging (gcid, source_id, observed_at DESC)`.
- S6: `exp_etl_stage_ingest` — new block `-- Fix (harvest refresh, 2026-09-28)` before the duplicate check: when a row with the same `detail_url` and `gcid` is still `pending` or `shallow` and was contract-harvested (`payload ? '_contract'`), it is updated in place (payload, identity_candidates, entity_type, field_tier, resolution_status = 'pending', observed_at = now()). Resolved rows are never touched; new pages are inserted as before.
- D1 (data): the 18 Edward Jones detail pages in frontier status `done` were set back to `queued` for one re-harvest run.

**Verified**
- Function definition read back after the change; the rest of the function is unchanged.
- D1 run: 18 pages harvested with contract learned 2026-09-28; 34 distinct Edward Jones staged rows, no duplicates; 16 of the 18 have `operating_hours` as a 7-item list (the other two pages show no hours). Two existing rows were refreshed in place and 16 pages were staged for the first time.
- C13: Morgan Stanley `milin.rao` harvests 4 job titles as a list; Edward Jones office hours harvest as a 7-item list.

**Not yet done / open**
- 16 Edward Jones rows staged on 2026-09-25 still hold the old values: their frontier rows show status `queued` with a 2026-09-25 `fetched_at`, so they were not in the D1 set. They refresh when the queue reaches them; why these frontier rows are `queued` has not been traced yet.
- The universal `person.job_title` for Morgan Stanley still holds the first title only; the taxonomy keys hold the full list.

---

## Extra fields — staging only (C14) (2026-09-28)

**What triggered this**
Detail pages carry facts that neither the universal fields nor the category's taxonomy keys cover. They were listed as `unkeyed` labels in the site contract, with no rules and no values. The requirement is to collect them into staging, show them separately, never promote them, and avoid creating the same concept under different keys across websites and categories.

**What was wrong (verified on live data)**
- The three financial advisor contracts held 26 `unkeyed` labels with no rules. About a third were already taxonomy or universal fields (job title, credentials, phone, profile photo), several were site chrome (buttons, hero images, disclosures), and the rest were real extra facts, some repeated across sites under different wording (for example "Personal Interests" and "Personal interests and affiliations", "Team Members" and "Client Service Team").
- `exp_field_discovery` / `exp_should_insert` dedupe by wording only and auto-register registry nodes; its one run (insurance_agent, 2026-08-03) created near-duplicates of existing keys. It is not used for this change.

**Changes shipped**
- Contract module: extra ids `extra.<key>`, `extra_fields` and `extra_dropped` in the site contract, `normalizeExtraKey`, `extraKeyWords`, `finalizeExtraFields`, `applyExtraFields`; extras validated on all samples with the existing rule checks (chrome, value-anchored, list and cut-off handling), rejected when their value equals a universal or taxonomy value on the same sample, dropped when identical on 3 or more samples; cap 20 per site; sticky rules include extras; `buildHarvestRecord` writes `payload._extra` (not counted in fields or the shallow check).
- AI worker (mapSite): the locator call receives the shared extra-key list and returns a key, a match hint and a rule per extra; code decides the key in this order — universal field (drop), this category's taxonomy key (drop, recorded), existing extra key by name or word set (reuse), registry slug from any category (reuse), else new. Kept keys are recorded in `exp_field_discovery` with `element_kind = 'extra_field'`, status `queued_review` (no registry writes, `exp_should_insert` not called). Summary counts `extra_fields`, `extra_new`.
- Harvest worker: applies `extra_fields` and passes the values to the record.
- Pipeline page: the expanded profile shows Taxonomy, Static and Extra as separate sections; the Fields column shows T / S / E counts.
- No database structure changes.

**Verified**
- To be completed after the remap of the financial advisor sources.

**Not yet done / open**
- Existing contracts learn extras only after a remap; existing staged rows get `_extra` on their next harvest.
- Extra values are never promoted; a later review decides whether any key becomes a taxonomy key.

---

## Extra fields — live results and diagnostics (C14a) (2026-09-28)

**What triggered this**
First live remaps with C14 (requests #90 Edward Jones, #91 Morgan Stanley, #92 Schwab).

**What was wrong (verified on live data)**
- Morgan Stanley: the locator named 9 extra facts (mission statement, NMLS #, insurance license #, designations, services, client service team, recent update, service categories, CRC number) with sensible keys, but all 9 rules failed validation on the samples; the proposed rules are not saved, so the cause cannot be seen.
- Schwab: `mailing_address` holds the firm's standard mailing address, not the professional's; it passed the site-wide check because the value is not identical on every sample.

**Changes shipped**
- `extra_dropped` entries for validation-type reasons now carry the proposed `rule` and the `found` / `samples` counts (`-disco-site-contract.ts`, `disco-ai-worker.ts`).

**Verified**
- C14 live: Edward Jones kept `focus_areas`, `personal_interests`, `new_client_waitlist_status`; Schwab kept `employment_history`, `mailing_address`, and reused `personal_interests` (key_source `existing_extra`); Schwab drops were correct (job title and education are universal fields; experience summary, branch address and branch phone matched taxonomy keys); Morgan Stanley "Services Include" resolved to the existing key `focus_areas` before its rule failed.
- Shared list (`exp_field_discovery`, `element_kind = 'extra_field'`): 5 keys, `personal_interests` seen on 2 sites, no near-duplicates, no registry writes.
- Harvest endpoint (no database writes): Edward Jones `andy-straube` → `_extra` with 6 focus areas and 4 personal interests; Schwab `denise-patridge` → 6-item employment history, 1 personal interest and the mailing address; field counts and the shallow flag unchanged.

**Not yet done / open**
- Morgan Stanley extras: remap with diagnostics, then a generic fix based on the saved rules.
- Firm-level values kept as extras (Schwab mailing address) need a generic rule.

---

## Extra fields — quality guards (C14b) (2026-09-28)

**What triggered this**
The Morgan Stanley remap with C14a diagnostics (#93) kept 7 extras, and a harvest test of one profile showed three of them were wrong.

**What was wrong (verified on live data)**
- `focus_areas` (20 items) matched every tab list on the page: services mixed with degrees, credentials and affiliations; items carried hidden link text such as "Footnote1".
- `personal_interests` held the professional's whole biography story (a generic description selector).
- "Client Service Team member" was stored under the existing key `employment_history` because the AI copied an unrelated existing key and it was trusted.
- `designations` began with ", "; two team-member extras were found on only 1 of 5 samples.
- `seen_count` in the shared list counted map runs, not sites.
- Correct drops confirmed by the diagnostics: mission statement, job titles, NMLS and insurance license were duplicates of values already captured by taxonomy or universal keys.

**Changes shipped**
- Sample agreement check (`sample_mismatch`), one list = one container (`container_heading` / `container_index`), key reuse requires a shared meaningful word, minimum 2 samples (`low_support`), extra text ignores superscripts and screen-reader-only elements and strips leading separators, shared-value rule (≥60% of samples share a value longer than 30 characters → `site_wide_value`), `seen_count` = number of site contracts in the category that hold the key.
- Files: `-disco-site-contract.ts`, `disco-ai-worker.ts`. Universal and taxonomy behaviour unchanged. No database changes.

**Verified**
- To be completed after remapping the financial advisor sources.

**Not yet done / open**
- Superscript / screen-reader clean-up applies to extras only; taxonomy values may carry the same noise.

---

## Extra fields — LLM key matching and guards (C14c) (2026-09-28)

**What triggered this**
Remaps #94–#96 after C14b.

**What was wrong (verified on live data)**
- Edward Jones "Team Members" was stored under `employment_history` (career history): the locator copied an unrelated existing key and the word guard compared the AI key with itself. The locator only saw key names and labels, never what the keys hold.
- Morgan Stanley `focus_areas` still mixed all tab lists (20 items): the samples showed a single list, so no container was recorded.
- Schwab kept no extras: the locator returned rules without selectors, and extras from contracts made before C14b had no stored sample to carry them over.
- The shared list kept keys that no contract holds any more (`team_member_email`, `team_member_phone`, `crc_disclosure_number`, `mailing_address`).
- Confirmed working after C14b: "Footnote" text and leading separators removed, biography no longer taken as interests, weak and shared values dropped, Edward Jones focus areas limited to their own list.

**Changes shipped**
- Key matching is decided by one LLM call after validation, comparing real example values of the new extras with example values of existing keys; reason saved as `match_reason`; the word-overlap guard is removed; `examples` stored on each extra.
- List extras always record the heading of their container.
- Extra rules must carry a selector or label; incomplete rules are dropped.
- After each map the shared list is recounted and keys held by no contract are removed (`element_kind = 'extra_field'` only).
- Prefixed universal ids are recognised as static.
- Files: `-disco-site-contract.ts`, `disco-ai-worker.ts`. No schema changes.

**Verified**
- To be completed after remapping the financial advisor sources.

**Not yet done / open**
- none

---

## Station 4 — person identity fields and measured field floor (S4-0, S4-1) (2026-09-28)

**What triggered this**
Station 4 (field-yield gate, gap DR-10) review. The field floor saved per source was a number the AI guessed at mapping time, not a measurement, and the per-record field count counted the same value several times.

**What was wrong (verified on live data)**
- `field_floor` 9 / 8 / 7 (Edward Jones / Morgan Stanley / Schwab) while their site contracts extract 37 / 32 / 30 fields, so the 70% shallow check (7 fields) never triggered; Edward Jones records carry about 40 values.
- The same value was counted under a universal key and one or more taxonomy keys (for example name under `advisor_name` and `advisor_full_name`; phone under `phone_number`).
- Person universal keys mixed identity fields with descriptive ones (bio, photo, credentials, licences, education, languages, social links, fax), which are the taxonomy's job.

**Changes shipped**
- Person static fields are identity fields only: name, job title, phone, email, street, city, state, postal code, profile URL. The other person keys remain internal helpers (classifiers, address splitting, safety checks, taxonomy aliases) and are no longer written to staging as static. Location and firm keys are unchanged.
- `countDistinctFields`: identity and taxonomy values reaching staging, each distinct value counted once.
- `field_floor` is measured at mapping as the richest sample's distinct field count, using the same contract and apply functions as the harvest; the AI's number is kept as `field_floor_ai` for comparison.
- The harvested record's `filled` uses the same count, so records and the floor are comparable.
- Files: `-disco-site-contract.ts`, `disco-ai-worker.ts`. No database changes.

**Verified**
- To be completed after remapping the financial advisor sources.

**Not yet done / open**
- The gate itself (S4-2 to S4-5: `exp_etl_gate_full_pull`, `exp_etl_run_source`, `exp_etl_fetch_tick`, `exp_etl_fetch_collect`) follows as separate database changes.

---

## Station 4 — field-yield gate wired (S4-2 to S4-5) and live verification (2026-09-28)

**What triggered this**
Station 4 of the workflow (gap DR-10): no gate stood between Run and the bulk crawl, and the gate function named in the checklist read a legacy table and had no caller.

**What was wrong (verified on live data)**
- `exp_etl_gate_full_pull` read `exp_etl_source_contract` (one legacy row) and counted graph entities; nothing called it.
- `exp_etl_run_source` set the source to `active` directly, so the full crawl started without any quality check.

**Changes shipped**
- S4-2 `exp_etl_gate_full_pull` (body rewritten, same signature, `-- Fix (field-yield gate, 2026-09-28)`): sample = records staged for the source with the current contract (`payload._contract.learned_at`) since the latest run; a record meets the floor when it is not shallow (must-haves present and at least 70% of the measured `field_floor`); PASS when the sample has at least 10 records and at least 80% meet the floor. Returns floor, floor_needed, sample, meeting_floor, contract_learned_at, reason.
- S4-3 `exp_etl_run_source`: Run sets the source to `test_pull` unless `test_results` holds a PASS for the current contract; then `active`.
- S4-4 `exp_etl_fetch_tick`: a `test_pull` source fetches detail pages only until 10 records are staged or 20 detail pages were attempted since the latest run started.
- S4-5 `exp_etl_fetch_collect`: when the sample is complete the gate is called; PASS → `active` (bulk crawl continues), otherwise `paused`; the result is saved in `exp_etl_sources.test_results`.
- `exp_etl_check_saturation` stays unused (repeated site-wide values are already dropped at mapping) — a documented deviation from the checklist, which names both functions.
- No table, column, status or index changes.

**Verified**
- S4-0 / S4-1 (remaps #99–#101): measured floor Edward Jones 21 (AI guess 10), Morgan Stanley 19 (AI 8), Schwab 16 (AI 6); per-sample counts 20–21, 17–19 and 15–16. Harvest tests: Edward Jones `andy-straube` 21 fields (needs 15), Morgan Stanley `milin.rao` 20 fields (needs 14), not shallow; staged static fields hold identity fields only.
- C14c (remaps #97, #98): the LLM matching call refused to map a client service team list to the career-history key (reason saved) and matched personal interests correctly; Morgan Stanley `focus_areas` now 13 services only (container heading recorded); Schwab firm mailing address dropped as shared across pages.
- Gate, live on Morgan Stanley (run started 11:24 UTC): Run set `test_pull`; sitemap walk queued 6,442 profile pages; the gate decided at 11:53 UTC — sample 10, meeting floor 10, floor 19, floor_needed 14, PASS; the source moved to `active` and the bulk crawl continued.

**Not yet done / open**
- `exp_etl_frontier_discover` still tags some URLs with legacy kinds (`office_page`, `agent_page`) by URL words and queues them at a higher priority; on Morgan Stanley 12 such pages were fetched first and failed (the source's `page_kinds` does not include them), delaying the sample by about 25 minutes.
- Throughput remains one page per site per fetch tick (production dependency 3); `min_delay_seconds` below 60 has no effect until the tick fetches several pages per site.
- `pull_window` is still not enforced (Gap D2).
- Edward Jones' contract still holds "Team Members" under the extra key `employment_history` (a kept rule from before C14c); clearing it needs a contract edit.

---

## Re-harvest button and Edward Jones extra clean-up (2026-09-28)

**What triggered this**
A remap does not re-queue pages that were already harvested; re-harvesting needed a manual database update (as done for Edward Jones on 2026-09-28, D1). Separately, Edward Jones' contract kept "Team Members" under the extra key `employment_history` (career history), a rule saved before the LLM key matching (C14c) and carried over on every remap.

**What was wrong (verified on live data)**
- Only `exp_etl_fetch_collect` (stuck-page reset) sets frontier rows back to `queued`; no function or UI re-queues harvested pages.
- Edward Jones contract: extra `employment_history` with label "Team Members".

**Changes shipped**
- New RPC `exp_etl_reharvest_source(p_source uuid)` (SECURITY DEFINER, role check super_admin/architect as in `exp_etl_run_source`): requires a site contract version ≥ 3, sets the source's `detail_page` frontier rows with status `done` back to `queued`, then calls `exp_etl_run_source` (field-yield gate applies). Returns the number of pages re-queued. Staged rows are refreshed in place by `exp_etl_stage_ingest`; resolved rows are never touched. Failed pages (`error`) are not retried.
- "Re-harvest" button next to Run on each source card, with a confirm dialog showing the page count.
- Data: the `employment_history` extra removed from the Edward Jones site contract (one row), followed by a remap so the key matching decides afresh.

**Verified**
- RPC created; to be exercised from the button.

**Not yet done / open**
- A separate "retry failed pages" option (status `error`) if needed.

---

## Contract-only frontier kinds and site contract panel (2026-09-28)

**What triggered this**
The Morgan Stanley gate test: 12 URLs tagged `office_page` by URL words were fetched first and failed, delaying the sample by about 25 minutes. Separately, a source's site contract could only be inspected by database query.

**What was wrong (verified on live data)**
- `exp_etl_frontier_discover` fell back to a URL-word guess (`office_page` / `agent_page`, higher priority) for URLs that matched neither contract pattern, even for sources with a site contract; those kinds are not handled for contract sources and always failed.
- No screen showed the site contract (patterns, fields, floor, gate result, extras).

**Changes shipped**
- `exp_etl_frontier_discover` (`-- Fix (contract-only kinds, 2026-09-28)`): for a domain with a site contract (`detail_pattern` present), only contract-matched pages and sitemaps are queued; the URL-word guess runs only for domains without a contract.
- Data: 7 queued Morgan Stanley `agent_page` rows set to `skipped`.
- "View contract" button on each source card in Category Population, opening a read-only side panel: summary, page-finding patterns, field floor and gate result, must-haves, static fields (tier, hits, helper badge), taxonomy fields (subject, tier, hits, not-mapped reasons), extras (key source, examples, match reason, dropped reasons), firm profile, samples, raw JSON.

**Verified**
- Function read back; 7 rows skipped; Morgan Stanley crawl continued on profile pages (64 staged, 0 shallow, 0 errors at the time of writing).

**Not yet done / open**
- none

---

## Source hierarchy from the site contract (2026-09-29)

**What triggered this**
The Sources table showed entity types BRAND / LOCATION / PROFESSIONAL, PRIMARY authority and daily freshness for the insurance-agency sources but nothing for discovered sources such as Edward Jones, Morgan Stanley and Schwab.

**What was wrong (verified on live data)**
- The insurance-agency values were typed in by a one-off registration on 2026-08-03 ("auto-registered by builder (top-10 insurance)"); those sources were never mapped.
- For discovered sources nothing wrote `entity_types_available` (always empty) or `authority_rank` (default 5; the discovery rank only went into the notes); `hierarchy_sourceable` was set to true for every successful mapping, whatever the contract found.
- `field_count` is a generated column (`jsonb_array_length(field_coverage->'fields')`) and is 0 for site-contract sources.
- No database function reads these columns; they are display-only in the Sources table.

**Changes shipped**
- `disco_map_site_ingest` (`-- Fix (source hierarchy from contract, 2026-09-29)`): on an accepted contract, `entity_types_available` = the layers the contract found (brand: firm profile or firm fields; location: location fields; professional: person profile or person fields); `hierarchy_sourceable` = at least two layers; `authority_rank` raised from the default 5 to 1 for a brand's own site (hand-set values are kept). `field_count` is not written (generated column).
- Data backfill: Edward Jones, Morgan Stanley and Schwab set from their saved contracts — brand / location / professional, hierarchy true, authority 1.
- Sources table "Fields" shows the measured field floor from the site contract (21 / 19 / 16) instead of the generated `field_count`.
- `authority_rank` is a trust tier (1 primary brand site, 2 membership/association, 3 portal/review, 5 default), so the discovery list position is not copied into it.

**Verified**
- Function read back; backfill returned the three rows with the expected values.

**Not yet done / open**
- Freshness stays empty for discovered sources (no signal yet).
- The 2026-08-03 insurance-agency values stay hand-set until those sources are mapped.

---

## Station 5 — throughput, fair share and not-found pages (2026-09-29)

**What triggered this**
The fetch tick sent at most one page per site per minute, so large sources would take weeks to years (Morgan Stanley ~6,400 profile pages, Edward Jones ~19,700). After raising throughput, a first live check showed busy sites using all 25 in-flight slots so a newly started source (Schwab) was not fetched at all. Schwab's gate run then blocked on three sitemap URLs that return a "page not found" message with HTTP 200.

**What was wrong (verified on live data)**
- `exp_etl_fetch_tick` took one queued page per site per tick regardless of `min_delay_seconds`.
- With several pages per site, the unordered site loop let Morgan Stanley and Edward Jones fill the 25 in-flight slots every minute; Schwab (seeded 04:49 UTC) had no fetch for 6 minutes.
- Schwab gate (sample 10): 7 real profiles met the floor (13–14 static, 7–10 taxonomy fields); 3 staged records were "Sorry, we can't find the page you're looking for." pages (advisors no longer listed), so the gate blocked at 7/10.

**Changes shipped**
- `exp_etl_fetch_tick` `-- Fix (throughput, 2026-09-29)`: pages per site per tick = 60 / `min_delay_seconds` (at least 1, at most 10); each page re-checks the daily quota, the 25 in-flight cap and the test-pull sample cap. The default 45 s delay keeps one page per minute.
- `exp_etl_fetch_tick` `-- Fix (fair share, 2026-09-29)`: sites are visited least-recently-fetched first; a site never has more pages in flight than its per-minute batch.
- `disco-harvest-worker.ts`: `looksNotFound` — pages whose title, first heading or harvested name reads as a not-found page return reason `not_detail_page` (detail `not_found`); the collector marks them `skipped`, nothing is staged, and they do not count in the gate sample.
- Data: the three Schwab not-found records removed from staging; Schwab set back to `approved` for a new gate run.

**Verified**
- Throughput (6 s delay Morgan Stanley, 10 s Edward Jones): Morgan Stanley 9–10 pages in a minute, Edward Jones 6, 0 errors; after fair share all three sources fetched every minute (Morgan Stanley ~6/min average, Edward Jones ~3/min, Schwab 2/min), 0 errors.
- Gates: Edward Jones PASS (10/10, floor 21); Schwab BLOCKED 7/10 before the not-found check (re-run follows).

**Not yet done / open**
- The not-found check is phrase-based (English). A per-site fingerprint (the mapper requests a made-up profile URL once and stores the site's own not-found page) would be stronger.
- The 25 in-flight cap across all sites is now the overall ceiling (roughly 12–25 pages per minute in total).

## Station 6 node creator: staging → governed graph, brand → office → advisor (2026-09-29)

**What triggered this**
Station 6 trace (read-only) against the master checklist. Harvested financial-advisor records were piling up in `exp_etl_staging` with nothing turning them into graph entities.

**What was wrong (verified on live data)**
- `exp_etl_resolve` had no caller (no cron job, no function, no UI) — DR-15. 1,791 `gcid:financial_advisor` records were `pending` (Morgan Stanley 1,168, Edward Jones 532, Schwab 91).
- Even if called, it would have rejected every one as `malformed`: it reads `payload->>'name'`, but site-contract records keep the name in `identity_candidates`.
- It only linked professional → brand (no office), and named brands from the domain ("Morganstanley") — DR-18, DR-22.
- The claim firewall `trg_etl_claim_firewall` only fires when `exp.actor = 'etl'`, and nothing set it — DR-16.
- The attribution firewall compared the profile host exactly with the brand domain, so every Morgan Stanley advisor (`advisor.morganstanley.com`) would have been refused against `morganstanley.com`.
- Edward Jones pages list every office under the advisor's own name (532 of 532 records), so offices shared by several advisors would have been named after one of them.
- Context: State Farm reached the graph through two separate State Farm-only paths (`sf_resolve` → `exp_entity`; `exp_sf_apply` / `exp_sf_nodalize` → `professionals` / `organizations` / `graph_nodes`, bypassing `exp_graph_create_entity`). Neither is reusable and neither was changed.

**Changes shipped**
- `exp_etl_resolve()` (same signature): new site-contract branch. It picks only `pending` records that carry `_contract` and whose source is `active` (field-yield gate passed); test_pull samples stay staged. Per record, through `exp_graph_create_entity` / `exp_graph_add_rel` only:
  - brand reused by domain, else created and named from the firm name on the page;
  - office (`location`) keyed `domain|normalised street|ZIP`, or `domain|city|state|ZIP` when there is no street; named from the page's office name unless it is just the advisor's name, else "<firm> — <city>, <state>"; `OPERATES_UNDER` → brand;
  - advisor keyed `<domain>_url` = profile URL; identity attributes only (job title, phone, email, street, city, state, ZIP, profile URL); `WORKS_AT` → office, `REPRESENTS` → brand;
  - claimed/verified advisor: staging row set to `matched`, entity left untouched;
  - staging row set to `created` (new) or `matched` (already existed), with `entity_id`.
  - `exp.actor` is set to `etl` for the run, so the claim firewall is live on this path.
  - The old body is kept below the new branch; with the new row filter it receives no records (0 non-contract rows were pending).
- `exp_guard_attribution()`: a profile on the brand's own subdomain passes (`v_ent_dom NOT LIKE '%.' || v_brand_dom`); any other domain is still refused.
- New cron job `etl-resolve-tick` (jobid 96), every minute, `SELECT public.exp_etl_resolve()`; up to 80 records per run; no-op when nothing is pending.
- Nothing is written to `professionals`, `organizations` or `graph_nodes`: the public profile copy is deferred until after Station 8.

**Verified**
- Rolled-back test runs: 3, 9, 12, 15 and 18 records across the three sources, all `created`, none rejected or conflicted; offices shared correctly (Morgan Stanley 6 advisors → 1 office, Edward Jones 6 → 3, Schwab 6 → 4); brands named "Morgan Stanley", "Edward Jones", "Charles Schwab & Co., Inc.".
- Office-name rule checked read-only on all pending records: 0 Edward Jones offices use the advisor's name.
- First live runs (08:42 and 08:43 UTC, 5.6 s and 3.3 s, succeeded): 240 advisors, 165 offices, 2 brands; 240 `WORKS_AT`, 240 `REPRESENTS`, 165 `OPERATES_UNDER`; 0 conflicted.

**Not yet done / open**
- Public profile tables are not filled; that step comes after a Station 8 per-profile check, which does not exist yet.
- The Station 8 validators check category setup only; the category launch flag `is_launched` is never set and the public page does not read it.
- Each level is classified with the advisor gcid; a per-level gcid (e.g. an agency gcid for offices) is not modelled.
- Names keep designations ("Christopher Rice, CFP®, CIMA®"); Edward Jones pages give no job title.
- A profile is not refreshed when the site changes later (Station 7/9).
- `exp_graph_create_entity` looks up identity keys without the GIN index (~135 ms per lookup, ~0.05–0.35 s per record).
- State Farm data issues seen during the trace (not changed): agents filed under `gcid:insurance_agency`; phone/fax stored as list text; duplicate social nodes; `sf-hydrate-fetch`, `sf-hydrate-parse` and `sf-renodalize` cron jobs still scheduled.
- Rollback: `SELECT cron.unschedule('etl-resolve-tick');` then restore the saved definitions of `exp_etl_resolve` and `exp_guard_attribution`.

---

## Discovery → Hierarchy tab: filterable graph table, detail panel, tree (2026-09-29)

**What triggered this**
After Station 6 started writing brand → office → advisor entities, the Hierarchy tab could not show them.

**What was wrong (verified on live data)**
- The tab loaded all of `exp_entity` (A–Z) and all `exp_rel` rows of four types with no filter, so it only received the first 1,000 of each (~39,000 entities, ~90,000 relationships). Links were rarely both loaded, so everything rendered as a flat list of State Farm rows, and morganstanley.com / edwardjones.com / schwab.com entities never appeared.
- `REPRESENTS` (advisor → brand) was never shown.
- Stored State Farm names with HTML entities (e.g. `&#034;JJ&#034; Jirele`) were shown raw.

**Changes shipped** (commit 74ad23d, UI only, no database change)
- `src/components/discovery/hierarchy-tab.tsx` rewritten; new `hierarchy-data.ts`, `search-select.tsx`, `entity-detail-panel.tsx`.
- Filter bar (kept in the URL as `h_*` params): Category (inner embed on `CLASSIFIED_AS`), Source (`exp_entity.source`, options `etl:<domain>` from `exp_etl_sources`), Brand (the brand plus entities with `OPERATES_UNDER` / `REPRESENTS` to it), Type, Claim state, name search; counts line per type.
- Table: server-side paging (50 rows), columns Name, Type, Category, Source, Office, Brand, Advisors, Confidence, Claim, Created; sortable Name / Type / Confidence / Created; Office and Brand cells filter the table.
- Detail panel: identity keys and attributes, source page link, outgoing and incoming links (count + first 20, "Show in table"), latest 5 staged records via `PayloadFields`.
- Tree view: one brand → offices (paged) → advisors on expand, plus "Advisors without an office".
- HTML entities decoded for display only; stored names unchanged.

**Verified**
- Morgan Stanley in the preview: 1 brand · 376 offices · 1,181 advisors, matching the live counts (`OPERATES_UNDER` 376, `REPRESENTS` 1,181); Edward Jones 529 offices / 532 advisors and Schwab 77 / 91 in the database.
- Diff reviewed: only the four files above changed.

**Not yet done / open**
- The Discovery page does not remember the selected tab on reload, so a shared filtered link opens on Source Registry until Hierarchy is clicked.
- Names still include designations; the State Farm names with HTML entities are a data clean-up, not done.


---

## Station 1 — Source discovery prompt: brand sites first, then directories (DR-3) (2026-09-30)

**Status:** database function changes applied 2026-09-30 (see "Database changes"). Worker code on branch `etl/dr3-source-discovery`, not yet deployed.

**What triggered this**
Discovery for person-level categories returned personal websites instead of multi-profile sources (real estate agents proposal #33: 20 single-agent sites), and place categories (for example restaurant) fell back to a prompt about "companies that employ or franchise professionals".

**What was wrong**
- For categories with an `exp_category_boundary` row the prompt asked for companies that "MATCH THIS DEFINITION" and told the model not to return the excluded types. For person-level categories the definition is an individual and the excluded types are the brokerages, firms and franchisors — the sites that actually publish many profiles.
- Categories without a boundary (all 3,637 `location` categories and 398 of 404 professional categories) used a slug-only prompt that never asked for directories, associations or registries.
- The list was capped at 10–30 companies and a rerun returned the same list.

**Change (worker only: `src/routes/api/public/disco-ai-worker.ts`)**
- One source-oriented prompt. Wording is driven by `gbp_categories.entity_type`: `both` → person profiles, `location` → location pages. The category definition, includes and sub-types (when present) describe one profile; excluded types are listed as "not a profile of this category, but a valid source if its website publishes these profiles".
- Two groups in every answer: up to 20 brand sites (firms, brokerages, franchisors, chains), then up to 10 directories (portals, directories, review platforms, associations, licence registries). Brand sites always come first; within each group the order is the model's authority rank (market share, size, brand strength and number of profile pages).
- Rules in the prompt: a site about a single person or single location is not a source; registries are returned one per state or county with their real domain, at most 3 per answer (largest first; later rounds bring the next); one domain per owner; no general search engines or map apps; sites whose profiles mainly belong to a narrower or different category are left to that category.
- Tool renamed `return_top_companies` → `return_top_sources`; each entry carries `group`, `source_type` (existing `exp_etl_sources.source_type` values), `authority_rank` (overall position after grouping), `group_rank`, `profiles_hosted_estimate`, `evidence`. The per-company `subtype` field was dropped.
- Every domain already seen for the category (existing `exp_etl_sources` rows and every earlier `company_list` proposal) is passed as "do not repeat", so each rerun returns new sites.
- Strict validation: only real domains accepted and normalised; entries with no estimate, a mismatched group/type or placeholder text are rejected; repeats skipped; one retry when the answer is empty or has a noticeable share of broken entries. Discovery calls use an 8,192-token output limit.
- `disco_discover_ingest` still receives an array with `name` and `domain` on every entry, so it is unchanged by this code.

**Checked before building (no database writes)**
- Real estate agents, round 1: 20 brand sites (franchisors and large brokerages at the top) and 10 directories; no personal sites. Round 2 with the 31 known domains excluded: 30 new sites, none repeated, brand-site sizes falling from 6,500–150,000 to 600–20,000. (The dry runs used a combined registry entry; the final prompt returns registries individually with real domains.)
- Restaurant: 20 chains with store locators, then 10 directories. Search engines and map apps are now excluded by the prompt.
- Type check against the previous version: no new errors.

**Database changes (applied 2026-09-30, function bodies only — no table, column or data change)**
- `disco_discover_ingest`: a new round is merged into the latest pending `company_list` proposal for the category (entries whose domain is already in it are skipped, `decided_domains` kept, each new entry tagged with `round`, payload `rounds` incremented); the previous round's job is set to `done`; with no pending proposal a new one is created as before.
- `disco_confirm_companies`: saves each entry's `source_type` when it is an allowed `exp_etl_sources.source_type` value (else `brand_site`) and adds the profile estimate to the source notes. Everything else unchanged.
- Both changes are backward compatible with the current worker: entries without `source_type` are saved as `brand_site`, and a rerun that repeats domains adds nothing twice.
- Pending proposals that new rounds will merge into: #7 mortgage lender, #8 accountant, #9 financial advisor, #33 real estate agents (#33 to be closed before the first real estate run).

**Still to do**
- Approval screen: group by brand sites / directories; show source type, estimate and running coverage; "Discover more" button.
- Stakeholder sign-off on the prompt and on the main-category rule for overlapping categories (e.g. restaurant vs pizza restaurant).

**Rollback**
Worker: revert the commit on this branch (or do not merge it). Database: re-run the saved definitions of `disco_discover_ingest` and `disco_confirm_companies` from before this change (verified against the live functions).


---

## Stations 3–6 — Run guard, Station 6 paused, real estate sources re-checked (2026-09-30 / 2026-10-01)

**Station 6 paused (2026-09-30, operational).** `etl-resolve-tick` (cron job 96, `exp_etl_resolve()`) set inactive while discovery and mapping are being tuned: `SELECT cron.alter_job(job_id := 96, active := false);`. Staged rows stay `pending` and are processed when it is switched back on (`active := true`).

**Real estate sources (2026-09-30, data).** Proposal #33 (20 single-agent sites from the old prompt) set to `rejected` and its job #10 closed; discovery re-run with the new prompt → proposal #96 (28 sites). The 7 hand-registered sources from 2026-08-02 (kw.com, compass.com, exprealty.com, remax.com, zillow.com, realtor.com, nar.realtor) set to `approved` and sent through the method check (job #81): kw.com and remax.com mapped (floors 19 and 22); compass.com, zillow.com and realtor.com passed the method check but mapping found no fetchable profile page; nar.realtor has no profiles on the site; exprealty.com unreachable. After 5 sites were approved from #96 on 2026-10-01 (which pauses other hierarchy sources), kw.com, remax.com, compass.com and exprealty.com were set back to `approved`.

**What was wrong (verified)**
The Category Population screen lists a source as ready with a Run button whenever its crawl method is `server_crawl`, whether or not mapping produced a site contract. `exp_etl_run_source` only checked the crawl method, so Run on a source whose mapping failed (e.g. elliman.com) would start the older non-contract path with a field floor of 0.

**Change (database, function body only — no table, column or data change)**
- `exp_etl_run_source`: after the crawl-method check, Run now requires a version-3 site contract with a profile-page pattern for the source's domain and category; otherwise it raises `source_not_runnable: no site contract for <domain> — remap first` and nothing is queued. Marker `Fix (run guard, 2026-10-01)`.
- Runnable: edwardjones.com, morganstanley.com, schwab.com, kw.com, remax.com. Blocked until mapped: elliman.com, compass.com, zillow.com, realtor.com, coldwellbanker.com, bhhs.com, ameriprise.com, fidelity.com, ml.com, wellsfargoadvisors.com.
- md5(prosrc) before 3de347636febccf917f5d331d6c3af8b, after 702d7025ab033a59ee4d358a59f09862.

**Rollback**
Remove the guard block (the saved rollback script replaces it with nothing and restores the previous checksum).

**Still to do**
- Category Population screen: list a source as ready only when it has a real contract; show "Not mapped yet" with the mapper's last error and a Remap button (existing `disco_request_remap_site`); enable View contract only for real contracts.
- Station 3: mapper cannot fetch profile pages on elliman.com, compass.com, zillow.com (likely JavaScript-rendered or bot-protected) and picked an article page as the roster on realtor.com.
- Method job #81 remains `awaiting_ai` after its requests completed; new method requests are attached to it.


---

## Category Population — "ready" needs a real site contract; not-mapped sources in the amber box (2026-10-01)

**What was wrong (verified)**
The Category Population screen listed a source as ready (green box, Run button) whenever its crawl method was `server_crawl`, even when site mapping had failed. View contract was enabled for any `disco_site_contract` row, including the method-only row the method check writes. Example: elliman.com showed Run and View contract after its map failed (no fetchable profile page among 61 candidates).

**Change (UI only: `src/components/discovery/category-population-tab.tsx`)**
- Ready (green box, Run / Run all ready) = crawl method `server_crawl` AND a real site contract (version 3 with a profile-page pattern) — the same rule as the run guard in `exp_etl_run_source`.
- Sources that passed the method check but have no real contract move to the amber box, now titled "Not ready — blocked or not mapped", with a "Not mapped" badge, the reason from the latest `map_site` request ("Site mapping failed: …", "Site mapping is running…", or "has not run yet") and a Remap button. Remap calls the existing `disco_request_remap_site` (same RPC as the Source Registry tab), is enabled only for `approved` sources, and the reason refreshes every 15 seconds while a map is running.
- Sources whose method check failed or has not run stay in the amber box with Retry, as before.
- View contract is enabled only for real contracts.

**Verified**
- Type check against the previous version: no new errors.

**Rollback**
Revert this commit; no database change.


---

## Discovery → Schedules tab: ETL cron jobs with status and on/off (2026-10-01)

**What triggered this**
Pausing and resuming station steps (e.g. Station 6 during tuning) needed SQL. There was no screen or function for the ETL cron jobs (checked: the only cron-related function is `exp_index_job_install`, for the search index).

**Database (two new functions; no table, column or data change)**
- `exp_etl_cron_list()` — SECURITY DEFINER, roles analyst / architect / super_admin. Returns, for the ETL jobs only: job id and name, schedule, on/off, last run (start, end, status, message up to 500 characters), runs and failed runs in the last 24 hours. Reads `cron.job` and `cron.job_run_details` (about 0.6 s on ~500k run rows).
- `exp_etl_cron_set_active(p_jobname, p_active)` — SECURITY DEFINER, roles architect / super_admin. Only accepts a job name on the fixed ETL list and exactly one matching cron job; calls `cron.alter_job(active := …)` only when the state changes; writes `exp_admin_audit` (`etl_cron_set_active`, from/to).
- Fixed ETL list (by name, so a rescheduled job keeps working): `disco-ai-worker-drain`, `etl-recon-collect`, `etl-recon-retry-sweep`, `etl-fetch-tick`, `etl-fetch-collect`, `etl-extract-tick`, `etl-extract-collect`, `etl-resolve-tick`. No other cron job (engine, sentinel, State Farm, search index) is read or changed.
- EXECUTE granted to `authenticated` only (revoked from PUBLIC and anon).
- Verified: fingerprint of all cron jobs (id, name, schedule, active, command) identical before and after creating the functions; calling either function without an admin role raises `insufficient_privilege`.

**UI (`src/components/discovery/schedules-tab.tsx`, `src/routes/_authenticated/discovery.tsx`)**
- New "Schedules" tab: one row per ETL job in station order — station, plain-language title and job name, what it does and what happens when it is off, how often it runs, last run (status, error message on hover), failures in the last 24 hours, On/Off badge.
- On/Off switch for architect / super_admin, with a confirmation dialog that states the effect; read-only roles see the status only. Refreshes every 60 seconds.
- Type check: no errors.

**Rollback**
UI: revert this commit. Database: `DROP FUNCTION public.exp_etl_cron_set_active(text, boolean); DROP FUNCTION public.exp_etl_cron_list();` (the cron jobs and their on/off state are not affected).


---

## Station 1 — Discovery prompt fixes after the first live run (2026-10-01)

**What triggered this**
The first live run with the source-oriented prompt (real estate agents, proposal #96) returned four names with the model's own notes in them (e.g. "Zillow Premier Agent Directory (excluded, zillow.com already listed) - replaced with Homes.com" for homes.com), a portal owned by the same company as an already-found domain (trulia.com, Zillow Group), and general multi-industry directories (yelp.com, angi.com) ranked as if they were category directories.

**Change (worker only: `src/routes/api/public/disco-ai-worker.ts`)**
- Prompt: name must be the organisation's official name only (no comments, alternatives or notes about other sites).
- Prompt: the same-owner rule now also covers the ALREADY FOUND list (do not return a site owned by the same company as an already-found site).
- Prompt: category-focused directories first; a general multi-industry directory only if it has a dedicated section with substantial coverage, ranked below the focused ones; do not pad either group (return fewer than the maximum if fewer qualify).
- Validation: names containing comment words ("excluded", "replaced", "omitted", "already listed/found/included", "instead of", "alternative(s)" followed by punctuation or "to") are rejected and count towards the retry rule. Tested on the four names from #96 (all rejected) and on real names such as "Realty ONE Group", "LPT Realty", "Homes.com", "Alternative Realty Group" (all accepted).
- Type check against the previous version: no new errors.

**Data (2026-10-01)**
Proposal #96 (pending): the four names corrected in place by domain — realtyonegroup.com → "Realty ONE Group", side.com → "Side", lptrealty.com → "LPT Realty", homes.com → "Homes.com". Domains, ranks, estimates and approvals unchanged.

**Rollback**
Revert this commit; no database object changed.

## Build 3 — Territory & team admin: exp_territory_seats (2026-10-03)
- Trigger: Build 3 needed seller↔team↔territory↔role↔quota and a NORA-default flag; exp_sales_assignments only holds one owner per lane with no role or quota.
- Change: new additive table public.exp_territory_seats (territory_id, rep_id, group_key, lane_role SRE/SMB/MM/ENT, is_nora_default, monthly_quota; unique territory+rep+role; authenticated RLS + grants). Migration drizzle/migrations/0004_territory_seats.sql. No existing table or function changed.
- Code: src/lib/territory-admin.ts, src/components/sales/territory-admin-panel.tsx, Admin tab in /sales/territories.
- Verified: type check clean; seats table has 0 rows; exp_territories unchanged at 13; graph_nodes 554040, graph_edges 123.
- Open: no territories generated; generation runs per category after profiles are pulled.

## Build 4 — Worklist governed actions, scoped territory sizing (2026-10-03)
- Trigger: Build 4 replaced the Worklist "not yet wired" dialogs and wired the Territories Admin real-count preview.
- Wrong (live evidence): exp_territory_logo_profiles() over all groups hit the API statement timeout (57014) when called as a signed-in user, so the Admin preview could not load.
- Changed (additive): exp_claim_events + contact_updated_at, contact_updated_by; new table exp_verification_requests (pending outbox, read-only to staff); functions exp_claim_set_contact (claimed rows refused unless super_admin + override flag; audit_log entry with old/new values and actor), exp_claim_queue_verification (queues pending rows, never sends; audit_log entry), exp_territory_group_profiles(p_group_key) (same counting rule as exp_territory_logo_profiles, one group only). Migrations 0005–0009.
- Verified as a signed-in user: preview for insurance_agency returned 20,182 locations + 19,221 professionals = 39,403 → 1 territory in 272 ms; test seat + quota + ramp persisted and were deleted; contact change wrote and was restored; claimed-row change was refused; verification queued 1 pending row. exp_territories 13, exp_territory_seats 0, graph unchanged.
- Open: one test row stays in exp_verification_requests (pending, unsent) because staff have no delete permission; no email/SMS transport exists.

## CRM Phase 1 — opportunity create/close lifecycle (2026-10-03)
- Trigger: Module 2 Phase 1; Worklist "Create Opportunity" was disabled with no backing function.
- Changed (additive, migration 0010): new columns on exp_sales_demos, exp_opportunity_contacts, exp_contacts, exp_sales_notes, exp_sales_pipeline (created_by), exp_territory_brand (success_handoff_at, success_handoff_opportunity_id); exp_quotes.opportunity_id FK (NOT VALID); new tables exp_opportunity_owner_history, exp_sales_alerts (staff RLS); trigger exp_opp_owner_history; functions exp_opp_create (one open per logo, auto-named from organizations.name, whitespace products, claim contact), exp_opp_advance_stage (required exp_stage_requirements gate), exp_opp_close_lost (territory untouched), exp_opp_close_won (sets success_handoff_at on the logo's territory links; reversible by clearing it). Territory loaders in territories.ts, teams.ts, seller-setup.ts now skip handed-off links.
- Verified: migration applied; type check and surface check pass; graph counts unchanged.
- Open: functions not exercised live (the sandbox database role cannot act as a signed-in user, and a live test would leave a real opportunity behind).

## CRM Phase 3 — working Opportunity Workspace surfaces (2026-10-03)
- Scope: extended only the existing `/sales/opportunities/$oppId` workspace and its existing loader; no new route or page surface.
- Notes: `exp_sales_notes` now supports governed add/edit, pinning, `@mention` storage, and conversion into a real `exp_sales_tasks` row.
- Timeline: one chronological stream merges opportunity/account activity events, claim events, notes, tasks, demos, and stage history, with Sales, Product engagement, Claims, Revenue, and NORA filters.
- Tasks: reminders write to `exp_sales_tasks`, can be completed inline, and open opportunities without an incomplete task show the computed “At risk — no next step” badge.
- Committee: contacts can be added and grouped by buying role; champion state, relationship strength, last touch, champion detail, and claim/manual source are stored on existing contact/link columns.
- Meetings: demos store objective, agenda, attendees, outcome, follow-up, disposition, and recording URL; an attended demo with an outcome supplies the existing “Demo delivered” gate evidence.
- Governance: every workspace write also appends an opportunity audit record and a real activity event; lifecycle advance/close remains behind the Phase 1 RPCs.
- Schema: none; Phase 1 already added every reused column. No graph, taxonomy, public-site, publish, or Phase 4 changes.
- Verified: type check clean; sales surface checker 144 PASS / 0 FAIL; CPQ pricing 24 pass / 0 fail; graph_nodes 554040, graph_edges 123, exp_entity 39228.

## CRM Phase 5 — integrations, alert engine, reminders, readiness (2026-10-03)
- Trigger: Module 2 Phase 5 (Google Workspace, email/calendar from the opportunity, alert engine, reminders, audit views, readiness E2E).
- Changed (additive):
  - 0011: `exp_integration_google` singleton (status, domain, verified_at, connected_by, scopes, vault reference names only), `exp_email_outbox` (pending until Google connected), calendar/meeting columns on `exp_sales_demos`, alert/task columns; functions `exp_alerts_generate`, `exp_alert_accept` (NORA suggestion becomes a task only on human accept), `exp_task_reminders_tick`, `exp_crm_demo_seed` / `exp_crm_demo_teardown` (removable `crm_e2e_*` batch), `exp_google_vault_put`.
  - 0012: demo seed root `entity_type` corrected from invalid `organization` to `brand`.
  - 0013: alert scheduling split into three tiers. Instant triggers `exp_alerts_on_claim` (exp_claim_events), `exp_alerts_on_activity` (exp_activity_events), `exp_alerts_on_contact_touch` (exp_opportunity_contacts) run `exp_alerts_event_rules(org)` (new claim, exec engaged, multi-location upgrade, engagement spike, cluster activity); `exp_sales_alerts` added to realtime; `exp_alert_notify` queues an owner email (kind `alert`) when Google is connected and verified. cron `exp-crm-reminders-5min` (`*/5`) runs `exp_task_reminders_tick` (fires at due time, not a day early). cron `exp-crm-absence-daily` (13:00 UTC) runs `exp_alerts_absence_rules` (no seller activity 14d, stuck in stage 21d). Daily `exp-crm-alerts-daily` removed. Helper `exp_open_opps`.
  - 0014: actor fix. Live evidence: E2E failed with `exp_opportunity_stage_history_moved_by_fkey` because `moved_by` (FK to `exp_sales_reps`) received `auth.uid()`; admins and managers are not sales-rep rows. Added `moved_by_user` and `moved_by_role`; new `exp_crm_actor(opp)` resolves admin (control grant super_admin/architect), manager (grant sales_manager or rep role manager/lead/director/vp), or seller (rep matched by auth email who owns the opportunity). `exp_opp_advance_stage`, `exp_opp_close_lost`, `exp_opp_close_won` now refuse other users and record user + role; `moved_by` keeps the rep id only when the actor is a rep; history copies demo tags.
  - 0015: `exp_alert_accept` failed with `audit_log_user_id_fkey` (actor not in `user_accounts`); audit `user_id` now set only when a user_accounts row exists, actor always in `field_changes.actor_user_id`.
- Verified: full lifecycle E2E (`tests/crm-e2e.sql`) passed on a `crm_e2e_*` Jimmy John's seed: create + one-open-per-logo, notes/tasks/contacts/champion/demo/email, empty-evidence gate refused, five gates to proposal, admin actor recorded, unauthorized user refused, quote linked, five instant alert rules with owner, dedupe, NORA accept to task, reminder in-app, closed won territory handoff, closed opp locked, closed lost. Teardown verified: opportunities 90, territories 13, seats 0, no demo orgs/claims/alerts. Graph 554040 / 123 / 39228. Type check clean; surfaces 148 PASS / 0 FAIL; CPQ 24 pass; lifecycle unit tests 9 pass.
- Open: one audit_log row (NORA accept during E2E) kept because the audit trail is append-only. No sales rep is yet linked to a sign-in account by email, so only admins/managers can move stages until reps are matched. Queued alert/reminder emails need an automatic Gmail dispatcher once Google is live. Login spike and score/node growth wait for a data source. Google connect and domain verification are not performed.

## Catalog admin write access (Build 3) — 2026-10-04
- Triggered by: the price book becoming the single catalog + assumptions admin.
- Was wrong: exp_products had only a read policy (catalog edits from the app could not save); exp_pricing_config had row security off.
- Changed: migration 0016_catalog_admin_write_policies — signed-in staff can insert/update exp_products; exp_pricing_config now has row security on with signed-in read/update. No rows changed.
- Verified: llm_cost_basis saved 0.02 → 0.03 from the Assumptions tab, read back after reload, then restored to 0.02.
- Open: write policies are open to any signed-in user, matching exp_price_book; tightening to sales-admin roles is not done.

## 2026-10-04 — Catalog reconciliation Build 4: commercial surface retirement
- Trigger: Build 4 cleanup — leave one catalog-driven commercial set.
- Changed: `/products` now redirects to `/sales/price-book` and is removed from the console sidebar; `sales.volume-pricing` route file deleted; CMS "pricing" section no longer offered in the section-type picker (existing content untouched); `loadPricingContext()` in `src/lib/cpq-depth.ts` no longer reads `exp_price_tiers` (always returns `tiers: []`) — table is DEPRECATED as a pricing source, not dropped; contract detail line items are read-only (add/remove/write-down editing removed — pricing changes go through the quote builder).
- Verified: tsgo exit 0; sales checker 147 PASS / 0 FAIL; tests 32 pass / 0 fail; browser: /products → /sales/price-book, /sales/volume-pricing → 404, no sidebar Products link.
- Open: `REVENUE_SOURCES` still labels historical revenue source key "boosts" (revenue-event source, not a product key).

## Site mapper P0: verified hints, URL-shape ranking, same-host self-heal (2026-10-05)
- **What triggered this:** several approved sources had a method that passed but no site contract, because map_site never reached a real profile page.
- **What was wrong (verified on live data):**
  - elliman.com (request 118) and coldwellbanker.com (request 121): the roster page was right (/agent, /find-agents), but all 6 tried pages were property listings (/listing/…, /…/lid-…). Only the 40 deepest roster links were read, deepest first, so listings filled every try.
  - bhhs.com (request 122): all 4 tried pages were account pages (/account/saved-properties, /account/dashboard, …).
  - zillow.com (request 114): tried pages came from a mortgage sitemap (/mortgage-rates/, /refinance/, …).
  - realtor.com (request 115): the roster picked was an advice article. The AI named the real directory (/realestateagents/), but self-heal only ran for a different subdomain, so it did not run.
  - wellsfargoadvisors.com (request 123, 2026-10-05): the roster was a marketing page. The AI named locations.wellsfargoadvisors.com/search, but that host had already been read for robots.txt, so self-heal did not run.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `4ee8ff2`, branch `site-mapper-enhancements`; worker code only, no database change):
  - Discovery (`DISCOVER_TOOL`, `buildDiscoverPrompt`, `validateDiscoveredSources`, `loadDiscoverContext`): optional `directory_url` and `profile_url_example` per source, kept only when they are URLs on that source's own site (`sameSiteUrl`). The prompt now lists the category's taxonomy names (person: profession_title + alias; place: alias + specialization) and negative_keyword phrases (`loadCategoryTerms`). The hints are stored with each company in the existing `disco_proposals.payload` (no change to `disco_discover_ingest`).
  - map_site hints (`loadSourceHints`, `askSourceHints`, `verifyDirectoryPage`): hints are read from the category's saved company lists; when there are none, one AI call asks for them. A hinted directory becomes the roster page only when it loads on the same site, is not the homepage, and links to at least 5 deeper pages; otherwise the previous roster logic runs. The hinted profile page is tried first and must pass the same entity and category checks as any other page.
  - Candidate ranking (`makeCandidateScorer`, `rankDetailCandidates`): all roster links are read (cap 300, was 40). Each candidate is scored by URL shape: +2 for a taxonomy head word in the path (agent, advisor, restaurant, …), else +1 for a generic profile/location word; +2 under the roster page's path; +2 same shape as the hinted profile page; −3 for a non-profile word (existing sitemap negatives, site utility pages such as account/login/cart, and words from the category's negative_keyword phrases that are not in its own names). The first pass takes at most 2 pages per URL shape. Pages tried per map stay at 6.
  - Self-heal: also runs when the AI's profiles URL is a different page on the same host or on an already-read subdomain (still once, never from a self-heal pass).
  - Failure message: "no fetchable entity detail page found from <roster> (N candidates; tried 6: x not a profile page, y another category, …)". Diagnostics add `mapper_hints` and `candidate_scores`; a successful contract adds `mapper_hints`.
  - Contract samples: links on the accepted profile page are added last to the sample pool, still filtered by the detail pattern.
- **Verified:** type check shows no new errors against the previous version. The ranking was run offline on the failing URL patterns above: agent pages rank first for elliman and coldwellbanker, account pages rank last for bhhs, mortgage pages rank below profile pages for zillow, and franchise pages rank last for a restaurant chain. Not yet run on live sources.
- **Not yet done / open:** live remap of the failing sources after deploy (elliman, coldwellbanker, bhhs, compass, zillow, realtor, wellsfargoadvisors, ameriprise, fidelity, ml.com). When a hinted directory is used and has no profile pages, the previous homepage roster pick is not tried in the same run (self-heal may still reach it). P1–P4 (XHR/API detection, ZIP/city/letter search input, pagination) are not started.

## Site mapper P0 follow-up: first-pass hint check kept on self-heal (2026-10-05)
- **What triggered this:** the first live remap after P0 (wellsfargoadvisors.com, request 133).
- **What was wrong (verified on live data):** the first pass rejected the AI's directory hint (locations.wellsfargoadvisors.com/search), and self-heal then mapped from that same page and found 0 candidates. The saved `mapper_hints` came from the self-heal pass, so the first pass's `directory_check` / `directory_used` were missing and the reason for the rejection could not be seen.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `0c562e2`, branch `site-mapper-enhancements`): `mapSite` passes the first pass's hint record to the self-heal pass, which reuses it. Saved errors and successful contracts now show the first pass's directory check.
- **Verified:** type check shows no new errors against the previous version.
- **Not yet done / open:** wellsfargoadvisors.com is still unmapped. Its locator is only a search form (address, city or ZIP) with no advisor links in the page, so it needs search input (P2) or API detection (P1).

## Site mapper P0 follow-up: most relevant sitemaps read first (2026-10-05)
- **What triggered this:** live remap of elliman.com after P0 (request 136).
- **What was wrong (verified on live data):** the AI's directory hint (/agent) passed the check and was used, but that page loads agents with JavaScript (14 links, none to agents), so all 55 candidates scored 0. Elliman declares 17 sitemaps; the mapper read only the first 6 in the site's order (all listing sitemaps). The agent sitemap (/sitemaps/agents/index.xml, number 11) was never read, although it lists real profiles such as /agent/adriana-banks/1008811 (~200 in the Texas file alone).
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `cf8324f`, branch `site-mapper-enhancements`): `mapSite` scores sitemaps with the category's taxonomy head words (agent, advisor, restaurant, ...) as well as the full titles (`sitemapPickScore`). Top-level sitemaps are read most relevant first (ties keep the site's order) before the cap of 6; child sitemaps of an index use the same score. The taxonomy terms are now loaded once before the sitemap walk and reused for candidate ranking.
- **Verified:** type check shows no new errors against the previous version. Offline, Elliman's 17 sitemaps now order /sitemaps/agents/index.xml first.
- **Not yet done / open:** live remap of elliman.com after deploy, then the other sources that failed on listing pages (coldwellbanker.com, bhhs.com, compass.com, zillow.com, realtor.com).

## Site mapper P1: records embedded in page data (2026-10-05)
- **What triggered this:** Site Mapper Enhancement Plan, phase P1. Modern sites often ship their records as application state inside the HTML instead of JSON-LD or visible markup; the mapper and harvest only read JSON-LD and HTML elements.
- **What was wrong (verified on live data):** after P0, elliman.com reached a real agent page (/agent/abigail-agranat/1008745, request 137) but the contract step stopped with "must-have fields not found: name, phone|email, city, state": the page HTML is a template filled in later by JavaScript. Pages whose records sit in embedded state could not be learned at all.
- **Changes shipped** (commit `fad079c`, branch `site-mapper-enhancements`; worker code only, no database change):
  - `-disco-site-contract.ts`: `extractEmbeddedState` reads `<script type="application/json">` blocks (incl. `__NEXT_DATA__`) and `window.__X__ = {...}` state assignments (JSON only). `collectEmbeddedEntities` finds entity-like objects (a name plus at least two of phone, email, address, URL, photo, with at least one contact signal), normalises them to schema.org form (Person or LocalBusiness, telephone, email, address, url, image, jobTitle, description, openingHours) and orders the page's own record first. `collectJsonLdObjects` appends these objects only when the page has no entity-typed JSON-LD, so the existing JSON-LD tier (field learning in `buildJsonLdFields`, `applySiteContract`, the harvest worker) reads them unchanged. Pages that already have entity JSON-LD are not affected. `embeddedEntityUrls` returns the records' same-site profile URLs.
  - `disco-ai-worker.ts` (`mapSite`): profile URLs embedded in the roster page are added ahead of its links as candidates; the entity check shows the AI the page's embedded records (they usually sit beyond the 12,000 HTML characters it sees); diagnostics add `embedded_roster_urls` and `embedded_detail_records`.
- **Verified:** type check shows no new errors against the previous versions. Offline test on a synthetic Next.js page with a Redux state block: the page's agent (name, phone from a phone list, email, nested office address, title, photo, profile URL) comes first; related agents follow; navigation items are not taken for records; a page with entity JSON-LD returns nothing extra.
- **Not yet done / open:** live remaps after deploy (zillow.com, realtor.com, compass.com, elliman.com). Pages that load records over background calls with nothing embedded need P2 (browser capture). Fields beyond the schema.org set are not read from embedded data yet.

## Site contract: name from a single business record on person pages (2026-10-05)
- **What triggered this:** live remap of zillow.com after P0/P1 (request 138).
- **What was wrong (verified on live data):** the mapper reached a real agent profile (/profile/hheppe5) whose HTML carries the agent as one schema.org `RealEstateAgent` record (name, phone, email, address, description, image, parentOrganization) and no Person record. `RealEstateAgent` is a business type, so every value was learned as `location.*`; the person contract then failed "must-have fields not found: name" although the name was on the page. (Checked independently: the page text shows "Heather Heppe- Realtor REMAX Distinctive", (703) 727-5941, 20937 Ashburn Rd. #200 Ashburn, VA 20147, bio and 124 reviews.)
- **Changes shipped** (`src/routes/api/public/-disco-site-contract.ts`, commit `52a4958`, branch `site-mapper-enhancements`; no database change): new optional contract field `name_owner`. `finalizeSiteContract` sets it to `location` only when the contract is for persons, has no `person.name` rule, no sample page has a Person record, and `location.business_name` was found. `mustHaveIds` / `computeMustHave` / `recordMustHave` then accept `location.business_name` for the name must-have, and `buildHarvestRecord` passes the contract's `name_owner` (it already used the business name as the identity name). Contracts without `name_owner` (all existing ones) behave exactly as before.
- **Verified:** type check shows no new errors (worker, harvest worker, site-contract module). Unit check: the Zillow field set fails without `name_owner` and passes with it; an Edward Jones-like field set is unchanged; a page with only a business name still fails the record must-have unless the contract has `name_owner`.
- **Regression (read-only, no table writes):** the harvest worker (which writes nothing) was called through pg_net for 15 profile pages of the six mapped sources on the deployed P1 code. Edward Jones, Morgan Stanley and Schwab (9 pages): records identical to the ones produced before P1 (identity values and payload). KW, RE/MAX and Compass (6 pages): all pass the must-haves; kw.com/agent/danielle-young is shallow (11 of 14 fields needed) on that page's own data. These 15 records are the baseline to compare after this change deploys.
- **Not yet done / open:** after deploy, repeat the 15-page regression and remap zillow.com. realtor.com's request 139 is stuck at `sent` (likely the 5-minute worker limit). For portal sources such as Zillow, Station 6 would name the brand after the portal; the agent's brokerage (parentOrganization) is not used as the brand yet.

## Site mapper: dry-run mode for regression tests (2026-10-05)
- **What triggered this:** mapper changes (P0, P1, name_owner) need a regression test on the sources that already map, without overwriting their contracts or writing any rows.
- **What was wrong:** the only way to run the mapper was a map request (a `disco_llm_requests` row), and a successful run saves a new contract through `disco_map_site_ingest`.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `48a0f51`, branch `site-mapper-enhancements`): the worker endpoint accepts `{ "dry_run": true, "domain", "category", "crawl_method"? }` (same worker key). It runs `mapSite` with the current code and returns the contract it would produce, or the error with diagnostics. No request row is read or updated, no ingest function is called and nothing is written (`mapSite` only reads; all writes are in the drain path, which a dry run skips).
- **Verified:** type check shows no new errors.
- **Not yet done / open:** regression run after deploy: dry runs for edwardjones.com, morganstanley.com, schwab.com, kw.com, remax.com, compass.com, compared with their saved contracts, plus zillow.com to check the name_owner fix without saving.

## Site mapper: regression fixes found by dry runs (2026-10-05)
- **What triggered this:** first read-only regression run (dry runs, nothing written) of the mapper with P0, P1 and name_owner on the six sources that already map, plus zillow.com.
- **What was wrong (verified on live data, dry runs 6977, 7028-7030, 7045-7047):**
  - Same or better than the saved contracts: schwab.com (same pattern, floor 16 = 16, 5 samples), kw.com (floor 20 vs 19), remax.com (23 vs 22), compass.com (17 vs 16).
  - edwardjones.com: the AI-guessed profile URL (/financial-advisor/john-smith, a non-existent advisor) returned a generic page and was put on the "must not match" list, which forced a profile pattern for one page only (^.../financial-advisor/jim-folmar/?$) and 1 sample. Compass showed the same first-try problem (recovered on the retry).
  - morganstanley.com: failed ("must-have fields not found"). The URL-shape ranking replaced the earlier order that favoured the advisor.morganstanley.com sitemap (category-named subdomain), so a corporate employee page (www.morganstanley.com/profiles/...) was accepted instead of an advisor page.
  - zillow.com: the roster page itself and two city directory pages were among the 6 tries, so no /profile/ page was reached this time.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `a760121`, branch `site-mapper-enhancements`): the AI-guessed profile URL never goes on the "must not match" list and does not use up one of the 6 regular tries; candidate ranking adds the evidence the mapper used before P0 (sitemap relevance, and a category-named subdomain counts +2 like a category word in the path); the roster page, homepage and self-heal roster are never candidates.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** repeat the full dry-run regression after deploy; every source must be same or better before more mapper work.

## Site mapper: dry-run regression round 2, directory links first, hint shape (2026-10-05)
- **What triggered this:** second read-only regression run after the fixes above (dry runs 7340-7342, 7357-7360; nothing written).
- **Result of round 2 (all six mapped sources same or better than their saved contracts):** edwardjones.com same pattern, floor 21 = 21, 5 samples; morganstanley.com same pattern (advisor.morganstanley.com/<first.last>), floor 19 = 19, 5 samples; schwab.com floor 17 vs 16; kw.com floor 19 = 19 (field list differs slightly: office email dropped, city, languages and logo found); remax.com floor 23 vs 22; compass.com floor 16 = 16. Must-haves, page type and profile pattern held on all six.
- **What was still wrong (verified on live data):** zillow.com did not map. Its directory page is localised to the visitor (Phoenix this run, Ashburn VA earlier): city directory pages ranked first, profile links on the directory page tied with mortgage pages from Zillow's sitemap and lost on order, and the AI's example /profile/RealtorExample did not count as the same shape as real /profile/hheppe5 (digit vs letters).
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `7e4d74d`, branch `site-mapper-enhancements`): links found on the chosen directory page (not the homepage) get +1 in candidate ranking; a hinted profile URL is compared by host + first path segment + depth (`hintShape`) instead of the letters/digits template.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** round 3 of the seven-site dry-run regression after deploy. Web search for AI hints (real indexed URLs instead of guesses) is parked by decision.

## Site mapper: profile-pattern coverage check and listing navigation (2026-10-05)
- **What triggered this:** round 3 of the read-only seven-site dry-run regression (dry runs 8503-8506, 8519-8521; nothing written) after `7e4d74d`.
- **Result of round 3:** edwardjones.com same pattern, floor 21 = 21; schwab.com same pattern, 16 = 16; kw.com same pattern, 20 vs 19; remax.com same pattern, 26 vs 22; morganstanley.com floor 19 = 19 but the pattern narrowed to exactly one dot and no hyphens (saved: `[a-z0-9]+(?:\.[a-z0-9-]+)+`); zillow.com mapped for the first time (16 fields, must-haves OK, `name_owner` = location).
- **What was wrong (verified on live data):**
  - compass.com: the directory page links agents by number (/agents/15239104/), the saved contract learned from name slugs (/agents/david-shotwell/). With directory links first, a numeric page was accepted and the AI generalised the pattern to digits only (`/agents/\d+/?$`), which drops every name-slug agent. Both forms are profile pages.
  - zillow.com: /profile/polings77 was accepted and /profile/OkeechobeeHomesLand (same URL shape, likely a business/team profile) was rejected and put on "must not match". The corrective prompt suggested "a required dot, digit", and the pattern became "username containing a digit", which most Zillow usernames do not have. Only 1 sample.
  - Common cause: detail_pattern is written from one or two example URLs and never checked against the other profile-shaped links the mapper already holds.
  - Separately, listing navigation is not learned at all: `roster_pattern` describes a listing page but not how to reach page 2 or sub-listings, and `exp_etl_fetch_collect` only collects profile links from a listing page. kw.com, remax.com and zillow.com have no profile sitemap, so a harvest only sees the profiles on the seed listing page.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, branch `site-mapper-enhancements`; worker code only, no database change):
  - Commit `d00e33e` (pattern coverage): the contract prompt shows up to 12 other links with the same parent path as the accepted profile page (directory links, sitemap pool, links on the profile page) and asks for a pattern that accepts every profile form seen. Same-path pages rejected as "not this category" (entity pages of another kind on the same URL template) no longer go on "must not match"; they are listed in diagnostics (`same_path_other_kind`). When the final pattern matches under half of at least 5 same-path links, one small AI call (`return_detail_pattern`) widens it; the result is kept only if it still matches every known profile page, excludes the homepage, roster and different-path rejected pages, and covers more same-path links. The corrective prompt no longer suggests a digit or dot rule from one example. Diagnostics: `detail_pattern_check.coverage`.
  - Commit `58b513c` (listing navigation, the pagination part of P3 brought forward): from the chosen directory page the mapper finds the next page (`rel=next`, a page-number URL such as `?page=2` / `/page/2`, or a "Next" link) and sub-listings (other links matching `roster_pattern`, or the largest group of at least 5 child paths of the directory page). Each is fetched once and marked `verified` only when it yields profile links (final detail_pattern) that page 1 did not have. Stored as `extraction.navigation` (`next_page`: how, example_url, `{n}` template, new_detail_links, verified; `sub_listings`: pattern, source, count, examples, new_detail_links, verified). Nothing reads it yet. Diagnostics: `listing_navigation`.
- **Verified:** type check shows no new errors. Offline test of the navigation helpers on a synthetic listing page: `rel=next`, page-number links (query and path forms, `start=` offsets) and a "Next »" link are found; profile and sub-listing links are separated.
- **Not yet done / open:** round 4 of the seven-site dry-run regression after deploy (every mapped source same or better, Compass and Zillow patterns covering both URL forms, navigation found per site). The harvest side (`exp_etl_fetch_collect` queuing verified next pages and sub-listings, resolving relative links, with page/depth caps) is a database function change and needs its own approval. No zillow.com remap until its pattern covers normal usernames.

## Site mapper: route-based plan step 1, per-route measures and repeatable AI answers (2026-10-06)
- **What triggered this:** dry-run rounds 3 and 4 gave different profile patterns for the same sites with the same code (compass.com digits-only then name slugs; morganstanley.com `first.last` then team and search pages). The plan was rewritten around a route-based mapper that learns only from live evidence (Site Mapper Enhancement Plan, tab "Route-based mapper"); step 1 makes results measurable and repeatable before any learning logic changes.
- **What was wrong (verified on live data):** `callClaude` sent no temperature, so every mapping AI call ran at the API default (1.0) and the same fetched page could get a different answer on each run. Regression was judged by reading patterns; there were no per-route numbers to compare.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, branch `site-mapper-enhancements`; worker code only, no database change):
  - `callClaude` takes an optional `temperature`. `callClaudeMap` (temperature 0) is used by every AI call inside `mapSite` and `askSourceHints`; `pickRosterLinkWithLLM` passes 0 only when called from `mapSite`. Source discovery (Station 1) and `classifyMethod` (Station 2) are unchanged.
  - `mapSite` returns `route_report`: run time; sitemaps (files read, URLs read, profile URLs seen that match the profile rule, profile sitemaps; at most 500 URLs per file and 10 files per run); listing page (profile links on it, next page and sub-listings with new-profile counts and proven flag); embedded data (profile URLs on the listing page, records on the profile page); network calls and search inputs marked "not built"; profile rule (pattern, same-path links, matched, known problems); samples (fetched, must-haves, fields, field floor). Built only from pages this run already fetched; nothing reads it yet.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** after deploy, two dry runs per test site (edwardjones.com, morganstanley.com, schwab.com, kw.com, remax.com, compass.com, zillow.com) to record the baseline and see which differences remain at temperature 0. Step 2 (profile-page check: exactly one page-tied entity; profile rule built by code from observed URLs plus spot checks; AI hint and pattern steps removed) needs its own go-ahead.

## Site mapper: temperature removed from mapping AI calls (2026-10-06)
- **What triggered this:** first baseline dry runs after step 1 (dry runs 18732 edwardjones.com, 18733 schwab.com; nothing written).
- **What was wrong (verified on live data):** both runs stopped on their first AI call with `anthropic 400: temperature is deprecated for this model` (model `claude-sonnet-4-6`). Every map or remap run would have failed the same way; no map request was queued between the step 1 deploy and this fix (latest `disco_llm_requests` map_site row is #139 from 2026-10-05). Discovery, method classification, harvest and crons do not send a temperature and were not affected.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, branch `site-mapper-enhancements`): `MAP_TEMPERATURE` is now undefined, so `callClaudeMap` and `pickRosterLinkWithLLM` send no temperature and the calls are exactly as before step 1. `route_report` is unchanged except `ai_temperature`, which now reads "model default (temperature not supported)".
- **Verified:** type check shows no new errors; `callClaude` adds the temperature field only when a value is given.
- **Not yet done / open:** repeatable AI answers cannot come from temperature on this model; the plan's step 2 (code-built profile rule, AI hint and pattern steps removed) is the route to consistency. Baseline dry runs (7 sites, two runs each, two at a time) after this deploys.

## Site mapper: route-based plan step 2, profile-page check, code-built profile rule, no AI hints (2026-10-06)
- **What triggered this:** the step 1 baseline (dry runs 18950, 18951, 18958, 18959, 19002-19007; nothing written) and the route-based plan (Site Mapper Enhancement Plan, "What counts as a profile page" and build step 2).
- **What was wrong (verified on live data):**
  - Any named person or business in a page's JSON-LD made it count as a profile page (`hasPageSpecificEntityJsonLd`), so a listing page with many agents could pass, and on a profile page the first entity of a type was read even when it was a sponsored or related one.
  - zillow.com samples included team pages (MNRTeam, McKentyTeam, TheMauzGroup); on run 19003 MNRTeam had itself been rejected as "a named team, not one agent" and was still used as a sample.
  - morganstanley.com's AI-written pattern also matched the search page and team pages (runs 19007, 9016), and runs took 151 s and 300+ s (19004 timed out).
  - zillow.com failed twice with "must-have fields not found: state": all samples came from one region, so the state value was identical on every sample and dropped as a site-wide value.
  - The AI suggested directory and profile URLs (hints) and wrote the profile URL pattern from one or two examples.
- **Changes shipped** (branch `site-mapper-enhancements`, commit `2b1afa1`; worker code only, no database change):
  - `-disco-site-contract.ts`: `pageEntityEvidence` (profile = exactly one entity tied to the page by url/@id = page or canonical URL, page-wrapper `mainEntity`, or name in the main heading; two or more entities with none tied = listing; places, residences, brands and the site's own names are not counted; relationship keys such as parentOrganization are not followed). `orderByPageTie` puts the page's own entity first in `parseDocument` / `docOf` and in `applySiteContract` (also used by the harvest worker): nothing is dropped, and pages without a tie or with one entity are unchanged. In `finalizeSiteContract`, state and country are not treated as site-wide when the street or postal code differs between samples.
  - `disco-ai-worker.ts` (`mapSite`): candidate pages that are listing pages are rejected and recorded as non-profile pages; a single untied entity goes through the AI page check. `buildProfileRule` builds `detail_pattern` from the URLs the run saw (directory links, sitemap URLs, links on the profile page; pages this run rejected left out): segments shared by at least 5 URLs (or all) stay fixed, the last and varying segments become a character class covering every value seen; other value forms (dotted names, numeric ids, words) are spot-checked by fetching 2 pages each with the same page check and are included only if both pass (a failed numeric form is excluded explicitly); a redirect from a shorter URL is combined into one rule; known non-profile URLs that still match are excluded by exact URL. The AI's detail_pattern, the corrective retry and the widening call run only when no rule can be built (`route_report.profile_rule.source` = `ai_fallback`). AI hints (directory URL and example profile URL, from the AI or from discovery proposals) are no longer used. Samples exclude rejected pages; up to 6 candidates are judged like the profile page and the first 4 that pass are kept. Navigation is skipped past 180 s and sample judging / form checks past 200 s. `route_report.profile_rule` adds the rule source, candidates, fixed segments, forms, form checks, redirect form, excluded URLs and sample checks.
- **Verified:** type check shows no new errors. Offline tests of the rule builder on URL sets shaped like the test sites: Morgan Stanley gives `first.last` names only (team slugs and the search page excluded; `a.b.c` and hyphenated names kept); Compass gives `/agents/<slug>/` covering name slugs and numeric ids, and excludes numeric ids when their spot check fails; KW `/agent/<slug>/<id>`; Edward Jones `/us-en/financial-advisor/<slug>` (about/careers pages excluded); Zillow `/profile/<username>` including `%20` names; RE/MAX short and `/usa/en/` forms. Offline tests of the page check: url, canonical, mainEntity and heading ties; a 3-agent ItemList is a listing; a profile with two sponsored agents is a profile and its own entity is read first; a nested brokerage is not counted.
- **Not yet done / open:** round 2 dry runs (one at a time, crons #90/#91 paused during the runs): every test site must keep or improve its measures; Zillow should pass must-haves. Teams on Zillow share the profile URL form, so they cannot be excluded by URL; they are excluded from samples, and how Station 6 types them is an open question. A short read-only harvest check on one profile page per site, because `orderByPageTie` also applies in the harvest worker.

## Site mapper: category-aware profile-page check (2026-10-06)
- **What triggered this:** review of the step 2 profile-page check: a financial-advisor page often carries the advisor (Person) and the branch (FinancialService), both tied to the page, and a restaurant page can carry the restaurant and a chef or owner (Person). Counting every named entity made such pages "ambiguous" (offline test: advisor page with person + office + 2 branches = 2 tied, 4 entities) and could misread an advisor page that lists nearby branches.
- **Changes shipped** (branch `site-mapper-enhancements`; worker code only, no database change): `pageEntityEvidence` and `orderByPageTie` take the primary subject. Person categories count Person entities (a page with no Person falls back to its business-typed entities, e.g. agents marked up as `RealEstateAgent`); place categories count business/place entities and ignore people. `mapSite` passes the category type (`gbp_categories.entity_type`) to every page check; samples carry the primary subject (`Sample.primary`, used by `docOf`); `applySiteContract` uses the contract's `primary_subject` for the harvest.
- **Verified:** type check shows no new errors. Offline: advisor page (person + office + 2 branches) = profile, advisor read first; restaurant page with chef and owner = profile (restaurant); 3 restaurants with none tied = listing; agent marked up as RealEstateAgent on a person category = profile.
- **Not yet done / open:** included in the step 2 round 2 dry runs.

## Site mapper: step 2 follow-up, inconclusive pages and sitemap retry (2026-10-06)
- **What triggered this:** step 2 round 2 dry runs (19206-19216; nothing written) and a read-only harvest check on one profile page per mapped site (19229-19234: all six records correct; kw.com shallow as before).
- **What was wrong (verified on live data):**
  - compass.com run 19210: one numeric-id page came back blocked ("Page content is blocked/not accessible"), so the numeric form failed its spot check and was excluded; on run 19214 both pages loaded and the form was included.
  - edwardjones.com run 19213: three sample candidates returned 404 pages (advisors no longer listed), so only 4 samples were kept and the field floor fell from 21 to 19; one 404 page (jim-folmar) was excluded from the rule by exact URL.
  - edwardjones.com run 19206: the sitemap index returned 404 at that moment, so the run found 0 candidates; run 19213 read it normally.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, branch `site-mapper-enhancements`): `pageDidNotLoad` (fetch error, status 400+, bot-block page) and `INCONCLUSIVE_REASON_RE` (AI page check describing a 404, blocked or error page) mark a page inconclusive: such candidates are recorded as "did not load", never go on the non-profile list, and are not used as evidence for or against a URL form. Form spot checks (`judgeUntil`) try up to 4 pages per form for 2 conclusive verdicts; a form with no conclusive verdict is neither added nor excluded. Samples: up to 8 candidates judged in batches until 4 pass. A sitemap file that errors is fetched once more after 1.5 s.
- **Verified:** type check shows no new errors; the reason pattern matches the observed 404 and blocked texts and not listing-page or team-page reasons.
- **Not yet done / open:** rerun edwardjones.com and compass.com twice each (dry runs, one at a time, crons #90/#91 paused during the runs).

## Site mapper: site contract learned from 10 accepted profile pages (2026-10-06)
- **What triggered this:** decision to learn each site contract (universal fields, taxonomy fields with their JSON-LD paths / CSS selectors, must-haves, field floor) from at least 10 accepted profile pages instead of 5; optional taxonomy facts (designations, languages, team name) appear only on some profiles and were often not seen in 5.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, branch `site-mapper-enhancements`; no database change): samples are the accepted profile page plus 9 more that pass the same page check (profile-page check and AI page check); up to 16 candidates are judged in parallel batches and pages that do not load are skipped. If the run is past 200 s when sampling starts, it falls back to 4 extra pages (5 in all). The AI CSS step still reads the markup of 2 sample pages; every rule is validated on all samples. The 60 s budget for the corrective must-have call now starts after sampling. `route_report.samples` shows `target` and `fetched`.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** dry runs on the test sites. The field floor formula is unchanged (most fields on any one sample); with 10 samples it can rise, which makes the Station 4 gate (`exp_etl_gate_full_pull`: record meets the floor at 70% of it; source passes at 80%) stricter; switching the floor to the median sample is an open decision.

## Site mapper: route-based plan steps 3 and 4, routes from evidence, best route, save rule (2026-10-07)
- **What triggered this:** 10-sample dry runs (19887-19893; nothing written): kw.com's agent sitemap index has 94 dated child files and the 3 read held 1 URL each, so the report said 3 profiles; zillow.com reached only 3 of 10 samples because its directory page lists few profiles in plain HTML; `roster_pattern` was still written by the AI; nothing stopped a remap from replacing a working contract with a worse one.
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, branch `site-mapper-enhancements`; worker code only, no database change):
  - Sitemaps: when the best-named child belongs to a family of numbered or dated files (family = name with digits masked) of 4 or more, a spread (first, middle, last) is read; `route_report.sitemaps.profile_urls_estimate` = profile URLs per file read × files in the family, with its basis; a file that hit the 500-URL read limit is marked as a lower bound.
  - Listing navigation runs before sampling. A directory page with no profile links of its own is still checked for sub-listings (proven only when a fetched sub-listing shows at least 3 profile links). Sub-listings come from the page's own link groups; the AI roster_pattern is no longer used for this. The highest page number linked for the proven page template is recorded (`max_page_seen`). Profile links found on page 2 and on the checked sub-listing become sample candidates.
  - `roster_pattern` is built by code: the directory URL (with optional query), the proven page-number template and the proven sub-listing pattern; a part that would match a sample profile page is dropped. No directory page (homepage used) = no roster_pattern.
  - `extraction.best_route` (and `route_report.best_route`): sitemap or listing with its reach estimate (sitemap: estimate above; listing: profiles per page × highest page seen, plus sub-listings × profiles per sub-listing); sitemap wins ties and when the listing reach cannot be measured. Only the best route is stored; the harvest does not read it yet (plan step 7).
  - Save rule (`savedContractCheck`, before `disco_map_site_ingest`): the saved contract is re-checked on the live site on up to 3 of its sample pages (loads, matches its detail_pattern, gives its required fields). 2 or more failing = broken = replaced. Otherwise the new contract replaces it only when it is the same or better on required fields, field floor and best-route reach (when both have one); else the saved contract is kept, the map request is set to `completed` with `kept_existing_contract`, both sets of measures and the new contract, and `disco_check_method_complete` is called as after a normal map. The check result is also attached to saved contracts as `save_check`. Dry runs never save.
- **Verified:** type check shows no new errors. Offline: page-number regex finds page 187 from pagination links; the built roster pattern matches the directory, its `?page=N` pages and a city sub-listing and not a profile page; the KW sitemap family groups all 94 dated files.
- **Not yet done / open:** dry run per test site (crons #90/#91 paused during the runs). The save rule needs one real remap to verify (writes to tables; separate go-ahead). Field floor formula unchanged by decision.

## Site mapper: section-like path parts stay fixed, hard deadline inside steps (2026-10-07)
- **What triggered this:** steps 3+4 dry runs (pg_net 1305-1307; nothing written). kw.com mapped as intended (listing route: 12 per page × 12,227 pages ≈ 146,700; sitemap estimate ≈ 2,200 from 3 of 94 files; code-built roster pattern `kw.com/agents` + `?page=N`; 10 samples).
- **What was wrong (verified on live data):**
  - zillow.com (1306): the directory page showed almost no profile links and the sitemap step read ~107 `/mortgage-rates/` and `/mortgage-calculator/` URLs; with only ~3 `/profile/` URLs among ~150 two-segment URLs, `profile` was not kept as a fixed segment, the rule became "any two-segment URL" and all 16 sample candidates were mortgage pages (1 sample).
  - remax.com (1307): timed out at 300 s (139 s on the previous round); time checks ran only before each step, so a started step (sample judging, navigation, sitemap fetches) could run on.
  - zillow.com city sub-listings show 0 profile links in plain HTML (10 found, none proven); more Zillow samples need network-call capture (P2).
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, branch `site-mapper-enhancements`): `buildProfileRule` keeps a non-last segment fixed when the profile's word appears at least twice there and the position has few distinct values (fewer than half the URLs: site sections), and makes it variable only when most values are unique. `withTimeout` bounds page checks (fetch 30 s, AI check 30 s), sample judging stops past 240 s, navigation is capped at 45 s and must start before 240 s, and sitemap fetches are capped at 25 s.
- **Verified:** type check shows no new errors. Offline: a Zillow-shaped pool (26 mortgage URLs, 2 learn, 3 profile) gives `/profile/<username>` and excludes `/mortgage-rates/ak/`; KW, Morgan Stanley and a name-first URL shape unchanged.
- **Not yet done / open:** rerun all seven sites (dry runs, one at a time, crons #90/#91 paused).

## Site mapper: route-based plan step 5, background-call (XHR) route; early fetch time caps (2026-10-07)
- **What triggered this:** zillow.com city sub-listings show 0 profile links in plain HTML (steps 3+4 dry run 1306), so no route reached its profiles; the planned P2 step (network calls with GET/POST paging) was built while the database was being upgraded. kw.com dry runs on the section-like build (pg_net 1308, 1309; nothing written): the first was cut off by the server at about 110 s and the second timed out at 300 s; the first fetches of a run (homepage, robots.txt, directory page, candidate pages) had no time cap, and one page fetch can take 60 s plus a 180 s render retry.
- **What was wrong (verified on live data):** `route_report.network_calls` was "not built", so sites that load their profile lists by background calls had no route; KW timed out on 1309 although it finished well inside the limit on the previous round.
- **Changes shipped** (branch `site-mapper-enhancements`, commit 5ec8ec2; worker code only, no database change):
  - `src/routes/api/public/-disco-network-route.ts` (new, pure helpers): reads captured calls; finds profile links in JSON responses that match the run's code-built profile rule, or profile IDs that build such links from a known profile URL; finds paging from two captured calls to the same endpoint that differ in one page/offset value, else from a page/offset parameter the call itself sends (query, JSON inside a query value, JSON body or form body); reads a stated total / total pages; builds the next call; keeps replay headers without cookies or login/session/token headers; skips analytics and asset calls.
  - `src/routes/api/public/disco-webscraper-worker.ts`: new `captureNetworkCalls` (Oxylabs `render: html` + `xhr: true`, scroll to bottom, retried once without scrolling if the instructions are rejected, aborted at its time limit) and `fetchApiCall` (replays one GET/POST call with its body and kept headers through Oxylabs, aborted at its time limit). `scrapeWebsite` is unchanged, so existing callers behave as before.
  - `src/routes/api/public/disco-ai-worker.ts` (`mapSite`, `learnNetworkRoute`): the route measures (sitemap estimate, listing reach) are computed right after listing navigation. When both reach fewer than 500 profiles (or a dry run sends `force_network: true`), the directory page, or its first sub-listing when neither shows profile links, is captured once (60 s cap), alongside the sample checks. A call counts only when its JSON holds at least 3 rule-matching profile links; ID-built links must pass the normal profile-page check on one built link unless one equals a profile link the run already saw. Paging is proven by replaying the next call (20 s cap) and finding new profiles (at least 3, or all of page 1 when fewer); a 401/403 reply is recorded as "needs a session, not used". Reach = stated total (or total pages × page size, else profiles on the pages fetched as a lower bound), times the sub-listing count when captured on a sub-listing (estimate). `route_report.network_calls` lists the calls checked with the reason for each; a proven call becomes `extraction.best_route` (`route: network_call`, with the call, kept headers, paging, where the profile links sit and the proof) only when it reaches more profiles than the sitemap and listing routes. No AI picks the call.
  - Early fetch caps (same file): homepage 60 s, subdomain robots.txt 20 s each (now in parallel), directory page 45 s, candidate profile pages 45 s each, roster-link AI pick and candidate AI page check 30 s each, all bounded by the run clock; the candidate loop stops when under 60 s remain. A timed-out candidate AI check is recorded as "page check timed out" and is not used as non-profile evidence.
- **Verified:** type check shows no new errors. Offline: helper tests on Zillow-shaped (page key inside a JSON query value), Elasticsearch-shaped (POST body `from`/`size`, `hits.total.value`) and form-body calls; paging from two captured calls; next-call building; headers without cookie/CSRF; `learnNetworkRoute` with mocked capture/replay proves both a link-based and an ID-based route.
- **Not yet done / open:** live dry runs blocked while the database is unreachable (spec upgrade). Then: zillow.com with `force_network`, then kw.com for regression, one at a time with crons #90/#91 paused (both are paused now). The harvest does not follow a stored network-call route yet (plan step 7, needs a change to the harvest database function and its own approval). Search-input routes (step 6) not built. The 500-profile trigger is a fixed threshold.

## Paused cron jobs during database recovery and site-mapper testing (2026-10-07)
- **What triggered this:** the database stopped answering through the database API from about 06:35 UTC (504 even for `select 1`). pg_stat_statements before that showed single inserts into `cron.job_run_details` taking up to 142 s, `exp_etl_fetch_collect` up to 92 s and `exp_sf_fetch_tick` up to 78 s, i.e. the every-minute cron load was more than the instance could keep up with. The instance was upgraded and then restarted (postmaster start 2026-10-07 08:45 UTC).
- **Changes shipped** (cron.job `active` flag only, via `cron.alter_job(job_id := <id>, active := false)`; no schedule, command or function changed, nothing unscheduled):
  - Paused 06:33 UTC (site-mapper dry runs): 90 `etl-fetch-tick` (`exp_etl_fetch_tick()`, every min), 91 `etl-fetch-collect` (`exp_etl_fetch_collect()`, every min).
  - Paused 08:46 UTC (after the restart): 75 `sf-hydrate-fetch` (`exp_sf_fetch_tick(50)`, every min), 76 `sf-hydrate-parse` (`exp_sf_parse_tick(300)`, every min), 77 `index-sitemap-rebuild` (`exp_sitemap_rebuild()`, every 15 min), 88 `sf-renodalize` (`exp_sf_renodalize_tick(50)`, every 5 min), 89 `disco-ai-worker-drain` (`exp_disco_ai_worker_tick()`, every 2 min), 92 `etl-extract-tick` (every min), 93 `etl-extract-collect` (every min), 94 `etl-recon-collect` (every min), 95 `etl-recon-retry-sweep` (every 15 min).
  - Already off before today, unchanged: 78 `index-submit-tick`, 96 `etl-resolve-tick`.
  - Left running: 3 `engine_tick`, 4 `engine_collect`, 17 `sentinel_sweep` (every min), 18 `sentinel_arm` (daily), 22 `post-r16-requeue` (every 2 min), 98 `exp-crm-reminders-5min`, 99 `exp-crm-absence-daily`, 100 `m4_renewal_sweep_daily`, 101 `m4_outbox_drain_5min`.
- **Verified:** `cron.job` read after the change shows exactly the states above.
- **Not yet done / open:** the paused jobs stay off while site-mapper changes are tested with dry runs (dry runs call the worker directly and do not need job 89). To restore the pre-incident state: `select cron.alter_job(job_id := j, active := true) from unnest(array[75,76,77,88,89,90,91,92,93,94,95]::bigint[]) j;` and leave 78 and 96 off. Resume in small groups and watch query times, since the same load caused the stall.

## Cron jobs partly resumed after the database upgrade; site-mapper save rule verified on a real remap (2026-10-07)
- **What triggered this:** the database was upgraded and the ETL jobs re-enabled from the app's job page; the step 4 save rule still needed one real remap.
- **Changes shipped** (cron.job `active` flag only): back on: 89 `disco-ai-worker-drain`, 90 `etl-fetch-tick`, 91 `etl-fetch-collect`, 94 `etl-recon-collect`, 95 `etl-recon-retry-sweep`. Still off: 75 `sf-hydrate-fetch`, 76 `sf-hydrate-parse`, 77 `index-sitemap-rebuild`, 88 `sf-renodalize`, 92 `etl-extract-tick`, 93 `etl-extract-collect` (and 78, 96 as before today). Jobs 90 and 91 were paused again for about two minutes for one site-mapper dry run (compass.com, pg_net 1326) and turned back on straight after.
- **Verified:** real remap of kw.com through `disco_request_remap_site` (request 142, job 95), run by job 89. The saved contract was re-checked on 3 of its sample pages (all load, match its detail_pattern and give the required fields); the new contract measured field floor 17 against the saved 19 (required fields OK, reach 146,736; the saved contract has no reach), so the saved contract was kept: request 142 is `completed` with `kept_existing_contract`, `save_check` and the new contract; `disco_site_contract` for kw.com is unchanged (floor 19, 5 samples); no `run` job was queued. Regression dry runs on the current code (pg_net 1318-1326, nothing written): remax.com floor 23 (saved 22), listing reach 10,008, 84 s; compass.com floor 15 twice (saved 16; the new contract has two more fields than the saved one, the floor difference is which sample pages were picked); edwardjones.com 21 (21); schwab.com 16 (16); morganstanley.com 19 (19), 93 s (was 196-235 s); kw.com 16 and 18 (saved 19; per-sample field counts 8-18, so the floor depends on the pages picked). All 10 samples with required fields OK.
- **Not yet done / open:** with the max-of-samples floor, a remap of a site whose profiles vary in richness (kw.com) can be rejected by the save rule by chance. Sitemap reach is capped at 500 by the per-file read limit for single-file profile sitemaps (edwardjones.com, compass.com, schwab.com), which understates reach and weakens the save rule's reach comparison. Jobs 75, 76, 77, 88, 92, 93 remain off.

## Site mapper: step 5 per plan, capture clicks "more" and "Next"; trackers dropped (2026-10-07)
- **What triggered this:** step 5 dry runs (pg_net 1311, 1313, 1315; nothing written). The plan's network-call route says the capture scrolls and clicks "Next" and "Load more"; the build only scrolled, so no agent-list call fired: zillow.com captured 5 calls (bot-detection collectors on px-cloud.net, a navigation call, event tracking), elliman.com 22 (page prefetches, cookie consent, a login settings file, Google Maps). Bot-detection collectors and event endpoints were checked as candidates.
- **Changes shipped** (branch `site-mapper-enhancements`, commit 33f99b2; worker code only, no database change):
  - `src/routes/api/public/disco-webscraper-worker.ts` (`captureNetworkCalls`): after scrolling to the bottom, clicks the first "more" control (button or link whose text contains show more / load more / view more / see more / view all / show all) and the first next-page control (rel=next, text "Next" / "Next page" / › / », ARIA label "next page" or "next", or a next control inside an element marked as pagination); carousel "next slide" controls are excluded. Each click is skipped when the page has no such control (`on_error: skip`), followed by a short wait. Attempts run richest first (scroll + clicks, scroll only, no actions) and fall back when one fails while enough time is left; the result says which actions were used and lists failed attempts. `scrapeWebsite` is unchanged.
  - `src/routes/api/public/-disco-network-route.ts` (`noiseReason`): calls to analytics / ad / tag-manager / attribution, session-recording, consent-manager, bot-detection / challenge / fingerprinting, error-monitoring and maps / fonts / video hosts, calls with tracking-style paths (`/collect`, `/collector`, `/event(s)`, `/track`, `/beacon`, `/pixel`, `/telemetry`, `/rum`, `/metrics`, `/log(s)`, `/ping`, `gen_204`, `/.well-known`, `/cdn-cgi`) and static assets are dropped before checking. Generic vendor and path patterns only, no site names.
  - `src/routes/api/public/disco-ai-worker.ts` (`learnNetworkRoute`): `route_report.network_calls` adds `actions`, `failed_attempts` and `calls_excluded` (count per reason).
- **Verified:** type check shows no new errors. Offline: the two click selectors on sample markup pick "View more" and the "Next page" button (not a carousel "Next slide"), a rel=next link, a pagination "»" link and a pagination item classed "next", and nothing on a page without such controls. The noise check drops the px-cloud collectors, the event endpoint, the consent file, the login settings file and the maps call seen in the dry runs, and keeps site and API calls (`/_next/data/...json?page=2`, `/api/search`, Algolia queries, `/agents/events-team`).
- **Not yet done / open:** dry runs on zillow.com, elliman.com (rendered) and realtor.com with `force_network`, then kw.com for regression. Whether Oxylabs accepts `on_error` on click instructions is confirmed only by a live run; if not, the capture falls back to scroll only and the report shows the failed attempt.

## Site mapper: step 5, numeric cursor offsets and profile links from record fields (2026-10-07)
- **What triggered this:** kw.com dry run with the click build (pg_net 1330; nothing written). The "Next" click fired the agent search call (`POST graph.prod.consumer.kw.com`, GraphQL `AgentDetailsByName`, variables `first: 12, after: 12`), returning 12 agent records (id, name, email, phone, city, state) and `totalCount: 146,729`. The step reported "found, not proven" because the numeric `after` value was not recognised as an offset, and profile links were built by putting the record id into one known profile URL, which kept that agent's name for every record (`/agent/eli-evansbrown/<other id>`); it passed only because one built link equalled a known profile.
- **Changes shipped** (branch `site-mapper-enhancements`; worker code only, no database change):
  - `src/routes/api/public/-disco-network-route.ts`: a numeric value in a cursor-named field (`after`, `cursor`, `start_after`, `search_after`, `skip_token`) is treated as an offset that steps by the page size the call sends (`first`, `limit`, `size`…). Two captured calls to a shared endpoint whose operation differs (`operationName`, `query`…) are no longer read as page 1 and page 2. New `recordTemplateHits` / `recordUrlsAt`: records without links become profile links only from their own fields. The template is learned from a record whose profile URL is already known to the run: every variable part of that URL must equal one of the record's fields, as is or as a URL slug (accents and apostrophes handled), and parts left literal must be site sections shared by the known profile URLs. It is applied to every record and kept when the built links match the profile rule. The one-field ID template stays as the fallback.
  - `src/routes/api/public/disco-ai-worker.ts` (`learnNetworkRoute`): record templates are tried before ID templates. Built links are page-checked on one profile the run had not seen; a link equal to a known profile no longer counts as proof. A record template learned from a known profile's own record is accepted without the check only when no time is left (marked in the report).
- **Verified:** type check shows no new errors. Offline: on a kw.com-shaped response the template `https://kw.com/agent/{slug:fullName}/{id}` is learned from one known profile and builds `grace-ocallaghan` and `ana-maria-lopez` correctly; a decoy (a known URL of another person whose id equals an unrelated record field) is rejected; the GraphQL body `after: 12` gives next value 24 with page size 12; a mocked capture/replay of the KW call shape ends `proven` with reach 146,729 from the stated total, the tracker call dropped and the session/CSRF/cookie headers removed.
- **Not yet done / open:** live dry run on kw.com (`force_network`) and a regression run on one other site. Zillow still captures on a small sub-listing; elliman.com's agent page needs the search-input route (step 6); realtor.com still fails on dead sitemap files.

## Site mapper: step 5, next-page replay limit raised to 45 s (2026-10-07)
- **What triggered this:** kw.com dry run with `force_network` (pg_net 1331; nothing written) on the record-field build: the agent search call was captured after the "Next" click, profile links were built as `https://kw.com/agent/{slug:fullName}/{id}` and a built link for an unseen agent passed the profile-page check, paging was found (`variables.after`, offset, step 12, next 24) and the call states a total of 146,725; the replay of the next call was aborted at the 20 s limit (`AbortError`), so the route stayed "found, not proven". The run finished at 152 s, well before the step's 255 s deadline. remax.com regression on the same build (pg_net 1332): unchanged (floor 23, 10 samples, listing reach 10,008, capture skipped).
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`): `NETWORK_REPLAY_MS` 45 s (was 20 s); the replay is still capped by the time left before the step deadline.
- **Verified:** type check unaffected (constant change only).
- **Not yet done / open:** kw.com dry run with `force_network` to confirm the route is proven.

## Site mapper: step 5 network-call route proven on kw.com (2026-10-07)
- **What triggered this:** confirmation run after the replay-limit change (45 s).
- **Verified:** kw.com dry run with `force_network` (pg_net 1334; nothing written; crons 90/91 paused only for the run), 91 s: the "Next" click captured the agent search call (`POST graph.prod.consumer.kw.com`, 11 calls captured, 7 tracker calls dropped, 4 checked); profile links built as `https://kw.com/agent/{slug:fullName}/{id}` with a built link for an unseen agent passing the page check; paging `variables.after` (offset, step 12); the replayed next call (after = 24) returned 12 new profiles, so the route is **proven** with reach 146,731 (total stated by the call). Best route stays the listing route (12 per page × 12,228 pages = 146,736, higher by 5); the run report keeps the network-call route's measures. Field floor 18, 10 samples. Run 1333 (started about 1.5 minutes after the merge) still ran the previous build (20 s replay limit, aborted).
- **Not yet done / open:** zillow.com still captures on a small sub-listing page; elliman.com's agent page needs the search-input route (step 6); realtor.com fails on dead sitemap files; the harvest does not follow a stored network-call route yet (step 7).

## Site mapper: route-based plan step 6, search-input route; coverage rule replaces the fixed 500-profile trigger (2026-10-07)
- **What triggered this:** plan step 6 (gate: wellsfargoadvisors.com yields a proven route). elliman.com's agent page is a search box with no list until a value is entered (dry runs 1315, 1328). The step 5 trigger used a fixed 500 profiles, which says nothing about a site's size.
- **Changes shipped** (branch `site-mapper-enhancements`; worker code only, no database change):
  - `src/routes/api/public/-disco-search-route.ts` (new, pure helpers): `statedTotalInText` reads a result count the site states in visible text next to a count word (generic words plus the category's own head words), e.g. "16,554 agents found", "Showing 1–12 of 146,729", "2,310 advisors near you". `needsMoreRoutes` (coverage rule): with a stated total, more routes are tried when the best proven reach covers less than 90% of it; without one, only when the best route has no proven reach or its reach is a lower bound. `findSearchInputs` finds search boxes (city / ZIP / name) from the page's own field names, ids, placeholders, ARIA labels and `<label>` text, with the form's method, action and hidden fields, or a box without a form. `searchValues` / `nameStarts` give the values tried.
  - `src/routes/api/public/disco-webscraper-worker.ts` (`captureNetworkCalls`): new `typeInput` option types a value into a box (Oxylabs `input` instruction), clicks its submit control when present, waits and scrolls, and returns the background calls.
  - `src/routes/api/public/disco-ai-worker.ts`: the step 5 trigger now uses the coverage rule (the directory page's stated total against the sitemap / listing reach) instead of 500 profiles. New `learnSearchRoute`: runs when the coverage rule still asks for more after step 5 (the stated total now also includes a total stated by a captured background call), or a dry run sends `force_search`, and the directory page (else the homepage) has a search box, with at least 120 s left (45 s when forced). Values come from our own data, two per kind while mapping: the largest cities in `exp_us_cities` (6 read, "City, ST" then "City ST" then "City"), the most common ZIP among our `professionals` records in each of the first 4, and last-name starts in the order a sample of 3,000 of our professionals' last names uses them (initial, then the commonest two-letter start). A GET or POST form is submitted directly; otherwise the value is typed in the browser and the background calls are checked with the step 5 helpers (tracker filter, profile links or record-field templates). Proven when the first value returns at least 3 links matching the profile rule and a second value returns at least 3 new ones; for a GET form, the results page's next link is fetched once. `route_report.search_inputs` (boxes found, every value tried with the profiles it returned, the route) and `route_report.stated_total` are added; `best_route` can be `search_input` with the input kind, working format, request (form field, page address or call field carrying the value), inputs rule and the values tried. Its reach is the distinct profiles from the two values (a lower bound; how far down the city / ZIP / letter lists the harvest goes is decided in step 7).
- **Verified:** type check shows no new errors (cheerio callback types resolve in the project build as in `-disco-site-contract.ts`). Offline: stated totals read from "16,554 agents found", "Showing 1-12 of 146,729" and "2,310 advisors near you" ("5 agents on team" and years ignored, no count read from plain copy); coverage rule on KW (146,736 of 146,731 stated → no more), Zillow-like (0 of 16,554 → more), lower-bound sitemap without a total (→ more), Morgan Stanley-like (118, not a lower bound → no more); a page with a location form, a newsletter form and a name box gives a GET form (`location`, hidden field kept) for ZIP/city and a JS box for name, and skips the email field. Live data (read-only): top cities New York 10001, Los Angeles 90015, Chicago 60609, Houston 77095, Philadelphia 19114 from our professionals; last-name initials S, M, B, H, C, W, R, G.
- **Not yet done / open:** dry runs: wellsfargoadvisors.com with `force_search` (gate), elliman.com rendered, kw.com for regression. Run time: a typed search costs 30–60 s each; when under 120 s are left the route is skipped and reported. Sitemap reach still capped at 500 per file (lower bound), so the coverage rule asks for more routes on edwardjones.com, compass.com and schwab.com until that is fixed.

## Site mapper: step 6 follow-up, category count words, search supplies first candidates, route search as a second dry-run call (2026-10-07)
- **What triggered this:** step 6 dry runs (pg_net 1335-1337; nothing written). wellsfargoadvisors.com (gate): "no fetchable entity detail page found from https://locations.wellsfargoadvisors.com/search (0 candidates)": the directory is a search page with no profile links and the only sitemap in robots.txt (`YextWFmap1.xml`) returns 404, so no profile page was found and no route step ran. elliman.com (rendered): search boxes found (a name / state / office-address box and a GET form on `/agent` with first- and last-name fields) but the step was skipped for time (run 269 s), and "115 offices in…" was read as the site's total, so the background-call step was judged not needed. kw.com: unchanged; "146734 Results" read, coverage 100%, both extra routes skipped.
- **Changes shipped** (branch `site-mapper-enhancements`; worker code only, no database change):
  - `src/routes/api/public/-disco-search-route.ts` (`statedTotalInText`): only neutral count words (results, matches, listings, profiles) plus the caller's category words count. `disco-ai-worker.ts` passes the category's head words, and the place words (location, office, branch, store) only for location categories.
  - `src/routes/api/public/disco-ai-worker.ts` (`searchSeedCandidates`): when a run has no profile candidates at all (with more than 120 s left), the search box on the directory page (else the homepage) is used once with the first value from our own data (ZIP or city of the largest city, or the commonest last-name start). A GET / POST form is submitted directly, else the value is typed in the browser. The same-site links on the results page, or the same-site URLs in the background-call responses, become candidates and go through the normal profile-page checks; the result is reported as `search_seed` (also in the failure diagnostics).
  - Route search as a second call (dry runs): every run returns `route_report.routes_state` (profile rule, directory and search pages, profile links seen, the static route with its reach and whether it is a lower bound, the stated total) and `routes_deferred` (true when the network-call or search step was skipped for time). A dry-run request `{ dry_run: true, phase: 'routes', state: <routes_state> }` runs only those two route steps with a fresh 300 s and returns their reports and the best route. Read-only. The page check in that call has no AI step: a built link counts when the fetched page holds one entity tied to it, or loads, matches the profile rule and is not a listing page. Live mapping keeps one call; a second live call would need a new request type in the queue (a database change, separate approval).
- **Verified:** type check shows no new errors.
- **Not yet done / open:** dry runs: wellsfargoadvisors.com (`force_search`), elliman.com rendered (first call, then `phase: 'routes'` with its `routes_state` and `force_search`), kw.com for regression.

## Site mapper: step 6, pick the autocomplete suggestion, forms first, cookie inputs skipped (2026-10-07)
- **What triggered this:** dry runs on the step 6 follow-up build (pg_net 1340-1342; nothing written). wellsfargoadvisors.com: the search box was found and ZIP 10033, "New York, NY" and "M" were typed, but no profile links came back, so no profile page was found. A check in the browser pane showed why: typing fires only the suggestion call (`prod-cdn.us.yextapis.com/.../filtersearch?input=10001`); the results call (`.../search/vertical/query`) fires only when a suggestion (a `role="option"` button, e.g. "Chicago, Illinois 60609, United States") is picked or Enter is pressed, after which advisor links on `home.wellsfargoadvisors.com` appear. The capture clicked the next button instead. elliman.com (rendered): coverage now asks for more routes (sitemap 1,432 is a lower bound; the "115 offices" misread is gone); both route steps were cut by time (`routes_deferred: true`); the second call (`phase: 'routes'`, 240 s) worked: background calls 29 captured, 4 tracker calls dropped, none list agents; the search step spent its time on 6 browser tries (3 written formats × 2 cities) in the main box and never reached the first-name / last-name GET form on `/agent`.
- **Changes shipped** (branch `site-mapper-enhancements`; worker code only, no database change):
  - `src/routes/api/public/disco-webscraper-worker.ts` (`captureNetworkCalls` `typeInput`): after typing, waits 2 s and clicks the first `role="option"` suggestion when one appears (skipped when absent), then the submit control, then waits and scrolls.
  - `src/routes/api/public/-disco-search-route.ts` (`findSearchInputs`): real forms first, then location boxes, then name boxes; cookie-consent / vendor inputs (e.g. OneTrust "Cookie list search") are skipped.
  - `src/routes/api/public/disco-ai-worker.ts` (`learnSearchRoute`, `searchSeedCandidates`): up to 3 boxes; a typed box gets one browser try per value with the first written format only (the other formats are tried on real forms, which cost no browser time); each attempt lists the non-tracker calls the typed search captured.
- **Verified:** type check shows no new errors. Offline: on the Wells Fargo markup the search box is kept and the cookie-list input skipped; on Elliman-like markup the first-name / last-name GET form comes before the JS box.
- **Not yet done / open:** dry runs: wellsfargoadvisors.com (`force_search`), elliman.com rendered (call 1, then `phase: 'routes'`), kw.com for regression. The Wells Fargo results call carries the site's public search key in its address (`api_key=…`, sent by every visitor's browser); it would be stored as part of the route address.

## Site mapper: plain fetch for sitemaps and robots.txt; a run reports what it has before the worker limit (2026-10-08)
- **What triggered this:** dry runs on the suggestion-pick build (pg_net 2647-2649; nothing written). wellsfargoadvisors.com (`force_search`) hit the worker's 300 s limit and returned nothing, so whether the search supplied profile candidates could not be seen (the search seed can take up to 150 s and some later steps had no time cap of their own). elliman.com (rendered) failed with "no fetchable entity detail page found from https://www.elliman.com/ (70 candidates; tried 1)": robots.txt and the 10 sitemap XML files were fetched through the browser (rendered crawl method), about 210 s, so the first candidate profile page was skipped for time. kw.com unchanged (98 s, floor 18, 10 samples, reach 146,748 against "146,740 Results" stated, extra routes skipped).
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`; worker code only, no database change):
  - robots.txt and sitemap fetches use the plain crawl method when the site's crawl method is `needs_js_api`; the scraper still falls back to rendering when a plain fetch is blocked. Page fetches are unchanged.
  - `mapSiteWithLimit`: a map run (dry runs and live `map_site` requests) is stopped at 285 s and fails with what it has learned so far: a `MapSiteError` whose diagnostics carry `stopped: true` and `progress` (last step reached and when, sitemap trace, directory page, number of candidates before the search seed, the search-seed report, profile pages tried, the accepted profile page and rule). For live requests these diagnostics are stored on the request as for any map failure. The late-run sample fetches (used when sampling starts after 200 s) are now capped by the run clock.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** dry runs: wellsfargoadvisors.com (`force_search`), elliman.com rendered (call 1, then `phase: 'routes'`), kw.com for regression.

## Site mapper: search after failed candidates, search-page discovery, self-heal and search time guards, script-only form results (2026-10-08)
- **What triggered this:** dry runs on the plain-fetch build (pg_net 2650-2652; nothing written; crons 90/91 paused only per run). wellsfargoadvisors.com (`force_search`) was stopped at 285 s with its progress: the directory page picked was a marketing page (`financial-advisor.htm`) with marketing-page candidates, all rejected; the search seed did not run because candidates existed; the remaining time went to the profile checks and the self-heal second pass. elliman.com (rendered) finished in 250 s (10 samples, floor 12); the network-call step found no agent calls; the search step tried 1 value ("M" on the first-name GET form, whose result needed rendering, then typed) before time ran out (forced searches started with 45 s left). kw.com unchanged (floor 17, 10 samples, reach 146,748; extra routes skipped by the coverage rule).
- **Changes shipped** (`src/routes/api/public/disco-ai-worker.ts`, commit `6a42949`; worker code only, no database change):
  - Search after failed candidates: when every profile candidate fails and the search seed has not run yet, the site's own search box supplies new candidates once and they go through the same profile-page checks. Needs 120 s left; the seed stops at least 70 s before the run limit so its candidates can still be checked.
  - Search pages: the seed reads search boxes on the directory page, up to 2 same-site pages linked from it or the homepage whose link text or path says search / find / locator / lookup, and the homepage; at most 3 boxes, labelled boxes (ZIP, city or name) before catch-all site-search boxes. The seed report lists the pages checked.
  - Self-heal time guard: the second pass starts only with 90 s left; otherwise `self_heal.skipped` says why.
  - Script-only form results: a form whose result page has under 500 characters of visible text and no profile links is not submitted again; later values are typed in the browser straight away (in both the search route and the seed).
  - Search time floor: the search route needs 120 s also when forced; with less it is skipped as "time budget", which sets `routes_deferred` so the phase-2 dry-run call runs it.
- **Verified:** type check of the worker shows no new errors (only missing Node type definitions in the stand-alone check).
- **Not yet done / open:** dry runs: wellsfargoadvisors.com (`force_search`), elliman.com rendered (call 1, then `phase: 'routes'` if deferred), kw.com for regression. The step 6 search route itself still reads boxes on the directory page or homepage only (not the linked search pages the seed now finds). Choosing the search box with an AI read of the page (code still verifying the results) is not built; it needs its own approval.

## Site mapper: search results ignore the search page's own menu links; next box sooner, location boxes first (2026-10-08)
- **What triggered this:** dry runs on commit `6a42949` (pg_net 2653-2657; nothing written; crons 90/91 paused only per run). wellsfargoadvisors.com (`force_search`) now ends in 121 s instead of being stopped: the self-heal pass went to `locations.wellsfargoadvisors.com/search`, the search seed submitted ZIP 10033 to the homepage "Find an Advisor by ZIP" form and took the 20 same-site links on the result page as candidates, but they were the page's menu links (market articles, IRA and tax pages), so all 6 checked were rejected. elliman.com (rendered): call 1 in 178 s, floor 10, the search was deferred (84 s left, new 120 s floor); the phase-2 call (242 s) found no agent-listing background calls (page loads only) and spent 173 s on 5 values ("M", "Ma", "B", "Br", "H") in the first-name box without reaching the "agent name, state or office address" box that takes a city. kw.com failed on slow fetches (2655: two profile pages hit the 45 s cap; 2657: homepage hit the 60 s cap), not on this change.
- **Changes shipped** (commit `dc813e8`; worker code only, no database change):
  - `src/routes/api/public/disco-ai-worker.ts` (`learnSearchRoute`, `searchSeedCandidates`, `runDeferredRoutes`, step 6 caller): links already on the page that holds the search box are not counted as search results (results pages and background-call responses); the search route now receives that page's HTML. A box whose first two values return no profiles is left for the next box (search route and seed).
  - `src/routes/api/public/-disco-search-route.ts` (`findSearchInputs`): boxes that take a city or ZIP come before name-only boxes; real forms first within each group.
- **Verified:** type check of the worker shows no new errors (only missing Node type definitions in the stand-alone check).
- **Not yet done / open:** dry runs: wellsfargoadvisors.com (`force_search`), elliman.com rendered (call 1, then `phase: 'routes'`), kw.com for regression (re-run alone).

## Site mapper version 2 (AI agent): feasibility probe (2026-10-09)
- **What triggered this:** a second, agent-based site mapper is being built next to the current one (not replacing it) and compared on the same sites, following the approach of the standalone AutoCrawl tool (an AI agent that browses the site, reads its background calls, tests crawl methods on samples, checks coverage from an independent path and submits a validated config). This is a parallel version outside the stage-wise checklist, agreed with the owner; dry runs only, no database writes, no cron. Before building it: does our key accept `claude-sonnet-5-5`, can the worker drive Oxylabs Headless Browser (a live remote Chrome on Oxylabs IPs, faster than one render per action), and how fast is it compared with today's render.
- **Changes shipped** (commit `84a677a`; code only, no database change): new `src/routes/api/public/disco-agent-probe.ts` (POST, worker key required, read-only): a one-line Anthropic call with the requested model; a Headless Browser check over the Chrome DevTools protocol (connect to `hb.oxylabs.io` with `OXYLABS_HB_USERNAME` / `OXYLABS_HB_PASSWORD` when set, else the existing Oxylabs credentials; open the page, read title / links / inputs, scroll once, count background calls, time each step); the same page through `captureNetworkCalls` for comparison. `src/routeTree.gen.ts` lists the new route. `disco-ai-worker.ts` is unchanged.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** run the probe after deploy (kw.com/agents first). Then build version 2 itself in new `disco-agent-*` files.

## Site mapper version 2 probe: first results; credential names reported (2026-10-09)
- **What triggered this:** probe run on kw.com/agents (pg_net 3971, read-only): `claude-sonnet-5-5` answered through our key (1.0 s); today's Oxylabs render with background-call capture took 22.6 s (11 calls); Oxylabs Headless Browser was reached from the worker (1.4 s) but refused our scraper-account login ("401 invalid credentials"). After `OXYLABS_HB_USERNAME` / `OXYLABS_HB_PASSWORD` were added in Lovable, run 3972 still used the scraper login: the dev build the worker runs on was built before the secrets existed.
- **Changes shipped** (commit `6d5f17b`; code only, no database change): `src/routes/api/public/disco-agent-probe.ts` also returns `env_seen`, which credential names the build can see (true/false only, never values). The commit also rebuilds the dev deployment so the new secrets are picked up.
- **Verified:** not yet (needs the deploy).
- **Not yet done / open:** re-run the Headless Browser check after the deploy.

## Site mapper version 2 probe: Headless Browser connects; wait for bot-check pages (2026-10-09)
- **What triggered this:** probe run on kw.com/agents after the redeploy (pg_net 3973, read-only): the build sees `OXYLABS_HB_USERNAME` / `OXYLABS_HB_PASSWORD`; Oxylabs Headless Browser connected from the worker (fetch upgrade, Chrome 147) and the whole sequence took 7.7 s (connect 1.2 s, tab setup 1.1 s, navigate + load 2.6 s, read / scroll / read 2.5 s) against 22.6 s for today's render. The page read at the load event was Cloudflare's bot check ("Just a moment...", 2 links), which clears itself after a few seconds.
- **Changes shipped** (commit `51e8055`; code only, no database change): `src/routes/api/public/disco-agent-probe.ts` waits up to 25 s after the load event while the page title looks like a bot-check page, then reads the page, and reports the wait as a step.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** re-run the probe on kw.com/agents after the deploy.

## Site mapper version 2 (AI agent): dry-run mapper built next to the current one (2026-10-09)
- **What triggered this:** the owner asked for a second site mapper following the approach of the standalone AutoCrawl tool (an AI agent that browses the site, reads and replays its data calls, tests crawl methods on samples, checks coverage from an independent path and submits a validated config), built in TypeScript next to the current mapper and compared on the same sites. Probe results (pg_net 3971-3974): `claude-sonnet-5-5` works with our key; Oxylabs Headless Browser connects from the worker, clears Cloudflare's check on kw.com/agents by itself (3.9 s) and reads the real page (215 links after one scroll) in 12.3 s against 22.6 s for one Oxylabs render.
- **Changes shipped** (commit `797680b`; code only, no database change; `disco-ai-worker.ts` unchanged; parallel version outside the stage-wise checklist, agreed with the owner):
  - `src/routes/api/public/disco-agent-mapper.ts` (new endpoint, `POST /api/public/disco-agent-mapper`, worker key, `dry_run: true` required): Claude researches one site with tools (sitemap_probe, http_fetch incl. replay of a browser call, inspect, browser_open / snapshot / click / type / scroll / back, network_log, network_detail, search_scripts, test_source, coverage_check, submit_config, give_up). A config is accepted only after at least two browser actions on a results listing, a coverage_check (90% or a written reason) and a final sample validation (every source produces profile URLs; one sample profile loads). Limits per site: default 8 minutes of research time (max 10), $3 AI cost cap (max 5), 40 research fetches. A worker call stops about 4 minutes in and returns `status: 'continue'` with the state; the next call sends it back and continues in the same browser tab; the last call returns `status: 'done'` with the outcome (config / gave_up / stopped), the config, the research report, the validation, cost, tokens and timings.
  - `src/routes/api/public/-disco-agent-browser.ts`: Oxylabs Headless Browser over the Chrome DevTools protocol (Runtime domain never enabled, no injected scripts): open (waits for data traffic and for a bot-check page to clear), snapshot (numbered controls and links, visible text), click, type, scroll, back; records documents and data calls (request headers, post data, response bodies) minus ads / analytics / consent / session-recording traffic; named Oxylabs session so a later call reconnects to the same browser.
  - `src/routes/api/public/-disco-agent-engine.ts`: crawler engine ported from AutoCrawl: sources sitemap, listing (page / offset / cursor / next_link paging; seeds list, range, alphabet with automatic deepening, us_states, extract incl. dependent extract seeds), link_crawl, autocomplete; extractors CSS (::attr / ::text), JSONPath subset, embedded JSON, header. Network injected: Oxylabs Web Scraper API (`fetchApiCall`; `scrapeWebsite` with render for render=true).
  - `src/routes/api/public/-disco-agent-prompt.ts`: system prompt and tool definitions adapted from AutoCrawl with our rules (map only profile pages of the given category; never log in or enter credentials; never solve or get around a CAPTCHA / bot check; no made-up values in captcha / token / signature fields; no residential proxy or human help).
  - `src/routeTree.gen.ts` lists the new route.
- **Verified:** type check shows no new errors. Offline engine test with a fake network (JSONPath, CSS / embedded-JSON / JSON extractors, templates, page summary, a seeded listing with paging = 10 profiles, a sitemap index = 1 profile + 1 rejected, sample limits 2 seeds x 2 pages = 8, seeds, alphabet deepening, config problems): all pass.
- **Not yet done / open:** first dry runs (kw.com first, then elliman.com, wellsfargoadvisors.com and the rest of our sites) and the comparison with the current mapper. Not ported: id_range, archive_index and profile_graph sources, XPath extractors, the full no-AI crawl run (`--run`) and storing a config (step 7 / database, separate approval).

## Site mapper version 2: first dry run (kw.com); own browser tab; longer worker calls allowed (2026-10-09)
- **What triggered this:** first version 2 dry run, kw.com (pg_net 3975; nothing written): done in one call, 107 s of research, $0.10 (`claude-sonnet-5-5`, 9 turns, 9 research fetches). Config: listing `https://kw.com/agents?page={page}` (pages 1..12,231, about 12 agents per page, server-rendered links, deep pages 5000 and 12231 checked), estimate about 146,000 profiles (the current mapper's listing reach is 146,736), plus the agent sitemap as a small supplement; profile pattern `^https://kw\\.com/agent/[^/?#]+/\\d+$`; final validation 24 + 2 profile URLs. But the browser was not used: attaching to the tab Oxylabs Headless Browser opened itself failed ("Session with given id not found"), so the browser-evidence rule was skipped, and the coverage check used probes from the same directory (41.7% on a 3-page sample, accepted with a written reason). The 5-minute per-call limit was our own choice: the dry-run caller (`pg_net`) waited 300 s, and the hosting (Cloudflare Workers) has no hard limit on HTTP request duration while the caller is connected (CPU time is limited separately: 30 s default, up to 5 min).
- **Changes shipped** (commit `ac40550`; code only, no database change): `-disco-agent-browser.ts` opens its own tab (as the probe did) unless a saved tab of the session still exists, with one retry on a fresh tab. `disco-agent-mapper.ts` takes `call_seconds` (120-900, default 240) so a caller with a matching `pg_net` timeout can run longer calls and the research needs fewer calls.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** re-run kw.com with the browser, then elliman.com and wellsfargoadvisors.com; compare with the current mapper. The current mapper still stops itself at 285 s (`mapSiteWithLimit`), based on the same 5-minute assumption.

## Site mapper version 2: dry runs on kw.com, elliman.com, wellsfargoadvisors.com; browser connects without session_name (2026-10-09)
- **What triggered this:** version 2 dry runs with 600 s calls (pg_net 3976-3978; nothing written). The browser did not work in any of them: Oxylabs refused session names over 36 characters (elliman.com, wellsfargoadvisors.com) and, with a session name, attaching to a tab failed (kw.com). Without the browser: kw.com, 71 s, $0.08, listing `/agents?page={page}` (12,231 pages; page 12,000 still has agents) + agent sitemap, validation 24 + 2 profiles; elliman.com, 69 s, $0.10, the agent sitemap index from robots.txt (`/sitemaps/agents/index.xml`, per-state shards; 4,783 profile URLs from 6 shards in the sample, estimate about 6,500; the current mapper reports 1,432 as a lower bound), validation 4,783; wellsfargoadvisors.com, 251 s, $0.54, gave up: the advisor locator is a client-rendered Yext search whose request keys could not be found without the browser, and the Yext API host did not answer through the fetch proxy (HTTP 613). Coverage checks without the browser used probes from the same source, which the AI reported as not independent.
- **Changes shipped** (commit `a620444`; code only, no database change): `-disco-agent-browser.ts` connects without `session_name` (as the probe did); a later worker call starts a fresh browser and reopens the last page.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** re-run the three sites with the browser.

## Site mapper version 2: the site's own domain and subdomains only (2026-10-09)
- **What triggered this:** owner's rule after the wellsfargoadvisors.com dry run (pg_net 3978), where version 2 tried the third-party Yext search API behind the site's advisor locator: mapping must stay on the site's own domain and its subdomains.
- **Changes shipped** (commit `aa2d4a7`; code only, no database change): `disco-agent-mapper.ts`: every request goes through a site check (registrable domain of the mapped site, e.g. `wellsfargoadvisors.com`, and any subdomain such as `fa.` or `locations.`): http_fetch (incl. replay), sitemap_probe, browser_open, search_scripts (site script files only), test_source, coverage_check and the final validation refuse other hosts with a clear message; a submitted config whose start URL is elsewhere is refused; network_log shows only the site's own calls and says how many third-party calls were hidden. `-disco-agent-prompt.ts` states the rule (third-party search / locator vendors, CDNs and other domains are not allowed even when the site's pages call them).
- **Verified:** type check shows no new errors.
- **Not yet done / open:** re-run kw.com, elliman.com and wellsfargoadvisors.com with the browser (after the session fix) and this rule.

## Site mapper version 2: own tab no longer detached; lighter page summaries (2026-10-09)
- **What triggered this:** dry runs after the site-only rule (pg_net 3979-3981; nothing written). The browser still failed ("Session with given id not found"): the handler for newly attached targets also receives the event for the tab version 2 attaches to itself and detached it as "not a frame or worker". elliman.com: 62 s, $0.10, same route as before (agent sitemap index with state shards; estimate about 9,000, 4,800 profile URLs from 5 shards). wellsfargoadvisors.com: 254 s, $0.63, gave up within the site-only rule: no advisor list on the site's own pages or sitemaps, the locator's results come from a third-party API; give_up was refused several times until 60% of the research time was used. kw.com: stopped by the platform's CPU limit (Cloudflare error 1102, HTTP 503).
- **Changes shipped** (commit `37fdc38`; code only, no database change): `-disco-agent-browser.ts` leaves page targets (incl. its own tab) attached. `-disco-agent-engine.ts`: page summaries read at most the first 1 MB and walk at most 50,000 JSON nodes; extraction still reads whole pages.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** re-run the three sites with the browser. If kw.com hits the CPU limit again, measure where (large pages read with the HTML parser).

## Site mapper version 2: browser works; dry runs kw.com and elliman.com with the browser; reconnect on dropped connection (2026-10-09)
- **What triggered this:** dry runs after the tab fix (pg_net 3982-3983; nothing written; wellsfargoadvisors.com parked by the owner). elliman.com: 83 s, $0.12, browser used (opened /agent, typed "smith" in the agent search; the search calls `core.api.elliman.com/agent/autocomplete`, a subdomain, which returned 404 when replayed outside the browser), config = agent sitemap index (`/sitemaps/agents/index.xml`, 12-13 state shards; 4,782 profile URLs from 6 shards; the site states "6K+ agents"; estimate about 6,000 against 1,432 as a lower bound in the current mapper), coverage 100% on 10 probes (partly from the sitemap, reported as weak). kw.com: 174 s, $0.17, same config as before (listing `/agents?page={page}`, 12,231 pages, about 147,000 profiles, plus the agent sitemap), coverage 83.3% with a written reason; the browser showed the first page, then every browser step failed with "browser connection closed", so the listing was never seen in the browser and the browser-evidence rule only lapsed when research time ran low.
- **Changes shipped** (commit `e19aa68`; code only, no database change): `disco-agent-mapper.ts` reopens a closed browser (fresh browser, last page reopened, network records kept) before a browser step, up to 3 times per worker call; `-disco-agent-browser.ts` reports whether its connection is closed.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** re-run kw.com; find out why the remote browser connection drops (idle time between AI turns, or the site's bot check).

## Site mapper version 2: kw.com dry run with the browser (2026-10-09)
- **What triggered this:** dry run after the reconnect change (pg_net 3984; nothing written). kw.com: 244 s, $0.23, browser used (3 actions, no reconnect needed): opened /agents, searched "Austin", read the agent-search GraphQL call on `graph.prod.consumer.kw.com` (a kw.com subdomain), replayed it outside the browser (about 35 s per request, some HTTP 613 answers, text search only) and rejected it; opened the Austin results page. Config: listing `/agents?page={page}` (12 agents per page, 12,231 pages, page 12,000 checked) plus the agent sitemap; estimate about 146,000 profiles (current mapper: 146,736); final validation 36 + 2 profile URLs. Coverage check 70% (10 probes from the Austin search and the sitemap against a 3-page sample of the 12,231-page listing), accepted with a written reason.
- **Changes shipped:** none (results only).
- **Verified:** dry-run output above.
- **Not yet done / open:** the coverage check cannot reach probes deep in very long listings within its time cap (3 pages of 12,231), so its percentage says little there; options: probes taken from the first pages of the same listing order, or a check that fetches the listing pages where the probes appear. More sites to compare with the current mapper (compass.com, remax.com, edwardjones.com, schwab.com, morganstanley.com, zillow.com, realtor.com).

## Site mapper version 2: dry runs on the remaining sites (2026-10-09)
- **What triggered this:** owner asked to run version 2 on the rest of our sites (pg_net 3985-4006; dry runs, nothing written; 600 s calls; wellsfargoadvisors.com parked). Current mapper contracts with a profile rule exist for compass.com, edwardjones.com, kw.com, morganstanley.com, remax.com and schwab.com only.
- **Results (version 2):**
  - Config with profile URLs proven: compass.com (agent-pages sitemap index, estimate ~40,000; 3,354 in the 400 KB sample), remax.com (`/agents-index.xml`, ~100,000; 3,831 in sample), edwardjones.com (financial-advisor sitemap, ~19,000; 2,134 in sample), morganstanley.com (`advisor.morganstanley.com/sitemap.xml`, ~6,000; 457 in sample), schwab.com (`/branches/sitemap.xml`, 388 branch pages), zillow.com (listing `/professionals/real-estate-agent-reviews/{zip}/?page={page}` with state / county / ZIP seeds, ~500,000; 52 in sample), coldwellbanker.com (state agent sitemaps, ~60,000), ml.com (`advisor.ml.com/sitemap.xml`, ~15,000; 1,432 in sample), bhhs.com (own agent-search API `/bin/bhhs/solrAgentSearchServlet`, 100 per page, stated total 41,175), realtor.com (link crawl from 18 hand-picked city pages with render; completeness not proven), fidelity.com (218 investor-center branch pages), ubs.com (`advisors.ubs.com/sitemap.xml`, ~4,000; 2,260), raymondjames.com (own advisor-search API by name prefix, alphabet seeds, ~5,000), plus kw.com and elliman.com (earlier entries).
  - Gave up: ameriprise.com (advisor profiles on ameripriseadvisors.com, another domain), rwbaird.com (advisor profiles on bairdwealth.com, another domain), exprealty.com (directory on a third-party API that needs reCAPTCHA), lpl.com (no per-advisor pages; finder links to external sites; API needs reCAPTCHA).
  - Failed: nar.realtor, HTTP 502 "Internal server error" twice (also raymondjames.com, rwbaird.com and lpl.com once in a batch of six; they finished when re-run in pairs). Cause not yet known.
  - Time and cost: 78-489 s and $0.08-0.69 per site; about $4.50 in total for the finished runs.
- **Problems seen:** coverage checks read only the first 400 KB of each sitemap file, so probes later in a file count as missing (compass 8.3%, remax 0%, morganstanley 0%; accepted with written reasons); schwab.com and fidelity.com configs collect branch pages, not individual advisor pages (the category check does not enforce person pages for a person category); realtor.com uses a hand-picked city list (the prompt asks for systematic seeds); sister domains of the same brand (ameripriseadvisors.com, bairdwealth.com) are outside the site-only rule.
- **Changes shipped:** none (results only).
- **Not yet done / open:** fixes for the problems above need the owner's decision; nar.realtor 502.

## Site mapper version 2: person-page check, whole-sitemap coverage, complete lists, other-domain flags (2026-10-09)
- **What triggered this:** problems found in the dry runs on the remaining sites (entry above) and the owner's decisions: fix the page-type and coverage problems; hand-picked lists are fine for testing but a config used for running must cover the whole site; sister domains and third-party data sources are not mapped now but recorded with a flag, so a person can approve one on a remap after checking it manually (e.g. ameripriseadvisors.com, bairdwealth.com; third-party data such as vitals.com content loaded by webmd.com); find out why some runs return a bare HTTP 502.
- **Changes shipped** (commit `6e02254`; code only, no database change):
  - `disco-agent-mapper.ts` (submit_config): the sample profile page is read by one short AI check (one person / one office or branch / a list / other); for a person category anything but one person is refused, for an office category anything but an office or person page is refused. A category is treated as a person category unless its name says office, branch, location, store, company and similar.
  - `disco-agent-mapper.ts` (coverage_check): whole sitemap files are read (up to 6 files); test_source and research still sample 400 KB.
  - `disco-agent-mapper.ts` (submit_config): a `list` seed with fewer than 100 values, or a link_crawl with more than 3 start URLs, is refused unless `complete_list_reason` says the list is the site's complete set.
  - `disco-agent-mapper.ts`: other-domain observations: refused requests to other hosts, JSON / GraphQL data calls the site's own pages make to other hosts (from the browser), and a new `note_other_domain` tool; each domain is labelled `sister_domain` (shares at least 5 characters of the brand name, e.g. bairdwealth / rwbaird) or `third_party`, with reasons and sample URLs, and returned as `flags.other_domains` on every finished run. Nothing is stored; they are not used for mapping.
  - `disco-agent-mapper.ts`: an error escaping the request handler comes back as JSON with its message instead of a bare 502. `-disco-agent-browser.ts`: recorded response bodies capped at 200 KB, at most 300 network records kept.
  - `-disco-agent-prompt.ts`: the rules above (person pages only for a person category; complete lists; note_other_domain).
- **Verified:** type check shows no new errors.
- **Not yet done / open:** re-run schwab.com, fidelity.com, compass.com, remax.com, morganstanley.com, realtor.com, ameriprise.com, rwbaird.com and nar.realtor (also once without the browser to see whether the browser causes its failure). Storing flags and approving a domain on a remap need a database change (separate approval).

## Site mapper version 2: re-runs after the page-type / coverage / list / flag changes; flags limited to real data sources (2026-10-09)
- **What triggered this:** dry runs after commit `6e02254` (pg_net 4007-4016; nothing written).
  - schwab.com: now individual financial-consultant pages (`/app/branch-services/financial-consultant/...`, sample page check: one person), reached from the branch pages (extracted seeds), estimate ~3,000, 115 s, $0.12.
  - fidelity.com: now individual advisor bio pages on `digital.fidelity.com` from the site's own advisor-search API by state (4,159 profile URLs in the sample, estimate ~8,000), sample page check: one person; coverage 0% because the capped run reached 30 of 51 states and not the probe state (written reason); 348 s, $0.39.
  - remax.com: coverage 100% with whole sitemap files, 49,738 profile URLs in the validation, estimate ~50,000, 108 s, $0.10.
  - morganstanley.com: coverage 100% (15 probes), estimate ~7,000, 114 s, $0.15.
  - compass.com: coverage 100% (35 probes), estimate ~35,000, 120 s, $0.08.
  - realtor.com: now systematic: listing `/realestateagents/{zip}/pg-{page}` over ZIP range 00501-99950 (no hand-picked cities), sample page check: one person; coverage not measured (probes outside the sampled ZIPs); 365 s, $0.19.
  - ameriprise.com, rwbaird.com: gave up, with flags `sister_domain` ameripriseadvisors.com and bairdwealth.com (evidence: the site's "find an advisor" links / refused requests).
  - nar.realtor: with the browser, a bare HTTP 502 again (the JSON error handler did not catch it, so the request itself was stopped by the platform, most likely memory); without the browser it stopped without a config after 242 s and $1.08, flagging `directories.apps.realtor` (NAR's member directory) as another domain.
  - Flags also listed many ad-auction, analytics and testing hosts as third-party data calls (e.g. 15 on remax.com).
- **Changes shipped** (commit `52dbb4f`; code only, no database change): `disco-agent-mapper.ts` flags a third-party data call only when it is not an ad, analytics, testing, survey, map or consent service and its JSON response holds a list of records; refused requests and `note_other_domain` reports are flagged as before.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** nar.realtor with the browser (platform stop; likely the full page tree read for snapshots on a very large page); storing flags and approving a domain on a remap (database change, separate approval); coverage on very long listings.

## Cron 89 paused while the staging schema is implemented (2026-10-09)
- **What triggered this:** owner's decision to stop the ETL pipeline, finish the staging data schema (`docs/ETL-Staging-Data-Schema.md`, section 9 steps 1-3) and then remap Edward Jones, Morgan Stanley and Schwab before deciding how to proceed.
- **Change (live cron state, no code):** `cron.alter_job(89, active := false)` - `disco-ai-worker-drain` (map / remap request queue). No open map requests at the time (last request 2026-10-07). Already paused before this change: 75 `sf-hydrate-fetch`, 76 `sf-hydrate-parse`, 77 `index-sitemap-rebuild`, 78 `index-submit-tick`, 88 `sf-renodalize`, 90 `etl-fetch-tick`, 91 `etl-fetch-collect`, 92 `etl-extract-tick`, 93 `etl-extract-collect`, 94 `etl-recon-collect`, 95 `etl-recon-retry-sweep`, 96 `etl-resolve-tick`. Left running (not part of the site mapper / harvest, owners not confirmed): 3, 4 (engine tick / collect), 17, 18 (sentinel), 22 (post-r16 requeue), 98-101 (CRM reminders / alerts, m4 renewal / outbox).
- **Verified:** `cron.job` shows 75-96 all inactive.
- **Resume:** cron 89 is switched on only while the three remaps are processed, then paused again; the full resume list is decided by the owner.

## Staging schema step 1: static key lists, formats and identity set (2026-10-09)
- **What triggered this:** `docs/ETL-Staging-Data-Schema.md` section 9 step 1 (agreed schema, commit `f63540d`); owner's go-ahead to finish the schema code while cron 89 is paused.
- **Changes shipped** (commit `b91de5c`; code only, no database change; to be merged together with step 3 so live staging never receives the new keys in raw form):
  - `-disco-site-contract.ts`: `PERSON_KEYS` / `LOCATION_KEYS` / `FIRM_KEYS` hold every key in sections 3a-3c (new: person first_name, last_name, headline, cover_photo_url, website, license_number / type / state, services, specialties, service_areas, year_started, booking_url, team, awards, disclaimer; location latitude, longitude, photo_url, timezone, gbp_place_id; firm legal_name, street, city, state, postal_code, description) plus the section-3d helper keys (`HELPER_IDS`).
  - `STATIC_FORMATS`: section-4 write format per static key (state / postal for address parts and licence state; credential / link / hours / member lists). The values are converted to these formats at write time in step 3.
  - `isIdentityId` = every non-helper section-3 key (replaces S4-0); `PERSON_IDENTITY_KEYS` is derived from it, so the extras "already static" check in `disco-ai-worker.ts` uses the full list.
  - JSON-LD paths for the new keys (givenName, familyName, award, areaServed, geo, legalName, firm address, firm description); name-style checks for first / last / legal name; state check for licence state; `firm.address_block` is split into firm street / city / state / postal code like the person and office blocks.
  - `disco-ai-worker.ts`: the locator prompt shows a one-line meaning next to ambiguous ids (`FIELD_MEANINGS`, wording from section 3).
- **Verified:** type check shows no new errors.
- **Not yet done / open:** step 2 (contract routes), step 3 (harvest writer in section-4 formats, section-5 order and quality rules). Version 2 of the mapper has no field learning yet, so static locators come from version 1 until that sub-step is approved. `field_floor` values will change because more keys count; re-measured after the remaps.

## Staging schema step 2: contract routes for empty static keys (2026-10-09)
- **What triggered this:** `docs/ETL-Staging-Data-Schema.md` section 5 (fill order 2 and 3) and section 9 step 2; owner approved the plain-language description (taxonomy → static by code, extra → static decided at mapping time and checked on real values).
- **Changes shipped** (commit `291a562`; code only, no database change; the routes live inside the existing site contract JSON; to be merged together with step 3):
  - `-disco-site-contract.ts`: `buildStaticRoutes` fills `site_contract.static_routes` for static ids that have no page rule.
    - (a) Taxonomy: keys with the same subject (after role overrides) and the same schema.org property, e.g. `image` → `person.photo_url`, `geo` → `location.latitude` / `longitude`, `address` → the address parts. Alias, classifier and single-item keys are skipped. When several keys qualify, all are saved; at harvest the value is copied only when their non-empty values agree.
    - (b) Extras: candidates come from an extra named like the static key (`services`), the extras matching call (new optional `static_id`, e.g. `focus_areas` → `person.services`), or the previous contract's route. A route is kept only when the static id is still open, the extra is kept, it has values on 2+ samples and every value passes the static key's own validation; one extra per static id. Rejected candidates and reasons go to `static_routes_dropped` (cap 40).
  - `disco-ai-worker.ts`: an extra named like an open static key is kept instead of dropped as `static`; an extra the locator call marked `static` is offered to the matching call and dropped as before when not routed. The matching call also runs when there are open static ids and no shared extra keys yet. Extras named like static keys are not written to the shared extra-key list.
- **Verified:** type check shows no new errors; a stand-alone run of `buildStaticRoutes` on test keys gave the expected routes (photo, geo parts, two phone keys kept together, address parts, extras by name / match) and rejected a second extra for the same id and an extra with too few values.
- **Not yet done / open:** routes are applied at harvest in step 3 (with the section-4 formats, section-5 order and quality rules; phones compared by their last 10 digits in the field count, as agreed).

## Staging schema step 3: static values written in the agreed formats (2026-10-09)
- **What triggered this:** `docs/ETL-Staging-Data-Schema.md` sections 4-5 and section 9 step 3; owner approved the description including (1) hours text that cannot be split kept as text items and (2) boilerplate flagged at mapping time, with the full-set check in the step-5 backfill.
- **Changes shipped** (commit `32e1645`; code only, no database change; merged together with steps 1-2):
  - `-disco-site-contract.ts` `buildStagingStatic`, called by `buildHarvestRecord`:
    - Fill order: page rule → taxonomy route (copied only when all routed keys agree) → extra route (value removed from `_extra`) → derived rules: post-nominals split off `person.name` into `person.credentials` ("Jane A. Doe, CFP®, CEPA" → "Jane A. Doe" + CFP, CEPA; "Jr.", "III" and surname-first names untouched); other text after the name ("…, First Vice President") goes to `person.job_title` when the page gave none; `person.years_experience` → `person.year_started` (harvest year minus N); licences / registrations → credential objects and `person.license_number / type / state`.
    - Formats: phone E.164 (`+13145550100`, extensions dropped), email lower case, URLs absolute https without tracking parameters, state 2-letter, postal 5 or 5-4, year, number, lists without duplicates (comma split only for credentials / services / specialties / languages), `credential {name, type, number, issuer, state}`, `link {platform, url}`, `hours {day, opens, closes}` (text that cannot be split kept as a text item), `member {name, role, license, photo_url}`.
    - Quality: a bio equal to the contract's boilerplate value becomes `person.headline` when it is a short tagline (else dropped); a bio made mostly of short lines is dropped; `person.website` / `person.booking_url` equal to the page, the site home page or the firm site are dropped; social links that are not links are dropped.
    - `payload._static_sources` records which static ids came from a route or a derived rule (metadata, not counted).
    - `countStagingFields` (record `filled` and the measured floor): phones compare by their last 10 digits; a value inside another key's list counts once.
    - Top-level `identity_candidates` fields (name, phone, city …) are unchanged.
  - `disco-ai-worker.ts`: `site_contract.boilerplate_values` — the primary subject's bio / description identical on 2+ sample pages and 60%+ of the pages that have it; the measured field floor uses the same code as the harvest.
- **Verified:** type check shows no new errors; stand-alone run on a test record gave the expected formats, routes, derived values and count; name split checked on real financial-advisor names from staging (multiple designations, "Jr.", "II", initials, nicknames, a title after the name).
- **Not yet done / open:** remap Edward Jones, Morgan Stanley and Schwab and run the section-9 acceptance checks; step 5 backfill (dry run first).

## Staging schema: person-level Google place id (2026-10-10)
- **What triggered this:** owner: real estate agents, loan officers and similar professionals now have their own Google Business Profile, so a professional-level key is needed next to `location.gbp_place_id`.
- **Changes shipped** (commit `72947e5`; code and schema doc, no database change; merged together with steps 1-3):
  - `docs/ETL-Staging-Data-Schema.md`: section 3a adds `person.gbp_place_id` (Station 6 `attributes.gbp_place_id` on the professional → `professionals.gbp_place_id`, which already exists; graph node `gbp_place {value}`); section 4 adds the `place_id` format, now also used by `location.gbp_place_id`.
  - `-disco-site-contract.ts`: `person.gbp_place_id` is a static key with its own meaning in the locator prompt (the person's own profile, not the office's). Both place ids are written only as a real place id (`ChIJ…`), read from the value or the `place_id` / `query_place_id` parameter of a Maps link; `cid=` and short `g.page` links are not converted (no lookup). When empty, the id is taken from a Maps link already in the same subject's social links.
- **Verified:** type check shows no new errors; stand-alone run: plain id and both Maps link forms read, `cid` / `g.page` links left empty, id taken from a Google link in social links.
- **Not yet done / open:** `organizations.gbp_cid` exists but there is no staging key for a CID (Maps `cid=` links); not added.

## Staging schema: calls to action for professionals and offices (2026-10-10)
- **What triggered this:** owner: every professional-related call to action ("Get a quote", "Book a demo" …) must be captured; only `person.booking_url` (one link, no text) existed, category action keys covered only registry-named buttons, and the extras step skipped buttons. Owner approved `person.actions` and `location.actions`.
- **Changes shipped** (commit `3e69eab`; code and schema doc, no database change; merged together with steps 1-3):
  - `docs/ETL-Staging-Data-Schema.md`: sections 3a / 3b add `person.actions` / `location.actions` (list of `action {label, url, type}`; Station 6 `attributes.actions`; no public column yet); section 4 adds the `action` shape; `person.booking_url` falls back to the first `book` action.
  - `-disco-site-contract.ts`: an actions rule reads every matched button / link with its text (aria-label, text, title) and link (href, data-href, form action), max 20; links are absolute https or `tel:` / `mailto:` / `sms:`. Every category action key (schema.org `potentialAction`) of the same subject is routed into the list (merged, labelled from the key name). Type by fixed rules on text and link (quote, demo, book, review, text, call, email, contact, other). Login / sign-up / careers / search / "find an advisor"-type links are dropped.
  - `disco-ai-worker.ts`: `site_contract.sitewide_actions` — actions with the same text and link on 2+ sample pages and 60%+ of the samples (site navigation), dropped at harvest.
- **Verified:** type check shows no new errors; stand-alone run on a test page: quote / call / text / demo buttons kept with types, login dropped, a site-wide "Contact us" dropped, a category booking key merged and used as `person.booking_url`.
- **Not yet done / open:** no publish column or graph node for the full list (only `booking_url` → `profile_attributes {cta_url}`).

## Calls to action: no duplicate call / text / email actions (2026-10-10)
- **What triggered this:** owner: a "Call Jane" / "Text me" action for the phone already captured is not needed.
- **Change shipped** (commit `77e5408`; code and schema doc section 4, no database change): a `tel:` / `sms:` action whose number (last 10 digits) equals any captured static phone or fax of the record (person, office, firm), and a `mailto:` action whose address equals a captured static email, is not kept in `person.actions` / `location.actions`. Actions for other numbers or addresses are kept.
- **Verified:** type check shows no new errors; stand-alone run: "Call Jane" / "Text me" (same number as `person.phone`) and "Email me" (same as `person.email`) dropped, "Text my assistant" (other number), "Get a Quote" and "Book a demo" kept.

## Staging schema: list keys merge all sources (2026-10-10)
- **What triggered this:** owner: multi-entry fields (products / services, awards, licences …) must keep every entry; a site's "Products" and "Services" sections should both go to services.
- **Change shipped** (commit `a5c7f70`; code and schema doc section 5, no database change):
  - `site_contract.static_routes` now holds a list of routes per static id. Single-value ids keep the section-5 order (page rule, then category keys that must agree, then one extra). List ids (`person.services`, specialties, awards, education, languages, service areas, credentials, social links, hours, team) merge the page values, every matching category key and every routed extra, duplicates removed.
  - Extras may feed a list id even when it already has a page rule, and several extras may feed the same list id; the extras matching call is told so. Routed extras are removed from `_extra` once their static id has a value.
- **Verified:** type check shows no new errors; stand-alone run: page services + a category services key + "Products" and "Focus areas" extras merged into `person.services` without duplicates; two disagreeing phone keys skipped and the phone taken from the extra route.

## Staging schema: comma splitting decided at mapping; awards and education as objects (2026-10-10)
- **What triggered this:** owner: separate `<li>` entries are separate entries; whether a site's comma-separated text holds several entries is decided by the AI while mapping; awards (and education) shown as structured blocks should be objects.
- **Changes shipped** (commit `c4f712a`; code and schema doc sections 3a and 4, no database change):
  - Rules (locator and extras) carry `split_commas`: the locator call sets it per field from the sample pages when each comma-separated part is a complete entry ("Life & Health, Property & Casualty" → two) and leaves it off when parts depend on each other ("Series 7, 63, 65" → one entry kept as shown). The split is applied when the rule is read; the fixed comma split by key at harvest is removed. Separate elements, line breaks, `;` and ` | ` still split.
  - Structured entry rules (`item_fields`: css of each part relative to the matched block) for `person.awards` → `award {title, year, issuer, description, url}` and `person.education` → `education {school, degree, year, text}`. Plain text awards → `title` plus `year` when exactly one year is shown; plain text education stays in `text` (school / degree not guessed).
  - Value comparison (clash, count) reads objects by their main text.
- **Verified:** type check shows no new errors; stand-alone run on a test page: "Life & Health, Property & Casualty" split into two with `split_commas`, "Series 7, 63, 65" kept as one, award blocks read as title / year / issuer / link, an education block as school / degree / year, plain awards "Five Star Wealth Manager, 2022" → title + 2022, "Top Advisor 2020, 2021, 2022" kept whole without a year.

## Staging schema: videos and gallery images (2026-10-10)
- **What triggered this:** owner: video URLs and gallery image URLs on a profile page must be collected; the site mapper captures videos it finds on the page.
- **Changes shipped** (commit `990a5ad`; code and schema doc sections 3a / 3b / 4, no database change):
  - New static keys `person.videos` / `location.videos` (list of `video {url, platform, title}`) and `person.gallery` / `location.gallery` (list of image URLs); Station 6 `attributes.videos` / `attributes.gallery`; no public slot yet.
  - Videos: the rule reads players and links (iframe / video / lite-youtube / data-video ids / links) and keeps known platforms with a canonical URL (YouTube, Vimeo, Wistia, Vidyard, Loom, video files). New mappings set `media_scan`, so the harvest also reads players embedded in the main content (never header / nav / footer / aside) when no rule gave any.
  - Gallery: the rule reads img src / lazy src / the largest srcset entry and links to image files; the headshot, cover photo and logos are excluded. Category image / photo keys named like a collection (gallery, photos, library, album …) feed the gallery (merged); other image keys still feed the photo.
  - `site_contract.sitewide_media`: a video or image on 2+ sample pages and 60%+ of the samples is site media and is dropped at harvest.
  - The category video keys stay with the "videos" lane (the site mapper still skips lane-owned keys); the page rule and the scan capture the videos instead.
- **Verified:** type check shows no new errors; stand-alone run: YouTube (embed, nocookie, lite-youtube) and Vimeo players in the main content read with canonical URLs and title, header / footer videos ignored, a site-wide Vimeo video dropped; gallery read from src / data-src / srcset / image link with the headshot excluded.

## Remap of Edward Jones, Morgan Stanley and Schwab with staging schema v1 (2026-10-10)
- **What triggered this:** section 9 plan: after steps 1-3 (merged in PR #36, deployed 2026-10-10 05:02 UTC) remap the three financial-advisor sources and run the acceptance checks. Owner approved queuing the remaps directly (the sources are `active`, so `disco_request_remap_site` refuses them) and switching cron 89 on only for the runs.
- **Live changes:** `disco_jobs` 96-98 and `disco_llm_requests` 143-145 (`map_site`, remap); cron 89 on at ~05:18 UTC, all three completed, cron 89 paused again (75-96 all inactive). The three `disco_site_contract` rows were overwritten (no history table); harvest crons stayed paused, nothing staged.
- **New contracts:** Edward Jones 33 static fields, floor 21 → 24; Morgan Stanley 28 fields, floor 19 → 26; Schwab 24 fields, floor 16 → 21. Routes: Edward Jones `person.actions` / `location.actions` / `location.hours` from category keys; none on Morgan Stanley / Schwab. Detail patterns still match 100% / 99.6% / 100% of the staged URLs.
- **Read-only harvest check:** 8 random staged URLs per source sent to `disco-harvest-worker` without a frontier id (pg_net 4020-4043; the worker only reads, nothing written). All 24 ok; names clean (no ®, no trailing parts); all phones E.164; 23 of 24 pass the gate (Schwab Shie Hadar: no city / state on the page).
- **Problems found:** Morgan Stanley `person.profile_url` taken from a booking link (6 of 8 missing / wrong); Edward Jones hours with seconds ("08:00:00") not split, so text and objects both kept; Morgan Stanley services carry footnote text ("Wealth ManagementFootnote1"); Morgan Stanley `focus_areas` / `designations` extras stayed in `_extra` (sticky extras are not offered to static routing); Edward Jones `firm.website` = the profile page and the site's own home page listed as a social link; Morgan Stanley `person.license_type` = the whole licence block; "Email Me" to a contact form typed `email`; Morgan Stanley `person.team` holds service tags; Morgan Stanley bio boilerplate ("Experience, intellectual capital …") on 4 of 8 and the same promo video on 4 of 8 not caught (mapping samples too few); Morgan Stanley longitude positive (117.27); Edward Jones bio still not mapped; Schwab bio holds the employment history.
- **Not yet done / open:** fixes for the problems above (proposed to the owner); acceptance on a full harvest; step 5 backfill.

## Staging schema: fixes from the remap check (2026-10-10)
- **What triggered this:** the read-only harvest check after the remap (entry above); owner: bio is required to publish, so keep it only when it is not generic site text (with a validation) and skip it when no real bio exists; coordinates must be in US format; fixes 1-8 as proposed.
- **Changes shipped** (commit `146488d`; code and schema doc section 5, no database change):
  - `person.bio` is kept only when it names the person, speaks as / about a person (I, my, we, our; he, she, they in 2+ sentences) or is a substantial text (200+ characters, 2+ sentences). Generic site text, site-wide (boilerplate) text and job-history lists (2+ year ranges) are skipped and no longer moved to `person.headline`.
  - US coordinates: latitude +, longitude − (Morgan Stanley gave +117.27), dropped when outside the US range.
  - `person.profile_url` is always the harvested page; a licence type longer than a label is replaced by the first licence's name; hours with seconds ("08:00:00") are split; list items ignore superscripts / footnote markers and screen-reader text; extras kept from the previous contract are offered to static routing (key unchanged); the firm website is never the profile page; social links never point back to the site; "Email Me" to a form is typed `contact`; an office action identical to a person action is dropped; the mapper's meaning of `person.team` now says people's names, not services or tags.
- **Verified:** type check shows no new errors; stand-alone run on the real cases: the Morgan Stanley generic bios and the Schwab job-history text rejected, two real Morgan Stanley bios kept; +117.27 → −117.27; booking link replaced by the page URL; licence block replaced by "CA Insurance License"; hours with seconds split; the site's own home page removed from social links.
- **Not yet done / open:** a Morgan Stanley remap so the routes (focus areas, designations) and the team meaning take effect; the same promo video on many Morgan Stanley pages is still only caught when it is on most mapping samples.

## Morgan Stanley remap with the fixes; team, licence type and firm route guards (2026-10-10)
- **What triggered this:** owner approved one Morgan Stanley remap after PR #37 (fixes from the remap check) was deployed.
- **Live changes:** `disco_jobs` 99 / `disco_llm_requests` 146 (`map_site` morganstanley.com); cron 89 on for the run (~05:58-06:03 UTC), then paused (75-96 all inactive). Contract overwritten: 30 static fields, floor 26 → 27; routes: `designations` → `person.credentials`, `crc_disclosure_number` → `person.disclaimer`, `employment_history_2` → `person.team`, `office_phone_direct_2_2` → `firm.fax`, `office_phone_direct_3` → `firm.phone_main`.
- **Read-only harvest check** (same 24 URLs, pg_net 4045-4068, nothing written): fixed — profile URL is the page on all 24; Edward Jones hours split per day without duplicates; Morgan Stanley services without footnote text; longitudes negative; generic bios skipped (Edward Jones and Schwab: no bio; Morgan Stanley: 2 real bios kept); firm website is the home page. Still wrong — Morgan Stanley `person.team` mixes real team members with service tags and menu entries ("Equity Solutions", "Wealth Management Home Page"); `person.license_type` read as a state code ("CA", "SC"); `firm.fax` / `firm.phone_main` routed from extras whose value changes per advisor.
- **Changes shipped** (commit `bdc7eb1`; code only, no database change): `person.team` drops entries that read as services, tags, titles or menu items (generic word check) and entries equal to the page's services / title; a licence type that is a bare state code is replaced by the first licence's name; an extra routed to a single-value firm key must hold the same value on every sample page.
- **Verified:** type check shows no new errors; stand-alone run on the Morgan Stanley team values: only the four people kept; "CA" → "CA Insurance License".
- **Not yet done / open:** the firm routes are decided at mapping, so they need one more Morgan Stanley remap after deploy; the same promo video on many Morgan Stanley pages.

## Second Morgan Stanley remap (firm route guard) and check (2026-10-10)
- **What triggered this:** PR #38 (team / licence type / firm route guards) deployed; owner approved one more Morgan Stanley remap.
- **Live changes:** `disco_jobs` 100 / `disco_llm_requests` 147; cron 89 on for the run (~06:23-06:28 UTC), then paused (75-96 all inactive). Contract overwritten: 30 static fields, floor 27. The two firm routes were refused (`differs_across_pages`); routes kept: `crc_disclosure_number` → `person.disclaimer`, `employment_history_2` → `person.team`.
- **Read-only harvest check** (same 24 URLs, pg_net 4070-4093, nothing written): 24 / 24 ok; all have name, profile URL and a phone; no phone outside E.164; no name with ® / ™ / comma; no positive longitude; 23 / 24 pass the gate (Schwab Shie Hadar has no city / state); 2 real bios (Morgan Stanley). Morgan Stanley team now holds only people with roles; no firm phone / fax from advisor extras. Still wrong: licence type "CA" / "SC" / "GA" on 3 Morgan Stanley records, taken back from a first licence named only by its state.
- **Change shipped** (commit `0318d4d`; code only): the licence type is never a bare state code, also when it comes from the first licence.
- **Not yet done / open:** the same promo video on many Morgan Stanley pages; acceptance on a full harvest; step 5 backfill.

## Licence named only by its state (2026-10-10)
- **What triggered this:** owner: when a licence shows only a state ("CA", "SC", "GA"), the licence type stays empty and the state is assigned.
- **Change shipped** (commit `8bdeae6`; code only): a credential whose text is only a state code and a number ("CA: 0M62418") is written as `{type: "license", number, state}` without a name; `person.license_type` stays empty, `person.license_state` / `person.license_number` are filled from it.
- **Verified:** type check shows no new errors; stand-alone run: "CA: 0M62418" → `{type: license, number: 0M62418, state: CA}`; "CA Insurance License #: 0M62418" unchanged.

## Staging schema step 5: backfill endpoint (2026-10-10)
- **What triggered this:** owner chose option C: backfill the existing financial-advisor rows from their own stored data now (dry run first, write only after approval), then re-harvest the three sources with the new contracts.
- **Change shipped** (commit `eacc11e`; code only, no database change): new route `/api/public/disco-staging-backfill` (worker key). For one source it reads up to 500 staging rows per call (by `stage_id`), rebuilds `identity_candidates.universal` from each row's own universal values, payload taxonomy keys and `_extra` with `buildStagingStatic` (the harvest code: section-5 order, section-4 formats, quality rules), and returns before / after counts per static key plus 2 examples. Routes: by schema.org meaning (registry + the rows' `_subjects`), the source's contract routes, and routes passed in the body (the agreed section-8 mapping, e.g. `focus_areas` → `person.services`). Boilerplate texts (bios shared by many rows) are passed in the body. `dry_run` is the default and writes nothing; `dry_run:false` upserts the batch (`payload._extra` without routed extras, `_static_sources`, new `universal`); top-level identity fields and other payload keys unchanged. Used instead of a SQL DO block so the same code path as the harvest is used (no second implementation in SQL).
- **Verified:** type check shows no new errors.
- **Not yet done / open:** dry run per source after deploy; real write after owner approval; re-harvest (option C, part 2) needs its own approval to switch the harvest crons on for the three sources.

## Step 5 backfill: first dry run and fixes (2026-10-10)
- **What triggered this:** dry run of `disco-staging-backfill` after PR #40 (pg_net 4094 test of 5 rows; 4095-4137 full run: Edward Jones 24 batches, Morgan Stanley 13, Schwab 6; all 43 ok; nothing written). Routes passed per source = the agreed section-8 mapping; boilerplate = bios repeated on 20+ rows of the same source (17 Morgan Stanley texts).
- **Before → after (rows with the key):**
  - Edward Jones (11,732 rows): person.services 0 → 9,964; person.team 0 → 10,690; person.credentials 21 → 7,660; person.photo_url 34 → 11,701; person.actions 0 → 11,687; location.hours 10,497 → 10,792; firm.website 11,732 → 34 (the stored value was the profile page); location.social_links 11,667 → 0 (address text); location.address_block (helper) 11,701 → 0; 28,300 extras moved out of `_extra`.
  - Morgan Stanley (6,169): person.bio 0 → 1,798 (generic / repeated bios skipped); person.photo_url 0 → 5,509; person.services 0 → 3,764; person.credentials 0 → 5,485; person.license_number 0 → 4,469; person.license_state 0 → 4,793; person.disclaimer 0 → 6,169; person.booking_url 0 → 922; person.team 0 → 1,511; location.latitude / longitude 0 → 6,169; person.profile_url 922 → 6,169; 26,642 extras moved.
  - Schwab (2,780): person.credentials 0 → 2,770; person.education 0 → 2,616; person.license_type 0 → 2,762; location.street 1,058 → 1,278; person.bio stays 0 (stored "bios" are job history); 5,386 extras moved.
- **Problems found:** Edward Jones `location.description` is the office panel (hours / phone text) on 11,687 rows; Schwab streets taken from the address object start with the branch name ("Rochester, 1250 …"); Edward Jones streets with a glued suite ("Ave WestSuite 212"); Morgan Stanley team built from mixed text could include the advisor's own name.
- **Changes shipped** (commit `c410a22`; code only): description / bio made of 3+ opening-hours entries dropped; street cleanup (space before a glued suite, leading branch name before the house number dropped); team excludes the person's own name.
- **Verified:** type check shows no new errors; stand-alone run on the three cases.
- **Not yet done / open:** second dry run after deploy, then the real write after owner approval.

## Step 5 backfill: second dry run (2026-10-10)
- **What triggered this:** dry run after PR #41 (pg_net 4138-4180; 43 / 43 ok; nothing written).
- **Result:** same counts as the first run except: Edward Jones `location.description` 11,687 → 1,213 (hours panels dropped); Morgan Stanley `person.team` 1,511 → 1,505 (advisor's own name removed); street cleanup applied.
- **Remaining:** the 1,213 Edward Jones descriptions are the same office panel in two other forms ("Mon By Appointment Only …" days, and a phone / fax / address panel).
- **Change shipped** (commit `c1487e5`; code only): the panel check also counts "By Appointment Only" / "Closed" day entries and drops text with 2+ contact labels (phone, fax, office / mailing address, email, office hours) and no real sentences.
- **Verified:** type check shows no new errors; stand-alone run: both panel forms dropped, real office / person text kept.
- **Not yet done / open:** real write after owner approval of the counts.

## Step 5 backfill: Schwab written (2026-10-10)
- **What triggered this:** owner approved the real write after the third dry run (pg_net 4181-4223: 43 / 43 ok; Edward Jones office descriptions 11,687 → 0, all other counts as in the second run).
- **Live change:** `disco-staging-backfill` with `dry_run:false` for schwab.com (pg_net 4224-4229, 6 batches, 2,780 rows written, no errors). Only `identity_candidates.universal`, `payload._extra` and `payload._static_sources` changed.
- **Verified in the table:** Schwab universal keys now: person.name 2,771, person.phone 2,773, person.profile_url 2,780, person.job_title 2,778, person.credentials 2,770, person.education 2,616, person.license_type 2,762, location.city / state / postal 2,428, location.street 1,278, location.phone 2,773, firm.* 2,778 — identical to the dry run.
- **Not yet done / open:** Morgan Stanley and Edward Jones writes (each needs its own explicit approval in this session).

## Step 5 backfill: Morgan Stanley and Edward Jones written (2026-10-10)
- **What triggered this:** owner approved the write for the two remaining sources.
- **Live change:** `disco-staging-backfill` `dry_run:false` (pg_net 4230-4266): Edward Jones 24 batches / 11,732 rows, Morgan Stanley 13 batches / 6,169 rows; all ok, no errors.
- **Verified in the table** (same as the dry run): Edward Jones person.services 9,964, person.team 10,690, person.credentials 7,660, person.photo_url 11,701, person.actions 11,687, location.hours 10,792, firm.website 34, location.description 0, location.social_links 0; Morgan Stanley person.bio 1,798, person.photo_url 5,509, person.services 3,764, person.credentials 5,485, person.license_number 4,469, person.license_state 4,793, person.disclaimer 6,169, person.booking_url 922, person.team 1,505, location.latitude / longitude 6,169, person.profile_url 6,169.
- **Acceptance checks (all three sources):** phones outside E.164: 0; names with ® / ™: 0 (the 15 names with a comma are "Jr." / "II" / "III" suffixes); rows with name + profile URL + a phone: Edward Jones 11,701 / 11,732, Morgan Stanley 6,164 / 6,169, Schwab 2,766 / 2,780 (the rest have no name or phone stored); the most repeated Morgan Stanley bio now appears on 10 rows (1,591 distinct). Routed extras left in `_extra`: 1,292 Morgan Stanley rows keep `nmls_number` / `insurance_license_number`, which there hold a 50-state "Securities Agent: AK, AL, …" list longer than a list entry allows — kept as extras, nothing lost.
- **Not yet done / open:** re-harvest of the three sources with the new contracts (option C, part 2; own approval); Station 6 (`exp_etl_resolve`) still reads only the keys it knew (step 4, out of scope here).

## Re-harvest prerequisites: every running source on the new schema (2026-10-10)
- **What triggered this:** read-only check before the re-harvest (option C, part 2): the shared fetch cron (90) serves every active source; compass.com (real estate agents) is active with 33,226 queued pages and a contract from 2026-10-05 (before the schema); 1,497 compass rows are staged (1,145 pending, 87 shallow, 265 created). Owner: every running job must use a contract with the new schema, and existing compass data must be cleaned up as well.
- **Facts recorded:** `exp_etl_stage_ingest` replaces only `pending` / `shallow` rows on a re-harvest; `created` rows are never touched (Edward Jones 4,453, Morgan Stanley 2,179, Schwab 1,787, compass 265 keep their backfilled data). Inactive sources with staged rows (statefarm.com insurance 19,376, remax.com 20) are not running and are out of scope.
- **Change shipped** (commit `5bd030d`; code only): bullet lists inside one text ("* Buyers Agent * Relocation", "• A • B") are split into entries (compass `focus_areas`).
- **Plan (each write needs its own approval):** 1) remap compass.com with the new schema; 2) read-only harvest check on 8 compass URLs; 3) compass backfill (dry run, then write); 4) re-harvest of the four active sources with crons 90 / 91 only.

## compass.com remapped with the new schema (2026-10-10)
- **What triggered this:** owner approved the compass remap (step 1 of the re-harvest prerequisites).
- **Live changes:** `disco_jobs` 101 / `disco_llm_requests` 148 (`map_site`, gcid:real_estate_agents); cron 89 on for the run (~08:42-08:47 UTC), then paused (75-96 all inactive). Contract overwritten: 20 static fields (bio, photo, credentials, specialties, service areas, actions, person address / phone / email, firm), floor 16 → 18; route: `headshot_library` → `person.gallery`; firm email from a per-agent extra refused (`differs_across_pages`). New detail pattern matches all 33,226 queued and 1,497 done compass profile URLs.
- **Read-only harvest check** (8 staged URLs, pg_net 4268-4275, nothing written): 8 / 8 ok, 7 pass the gate (one page has no name / address); real bios on 6, licences as credentials with state ("MO Licensed Real Estate Salesperson"), specialties, service areas, phones E.164. One wrong value: "ID Licensed Real Estate Salesperson" gave licence number "Licensed".
- **Change shipped** (commit `5620cce`; code only): a licence / registration number must hold a digit; a two-letter "ID:" / "ID#" is a label, not the state Idaho.
- **Not yet done / open:** compass backfill (dry run, then write); re-harvest.

## compass backfill: first dry run (2026-10-10)
- **What triggered this:** step 3 of the re-harvest prerequisites after PR #43 (pg_net 4276-4278, 3 batches, 1,497 rows, nothing written).
- **Before → after:** person.photo_url 0 → 1,406; person.services 0 → 602 (from `focus_areas`); person.name 1,413 → 1,460 and person.email 1,413 → 1,460 (from category keys); person.profile_url 1,413 → 1,497; phones converted to E.164; 602 extras moved.
- **Problem:** the stored `focus_areas` is one comma string ("Buyer's Agent, Listing Agent, Relocation, …") and kept as one entry; the new compass contract reads the same items as separate entries and as `person.specialties` (not services).
- **Change shipped** (commit `107da44`; code only): an extra route may carry `split_commas` (set per source when the site's own page lists the items separately, as the new compass contract shows), so stored comma text is split into entries.
- **Not yet done / open:** second dry run with `focus_areas` → `person.specialties` (split), then the write after approval.

## compass backfill: second dry run (2026-10-10)
- **What triggered this:** PR #44 (route `split_commas`) deployed; dry run with `focus_areas` → `person.specialties` split at commas (pg_net 4279-4281, 3 batches, 1,497 rows, nothing written).
- **Before → after:** person.specialties 0 → 663 (e.g. ["Buyer's Agent", "Listing Agent", "Relocation", "Short-Sale", "Property Management", "Landlord"]); person.photo_url 0 → 1,406; person.name / person.email 1,413 → 1,460; person.profile_url 1,413 → 1,497; person.credentials 0 → 6; phones E.164; 663 extras moved. Entries the site itself ran together stay one entry ("Consulting Accredited Luxury Home Specialist® (ALHS®) Real Estate Negotiation Expert …").
- **Not yet done / open:** write after owner approval; then the re-harvest of the four active sources.

## compass backfill written (2026-10-10)
- **What triggered this:** owner approved the compass.com backfill write.
- **Live change:** `disco-staging-backfill` `dry_run:false` for compass.com (pg_net 4282-4284, 3 batches, 1,497 rows written, no errors); route `focus_areas` → `person.specialties` with `split_commas`.
- **Verified in the table** (same as the dry run): person.specialties 663, person.photo_url 1,406, person.name / person.email 1,460, person.profile_url 1,497, person.phone 1,432 (E.164), person.credentials 6, firm.* 1,463.
- **Next:** re-harvest of the four active sources (own approval): re-queue 13,494 profile pages whose rows are pending / shallow (Edward Jones 7,279, Morgan Stanley 3,990, Schwab 993, compass 1,232) and the 6 Edward Jones pages stuck at `fetching`; already queued: compass 33,226, Edward Jones 7,746, Morgan Stanley 260; switch on crons 90 / 91 only.

## Re-harvest started for the four active sources (2026-10-10)
- **What triggered this:** owner: raise the quota to 10,000 per day and the delay to 5 seconds, and start the re-harvest.
- **Live changes:**
  - `exp_etl_sources` (edwardjones.com, morganstanley.com, schwab.com, compass.com): `daily_quota` 10,000, `min_delay_seconds` 5 (before: Edward Jones 10,000 / 10 s, Morgan Stanley 1,000 / 6 s, Schwab 10,000 / 10 s, compass 300 / 30 s). With 5 s the fetch tick sends at most 10 pages per site per minute; the overall cap stays 25 pages in flight.
  - `exp_etl_frontier`: 13,500 profile pages set back to `queued` (rows still pending / shallow: compass 1,232, Edward Jones 7,279 + 6 stuck at `fetching`, Morgan Stanley 3,990, Schwab 993). Already queued: compass 33,226, Edward Jones 7,746, Morgan Stanley 260.
  - Cron 90 (`etl-fetch-tick`) and 91 (`etl-fetch-collect`) switched on at ~09:30 UTC; 75-89 and 92-96 stay paused (no extraction, recon, resolve or mapping).
- **First check (5 minutes):** pages fetched from all four sources; 50 rows staged with the new mappings (e.g. compass rows with bio, credentials, licence state, specialties, service areas, actions); 3 Schwab rows shallow.
- **Rollback:** pause crons 90 / 91 (harvested rows keep the new data, the rest stays queued); quotas / delays back to the values above.

## Site mapper version 2: field learning behind the discovered profile pages (2026-10-10)
- **What triggered this:** owner chose the next v2 step: wire the current mapper's field learner behind version 2's discovered profile pages, still dry run, and compare with the current contracts of the four active sources.
- **Change shipped** (commit `e8c4e55`; code only, no database change):
  - `disco-ai-worker.ts` dry run accepts `profile_urls` (same site only, up to 60): they come first as profile candidates (the first 3 pinned, so they do not use up regular tries) and at the front of the sample / rule pool. Without `profile_urls` nothing changes; the live drain path is untouched.
  - `disco-agent-mapper.ts` returns `profile_urls` (the validated sample profile URLs) on a finished run; with `learn_fields: true` it calls the disco-ai-worker dry run with them and returns that contract as `field_learning`. Both steps only read.
- **Verified:** type check shows no new errors.
- **Not yet done / open:** dry runs on edwardjones.com, morganstanley.com, schwab.com and compass.com after deploy, compared with their current contracts (fields, field floor, routes, profile pattern).

## NORA skill run log table (2026-10-11)
- **What triggered this:** increment 1 of the NORA executor: a lasting record of real and simulated skill runs for the Nora OS Runs tab and the verify / learn loop.
- **What changed:** new table `exp_skill_run` (migration `20261011120000_nora_skill_run_log.sql`): skill key / version, capability keys, entity ref / type, mode (`dry_run` / `live`), status (`planned` / `running` / `blocked` / `succeeded` / `failed` / `cancelled`), trigger, verdict, trace, inputs, outputs, telemetry, graph writes, expected SRS lift, actual SRS delta (filled by a later verification pass), error, actor, timings. Indexes on skill_key, entity_ref, status, created_at desc. RLS on with one policy for all actions by signed-in users (same as `exp_nora_state` / `exp_skill_registry`).
- **Verified:** the table already exists in the live database (`to_regclass('public.exp_skill_run')` returns it); the migration file is now in the repo.
- **Not yet done / open:** the migration has no explicit GRANT statements; nothing in the app writes to or reads the table yet (Runs tab still shows the ETL monitor).

## NORA OS tables back-committed to the repo (2026-10-11)
- **What triggered this:** NORA queue #12: reconcile repo and database drift for the NORA OS tables.
- **What was wrong:** eight live tables had no migration in `supabase/migrations/` or `drizzle/migrations/`: `exp_skill_registry` (41 columns), `exp_capability_registry` (18), `exp_skill_version` (8), `exp_skill_eval` (9), `exp_nora_state` (9), `exp_nora_weights` (3), `exp_build_map` (11), `exp_opportunity_feedback` (10). Evidence: a search of both migration folders finds them only in a comment of `20261011120000_nora_skill_run_log.sql`; `pg_class` lists all eight. No other `exp_skill_*` / `exp_nora_*` / `exp_capability_*` table is live without a migration (`exp_skill_run` is covered by that file).
- **What changed:** migration `drizzle/migrations/0017_backcommit_nora_os_tables.sql` (+ journal entry 17), built from the live catalog: every column with its type, null-ness and default; primary keys and the two unique `key` constraints; indexes `idx_skillver`, `idx_skilleval`, `idx_oppfb_entity`; RLS on; one policy per table for all actions by signed-in users (`Staff all skill`, `Staff all cap`, `Staff all skillver`, `Staff all skilleval`, `Staff all norastate`, `Staff all noraweights`, `Staff all buildmap`, `Staff all oppfb`); the grants the tables have today (all rights to anon / authenticated / service_role, read + insert to `sandbox_exec` when that role exists). Live has no check or foreign-key constraints, no triggers, no comments. Everything is "if not exists" or created only when missing, so the file changes nothing in the live database; nothing is dropped. Not applied.
- **Verified** (read-only, queries in the migration header): column count, not-null count, default count, index count, policy count and RLS match for all eight; the full column list (name, type, null-ness, default, in order) matches for all eight; constraints 10 / 10, indexes 3 / 3, policies 8 / 8, no triggers.
- **Not yet done / open:** no drizzle snapshot (`meta/0017_snapshot.json`) and no `drizzle/schema.ts` models for these tables; `skill_key` in `exp_skill_version` / `exp_skill_eval` has no foreign key to `exp_skill_registry` (as live); anon keeps full table rights (RLS still blocks it, as live).

## Live search projection replaces the 2026-09-09 snapshot (2026-10-11)
- **What triggered this:** sprint item "Live search projection (replace 2026-09-09 snapshot) + demo filter + languages". All 39,464 `search_documents` rows were loaded once on 2026-09-09 and nothing kept them in sync: `completeness_pct` null everywhere, rating / claimed ~0, `languages` empty, geo on 611 rows, 106 demo rows served publicly, 8,845 pro photos already stale, 50 State Farm offices missing.
- **What changed** (migration `drizzle/migrations/0023_search_projection.sql` + journal entry 23; not applied): same table, same RPCs, no new index.
  - `exp_search_projection(uuid[])` (read-only) computes the row each entity should have; `exp_search_project(uuid[])` upserts it on (entity_type, entity_id), skips rows that did not change, and deletes rows whose entity is gone or inactive. NULL = every entity, new ones included.
  - Completeness is a port of `completeness()` in `src/lib/profile-render.ts`: template (gcid, lane) → ('default', lane) → built-in; pct = round(100 × required sections present / required); each section's test reads the same inputs as the renderer (core columns, office, active graph nodes, aggregate_ratings 'all', reviews, credentials, content / VOCE, media, top-40 category taxonomy, staff, child orgs).
  - Rank: `search_rank_scores` row (v5) → `total_score`, `score_basis` 'v5'; else the `exp_provisional_score_tick` formula, 'provisional'.
  - Rating: aggregate_ratings 'all' → weighted mean of sources → reviews. Languages: `professionals.languages`, else graph language nodes; also added to `fts`. Pro geo: office, else graph geo node.
  - Sync: `exp_search_dirty` queue; statement-level triggers (transition tables) on professionals, organizations, aggregate_ratings, reviews, graph_nodes, search_rank_scores, credentials; `exp_search_project_tick(2000)` drains it; `exp_search_job_install()` installs cron `search-project-tick` inactive (not called).
  - `search_docs` / `_count` / `_facets` / `_suggest`: live bodies unchanged plus `and not coalesce(is_demo,false)`.
- **Expected after backfill** (read-only run of the projection over all 39,514 entities, 22 s): pros 19,221 at 75 % (hero, coverage, credentials; no reviews yet), geo 19,217, languages 19,221 (Spanish 7,524); SF offices 60–80 % (staff + map where geo); rank_score 0 → 100–323; demo rows hidden from search.
- **Backfill plan:** apply; `select exp_search_backfill_enqueue();` (~39.5k ids); run `select exp_search_project_tick(2000);` about 20 times (a few seconds each) or install and activate the cron job.
- **Not yet done / open:** apply + backfill; v5 is out of 850 while provisional can reach 1,000; template changes (`exp_category_page_template`) and taxonomy changes need a re-enqueue (no trigger); no language filter in the search RPCs yet (signatures kept).

## NORA "organize the internet" source layer reuses the ETL fetch and parse code (2026-10-11)
- **What triggered this:** NORA interview step 2 ("organize the internet") needs to fetch the entity's site, its other owned properties, Google Business Profile and an open-web sweep. Rule: reuse the ETL fetch / parse code, never fork it.
- **What changed (ETL code):** `disco-webscraper-worker.ts` — `oxylabsRaw` is now exported (one word; behaviour unchanged) so the web sweep can send an Oxylabs `google_search` query through the same client and credentials. No other disco-* file changed.
- **What uses it (new, outside the ETL):** `src/lib/nora/organize/` — `fetchSite` / `hop2` call `scrapeWebsite` (crawl_method `direct`: a plain fetch only when `FORCE_PROXY=false`, otherwise Oxylabs as today) and parse with `-disco-site-contract.ts` (`parseDocument`, `extractJsonLdBlocks`, `collectAllSameAsUrls`, `collectAllCredentialTexts`, `normalizeAddress`, `validateValue`, `toE164`, `toPlaceId`, `toCredential`, `formatUrl`), `looksBlocked`, `SAMEAS_PLATFORM_RULES` and `classifyCredential`. Registered as NORA capabilities `page_fetch`, `source_crawl`, `serp_fetch`, `geocode` in `src/lib/nora-capabilities.server.ts`. Read-only toward the database.
- **Verified:** `tests/nora-organize.test.ts` against two saved real pages (State Farm agent page, Lupe Tortilla home page); one live plain fetch (FORCE_PROXY=false) of the State Farm page and its hop to gregaldridgesf.com returned NAP and the place id.
- **Not yet done / open:** Oxylabs unit costs in `organize/costs.ts` are list-rate estimates; the runner's 15 s capability timeout is shorter than Oxylabs' 60 s / 180 s (render) timeouts, so a slow proxied fetch can time out in a NORA run.

## Category-aware extractor + governed graph upsert (2026-10-11)
- **What triggered this:** NORA wave 2 (W2-5): turn the organize step's page facts into graph facts for any category, and protect owner-confirmed facts from the ETL writers.
- **Extractor** (`src/lib/nora/extract/`, no per-category code — everything comes from the category brief):
  - Input: `CandidateFacts` per page exactly as `src/lib/nora/organize/types.ts` (branch `nora-os/organize-sources`, commit `e4739cc`) defines it — `jsonld[]`, `nap {name, address{text,…}, phone}`, `sameAs[] {url, platform, via}`, `credentials[] {text, parsed, label, via}`, `text[] {kind, text}`, `blocked`, … — mirrored structurally in `extract/types.ts` until both branches are on main; the capability reads `page_fetch.facts` and `source_crawl.pages[].facts` from earlier steps of the run. Blocked pages never go to the model.
  - Deterministic first: JSON-LD properties → registry nodes by `schema_property` (with schema.org sibling chains, e.g. a `MenuItem` files under `menu` / `hasMenu`); `sameAs` → presence nodes by host vs. node name; credentials → `hasCredential` nodes + the brief's credential id key; NAP → identity nodes. A list item that matches no node name keeps `registry_node_id` null rather than being guessed onto one.
  - Then one Haiku call per page (`claude-haiku-5-5`, structured output, effort low) only for page-observable collections (connection method `manual` / `etl`) the deterministic pass left empty, asking only for those collection keys with cardinality, expected count and vocabulary. Every item must quote page text: evidence not found verbatim, or a name outside its evidence, is dropped; prices / sections / details not on the page are nulled. Dry runs never call the model.
  - Output `ProposedNode[]` (registry node id / slug, generic `node_type` such as `product_service` / `menu_item` / `credential` / `social_profile`, schema property, ring, value, evidence, confidence, method, cardinality group + vocabulary term) and `conflicts[]` (single-valued nodes with more than one value, e.g. two phones; never written until resolved).
- **Migration `drizzle/migrations/0022_graph_upsert.sql`** (+ journal entry 22; additive, idempotent; **not applied**):
  - `graph_nodes.trust_tier` (check `self_declared | imported | platform_observed | authority_verified | owner_verified`, NULL on legacy rows) and `graph_nodes.value_hash`; partial unique index `graph_nodes_upsert_key` on (entity_type, entity_id, coalesce(node_registry_id, node_type), value_hash) where value_hash is not null (legacy rows untouched).
  - `exp_graph_upsert_nodes(p_entity_type, p_entity_id, p_nodes jsonb, p_source, p_trust)`: SECURITY DEFINER; service role, `super_admin` / `architect`, or the entity's owner (`professionals.user_id`, or an active `professional_org_memberships` row for organizations); owners may only write `self_declared` / `owner_verified`. Idempotent upsert that sets `node_registry_id` (by id or gcid + slug), source, source_url, fetched_at, verified / verified_by (`owner:<uid>` for owner_verified), keeps the brief ring only when `exp_ring` knows it (else the ring autofill trigger decides), and never lowers trust (a higher-trust row is kept). EXECUTE revoked from PUBLIC / anon.
  - Firewall trigger `trg_graph_nodes_owner_firewall` (mirrors `exp_etl_guard_claimed`): rows with source `user` / `oauth` or trust `owner_verified` cannot be deleted or have fact columns changed except through the governed writer, and never when `exp.actor = 'etl'`. Blocked rows are skipped with a NOTICE (not raised) so `replaceEtlNodes` / `exp_sf_nodalize` DELETE + reinsert batches keep running; scoring / ring columns stay writable.
- **Capabilities** (`nora-capabilities.server.ts`, registry keys `nlp_extract` and `graph_upsert`): `nlp_extract` is read-only (dry run deterministic only); `graph_upsert` is live only, writes through the RPC (default source `platform`, trust `self_declared`) and holds conflicts back.
- **Brief change:** `exp_vertical_node_registry.id` is now read into the brief (`BriefNode.nodeId`) so writes can set `node_registry_id`.
- **Verified:** brief fixtures captured read-only for `gcid:insurance_agency` and `gcid:mexican_restaurant`; tests (`tests/nora-extract.test.ts`) show a State Farm agent's products in one `few` "Coverage & products" collection matched to the vocabulary (Boat → "boat and marine insurance", Pet → "pet insurance"; an invented item rejected; two phones → conflict) and a Mexican restaurant's JSON-LD menu in one `many` "Menu" collection with price + section and no model call.
- **Not yet done / open:** organize's `textBlocks()` drops `p`/`li` text under 20 characters, which is where short product / menu lines usually live, so the Haiku pass would not see them on real pages (raise with the organize owner); the mirrored `CandidateFacts` type should become a re-export after merge; migration not applied (needs owner approval); no local Postgres here, so the SQL was reviewed but not executed; legacy ETL rows (value_hash NULL) are not deduplicated against by the governed writer; the resolve-conflicts step and live Haiku run against a real page are untested; Claude is called with raw fetch (no SDK dependency), like the rest of the repo.

## Search Rank Score v5 engine: explain + persist (2026-10-11)
- **What triggered this:** NORA sprint item "v5 scorer: exp_score_explain (read-only) + exp_score_persist": build the 10-lane score exactly as the "10-LANE MATH VIEW v5 · 2026-08-17" spec on the Scoring tab. The old scorers count lanes on graph ring numbers 5 / 6 / 7 that no node has, and on `score_counted`, which is false on every ingested node.
- **What changed** (migration `drizzle/migrations/0020_score_v5.sql` + journal entry 20; not applied):
  - `exp_score_v5_explain(entity_id, entity_type)`: read-only (STABLE), one SQL statement. Returns total, the 10 lanes (score, components, inputs) and gaps `{lane, ring_key, registry_node_id, node_type, label, status, marginal_pts, is_core, evidence_source}` sorted by points. Each lane formula is written once and also run with each gap filled, so a gap's points come from the same math as the score.
  - Inputs: graph nodes by `ring_key` / `node_type` / `schema_property` / `node_registry_id`; registry rows (`counts_toward_m`, `required_for_score`, `requires_verification`, `entity_scope`, `owns_lane`); the category's EAR / EAA / EAQ / EAV / completeness rows (pro vs location values); reviews, aggregate_ratings, listings, oauth_connections, credentials, exp_voce_article, exp_category_directory_map + exp_directory_packs.
  - `exp_score_v5_persist(entity_id, entity_type)`: runs explain, upserts `search_rank_scores` (old columns filled from the lanes; `gaps` = the v5 gaps) and today's `score_history` row. It does not write professionals / search_documents. Only service_role, a postgres session, or super_admin / architect may run it; anon and PUBLIC have no execute right.
  - `exp_compute_score`, `exp_compute_score_v2`, `exp_provisional_score_tick` are untouched.
  - `src/lib/seat.ts`: next moves now read the v5 gap shape (label, marginal_pts, lane) and still read old v1 / v2 rows (`action`, `gap` as a number), which were dropped before. Test `tests/seat-next-moves.test.ts`.
- **Verified** (read-only: the explain body run as a SELECT for 7 entities; numbers in the migration footer): Greg Aldridge (State Farm) 2.45 (Completeness only: 35 nodes / M 611, core 8 of 34, 3 licences not verified); NAF loan officer 73.54 (Reviews 51.50, Completeness 21.00, Connections 1.04); NAF Bettendorf office 38.14; NAF enterprise 39.52; State Farm office 0.01; real-estate pro with no nodes 0.
- **Not yet done / open:** apply the migration and run persist (no batch / cron yet); the Website lane needs the crawler to write `site_audit` on the website node; nothing in the database today has listings, OAuth connections, or article / video / audio / Q&A nodes, so those lanes are 0 everywhere; review graph nodes are mostly undated (2,601 of 2,606), so only the reviews table feeds the 12-month window; cutover of professionals / search_documents is a later step.

## Listings catalogs moved from code into the listings tables (2026-10-11)
- **What triggered this:** sprint item "Move 12 channel catalogs from code into exp_listings_field_map/publishers".
- **What was wrong:** `exp_listings_publishers` had 3 rows (data_axle, foursquare, google) and `exp_listings_field_map` 30 older Google-only rows; the full catalogs for 12 publishers (169 rows: 105 mapped, 44 pipeline, 7 missing_ours, 13 na) existed only as constants in `src/components/listings-tab.tsx`.
- **What changed:** migration `drizzle/migrations/0026_listings_catalog_db.sql` (+ journal entry 26), generated by `tools/listings/emit_catalog_sql.ts`. New columns on `exp_listings_publishers`: subtitle, display_sort, channel_role (check: direct / distribution / verify_only / hub / candidate), role_status (proposed / ruled), auth_model, write_path, read_path, sandbox, notes. New columns on `exp_listings_field_map`: catalog_version, writable, required, api_field_path, rule_spec (jsonb), notes, plus a partial unique index on (publisher_id, catalog_version, section, their_field). Seeds 12 publishers (channel_role = the proposed 4 direct + 4 distribution split, role_status 'proposed') and 169 field rows; the 30 older rows are tagged `legacy_2026_07_09`. Existing columns are reused (their_field, our_target, status_default, rules), not duplicated. Only the new columns are updated on conflict; the one exception is `ops_notes`, which is filled only where the live value is `[]` or NULL. Not applied.
- **Verified:** the test `tests/listings-catalog.test.ts` reads the seeded rows back through the console's loader and they match the old constants exactly; the committed SQL matches the generator output; bun test passes.
- **Not yet done / open:** apply 0026; Scott to rule the channel roles (a data update); the gate-fix proposals in `tools/listings/gate_fix_proposals.sql` (9 untyped gcids, 19 gcids missing family status, the 'brand' / 'brands' family mismatch) are waiting for his rulings.

## Category proposals table and first deterministic cleanup batch (2026-10-11)
- **What triggered this:** Wave-2 W2-8 (Model Enrichment): category data may only change through proposals → human sample review → snapshot → apply → ledger, additive only. Sprint item "Proposals table + deterministic cleanup pass".
- **What changed (code only, nothing applied):**
  - Migration `drizzle/migrations/0025_category_proposals.sql` (+ journal entry 25): table `exp_category_proposals` (batch, gcid → `gbp_categories`, lane, target_table, target_key, op add/retire/rescope/relabel/merge/set, payload, before, rationale, rule, state pending/approved/rejected/applied/failed/superseded, created/reviewed/applied fields, error) with one open proposal per target (partial unique index). RLS: read for control staff (super_admin / architect / analyst); no direct writes except service_role; anon / PUBLIC revoked.
  - `exp_category_proposal_review(batch, ids, approve, note, reviewer)` — super_admin / architect when signed in; from a service session the human reviewer (scott / abdul) must be named.
  - `exp_category_proposal_apply(batch, max_gcids)` — approved rows only, per gcid: `exp_engine_snapshot(gcid)`, ops applied with a stale-write guard against `before` (retire = `is_active=false`, never DELETE), one `exp_curation_ledger` row per op with `ruled_by` = reviewer, then `exp_validate_category_full(gcid)`; any error or any newly failing check code rolls that gcid back and marks its proposals `failed`. add / merge and tables other than taxonomy / registry / knowledge are rejected (→ failed) until implemented.
  - Detectors `tools/enrichment/detect/*.sql` (read-only) and `tools/enrichment/propose.ts` (validates, dedupes, writes `out/proposals_det-20261011-1.{json,insert.sql}` and `out/review_batch_1.md`). Does not reuse `tools/batch_generate/process_results.stage`.
- **Live counts (2026-10-11):** T2 gbp jargon 257 rows / 13 categories → retire. T3 slots 131 rows: 18 geo-synonym relabels, 4 retired as duplicates of the relabel, 91 entity-slot retires, 18 templated aliases retired. T5 questions without "?" 2,480 → relabel (the one with `{country}` goes to T3). K1 invalid `schema_action` 233 elements / 162 categories → set (all targets checked in `exp_schemaorg_types`). R2 Occupation.hasOccupation 404 → 383 set to Person, 21 retired (Person node already present). R3 insurance_agent shared "Google Review Count" → retire (location node kept). Total 3,506 proposals.
- **Not yet done / open:** migration not applied; proposals not inserted (waiting on Scott's review of `review_batch_1.md`); `exp_engine_snapshot` covers registry / taxonomy / knowledge / compliance / ui_config only (score priors / directories would need it extended before those lanes can apply); validation regression is judged by check code, not detail.

---

## 2026-10-11 — Live search projection APPLIED to production (migration 0023)

**Triggered by:** Scott approved applying PR #53 ("yes, apply search").

**What was wrong (live evidence):** all 39,464 `search_documents` rows were a one-time 2026-09-09 snapshot — `completeness_pct` null on every row, languages empty, geo on 611 rows, `rank_score` 0 almost everywhere, and 106 demo rows visible in public search.

**What changed (applied by Claude via the Lovable DB connector, 2026-10-11):**
- Backup first: `zz_backup_search_documents_20261011` (39,464 rows, RLS on, revoked from anon/authenticated).
- Part 1: `exp_search_num`, `exp_search_completeness_pct`, `exp_search_projection`, `exp_search_project` (full rebuilds never delete; targeted runs only).
- Part 2: `exp_search_dirty` queue + 21 statement-level triggers (`trg_search_dirty_{ins,upd,del}_*` on professionals, organizations, aggregate_ratings, reviews, graph_nodes, search_rank_scores, credentials); `exp_search_project_tick`, `exp_search_backfill_enqueue`, `exp_search_job_install` (cron NOT installed).
- Part 3: `search_docs`, `search_docs_count`, `search_docs_facets`, `search_docs_suggest` — live bodies + `and not coalesce(is_demo,false)`.
- Backfill: 39,514 entities queued and drained in 7 ticks (2k/5k/8k/10k/10k/10k/4.5k); 0 deleted.
- Not recorded in `drizzle.__drizzle_migrations` (Lovable does not apply GitHub-merged drizzle migrations; applied manually).

**Verified:**
- 39,514 rows now (39,464 before + 50 State Farm offices that had no row); 0 rows lost vs backup (JOIN on id).
- completeness on 39,514; geo on 19,878; languages on 19,221 (Spanish 7,524); rank_score > 0 on all; basis provisional 39,511 / v5 3.
- Public count excludes demo: `search_docs_count()` = 39,358 (106 demo hidden).
- Live site: `/find?q=spanish&loc=TX` returns 1,239 State Farm agents with 75% completeness and rank 188.
- Spot check: Joe Read 0 → 188, English/Spanish, geo filled.

**Still open:** every State Farm professional currently ranks 188 (provisional formula; v5 scorer 0020 not applied) — no differentiation until v5 lands; duplicate agent rows from the State Farm source (e.g. same name, multiple offices) appear separately; cron for `exp_search_project_tick` not installed (triggers fill the queue; drain manually or install the job); template/taxonomy edits need manual re-enqueue.

---

## 2026-10-11 — Batches 1–4 APPLIED to production (0018, 0025, 0026, 0022, 0027 ⊇ 0020, 0021)

**Triggered by:** Scott approved "yes all 4" (credentials, enrichment proposals, listings catalog / graph writer / score v5 + single-pro / claim gate). Applied by Claude via the Lovable DB connector, one file at a time, verification after each. Lovable does not apply GitHub-merged drizzle migrations, so none are recorded in `drizzle.__drizzle_migrations`.

**Backups (RLS on, revoked from anon/authenticated):** `zz_backup_exp_listings_publishers_20261011b` (3), `zz_backup_exp_listings_field_map_20261011b` (30), `zz_backup_exp_claim_20261011b` (260), `zz_backup_claim_queue_20261011b` (90), `zz_backup_exp_claim_events_20261011b` (3,474), `zz_backup_exp_verification_requests_20261011b` (1), `zz_backup_exp_control_grants_20261011b` (15), `zz_backup_exp_skill_registry_20261011b`, `zz_backup_exp_capability_registry_20261011b`, `zz_backup_exp_entity_keys_20261011b` (50,431: entity_id, identity_keys, claim_state, updated_at), `zz_backup_functions_20261011b` (prior `exp_claim_adjudicate` def, `exp_outbox` policy, two status CHECK constraints). graph_nodes snapshot recorded instead of copied: 554,040 rows (etl 551,176 / platform 2,864), all active, 5 triggers.

**Batch 1 — 0018 / 0025 / 0026:** `exp_integration_settings` (3 rows, all `stub`). `exp_category_proposals` + review/apply functions (0 rows; anon cannot execute). Listings: 9 publisher columns + 2 CHECKs, 6 field-map columns + partial unique index; 30 legacy Google rows tagged `legacy_2026_07_09` (all 30 + 3 publishers kept — JOIN-verified); 12 publishers seeded (channel_role proposed: direct google/apple/bing/meta; distribution data_axle/foursquare/localeze/here; candidate linkedin/tomtom/yelp/nextdoor); 169 field rows exactly as generated (mapped 105 / missing_ours 7 / na 13 / pipeline 44).

**Batch 2 — 0022:** `graph_nodes.trust_tier` + `value_hash` (+ CHECK, partial unique index), `exp_trust_rank`, `exp_graph_node_is_protected`, owner firewall trigger `trg_graph_nodes_owner_firewall`, `exp_graph_upsert_nodes` (anon revoked). Verified: 554,040 rows unchanged, 0 rows touched, 6 triggers incl. search-dirty triggers.

**Batch 3 — 0027 (contains 0020's functions + single-pro changes; applying 0027 alone gives the identical end state):** `exp_office_mode`, `exp_score_v5_explain`, `exp_score_v5_persist` (anon revoked on both). Persist NOT run — `search_rank_scores` still 3 rows. Read-only check: Greg Aldridge → `single_pro`, location 6b253049…; v5 total 2.45 (completeness only), listings read from the office; top gaps GBP +68, Apple/Bing/Experience.com/Facebook/Waze +15 each.

**Batch 4 — 0021 (with single-pro patch):** claim tier columns + indexes; widened `claim_queue` / `exp_verification_requests` status CHECKs (existing statuses approved/pending and pending still valid); `exp_outbox` policy now hides `claim_otp` rows; 260 legacy verified claims → trust_tier 2 (`legacy_verified`); **19,726 exp_entity rows linked** via `identity_keys.professional_id` (State Farm URL match); 18 claim-gate functions; anon can execute none; 5 capabilities registered; 6 claim skills published 1.0.0. Row counts unchanged: claims 260, queue 90, events 3,474, grants 15.

**Still open:** PR #58 (claim gate code) can now merge — merge #62 first (it is contained in #58). Indexing 0024 (#56) and category cardinality 0019 not applied. v5 persist not yet run for any entity (needs Scott's go-ahead: it changes search order once projected). 557 professionals have 2+ exp_entity rows (resolver picks claimed → pending → oldest). OTP sending needs `sendgrid_api_key`; Place ID path needs Google Business Profile credentials.

## Single-professional office: act as the professional, list as the location (2026-10-11)
- **What triggered this:** Scott's rule of 2026-10-11 (also in `docs/SRP_Foundation_Plain.md` §3) and sprint item "Single-professional office: act as professional, list as location". The rule covers categories that support both professionals and locations: `gbp_categories.supports_single_pro_office` and `exp_category_shape.allowed_entity_types` ⊇ {professional, location}, which is 404 categories (the two sets are identical). In those categories, an office with exactly one active professional is handled as that professional: identity, claim, NORA interview, licence key, public profile, "Name – Brand" title. Listings (GBP / Place ID, directories, NAP) map to the location.
- **What was wrong (live evidence, read-only):** 18,771 offices are single-pro today: 18,769 `gcid:insurance_agency` and 2 `gcid:mortgage_broker`. Nothing applied the rule:
  - the v5 scorer read GBP and Directories from the professional;
  - the listings dashboard and the professional seat read `listings` keyed to the professional;
  - `organizations.is_single_pro_office` is false on every row, so the flag is unmaintained.
  
  Place IDs for these offices are on the office row for 353 offices and only on the professional for 9,546. No pair conflicts. There are 0 listings rows.
- **What changed:**
  - **Migration `drizzle/migrations/0027_single_pro_office.sql`** (+ journal entry 27; additive; **not applied**; requires 0020).
    - `exp_office_mode(p_entity_type, p_entity_id)`: the one shared resolver. It returns `{mode: single_pro | multi_pro | location_only | professional_only | not_found, professional_id, location_id, pro_count, gcid, supports_single_pro_office, reason}`. It branches only on the two category columns and on counts of active professionals (`professionals.primary_org_id`, `organizations.entity_type = 'office'`). It never branches on a gcid, and it does not read the stale flag.
    - `CREATE OR REPLACE` of `exp_score_v5_explain`: a copy of the 0020 body with only the marked `-- 0027:` lines changed. In single_pro mode the scored subject is the professional, and only the GBP lane (Place ID and `gbp_connected` from the location, the professional's Place ID as fallback, Google OAuth on either record) and the Directories lane (listings of the location) read the location. Scoring the location of a single-pro office returns the same combined score. The output adds `scored_entity`, `listing_entity` and `office_mode`. Every other mode behaves as in 0020.
    - `CREATE OR REPLACE` of `exp_score_v5_persist`: writes the combined row for the professional and **mirrors** the same total, lanes and gaps onto the location in `search_rank_scores` and `score_history`. This was chosen so nothing keyed on the office shows a stale or divergent score.
  - **TypeScript:**
    - `src/lib/office-mode.ts`: result type, parser and an `rpc` loader. It returns null while 0027 is unapplied, so callers keep today's behaviour. It does not re-implement the decision.
    - `entityBriefForOffice()` in `src/lib/category-brief.ts`: in single_pro mode it returns the professional's form fields and claim keys, plus the location's NAP keys and its `location`-ring listing collections. The choice is by ring, never by category.
    - `src/lib/listings/subject.ts`: `listingSubject()` and `listingNap()`. The NAP comes from the location, with a per-field fallback to the professional; the listing name is never the "Name – Brand" title.
    - Wired into `dashboard.listings.tsx` and `seat.ts` `loadProfessionalSeat`, which now read the location's listings in single_pro mode.
  - **Claim gate (branch `nora-os/claim-gate`, not on main):** exact diffs are in `tools/single_pro/claim_gate_patch.md`. With the patch, the claim acts as the professional (licence key) and T2 uses the location's Place ID. The grant and release bind both records, and `exp_claim_tier` resolves the location through the professional's claim. That branch was not edited.
  - **Enrichment flag F2** ("professional_first but business-named"), which Scott ruled invalid, exists only in `tools/category_brief/derive.ts` on branch `nora-os/category-cardinality` (line ~842, `F2_person_shape_on_place_name`). Nothing on main emits it, so no change was made on main. It should be removed on that branch.
- **Verified:**
  - Read-only, live DB: the `exp_office_mode` body was run as a SELECT for 8 records and classified each correctly (Greg Aldridge and his office from either side, the State Farm office via the `location` alias, NAF office and loan officer, a 4-pro real-estate office, the NAF enterprise, a missing id).
  - The changed explain CTEs were run for 5 entities. The single-pro pro and its office both score the same professional; the Place ID comes from the office or falls back to the professional; the multi-pro office is unchanged. Results are in the 0027 footer.
  - `tests/single-pro-office.test.ts` (11 tests); `bunx tsc --noEmit` clean; `bun test` 152 pass.
  - The claim-gate diffs dry-run cleanly against the branch files. Its 20 claim-gate tests pass with the patched `claim-gate.ts`.
- **Still open:**
  - Apply 0020, then 0027. The full explain body was not executed end to end against 0027; only the changed CTEs were.
  - GBP reviews stored on the location row are not counted for a single-pro office, because Reviews stays on the professional per the rule.
  - Public rank lists and the search projection must de-duplicate a single-pro office (show the professional only), because persist mirrors the score.
  - Apply the claim-gate patch when that branch merges.
  - `organizations.is_single_pro_office` could be dropped, or maintained from `exp_office_mode`. That is Scott's call.
  - Not yet office-mode aware: the NORA extractor (`src/lib/nora/extract/index.ts`) still calls `entityBrief(brief, entityType)`, so its caller should resolve the office mode and pass `professional` for a single-pro office. The interview runner and the "Name – Brand" public title are not on main.



## Claim gate backend: trust tiers, silent precheck, Place ID path (2026-10-11)
- **What triggered this:** NORA wave 2 (W2-3): replace the one-shot `submitClaim` scoring with the registry's claim gate (T0 authenticated, T1 identity + email, T2 ownership proven; silent first; one OTP only when the silent check falls short; GBP Place ID match as the instant T2 path; easy unclaim; harmful actions behind T2) — on the existing claim objects, not a parallel system.
- **Entity link (decided model):** `exp_entity` is the canonical id; the published record is linked by `exp_entity.identity_keys.professional_id` / `organization_id` (existing jsonb column and GIN index), written only by `_exp_entity_link_record` (via `exp_entity_for_record`, which also links by `statefarm_url` = `professionals.detail_url` or `gbp_place_id`, and creates a `claim_gate` entity when none exists). Backfill: the 19,726 entity rows that match today (19,169 professionals; 557 professionals have 2+ entity rows — the resolver picks claimed → pending → oldest; merge is follow-up).
- **Migration `drizzle/migrations/0021_claim_gate.sql` (+ journal idx 21; not applied):**
  - Columns: `exp_claim.trust_tier` (0-2, check) / `tier_path` / `released_at` / `updated_at`; `claim_queue.trust_tier` / `claim_id`; `exp_claim_events.claim_id`; `exp_verification_requests.claim_id` / `code_hash` (HMAC) / `expires_at` / `attempts` / `verified_at`. Status checks widened (superset): `claim_queue` + `released`; `exp_verification_requests` + `verified`, `expired`. Existing verified claims → T2 (`legacy_verified`).
  - Functions (SECURITY DEFINER, `search_path` pinned, REVOKE from PUBLIC / anon): service-role only — `exp_claim_gate_start`, `_advance`, `_challenge`, `_verify_otp`, `_grant`; signed-in with checks — `exp_claim_gate_release` (owner or super admin), `exp_claim_adjudicate` (rewritten, same signature; approve = T2 + full grant), new `exp_claim_queue_adjudicate` (queue ids; legacy rows get an `exp_claim`), `exp_claim_tier` (own tier; others staff only), `exp_entity_for_record` / `exp_entity_link_record` (service / super admin / architect). Grant writes `exp_claim` + `exp_entity.claim_state` + `exp_control_grants` owner (entity scope) + `professionals.claimed/user_id` (or `organizations.claimed`) + `claim_queue` + `exp_claim_events` (`is_demo` false) + `onboarding_progress` + `exp_admin_audit` in one transaction; competing open claims become `conflict`.
  - `exp_outbox` policy `staff_all_exp_outbox` re-created with `entity_type IS DISTINCT FROM 'claim_otp'` so OTP mail bodies are not readable by signed-in users (all other rows unchanged).
  - Registry: capabilities `claim_precheck`, `claim_gate_write`, `otp_verify`, `claim_bind`, `claim_unbind` registered; skills `claim_initiate`, `claim_silent_precheck`, `claim_challenge`, `claim_verify_email`, `claim_grant`, `claim_release` point at implemented capabilities (`gbp_list_locations`, `otp_send` reuse existing keys) and are published 1.0.0.
- **Code:** `src/lib/nora/claim-gate.ts` (pure tiers, refusals, precheck, next step; keys from the category brief by schema property), `src/lib/nora/claim-capabilities.server.ts` (handlers, registered in `nora-capabilities.server.ts`), `src/lib/nora-runner.server.ts` (`executeSkillRun`, extracted from `runSkill`; handlers now receive `actor`), `claim.functions.ts` (`submitClaim` / new `verifyClaimCode` / `releaseClaim` — every step is a live claim-skill run → one `exp_skill_run` row), `claims.tsx` approves / rejects through `exp_claim_queue_adjudicate` (the old direct `claim_queue` update had no RLS update policy and the old insert used statuses the check rejects). `runSkill` no longer treats entity `owner` grants as console roles. GBP uses a local adapter with the PR #50 `withIntegration` contract (always `not_configured` until that merges).
- **Verified:** `bun test` (20 new claim-gate tests), type check.
- **Not yet done / open:** apply 0021 together with the deploy (the claim page needs the new functions); OTP transport is off until `exp_app_config.sendgrid_api_key` is set (claims fall to licence prompt / manual review); live GBP managed-locations needs the claimant's `business.manage` token; release UI; merging the 557 duplicate professional entities; `exp_verification_requests` still readable by all signed-in users (destinations).

## Site mapper version 2 + field learning: four-source comparison (2026-10-10)
- **What triggered this:** dry runs of commit `e8c4e55` on the four active sources (read only; no table written).
- **Results vs the current contract:**
  - edwardjones.com (pg_net 4985): v2 route sitemap; same profile pattern, floor 24 (same), 34 fields vs 33 (adds `location.latitude`), same routes, 15 taxonomy keys; 8 of 10 samples from v2's profile URLs. $0.11, 106 s.
  - schwab.com (4986): v2 route listing; identical contract (24 fields, floor 21, same pattern, same routes); samples from v2's URLs. $0.16.
  - morganstanley.com (5037): v2 route sitemap; same pattern, 31 fields vs 30 (adds `person.disclaimer`), floor 29 vs 27; only the profile page itself came from v2's URLs, the other 9 samples were aaron.* in sitemap order.
  - compass.com (5038 v2; field learning run directly as 5064 because the self-call hit Cloudflare's 100 s limit, HTTP 524): same profile and roster patterns, route sitemap, 22 fields vs 20 (adds `person.headline` from `div[data-tn="profile-title"]` and `person.booking_url` from links to `/concierge/`), floor 20 vs 18, same taxonomy keys (10) and routes (`person.gallery`); all 8 v2 URLs used (profile page + 7 samples).
- **Found:**
  - Morgan Stanley samples: the dry run only moves a v2 URL to the front of the sample pool when it is not already there. v2's URLs were already in the pool (read from the same sitemap file), so they kept their sitemap position and the first matching pool URLs (aaron.*) were judged first. Fix proposed (not applied): move existing entries to the front.
  - compass `person.booking_url` points at Compass Concierge (a home-improvement programme), not a booking page; to be checked before any v2 contract is saved.
  - `learn_fields` self-call times out (HTTP 524) when v1 runs past ~100 s; workaround: the caller runs the v1 dry run itself with `profile_urls`.
- **Not yet done / open:** owner decision on the two fixes; v2 items 2-6 (saving the config, flags storage, crawl from the config, coverage on long lists, formal comparison).

## Fetch tick: in-flight cap 25 → 40 (2026-10-10)
- **What triggered this:** owner asked how to speed up the re-harvest; owner approved "in-flight limit 40".
- **What was wrong (verified on live data):** every round from 10:21 to 11:05 sent exactly 25 pages (compass 10, Edward Jones 5, then Morgan Stanley or Schwab 10, alternating), about 675 pages an hour in total. Four active sites × 10 pages per site per round need 40 slots; the 25 cap made Morgan Stanley and Schwab sit out every other round and gave Edward Jones only 5.
- **Changes shipped:** `exp_etl_fetch_tick()` — the three `v_inflight >= 25` checks now use 40; new comment `-- Fix (in-flight cap 40, 2026-10-10)`; the rest of the function (existing Fix comments, per-site cap 10, delay, quota) unchanged. No table, column, index or cron change.
- **Verified:** rounds at 11:07 and 11:09 sent 40 pages (10 per site); the 11:07 round came back all `done`, no errors.
- **Rollback:** the same `CREATE OR REPLACE` with 25 in the three checks.
- **Not yet done / open:** rounds still take about 2 minutes (send and collect each run once a minute); proposed, not approved: collect at the start of each tick (with a lock against cron 91), per-site cap above 10 with a back-off on errors, sargable daily count, delay / quota steps per source.

## Office website never the profile page; person website by source type (2026-10-12)
- **What triggered this:** owner asked whether professionals have a website field; the check found none filled and Edward Jones offices carrying the advisor's own page.
- **What was wrong (verified on live data):** `person.website` is filled on 0 staging rows of the four active sources; Edward Jones `location.website` equals the advisor's profile page on 19,390 of 19,456 rows (e.g. `…/financial-advisor/martin-mcsharry`). The existing guard only dropped `firm.website` (and `person.website` / `person.booking_url`) when equal to the page.
- **Changes shipped:**
  - `-disco-site-contract.ts` `buildStagingStatic`: `location.website` is dropped when it is the profile page (`-- Fix (office website, 2026-10-12)`). Used by the harvest and by `disco-staging-backfill`.
  - Owner rule recorded (applied later at Station 6, rollout plan step 1.2): `brand_site` source → `person.website` = own site shown on the page, else the profile page (`_sources` = `derived_from_profile_url`); portal / directory / licence registry / association / review platform / social / other → only a site shown on the page, never the profile page.
  - Docs: `docs/ETL-Staging-Data-Schema.md` (field rows, quality rules, bio requirement now per gcid in `exp_etl_field_floors`), `docs/ETL-Station6-to-Publish-Rollout-Plan.md` step 1.2.
- **Verified:** helper signatures checked (`formatUrl`, `urlCore`); live check after deploy with a read-only harvest call on an Edward Jones page.
- **Not yet done / open:** staging backfill to remove the existing Edward Jones values (dry run, then a separate approval for the write); the Station 6 person-website rule ships with the step 1 function change.

## Edward Jones office-website backfill written (2026-10-12)
- **What triggered this:** owner approved the write after the dry run (first 500 rows: `location.website` 499 → 1, every other field unchanged).
- **Live change:** `disco-staging-backfill` `dry_run:false` for edwardjones.com / `gcid:financial_advisor`, 39 batches of 500 (pg_net 34795–34799, 34820–34827, 34848–34855, 34876–34883, 34904–34913), sent in waves of 5–10; 19,456 rows written, 0 errors.
- **Verified in the table:** `location.website` 19,390 → 10, none equal to the profile page; `person.name` 19,390, `location.phone` 19,390 and `person.services` 16,695 unchanged.
- **Not yet done / open:** Edward Jones office hours mix entries with plain text ("Sat By Appointment Only") and days without times; to be handled before hours are published.

## Required fields per category: governed write + editable Field-yield tab (2026-10-12)
- **What triggered this:** rollout plan step 0.1 (`docs/ETL-Station6-to-Publish-Rollout-Plan.md`), owner decision T2: required fields are set per gcid from the UI; bio optional unless ticked; a gcid without a row publishes nothing. Owner approved "create exp_etl_set_field_floor and make the Field-yield tab editable".
- **What was wrong (verified on live data):** `exp_etl_field_floors` had one row (State Farm, old field names `bio`, `street`, …) and RLS with a read-only policy, so the UI could not write it; the Field-yield tab showed it read-only.
- **Changes shipped:**
  - Database: new `exp_etl_set_field_floor(p_gcid, p_required_keys, p_min_fields, p_min_products, p_min_licenses, p_notes)` (SECURITY DEFINER, `super_admin` / `architect` only via `exp_ctrl_has_role`, gcid must exist in `gbp_categories`, keys must be staging keys `person.* / location.* / firm.*`, rows with old field names refused, upsert + `exp_admin_audit` entry). EXECUTE revoked from PUBLIC / anon, granted to authenticated. No table, column, trigger or cron change.
  - Code: `src/lib/staging-keys.functions.ts` (server function returning the static keys, formats and meanings from `-disco-site-contract.ts`); `src/components/discovery/required-fields-editor.tsx` (list + add / edit form, fields grouped person / office / firm, minimums, notes; State Farm row read-only); `field-yield-tab.tsx` uses it in place of the read-only table.
- **Verified:** function created, `prosecdef` true, anon cannot execute, authenticated can; a call without an admin role is refused (`insufficient grant`); full project `tsc --noEmit` clean.
- **Rollback:** `DROP FUNCTION public.exp_etl_set_field_floor(text,text[],int,int,int,text);` and revert the three code files.
- **Not yet done / open:** owner fills the rows for `gcid:financial_advisor` and `gcid:real_estate_agents` (D8); Station 8 reads them in Phase 3.

## Required fields: "any one of" groups (2026-10-12)
- **What triggered this:** owner asked for rules such as "phone or email" next to plain required fields; approved "add 'any one of' groups to required fields" (both kinds in one row).
- **Changes shipped:**
  - `exp_etl_set_field_floor` (body only, `-- Fix (any-one-of groups, 2026-10-12)`): a `required_keys` entry may be one staging key or 2+ staging keys joined by `|`; anything else is refused (checked: `person.name`, `person.phone|person.email`, `person.phone|person.email|location.phone` accepted; `bio`, `person.phone|`, `person.phone||person.email`, `street|city` refused). Grants unchanged (anon cannot execute).
  - `required-fields-editor.tsx`: "Required (each one)" checkboxes plus an "Any one of" section to add / remove groups (2+ fields); the table shows groups as "one of (Person phone or Person email)".
  - Docs: rollout plan T2 and step 3.1.
- **Verified:** function body read back; regex checked on sample entries; full project `tsc --noEmit` clean.
- **Not yet done / open:** Station 8 (`exp_validate_profile`, Phase 3) applies the groups.

## Station 6 Phase 1A: full record, update path, failure reasons, GIN lookup (2026-10-12)
- **What triggered this:** rollout plan steps 1.1-1.4 (`docs/ETL-Station6-to-Publish-Rollout-Plan.md`); owner approved "Station 6 Phase 1A (a: exp_etl_merge_attrs, b: exp_graph_create_entity, c: exp_etl_stage_ingest, d: exp_etl_resolve)".
- **What was wrong (verified on live data):** `exp_etl_resolve` copied 8 contact fields in old formats (e.g. `+1-703-535-8367`), never updated an entity after creation (8,684 professionals / 5,305 offices without the new schema), marked failures `conflicted` without a reason, and every identity lookup used `identity_keys->>k = v`, which skips the GIN index `idx_entity_ikeys` (~135 ms each).
- **Changes shipped (database; previous definitions saved in `exp_curation_ledger` ids 154789-154791, action `definition_before_change`):**
  - a) new `exp_etl_merge_attrs(old, new, source, rank, derived)`: per field the best-ranked source wins (`authority_rank`), a source refreshes its own values and drops fields it no longer shows, a value shown on a page beats one derived from the profile URL; provenance in `attributes._src` (`{d, r, how}`).
  - b) `exp_graph_create_entity`: lookup `identity_keys @> jsonb_build_object(k, v)` (`-- Fix (GIN lookup, 2026-10-12)`).
  - c) `exp_etl_stage_ingest`: a re-harvest of a `created` / `matched` contract row refreshes payload and `observed_at`, status kept (`-- Fix (Station 6 update path, 2026-10-12)`).
  - d) `exp_etl_resolve` contract branch (`-- Fix (Station 6 full record + update path, 2026-10-12)`): also picks `created` / `matched` rows whose staging row is newer than their resolution; `person.*` → professional, `location.*` → office, `firm.*` → brand (brand_site sources only) through `exp_etl_merge_attrs`; display name refreshed; person website rule (brand_site → profile page when no own site, marked `derived_from_profile_url`); brand / professional lookups with `@>`; `rejected_reason` always filled (`malformed: …`, or `SQLSTATE: message` for `conflicted`). Keys, relationships, claim firewall, 80 rows per run and the legacy branch unchanged.
- **Verified:** rolled-back runs: 10 chosen rows (5 new Schwab, 5 existing Schwab / Edward Jones) all resolved in 0.56 s, existing advisor updated with full fields (`+19528202063`, licence type, credentials, education, derived website), office and brand attributes filled; 80 oldest pending rows with the live function: 80 created in 2.1 s; stage_ingest refresh of a created row kept status `created` and made it newer than its resolution. Cron 96 stays off.
- **Rollback:** re-create the three functions from the ledger rows above; `DROP FUNCTION public.exp_etl_merge_attrs(jsonb,jsonb,text,int,jsonb);`.
- **Not yet done / open:** step 1.8 refresh of existing entities (mark created rows for re-processing, separate approval); step 1.9 cron 96 on; Phase 1B (non-brand sources, location-first branch, cross-source identity keys, office moves — a changed office keeps the old WORKS_AT).

## Station 6: existing profiles marked for refresh, cron 96 on (2026-10-12)
- **What triggered this:** owner approved "mark existing profiles for refresh and switch on cron 96" (rollout plan steps 1.8, 1.9).
- **Live changes:** `exp_etl_staging.observed_at = now()` on 8,684 resolved contract rows of active sources (Edward Jones 4,453, Morgan Stanley 2,179, Schwab 1,787, compass 265) so `exp_etl_resolve` re-processes them with the Phase 1A full record; `cron.alter_job(96, active := true)` at 05:36 UTC. Crons 89 and 92-95 stay off.
- **Verified (first 3 runs):** succeeded, 5.9-8.6 s each, 80 rows per run, no rejections; 240 professionals updated, all with `attributes._src`, about 12 fields each (Edward Jones).
- **Backlog:** 33,377 pending (the re-harvest keeps adding) + 8,684 refresh rows ≈ 42,000 at 80 per minute ≈ 9 hours.
- **Rollback:** `cron.alter_job(96, active := false)`; entities keep what was written (functions can be restored from the ledger rows of Phase 1A).

## Required fields set for financial advisors and real estate agents (2026-10-12)
- **What triggered this:** owner chose "address + phone|email + 8 fields" (State Farm's minimum without bio, products and licences) for both categories (decision D8).
- **Live change:** `exp_etl_field_floors` rows for `gcid:financial_advisor` and `gcid:real_estate_agents` (written directly; the connector has no admin role for `exp_etl_set_field_floor`): required `person.name`, `person.profile_url`; any-one-of groups `location.street|person.street`, `location.city|person.city`, `location.state|person.state`, `location.email|location.phone|person.email|person.phone`; `min_fields` 8, `min_products` 0, `min_licenses` 0.
- **Expected pass rate on current staging (not shallow):** Edward Jones 19,374 / 19,382, Morgan Stanley 6,421 / 6,421, compass 14,369 / 14,369, Schwab 1,214 / 2,419 (Financial Solutions Branch consultants have no street).
- **Not yet done / open:** Station 8 applies the rows (Phase 3).

## Station 6 Phase 1B: non-brand sources, cross-source keys, location-first, office moves (2026-10-12)
- **What triggered this:** rollout plan steps 1.5-1.7; owner approved "Station 6 Phase 1B (a: exp_etl_brand_key, b: exp_etl_identity_match, c: exp_guard_attribution, d: exp_etl_resolve)".
- **What was wrong:** the source domain was always the brand (a portal run would create a "Zillow" brand); the attribution firewall checked only the first profile URL; records without a person name were rejected (no location-first category could pass); every identity key contained the source domain (the same person on two sites became two profiles); offices never moved.
- **Changes shipped (previous definitions in `exp_curation_ledger` ids 181388-181389, action `definition_before_change`):**
  - a) new `exp_etl_brand_key(name)`: normalised firm name ("Compass, Inc." → `compass`).
  - b) new `exp_etl_identity_match(type, keys, own_key)`: finds the entity from identity keys; a key value held by another profile of the same site is ambiguous and removed everywhere; an existing record never fails on a cross-source key (dropped, left for Station 7); a new record whose keys point to two entities → `identity_conflict`.
  - c) `exp_guard_attribution` (`-- Fix (non-brand evidence + any profile key, 2026-10-12)`): passes an ETL write whose page names the brand (`exp.attribution_brand`), otherwise checks ANY profile URL of the subject against the brand domain / subdomain.
  - d) `exp_etl_resolve` contract branch (`-- Fix (Station 6 Phase 1B, 2026-10-12)`): brand from the page's firm for non-brand sources (firm website domain, else `brand_name` key, else created; none without a firm); `brand_name` key added to brands; cross-source keys professional `lic` / `email` (role mailboxes excluded) / `place`, office `office` (brand|street|zip), location `place` / `office`, accumulated on the entity; location-first gcids (`exp_category_shape.shape`) build brand → location without a professional; office move closes the same-source WORKS_AT (historical) and adds the new one; display name follows the source that won `name`.
- **Verified:** rolled-back scenarios (Schwab / Edward Jones / Morgan Stanley / compass rows plus test portal and restaurant sources): all expected outcomes, including a test-portal agent linked to the existing compass profile by email, a new portal agent linked to the Compass brand through page evidence, a restaurant location under its chain, an office move closed and replaced, an ambiguous licence removed, a two-entity key set refused. Live after apply (07:04-07:06 UTC): runs succeeded in 6.5-11.1 s, 240 rows created / refreshed with no rejections; 79 professionals and 116 offices already carry cross-source keys; Edward Jones / Morgan Stanley brands carry `brand_name`.
- **Rollback:** restore the two functions from the ledger rows above; `DROP FUNCTION public.exp_etl_identity_match(text,jsonb,text); DROP FUNCTION public.exp_etl_brand_key(text);` (keys already added stay and are harmless).
- **Not yet done / open:** possible duplicates found when a record already has its own entity are not stored (Station 7 step 2.1E / 2.2 merge); offices from person-level addresses (compass `person.*`) are still not created.

## Station 7 enhancer: generic map-or-add, office phone, duplicate list, governed merge (2026-10-12)
- **What triggered this:** rollout plan Phase 2; owner approved "Station 7 (a: exp_etl_term_norm, b: exp_etl_match_term, c: exp_etl_merge_entities, d: exp_etl_enhance, e: cron etl-enhance-tick)".
- **What was wrong (verified on live data):** Station 7 was not connected (`exp_etl_reconcile_value` no caller; `exp_etl_map_or_add_product` insurance-only, appends " Insurance"); office phones came from the first advisor (shared offices with differing advisor phones: Edward Jones 91/104, Morgan Stanley 339/341, Schwab 265/303); possible duplicates were not recorded and no generic merge existed. Term match rates are low (top Edward Jones values like "Retirement Savings Strategies" best-match at 0.38), so matching is a review aid only.
- **Changes shipped (database; no table / column change):**
  - a) `exp_etl_term_norm(text)`; b) `exp_etl_match_term(gcid, type, raw, source)`: exact match against taxonomy levels product_service / specialization / audience writes nothing, otherwise a proposal in `exp_etl_candidates` (nearest term + trigram similarity; `candidate` ≥ 0.5, else `promote_proposed`; seen_count per profile); never adds taxonomy terms.
  - c) `exp_etl_merge_entities(keep, drop, rationale)` (SECURITY DEFINER; system / super_admin / architect; claimed survives, two claimed refused; keys / attributes combined, relationships moved, `merged_into`, staging repointed, ledger). Not called automatically.
  - d) `exp_etl_enhance(batch)`: entities with `_src` whose `last_observed_at` is newer than `_enhanced_at`; professionals → term proposals once (`_terms_at`) and duplicate pairs (`duplicate:professional`) when their email is another source's identity key; offices → phone = majority number of current professionals, else none, marked `_src.phone = {d:'reconciled', r:0}` so Station 6 cannot overwrite it.
  - e) cron `etl-enhance-tick` (jobid 102), every minute, `exp_etl_enhance(100)`.
  - EXECUTE revoked from PUBLIC / anon on `exp_etl_merge_entities` (granted to authenticated, role-checked) and from PUBLIC / anon / authenticated on `exp_etl_enhance` and `exp_etl_match_term`.
- **Verified:** rolled-back runs (100 entities in 0.56 s; merge test on dummy entities); live: runs 07:36 and 07:37 succeeded in 0.7-0.9 s, 200 entities enhanced, 96 offices reconciled (93 majority, 3 no majority), 33 service proposals, 0 duplicates (sources do not overlap).
- **Rollback:** `SELECT cron.unschedule('etl-enhance-tick');` and drop the four functions; reconciled office phones and proposals stay (can be cleared).
- **Not yet done / open:** review screen for term proposals and duplicate pairs with an approve → merge action (plan step 2.4); "missing for score" flags left to the score function (`exp_score_v5_explain`) after publishing; medium-evidence duplicates (same name + phone) not detected yet.

## Station 8: per-profile check, gate tick, category launch (2026-10-12)
- **What triggered this:** rollout plan Phase 3; owner approved "Station 8 (a: exp_validate_profile, b: exp_etl_profile_gate, c: cron etl-profile-gate-tick, d: exp_etl_launch_category)".
- **What was wrong:** nothing checked an individual profile (the 14 `exp_validate_*` check category setup; `exp_etl_record_complete` reads the State Farm-only `exp_etl_source_contract`); `is_launched` was never set.
- **Changes shipped (database; no table / column change):**
  - a) `exp_validate_profile(entity)` (read-only): profile + current office (`location.*`) + brand (`firm.*`) checked against the gcid's `exp_etl_field_floors` row (single keys, any-one-of groups, `min_fields`, `min_products`, `min_licenses`) and formats (E.164 US phone, state, ZIP, profile URL); no row → never passes.
  - b) `exp_etl_profile_gate(batch)`: stores the result as `attributes._gate` for professionals in professional_first gcids and locations in location_first gcids, after Station 7; re-checks on entity change or required-field edit.
  - c) cron `etl-profile-gate-tick` (jobid 103), every minute, `exp_etl_profile_gate(200)`.
  - d) `exp_etl_launch_category(gcid)` (SECURITY DEFINER; system / super_admin / architect): requires a required-fields row and every `exp_validate_category_full` check passing; sets `is_launched` on `gbp_categories` and `exp_category_knowledge`; ledger entry.
  - EXECUTE revoked from PUBLIC / anon / authenticated on the gate tick, from PUBLIC / anon on the launch function (granted to authenticated, role-checked).
- **Verified:** rolled back: sample of 400 refreshed professionals — Edward Jones 144/144, Morgan Stanley 90/90, compass 146/146, Schwab 8/20 (all 12 failures "missing one of location.street / person.street"); category checks financial advisor 69/69 and real estate agent 81/81; launch refused without required fields. Live (08:56-08:58 UTC): three runs succeeded in 0.6-0.9 s, 600 profiles gated, all passing so far.
- **Note:** `exp_engine_rules_pass` resets `is_launched` when it rebuilds a category; publishing for that category then pauses until relaunched.
- **Rollback:** `SELECT cron.unschedule('etl-profile-gate-tick');` and drop the three functions; `_gate` results are harmless; `is_launched` can be set back.
- **Not yet done / open:** launching `gcid:financial_advisor` and `gcid:real_estate_agents` (separate approval); a screen for gate results and a Launch button (with the publish screen).

## Categories launched: financial advisor, real estate agent (2026-10-12)
- **What triggered this:** owner approved "launch gcid:financial_advisor and gcid:real_estate_agents".
- **Live change:** `exp_etl_launch_category` for both: financial advisor 69/69 category checks passed, real estate agent 81/81; `is_launched = true` on `gbp_categories` and `exp_category_knowledge`; ledger entries `category_launched`.
- **Effect:** the categories appear in the admin "launched" lists; publishing (Phase 4) may now take their profiles that passed the Station 8 gate. The public page itself does not read the flag.

## Publish: generic publisher and Schwab pilot (2026-10-12)
- **What triggered this:** rollout plan Phase 4; owner approved "Publish (a: exp_etl_slug, b: exp_etl_entity_nodes, c: exp_etl_publish_entity with the headline fix, d: exp_etl_publish_tick, e: Schwab pilot run)".
- **What was wrong:** only State Farm could reach the public tables (`exp_sf_apply` / `exp_sf_nodalize`); entities from the generic sources stopped at the graph.
- **Changes shipped (database; no table / column change):**
  - a) `exp_etl_slug`: readable slugs (T10) — people `name-city-state`, offices `brand-city-state`, brands the brand name; a short number when taken; a published slug never changes.
  - b) `exp_etl_entity_nodes`: maps an entity's static fields to node payloads for `exp_graph_upsert_nodes` (ring from `exp_ring.sort`; trust per T6).
  - c) `exp_etl_publish_entity`: professionals that passed the Station 8 gate in a launched gcid → `organizations` (brand, then office with `parent_org_id`), `professionals` (`primary_org_id`, licence columns, website, languages), graph nodes; link written back as `identity_keys.professional_id` / `organization_id`; one `exp_index_queue` row (state `held`, `/p/<slug>`). Headline = job title (or the category noun) · brand. Claimed public rows untouched; non-professional entities skipped (location-first not built).
  - d) `exp_etl_publish_tick(batch, domains)`: batches of passed, not-yet-published (or changed) entities, optionally limited to source domains.
  - EXECUTE revoked from PUBLIC / anon / authenticated on `exp_etl_publish_entity` and `exp_etl_publish_tick`.
- **Verified:** rolled-back test: 25 profiles in 1.9 s, no errors, republish idempotent. Live pilot (`exp_etl_publish_tick(100, ARRAY['schwab.com'])`): 91 checked, 91 published, 0 errors — `professionals` +91, `organizations` +70 (1 brand + 69 offices), `graph_nodes` +980, `exp_index_queue` +91 (held). Sample: `/p/charlotte-souza-west-hartford-ct` → office `charles-schwab-co-inc-west-hartford-ct` → brand `charles-schwab-co-inc`.
- **Not changed:** `search-project-tick` stays off (T7); index crons 77/78 stay off; no publish cron.
- **Rollback:** set the 91 professionals and 70 organizations inactive (or delete them with their graph nodes and queue rows) and remove `professional_id` / `organization_id` from the entities' identity keys; drop the four functions.
- **Not yet done / open:** owner checks the pilot pages; then a publish cron for all sources (separate approval) in pilot order Morgan Stanley → Edward Jones → compass; Schwab gate pass rate ~40% (Financial Solutions pages show no street); location-first publishing; gate / launch / publish screen.

## Profiles screen: category filter missed newer categories (2026-10-12)
- **What triggered this:** after the Schwab pilot the owner could not pick `gcid:financial_advisor` on the Profiles screen; owner approved the fix.
- **What was wrong:** the dropdown read the gcid of every `professionals` row, and the API returns at most 1,000 rows, so only categories within the first 1,000 rows (mostly insurance agency) appeared.
- **Change shipped (code only):** `src/routes/_authenticated/professionals.tsx` walks the distinct gcids with one tiny request per category (`gcid > last ORDER BY gcid LIMIT 1`, uses `idx_pros_gcid`). No database change.
- **Verified:** typecheck clean (0 errors); expected list: financial_advisor, insurance_agency, mortgage_broker, real_estate_agents.
- **Rollback:** revert the commit.

## Profile depth: node layer, office address and brand presence on published profiles (2026-10-12)
- **What triggered this:** the Schwab pilot pages showed 0 nodes in every ring; owner approved "profile depth (a: ring-layer trigger, b: publish_entity location + brand presence, c: backfill 980 nodes, d: republish 91 Schwab)".
- **What was wrong:** (1) `exp_graph_upsert_nodes` names the ring but leaves `ring_layer` empty, and the trigger `exp_graph_nodes_ring_autofill` only filled the layer when the ring was empty too; profile pages read `ring_layer = 'proof'`, so all 980 publish nodes were skipped. (2) A professional's address is on the office entity, so the person's Location ring was empty. (3) The brand's website and social links never reached the person's page.
- **Changes shipped (database; no table / column change):**
  - a) `exp_graph_nodes_ring_autofill`: when the ring is named and the layer is empty, the layer comes from `exp_ring.layer` (never overwrites a layer that is set).
  - b) `exp_etl_publish_entity`: when the person's record has no address, the office's address / geo / hours become the person's Location nodes; the brand's website and social links become Presence nodes typed `brand_website` / `brand_social` (the firm's, not the person's own profiles).
  - c) Backfill: `ring_layer` set from `exp_ring` on the 980 nodes that had none (all from the publish pilot).
  - d) The 91 Schwab profiles republished.
  - Previous definitions saved in `exp_curation_ledger` (ids 228382, 228383, action `definition_before_change`).
- **Verified:** rolled-back test on one profile (9 → 14 nodes, all `proof`); live: 0 nodes without a layer; republish 91/91 ok, 455 nodes added, 837 updated; financial advisor profiles now carry identity 273, credentials 382, location 91, presence 546 nodes (about 14 per profile).
- **Corrections found while checking:** Station 7 did not erase a Schwab office phone: on every Schwab record `location.phone` equals the advisor's direct line, and the real office number is inside an unmapped extra (`office_phone_direct_2`). The Schwab experience text is rightly not a bio (job-history rule); years of experience and work history need a new staging key.
- **Rollback:** restore the two saved definitions; the backfilled layers are correct values and can stay; republish again after a restore.
- **Not yet done / open:** site-contract step for the Schwab office phone and a `person.work_history` key plus years of experience (schema change, separate approval, then Schwab re-harvest); overall score stays pending while `search-project-tick` is off (T7).

## Site-contract step: work history, office block, years of experience, office phone (2026-10-12)
- **What triggered this:** Schwab pilot profiles were thin; owner approved "site-contract step (1: work_history key, 2: office block rule, 3: years rule, 4: Station 6 office phone, 5: Station 7 office phone, 6: entity_nodes work history + start year, 7: Schwab route)".
- **What was wrong:** Schwab maps `a.phone-number` (the advisor's own line) to both `person.phone` and `location.phone` (all 2,419 rows); the real branch number and the full branch address sit in one extra text ("West Hartford 11 South Main Street West Hartford CT 06107 860-570-4040", extra `office_phone_direct_2`, on 641 rows; 364 of them have no mapped street — the main Schwab gate failure); the Experience list (extra `employment_history`, 2,778 rows) had no static key; "10 years of professional experience" (2,772 rows) sits in a text rightly dropped as a bio.
- **Changes (code, `-disco-site-contract.ts`, needs merge + deploy):**
  - 1) New staging key `person.work_history` (list; meaning "jobs the person has held, as the page lists them"); schema doc section 3a.
  - 2) `parseOfficeBlock` + derived rule in `buildStagingStatic`: one extra text = office address + one trailing phone fills empty `location.street/city/state/postal_code`, and becomes `location.phone` when the page gave none or only the person's own number; single texts only, must agree with office address parts already on the page; the extra is removed. Schema doc section 5.
  - 3) Years rule: "N years of (professional / industry) experience" in `person.bio` → `person.years_experience` → `person.year_started`, before the bio quality rules; boilerplate never counts.
  - Checked: parser on 7 Schwab-style texts (all parts right, incl. "Suite #130 Mountain Brook", "St Louis"), two-phone and plain texts → null; Charlotte Souza record → office address + 860-570-4040 + start year 2016; route test for work history; typecheck 0 errors.
- **Changes (database, live; no table / column change):**
  - 4) `exp_etl_resolve`: the office phone is written only when it differs from the person's own number on that record; a distinct office line clears a Station 7 `reconciled` value.
  - 5) `exp_etl_enhance`: an office phone shown by a page (not reconciled) that is none of the office's current professionals' numbers is kept; otherwise the majority rule as before.
  - 6) `exp_etl_entity_nodes`: `work_history` → `work_history` nodes (Credentials ring, `hasOccupation`); `year_started` → one `year_started` node ("In the profession since 2016").
  - 7) Schwab site contract: static route `person.work_history` ← extra `employment_history` (future harvests keep it).
  - Previous definitions in `exp_curation_ledger` 235171-235173 (functions), 235462 (Schwab routes).
  - Verified (rolled back): Charlotte Souza record with the new values → office phone +18605704040 from schwab.com kept by Station 7, published office phone set, 2 work-history nodes + start-year node.
- **Effect on other sources:** Edward Jones `location.phone` = advisor number on every row → office phone still from Station 7's majority rule; Morgan Stanley 19 rows with a distinct office line keep it; compass none.
- **Rollback:** restore the ledger definitions; revert the code commit; remove the Schwab route.
- **Next (separate approval):** after merge + deploy: Schwab staging backfill (dry run first; Edward Jones / Morgan Stanley / compass dry runs to confirm no change); Schwab re-harvest (~2,140 rows harvested before the branch block was learned); refresh marks → Stations 6-8 → republish. Note: Station 6 queue is 22,993 rows (oldest 2026-10-11) at 80 rows a minute.

## Schwab backfill, re-harvest (paused), refresh marks (2026-10-12)
- **What triggered this:** owner approved "Schwab backfill write (8), re-harvest (9), refresh + republish (10)".
- **Dry runs first (nothing written):** Schwab 2,780 rows: `person.work_history` 0 → 2,778, `person.year_started` 0 → 2,772, `location.street` 1,218 → 1,562; Edward Jones (500 rows) no change; Morgan Stanley / compass (500 rows each) only `person.year_started` +3 / +23 from bios from the new code (their other differences come from older code fixes; not backfilled).
- **8) Backfill written:** `disco-staging-backfill` for schwab.com, 6 batches (2,780 rows), extra route `person.bio` ← `tax.advisor_biography` in the request (needed for the years rule). After: work history 2,778, start year 2,772, office street 1,562, a distinct office line on 491 rows.
- **9) Re-harvest started, then paused:** 2,776 Schwab detail pages re-queued (frontier `done` → `queued`; same as `exp_etl_reharvest_source` without the console run record). After 20 pages: the harvest path has no `person.bio` route (the bio text is the taxonomy key `advisor_biography`), so re-harvested rows lose the start year the backfill gave; fetch rate about 2.5 pages a minute (about 18 hours for all). The remaining 2,756 pages were set back to `done`. Rows from the 2026-09-28 contract (1,793) have no branch block; on rows from the 2026-10-10 contract 586 of 632 non-shallow rows have it, so the re-harvest is still worth running once the route is in the contract.
- **10) Refresh marks:** `observed_at = now()` on the 2,419 resolved Schwab rows, so Stations 6-8 apply the backfilled values; republish follows when they are through (Station 6 queue about 21,700 rows, oldest 2026-10-11).
- **Open:** owner approval for the Schwab contract route `person.bio` ← taxonomy `tax.advisor_biography`; then resume the re-harvest and re-run the backfill on the 20 re-harvested rows.

## Harvest applies the category's generic taxonomy routes (2026-10-12)
- **What triggered this:** the Schwab re-harvest dropped the start year the backfill had given; owner approved "harvest uses generic taxonomy routes" (instead of a hand-written Schwab-only route, which the owner asked to avoid).
- **What was wrong:** the harvest used only the routes saved in the contract at mapping time. Mapping skips a static id that has a page rule; when that rule finds nothing at harvest (Schwab `person.bio`), the value captured under a taxonomy key with the same meaning (`advisor_biography`, registry Person.description, subject person) was never copied. The staging backfill already computed these generic routes, so backfill and harvest disagreed.
- **Change (code, `disco-harvest-worker.ts`, needs merge + deploy):** `harvestRoutes(gcid, contract)` — contract routes first, then the category's generic taxonomy routes from `buildStaticRoutes` over `exp_vertical_node_registry` (same as the backfill), single-value ids only (lists keep the contract's own routes); they only fill a value still empty after page rules and contract routes. Registry read cached with the contract row (10 minutes). Nothing site-specific.
- **Checked:** with the live Schwab contract + financial advisor registry the generic set adds `person.bio` ← `tax.advisor_biography` (plus name / office address / phone / firm website routes that only apply when empty); a Schwab-style record then gets `person.year_started` (2016 from "10 years of professional experience"); typecheck 0 errors. Backfill dry run without any hand route: start year on 498 of 500 Schwab rows (same as with it).
- **Effect on other sources:** only empty single values can be filled from a same-meaning taxonomy key on the same page (evidence on the page); e.g. Morgan Stanley bios where the page rule finds none.
- **Rollback:** revert the commit.
- **Next:** after deploy, resume the Schwab re-harvest (2,756 pages) and re-run the backfill on the 20 rows re-harvested before this fix.

## Indexing: one floor, queue sync from real scores, robots.txt (2026-10-11)
- **What triggered this:** sprint item "One floor + queue sync from real scores + robots.txt". `exp_index_queue` had 39,464 rows, all score 0 except 3 demo rows stuck at `submitting`; 39,461 sat in `held-below-floor` because the rebuild held every row with score <= 0, while the profile page noindexes on a different rule (template `completeness_floor`). Sitemap bands were hard-coded; no robots.txt; the submit tick marked rows `indexed` on a ping.
- **What changed** (migration `drizzle/migrations/0024_index_floor.sql` + journal 24, not applied; extends the existing index functions, no new indexer):
  - One floor: `exp_index_completeness_floor(gcid, lane)` = category template row, else `default` row, else built-in 60 / 60 / 55, the same value `completeness()` in `profile-render.ts` uses for noindex. Score no longer holds a page; it only orders and bands it.
  - `exp_index_sync(p_limit)`: queue score = v5 `search_rank_scores.total_score` when present, else `search_documents.rank_score`; `thoroughness_pct` = `search_documents.completeness_pct`; state `held` when completeness is unknown / below the floor or the row is demo, `submitted` / `indexed` kept unless the URL changed, else `pending`; missing entities inserted; `lastmod` from `professionals` / `organizations.updated_at`; URLs corrected to `/p` (professional), `/o` (location), `/c` (brand) (20,163 location / brand rows pointed at `/p/`, which 404s for them). New queue columns `lastmod`, `is_demo`, `completeness_floor`, `synced_at`.
  - `exp_index_submit_tick`: success state `submitted`; nothing taken when no channel is enabled (rows used to stay `submitting`); IndexNow gets absolute URLs; Google Indexing API off unless `exp_index_config.google_indexing_enabled = 'true'` (Google supports it only for JobPosting / BroadcastEvent).
  - `exp_sitemap_rebuild` reads band thresholds from `exp_sitemap_partition`; held = `held` state or demo. `exp_index_guard` checked `current_user` inside a SECURITY DEFINER function (always the owner, so always true); now checks `session_user` / `auth.role()` / control grants, and sync / rebuild / tick call it.
  - Code: `src/lib/index-floor.ts` (pure helpers + tests), `sitemap.server.ts` bands from the table, `lastmod`, excludes held / demo; `/robots.txt` route; Indexing console "Queue coverage" panel + "Sync from scores" button.
- **Expected effect (read-only estimate):** with today's data (`completeness_pct` null everywhere) a sync holds all 39,464 rows. Once the search projection persists completeness, the template rule estimated in SQL from the same section sources gives 19,832 non-demo pages at `pending` (professional 19,223 of 19,223, location 607 of 20,133, brand 2 of 2); 19,526 locations stay held (mostly 3 of 5 required sections: no staff / no map); 106 demo rows stay held.
- **Not yet done / open:** apply 0024; run `exp_index_sync()` after the search projection and v5 scorer land; crons `index-sitemap-rebuild` / `index-submit-tick` stay inactive; move `google_indexing_token` / `indexnow_key` out of plaintext `exp_index_config`; `rank_score` (0-100) and v5 total (0-850) share the score column until v5 covers every entity; `$category.$city.$professional` console route has no fixed prefix for robots.txt.

## Indexing: site-wide switch, default OFF (2026-10-11)
- **What triggered this:** Scott's ruling 2026-10-11: "Do everything except index. We are building/testing and shouldn't have any live pages or Google submissions. We can build it though." The indexing system ships complete but disabled by one switch.
- **What was there (live, read-only):** `exp_index_config(key text, value text, updated_at timestamptz)` holds `job_sitemap_rebuild`, `job_submit_tick`, `last_sitemap_rebuild`, `last_submit_tick`; RLS policy `index_config_admin` (super_admin / architect only), so the anon sitemap / robots / page head cannot read it directly. Crons 77 `index-sitemap-rebuild` and 78 `index-submit-tick` are inactive. 0024 is not applied (`exp_index_sync` / `exp_index_enabled` absent).
- **What changed:**
  - `drizzle/migrations/0024_index_floor.sql` (still not applied): seeds `site_indexing_enabled = 'false'` (`on conflict do nothing`); new `exp_index_enabled()` STABLE SECURITY DEFINER, anon-callable, true only for the literal `'true'`, false when the key is missing; `exp_index_submit_tick` returns `{skipped: 'site_indexing_disabled'}` right after the guard, before the lock, the queue, the log or any `net.http_post`. `exp_index_sync` / `exp_sitemap_rebuild` are unchanged and still run, so the console shows what would be indexed.
  - App: `src/lib/index-floor.ts` (`SITE_INDEXING_KEY`, `parseIndexingEnabled`, `siteRobotsMeta`, `siteRobotsHeader`, `robotsTxt(origin, enabled = false)`); `src/lib/sitemap.server.ts` `loadSiteIndexingEnabled()` (RPC with the anon key, cached 60 s per instance, any error = OFF), `sitemapIndexXml` / `urlSetXml` emit nothing unless `enabled`; sitemap index / partition routes serve empty documents when OFF; `/robots.txt` OFF = `User-agent: *` + `Disallow: /`, no `Sitemap:`; `src/routes/__root.tsx` root loader reads the switch through `getSiteIndexing` (failure = OFF) and the root shell renders `<meta name="robots" content="noindex,nofollow">` outside `HeadContent` (a deeper route's robots meta cannot replace it; crawlers apply the most restrictive), ON renders nothing so per-page rules decide; `src/server.ts` adds `X-Robots-Tag: noindex, nofollow` to every response when OFF.
  - Console: `search.indexing.tsx` banner "Indexing is OFF (testing)" with the key value; the switch is super-admin only through `setSiteIndexing` (`src/lib/site-indexing.functions.ts`, `requireSuperAdmin` from `google-workspace.functions.ts`, audit row), with a confirm prompt. `searchMutations.setIndexConfig` refuses that key. The switch was not flipped.
- **Verified:** `bunx tsc --noEmit` clean; `bun test` 202 pass (6 new: switch parsing, robots on/off, head meta / header on/off, sitemap empty when off, filled when on).
- **Still open:** apply 0024 (until then `exp_index_enabled()` does not exist, the RPC errors and the app reads OFF, which is the intended state); multiple app instances can lag a flip by up to 60 s; per-page `robots` metas on marketing pages still say `index, follow` and coexist with the site-wide noindex while OFF.

---

## 2026-10-11 — Anon lockdown, indexing (0024) applied with switch OFF, v5 score sample of 20

**Triggered by:** Scott: (1) "Turn on real scores? Yes" (sample of 20 first); (2) "Do everything except index — we are building/testing and shouldn't have any live pages or Google submissions"; (3) "Yes, sales surfaces are admin surfaces" (block anonymous access to risky SECURITY DEFINER functions).

**1. Anonymous-access lockdown.** Evidence: 84 SECURITY DEFINER functions in `public` were executable by `anon` (the public key in the website bundle) with no auth check — incl. m4_* contract lifecycle (finalize, decide_approval, generate_invoice…), exp_engine_tick (paid enrichment engine), exp_sf_* State Farm loads, disco_* discovery writers, exp_etl_* pipeline controls, exp_index_submit_tick, bootstrap_control_super_admin. Change: `REVOKE EXECUTE … FROM PUBLIC, anon` + explicit `GRANT … TO authenticated, service_role` on all 84 (prior ACLs saved as `acl:*` rows in `zz_backup_functions_20261011b`). Kept open (public site / contract signing / RLS helpers): public_page_view_ping, public_ad_units, public_sponsored_slots, nearby_cities, m4_signer_fetch, m4_record_signature, has_control_role, exp_ctrl_has_role, exp_index_guard, list_control_users. Verified: 10 anon-executable definer functions remain (exactly the allowlist); authenticated keeps access (e.g. m4_finalize); live `/find` still returns results. Earlier the same day: `exp_graph_create_entity` revoked from anon.

**2. Indexing 0024 applied (switch OFF).** `exp_index_config.site_indexing_enabled = 'false'`; `exp_index_enabled()`; fixed `exp_index_guard` (previously always true inside SECURITY DEFINER); `exp_index_completeness_floor`, `exp_index_canonical_path`, `exp_index_sync`, `exp_sitemap_rebuild` (bands from exp_sitemap_partition), `exp_index_submit_tick` (returns `site_indexing_disabled` while OFF; 'submitted' not 'indexed'). Queue columns lastmod/is_demo/completeness_floor/synced_at. Verified: enabled=false; test tick → skipped site_indexing_disabled; crons index-sitemap-rebuild / index-submit-tick inactive; `exp_index_sync` → 50 inserted, 39,514 updated, 0 location/brand rows left on /p/ URLs (was 20,163); would-index 19,882 (professional 19,223, location 657, brand 2) / held 19,632; submission log unchanged (6 rows). App side (robots Disallow /, empty sitemaps, site-wide noindex + X-Robots-Tag) ships in PR #56 and fails closed (OFF) on any read error.

**3. v5 score sample (20 entities persisted).** `exp_score_v5_persist` run for 12 professionals and 8 organizations (Greg Aldridge + 9 State Farm agents, 2 NAF loan officers, 3 State Farm offices, NAF Bettendorf office, NAF brand, State Farm brand + 2 regions). Results: NAF Amber Ernst Team 73.54 (reviews 51.5, completeness 21); NAF brand 39.52; NAF Bettendorf 38.14; State Farm agents/offices 1.41–2.87 (completeness only); Joy Schneckloth / State Farm brand / regions 0. Top gap everywhere: Google Business Profile +68. Single-pro offices mirror their professional's score. Search not refreshed (exp_search_dirty holds these ids; not drained, to avoid mixing v5 and provisional ranks in public search).

**Still open:** score-all decision (≈39.5k entities) and the completeness calibration question (insurance_agency expected_m 611 vs ~35 nodes per agent); indexing switch stays OFF until Scott flips it; Google token still plaintext in exp_index_config.

## Schwab re-harvest resumed under Option A (2026-10-12)
- **What triggered this:** the dev worker (`project--…-dev.lovable.app`) still behaves like the build before `410f1cb` (generic taxonomy routes not applied; one-page Charlotte Souza test without `person.year_started` at 11:05-12:54 UTC, after a green "Sync Main" run and an empty rebuild commit). Cause unknown (stale deployment or a silent runtime fallback in `harvestRoutes`); raised with DevOps. Owner approved "Option A" and asked not to change `disco-harvest-worker.ts` again.
- **Done:** backfill re-run on all 2,780 Schwab rows (work history 2,778, start year 2,772, office street 1,562 again; the 20 rows re-harvested earlier fixed); re-harvest resumed at 12:57 UTC (2,776 detail pages re-queued).
- **Plan:** when the re-harvest is through (about 18 hours at about 2.5 pages a minute), one final backfill (the backfill computes the generic routes itself, so the start year returns without the worker fix), refresh marks, then the final republish. Until then re-harvested profiles may show no start year. Check-in scheduled for 2026-10-13 07:00 UTC.

## Station 6 stopped by rejected_reason values — fixed (2026-10-13)
- **What triggered this:** cron 96 (`etl-resolve-tick`) failed from 2026-10-12 12:41 UTC (64 failures by 15:42) and on every run from 14:39 UTC; nothing reached the graph. Owner approved "Station 6 rejected_reason fix".
- **What was wrong:** `exp_etl_staging.rejected_reason` only accepts `provably_wrong`, `contradicts_higher_authority`, `failed_validation`, `prohibited_class`, `pii`, `malformed` (check constraint). Station 6 (Phase 1A/1B) wrote descriptive reasons (`malformed: no person.name`, `identity_conflict: …`, and the catch-all `SQLSTATE: message`). A refreshed Edward Jones record without a name (stage 94a2635b, adam-jones) hit this; the failed update aborted the whole batch of 80, and as the oldest queued row it was picked by every run.
- **Change (database, `exp_etl_resolve` only):** reasons written as `malformed` (no name / profile URL / location name) or `failed_validation` (identity conflict, missing source, unexpected error); the detail goes to `identity_candidates._reject_detail`. A refreshed record of an existing entity with no name / URL keeps its status (the entity stays) instead of being rejected. Previous definition in `exp_curation_ledger` 292020.
- **Verified:** rolled-back run: 80 rows in 12 s, adam-jones stays `created` with detail "no person.name". Live: runs 02:52 and 02:53 UTC succeeded (12 s each); queue 7,406 → 7,266 and falling.
- **Rollback:** restore ledger 292020 (would bring the failure back).

## Taxonomy fields → graph nodes: validation dry run (2026-10-13, read-only)
- **What triggered this:** owner asked for generic validation of taxonomy values (by registry schema.org property) before any taxonomy value becomes a graph node; "go ahead with the taxonomy dry run". Nothing written.
- **Rules applied (SQL, per value):** in registry; registry ring maps (exp_ring_crosswalk) to a proof ring; subject not firm; not site-wide (≥90% of the source's rows, ≥25% for descriptions); not the same fact as a static field (name contained, address ZIP + street, credential name, phone digits, equal text); description not a job-history list; property format checks (telephone 10 digits, email, links http(s) / not home page / not this page / sameAs on another site, name ≤120 chars, credential ≤200, address with ZIP, geo with lat/long).
- **Results (resolved staging rows):**
  - Schwab (2,419): names, phones, addresses, CFP credentials all duplicate static; 2,259 bios are job lists; 160 bios pass (still look like short job lists); booking URL = firm home page (firm fact).
  - Morgan Stanley (6,421): names, titles, phones, fax, photos, addresses (6,399) duplicate static; 2,048 bios site-wide text, 1,789 duplicate static, 2,537 pass (these are bios the static quality rule dropped as not about the person); 429 scheduler links pass; geo 6,421 pass (to compare with static lat/long); toll-free 2,541 pass (one firm-wide number → firm fact).
  - Edward Jones (19,387): names, credentials, phones, fax, photos, addresses duplicate static; contact_action 19,373 pass (profile page + #anchor → should count as "this page"); hours 17,042 pass (to compare with static location.hours).
  - compass (16,174): names, email, phones, photos, addresses duplicate static; office_phone_number 4,054 pass (real office lines the static layer does not have); press mentions 4 links pass, 100 are headlines without a link.
- **Conclusion:** for the four current sources the taxonomy layer mostly repeats static fields (the site mapper already routes most values into static). Real new facts: compass office phones (~4,054), Morgan Stanley scheduler links (~429), a few press links. Rule refinements needed before any build: "#anchor" counts as this page; one phone on many offices = firm number; geo and hours compared field by field with static; descriptions must pass the same bio rules as person.bio (list-like, about the person).

## US phone numbers stored as 10 digits (our sources only) (2026-10-13)
- **What triggered this:** owner: phone numbers should be proper US format; scope is US only, store 10 digits; State Farm data not converted. Approved "10-digit US phone (our sources only)".
- **What was wrong:** staged phones were E.164 (`+18605704059`) and profile pages showed that text as-is; the formatter accepted any 10 digits or any `+` number (7 invalid compass values such as `0000000000`).
- **Changes (code, needs merge + deploy):**
  - `-disco-site-contract.ts`: new `toUSPhone10` for the staging `phone` format: 10 digits, leading 1 dropped, extensions ignored; only valid North American numbers (area code / exchange 2-9, not one repeated digit, not 1234567890, not 555-01xx). `toE164` unchanged (used by NORA modules).
  - New `src/lib/us-phone.ts` (`schemaPhone`, `us10Display`): `displayPhone` shows 10-digit (and older `+1…`) numbers as "(860) 570-4059" with `tel:+1…`; JSON-LD `telephone` in `profile-render.ts` / `profile-graph.ts` adds `+1` to 10-digit values. State Farm's stored format is passed through unchanged.
  - Schema doc section 4: phone format.
  - Checked: 10 sample inputs (valid, extension, leading 1, zeros, fake, foreign, 555-01xx, toll-free); office block keeps working; typecheck 0 errors.
- **Change (database, live):** `exp_validate_profile` (Station 8) accepted only `+1XXXXXXXXXX`; now accepts 10 digits or `+1` + 10 digits (so the gate keeps passing during and after the switch). Previous definition in `exp_curation_ledger` 309926.
- **Next (separate approval after deploy):** staging backfill per source (dry run first) to convert existing staged phones, refresh marks, republish Schwab. Note: Station 7's office majority groups by the stored text, so mixed formats in one office are possible until a source's backfill + refresh is complete.

## Years of experience: page value must be a plausible number of years (2026-10-13)
- **What triggered this:** after the generic harvest routes went live, Schwab re-harvests still had no start year. Lovable's agent (plan mode, read-only) found the cause: Schwab's page rule for `person.years_experience` (label "Experience") captures "2026". That non-empty value made the "N years of … experience" reader skip, and 2026 is outside 1–79 so no start year was derived. Approved "years-of-experience plausibility fix".
- **Change (code, `-disco-site-contract.ts`, `buildStagingStatic` step 4, needs merge + deploy):** a page value for `person.years_experience` counts only if its number is 1–79; anything else (a 4-digit year, 0, no number) is discarded with its source, so the reader on the person's own bio text can fill it, then `person.year_started` is derived as before. Generic (any site); no change to the harvest worker or the database.
- **Checked (offline):** page "2026" + bio "10 years of professional experience …" → start year 2016 (derived); numeric 2026 → 2016; page "12" kept → 2014; "Since 2015" with no bio → nothing; "0" + bio → 2016. Typecheck 0 errors.
- **Next:** after deploy, re-run the one-page Charlotte Souza harvest test to confirm `person.year_started`; then the Schwab final backfill / refresh / republish (Option A) picks it up.
- **Rollback:** revert the commit.

## Charlotte Souza one-page re-harvest test: start year confirmed live (2026-10-13)
- **What triggered this:** confirm the deployed harvester carries the years plausibility fix (PR #74, deployed 05:39 UTC). Approved "Charlotte one-page re-harvest test".
- **Change (live data, one row):** `exp_etl_frontier` 20227110 (schwab.com …/charlotte-souza) done → queued at 06:02 UTC.
- **Result:** fetched 06:03, staged 06:04 (stage cc6d77e9): `person.year_started` 2016 (no implausible years value kept), `person.phone` 8605704059 and `location.phone` 8605704040 (10-digit, office line distinct), 6 work-history entries. Generic taxonomy routes, office block, 10-digit phones and the years fix are all live on the dev worker.
- **State before Option A finish:** the overnight Schwab re-harvest (done 21:42 UTC 2026-10-12, old code) left start year on 19 of 2,780 Schwab rows; the final backfill (separate approval) restores it.

## Staging backfill dropped stored actions and credential details — restored and fixed (2026-10-13)
- **What triggered this:** owner approved "backfill MS, EJ, compass (A)" (10-digit phones, office block, years rules on all our sources). After Morgan Stanley (all 6,428) and Edward Jones (10,000 of 19,462) were written, a content check against the live entities showed losses; writes stopped (compass only dry-run).
- **What was wrong (verified on live data):** the backfill feeds stored, already formatted values back into `buildStagingStatic`, which reads page form. `asStrings` flattens objects to their name or url, so stored actions ({label, url, type}) lost their label (dropped, or relabelled from the taxonomy slug) and stored credentials lost `number` / `state` / `issuer`. Morgan Stanley: credentials with a number 5,538 → 1,055 rows, with a state 5,901 → 1,223; "Schedule Meeting" action lost on 637 rows. Edward Jones: 1,149 "Email Me" actions relabelled "Contact" (same link). compass would have lost licence states on 18,702 rows and 5,219 "Call Office" actions. Schwab: no difference. The dry run compared only how many rows had each field, so it did not show this.
- **Restore (live data, approved "restore actions and credentials (MS, EJ)"):** `person.actions` and `person.credentials` copied back from `exp_entity.attributes` (untouched, Station 6 had not re-run) into `exp_etl_staging.identity_candidates.universal` where they differed: Morgan Stanley 5,964 rows, Edward Jones 1,149. Re-check: 0 differences on every key except the expected phone / fax format (one Edward Jones record that already differed before is unchanged).
- **Fix (code, `disco-staging-backfill.ts` only, approved "backfill fix for actions and credentials", needs merge + deploy):** stored actions go back in as page form (label + url) so label and link survive and the current action rules still apply; stored credentials are kept as stored and the rebuild only adds entries with a new name; the dry run now also returns `changed` (rows whose value differs by content per static id).
- **Checked (offline, real rows):** Morgan Stanley (3 with actions + numbered credentials, 2 without actions), compass (3 with "Call Office" + licence states), Edward Jones (3 with "Email Me"): old code changed actions / credentials on every sample; fixed code changes none (only the expected phone format, and hours entries reordered with the same content). Typecheck 0 errors.
- **Not yet done / open:** after deploy, full dry runs with `changed` for Edward Jones and compass, then resume the approved backfill (Edward Jones remaining 9,462 rows, compass all). Refresh marks (C) and the publish cron (D) wait for that.

## Mapping worker on; kw.com remapped with the current mapper (2026-10-13)
- **What triggered this:** owner wants to map and run new sites from the UI, starting with kw.com. Approved "mapping worker on + remap kw.com" and "save new kw.com contract".
- **What was found (live data):** cron 89 `disco-ai-worker-drain` was inactive, so Remap requests were never processed (0 pending; 5 old `map_site` rows stuck at 'sent' — Morgan Stanley ×2, Edward Jones, Schwab from 2026-09-25, realtor.com 2026-10-05 — left as they are: the worker only takes 'pending', so they can never re-run). kw.com's contract (2026-09-30, proposal 104) was an older generation (no boilerplate / site-wide action and media filters, no static routes); a remap on 2026-10-07 was not saved (field floor 17 < 19).
- **Changes (live):**
  - `cron.alter_job(89, active := true)` — the worker only acts when a request is pending.
  - `disco_request_remap_site(kw.com)` → request 149: new contract 25 fields (old 21), 14 taxonomy fields, routes for office address (street / state / ZIP), languages, headshot gallery; agent sitemap recorded; field floor 18 (per sample 18, 15, 13, 10, 10, 10, 9, 9, 9, 9). Not auto-saved (18 < 19 measured by the older mapper).
  - Saved on owner approval with `disco_map_site_ingest(149, <new contract>)` (the worker's own save path) at 08:14 UTC. Dropped field: `location.email` (it read a mailto link inside the agent's own top card, found on 1 of 5 samples; the agent email from JSON-LD Person.email is kept).
- **Rollback:** re-ingest proposal 104's payload (old contract); `cron.alter_job(89, active := false)` stops the worker.
- **Note:** while the worker is on, Remap on an active source (compass, Schwab, Edward Jones, Morgan Stanley) would replace that source's contract mid-harvest — avoid until their harvests are done.
- **Next:** owner clicks Run on kw.com (test pull → field-yield gate → active → harvest from the agent sitemap) at the current limits (400 pages a day, 30 s delay, 02:00-06:00 ET); about 146,800 agents in total.

## G1: one mapper behind Map — version 2 list discovery + version 1 field learning (2026-10-13)
- **What triggered this:** Universal Site Engine Plan, gap G1 (owner: "proceed with G1"). Approved "G1 code (V2 list discovery + V1 field learning in Map)" and "G1 worker timeout 900 s (structural)".
- **What was wrong (verified on live data):** the Map / Remap path ran site mapper version 1 only. Version 1 learns fields but often cannot find the profile list: bhhs.com (request 151) reached only account pages (no sitemap in robots.txt, search behind JavaScript). Version 2 (dry-run only) found bhhs.com's agent sitemaps (`sitemap-agent0..2.xml`, ~30,000 agents, coverage 100%, 100 s, $0.15). Version 1's learner given version 2's pages failed must-have city / state because all 7 samples came from one office.
- **Changes shipped (code, needs merge + deploy):**
  - `disco-agent-mapper.ts`: `runV2Research()` (version 2 research as a function, one call, writes nothing) and `spreadProfileUrls()` (up to 60 sample profile pages spread over the site's sections, e.g. office / city). The endpoint itself stays dry-run only.
  - `disco-ai-worker.ts`: `mapWithV2()` — the map job runs version 2 (480 s, cost cap `DISCO_V2_BUDGET`, default $3), then version 1 with the spread samples (`profile_urls`, the path dry runs used); `applyV2()` adds `site_contract.list_route`, records version 2's sitemaps as `profile_sitemaps`, and uses version 2's profile pattern when version 1's matches < 90% of the samples. Version 2 failing / not finishing = version 1 alone (as before). `prompt_input.v1_only = true` forces version 1 alone. The request response / error carries a `v2_research` summary (outcome, cost, sources, estimate, log).
  - Active-source guard: a remap of an `active` / `test_pull` source is never saved over its contract; it is kept as a proposal (`response.new_contract`, `kept_existing_contract`) until the review screen (G2).
  - Dry run: `disco-ai-worker` dry run with `engine: 'v2'` runs the same Map path without saving.
  - Schema doc section 1: `list_route`.
- **Change (database, structural, live):** `exp_disco_ai_worker_tick` (schedule 89): `timeout_milliseconds` 300000 → 900000 with a Fix comment; nothing else. Previous definition in `exp_curation_ledger` 314611.
- **Verified:** typecheck 0 errors; `spreadProfileUrls` offline (4 offices × 30 agents → 12 samples, 3 per office, spread through each office).
- **Not yet done / open:** after deploy, combined dry runs (`engine: 'v2'`, nothing written) on bhhs.com, kw.com, compass.com, schwab.com, edwardjones.com, morganstanley.com, remax.com, zillow.com (about $5), compared with today's contracts. Listing / API list routes are recorded but not harvested (G3). Review and accept in the UI is G2.
- **Rollback:** revert the commit; restore ledger 314611 for the tick.

## G1 verified: combined Map dry runs on eight sites (2026-10-13)
- **What triggered this:** G1 merged (PR #75, deployed 09:31 UTC); the plan's check before Map is used live. `disco-ai-worker` dry runs with `engine: 'v2'` (pg_net 50134-50137, 50181-50184), nothing written.
- **Results (new vs saved contract: fields / field floor; version 2 list route, coverage, estimate, version 2 cost):**
  - remax.com: 35 / 32 vs 24 / 22; agents sitemap, 100%, ~55,000, $0.14 — harvestable.
  - compass.com: 23 / 20 vs 20 / 18; agent-pages sitemap, 100%, ~35,000, $0.09 — harvestable.
  - edwardjones.com: 33 / 24 vs 33 / 24; financial-advisor sitemap, 100%, ~19,800, $0.12 — harvestable; flag: edwardjones.ca (sister domain, not used).
  - morganstanley.com: 31 / 30 vs 30 / 27; advisor sitemap, 100%, ~7,000, $0.10 — harvestable; version 2 rejected a team page as the sample and picked an individual; flag: yextapis.com (third party, not used).
  - schwab.com: 26 / 23 vs 24 / 21; branch pages → consultant links (listing), 100%, ~3,000, $0.19 — needs G3.
  - kw.com: 27 / 22 vs 25 / 18; directory pages + daily sitemaps (listing), 50%, ~146,800, $0.14 — needs G3.
  - bhhs.com: 13 / 11, required fields now pass (none saved before); own search API (listing), 53%, ~39,500, $0.25 — needs G3. (Version 2 found the agent sitemaps in the earlier run; this run chose the API.)
  - zillow.com: 16 / 17 (none saved before); ZIP directory (listing), 90%, ~500,000, $0.48 — needs G3.
  - Version 2 total $1.51; 137-431 s per site, all within the 900 s limit.
- **Conclusion:** every site matches or beats its saved contract on fields and floor; four list routes are harvestable today (sitemaps), four need G3.
- **Seen, not yet changed:** version 2 hands over only ~10 validated samples per site, so the spread over offices is limited to those; version 2 does not always choose the sitemap when one exists (bhhs.com). Both are follow-ups for the owner to decide.

## G2: contract review in the UI — proposals, preview, Accept / Reject; save rule D1 (2026-10-13)
- **What triggered this:** Universal Site Engine Plan, gap G2. Approved "G2 code (proposals, review panel, preview, accept/reject)", "G2 database functions (accept, reject, remap on active) (structural)" and "D1: auto-save first contract only".
- **What was wrong:** the mapper decided alone. A working saved contract was replaced only when the new one was "not worse" on field floor / required fields / reach, so a richer kw.com contract (25 fields vs 21, floor 18 vs 19) was dropped and had to be saved by hand (request 149); active sources could not be remapped from the UI at all (`disco_request_remap_site` accepted only `approved`).
- **Changes shipped (code, needs merge + deploy):**
  - `disco-ai-worker.ts` (save rule D1): only a site's first contract that meets the required fields saves itself; every other map result is stored as a pending proposal in `disco_proposals` (kind `site_map`, state `pending`, payload = contract + `domain`, `request_id`, `proposed_at`, `save_check` with the comparison kept as `compare_reason`). Replaces the G1 active-source guard. The request row still gets `kept_existing_contract` + `new_contract`.
  - `src/lib/site-proposal.functions.ts` (new): `previewSiteProposal` server function (admins only, read-only) — opens up to 5 of the proposal's sample pages and builds the records with the proposed contract using the harvest's own exported builders (`applySiteContract`, `applyAddressOwner`, `applyExtraFields`, `buildHarvestRecord`); the category's generic taxonomy routes the harvest adds at run time are not in the preview.
  - `site-contract-proposals.tsx` (new) inside `site-contract-panel.tsx`: "Proposal waiting for review" — saved vs proposed (fields, field floor, required fields, profile page pattern, sitemaps, list route, harvestable, version 2 cost), per-field hits with new / dropped marks, Preview records, Accept / Reject with confirmation, proposal history.
  - `source-registry-tab.tsx`: Remap shown for `approved`, `active` and `test_pull` sources.
- **Changes (database, structural, live):**
  - New `disco_accept_site_proposal(bigint)`: admins only; saves through the unchanged `disco_map_site_ingest`; the approved copy it records gets `domain` / `accepted_from`; the pending proposal and other pending ones of the site are `superseded`; an active source goes to `test_pull` with a new `exp_etl_runs` row (trigger `contract_accept`), so the next 10 records staged with the new contract go through the field-yield gate (existing rule: PASS → active, else paused); audited (`site_contract_accept`).
  - New `disco_reject_site_proposal(bigint)`: admins only; state `rejected`; audited (`site_contract_reject`).
  - `disco_request_remap_site`: status check `approved` → `approved, active, test_pull` (only change). Previous definition in `exp_curation_ledger` 315535.
  - EXECUTE for `authenticated` / `service_role` only (revoked from PUBLIC / anon).
- **Verified:** rolled-back tests — Accept remax.com (approved): contract floor 22 → 32, agents sitemap recorded, list route harvestable, approved copy 127 carries domain, the second pending proposal closed; Accept kw.com (active): floor 18 → 22, source → test_pull with a `contract_accept` run; Reject of a closed proposal refused; Reject of a pending proposal → rejected; no login → `insufficient_privilege`; 2 audit rows. Typecheck 0 errors.
- **Not yet done / open:** live test after deploy (remap kw.com → proposal → preview → reject; remap remax.com → proposal → accept → Run). An accepted contract on a source whose queue is empty stays in test_pull until pages are queued again (gate needs 10 new records). The C14 shared extra-key list is refreshed by the worker after an auto-save only, not after Accept.
- **Rollback:** revert the commit; drop the two new functions; restore ledger 315535.

## G2 follow-ups: Accept re-queues 20 sample pages; shared extra-key refresh after Accept (2026-10-13)
- **What triggered this:** the two limits reported with G2. Approved "Accept re-queues 20 sample pages (structural)" and "shared extra-key refresh after Accept (code)".
- **What was wrong:** (1) Accept puts an active source in test pull, but the gate needs 10 new records or 20 pages attempted since the run start; a finished harvest (Schwab, Edward Jones, Morgan Stanley) has nothing queued, so the source would stay in test pull. (2) The category's shared extra-key list (C14 / C14b / C14c, `exp_field_discovery` extra_field rows) was refreshed only by the mapping worker after an auto-save, not after Accept.
- **Change (database, structural, live):** `disco_accept_site_proposal` — when the source was active, up to 20 of its `done` profile pages that match the new profile page pattern, spread evenly over the URL list, are set back to `queued`; the harvester re-reads them with the new contract and the existing gate decides (PASS → active, else paused, old records unchanged). The count is returned (`requeued`) and audited. Previous definition in `exp_curation_ledger` 315870.
- **Changes (code, needs merge + deploy):** new `-disco-extra-keys.ts` (`refreshExtraKeys`, the C14 logic moved out of `disco-ai-worker.ts` unchanged); the worker calls it after an auto-save; new `acceptSiteProposal` server function (database Accept with the reviewer's own session, then `refreshExtraKeys` for the category); the review panel's Accept uses it and shows the re-queued count.
- **Verified:** rolled-back Accept on morganstanley.com (active, queue finished): 20 pages re-queued, spread A → T (aaron.blum … todd.d.stevens), source → test_pull, audit `requeued: 20`. Typecheck 0 errors.
- **Rollback:** restore ledger 315870; revert the commit.

## Schwab finished: CA-licence numbers recovered, all passed profiles published (2026-10-13)
- **What triggered this:** approved "Schwab Option A finish" and "Schwab 518 CA-licence re-harvest + refresh" (the 06:07 backfill, before fix `22fe66b`, had dropped the CA insurance licence number 0B27845 from the credentials of the CA-licensed Schwab advisors; Station 6 had already copied that into the entities).
- **Done:** 533 schwab.com profile pages re-queued at 07:46 UTC and re-harvested (ingest marked each record for Station 6); Stations 6-8 through (Station 6 queue 0, Station 7 / 8 pending 0). CA-licence records with the number: 533 of 537 staged (4 pages were not in the done queue), 514 entities. Then `exp_etl_publish_tick(100, ARRAY['schwab.com'])` until nothing was left: 2,328 published (100 per call, 0 errors, 0 unpublished) — every Schwab professional that passes Station 8 (2,420 active, 2,328 passed).
- **Verified:** Charlotte Souza (`/p/charlotte-souza-west-hartford-ct`): 21 graph nodes incl. 6 work-history nodes and "In the profession since 2016"; her phone 8605704059; office `charles-schwab-co-inc-west-hartford-ct` phone 8605704040 (shown as (860) 570-4040). 499 active graph nodes carry licence number 0B27845. Staging: 2,772 start years, 0 phones left in +1 format.

## Backfill resumed with the fixed code: Edward Jones and compass done (2026-10-13)
- **What triggered this:** approved "backfill MS, EJ, compass (A)", paused after the action / credential loss until fix `22fe66b` was merged and deployed (it was, with PR #75).
- **Dry runs (content check, nothing written):** Edward Jones 19,462 rows — changed by content only `person.phone` / `location.phone` 9,423 (10-digit format), `location.fax` 9,423, `person.fax` 7,322, `location.hours` 415 (same entries, new order); no change to actions or credentials. compass 23,310 rows — `person.phone` 21,118 (format; 8 invalid numbers dropped), `person.year_started` +750 (372 → 1,122), `person.bio` 25 changed by content (still present); actions and credentials unchanged.
- **Written (batches of 500, pg_net 50684-50742 and 50830-50896):** Edward Jones 19,462 (0 phones left in +1 format; re-check against the entities: no differences in actions, credentials or any other key except phone / fax format); compass 23,330 (0 phones in +1 format, 1,123 start years, 5,775 "Call Office" actions and 19,678 licence states kept).
- **Not yet done / open:** refresh marks (C) so Stations 6-8 apply the new values to the Edward Jones, Morgan Stanley and compass entities; publish schedule (D). Both await approval.

## G2 verified live from the UI: kw.com rejected, remax.com accepted (2026-10-13)
- **What triggered this:** the owner's live check after G2 + follow-ups were deployed (PR #76, #77).
- **kw.com (active):** Remap 11:01 UTC (request 152) → proposal 132 (floor 22 vs saved 18, version 2 $0.12), kept for review by rule D1 → rejected 11:09 (audit `site_contract_reject`); kw.com keeps its contract (floor 18) and stays active. Note: the saved-contract re-check reported "2 of 3 sample pages fail", both "missing state" — one agent in Turkey, one without an office state; under the old not-worse rule this would have replaced the contract automatically.
- **remax.com (approved):** Remap 11:02 (request 153) → proposal 133 → accepted 11:15 (audit `site_contract_accept`, re-queued 0 because the source was not active); contract saved: 31 fields, floor 22 → 29, agents sitemap recorded, list route harvestable; approved copy 134 (`accepted_from` 133), proposal 133 superseded.
- **Next:** Run remax.com from the Discovery page (test pull → gate → harvest, ~55,000 agents).

## Refresh marks (C), publish schedule (D) created inactive, remax.com seeded (2026-10-13)
- **What triggered this:** owner approved refresh marks (C) and the publish schedule (D), then "re-queue remax.com agents sitemap" (owner raised remax.com's limits to 10,000/day, 3 s, all day).
- **Refresh marks (live data):** `observed_at = now()` on created staging rows at 11:40 UTC — compass 22,745, Edward Jones 19,388, Morgan Stanley 6,421 (48,554; Station 6 ~10 h at 80/min).
- **Publish schedule (structural, live):** `cron.schedule('etl-publish-tick', '* * * * *', 'SELECT public.exp_etl_publish_tick(100)')` = job 104, then `cron.alter_job(104, active := false)` (0 runs). It is switched on after Stations 6-8 are through the refreshed rows (check-in 22:15 UTC), so profiles are published once with the refreshed data. Publishing is idempotent (one professionals row per entity; graph nodes upserted by value). Rollback: `cron.unschedule('etl-publish-tick')`.
- **remax.com:** Run (11:19 UTC) did not seed the queue because remax.com still had queue rows from the old pipeline (2026-08-02) and Run seeds only an empty queue (plan G4). The agents sitemap row (`agents-index.xml`, legacy kind `sitemap_index`, parsed) was set to kind `sitemap`, status `queued` (11:44); it queued 49,619 agent pages. First 10 records staged (names, 10-digit phones, emails, city / state, start years); the gate came back BLOCKED (7 of 10 meet the floor, 21 of 29 fields needed; PASS needs 80%) — 3 agent pages carry only 12 fields — and the source is paused.

## G3: harvest any list route — list worker, list_page queue kind, Run seeding from the contract (2026-10-13)
- **What triggered this:** Universal Site Engine Plan, gap G3 (+ the Run-seeding part of G4). Approved "G3 code (list worker + Run feedback)" and "G3 database (list_page kind, fetch tick, collector, Run seeding) (structural)". (The proposed gate-rule change was not approved and is not part of this.)
- **What was wrong:** the harvest read only sitemaps and HTML roster links. Sites whose profiles are listed through directory pages with paging, a search API or hub pages (kw.com full roster ~146,800, bhhs.com ~39,500, schwab.com branch → consultant ~3,000, zillow.com ~500,000) could not be harvested. Run seeded only a site with an empty queue, so remax.com (queue rows from the old pipeline, 2026-08-02) got nothing from its new contract.
- **Changes (code, needs merge + deploy):**
  - `-disco-agent-engine.ts`: `runListUnit()` + `ListUnit` (additive): one resumable unit of a version 2 list route — a listing seed from a start page (up to 5 pages, then a follow-on unit), seed expansion (`root` → one unit per combination, adaptive alphabet children), one link_crawl hub page, one autocomplete prefix. Same request / paging / extractor / seed code as `runConfig`.
  - New `disco-list-worker.ts` (route `/api/public/disco-list-worker`): runs one unit with the contract's `list_route` and the harvest's own profile page pattern, requests spaced by the source's `min_delay_seconds` (max 10 s), no AI, no cookies / login headers; returns `profile_urls` and `next_units`; writes nothing. Dry runs: one unit, `full: true` (whole route with `runConfig`, counts only) and `config` (a version 2 config tested before it is saved).
  - `disco-agent-mapper.ts`: `oxyFetch` exported (unchanged). `disco-ai-worker.ts`: listing / link_crawl / autocomplete count as harvestable list routes.
  - `category-population-tab.tsx`: Run shows what it seeded (sitemaps, list route starts, or the old fallback).
  - `routeTree.gen.ts`: the new route added (same entries as the other workers).
- **Changes (database, structural, live):**
  - `exp_etl_frontier_kind_check`: + `list_page`.
  - `exp_etl_fetch_tick`: `list_page` rows go to `disco-list-worker` (same body as the harvest worker, 250 s); pace, quota, in-flight caps unchanged.
  - `exp_etl_fetch_collect`: a `list_page` response queues its profile URLs as `detail_page` (known URLs skipped by `exp_etl_frontier_discover`) and its next units as `list_page` (`ON CONFLICT (url) DO NOTHING`); status parsed / empty / error. Placed before the harvest-response branch.
  - `exp_etl_run_source`: seeds from the contract — `profile_sitemaps` as `sitemap` rows and one `list_page` start unit (`<start url>#list=root:<n>`) per listing / link_crawl / autocomplete source; existing rows for those URLs are reset to the current kind and queued (unless queued / fetching); the old seeding stays for contracts with neither and an empty queue; counts on the run row (`detail.seeded_sitemaps`, `seeded_list_units`, `seeded_fallback`).
  - Previous definitions in `exp_curation_ledger` 317078 (fetch tick), 317079 (collector), 317080 (Run), 317081 (kind check).
- **Verified:** rolled-back Run on remax.com → `seeded_sitemaps 1` (the old `agents-index.xml` row reset to sitemap / queued); rolled-back Run on kw.com with its version 2 list route → `seeded_sitemaps 1, seeded_list_units 1` (`https://kw.com/agents#list=root:0` queued). Offline engine test on a fake site: directory of 23 pages → 6 units, 276 profile URLs (all); 2 state seeds → 11 units, 552. Typecheck 0 errors.
- **Not yet done / open:** after deploy, dry runs of the list worker on bhhs.com (API vs agent sitemaps within 5%), kw.com (first 50 directory pages) and schwab.com (branch pages ~3,000), then a live run once a contract with a list route is accepted. A re-Run does not re-walk list pages already parsed (only new sitemap URLs and new list units are added).
- **Rollback:** revert the commit; restore ledger 317078-317081.

## G3 dry runs after deploy, and a 29-minute harvest pause caused by them (2026-10-13)
- **Dry runs (`disco-list-worker`, nothing written; configs from the 13:00 version 2 runs):**
  - bhhs.com: agent sitemaps (full) 24,926 profile URLs in 16 s (includes Dubai offices and test entries); search API one unit (5 pages) worked (`max pages (5) reached`, follow-on unit returned); API full run stopped at its 780 s limit with 10,400 URLs and includes team pages (`/t-<n>`), because the version 1 profile pattern also matches teams — not yet comparable within 5%.
  - kw.com: first 50 directory pages + daily sitemaps → 1,248 profile URLs in 370 s (50 × 12 + ~650 from sitemaps).
  - schwab.com: branch pages → consultant links, 2,232 consultants before the 780 s limit (staging has 2,780).
- **Incident:** the three `full` dry runs were sent through pg_net with 840 s timeouts. pg_net (0.20.3) handles a batch of queued requests together and starts the next batch only when the slowest one finishes, so the fetch tick's harvest requests queued behind them: no harvest results from 13:11 to 13:40 UTC (pages in 'fetching' are re-queued by the collector after 10 minutes; no data lost). A `net.worker_restart()` at 13:24 did not shorten it. The same effect applies to any long pg_net call, including the mapping worker's 900 s limit set for G1 (a Remap can pause the harvest for up to 15 minutes).
- **Not yet done / open:** never send long dry runs through pg_net again (unit-sized only); a fix for the mapping worker (return at once and finish in the background, or split version 2 across calls) needs the owner's approval; tighten bhhs.com's profile pattern (teams vs agents) before its list route is accepted.


## Map in steps: no long map call on the shared pg_net queue (2026-10-14)
- **What triggered this:** on 2026-10-13 a 15-minute map call (G1 timeout 900 s) and two 840 s dry runs held the shared `pg_net` queue, so harvest requests waited from 13:11 to 13:40 UTC. The owner asked for the mapping worker not to hold the queue.
- **What was wrong (verified on live data):**
  - The hosting stops a request's work when its caller disconnects: 5 map requests have stayed at `sent` with no result and no error (morganstanley.com 50 and 53, edwardjones.com 55, schwab.com 60 on 2026-09-25; realtor.com 139 on 2026-10-05). So "reply at once and finish in the background" is not possible (Cloudflare allows about 30 s after the reply).
  - Option A (a synchronous `http` add-on call from the cron, outside the queue) was approved but Lovable Cloud refused the extension (`unsupported_extension: ... does not support the PostgreSQL extension(s) http`); nothing was changed then (only the before-copies were saved to the ledger, ids 347716 / 347717).
  - Resume test (dry run, pg_net 61218-61396, bhhs.com, 2-minute calls, nothing written): version 2 resumed correctly over 9 calls (12 turns, 287 s of research, $0.20, 269k prompt tokens read from cache) and returned the same route as before (agent sitemaps `sitemap-agent0..2`, 24,926 profiles). Two lessons: 2-minute calls allow only 1-2 turns each (heavy tools wait when less than 100 s remain), and the saved state reached 1.1 MB, 740 KB of it browser network records.
- **Changes shipped:**
  - Code (commit `116edb9`, merged in PR #80): `disco-agent-mapper.ts` adds `runV2Step` (one version 2 step of up to 240 s; returns the full research state to continue, or the finished result; browser records stored trimmed to 40 records with bodies cut to 8 KB; safety stop after 10 steps) and `finishResearch` (shared with `runV2Research`). `disco-ai-worker.ts` (`drain`, map_site): one map step per worker call. Version 2 steps save `response.v2_state` and set the request back to `pending`; the finished version 2 result is saved as `response.v2` (`map_step: 'v1'`) and the next call runs version 1 field learning with a 255 s limit (`V1_STEP_LIMIT_MS`, so the save check and save fit in the call), then the normal save path (first contract or proposal). `mapWithV2` takes a precomputed `v2`; `mapSiteWithLimit` takes an optional limit. Dry runs, `discover_companies`, `classify_method` and `prompt_input.v1_only` are unchanged.
  - Database: `exp_disco_ai_worker_tick` timeout 900000 -> 300000 ms (Fix comment "map in steps"; before-copy in `exp_curation_ledger` 347716), applied after the code was live.
- **Verified:** live remap of bhhs.com (request 154, 2026-10-14). Version 2 step 1 (call at 06:50) continued, step 2 (06:54) finished with a config (saved at 06:54:26, `map_step: 'v1'`), version 1 ran in the 06:56 call. No call timed out and nothing was left at `sent`. Harvest kept running: one 2-minute harvest batch (06:51) was sent at 06:53 while step 1 ran, versus the 29-minute pause before.
- **Not yet done / open:**
  - Request 154 ended in an error in the version 1 step: `homepage fetch failed (0 time cap)` (the 60 s cap on `https://bhhs.com/`); earlier bhhs.com version 1 runs got past the homepage (requests 150 / 151 / 122 failed later, on detail pages). Not caused by the steps; a retry needs a new remap.
  - On a version 1 error the request's `response` is replaced by the error, so the finished version 2 result is lost and a retry repeats version 2. Keeping `response.v2` on error (retry from version 1) is a possible follow-up.
  - The size of the saved step state was not captured on the live run (step 1 state was overwritten by step 2); measure on the next multi-step map.
  - A 4-minute step can still delay one harvest batch by up to about 2 minutes (pg_net batches).
  - The 5 old map requests at `sent` are left as they are.


## Map: fields-only version 1 after version 2, and the detail route (site's own profile API) (2026-10-14)
- **What triggered this:** the owner asked for one final contract with no repeated steps (cost-effective, high coverage), and for API routes to be read as JSON: a list API is only for finding profiles, and each profile should come from the richest per-profile source (a profile API when the site has one).
- **What was wrong (verified on live data):**
  - With version 2 in front, version 1 still repeated version 2's navigation (homepage, subdomain robots.txt, sitemap walk, directory page, listing navigation, route measures) and could fail there: bhhs.com request 154 failed at the homepage fetch (60 s cap) after version 2 had finished; requests 122 / 150 / 151 failed on detail pages.
  - Version 1's route outputs: `roster_pattern` is used only by the old roster crawl (`exp_etl_fetch_collect` index pages, `exp_etl_frontier_discover`); `extraction.best_route` is read by no database function or harvest code (only the save-rule comparison and the report), and its reach values are capped low bounds (compass 500, Edward Jones 500, Morgan Stanley 120, Schwab 499 against 24k / 19k / 6.4k / 2.3k harvested). The network-call route was report-only (never harvested).
- **Changes shipped:**
  - `b6b86ec` (PR #81) `disco-ai-worker.ts` (`mapSite`, `mapWithV2`, `applyV2`): when version 2 hands over its profile pages, version 1 skips subdomain robots.txt, the sitemap walk, the directory page pick, listing navigation, the profile-rule form checks, the background-call capture, the search route and the search fallback; it checks version 2's pages and learns the fields. Version 2's profile pattern is used when it matches the accepted page and 90% of the handed-over pages. A homepage that does not load no longer stops the run. `roster_pattern` is empty; `best_route` comes from version 2's measured estimate. Without version 2 the run is unchanged. Dry runs: `v2_pattern` + `profile_urls`.
  - `44067a9` (PR #81) new `-disco-detail-api.ts` and a new map step `detail` between version 2 and version 1: up to 2 sample profile pages are captured; a call is kept only when it is on the site, returns JSON with this profile's id or name words, is not a list (25 objects or fewer) and carries the profile's id or slug in its request; it must replay outside the browser (no cookies or login / session / token headers) for 3 different profiles, each returning its own data and not another profile's. A JSON field map is learned from up to 20 profiles (one AI call proposes JSON paths; code keeps a path only with values on half the profiles and plausible phone / email / URL values). The version 1 step records `site_contract.detail_route` with `record_source` `api` (required fields on 80%+ of profiles and the API's median field count at least the page's), `api+page` (the page adds fields) or `page` (no usable profile API), with the measurements, the API call template and the probe report. Dry runs: `phase: 'detail'`, and `detail` on a version 1 dry run.
  - `566700c` (PR #82): the probe captures 2 pages at once (up to 100 s each) and a third when both fail, and says when every capture failed; a fields-only run always takes version 2's best route (remax.com dry run counted the handed-over pages as a sitemap reach of 9).
- **Verified (dry runs, nothing written):**
  - remax.com version 1 fields-only (pg_net 64544): 42 s, field floor 29 (saved contract 29), 35 fields (saved 31), required fields OK, version 2's pattern used, roster pattern empty.
  - bhhs.com version 1 fields-only (64595, 65068): 97 s and 47 s, field floor 10 / 9, 15 fields, required fields OK; the homepage did not load in 64595 and the run carried on. First working bhhs.com contract (every earlier version 1 run failed).
  - Profile API: kw.com (64482) none (3 GraphQL calls captured, none held the profile; its GraphQL is the agent search); remax.com (64503) none (session, feature-flag and ad calls only; a Next.js site with the data in the page); bhhs.com (64461) inconclusive (both captures failed: Oxylabs 613, 70 s abort), then after `566700c` (65018) **proven**: `POST https://www.bhhs.com/bin/bhhs/reflexDataServlet.json` with body `{"agentId":<id>}`, the id taken from `cid-(\d+)` in the profile URL, replayed for 3 profiles without cookies. JSON field map: 16 fields (name, first / last name, phone, email, street, city, state, postal code, bio, job title, languages, photo, branch name, profile and social links) on all 6 profiles fetched, required fields on 100%. Version 1 with that result (65068): `record_source: 'api'` (API median 16 fields, page median 7).
  - One test run (65047) used a pg_net response that had already expired (6-hour retention), so it ran the full version 1 without version 2's pages and failed as before; not a code fault.
- **Not yet done / open:**
  - Harvest still reads profile pages for every source: the detail route is recorded but not used. Harvest from the profile API (list worker queues `detail_api` items, a new detail-API worker builds records from the JSON field map, collector inserts them; frontier kind and fetch-tick changes are structural) needs a separate approval.
  - bhhs.com licence fields (`permit[0]...`) were dropped because only 1 of 6 profiles had them: version 2's samples include Dubai agents and test accounts (`tom-tester`, `jv-test-sage-contact-1`). US-only sampling (the pending US-only rule) would give a fairer field map.
  - `person.profile_url` and `person.social_links` were both mapped to `$.contactPoint[*].url`; the profile URL should stay the page URL.
  - remax.com: version 2's pattern covers `/real-estate-agents/...` only; the saved contract also accepts `/usa/en/luxury/real-estate-agents/...` (to check whether those are the same agents).
  - The low bhhs.com page field floor (7-10) is consistent with its profile pages loading their data from the profile API in the browser.


## Harvest from the profile API: disco-detail-api-worker and fetch-tick routing (2026-10-14)
- **What triggered this:** the detail route (previous entry) recorded bhhs.com as `record_source: 'api'`, but the harvest still read profile pages for every source. The owner approved harvesting from the profile API (code and the fetch-tick change).
- **What was wrong (verified on live data):** no worker read a profile API. Checked before building: profile URLs already enter the queue as `detail_page` (Run seeding from sitemaps, the list worker), and `exp_etl_fetch_collect` stages any reply shaped `{ ok, record: { entity_type, payload, identity_candidates, detail_url, shallow }, reason }`, so no new queue kind, collector or list-worker change is needed. `disco-harvest-worker.ts` is left unchanged (owner's rule).
- **Changes shipped:**
  - Code `2d5d91e` (PR #83): new `src/routes/api/public/disco-detail-api-worker.ts` (same input and reply as the harvest worker): builds the profile API call from the profile URL (`detail_route.api`), checks the reply holds this profile, reads fields with `detail_route.json_fields`; `api+page` also reads the profile page and the JSON value wins where both have one; when the API does not answer for a profile the page is used (`page_fallback`, with the API issue). `detail_url` stays the page URL; `payload._contract.detail_source` records the source. Dry run with a contract passed in. `-disco-detail-api.ts`: `jsonValues`, `fetchDetailFor`; the JSON field learner no longer maps `person.profile_url`. Route tree entries.
  - Database: `exp_etl_fetch_tick` sends a `detail_page` to `/api/public/disco-detail-api-worker` when the source's contract (version >= 3) has `detail_route.record_source` `api` or `api+page`; same body and 250 s timeout as the harvest worker (Fix comment "profile API harvest"; before-copy `exp_curation_ledger` 361032). At the change 0 of 21 contracts had such a detail route, so every current source kept its path.
- **Verified:**
  - Worker dry runs on 5 bhhs.com profiles with the contract from mapping dry run 65068 (pg_net 65709-65718), API against page for the same profiles: API records filled 16 / 13 / 12 / 13 / 14 fields, required fields OK on 5 of 5, none shallow; page records filled 8 / 8 / 6 / 6 / 7, required fields missing on 4 of 5 (name, or city and state), 4 shallow. Example (cid-3079691): name, first / last name, job title, phone 8584590501, email, street, city La Jolla, state CA, postal code 92037, bio, languages, photo, Instagram link, year started 2016; `detail_url` = the profile page.
  - After the routing change: cron 90 ran normally (11:33-11:35 UTC, under 1 s), compass.com and remax.com detail pages kept going to the harvest worker.
- **Not yet done / open:**
  - Live test: bhhs.com remap from the UI (it has no saved contract, so the first passing contract saves itself), then Run; watch the test-pull sample (10 records) through the gate and Stations 6-8.
  - bhhs.com licence fields and US-only sampling (see the previous entry).
  - bhhs.com's list route is its agent sitemaps (about 24,926 profiles); the sitemaps include Dubai and test profiles (the pending US-only rule).


## One list unit in flight per site; remap combines list routes; sparse fields; bhhs.com live on the profile API (2026-10-14)
- **What triggered this:** the owner asked for one final contract with full profile coverage and fields (bhhs.com remaps 155-157), and for the first live harvest from the profile API.
- **What was wrong (verified on live data):**
  - JSON field map (request 155): the AI saw only 2 of 12 profile API responses (bio and languages never proposed) and code kept a path only with values on half the profiles (dropped website 4/12, licence number / type / state 4/12, credentials 5/12, team 3/12). Timezone was mapped from the agent's lead-notification preference.
  - Version 1 (read-only check): page rules are kept with a value on 1 or more samples (fine), but the CSS-rule AI call saw only samples 1-2 of 10.
  - Remap 156 found only the agent sitemaps (about 14,000) while the saved contract had the agent-search API (about 38,000); its sitemap source pointed at the root `sitemap.xml` with an include filter only the list worker applies, and `profile_sitemaps` held the root (Run would walk every listing shard).
  - Run (15:47): list units (priority 5) took both bhhs.com slots before profile pages (priority 6); no profile was fetched while about 580 list pages were read.
- **Changes shipped:**
  - `ecf0325` (PR #84) `-disco-detail-api.ts`: the AI sees an inventory of every key path across all fetched responses (profiles with a value, examples); a path is kept with a plausible value on at least 2 profiles and one field per path; fill rate per field (`detail_route.fill_rate`); `[*]` gives one value for single fields, all for list fields.
  - `bf7da31` (PR #85) `disco-ai-worker.ts`: the CSS-rule call also gets a summary of the other samples (text blocks whose structure is not on samples 1-2, how many show them, one example; at most 80 blocks / 10,000 characters); rules are still validated on every sample.
  - `c24fd57` (PR #86) `disco-ai-worker.ts`: a remap keeps the saved contract's proven list sources and adds the new ones (duplicates removed; larger estimate and best-route reach kept; profile_sitemaps combined), before the save check; sitemap sources with an include filter are resolved at mapping to the matching child sitemaps (`resolved_sitemaps`), and only those go to profile_sitemaps; timezone ids are not offered to the JSON learner.
  - Database: `exp_etl_fetch_tick` picks a profile page (or other item) first when a list unit of the same site is already in flight (Fix comment "one list unit in flight per site"; before-copy `exp_curation_ledger` 368122).
- **Verified:**
  - Remap 156 (proposal 136): 22 profile-API fields with fill rates (languages 90%, bio 70%, credentials 60%, website 40%, team 30%, booking 20%), API median 18 against page median 11; page fields 19, floor 14 (were 15 / 10).
  - Remap 157 (proposal 137, accepted by the owner): list route = the new agent-search API sources plus the 2 saved ones (about 38,000 expected); 24 profile-API fields (licence number / state / type 33%, bio 42%, languages 33%, credentials 42%, website 33%, team 25%, social links 92%, fax 75%), no timezone; page fields 18, floor 12; save check "same or better on every measure".
  - Run 15:47 (run cf41fb30): 4 list units seeded; after the routing change profiles started at 16:01. By 16:36: 15 profiles done, 14 staged from the profile API (16-20 fields, licence on 8 of 14) and 1 from the page after an API failure (Oxylabs 613, staged shallow). Field-yield gate PASS at 16:20 (10 of 10 at floor 9 of 12) and the source moved to active. Station 6 created 14 professionals and 13 locations; Stations 7 / 8: 13 professionals checked, 13 passed; nothing published (cron 104 is still inactive).
- **Not yet done / open:**
  - bhhs.com limits: daily quota 100 and 30 s delay (about one profile every 2 minutes) against about 38,000 profiles; to be set by the owner.
  - The combined bhhs.com list route asks the same API with two page sizes (500 and 200) and two URL fields: about 590 list calls per pass instead of about 170 (profiles are still queued once). Treating sources on the same endpoint as one is a possible follow-up.
  - The sitemap-filter resolution has not been exercised yet (remap 157 chose the API).
  - US-only rule (sampling and harvest) still pending.


## Source actions menu, remap for rendered / proxy sites, API-built contracts, discovery guard (2026-10-15)
- **What triggered this:** sothebysrealty.com could not be remapped after its method check (`js_needs_api`); elliman.com remap 162 failed in version 1 ("must-have fields not found: phone|email, city, state"; version 2 had found its agents sitemap, about 6,000) and the error overwrote the earlier step results; the owner asked for every per-source action in the Source Registry with status-aware buttons, and for "Discover companies" to work again.
- **What was wrong (verified on live data):**
  - `disco_request_remap_site` allowed only `server_crawl` / `no_profiles_on_site` and never passed a crawl method, so every remap ran as a plain fetch (9 sources are `js_needs_api`, 7 `blocked_needs_proxy`).
  - Actions were split: Run, Run all ready, Re-harvest, View contract, Remap and Retry in Category population; Activate / Pause, Limits and Remap in Source Registry.
  - `disco_activate` refused to start when any job of the category was queued / running / awaiting: real estate agents had 19 remap jobs and 1 method job at `awaiting_ai` that are never closed, so discovery could not run again (the error is swallowed by `exp_etl_activate_category`).
- **Changes shipped:**
  - Database: `disco_request_remap_site` also accepts `js_needs_api` and `blocked_needs_proxy` and passes `prompt_input.crawl_method` (`needs_js_api` / `needs_proxy` / `server_crawl`); unprobed / unreachable still need the method check (before-copy ledger 380000). `disco_activate`: only another discovery job (`step = 'discover'`) in progress blocks a new one (before-copy ledger 380279).
  - Code `310487d`: new `src/components/discovery/source-actions.tsx` (shared actions with live state per source: contract, open run and queue size, map step, method check, pending proposal, last map failure; disabled items say why); Source Registry: an Actions menu per row (Run test sample / Run harvest, Re-harvest, Remap, Retry method check, View contract / proposal, Activate / Pause, Set limits) and a status line; Category population uses the same actions; "Discover more companies" (Source Registry with a category selected; Category population step 2 once past it); `crawl-method.tsx`: rendering / proxy sites count as mappable ("Needs rendering"). `disco-ai-worker.ts`: a failed version 1 step keeps the version 2 and profile-API results on the request (`map_step: failed_v1`); when the page lacks the required fields but the profile API is proven with the required fields on 80%+ of profiles (at least 5 fields), the contract is built from the profile API (record_source `api`, version 2's list route and pattern, field floor = API median).
- **Verified:** type-check clean for the changed files (same 30 errors elsewhere); both database functions read back with their Fix comments; 0 discovery jobs in progress for real estate agents after the guard change. The UI and the API-built contract path are not yet exercised (after the merge: Sotheby's and Elliman remaps, Discover more companies).
- **Not yet done / open:** close remap / method jobs when their request finishes (housekeeping); bhhs.com limits (quota 100 / delay 30 s); the US-only rule; one list source per endpoint.

## Company-list approval never pauses other sources (2026-10-15)
- **What triggered this:** a bug reported earlier and still present: approving companies in rounds from a discovered company list paused sources that should keep running. The user's rule: approving from a company list must not pause sources outside that list, and must not pause sources already approved from the same list either.
- **What was wrong (verified on live data):** `disco_confirm_companies` called `exp_etl_approve_companies(category, decided ids)`. Its second UPDATE pauses every `hierarchy_source` source of the category whose status is proposed / approved / active and which is not in the list it receives. Real estate agents had proposal 96 (company_list, 28 companies, 5 decided, 23 undecided) pending, plus compass.com, kw.com and remax.com active from outside the list, and exprealty.com approved. The next Approve on proposal 96 would have paused those 4. Because earlier rounds' domains were sent again, a source an admin had paused from an earlier round would also have been switched back to approved. Insurance, mortgage and real estate agency each have 10 proposed sources that the same path would pause.
- **Changes shipped:**
  - Database, `disco_confirm_companies` only (before-copy in ledger 381078). The call to `exp_etl_approve_companies` is replaced by the same steps without the pause: the same role check (super_admin / architect); set only this round's new sources to `approved` (from proposed / paused / approved); the same `exp_etl_jobs` update; the same robots / sitemap recon start for this round's new sources. Decided-domains tracking, proposal state, method job and the reply are unchanged. Fix comment `Fix (company-list approval, 2026-10-15)`.
  - `exp_etl_approve_companies` is unchanged. The checklist approval on Category population still uses it, and there pausing unticked sources is intended.
- **Verified:** the definition read back with the Fix comment and no call to `exp_etl_approve_companies`. In a rolled-back test as a super_admin, approving redfin.com on proposal 96 returned approved_this_round 1, approved_total 6, remaining 22. redfin.com became approved, and all 9 existing real-estate sources kept their status (4 active, 5 approved).
- **Not yet done / open:** the `exp_etl_jobs` stage reset to `method_split` on approval (cosmetic, kept as-is, separate approval); publish schedule (cron 104) still off; the US-only rule; one list source per endpoint; closing remap / method jobs.

## Finished runs close; one open run per source (2026-10-15)
- **What triggered this:** kw.com showed "Running since 13 Oct, 13:51 · 0 queued" two days after its crawl had finished.
- **What was wrong (verified on live data):** nothing ever closed a run. `exp_etl_finish_run` had no caller (no cron, database function or screen), so no run in `exp_etl_runs` had ever been closed and 11 were open (25 Sept–14 Oct). kw.com had nothing queued or being fetched (660 profile pages done, 101 sitemaps and 1 list page read) but had two open runs. The 13:51 run had 0 pages and came from a second Run click; the 13:58 run did the work (660 fetched / staged). A second run also moves the field-yield gate's sample window (`exp_etl_gate_full_pull` counts from the latest run's start).
- **Changes shipped:**
  - Database, `exp_etl_fetch_tick` (cron 90; before-copy in ledger 381643). At the top, before the in-flight cap, an open run older than 10 minutes is closed when its site has nothing `queued` or `fetching`. `finished_at` = the site's last fetch since the run started. Fix comment `Fix (close finished runs, 2026-10-15)`.
  - Database, `exp_etl_run_source` (before-copy in ledger 381644). Run, and Re-harvest (which calls it), is refused with `run_in_progress` while the source has an open run. Fix comment `Fix (one open run per source, 2026-10-15)`.
  - First tick: 8 runs closed (edwardjones.com ×3, kw.com ×2, morganstanley.com, schwab.com ×2); their ids are in ledger 381645 for rollback (`finished_at = NULL`).
- **Verified:** after the next tick the 8 runs carry their real finish times (for example kw.com 13 Oct 11:20 UTC, edwardjones.com 12 Oct 10:43 UTC). bhhs.com (39,312 queued, 100-a-day limit), compass.com (158 queued) and remax.com (36,095 queued) stay open. Cron 90 keeps succeeding in under 1 s. In a rolled-back call as a super_admin, Run on bhhs.com returned `run_in_progress`.
- **Not yet done / open:** `disco_accept_site_proposal` still starts its own sample run without the open-run check (raised with the owner). A test pull blocked by the gate stays open while its pages are queued. A page stuck in `fetching` would keep its run open. "Refresh all" in Category Population becomes clickable now that runs can finish (it acts only when clicked).

## Accepting a contract closes a running harvest (2026-10-15)
- **What triggered this:** after runs began to close, a gap remained: accepting a contract on an active source started its own test-pull run while a harvest run could still be open. That gave two open runs and one harvest split across two contracts. The owner chose to have Accept close the running harvest after a warning, rather than block Accept (a full block would hold bhhs.com, with 39,312 pages queued at 100 a day, for more than a year).
- **What was wrong (verified on live data):** `disco_accept_site_proposal` inserts its own run (trigger `contract_accept`) and does not go through `exp_etl_run_source`, so the open-run check does not apply to it. bhhs.com, compass.com and remax.com had open harvest runs.
- **Changes shipped:**
  - Database, `disco_accept_site_proposal` (before-copy in ledger 382049). For an active source, the open run is closed (`finished_at = now()`, `detail.closed_by = 'contract_accept'`, `proposal_id`) before the new test-pull run starts; `closed_runs` is added to the audit details and the reply. The save, the closing of other proposals, the switch to test pull and the 20 pages re-queued for the gate are unchanged. Fix comment `Fix (accept closes running harvest, 2026-10-15)`.
  - Code `da7114c`, `src/components/discovery/site-contract-proposals.tsx`: the Accept dialog reads the source's status, its open run and its queued pages. When the source is active with an open run, it shows an amber warning ("Harvest in progress since …, N pages queued. Accepting stops this run …"). The success message adds "previous run closed".
- **Verified:** definition read back with the Fix comment. In a rolled-back test as a super_admin, accepting bhhs.com proposal 137 (set to pending inside the test) returned closed_runs 1, requeued 20 and source_status test_pull. Run cf41fb30 was closed with `closed_by: contract_accept`, a new contract_accept run was open, and the queue stayed at 39,312 + 20. Type-check: no errors in the changed file (same 30 elsewhere).
- **Not yet done / open:** Accept does not queue the new contract's list routes; Run does, once the test-pull run has closed. For a site with a big queue, new list routes wait until that queue is done.

## Preview records: full record view (2026-10-15)
- **What triggered this:** the proposal preview (kw.com #144) showed only 7 key values per sample page. The owner asked to see every mapped field (person, location, brand, static, taxonomy, extra) before accepting a contract.
- **What was wrong:** `previewSiteProposal` built the full record with the harvest's own builders but returned only `identity_candidates.universal`, so the taxonomy values, extra fields and their sources were thrown away.
- **Changes shipped (code `d31859f`, UI only, no database change):**
  - `src/lib/site-proposal.functions.ts`: the preview also returns the record's `payload` (taxonomy values, `_subjects`, `_extra`, `_static_sources`) and `identity_candidates`. Still read-only.
  - `src/components/discovery/site-contract-proposals.tsx`: a View button per preview row opens a dialog that lists every field the proposed contract maps:
    - Person, Location (branch / office), Brand (firm, including site-wide values): static fields, tagged with their tier or route.
    - Taxonomy: with the person / branch / firm subject.
    - Extra.

    Each section shows "found of mapped"; empty fields read "— not found on this page"; the header repeats fields filled against the minimum, required fields and shallow.
  - `src/components/discovery/pipeline-tab.tsx`: `isAddressObject` and `AddressValue` exported, so both screens render values the same way.
- **Verified:** type-check shows no errors in the changed files (same 30 elsewhere). Not yet clicked through in the deployed UI.
- **Not yet done / open:** none for this item.

## Contract re-check, own URLs and CSV download (2026-10-15)
- **What triggered this:** the owner wants QA to re-run the preview on an active (saved) contract to confirm it still works, optionally on their own profile URLs, and to download the records as CSV. Previously Preview records existed only for a pending proposal. The kw.com remap showed a saved contract can stop working without anyone noticing (2 of 3 of its sample pages failed).
- **What was wrong:**
  - The preview read only a pending proposal's contract, only its sample pages, and only the profile page.
  - A contract harvested from the site's profile API (record_source `api` / `api+page`, for example bhhs.com) was previewed from the page, not the way `disco-detail-api-worker` harvests it.
- **Changes shipped (code `28aeded`, no database change, admins only as before):**
  - `src/lib/site-proposal.functions.ts` `previewSiteProposal` now takes either `proposalId` or `{ domain, gcid }` (the saved contract, latest `disco_site_contract` row), plus optional `urls` (at most 10).
    - A given URL must be on the site (or a subdomain) and match the contract's profile page pattern. Otherwise it is returned as "not fetched: …" without any fetch.
    - Contracts with `detail_route.record_source` `api` / `api+page` are built like `disco-detail-api-worker`: JSON values via `fetchDetailFor` / `jsonValues` first; the page fills the rest or is the fallback. Each record reports `detail_source`.
    - The brand-site own-page key is filled as the harvest does. Still read-only.
  - New `src/components/discovery/contract-preview.tsx` (shared): Preview records; "Test my own URLs" (up to 10, one per line, with the count and the rules shown); a summary (pages, loaded, meeting the minimum with required fields, shallow, failed, not fetched); a View dialog per row (moved here from the proposal panel); and Download CSV (built in the browser with the existing `csvExport`).
    - The CSV has one row per page: page, result, source, fields filled, minimum, shallow, missing required.
    - Then one column per mapped field (`person.` / `location.` / `firm.` / `taxonomy.` / `extra.`); lists are joined with "; " and addresses use their text.
    - File name: `{domain}_{proposal-N | saved-contract}_{date}.csv`.
  - `site-contract-proposals.tsx` uses the shared preview (its own preview table, View dialog and header button removed). `site-contract-panel.tsx` adds a "Re-check saved contract" section with the same preview on the saved contract.
- **Verified:** type-check shows no errors in the changed files (same 30 elsewhere); eslint reports only prettier formatting. Not yet clicked through in the deployed UI.
- **Not yet done / open:** analysts cannot run the preview (admins only, unchanged). The generic taxonomy routes the harvest adds at run time are still not applied in the preview (they only fill values that are still empty).

## Profile-API contracts: API plus page when the page adds fields; value-only rules on merged records (2026-10-15)
- **What triggered this:** in the bhhs.com saved-contract re-check (CSV), every record had the agent's details from the profile API but no office address, office phone or maps link, and all taxonomy fields were empty. The owner asked for generic rules, nothing site-specific.
- **What was wrong (verified on live data):**
  - (1) The mapper chose `record_source 'api'` by field count alone (API median 18, page median 9), so the page was never fetched. bhhs.com's 8 office rules (`location.*`: address block, street, city, state, postal code, phone, maps link, contact buttons) exist only on the page. Of the 140 bhhs.com records staged from the API, 0 had `location.phone` and 0 had `location.street`.
  - (2) Taxonomy keys that copy a universal field (alias rules, for example `full_legal_name <- person.name`, the phone keys `<- person.phone`) and address-part rules run only inside `applySiteContract` while the page is read. API records therefore had 0 taxonomy values.
- **Changes shipped:**
  - Code `e73d275`, `disco-ai-worker.ts` `attachDetailRoute`: `'api'` only when the JSON map covers every page rule that has a value on at least 2 sample pages (the same 2-profile rule the JSON field map keeps; aliases and extra fields are not counted). Otherwise `'api+page'`, and the reason lists the page-only fields. Fix comment `Fix (API plus page when the page adds fields, 2026-10-15)`.
  - Code `e73d275`, `-disco-site-contract.ts`: new exported `applyValueRules(values, contract, url)`. It runs the contract's value-only rules on a finished value map with no page: derived address parts fill empty ids; alias copies follow the merged value; the C1 person-name net applies.
    - Used in `disco-detail-api-worker.ts` (after the API / page merge, before `applyAddressOwner`) and in the preview (`site-proposal.functions.ts`).
    - Page-only contracts are unchanged; their aliases already ran in `applySiteContract`, and the result is the same.
  - Data, bhhs.com saved contract (before-copy of `detail_route` in ledger 383970): `record_source` set to `'api+page'` by the same rule. The reason lists the 10 page-only fields: `location.actions`, `location.address_block`, `location.city`, `location.gbp_place_id`, `location.phone`, `location.postal_code`, `location.state`, `location.street`, `person.actions`, `person.profile_url`. The fetch tick already routes `api+page` to `disco-detail-api-worker`; that worker fetches the page as well and the JSON value wins where both have one.
- **Verified:** type-check shows no errors in the changed files (same 30 elsewhere). `applyValueRules` was run locally on a bhhs-like value map: `location.city` / `location.state` were derived from the address block, and `tax.full_legal_name` / `tax.mobile_phone_number` were copied. The contract row was read back with `record_source` `api+page`.
- **Not yet done / open:**
  - After deploy: re-check bhhs.com in the contract panel and confirm `location.*` and taxonomy values.
  - Cost: `api+page` adds one page fetch per bhhs.com profile.
  - The 140 records already staged keep their old values until a Re-harvest, which is refused while bhhs.com's run is open (39,312 queued, 100 a day). Queued pages are harvested with the new rules.

## Pipeline self-healing sweep (2026-10-15)
- **What triggered this:** howardhanna.com was approved (company list, 04:53 UTC) but never probed, and its Retry crashed the worker (Cloudflare error 1102) and stayed "in progress". Earlier the kw.com remap was lost in a deploy. The owner asked for a generic solution, so that approving domains in the UI is enough.
- **What was wrong (verified on live data):**
  - (1) A method check for a new approval was queued only when no method job was open for the category. A method job closed only when every approved source was resolved, so method job #81 (open since 30 Sept) blocked every later approval.
  - (2) A request the worker marked `sent` and never finished stayed `sent` forever: 6 such requests (#50, #53, #55, #60, #139 since 25 Sept–5 Oct; #164 howardhanna.com).
  - (3) 99 remap jobs stayed `awaiting_ai` with nothing left to do.
- **Changes shipped:**
  - Database: new `disco_pipeline_sweep()`, called by `exp_disco_ai_worker_tick` (cron 89, every 2 minutes) before its early return, inside an exception block so a sweep failure never blocks the tick. Before-copy of the tick in ledger 386413.
    - Rule 2, lost requests: a request in progress is stamped (`prompt_input._sent_seen`); a saved map step renews the stamp. 10 minutes with no progress: back to `pending` once. Lost twice: `error` with the reason. Created over a day ago: `error` at once ("abandoned").
    - Rule 1, method checks per source: every approved / test_pull / active source with an unknown method and no check waiting or running gets one. Not when its last check failed or finished in the last 24 hours. At most 5 per run; the request is attached to the category's open method job, or a new one.
    - Rule 3, finished jobs close: remap / refresh jobs with nothing waiting or running for 10 minutes are closed (`done`, or `error` when all their requests failed). Method jobs are left open on purpose: once none is open, `disco_dispatch` would re-queue method checks — and, for server_crawl sites, remaps — for every approved source on the next company approval. Discovery jobs waiting on a human are never touched.
  - Database: `disco_retry_method_classification` (before-copy in ledger 386414): the in-progress check covers every job of the category, and a category with no open method job gets one instead of the error.
  - Code `a87eaf6`, `source-actions.tsx`: the status line shows "Method check queued / running", "Method check failed: reason — use Retry method check" and "Waiting for method check (queued automatically within 2 minutes)". The registry refreshes while a source is waiting.
- **Verified:**
  - Rolled-back run first: 5 abandoned, 99 jobs closed, #164 stamped.
  - First live tick (10:26 UTC): #50, #53, #55, #60 and #139 are `error` ("abandoned: …"); 99 remap jobs are closed by the sweep (0 open); #164 is stamped and will be retried once after 10 minutes. Cron 89 succeeded. Type-check shows no errors in the changed file.
- **Not yet done / open:** `disco_dispatch`'s method step still queues every approved source. Changing it to unknown-method sources only would let Rule 3 close method jobs too (open: #7 financial_advisor, #81 real_estate_agents). This needs a separate approval.

## Method step only for unknown sources; sweep closes method jobs (2026-10-15)
- **What triggered this:** the pipeline sweep (entry above) left method jobs open on purpose. With no open method job, the next company approval made `disco_dispatch` queue a method check for every approved source of the category. For server_crawl sites, `disco_method_ingest` then queues a full remap. Until now only the stuck method job #81 had been preventing that.
- **What was wrong (verified on live data):** `disco_dispatch`'s method step looped over `exp_etl_sources WHERE gcid = … AND status = 'approved'` with no check of the crawl method or of checks already in progress. A job with nothing to queue was marked `error` ('no approved sources').
- **Changes shipped:**
  - Database, `disco_dispatch` (before-copy in ledger 387530): the method step queues only approved sources whose crawl method is unknown and that have no classify_method request waiting or running (the same rule as the sweep's Rule 1). A job with nothing to queue is `done` ('no source needs a method check'). Fix comment `Fix (method step only for unknown sources, 2026-10-15)`.
  - Database, `disco_pipeline_sweep` (before-copy in ledger 387531): Rule 3 also closes method jobs with nothing waiting or running for 10 minutes. Comment updated.
- **Verified:** in a rolled-back test, a new method job for real estate agents queued 0 requests and was marked `done` ('no source needs a method check'), because every approved source has a known method. The sweep definition was read back with method jobs included.
- **Not yet done / open:** none for this item.

## Strip null characters before saving map results (2026-10-15)
- **What triggered this:** after the pipeline sweep recovered howardhanna.com's method check (server_crawl, direct), its map (request 165) failed with "map step save failed: unsupported Unicode escape sequence".
- **What was wrong (verified on live data):** Postgres jsonb cannot store the NUL character (`\u0000`). Page text from the site contained one, so the version 2 step state could not be saved. The error path then kept only `{ error }`, and the step's progress was lost. Any site with a NUL in its pages fails the same way.
- **Changes shipped (code `23cb996`, `disco-ai-worker.ts`):** new `noNul()` removes NUL from every string and key. It is applied to every value the worker writes:
  - map step state (version 2 steps and the detail step);
  - `disco_map_site_ingest` contract, `disco_map_site_no_profiles` evidence and the proposal payload;
  - the keep-existing response and the error response;
  - `disco_discover_ingest` companies and `disco_method_ingest` evidence.

  Fix comment `Fix (strip null characters before saving, 2026-10-15)`.
- **Verified:** type-check shows no errors in the changed file (same 30 elsewhere). `noNul` run locally removed NUL from nested strings and keys and left other values unchanged.
- **Not yet done / open:** after deploy, Remap howardhanna.com from the Actions menu.

## Auto test sample after a site's first contract (2026-10-16)
- **What triggered this:** howardhanna.com's first contract saved itself (request 166), but the test sample still needed a "Run test sample" click. That click was left over from the original flow, where Run was the only thing that queued pages for a site; it was never a deliberate checkpoint. The owner wants approval in the UI to be enough.
- **What was wrong (verified on live data):** three approved sources had a working version 3 contract and had never had a run: century21.com, coldwellbanker.com and howardhanna.com. Nothing starts a run except `exp_etl_run_source`, and that is role-checked, so the sweep (no user) could not call it.
- **Changes shipped:**
  - Database: new `exp_etl_run_source_core(p_source, p_trigger)` holds the Run work unchanged (seeding from the contract's sitemaps and list route, the test pull or active switch, the job stage), without the role check; the run's `detail.trigger` records who started it. EXECUTE is revoked from PUBLIC / anon / authenticated.
  - `exp_etl_run_source` keeps its role check and calls the core with trigger `console` (before-copy in ledger 401936).
  - `disco_pipeline_sweep` Rule 4 (before-copy in ledger 401937): an approved, server_crawl source with a version 3 contract and a profile page pattern that has never had a run gets its test sample started (trigger `pipeline_sweep`). At most 3 per run, each in its own exception block. A source with any run is left to the console, so each source starts once.
  - The sweep's EXECUTE is also revoked from PUBLIC / anon / authenticated; only cron 89, through the tick, calls it.
  - Remap proposals accepted on active sources start their own test as before; the gate is unchanged (PASS: active; otherwise paused).
- **Verified:**
  - Next tick (03:36 UTC): test-pull runs started for century21.com and coldwellbanker.com (1 profile sitemap each) and howardhanna.com (1 list route start), all with `trigger: pipeline_sweep`.
  - Cron 89 succeeded. `authenticated` can execute `exp_etl_run_source` but not the core or the sweep.
- **Not yet done / open:** the pending US-only rule (auto harvest also collects non-US profiles). Default limits come from each source's record (100 a day, 30 s delay for these three).

## Configurable markets filter at staging (2026-10-16)
- **What triggered this:** automatic harvests also collected agents outside the US. The owner asked for a configurable list of markets rather than a hard-coded US check, so Canada, Australia and others can be switched on later.
- **What was wrong (verified on live data):**
  - Of kw.com's 660 staged records, 275 had no state. Most had international phones: Turkey +90, Cyprus +357, Spain +34, Mexico +52, Argentina +54 (Ankara, Istanbul, Sevilla, CDMX). Some had Canadian addresses ("Winnipeg, MB", "Bedford, NS").
  - Every record with a state had a valid US code.
  - No country or market setting existed anywhere.
- **Changes shipped:**
  - New table `exp_etl_markets` (`country_code`, `country_name`, `enabled`, `phone_codes`, `region_codes`, `postal_pattern`, `postal_in_address`). RLS is on and nothing is granted to anon / authenticated (read and written only by definer functions for now). Starting rows: US enabled; CA and AU present but off.
  - New `exp_etl_record_outside_markets(record)`; EXECUTE is revoked from app roles. It returns the reason, or NULL to keep, using only the record's own values:
    - keep: a state that is a region code of an enabled market;
    - outside: international phone(s) whose dialling code no enabled market uses;
    - outside: a postal code field of a market that is off (and of no enabled market), or, for markets with `postal_in_address`, that pattern inside address text;
    - outside: an address ending in ", <region code>" of a market that is off, when no enabled market uses that code;
    - keep: otherwise, when there is no evidence either way.
  - `exp_etl_fetch_collect` (before-copy in ledger 402862): a harvest record outside the enabled markets is not staged. The page is marked `skipped` and the run counts it in `detail.skipped_outside_markets`, with `detail.last_outside_reason`. Applies to every harvest worker (page, profile API, API plus page).
  - `exp_etl_fetch_tick` (before-copy in ledger 402863): the test pull's 20-page cap no longer counts skipped pages.
  - Data: the 208 staged kw.com records the rule flags (all `shallow`) were set to `rejected` / `failed_validation`, with `payload._rejected = {reason: outside_markets, detail}`. Prior statuses are in ledger 402899.
- **Verified:**
  - Read-only evaluation on all staged records: 208 flagged on kw.com (international phones; MB / NS / ON addresses); 0 on compass.com, remax.com, edwardjones.com, morganstanley.com, schwab.com, bhhs.com, howardhanna.com and century21.com.
  - Cron 90 / 91 succeeded after the change, and staging continues.
- **Not yet done / open:**
  - kw.com records with placeholder phones ("0000000000") and numeric region codes ("Ponta Delgada, 20") carry no market evidence and are kept.
  - Pages outside the markets are still fetched before they are skipped. Filtering in the list route, where a site exposes a country, is a later mapping step.
  - There is no UI for `exp_etl_markets` yet; switching a market on is one update of `enabled`.

## Placeholder phones dropped from every record; staged records cleaned (2026-10-16)
- **What triggered this:** kw.com records carried "0000000000" as the phone. The owner asked for placeholder phones to be cleaned, and for this not to happen again.
- **What was wrong (verified on live data):**
  - `toUSPhone10` already rejected placeholders, but only for the static (universal) fields.
  - `identity_candidates.phone` is copied from the raw value, and taxonomy phone keys keep raw values, so placeholders reached staging. Counts: `office_phone_number` 68, `identity_candidates.phone` 63, `mobile_phone_number` 21, `primary_phone_number` 21.
  - By source: kw.com 51 records ("0000000000"), bhhs.com 14 ("(111) 111-1111", "(222) 222-2222"), compass.com 3 ("123-456-7890"), remax.com 1 ("(000) 000-0000").
- **Changes shipped:**
  - Code `cf810bd`, `-disco-site-contract.ts`: new exported `isPlaceholderPhone()`, shared by `toUSPhone10`. A placeholder is all one digit, a straight run (1234567890, 0123456789, 9876543210 …) or the fictional 555-01xx range; real international numbers are not placeholders.
  - New `dropPlaceholderPhones()` runs at the start of `buildHarvestRecord`, the one place every record passes through (page, profile API, API plus page). Placeholders reach neither the main phone nor taxonomy phones, and are not counted as filled.
  - Data: 176 placeholder values removed from 72 staged records: `identity_candidates.phone` set to null on 63, and placeholder phone / fax keys dropped from the payload on 72. Statuses unchanged (46 shallow, 17 created, 9 rejected). Before-values are in ledger 403369.
- **Verified:**
  - Local run: placeholders such as "0000000000", "(111) 111-1111", "+1-123-456-7890" and "(212) 555-0123" are rejected; "(858) 525-3262", "+903122400072" and "+52 671 767 5054" are kept. A list keeps its real numbers.
  - Type-check shows no errors in the changed file. 0 placeholder phones remain in staging; `professionals` and `organizations` hold none.
- **Not yet done / open:** a database-side guard at staging (`exp_etl_stage_ingest`) so that any writer, not only the harvest workers, cannot stage a placeholder phone. Proposed for approval.

## Placeholder phone guard at staging (2026-10-16)
- **What triggered this:** after the code fix and the staging cleanup (entry above), the owner asked for a guard so placeholder phones cannot be staged again, whichever writer stages a record.
- **What was wrong:** the code fix covers the harvest workers (`buildHarvestRecord`). Other writers (the older roster / JSON-LD staging path in `exp_etl_fetch_collect`, `exp_etl_reharvest_source`, any future worker) stage through `exp_etl_stage_ingest` with no phone check in the database.
- **Changes shipped:**
  - New `exp_etl_is_placeholder_phone(text)`: the same rule as `isPlaceholderPhone` (all one digit, a straight run, 555-01xx).
  - New `exp_etl_clean_placeholder_phones(jsonb)`: removes placeholder values from any key containing phone or fax (strings and lists), recursing into nested objects such as `identity_candidates.universal`.
  - EXECUTE on both new functions is revoked from PUBLIC / anon / authenticated.
  - `exp_etl_stage_ingest` (before-copy in ledger 403621): payload and identity candidates pass through the cleaner before anything is written. Fix comment `Fix (placeholder phone guard, 2026-10-16)`.
- **Verified:**
  - Cleaner test: "0000000000", "(111) 111-1111", "123-456-7890" and "(212) 555-0123" were removed (also nested and in lists); "(858) 525-3262", "+903122400072" and "+52 671 767 5054" were kept, and other keys were untouched.
  - Rolled-back `exp_etl_stage_ingest` call: the stored row kept "(412) 555-7788" and the name, and lost the placeholder office, identity and universal phones.
  - Cron 91 (collect) succeeded afterwards, and staging continues (21 records in 3 minutes).
- **Not yet done / open:** none.

## Preview uses the harvest's fetch method (2026-10-16)
- **What triggered this:** century21.com's test pull was BLOCKED (0 of 10 records met the minimum of 12: name, city and state, but no phone and about 8 fields). A re-check from the contract panel would not have shown what the harvest sees.
- **What was wrong:** `previewSiteProposal` chose the fetch method from `exp_etl_sources.crawl_method` alone. The harvest (`exp_etl_fetch_tick`) decides by `fetch_tier` first (proxy_render -> rendered, proxy -> server_crawl, direct -> direct). century21.com has crawl_method server_crawl but fetch_tier proxy_render, so the preview used a plain fetch while the harvest renders the page.
- **Changes shipped (code `13283c8`, `src/lib/site-proposal.functions.ts`):** the preview reads `fetch_tier` and maps it as the fetch tick does; the crawl method is used only when no tier is set. Applies to the saved-contract re-check and to proposal previews.
- **Verified:** type-check shows no errors in the changed file (same 30 elsewhere).
- **Not yet done / open:** after deploy, re-check century21.com to see whether the phone appears on the rendered profile page.

## Source Stats tab (2026-10-16)
- **What triggered this:** the owner asked for one place showing a source's whole funnel: expected, queued, harvested, staged, shallow, entities by type, gate passed, published, and yet to harvest. These numbers were spread over the Source Registry, Runs, Pipeline and contract panel; entity and published counts per source were not shown anywhere.
- **Changes shipped:**
  - Database: new read-only `exp_etl_source_stats(p_gcid, p_source)` (SECURITY DEFINER, admin / architect check; EXECUTE for authenticated only). It returns one object per hierarchy source of the category:
    - expected, from the contract list route estimate (else `best_route.reach_estimate`);
    - queue counts from `exp_etl_frontier` per website: discovered, queued, harvested, skipped, failed, list units, fetched today, last fetch, by kind:status;
    - staging by status for the source within the category;
    - entities reached through that source's staging rows: professionals, locations, brands, teams, gate passed / failed, published;
    - yet to harvest = queued + max(expected − discovered, 0);
    - the last run.

    One grouped pass per table; called only on tab open or Refresh.
  - Code `99ee006`: new `src/components/discovery/source-stats-tab.tsx`, with Category and Source filters, Refresh, and a single table (one row per source plus a totals row). Clicking a row opens a modal: source details, the full funnel, queue by kind / status, staging by status, last run. `src/routes/_authenticated/discovery.tsx` registers the tab (+5 lines); no existing tab component changed.
- **Verified:**
  - Rolled-back call as a super_admin: real estate agents (10 sources) in about 1.8 s, financial advisor in about 0.7 s.
  - Example rows: howardhanna.com expected 12,000, discovered 9,983, queued 9,924, harvested 59, staged 59, resolved 57, gate passed 57. kw.com: expected 146,820, harvested 660, rejected 208.
  - Type-check shows no errors in the changed files.
- **Not yet done / open:** published counts are 0 in real estate agents until publishing (cron 104) is switched on. "Expected" is only as good as the contract's estimate (compass.com shows 500 while about 34,700 profiles were discovered).

## Publish pilot: edwardjones.com (2026-10-16)
- **What triggered this:** the owner asked to publish edwardjones.com as a pilot. Approved as "Approved: publish pilot for edwardjones.com".
- **What was done:** `exp_etl_publish_tick(batch, ARRAY['edwardjones.com'])` (existing function, unchanged) was run in batches of 500–1,500 between 08:02 and about 08:25 UTC. Cron 104 (the publish schedule) stays off; no other site was published.
- **Verified:** 19,380 edwardjones.com professionals published (every gate-passed active professional of the source), 0 errors. 19,380 distinct `professionals` rows are active, and a final call found nothing left to publish. The 8 gate-failed professionals were not published; none are claimed.
- **Not yet done / open:** the other sources wait for a pilot or for cron 104.

## Discovery rounds while a company list is pending (2026-10-16)
- **What triggered this:** the owner runs several discovery rounds and approves partially across them. "Discover more companies" was not visible while a list (accountant #8, 24 companies) waited for review.
- **What was wrong (verified on live data):**
  - `disco_discover_ingest` already merges a new round into the category's pending list: new companies tagged `round`, existing kept, `decided_domains` preserved.
  - Two things blocked it: (1) `disco_activate` refused when the category's discover job was `awaiting_human` (the state while a list waits for review); (2) Category Population step 2 hid the button whenever a list was pending.
  - Real estate agents (#96) only worked because a partial approval had closed its job. Accountant (#8) and mortgage lender (#7) had no approval yet, so their discover jobs (#5, #1) stayed `awaiting_human` and blocked.
- **Changes shipped:**
  - Database: `disco_activate` (before-copy in ledger 407309) blocks only while a discovery round is actually running (queued / running / awaiting_ai). Error text: "a discovery round is already running". Fix comment `Fix (discovery rounds while a list is pending, 2026-10-16)`.
  - Code `e8f7108`, `category-population-tab.tsx`: step 2 always shows the button for editors. It reads "Discover more (adds to this list)" when a list is pending, and is disabled with a note while a round is running (checked from `disco_jobs`, refreshed every 20 s while running). Companies show "round N" when the list has more than one round.
- **Verified:**
  - Rolled-back test: `disco_activate('gcid:accountant')` with list #8 pending created job 116 and queued its `discover_companies` request; a second call was refused with "a discovery round is already running".
  - Type-check shows no errors in the changed file.
- **Not yet done / open:** none.

## Manually add websites to a category (2026-10-16)
- **What triggered this:** the owner needs to add websites the discovery did not find to a category and approve them.
- **What was checked:**
  - No manual add existed in the UI.
  - `exp_etl_add_source` is unsafe for this: on a conflict it resets an existing source to `proposed`, which would stop an active source.
  - The pending company list already supports rounds and partial approvals.
- **Changes shipped:**
  - Database: new `disco_add_companies_manual(p_category, p_entries)` (admin / architect; EXECUTE for authenticated only; audited in `exp_admin_audit`).
    - Entries are "domain", "Name, domain" or {name, domain}, at most 100.
    - Each domain is tidied (protocol, www., path, port removed, lower case) and must be valid.
    - Skipped with the reason: invalid, listed twice, already a source in this category (never changed), already on the pending list.
    - Added companies are merged into the pending `company_list` with `manual: true`, `source_type: brand_site`, `added_at` and `added_by`; with no pending list, a new one is started. Approval is the unchanged `disco_confirm_companies`.
  - Code `ad54965`: new `src/components/discovery/add-websites-dialog.tsx` (the "Add websites" button and dialog: one website per line, the result shows added and skipped with reasons). `category-population-tab.tsx` shows the button in step 2 next to Discover more, and a "manual" tag on those companies.
- **Verified:**
  - Rolled-back tests on real estate agents list #96: existing sources were skipped as "already a source (active / approved)"; entries already listed, duplicates and an invalid entry were skipped.
  - Two new domains were added with `manual: true`. Approving one through `disco_confirm_companies` created it as `approved` (brand_site), with kw.com, compass.com, remax.com and howardhanna.com unchanged.
  - Type-check shows no errors in the changed files.
- **Not yet done / open:** step 2 shows only for categories already activated (step 1 done).

## Generated category boundaries, for any category (2026-10-16)
- **What triggered this:** accountant discovery round 2 returned thumbtack.com and yelp.com (general marketplaces). Accountant and financial advisor have no category boundary; only real estate agents and mortgage lender have authored ones, so discovery ran without a definition. The owner asked for boundaries generated per category (generic), not hand-written for two categories.
- **Changes shipped (code `933335b`):**
  - New `src/routes/api/public/-disco-boundary.ts` `generateCategoryBoundary(db, model, gcid, ask, {regenerate})`:
    - The model gets the category name and type plus the real categories whose names share a word with it.
    - Every `goes_to` is resolved against `gbp_categories` by name: an exact or plural match becomes the gcid, otherwise "adjacent: <name>" or "not a source".
    - Brand examples ("e.g.", "such as", example parentheses) are stripped. An empty or malformed answer is refused.
    - It never overwrites an authored boundary; regenerate replaces only a generated one. Saved with `source = generated:<model>`.
  - `disco-ai-worker.ts` discover step: a category without a boundary gets one generated first, and discovery uses it. A failure is logged and discovery runs as before.
  - New `src/lib/category-boundary.functions.ts`: `getCategoryBoundary` (read with the server client, since the table has RLS and no client policy) and `regenerateCategoryBoundary` (admin / architect).
  - New `category-boundary-panel.tsx` in Category Population step 2: a collapsible boundary panel (definition, includes, sub-types, belongs elsewhere), labelled authored / generated / none yet, with Regenerate or "Generate now".
- **Verified:** type-check shows no errors in the changed files. A local run with a mocked model and category list showed brand examples removed, "Certified public accountant" resolved to `gcid:certified_public_accountant`, "Tax preparation services" to `gcid:tax_preparation_service` (plural), an unknown name kept as "adjacent: …", and the row saved as `generated:<model>`.
- **Not yet done / open:** accountant and financial advisor get their boundary on the next discovery round or through "Generate now" after deploy.

## Taxonomy enrichment foundation: columns and apply function (0028) — PREPARED AND TESTED, NOT YET APPLIED (2026-10-15)
- **What triggered this:** the taxonomy enrichment program (all 14 lanes, every category) needs the governed proposal path to add and merge rows and to set volume metadata. Scott approved the extension and the additive columns on 2026-10-15.
- **What was wrong (verified on live data):** `exp__category_proposal_apply_one` could only set 7 label fields on `exp_taxonomy` (no volume, validated, priority), cast every value as text (so numeric columns could not be set), and raised "not supported" for `add` and `merge`. There was no column for a volume's source or date, and no concept key shared across lanes. The table already has the unique natural key `uq_taxonomy_term` (category, lane, term_slug), which also blocks re-adding a retired term. `exp_category_proposals` has a unique index on open proposals (target_table, target_key), so an `add` is keyed by its natural key. `content_items.topic_ids` (uuid[]) references taxonomy rows (0 rows today).
- **What changed (migration `0028_taxonomy_enrichment_foundation.sql`):**
  - Four additive columns on `exp_taxonomy`: `concept_slug`, `volume_source`, `volume_as_of`, `evidence` (jsonb, default `{}`), plus a partial index on (gcid, concept_slug).
  - `exp__category_proposal_apply_one`: `add` (upsert on the natural key: insert, idempotent metadata refresh, or reactivate a retired row; wording of existing rows is never rewritten; provenance `source` is required; payload keys are whitelisted), `merge` (retire the loser with `evidence.merged_into`, remap `content_items.topic_ids`, survivor must be active, same category and same lane), `set` extended to volume, validated, priority, is_required, concept_slug, volume_source, volume_as_of, evidence and the use flags with typed casts (stale-write guard unchanged), `retire` accepts `payload.reason` and refuses to retire a row still referenced by published content. A lane move is an add plus a retire; no new op was needed.
  - Unchanged: relabel/rescope rules, knowledge `set`, registry behaviour, `exp_category_proposal_apply` (snapshot, ledger row per op, validator-regression rollback per category) and `exp_category_proposal_review`.
- **Verified:** the whole migration plus nine scenarios ran inside one transaction forced to roll back, on `gcid:piano_tuning_service`: new add (volume, source, date, concept, evidence stored), idempotent re-add (1 row, metadata refreshed, wording untouched), typed set (priority, validated, volume), stale-write refusal, retire with reason, reactivation of a retired row, merge with pointer, refusal of an unknown payload key, refusal of `add` on the registry table, refusal of a cross-lane merge, existing `rescope` still works, and the full wrapper (state applied, 1 ledger row, row present). Afterwards the new columns were confirmed absent from the live table (rollback clean).
- **Not verified (UNVERIFIED):** the published-content reference guard and `topic_ids` remap (no `content_items` rows exist to test against).
- **Rollback:** `DROP INDEX idx_exp_taxonomy_concept; ALTER TABLE exp_taxonomy DROP COLUMN concept_slug, volume_source, volume_as_of, evidence;` and restore the previous function definition (saved in `exp_curation_ledger` with `action='definition_before_change'` at apply time).
- **Not yet done / open:** apply live after merge (backup first), then an APPLIED entry. Scorecard function (0029), evidence harvest tool, selection engine and judge step are in preparation on separate branches.

## Boundary answer check fixed (2026-10-16)
- **What triggered this:** "Generate now" for accountant failed with "boundary answer refused (empty or malformed)". The check did not say which part failed.
- **What was wrong (likely, from the code):** lists were accepted only as real arrays; a list the model sent as a JSON string counted as empty. The example stripping removed everything after "such as" / "e.g.", which can empty short items or shorten the definition.
- **Changes shipped (code `9c42c0a`, `-disco-boundary.ts`):**
  - `asList` parses lists sent as JSON text, or as one item per line / semicolon. "Belongs elsewhere" items sent as text ("kind -> category") are parsed.
  - `stripExamples` removes an "e.g. / such as / for example / including" part only when it names something (a capitalised word).
  - A refusal now lists each failed check and what was received, for example "includes empty (received text (40 chars))".
- **Verified:** local runs with mocked answers. Lists sent as JSON text were parsed, and "tax preparers -> Tax preparation service" resolved to `gcid:tax_preparation_service`. Generic "such as staff accountants" was kept, while "(e.g. Deloitte, PwC)" and "(e.g. at KPMG)" were removed. An empty answer was refused with the detailed reason. Type-check shows no errors in the changed file.
- **Not yet done / open:** retry Generate now after deploy; a refusal will show its reason.

## Publish pilot: real estate agents (2026-10-21)
- **What triggered this:** the owner asked where real estate agents stood (0 published). Approved as "Approved: publish pilot for remax.com, compass.com, bhhs.com, howardhanna.com, kw.com".
- **What was done:** `exp_etl_publish_tick(batch, ARRAY['remax.com','compass.com','bhhs.com','howardhanna.com','kw.com'])` (existing function, unchanged) was run one call at a time in batches of 1,000–1,500, with pauses between calls. `gcid:real_estate_agents` was already launched. Cron 104 stays off; no other site was published. Many calls returned a gateway 504 but committed (the function's lock kept calls from overlapping).
- **Verified:** every gate-passed active professional of the five sources is published with a live `professionals` row, 0 errors, nothing left to publish: remax.com 42,561, compass.com 30,750, bhhs.com 699, howardhanna.com 531, kw.com 317 (74,858 in all). Gate-failed professionals were not published.
- **Not yet done / open:** coldwellbanker.com (all 500 gate-failed) needs a look; bhhs.com and howardhanna.com are still harvesting, so new profiles wait for another call or cron 104; morganstanley.com is not published yet.

## Category Population: map queue status on source cards (2026-10-21)
- **What triggered this:** right after approving five insurance agent sources, every card showed "Not mapped — site mapping has not run yet", which looked like approval skipped the mapping step.
- **What was wrong (verified on live data):** nothing was skipped. The sources were approved at 05:51, the method check passed at once, and map_site requests 177–181 (job 121) were queued about a minute later. The card read the map requests once, before they existed, and only polled again while a request was pending or sent, so it stayed on "has not run yet" until a page reload. Because the card did not know about the queued map, Remap stayed enabled: allstate.com was remapped (request 182) while request 177 was still queued, so the site was mapped twice (177 became proposal 158).
- **Changes shipped (code `278a4b7`, `src/components/discovery/category-population-tab.tsx`, UI only, no database change):**
  - The card shows "Mapping queued", "Mapping now" (sent, or pending with a saved map step) or "Not mapped", with a matching reason line; a source with no map request says so.
  - The map list keeps polling (every 30 seconds) while a source that passed the method check has no map request yet, and every 15 seconds while one is waiting or running. Approving companies refreshes it at once.
  - When a map finishes, the contracts and sources reload so the card moves to Ready without a page reload.
  - Remap is disabled while a map is queued or running for that source; the open request is preferred over older finished ones when choosing what the card shows.
- **Verified:** type-check shows no errors in the changed file (30 elsewhere, unchanged baseline). Checked against live rows: farmers.com 179 completed, libertymutual.com 180 sent, which the new logic shows as finished and "Mapping now".
- **Not yet done / open:** the duplicate allstate map had already run, so there was nothing to cancel. `disco_request_remap_site` itself still accepts a remap while a map is open; blocking that server-side is a function change and would need its own approval. The worker picks pending requests in no fixed order, so the card does not show a queue position.

## Extra key dictionary: columns on exp_field_discovery (2026-10-22)
- **What triggered this:** the owner asked that extra fields be defined once and reused, instead of the AI naming them on every map, with the list checked before a new key is created; no hard-coded business fields. Approved as "Approved: extra key dictionary columns on exp_field_discovery (structural)".
- **What was wrong (verified on live data):** the 28 extra keys in `exp_field_discovery` (element_kind `extra_field`) held only a name and a label, per category, and were deleted when no contract held them. Collisions got number suffixes: "Fax Number" became `office_phone_direct_2_2` (allstate.com and morganstanley.com), "Agent tagline" became `personal_interests_2`, "Team member role" became `employment_history_2_2`.
- **Changes shipped (database, structural):** `exp_field_discovery` gained `definition`, `value_type`, `subject`, `examples`, `defined_at` (nullable, no default); checks `exp_field_discovery_value_type_check` (staging section-4 formats: text, phone, email, url, state, postal, year, number, place_id, list), `exp_field_discovery_subject_check` (person, location, firm) and `exp_field_discovery_extra_key_defined` (an `extra_key` row needs definition, value_type and subject); unique index `exp_field_discovery_extra_key_name` on `normalized` where element_kind = `extra_key` (one definition per key name across all categories). Dictionary rows use element_kind `extra_key`; the per-category `extra_field` usage rows are unchanged. Before-copy of all 41 rows: `exp_curation_ledger` id 537011.
- **Verified:** 41 rows, none changed (new columns empty). Rolled-back test: an undefined `extra_key` row was refused, a defined one accepted, a second definition of the same name refused, an unknown value type refused.
- **Rollback:** delete `extra_key` rows, drop the index, the three checks and the five columns.

## Extra key dictionary: site mapper reuses and defines extra keys (2026-10-22)
- **What triggered this:** same request as the entry above.
- **Changes shipped (code `cbbaab5`):**
  - `disco-ai-worker.ts`: the mapper loads every defined key (`extra_key`, with meaning, format, subject and an example) first, then the older per-category keys without a definition. The extra-fields prompt and the matching call show the meanings. The matching call now runs whenever there are new extras and, for each extra with no match, returns a generic definition, value type and subject. A name already in the list with a different meaning takes the AI's new descriptive name, checked against the list, static names and category keys; number suffixes are no longer made (a key ending in `_<n>` whose base is in the list counts as taken). With no valid name the extra is dropped with reason `name_conflict` (shown in the map diagnostics).
  - `-disco-extra-keys.ts`: after a contract is saved (auto-save or Accept), each extra key with a complete definition is added once to the dictionary (`recordDictionaryKey`); an existing definition is never overwritten, dictionary rows are never deleted, and seen_count counts contracts of every category holding the key. The per-category `extra_field` rows work as before.
  - `-disco-site-contract.ts`: `ExtraFieldSpec` carries `definition`, `value_type`, `subject`; `EXTRA_VALUE_TYPES`, `EXTRA_SUBJECTS`; drop reason `name_conflict`. `types.ts`: the new columns.
- **Verified:** type-check shows no errors in the changed files (30 elsewhere, unchanged baseline). Live test pending: the next map after deploy (the restaurant pilot) should write `extra_key` rows with definitions.
- **Not yet done / open:** the 28 existing keys have no definitions yet (data clean-up C, separate approval); suffixed and misrouted keys stay in their contracts until then.

## Extra key dictionary: seeded, and misnamed extra keys renamed (2026-10-22)
- **What triggered this:** clean-up C of the extra key dictionary. Approved as "Approved: seed extra key dictionary (data)" and "Approved: rename misnamed extra keys in contracts (data)".
- **What was wrong (verified on live data):** the existing extra keys had no definitions, and six were misnamed: amfam.com `employment_history_2_2` (team member roles) and `personal_interests_2` (a slogan); howardhanna.com `concierge_page_url` (its "Find It First" home search page, a different meaning from compass.com's concierge page); morganstanley.com `office_phone_direct` (direct line) and `office_phone_direct_3` (toll-free); remax.com `employment_history_3` ("21 Years Experience License #…").
- **Changes shipped (data):**
  - Renamed in `disco_site_contract.extraction.site_contract` (the `extra_fields` key, with `renamed_from` on the spec, and the `from` of `static_routes` entries of kind `extra`): `team_member_roles`, `tagline`, `property_search_url`, `direct_phone`, `toll_free_phone`, `experience_and_license_text`. Existing routes to fixed fields were kept (amfam.com to `person.team` / `person.headline`, remax.com to `person.years_experience`). Diagnostics (`static_routes_dropped`, `extra_dropped`) were left as they were. The matching per-category `extra_field` rows were renamed; `concierge_page_url` now counts compass.com only and `property_search_url` was added for howardhanna.com.
  - Dictionary: 19 `extra_key` rows (13 existing names plus the 6 new names), each with a definition, format, subject, up to 3 examples from the contracts, and seen_count across categories.
  - Before-copies: `exp_curation_ledger` ids 537012–537016.
- **Verified:** the four contracts list the new names in `extra_fields` and in their extra routes; `exp_field_discovery` holds 13 element rows, 29 extra_field rows and 19 extra_key rows. Rows staged before today keep the old names in `payload._extra`; new harvests use the new names.
- **Not yet done / open (C3, needs its own approval after deploy):** keys that duplicate fixed fields or have broken rules are left for remaps: office addresses (century21.com, farmers.com, weichert.com, schwab.com `office_phone_direct_2`), fax `office_phone_direct_2_2` (allstate.com; morganstanley.com values are broken links), office / brokerage names `employment_history_4` (century21.com, redfin.com), remax.com `focus_areas` (specialties), and morganstanley.com `employment_history_2` (mixed values, routed to `person.team`). The morganstanley.com `toll_free_phone` examples are broken links too. Also seen: howardhanna.com `download_app_url` is routed to `person.booking_url`, which looks wrong.

## Category Population: exact match first in category search (2026-10-22)
- **What triggered this:** the owner could not open "Restaurant" in Category Population: the search returned the first 12 names containing the text, alphabetically, and "restaurant" is inside 389 names (American restaurant, Anago restaurant, …). Approved as "Approved: exact match first in category search (UI code)".
- **Changes shipped (code `649e325`, `src/components/discovery/category-population-tab.tsx`, UI only):** three small reads of `gbp_categories` (by id, starts with, contains, 12 each) merged in that order: the exact name or id first (typing "Restaurant" or "gcid:restaurant" both find `gcid:restaurant`), then names starting with the text, then names containing it; 12 shown. % and _ in the text are matched literally.
- **Verified:** type-check shows no errors in the changed file. Live data: "Restaurant" now returns Restaurant, Restaurant supply store, then the contains matches.
- **Not yet done / open:** none.

## ETL AI cost log: exp_etl_cost_events, logging and AI Cost tab (2026-10-22)
- **What triggered this:** the owner asked whether ETL AI cost is tracked and asked for a cost log with averages per AI activity in Discovery. Table approved as "Approved: create exp_etl_cost_events (structural)"; code and UI under the same request.
- **What was wrong (verified on live data):** only site mapper version 2 (list research) computed a cost, stored inside each map request (21 of 138 map_site requests, $4.11). The worker's shared AI call (`callClaude` in `disco-ai-worker.ts`) dropped the token usage of every response, so discovery (10 requests), method checks (39), contract writing, extras matching and boundary generation left no cost record. `exp_cost_events` (general, empty) was left untouched at the owner's choice.
- **Changes shipped:**
  - Database (structural): table `exp_etl_cost_events` (event_id, occurred_at, activity, model, calls, input / cache read / cache write / output tokens, cost_usd, gcid, domain, request_id, job_id, detail), indexes on (activity, occurred_at) and (gcid, domain), RLS on with the "console read" select policy for authenticated users; written only by the server (admin client). Activity is free text: discovery, boundary, method_check, map_contract, map_research, extra_match.
  - Code `a9dc672`: new `-disco-ai-cost.ts` (price list moved from `disco-agent-mapper.ts`, same values; `noteAiUsage`, `withCostContext` with AsyncLocalStorage so overlapping worker calls never mix rows; one insert per worker request; a model without a price is logged with its tokens, cost 0, `detail.unpriced`). `disco-ai-worker.ts`: every `callClaude` call notes its usage; each request runs in a cost context (activity from the request tool; extras matching and boundary generation by their tool); the four early exits after one map step became returns, with the loop still stopping after a map_site request as before. `disco-agent-mapper.ts`: each research call is logged as map_research. `category-boundary.functions.ts`: Generate now / Regenerate logged as boundary.
  - UI `db6d29c`: new **AI Cost** tab in Discovery (`ai-cost-tab.tsx`; other tabs unchanged): period, category, site and activity filters; total cost, runs, AI calls, average per site map, unpriced calls; per activity (runs, calls, tokens, total, average per run and per call), per site, per category; log of the latest 300 events with a detail view. Loaded on open or Refresh, no polling.
- **Verified:** table, indexes and policy present; a rolled-back insert and read worked. Local run of the cost module with two overlapping mocked requests: each request's rows carried its own site and request id, extras matching and boundary rows took their own activity, an unknown model was logged unpriced, and a call outside a context was ignored. Type-check shows no errors in the changed files (30 elsewhere, unchanged baseline).
- **Not yet done / open:** live check after deploy (the restaurant pilot's discovery round has run already; its method checks and maps will be the first rows). Costs before 2026-10-22 are not in the log; the 21 recorded version 2 costs can be copied in (backfill D, separate approval). `disco-agent-probe.ts` (manual probe tool) is not logged.

## ETL AI cost log: version 2 mapping costs backfilled (2026-10-22)
- **What triggered this:** costs recorded before the cost log existed. Approved as "Approved: backfill version 2 mapping costs (data)".
- **What was done (data):** the version 2 research `cost_usd` of 21 map_site requests (152–195, 2026-10-13 to 2026-10-21, 15 sites) was copied into `exp_etl_cost_events` as activity `map_research`, model `unrecorded`, calls 1, time = request created, with `detail.backfill = true` (plus outcome, request status, active seconds). Only the cost was recorded on those requests (rounded to cents); model, tokens and call count were not. Ledger id 537017.
- **Verified:** 21 rows, $4.11 in total (real estate agents 16 maps, $3.07, average $0.19; insurance agent 5 maps, $1.04, average $0.21).
- **Rollback:** `DELETE FROM exp_etl_cost_events WHERE detail->>'backfill' = 'true';`
- **Not yet done / open:** the other activities (discovery, method checks, contract writing, extras matching, boundary) before 2026-10-22 cannot be priced; they left no usage.

## Method check status on source cards; Sonnet 5 price; unpriced cost rows repriced (2026-10-22)
- **What triggered this:** during the restaurant pilot the owner saw Retry enabled on cards whose method check was running; the cost log showed the worker's model (`claude-sonnet-5`) as unpriced. Approved as "Approved: disable Retry while method check runs (UI code)", "Approved: add Sonnet 5 price (code)" and "Approved: reprice unpriced cost rows (data)".
- **Changes shipped:**
  - Code `bbe6f29` (`category-population-tab.tsx`, UI only): the latest method check per domain is read (classify_method requests of the category); a card shows "Check queued" / "Checking now" with a matching reason line and Retry is disabled while one is open. The list polls every 15 seconds while a check is waiting or running, every 30 seconds while an unprobed source has no check yet; when a check finishes, sources, contracts and map attempts reload.
  - Code `240fc4f` (`-disco-ai-cost.ts`): `claude-sonnet-5` price added (USD per million: input 2, cache read 0.20, 5-minute cache write 2.50, output 10) and `claude-sonnet-5-5` cache read corrected from 0.20 to 0.10, both from platform.claude.com/docs/en/about-claude/pricing.
  - Data: 22 `exp_etl_cost_events` rows logged as unpriced (`claude-sonnet-5`) were priced from their stored tokens ($0.436 in total), with the prices used and `repriced_at` in `detail`.
- **Verified:** type-check shows no errors in the changed files; no unpriced rows left.
- **Not yet done / open:** 12 `claude-sonnet-5-5` research rows of pfchangs.com from today were priced with the old 0.20 cache read (a few cents too high in total); not changed (outside this approval).

## Site mapper: four fixes from the restaurant pilot (2026-10-22)
- **What triggered this:** the pfchangs.com pilot (location-first, gcid:restaurant). Approved as "Approved: shared-property item filter on single values (code)", "Approved: site-wide values go to brand in location categories (code)", "Approved: business name checked against page heading (code)" and "Approved: keep rejected rules for fixed fields (code)".
- **What was wrong (verified on live data):**
  - All 22 `serves_*` category keys of the 34 staged pfchangs.com records held "Asian, Chinese, Sushi" (the page's `servesCuisine`). Keys sharing a schema.org property are filtered to their own items only when the page gives a list or several values; pfchangs.com gives one string, so every key took it. Identical on every sample, they were moved to the brand (no schema type) while `cuisine_types` / `cuisine_type` (type Restaurant) were dropped as site_wide_value. Registry note: Restaurant's registry ties `serves_breakfast`, `serves_wine` and others to `servesCuisine` (taxonomy data, not changed here).
  - Every location was named "About P.F.Chang's <city>": the contract reads `Restaurant.name` from the page's JSON-LD, which carries that text, while the page heading is "P.F. Chang's <city>".
  - `location.hours` was unmapped as rule_failed_validation with no record of the rule or the reason (the hours parser handles the page's "Thu 11:00 AM - 10:00 PM" lines).
- **Changes shipped (code `d866186`):**
  - `-disco-site-contract.ts` `applyLocator` (JSON-LD): one value holding a separated list (comma, semicolon, |) is matched item by item for keys with item words, like lists already were.
  - `finalizeTaxonomy` (now given the primary subject): in a location-first contract a category value identical on every sample goes to the brand (subject firm) instead of being dropped; professional-first behaviour unchanged.
  - `applySiteContract`: when the page's first h1 sits at the start or end of `location.business_name` (letters and digits compared) and covers at least 60% of it, the heading becomes the name; values equal to the old name (category keys read from the same source) take it too.
  - `mergeCssRules` returns `rejected` (rule, samples found, why: incomplete_rule, label_is_brand_name, anchored_on_value, site_chrome, no_value_on_samples, clashes_with_other_field) for fixed fields; `disco-ai-worker.ts` collects them over the locator, previous-rule and must-have passes and `finalizeSiteContract` adds them to the field's `unmapped` entry.
- **Verified:** type-check shows no errors in the changed files. Local run on three generated pfchangs-style pages (JSON-LD name "About P.F.Chang's <city>", servesCuisine "Asian, Chinese, Sushi", h1 "P.F. Chang's  <city>"): business name and the restaurant_name key became "P.F. Chang's Birmingham"; serves_breakfast and serves_wine got no value (ambiguous_shared_property); a key named "Serves Chinese" got "Chinese" and, site-wide with type Restaurant, went to the brand; with a professional-first primary the same key was still dropped; a rejected hours rule showed rule, found 0 of 3 and why no_value_on_samples.
- **Not yet done / open:** pfchangs.com needs a remap (proposal for Accept) and a re-harvest to correct its records (separate approvals). `cuisine_types` / `cuisine_type` still get no value: their only distinctive words are "types" / "type", which are not in the cuisine list; the generic key of a shared property taking the whole value is a separate change. Person address fields on location-first records (`person.street` and others) are still written.

## Field-yield gate counts only current-contract records (2026-10-22)
- **What triggered this:** pfchangs.com was paused right after its remap was accepted. Approved as "Approved: gate counts current-contract records only (structural)".
- **What was wrong (verified on live data):** Accept saved the new contract (site_contract learned_at 2026-10-22T10:03:46.402Z) at 10:11 and started a 10-page test sample. `disco-harvest-worker.ts` caches a contract for 10 minutes (`CACHE_TTL_MS`), so the 10 pages were staged at 10:12 with the old contract (`payload._contract.learned_at` 08:15:29). The sample counters in `exp_etl_fetch_tick` (stop after 10 staged / 20 attempted) and `exp_etl_fetch_collect` (run the gate) counted records of any contract; `exp_etl_gate_full_pull` counts only the current contract's records, found 0 and returned BLOCKED ("sample smaller than 10 records"), and collect set the source to paused. Any accept within the cache window had the same race.
- **Changes shipped (database, structural):** `exp_etl_fetch_tick` (test_pull sample cap) and `exp_etl_fetch_collect` (gate trigger) now read the current contract's `extraction.site_contract.learned_at` and split the run's staged records into current (`v_cur`) and older (`v_old`). The sample is complete at 10 current records, or when page attempts minus older-contract records reach 20. Older-contract records stay staged. Everything else in both functions unchanged; `exp_etl_gate_full_pull` and the harvest worker unchanged. Before-copies: `exp_curation_ledger` ids 537217 (collect), 537218 (tick).
- **Verified:** both functions carry the fix; crons 90 and 91 ran and succeeded after the change (11:15 UTC). On pfchangs.com's live rows the new counting gives current 0, older 10, so the sample would continue instead of closing.
- **Rollback:** re-run the saved definitions from ledger ids 537217 / 537218.
- **Not yet done / open:** pfchangs.com is still paused (gate result BLOCKED from 10:12); setting it active or test_pull restarts its harvest. Active sources are unaffected by this change.

## Site mapper: location fields identical on every sample stay on the location (2026-10-22)
- **What triggered this:** the pfchangs.com remap still left `location.hours` unmapped. Approved as "Approved: keep site-wide location fields in location categories (code)".
- **What was wrong (verified on live data):** the 9 sample pages show identical hours (normal for a chain). `finalizeSiteContract` moves a fixed field identical on every sample to its brand equivalent or drops it; hours has no brand equivalent, so it was dropped, and the drop was recorded as `rule_failed_validation` (with no rule, since the rule had passed).
- **Changes shipped (code `c8ad6a6`, `-disco-site-contract.ts`):** in a location-first contract, a `location.*` field identical on every sample stays on the location, except brand-level keys (`FIRM_EQUIVALENT`: phone, logo, website, social links, business name), which move to the brand as before, and email / fax (a central line), which are dropped as before. Any dropped site-wide value is now recorded as `site_wide_value`. Professional-first contracts behave as before (only the recorded reason changes).
- **Verified:** type-check shows no errors in the changed file. Local run on three generated location pages with identical hours, email and phone: location-first kept `location.hours`, moved the phone to `firm.phone_main` and dropped the email as site_wide_value; professional-first dropped hours and email as site_wide_value and moved the phone to the brand.
- **Not yet done / open:** pfchangs.com needs a remap after deploy for its contract to keep hours (then its harvest picks hours up).

## Node creator: brand name from evidence (2026-10-22)
- **What triggered this:** the pfchangs.com brand was named "Pfchangs". Approved as "Approved: brand name from evidence (structural)".
- **What was wrong (verified on live data):** for a brand_site source, `exp_etl_resolve` named the brand from the page firm name or else from the domain (`initcap(split_part(domain,'.',1))`), and never renamed it afterwards (later records find the brand by its domain key). pfchangs.com's contract has no firm name, while discovery's company list records "P.F. Chang's" (page title and footer say the same). Weichert ("Weichert Realtors") and Corcoran ("Corcoran Group") were also domain-named.
- **Changes shipped (database, structural):** `exp_etl_resolve` brand_site branch: new `v_brand_label` = page firm name, else the name in the category's company list (`disco_proposals` kind `company_list`, latest entry for the domain), else the domain. A new brand is created with that label; an existing brand still named after its domain takes the label (never a claimed / verified brand). `v_brand_name` and therefore `v_brand_norm` (brand and office keys) are computed exactly as before, so no matching key changes. Before-copy: `exp_curation_ledger` id 537219.
- **Verified:** rolled-back test (pfchangs.com set active and one record re-processed inside the transaction): the brand became "P.F. Chang's", identity keys unchanged (`domain` pfchangs.com, `brand_name` pfchangs), still one brand. Cron 96 ran and succeeded after the change.
- **Rollback:** re-run the saved definition (ledger 537219); renamed brands can be set back to their domain names.
- **Not yet done / open:** live brands rename when one of their records is next processed: pfchangs.com (paused, restarts on Active / test pull), weichert.com and corcoran.com on their next harvested records. Reading the firm name from page evidence (copyright line, JSON-LD brand) is a separate mapper change.

## Pipeline sweep rule 5: first map for approved sources never mapped (2026-10-22)
- **What triggered this:** approved mortgage lender sources sat under "Not ready" with "no site mapping has been requested yet". Approved as "Approved: sweep maps approved sites never mapped (structural)".
- **What was wrong (verified on live data):** a map is queued only by `disco_method_ingest` when a method check ends with server_crawl, and sweep rule 1 sends only sources with an unknown method to a method check. crosscountrymortgage.com, movement.com and newrez.com were created by the 2026-08-03 seed with crawl_method server_crawl already set, so after approval no method check ran and no map was ever queued (until the owner used Remap: requests 203–205). Seeded server_crawl sources still proposed (Fairway, Guild, PennyMac, Rate.com) would hit the same gap when approved.
- **Changes shipped (database, structural):** `disco_pipeline_sweep` rule 5: an approved source with crawl_method server_crawl, no working contract (version 3 with a profile-page pattern) and no map_site request ever gets one map_site request (crawl_method from fetch_tier as in `disco_method_ingest`; `_queued_by` pipeline_sweep), under an open `remap` job of the category (created when none; rule 3 closes it). At most 3 per run; once per source (a failed map is retried with Remap). The result gains `maps_queued`. Before-copy: `exp_curation_ledger` id 537454.
- **Verified:** rolled-back test (guildmortgage.com set approved inside the transaction): the sweep returned maps_queued 1 with one map_site request for guildmortgage.com (crawl_method server_crawl). Live: no source qualifies today (0 queued); cron 89 ran and succeeded after the change.
- **Rollback:** re-run the saved definition (ledger 537454).
- **Not yet done / open:** sources marked js_needs_api, blocked_needs_proxy or unreachable are not mapped automatically (same as `disco_method_ingest`): ubs.com, sothebysrealty.com, thecheesecakefactory.com, exprealty.com, longandfoster.com.

## Category Population: not-approved wording on source cards (2026-10-22)
- **What triggered this:** proposed mortgage lender sources (Rocket Mortgage, UWM, Fairway, loanDepot and others, seeded on 2026-08-03 with a crawl method already set) showed "Passed the method check; no site mapping has been requested yet". Approved as "Approved: not-approved wording on source cards (UI code)".
- **Changes shipped (code `794b5d5`, `category-population-tab.tsx`, UI only):** a card whose source is `proposed` shows the badge "Not approved" and the line "Not approved yet. Approve it in the company list to start the method check and mapping."; a disabled Remap on a source that is not approved explains why on hover.
- **Verified:** type-check shows no errors in the changed file.
- **Not yet done / open:** none.

## Site mapper: page-specific header / footer values allowed (2026-10-22)
- **What triggered this:** newamericanfunding.com (mortgage lender) map 202 failed with "must-have fields not found: city, state". Approved as "Approved: page-specific footer values allowed (code)".
- **What was wrong (verified on live pages):** each loan officer page shows the officer's branch address in the page footer, and it differs per page (Heith Reade and George Sandoval: 15150 W Park Place, Office #2505, Goodyear, AZ 85395; Cassandra Trefry: 27431 Enterprise Circle West, Suite #200, Temecula, CA 92590), next to a site-wide corporate office line (1 MacArthur Place, Santa Ana, CA). The mapper removes header / footer / navigation from the sample text given to the AI (`cleanHtmlForPrompt`) and `mergeCssRules` rejects person / location rules into them (`locatorTargetsChrome`), so no city or state rule was proposed (unmapped: not_found_on_samples).
- **Changes shipped (code `3ebbdb3`):**
  - `-disco-site-contract.ts` `mergeCssRules`: a rule whose element is in the header / footer / navigation is kept when its values differ between the samples; identical on every sample it is rejected as site chrome as before (recorded as `site_chrome`).
  - `disco-ai-worker.ts`: when sample 1's header / footer differs from sample 2's, sample 1's header / footer (up to 6,000 characters) is added to the locator prompt, and the rule "never target the site header, footer or navigation" now allows a part holding the page's own data that changes between pages.
- **Verified:** type-check shows no errors in the changed files. Local run on three generated pages with branch addresses in the footer (two Goodyear, AZ, one Temecula, CA) and an identical corporate line: city, state and street rules into the footer were accepted; the corporate-line rule was rejected (why: site_chrome).
- **Not yet done / open:** newamericanfunding.com needs a remap after deploy. A footer element that changes between pages for other reasons (for example a date) could now be accepted for a text field; later checks (formats, site-wide, clashes) still apply.

## Contract save creates the contract row when missing; two lost contracts re-saved (2026-10-22)
- **What triggered this:** after Remap on mortgage lender sources nothing changed on the cards. Approved as "Approved: contract row created when missing (structural)" and "Approved: re-save contracts from maps 203 and 205 (data)".
- **What was wrong (verified on live data):** maps 203 (crosscountrymortgage.com, floor 26, about 4,091 profiles) and 205 (newrez.com, floor 17, about 375) completed with saveable first contracts (`save_check.save` true), but `disco_map_site_ingest` only UPDATEs `disco_site_contract`; the row is created by `disco_method_ingest`, and these 2026-08-03 seed sources never had a method check. The UPDATE matched nothing, the request was marked completed and the contract was kept only on the request. These were the only two such cases.
- **Changes shipped:**
  - Database (structural): `disco_map_site_ingest` inserts the `disco_site_contract` row (method = the source's crawl method when allowed by the method check, else server_crawl) with ON CONFLICT DO NOTHING right before its UPDATE. Rows that already exist are unchanged. Before-copy: ledger 537455.
  - Data: `disco_map_site_ingest(203 / 205, <contract stored on the request>)` re-run. Ledger 537456.
- **Verified:** both sites now have a version 3 contract (professional, floors 26 and 17). Sweep rule 4 started their test samples automatically at 13:02 (crosscountrymortgage.com: 1,998 profile pages queued plus 3 sitemaps; newrez.com: 374).
- **Rollback:** re-run the saved definition (ledger 537455); delete the two contract rows and their re-save proposals if needed.
- **Not yet done / open:** each site has two identical approved site_map proposals (the original save and the re-save). The extras dictionary refresh (`refreshExtraKeys`, run by the worker after a save) did not run for these two re-saves. Both sources have a 200-page daily quota (seed default). movement.com and newamericanfunding.com need a fresh Remap now that the footer fix is live.

## Schedules tab lists the current ETL jobs only (2026-10-22)
- **What triggered this:** the owner asked that the Schedules tab show only the jobs of the current ETL process. Approved as "Approved: Schedules lists current ETL jobs only (structural)" and "Approved: Schedules tab notes for current jobs (UI code)".
- **What was wrong (verified on live data):** the tab and the two functions behind it listed eight jobs: three of an older path (`etl-extract-tick`, `etl-extract-collect` off; `etl-recon-retry-sweep` off, last run 13 days earlier) and `etl-recon-collect` (on, but only 8 robots / sitemap requests ever, the last on 2026-10-15), while the current Station 7 enhancer, Station 8 profile gate and publish jobs were missing.
- **Changes shipped:**
  - Database (structural): the job list in `exp_etl_cron_list` and `exp_etl_cron_set_active` is now disco-ai-worker-drain, etl-fetch-tick, etl-fetch-collect, etl-resolve-tick, etl-enhance-tick, etl-profile-gate-tick, etl-publish-tick; role checks and the audit row unchanged. Before-copies: ledger 537457 (list), 537458 (set active).
  - UI `8ee82f4` (`schedules-tab.tsx`): notes for the seven jobs in station order (AI worker now mentions the pipeline sweep; new Enhancer, Profile gate and Publish notes; Publish states what switching it on does); the heading says "from discovery to publish".
- **Verified:** both functions carry only the new list; each of the seven cron jobs exists once (publish off, the others on). Type-check shows no errors in the changed file. No cron entry changed.
- **Not yet done / open:** the four removed jobs keep their current state (extraction and retry off, `etl-recon-collect` on) and can no longer be switched from the tab; retiring `etl-recon-collect` would be a separate decision.

## ETL and discovery code ported from TypeScript to Python/FastAPI (2026-10-23)
- **What triggered this:** the migration of experiencesrp-clone (`e9e96ce`) into the v3 Surface split (branch `migrate/from-experiencesrp-clone`): server code moves from TanStack Start (`createServerFn`, `routes/api/**`) to FastAPI in `surface-api/`.
- **Changes shipped (code only; no database, cron or data change):**
  - Shared discovery library `surface-api/_base/disco/`: `site_contract` (package), `ai_cost`, `boundary`, `detail_api`, `extra_keys`, `webscraper`, `sameas_classifier`, `credential_classifier`, `agent_engine`, `network_route` (from the `-disco-*` modules and classifiers).
  - ETL Surface `surface-api/etl/`: `disco/ai_worker*` (disco-ai-worker), `disco/search_route`, `disco/agent_browser`, `agent_prompt`, `agent_mapper`, `contract_row`, `deep_hydrate`, `statefarm`; routes at the old paths minus `/api`: `/public/disco-ai-worker`, `-agent-mapper`, `-agent-probe`, `-list-worker`, `-detail-api-worker`, `-harvest-worker`, `-staging-backfill`, `-webscraper-worker`, `/public/etl-deep-hydrate`, `/public/export-prompt-bundles`.
  - Same worker-key checks, time budgets (`DISCO_V2_BUDGET`, unit / call budgets), prompts, tool schemas and model ids; writes through the same `disco_*` RPCs and tables as the TS.
- **Verified:** 515 backend tests pass with the database and network faked (parsers, classifiers, routing decisions, payload builders, an end-to-end `map_site` on a fake site with the real site-contract library); ruff clean; every first-party import resolves; the app mounts all routes. Nothing ran against the live database or real sites.
- **Rollback:** the TS workers are unchanged in experiencesrp-clone; point the schedulers back at the old host.
- **Not yet done / open:** the schedulers (pg_net cron calls) still target the old Lovable host; switching them to the new API host is a gated, human-approved release step. No side-by-side run of the Python site-contract / mapper against the TS on real pages yet. Behaviour differences to watch: cheerio-only selectors (`:first`, `:eq()`) yield no value; html.parser vs parse5 on malformed pages; the Anthropic call is capped at 600 s (TS had none). Ported as-is and open: `etl-deep-hydrate` writes `graph_nodes` directly (not `exp_graph_upsert_nodes`); `etl-deep-hydrate` and `export-prompt-bundles` have no auth.

## campaigns and xmp tables, ORM models and survey-templates endpoint in surface-api (2026-10-26)
- **What triggered this:** the owner asked for the campaigns and xmp tables, their ORM models and the survey-templates endpoint in `surface-api`, following its rules. Increment `surface-spec/campaigns/campaigns-xmp-tables`.
- **Changes shipped (code and unapplied migrations; no database, cron or data change):**
  - Rule (shared core): one Postgres schema per Surface (AGENTS.md §3/§4, Surface AGENTS.md, migration READMEs, `alembic_env/env.py`, migration-authoring and rls-grant-review skills; `surface-api/tests/test_schemas.py`).
  - Rule: only the owning Surface reads and writes its schema's tables; others go through its `exports.py` (AGENTS.md §2, `surface-api/tests/test_boundaries.py`).
  - Rule: new tables have no row-level security; access is by grants only (owner decision 2026-10-26, AGENTS.md §3 changed).
  - `_base/db/migrations/140d9efec771_base_survey_sources.py`: shared core's `public.survey_sources`, ORM class `_base/models/survey_source.py`. `tests/test_migrations.py` now accepts a later `_base` revision as a branch's start and rejects a revision listing a `_base` revision with its ancestor (that made `alembic upgrade heads` fail with a KeyError).
  - `xmp/db/migrations/bee7556b77dd_xmp_tables.py` (schema `xmp`: `verticals`, `accounts`, `tiers`, `tier_agents`, `users`, `account_users`) and `campaigns/db/migrations/ec94892239fd_campaigns_tables.py` (schema `campaigns`: `campaigns`, `campaign_drafts`, `campaign_transactions`, `survey_templates`, `vertical_survey_templates`). No session table (Supabase sign-in). Schemas closed to anon / PUBLIC; every table revokes all from anon / authenticated / PUBLIC; signed-in users get SELECT on the four setup tables only.
  - ORM classes in `xmp/src/models` and `campaigns/src/models` (one module per table) on a new shared `_base/db/base.py`, checked against the migrations with Alembic `compare_metadata` (0 differences); xmp read helpers in `xmp/src/exports.py`; `GET /campaigns/survey-templates?vertical_id=`.
- **Verified:** on a scratch Postgres 18 with Supabase-like roles: upgrade, role checks, the endpoint through the app, downgrade, upgrade again. ruff and pytest pass. Nothing ran against the live database.
- **Rollback:** not applied anywhere; revert the files. After an apply: `alembic downgrade campaigns@base`, `alembic downgrade xmp@base`, then `alembic downgrade 866c5f655041`.
- **Not yet done / open:** apply is blocked on the O11 ruling (campaign tables, survey model), the identity-registry decision (`users` / `account_users` vs Supabase users) and a ruling on the `verticals` name (canon says "category"). Not yet checked that the two schemas are absent from the live database.
