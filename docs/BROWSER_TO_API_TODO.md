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
- [ ] 7. Parity PASS. The UI now points at self-hosted GCP (same DB as the API: 115,867 professionals both ways).
  - On GCP the legacy read **fails**: its three `graph_nodes` counts exceed the 8s `statement_timeout` of the `authenticated` role. The parity case patches those three out (`legacyPatch`) and lists `$.yield.nodes` as not compared.
  - Node counts checked against SQL as `authenticated`, and they match: 259,038 product_service, 105,517 social_profile, 211,423 credential. The API returns the whole monitor in about 4–6s.
  - Still to do: a parity run of the remaining fields with a real login.
- [x] 8. Click-through of the `/nora-os` console (2026-10-23): the panel renders from `/api/nora-os/etl-monitor`, and no `rest/v1/exp_*` or `rest/v1/graph_nodes` calls are made
- [ ] 9. Lint ratchet

### 2. conversion-agents (7/7/0)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

### 3. search (7/8/3)
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 parity · [ ] 8 · [ ] 9

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
