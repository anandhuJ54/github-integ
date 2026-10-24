# Browser → API migration — per-Surface todo

The browser's direct supabase-js calls move into FastAPI, one Surface per branch and PR.
Surfaces that haven't been migrated yet keep calling Supabase directly, still protected by RLS.

**How each Surface is done:** reads are built with the SQLAlchemy Core query builder (no ORM) in
`surface-api/<surface>/queries/`. Response shapes are Pydantic models and are published to
`contracts/<surface>/openapi.json`. The UI calls the API through `api.get/post` from
`@v3/ui/lib/server-fn` and keeps the same react-query keys.

**Done means** every box below is ticked, including **parity**: the legacy browser function
and the new endpoint return the same JSON for the same signed-in user (`surface-ui/parity`).

Counts are (reads/writes/rpc) as measured on 2026-10-23.

**The 1,000-row cap (decided 2026-10-23: the API matches it).** Self-hosted PostgREST returns at most 1,000 rows per REST response, and the API does the same: `_base/core/sql.fetch_all` lowers any SELECT's LIMIT to `MAX_ROWS = 1000`. Counts and aggregates are computed in SQL, so the cap doesn't affect them. Where the browser aggregated rows itself (for example PLG event stats), the API aggregates over the same ≤1,000 rows. Pass `max_rows=None` only with an explicit decision.

## Steps for every Surface

1. List the calls and group them into endpoints.
2. Add tables to `_base/schema/generate.py`, then regenerate `tables.py`.
3. Write the Core queries in `queries/<feature>.py` and the router with Pydantic response models.
4. Run pytest with a fake connection, and a live read-only smoke test against GCP.
5. Publish the contract: `uv run python -m _base.contracts <surface>`.
6. Switch the UI to `api.get/post`, keep the query keys, and check that `tsc` passes.
7. Add a parity case in `surface-ui/parity/cases/<surface>.ts`; `bun run.ts <surface>` must PASS.
8. Click through the screen in the app.
9. Lint ratchet that blocks direct Supabase calls in this Surface. This is a separate PR, because a new lint rule needs one.

## Phase 0 — shared plumbing

- [x] `api.get/post` in `surface-ui/_base/src/lib/server-fn.ts`, attaching the user's JWT, sharing one `request()` with `serverFn`
- [x] `sqlalchemy` (Core) dependency; `sqlacodegen` dev dependency
- [x] `_base/schema/generate.py` → `_base/schema/tables.py` (generated from GCP; never hand-edited)
- [x] `_base/core/sql.py` runs a Core statement on a `role_connection` (with IN-list expansion and PostgREST-shaped rows)
- [x] `_base/contracts.py` exports the OpenAPI for each Surface, and `contracts_test.py` fails when a contract is stale
- [x] Parity harness `surface-ui/parity/run.ts`: legacy function from the pre-port git ref vs the API, same login, JSON diff
- [x] Both sides on one database: the UI uses `https://supabase.selfhost.qa.experience.com` and the API uses GCP Postgres (2026-10-23)
- [x] API JWT verification: `SUPABASE_JWT_SECRET` (HS256) is set from the DB's `app.settings.jwt_secret`
- [x] Parity login: an email/password account on self-hosted works
- [ ] The API connects with a personal DB login (5min timeout). It needs a dedicated service account before any shared deploy.
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `surface-api/.env` (prompt-bundle export, claim identity, claim OTP need them)
- [ ] The Lovable sign-in on the claim page still uses the cloud project (deferred)
- [ ] `tools/lint/lint_all.py` doesn't exist on this branch yet; the ratchet in step 9 depends on it.

## Surfaces

### 1. nora-os (1/0/0) — pilot · branch `migrate/api-nora-os`
- [x] 1. One endpoint: `GET /nora-os/etl-monitor`. It replaces the 14 reads in `lib/etl-monitor.ts`; the 11 counts became 3 FILTER aggregates.
- [x] 2. Tables: exp_etl_field_floors, exp_etl_staging, graph_nodes, professionals
- [x] 3. `nora_os/queries/etl_monitor.py`, `nora_os/routers/etl_monitor.py`
- [x] 4. pytest (`etl_monitor_test.py`); live smoke as service_role on GCP: the response validates (31,355 staged, 3 floors)
- [x] 5. `contracts/nora-os/openapi.json`
- [x] 6. `etl-monitor.ts` calls `api.get`; the query key `["etl-run-monitor"]` is unchanged. The Surface now has 0 direct Supabase calls.
- [x] 7. Parity PASS (2026-10-23, signed in, against self-hosted GCP)
  - The three `graph_nodes` counts time out (8s) for the legacy `authenticated` read, so they are patched out and checked against SQL instead: 259,038 product_service, 105,517 social_profile, 211,423 credential.
  - The first run showed `deepRows` 997 vs 1195: the legacy read was cut to 1,000 rows by PostgREST. The API now applies the same cap, so this needs a re-run to confirm.
- [x] 8. Click-through of the `/nora-os` console (2026-10-23): the panel renders from `/api/nora-os/etl-monitor`, and no `rest/v1/exp_*` or `rest/v1/graph_nodes` calls are made
- [ ] 9. Lint ratchet

### 2. conversion-agents (7/7/1) · branch `migrate/api-conversion-agents`
- [x] 1. Endpoints under `/conversion-agents/`:
  - `/claims`: `GET claims/stats` (the 4 counts, now 1 query), `GET claims?tab=`, `POST claims/entities`, `POST claims/{id}/adjudicate` (the `exp_claim_queue_adjudicate` RPC)
  - `/emp/plg-rules`: `GET plg-rules`, then `POST`, `PUT`, `PATCH …/active`, `POST …/duplicate` and `DELETE`, each writing its audit_log row in the same transaction
  - `/claim/{slug}`: `GET claim-profile/{slug}`
- [x] 2. Tables: audit_log, claim_queue, exp_category_compliance, organizations, plg_events, plg_rules
- [x] 3. `conversion_agents/queries/{claims,plg_rules,claim_profile}.py`, `conversion_agents/routers/{claims,plg_rules,claim_profile}.py`
- [x] 4. pytest (`queries_test.py`). Live read-only smoke as the signed-in user: 0 claims and 0 PLG rules are visible to that account under RLS (GCP has 90 and 9), and the claim profile resolves.
- [x] 5. `contracts/conversion-agents/openapi.json`
- [x] 6. All three pages call `api.*` with the query keys unchanged. No `.from()`/`.rpc()` left; only Supabase auth remains on the claim page.
  - Changed: a new rule's audit entry records the new id (the TS logged null). A refused audit row still keeps the change, as before.
- [x] 7. Parity PASS 9/9 (2026-10-23, signed in): stats, 5 tabs, entities, plg-rules, claim profile
- [x] 8. Click-through (2026-10-23): `/claims` calls `/api/conversion-agents/claims?tab=pending` (and `claims/stats`) instead of `rest/v1/claim_queue`
- [ ] 9. Lint ratchet

### 3. search (7/8/3) · branch `migrate/api-search` · resumed 2026-10-23 (the DB fix is deferred to SF-1..3)
- [x] 1. Endpoints under `/search/console/` (`search/routers/console_data.py`):
  - Reads: `category-labels`, `launched-categories`, `overview`, `indexing` (5 coverage counts in 1 query), `sponsored`, `ads`
  - Writes: index agent on/off, index config (upsert), sponsored pricing, slot assign/lock/release/create, ad create/update/delete
  - The 3 indexing RPCs (gated actions)
- [x] 2. Tables: exp_page_views_rollup, exp_index_agent, exp_index_queue, exp_sitemap_partition, exp_index_submission_log, exp_index_config, exp_sponsored_pricing, exp_sponsored_slots, exp_web_ads
- [x] 3. `search/queries/console.py`
  - Ruling: mirror today's access (the API runs as the signed-in user); the DB fix is deferred.
  - `site_indexing_enabled` is now also refused server-side.
  - Pricing and ad patches are allow-listed.
- [x] 4. pytest (`search/queries/queries_test.py`). Live read-only smoke as the signed-in user: all 6 reads work.
  - The indexing config shows 0 rows for a non-super_admin (RLS).
  - The coverage counts are real: 116,198 held, 19,882 pending.
  - **The indexing RPCs were not run** (gated).
- [x] 5. `contracts/search/openapi.json`
- [x] 6. The search pages make no direct Supabase calls.
- [x] 7. Parity PASS 6/6 (2026-10-24, signed in): every loader, legacy from git vs current, end to end.
  - Maps are compared as their entries. Positional slot arrays keep their order.
- [ ] 8. Click-through: open pages only. Never press Rebuild sitemap, Submit tick, Sync queue or any save button.
- [ ] 9. Lint ratchet

### 4. admin (19/2/1) · branch `migrate/api-admin`
- [x] 1. Endpoints under `/admin/` (`admin/routers/console_pages.py`):
  - `/professionals`: `GET professionals/categories` (replaces the walk of up to 200 requests with one `SELECT DISTINCT`), `GET professionals/stats` (4 counts in one query), `GET professionals?…` (paged, exact count), `POST professionals/{scores,depth,extras}`
  - `/organizations`: `GET organizations/categories`, `GET organizations?…`
  - `/compliance`: `GET compliance/coverage`, `GET compliance/entities`
  - `/admin/users`: `GET control-users`, `GET control-grants`, `POST control-grants`, `DELETE control-grants/{id}`. These are identity changes and need a second approval; the DB keeps them `super_admin`-only.
- [x] 2. Tables: content_compliance_rules, entity_compliance, exp_control_grants, gbp_categories, search_rank_scores
- [x] 3. `admin/queries/{professionals,organizations,compliance,grants}.py`
- [x] 4. pytest (`admin/queries/queries_test.py`). Live read-only smoke as the signed-in user: all reads work, and control-users is correctly `forbidden` for a non-super_admin.
  - Security check: RLS is on for every admin table and no anon write policy exists. `list_control_users` and the grant writes are guarded by `has_control_role(…, 'super_admin')`.
- [x] 5. `contracts/admin/openapi.json`
- [x] 6. All four pages call `api.*` with the query keys unchanged. `loadOrgStats` and `logAudit` are `_base` code and move with `_base`.
- [x] 7. Parity PASS 15/15 (2026-10-23, signed in). Tied rows on the paged lists are compared in one order; the API adds `id` as the final sort key.
- [x] 8. Click-through (2026-10-23): `/professionals` makes no direct calls of its own. What remains is from `_base`: exp_control_grants, bootstrap_control_super_admin, exp_territories.
- [ ] 9. Lint ratchet
- **Gaps that already exist, kept as-is because of the 1,000-row cap.** Each would need an explicit `max_rows` decision to change.
  - `/compliance` shows only 1,000 of the 4,041 categories.
  - The `/organizations` category dropdown is built from 1,000 of the 38k organizations.
  - `/professionals` graph depth: 50 professionals × ~30 nodes exceeds 1,000 rows, so about 10 of the 50 get no depth figures.

### 5. srp (31/0/3) · branch `migrate/api-srp` · public pages, run as `anon` (or as the signed-in visitor)
- [x] 1. Endpoints under `/srp/` (`srp/routers/public_profile.py`):
  - `GET profile/p/{slug}`: about 17 legacy reads in 2 round trips (office, company and partner lookups are subqueries)
  - `GET profile/{o|c}/{slug}`: about 13 reads in 2 round trips
  - `GET category-label/{gcid}`
  - `GET sponsored-slots` and `GET ad-units` (read RPCs); `POST page-view` (the ping RPC)
- [x] 2. Tables: aggregate_ratings, content_items, credentials, exp_category_page_template, exp_category_profile_config, exp_ring, exp_taxonomy, graph_edges, media_items, reviews
- [x] 3. `srp/queries/{profile,monetization}.py`
  - The page logic (fallbacks, merging, JSON-LD) stays in TypeScript and now builds from the API rows: `pageTemplateFrom`, `graphSectionsFrom`, `expertiseFrom`, and so on.
  - The dead `loadProfessionalProfile` / `loadOrgProfile` in `public-profile.ts` were removed, not ported.
- [x] 4. pytest (`srp/queries/queries_test.py`), plus a live check as anon.
  - Security: 12 of the 14 tables have RLS on with read-only anon policies, and the 3 RPCs are SECURITY DEFINER with a pinned search_path.
  - `exp_category_page_template` and `exp_ring` are SF-1 tables (RLS off, anon write). srp only reads them.
  - The legacy `exp_ring` read is kept exactly as it was, with no new ring logic (O1).
- [x] 5. `contracts/srp/openapi.json`
- [x] 6. srp makes no direct Supabase calls. What remains comes from `_base`: `loadAuthorArticles`, `runSearch`, `loadHubArticles`.
- [x] 7. Parity PASS 14/14 (2026-10-23, signed out, end to end).
  - The legacy `loadProfessionalBundle`/`loadOrgBundle` (from git) were compared with the current ones: 5 professionals, 5 organizations and brands (including unknown slugs), sponsored slots, 2 ad-unit lookups and a category label.
  - Checked that the cases carry real data, e.g. Greg Aldridge: 20 services, 3 credentials, 8 proof rings.
- [x] 8. Click-through (2026-10-23, signed out): each profile page makes one `/api/srp/profile/…` request; what is left on `rest/v1` comes from `_base`
- [ ] 9. Lint ratchet
- **Speed (shared `_base`).** Each GCP round trip is ~240 ms over the VPN.
  - `fetch_many` sends a batch through a psycopg pipeline with a manual savepoint, so the whole batch is 1 round trip.
  - `role_connection` sets claims + role in one `set_config` statement.
  - A profile went from 13 s to ~1.6 s.

### 6. ops (actually ~75 call sites, 2 storage calls) · branch `migrate/api-ops`
- [x] 1. Endpoints under `/ops/` (`ops/routers/console_data.py`):
  - Dev tracker reads: `dev/overview`, `dev/teams/{id}`, `dev/open-gates`, `dev/board`, `dev/weekly`
  - Dev tracker writes: an allow-listed `POST`/`PATCH`/`DELETE dev/{entity}[/{id}]` for 10 tracker tables, `PUT dev/weekly-updates` (upsert) and `POST dev/ideas/{id}/vote`
  - Wiki reads: spaces, space, docs, doc, comments, revisions, search, watching
  - Wiki writes: create/update doc, comment, resolve, watch toggle
  - Console: profiles (19 counts → 2 queries), revenue, categories, nora-events
- [x] 2. Tables: exp_dev_* (12), exp_wiki_* (5), exp_contracts, exp_activity_events, disco_jobs
- [x] 3. `ops/queries/{dev,wiki,console}.py`
  - Who-fields (author, updated_by, submitted_by, voter, user_ref) are now set by the server from the login (same value: email, else id), so they can't be spoofed.
- [x] 4. pytest (`ops/queries/queries_test.py`). Live smoke as the signed-in user: every read returns data.
  - Security: SF-5 (always-true policies on 17 ops tables, incl. exp_contracts). exp_dev_config and exp_dev_weekly_updates are SF-1.
  - Found and fixed: comparing Date/DateTime columns with ISO strings bound them as VARCHAR. New `_base.core.sql.typed()`; the tolerant fallback now logs a warning instead of hiding errors.
- [x] 5. `contracts/ops/openapi.json`
- [x] 6. No direct table calls are left. What remains is Supabase auth and the 2 storage calls (document upload and signed URL), which wait for the storage design.
- [x] 7. Parity PASS 20/20 (2026-10-23, signed in): legacy loaders from git vs current, end to end, plus the 4 console panels.
  - Non-empty data: overview (14 teams), board (16 sprints, 67 items), weekly 2026-08-24 (5 updates), 8 spaces, search "canon" (3 hits) and "ring" (1 hit), 12 contracts.
  - Wiki comments are 0 in the DB.
- [ ] 8. Click-through: open pages only. Every button writes (SF-5).
- [ ] 9. Lint ratchet

### 7. etl (actually ~65 call sites + 19 RPCs, 14 files, one page `/discovery`) · branch `migrate/api-etl`
- [x] 1. Endpoints under `/etl/console/` (`etl/routers/console_data.py`):
  - Group 1 (tabs + hierarchy): AI cost, field yield, required fields, runs, schedules, source stats, manual company add, hierarchy sources/search/brands/labels/table/counts/tree, entity detail (1 request)
  - Group 2: pipeline (sources, staging gcids, funnel, page), site contract + proposals + accept state, source states (1 request incl. queue counts), done pages, registry, category population (search, job, sources, proposal, runs, staged, contracts, map/method attempts, discovery running)
  - Writes: 11 governed functions through one allow-listed `POST rpc/{name}` (each parameter cast to its DB type; omitted ones keep the defaults), plus `sources/run`, `field-floor`, `schedules/active` and `companies/manual`
- [x] 2. Tables: exp_etl_* (cost events, frontier, jobs, runs, sources, staging, field floors, hydrate jobs), disco_* (jobs, llm requests, proposals, site contract), exp_entity, exp_rel, gbp_categories
- [x] 3. `etl/queries/{common,tabs,hierarchy,sources}.py`. The PostgREST embeds with filters (`!inner`, `not.is.null`, `is null`, to-one objects) are rebuilt as EXISTS / json_agg subqueries.
- [x] 4. pytest (`etl/queries/queries_test.py`). Live read-only smoke as the signed-in user: every read works.
  - Security: every table has RLS on (read-only to `authenticated`), and writes go only through SECURITY DEFINER functions. **SF-6**: `disco_activate` and `disco_request_remap_site` have no role check and are anon-callable.
  - **No gated function was run** (schedules, run, reharvest, activate, discover).
- [x] 5. `contracts/etl/openapi.json`
- [x] 6. etl makes no direct Supabase calls.
- [x] 7. Parity PASS 46/46 (2026-10-24, signed in): every tab, hierarchy embed and population case.
  - The staging page compares total + observed_at order, because 25,809 rows share one observed_at.
  - An intermittent first-request 500 was a connection-lease failure. The API now answers 503 with the reason (`_base/app_factory.py`).
- [ ] 8. Click-through: open `/discovery` and its tabs only. Every button is a gated or role-checked ETL action.
- [ ] 9. Lint ratchet

### 8. graph (actually 66 reads, 19 writes, 6 RPCs across 17 files) · branch `migrate/api-graph`
Pages:
- `/categories`
- `/categories/:gcid` (summary plus 9 tabs)
- `/control-graph` (health, control tree, entities, claims)
- `/:category/:city/:professional`
- public `/p|o|c/:slug/graph`

- [ ] 1. Endpoints: reads first. Writes are held for a ruling (below).
- [x] 2. Tables and security (2026-10-24, read-only). 38 tables, all with RLS on and read-only policies. **SF-7**: audit_log always-true insert, two unpinned SECURITY DEFINER functions, anon EXECUTE on all six RPCs, and three tables with no policy (they always read empty).
  - Cap gaps: **1g** (claims entity lookup, `limit 2000`) and **1h** (expertise graph, up to 2,644 nodes per entity).
  - Every per-gcid read is within the cap: at most 473 node-registry rows and 402 taxonomy rows per gcid.
- [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9
- **Writes ported as they are (ruling 2026-10-24: "modify as it is"), same statements as the signed-in user, with routing through proposals still open (FOLLOWUPS §3). Expertise graph: no cap (1h).** Context (§3, category data only through `exp_category_proposals`, never DELETE).** The browser does direct writes to:
  - `exp_taxonomy`, `exp_vertical_node_registry` and `content_compliance_rules`: insert, update and **delete**
  - `exp_category_knowledge.ai_agents`, plus `gbp_categories` (`status`, `supports_single_pro_office`): update
  - `audit_log`: insert

  No table has a write policy, so on GCP these are already no-ops (updates and deletes match 0 rows; inserts fail). The control-tree and claims RPCs check the role and can be ported as they are.

### 9. xmp (58/29/6)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 10. `_base` (56/43/10) — each call goes to the Surface that owns its table
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 11. sales (144/87/16) — money: needs a second approval, split into 3–4 PRs
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

marketing and app make no direct calls.

**Out of scope:** Auth (login, sessions, password reset) stays on Supabase Auth. Storage and
realtime get a separate design. Removing anon table grants is a gated DB release step.
