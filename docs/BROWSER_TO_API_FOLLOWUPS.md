# Browser → API migration — deferred follow-ups

These are decisions put off during the browser-to-API migration, each to be revisited later.
Per-Surface progress is tracked in `docs/BROWSER_TO_API_TODO.md`; this file holds only the
open questions. When one is decided, record the ruling and the date here, then do the work.

## 1. Pages that show incomplete data because of the 1,000-row cap

The self-hosted PostgREST returns at most 1,000 rows per REST response. The API matches that:
`_base/core/sql.fetch_all` caps every SELECT at `MAX_ROWS = 1000` (decided 2026-10-23), so each
endpoint returns exactly what the old browser call got and parity passes 1:1. The cost is that
the pages below show less data than exists.

**Open decision:** for each page, either keep the cap or make the query complete with
`max_rows=None`, or better, a SQL aggregate/DISTINCT. A completed query no longer matches the
old page, so its parity case records an explained difference together with a SQL check showing
that the API value is correct.

Recommendation: make all three complete. They are visible display bugs, cheap to fix (two of
them also get faster), and nothing depends on the truncated behaviour.

### 1a. `/compliance`: category coverage table (admin)
- Data: 4,041 categories in `gbp_categories`, and a row in `exp_category_compliance` for each.
- What the page reads: `gbp_categories` (`limit 5000`) and `exp_category_compliance` (no limit). Both are cut to 1,000 rows.
- What users see:
  - Only the first 1,000 categories alphabetically. Searching for a later one (e.g. "Plumber") finds nothing.
  - Configured categories can show as "not configured" when their compliance row was past the cut.
- If made complete: all 4,041 categories with correct flags.
- Code: `surface-api/admin/queries/compliance.py` → `coverage()`.

### 1b. `/organizations`: category filter dropdown (admin)
- Data: 38,115 organizations.
- What the page reads: `organizations.gcid` with `limit 5000`, cut to 1,000 rows, then de-duplicated in the code.
- What users see: the dropdown lists only the categories found in those 1,000 rows (1 category on 2026-10-23). Organizations in other categories can't be filtered to.
- If made complete: one `SELECT DISTINCT gcid` query listing every category that has an organization (the same fix `/professionals` already got).
- Code: `surface-api/admin/queries/organizations.py` → `category_options()`.

### 1c. `/professionals`: hydration depth column (admin)
- Data: about 30 active `graph_nodes` per professional.
- What the page reads: every node for the 50 professionals on screen (~1,500 rows), cut to 1,000.
- What users see: roughly 40 of the 50 rows show depth counts; the rest show none or too few, even though their nodes exist.
- If made complete: count per professional in SQL (`GROUP BY entity_id` with the same product/social/credential classification), which returns 50 small rows instead of 1,500 raw ones.
- Code: `surface-api/admin/queries/professionals.py` → `depth()`.

### 1d. `/discovery` runs tab: frontier matrix (etl)
- Data: 282,911 `exp_etl_frontier` rows.
- What the tab reads: `kind, status` for every row (no limit), cut to 1,000, which it then counts into a kind × status matrix.
- What users see: the matrix counts only the first 1,000 rows, so most kinds and statuses show far too few (or none).
- If made complete: one `GROUP BY kind, status` count in SQL (a few dozen rows).
- Code: `surface-api/etl/queries/tabs.py` → `frontier_matrix_rows()`.

### 1e. `/discovery` category population: staged rows per source (etl)
- What the tab reads: `source_id, entity_type, resolution_status` of the category's staging rows (`limit 5000`), cut to 1,000, then counted per source.
- What users see: a category with more than 1,000 staged rows (financial_advisor has ~28k) shows partial per-source counts.
- If made complete: a `GROUP BY source_id, entity_type, resolution_status` count.
- Code: `surface-api/etl/queries/sources.py` → `population_staged()`.

### 1g. `/control-graph` claims tab: entity names (graph)
- What the tab reads: `exp_entity` with `limit 2000` (181,564 rows) as a name lookup for the claims list, cut to 1,000.
- What users see: a claim whose entity isn't among those 1,000 rows shows no entity name.
- If made complete: look up only the claims' own `entity_id`s, i.e. `IN (...)` over at most 500 ids.
- Code: `surface-api/graph` claims endpoint.

### 1h. `/p|o|c/:slug/graph`: expertise graph nodes (graph)
- What the page reads: every active `graph_nodes` row for the entity (no limit). The largest professional has 2,644 active nodes, so the read is cut to 1,000.
- What users see: for entities with more than 1,000 nodes, the graph is missing nodes and the edges to them.
- **Decided 2026-10-24: get everything.** The expertise-graph node read has no cap (`max_rows=None`); the edges and external nodes read for it are uncapped as well. Parity records this as an explained difference for entities with more than 1,000 nodes.
- Later: the payload can be large (2,644 nodes), so it may need paging.

### 1i. xmp: org hierarchy reads (latent)
- `/enterprise/:orgSlug/users` and `/campaigns` find an org's descendants with `organizations.hierarchy_path like '%<root id>%'`. Only 2 of 38,115 orgs have `hierarchy_path` set today, so these reads return just the root, and nothing is cut by the cap.
- If `hierarchy_path` gets backfilled, State Farm alone has 19,882 child offices. The read would then be cut to 1,000, and the users page's `professionals in (orgIds) limit 2000` would be cut too.
- Also close to the cap: the office roster in `lib/enterprise-xmp.ts` reads every professional of an office with no limit. The largest office (`compass-new-york-ny-2`) has 990.

### 1j. sales: reads cut by the cap (money numbers)
All of these are cut to 1,000 rows today by PostgREST, and the API keeps that 1:1:
- `lib/accounts.ts:50-51,128-129`: organizations and professionals `limit(5000)` (38,115 and 115,867 rows). The accounts lists are partial.
- `lib/sales.ts:370-371`: organizations and professionals `limit(20000)`, used to build org/pro rollups. The rollups count only the first 1,000 rows.
- `lib/sales-board.ts:170` (no limit) and `lib/sales-spine.ts:82,242` (limit over 1,000): `exp_claim_events` has 3,474 rows. Board and spine claim counts are partial.
- `lib/sales-spine.ts:350`: `graph_nodes` `in(chunk) limit(10000)`. Each chunk is cut to 1,000.
- **`lib/teams.ts:364` (a write path):** the territory move reads the org's child offices with `limit(50000)`, cut to 1,000 (State Farm has 19,882), and then moves only those offices' professionals. A move therefore silently leaves most professionals in the old territory. Ported as it is.
- Correction from the S4 port: `sales-board.ts:170` is `.limit(20000)` (not unlimited), cut to the newest 1,000 of 3,474.
- Found in S4 (kept 1:1; not cut today, but will be):
  - `sales-nav.ts:90` overview activity events, `limit(5000)`, no ORDER BY (138 rows today).
  - `sales-nav.ts:392` brand-rollup claim events, `limit(10000)`, no ORDER BY (950 for the largest brand today, close to the cap).
  - `seller-desk.ts` claim events per seller, no limit (926 for the busiest seller).
  - `sales-board.ts` revenue components (540 rows) and `sales-nav.ts` `exp_contracts` (overview, seller book), no limit.
  - `exp_territory_logo_profiles()`, one row per root org, no ORDER BY (13 roots here; would be cut on a full dataset).
- Fix: SQL aggregates and set-based updates (`update … where primary_org_id in (select id from organizations where parent_org_id = …)`). Needs a decision, because the numbers will change.

### 1f. Check every remaining Surface for the same pattern
Look for any legacy read with a limit over 1,000, or with no limit on a large table. Record each
one here before porting.

## 2. Security: 67 public tables with RLS off and anon write rights

Moved to `docs/SECURITY_FINDINGS.md` (finding SF-1). To be fixed later as a DB security release (O12).

## 3. Other deferred items (pointers)

| Item | Where it is recorded | Status |
|---|---|---|
| Search Surface: RLS off and full `anon` grants on 7 tables, plus anon-executable indexing functions | `BROWSER_TO_API_TODO.md` → search | On hold; needs the O12 rulings |
| "Sign in with Lovable" on the claim page still uses the Supabase cloud project | `BROWSER_TO_API_TODO.md` → Phase 0 | Deferred |
| `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset in `surface-api/.env` (prompt-bundle export, claim identity, claim OTP need them) | `BROWSER_TO_API_TODO.md` → Phase 0 | Open |
| The API connects with a personal DB login (`panneer`): 5-minute timeout and `rolconnlimit = 10`, shared by every tool using that login. The role also switches to `postgres` on connect, so plain `connection()` sessions run with postgres rights; `role_connection` still drops to `authenticated` per request. Needs a dedicated service account. Until then, keep `DB_POOL_MAX=4` in `surface-api/.env` | `BROWSER_TO_API_TODO.md` → Phase 0 | Open |
| Optional: answer a pool timeout with "503 database busy" instead of a bare 500 | Seen in admin parity 2026-10-23 | Not started |
| `exp_disco_worker_config` is missing on GCP; three ETL tick functions read it | ETL audit 2026-10-23 | Open; ETL crons are gated (O9) |
| graph: the category-edit writes (insert/update/**delete** on `exp_taxonomy`, `exp_vertical_node_registry`, `content_compliance_rules`; updates to `exp_category_knowledge.ai_agents` and `gbp_categories`; `audit_log` inserts) are ported **as they are** (ruling 2026-10-24: "modify as it is"). They run as the signed-in user under the same RLS, so they still do nothing on GCP (no write policy). Moving them to `exp_category_proposals` (never DELETE) is still open | `BROWSER_TO_API_TODO.md` → graph | Ported as-is; proposals routing open |
| `supabase.auth.getUser()` (a `GET /auth/v1/user` per call) is used only to get the user id in `ops/src/lib/build-wiki.ts:66`, `ops/src/lib/dev-progress.ts:275`, and the sales libs `sales-alerts.ts` / `territories.ts`. The API already knows the user from the token, so these could be dropped. The shell guard `app/src/routes/_authenticated/route.tsx` keeps its call (session check; Auth stays on Supabase) | Raised 2026-10-24 during the `_base` click-through | Later, after sales |
| API base URL: the UI calls a relative `/api` (`surface-ui/_base/src/lib/server-fn.ts:35`) and only the Vite dev proxy (`surface-ui/app/vite.config.ts:55`, hardcoded `http://localhost:8000`) forwards it, so a static build has no API. Read `VITE_API_BASE_URL` in `server-fn.ts` (fallback `/api`) and use the same variable for the dev proxy target; set `CORS_ALLOW_ORIGINS` on the API when it's a different origin | Asked 2026-10-24 | **Done 2026-10-24**: `VITE_API_BASE_URL` (client, default `/api`) and `API_PROXY_TARGET` (dev proxy, default `http://localhost:8000`), both in `surface-ui/app/.env`. The API's CORS default is `*`, which works because the token goes in a header, not a cookie |
| robots.txt and the sitemap must be served at the **public site's** address (crawlers never ask the API's). The API generates both; the site forwards `/robots.txt` and `/api/public/sitemap*` to it (dev: `surface-ui/app/vite.config.ts` proxy; production: the site's reverse proxy must do the same). The URLs inside come from `SITE_ORIGIN` (surface-api env; unset = the request's address) | Found 2026-10-25: `http://localhost:5173/robots.txt` served the React page | **Fixed 2026-10-25** (dev proxy + `SITE_ORIGIN`); production proxy rule to add at deploy. Indexing is OFF, so nothing was exposed |
| `tools/lint/lint_all.py` doesn't exist on this branch, so the per-Surface lint ratchet (step 9) is blocked | `BROWSER_TO_API_TODO.md` → Phase 0 | Open |

## 4. Next steps after sales (noted 2026-10-24, to come back to later)
Sales is complete: parity 230/230 and the click-through is confirmed. These were offered as the next step and are parked for now:
- **A. `getUser` cleanup:** drop the `supabase.auth.getUser()` calls that only fetch the user's id or email (see the §3 row); the API takes them from the token. The S2–S4 ports left a few TS signatures with unused `_actor` / `_uploadedBy` / `_assignedBy` arguments whose callers still call `getUser`.
- **B. Lint:** the lint lives at `cur-tools/lint/lint_all.py`, not `tools/lint/` as AGENTS.md says. It reports 61 existing findings (none in the migrated files). Decide where it lives, then run the per-Surface ratchet.
- **C. The 1,000-row cap gaps (§1, 1a–1j):** each needs a ruling, because completing a read changes the numbers on the page.
- **Printed contracts name a person as the company signer:** `sales/src/components/contracts/contract-print-document.tsx:53` (fallback when `experience_signer` is empty) and `contract-billing.tsx:55` (fixed text). No-names rule vs. legal documents: needs a decision (e.g. read the signer from configuration).
- **E. Contract entries for cross-Surface APIs:** see `docs/SURFACE_AUDIT.md` → "Published cross-Surface APIs" (deferred 2026-10-25).
