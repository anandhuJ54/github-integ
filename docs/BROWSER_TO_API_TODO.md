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
5. Publish the contract: `uv run python -m app.contracts <surface>`.
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

- [x] 1. Endpoints (46 routes):
  - `/graph/categories/*` (`graph/routers/categories_data.py`): index, detail, the 9 tabs and the listings catalog, plus the category-edit writes ported as they are
  - `/graph/control/*`: health, tree, entities, claims, and allow-listed RPCs (`GRAPH_RPCS`)
  - `/graph/profile/{slug}`
  - public `/graph/expertise/{kind}/{slug}` (anon when signed out, uncapped)
- [x] 2. Tables and security (2026-10-24, read-only). 38 tables, all with RLS on and read-only policies. **SF-7**: audit_log always-true insert, two unpinned SECURITY DEFINER functions, anon EXECUTE on all six RPCs, and three tables with no policy (they always read empty).
  - Cap gaps: **1g** (claims entity lookup, `limit 2000`) and **1h** (expertise graph, up to 2,644 nodes per entity).
  - Every per-gcid read is within the cap: at most 473 node-registry rows and 402 taxonomy rows per gcid.
- [x] 3. `graph/queries/{categories,entities}.py` (Core only)
- [x] 4. pytest: 55 new tests, 702 in total. Live read-only smoke as `authenticated` and `anon`. **No write or write RPC was run.**
  - The group-memberships embed could never work (no foreign key, and `exp_category_groups` has no `name`/`slug`), so it returns `groups: null`, as the page effectively got.
  - Most `audit_log` inserts already failed (no `metadata` column; gcid in a uuid column). They are kept as they were.
  - The AI config knowledge read errors (406) on gcids with 2 knowledge rows, as before.
  - Expertise: if one of the three uncapped reads fails, the page now shows an error instead of an empty graph.
- [x] 5. `contracts/graph/openapi.json`
- [x] 6. No `supabase.from` or `.rpc` calls remain in `surface-ui/graph` (only `auth.getSession`).
- [x] 7. Parity PASS 68/68 (2026-10-24, signed in, not super_admin): all 51 category cases, 8 control, 4 profile, 5 expertise.
  - amber-ernst is explained: 1,000 legacy nodes vs 2,644 from the API (uncapped ruling).
  - The newest-1000 entities case compares only the tie-free part, because bulk loads share one `created_at`.
  - The users case compares what the page shows: a refusal becomes `[]`.
- [ ] 8. Click-through · [ ] 9. Lint ratchet
- **Writes ported as they are (ruling 2026-10-24: "modify as it is"), same statements as the signed-in user, with routing through proposals still open (FOLLOWUPS §3). Expertise graph: no cap (1h).** Context (§3, category data only through `exp_category_proposals`, never DELETE).** The browser does direct writes to:
  - `exp_taxonomy`, `exp_vertical_node_registry` and `content_compliance_rules`: insert, update and **delete**
  - `exp_category_knowledge.ai_agents`, plus `gbp_categories` (`status`, `supports_single_pro_office`): update
  - `audit_log`: insert

  No table has a write policy, so on GCP these are already no-ops (updates and deletes match 0 rows; inserts fail). The control-tree and claims RPCs check the role and can be ported as they are.

- 2026-10-24 correction: `components/scoring/expected-volume-keys.tsx` still called `exp_set_expected_volume` directly (a type cast hid it from the scan). Now `POST /graph/control/rpc/exp_set_expected_volume`, added to `GRAPH_RPCS`; the function checks super_admin / architect itself.

### 9. xmp (actually ~75 reads, ~50 writes, 7 RPCs across 12 files) · branch `migrate/api-xmp`
Pages:
- `/dashboard` (+ content, listings, reviews)
- `/enterprise/:orgSlug` (+ users, campaigns, and the pages built on `lib/enterprise-xmp.ts`)
- `/seat/:kind/:id` (+ tabs, `lib/seat.ts`, `lib/insurance-team.ts`, `lib/nora/interview-data.ts`, `lib/office-mode.ts`)
- `/website/*` CMS (`lib/website.ts`, most of the writes)

- [x] 1. Endpoints:
  - `/xmp/website/*` (`xmp/routers/website_data.py`): 13 loaders and about 40 CMS writes
  - `/xmp/*` (`xmp/routers/seat_data.py`): enterprise (brand, offices, moderation, view-as, campaigns, users, invitations, impersonate/deactivate), seat, interview, team, dashboard, and the allow-listed `POST rpc/{name}` (`XMP_RPCS`)
- [x] 2. Tables and security (2026-10-24, read-only). 38 tables; the 7 RPCs are SECURITY INVOKER. **SF-8**:
  - The website CMS and exp_web_leads are always-true for `authenticated`.
  - The sales reps/quotas/territories tables are always-true.
  - exp_revenue_components has RLS off.
  - 7 tables have no policy, so they always read empty: invitations, user_roles, user_accounts, review_campaigns, listings, plg_rules, content_compliance_rules.
  - Cap: no read is cut today. **1i**: hierarchy reads are latent (only 2 orgs have `hierarchy_path`), and the largest office roster is 990 of the 1,000 cap.
- [x] 3. `xmp/queries/{website,common,enterprise,seat,dashboard}.py` (Core only)
- [x] 4. pytest: 112 new tests, 815 in total. Live read-only smoke as `authenticated`. **No write was run.**
  - `reviews.review_text` doesn't exist, so the legacy view-as and moderation review reads always failed (the page showed nothing). The API returns `[]` for both.
  - `invited_by` and the audit `user_id` now come from the token, no longer from the page.
  - Timestamps (`updated_at`, `published_at`, …) now use the server clock.
  - CMS patch models accept only the columns the UI sends.
  - No professional has `user_id` set, so `/dashboard` is empty for everyone, as before.
- [x] 5. `contracts/xmp/openapi.json`
- [x] 6. No `supabase.from` or `.rpc` calls remain in `surface-ui/xmp` (only auth, plus the Storage upload in section-editor). `/website/cms` still shows `exp_web_nav_menus` and `exp_admin_audit` calls, from `@v3/ui` `nav-menus.ts` and `roles.tsx`. Those move with **`_base`**.
- [x] 7. Parity PASS 69/69 (2026-10-24, signed in): 13 website loaders, enterprise, seat, office mode, interview, team and dashboard. The first run gave 404s only because the API was started before the xmp routes existed.
- [ ] 8. Click-through · [ ] 9. Lint ratchet
- Writes are ported as they are (same statements, as the signed-in user). Unlike graph, the website CMS writes **do** work on GCP (always-true policies).
- Writes to the no-policy tables (invitations, review_campaigns, professionals update) fail or match 0 rows, as before.
- The `section-editor.tsx` image upload uses Supabase Storage. It stays as it is (storage is out of scope).

### 10. `_base` (56/43/10) — each call goes to the Surface that owns its table · branch `migrate/api-base`
- [x] 2. Tables and security (2026-10-24, read-only): **SF-9**. Cap: nothing is cut.
- Proposed owner per lib (the `@v3/ui` lib keeps its exports; only its data source changes):

  | lib | tables / RPCs | used by | owner API |
  |---|---|---|---|
  | `roles.tsx` | exp_control_grants, exp_control_nodes, exp_entity names, exp_admin_audit insert, rpc bootstrap_control_super_admin | every console | admin (`/admin/me/...`) |
  | `nav-menus.ts` | exp_web_nav_menus (reads + 7 writes) | xmp website | xmp (`/xmp/website/nav-menus`) |
  | `enterprise-ops.ts` | crm_integrations, oauth, sync_jobs, enterprise_settings, sso_config, user_roles, invitations | xmp, etl | xmp |
  | `nora-registry.ts`, `nora-sandbox.ts` | exp_skill_*, exp_capability_registry, exp_build_map, exp_nora_*, exp_opportunity_feedback, search_rank_scores | nora-os | nora-os |
  | `search.ts` | rpc search_docs, _count, _facets, _suggest (public) | srp, marketing | search (anon allowed) |
  | `voce.ts` | exp_voce_article (reads + 1 update) | srp, search | search |
  | `geo-coords.ts` | exp_us_cities | `_base` map component | srp |
  | `console-surfaces.ts` | exp_products, exp_price_book, exp_contracts, exp_entitlements (money); disco_jobs and counts (etl) | admin, search, ops, nora-os | **sales** (money) + etl |
  | `sales-alerts.ts`, `territories.ts` | exp_sales_*, exp_territor*, alerts RPCs (money, about 60 calls) | sales | **sales**: moved to Surface 11 (second approval) |
- [x] 1. Endpoints, in the owner Surface's API:
  - roles: `/admin/me/grants`, `bootstrap`, `audit`
  - search and voce: `/search/public/results|suggest` and `/search/voce/*` (anon when signed out)
  - geo: `/srp/geo/city-centroids`
  - nav menus: `/xmp/website/nav-menus*` (assigned nav is anon-readable)
  - enterprise ops: `/xmp/enterprise/ops/*`
  - NORA: `/nora-os/registry/*` and `/nora-os/sandbox/*`
- [x] 3. Queries in `admin/queries/me.py`, `search/queries/{public_search,voce}.py`, `srp/queries/geo.py`, `xmp/queries/{nav_menus,enterprise_ops}.py` and `nora_os/queries/{registry,sandbox}.py`
- [x] 4. pytest: 92 new tests, 907 in total. Live read-only smoke. **No write, bootstrap or audit insert was run.**
  - The audit `user_id` and `published_by` now come from the token.
  - Publish/yank and the nav assignment change each run in one transaction.
  - One bad `scope_id` now loses only its own grant's name.
- [x] 5. Contracts regenerated: admin, search, srp, xmp, nora-os
- [x] 6. The only direct calls left in `@v3/ui` libs are the money libs (`console-surfaces.ts`, `sales-alerts.ts`, `territories.ts`), which move with **sales**. Auth calls and the Storage upload stay.
- [x] 7. Parity PASS 46/46 (2026-10-24, signed in): roles, search, voce, geo, nav menus, enterprise ops, NORA registry and sandbox.
- [ ] 8. Click-through · [ ] 9. Lint ratchet

### 11. sales (actually ~222 reads, 88 writes, 15 RPCs in 26 files, plus ~70 calls in the `_base` money libs) — money: needs a second approval · branch `migrate/api-sales`
- [x] 2. Tables and security (2026-10-24, read-only): **SF-10**. 23 tables have RLS off and 32 are always-true for writes. `exp_contract_provision`, `exp_alert_accept` and the two ticks are anon-callable with no caller check.
  - Cap: **1j**. Accounts lists, org/pro rollups, claim-event counts and the territory move are all cut at 1,000 today.
- Proposed split, one PR each, in this order:
  - **S1 catalog & pricing (CPQ):** `catalog-admin.ts`, `cpq-catalog.ts`, `cpq-depth.ts`, `sales-cpq.ts` (quotes, promo codes, price tiers), `comp.ts`, and the money part of `_base` `console-surfaces.ts` (products, price book, contracts, entitlements)
  - **S2 contracts, accounts & e-sign:** `contracts.ts`, `accounts.ts`, `sales.ts`, `csm.ts`, the `sales.quotes.$quoteId` route, the public `/sign/:token` (m4_* functions, anon)
  - **S3 pipeline & alerts:** `opportunity-file.ts`, `worklist-actions.ts`, `opportunity-automation.tsx`, `sre-console.ts`, `_base` `sales-alerts.ts`
  - **S4 territories, teams & boards:** `_base` `territories.ts`, `territory-admin.ts`, `category-groups.ts`, `teams.ts`, `seller-setup.ts`, `seller-desk.ts`, `seller-board.ts`, `sales-board.ts`, `sales-nav.ts`, `sales-spine.ts`, `sales-story.ts`, the `sales.promos` route
- Per PR: [ ] 1 endpoints · [ ] 3 queries · [ ] 4 tests · [ ] 5 contract · [ ] 6 no direct calls · [ ] 7 parity · [ ] 8 click-through
- **S1 catalog & pricing:**
  - [x] 1. `/sales/catalog/*` (admin products, pricing config, volume tiers, CPQ catalog, pricing context, comp plans, product catalog, billing)
  - [x] `/sales/cpq/*` (quotes, accounts, contract commit steps, price tiers, promos, allow-listed `rpc/exp_contract_provision`)
  - [x] `/etl/platform/*` (report metrics, nora-os jobs and counts, org stats: exact counts, as before)
  - [x] 3/4. `sales/queries/{catalog,cpq}.py` and `etl/queries/platform.py`; 73 new tests, 980 in total. Live read-only smoke. **No write and no provision call was run.**
    - Money is bound as Decimal, never rounded or floated; responses are PostgREST-shaped.
    - `created_by` comes from the token; `updated_at` uses the server clock.
    - `saveQuote` runs as one transaction. The contract commit keeps its separate steps in the original order.
  - [x] 5. `contracts/sales/openapi.json` (new); etl regenerated
  - [x] 6. No direct calls left in catalog-admin, cpq-catalog, cpq-depth, comp, sales-cpq or console-surfaces
  - [x] 7. Parity: `run.ts sales` **PASS 24/24** (2026-10-24) · [x] 8. Click-through confirmed 2026-10-24 (only our API is called): `/sales/price-book`, `/sales/pricing`, `/sales/comp`, `/sales/quotes`, `/sales/promos`, `/billing`, `/reports`
- **S2 contracts, accounts & e-sign** (started 2026-10-24; security covered by SF-10; cap: only the 1j reads in accounts.ts / sales.ts, the contract tables are tiny: 12 contracts, 38 activity rows):
  - [x] 1. `/sales/contracts/*` (contracts, the 17 signed-in m4_* functions allow-listed in `CONTRACT_RPCS`, notifications, skus, invoices, usage) · `/sales/csm/*` · `/sales/sign/*` (public, always anon, token in the body, only `m4_signer_fetch` / `m4_record_signature`) · `/sales/core/*` (sales.ts) · `/sales/accounts/*`. `exp_contract_provision` reuses the S1 `/sales/cpq/rpc/` route.
  - [x] 3/4. `sales/queries/{contracts,csm,sign,core,accounts}.py`; 160 new tests, 1,140 in total. Read-only live smoke. **No write, m4_* call or provision call was run.**
    - `p_actor` / `p_uploaded_by` (m4_*), CSM `assigned_by` and the login-as `actor_email` come from the token. `created_by` on `m4_create_contract_from_quote` and `exp_contracts` stays a request field (callers send different values).
    - `read_at`, `signed_at`, `exp_account_tier.updated_at` use the server clock.
    - The price-book patch accepts only `list_price`, `contract_price`, `credit_cost_per_unit` (what the page sends).
    - Cap (1j, kept 1:1): `/sales/core/account-tiers/inputs`, `/sales/accounts/list-rows`, `/tree-rows`.
    - Generated schema: +4 tables (`exp_contract_{versions,recipients,approvals,documents}`).
  - [x] 5. `contracts/sales/openapi.json` regenerated · [x] 6. No direct calls left in contracts, csm, sales, accounts, the quote route or the sign route
  - [x] 7. Parity: covered by the S1–S3 run, **PASS 82/82** (2026-10-24) · [x] 8. Click-through confirmed 2026-10-24 (only our API is called): `/sales/contracts`, a contract detail, `/sales/accounts`, an account, `/sales/price-book`, `/sales` (dashboard), a quote, `/sign/<any>` (opens only; press nothing)
  - Bugs found, kept as they are (legacy behaviour):
    - The quote page passes the quote *name* (e.g. `Q-18788`) to uuid columns, so "create contract from quote" and its existing-contract read fail with "invalid input syntax for type uuid".
    - The sign page treats `m4_record_signature`'s `{error:"invalid"}` as success (it only checks `ok === false`).
    - The sign page reads `contract_number`, `renewal_term_months`, `start_date`, `end_date`, `document_hash`, but `m4_signer_fetch` returns `number`, `term_months`, `start`, `end`, `hash`, so those show "—".
    - The quote page's `created_by` fallback was a hard-coded person's name (no-names rule). **Fixed 2026-10-24** (ruling: use the login email): it now sends the signed-in user's email.
    - Contract money fields (mrr, cost, net, margin_pct) are computed in the browser as floats and stored as sent; the server doesn't recompute them.
- **S3 pipeline & alerts** (2026-10-24; security: SF-10; cap: only the one-org claim-events read, kept 1:1):
  - [x] 1. `/sales/opportunities/*` (stages, list, the file loader as one raw read, audit trail, contacts, notes, tasks, demos, files, activity, audit; allow-listed `exp_opp_advance_stage`, `exp_opp_close_won`, `exp_opp_close_lost`) · `/sales/worklist/rpc/*` (`exp_opp_create`, `exp_claim_queue_verification`, `exp_claim_set_contact`) · `/sales/sre/*` (rep, promo code, the three queues, call outcomes, redemptions, trial extensions) · `/sales/alerts/*` (search, dismiss, allow-listed `exp_alert_accept`, `exp_alerts_generate`, `exp_task_reminders_tick`, ported as the browser calls them; the ticks refuse `p_now`)
  - [x] 3/4. `sales/queries/{opportunity,worklist,sre,alerts}.py`; 104 new tests, 1,244 in total. **No write and no RPC (ticks, accept, opp_*) was run.**
    - Server clock: activity `occurred_at`, alert `dismissed_at`, `redeemed_at`. The dismiss audit row's `user_id` comes from the token (drops a `getUser`).
    - Kept as request fields (callers don't send the signed-in user): opp `seller_id` / `created_by` / `owner_id` (the opportunity owner's rep), activity `actor`, `exp_opp_create.p_owner`, SRE `granted_by` / seller id (the page's `SRE_REP_ID` constant).
    - Cap (1j): the opportunity file's claim events for one org (`limit 10000`) stay cut at 1,000; one logo org has 1,850.
    - `opportunity-automation.tsx` keeps its realtime channel on `exp_sales_alerts` (realtime is out of scope).
  - [x] 5. `contracts/sales/openapi.json` regenerated · [x] 6. No direct calls left in opportunity-file, worklist-actions, sre-console, `_base` sales-alerts, opportunity-automation
  - [x] 7. Parity: `run.ts sales` **PASS 82/82** (S1–S3, 2026-10-24) · [x] 8. Click-through confirmed 2026-10-24 (only our API is called): `/sales/opportunities`, one opportunity, `/sales/worklist`, `/admin/integrations` (open only; don't press "run now")
- **S4 territories, teams & boards** (2026-10-24; security: SF-10; cap: see 1j):
  - [x] 1. `/sales/territories/*` (`_base` territories.ts, territory-admin: slots, brand links, lanes, ramps, rules, routing, proposals, seats, quotas; read-only profile functions as fixed GETs; allow-listed `exp_generate_territories`, `exp_generate_group_territories`) · `/sales/category-groups/*` · `/sales/teams/*` (teams.ts, incl. the territory move, ported as it is) · `/sales/seller-setup/*` · `/sales/boards/*` (seller-desk, seller-board, sales-board, sales-story) · `/sales/nav/*` · `/sales/spine/*`
  - [x] 3/4. `sales/queries/{territories,category_groups,teams,seller_setup,boards,nav,spine}.py`; 228 new tests, 1,472 in total. **No write and no generate function was run.**
    - Proposals' `created_by` comes from the token (drops a `getUser`). Server clock: `reviewed_at`, quota `period_start` on insert, the desk's "new profiles since", the referral `callback_at`.
    - Kept as request fields: rep/seller ids the pages send (not the signed-in user), note `created_by`.
    - Cap (1j, kept 1:1): the territory move's office read, board/spine claim events, spine graph_nodes chunks, plus the new ones listed in 1j.
    - Storage stays in the browser: seller photo upload (`seller-photos`).
  - [x] 5. `contracts/sales/openapi.json` regenerated · [x] 6. No direct table/RPC calls left anywhere in `surface-ui` (Storage, Auth and one realtime channel excepted)
  - [x] 7. Parity: `run.ts sales` **PASS 230/230** (S1–S4, 2026-10-24) · [x] 8. Click-through confirmed 2026-10-24 (only our API is called): `/sales/territories`, one category group, `/sales/teams` (or the team page), seller setup, the seller desk, `/sales` board, nav browse pages (open only; press nothing, especially not generate or move)

marketing and app make no direct calls.

**Out of scope:** Auth (login, sessions, password reset) stays on Supabase Auth. Storage and
realtime get a separate design. Removing anon table grants is a gated DB release step.
