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
| `tools/lint/lint_all.py` doesn't exist on this branch, so the per-Surface lint ratchet (step 9) is blocked | `BROWSER_TO_API_TODO.md` → Phase 0 | Open |
