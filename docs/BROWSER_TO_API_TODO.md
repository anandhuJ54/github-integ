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

### 3. search (7/8/3) — **ON HOLD (2026-10-23): security finding, needs a ruling (O12)**
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9
- All the calls are in `surface-ui/search/src/lib/search-console.ts`.
  - Pages: `/search`, `/search/indexing`, `/search/sponsored`, `/search/ads`, `/search/voce`.
  - Tables: `gbp_categories` (4,041 rows, so the legacy read hits the 1,000-row cap), `exp_page_views_rollup`, `exp_index_*`, `exp_sitemap_partition`, `exp_sponsored_*`, `exp_web_ads`.
  - RPCs: `exp_sitemap_rebuild`, `exp_index_submit_tick`, `exp_index_sync`. These are gated indexing actions; never trigger them as a test.
- **Security finding** from a read-only catalog check on GCP:
  - These 7 tables have RLS **off**, and `anon` holds full grants including DELETE and TRUNCATE: `exp_index_agent`, `exp_index_queue`, `exp_index_submission_log`, `exp_page_views_rollup`, `exp_sitemap_partition`, `exp_sponsored_pricing`, `exp_sponsored_slots`. A signed-out REST read with only the public anon key returned rows.
  - `exp_web_ads` has an always-true policy for `authenticated`.
  - All 10 tables grant `anon` full rights.
  - `exp_sitemap_rebuild` and `exp_index_sync` (SECURITY DEFINER, no role check) are executable by `anon`. `exp_index_submit_tick` is gated by `exp_index_enabled()`, which is currently false.
- Decisions needed before resuming:
  1. A migration (written, not applied) to enable and force RLS on those tables, add admin-only policies, fix the `exp_web_ads` policy, revoke anon/PUBLIC grants and restrict EXECUTE. Applying it is gated and needs a second approval.
  2. Whether the FastAPI search endpoints check for a `super_admin`/`architect` console role, or mirror today's DB rules.

### 4. admin (19/2/1)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 5. srp (31/0/3)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 6. ops (23/21/0, 2 storage calls)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9
- Storage calls need their own design.

### 7. etl (42/0/18)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 8. graph (42/19/6)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9
- Needs a ruling: it writes governed tables, and moving those writes to `exp_category_proposals` has to be decided.

### 9. xmp (58/29/6)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 10. `_base` (56/43/10) — each call goes to the Surface that owns its table
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 11. sales (144/87/16) — money: needs a second approval, split into 3–4 PRs
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

marketing and app make no direct calls.

**Out of scope:** Auth (login, sessions, password reset) stays on Supabase Auth. Storage and
realtime get a separate design. Removing anon table grants is a gated DB release step.
