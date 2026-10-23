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

### 1d. Check every remaining Surface for the same pattern
Look for any legacy read with a limit over 1,000, or with no limit on a large table. Record each
one here before porting.

## 2. Security: 67 public tables have RLS off and give `anon` write rights (found 2026-10-23)

A read-only catalog check on the self-hosted GCP database (no data was written and no write was
tried) found 67 tables in `public` with RLS disabled where `anon` holds INSERT, UPDATE and DELETE
(and TRUNCATE). Anyone with the public anon key, which ships in every browser build, can change or
wipe them through the REST API. A signed-out REST read of `exp_sponsored_pricing` and
`exp_index_agent` was confirmed during the search check.

Groups:
- **Sales and customer data:** exp_accounts, exp_contacts, exp_quotes, exp_sales_pipeline, exp_sales_notes, exp_sales_tasks, exp_sales_demos, exp_sales_rep_metrics, exp_sales_category_stats, exp_opportunity_contacts, exp_opportunity_files, exp_opportunity_products, exp_opportunity_stage_history, exp_pipeline_stages, exp_stage_requirements, exp_promo_codes, exp_promo_redemptions
- **Pricing and money:** exp_price_tiers, exp_revenue_components, exp_sponsored_pricing, exp_sponsored_slots, exp_trial_extensions, exp_cost_events, exp_territory_proposals, exp_territory_ramps
- **Governed platform data:** search_documents, exp_category_page_template, exp_category_score_config, exp_score_class_profiles, exp_profile_scores, exp_ring, exp_ring_crosswalk, exp_ring_status, graph_rings, exp_pagekit, exp_intake_contract
- **Claims, indexing and analytics:** exp_claim_events, exp_index_agent, exp_index_queue, exp_index_submission_log, exp_sitemap_partition, exp_page_views_rollup
- **Config:** exp_app_config, exp_dev_config, exp_dev_weekly_updates, exp_method_probe
- **Backups and leftovers:** exp_contracts_bak_m4, exp_price_book_bak_20261004, exp_price_tiers_bak_20261004, exp_products_bak_20261004, exp_product_naming_audit, exp_r1_done, exp_v3_done, sf_frontier, sf_req, sfh_frontier, sfh_req, v_key, zz_backup_batch1_compliance, zz_backup_batch1_knowledge, zz_backup_batch1_registry, zz_backup_batch1_taxonomy, zz_backup_graph_nodes_20260912, zz_backup_re_compliance_20260725, zz_backup_re_knowledge_20260725, zz_backup_re_registry_20260725, zz_backup_re_taxonomy_20260725

Moving browser calls to the API does not fix this: the DB rights are the hole. Fixing it is a DB security release (open decision O12):
1. ENABLE and FORCE RLS
2. per-table policies, chosen with `rls-grant-review`
3. revoke anon/PUBLIC grants
4. restrict EXECUTE on anon-callable SECURITY DEFINER functions

It needs a migration, a `zz_backup_*` snapshot, a human-approved apply and a second approval.

**Open:**
- escalate to the owner of the QA and production Supabase, and check whether production has the same grants
- decide whether to write the hardening migration (written, never applied by an agent)

## 3. Other deferred items (pointers)

| Item | Where it is recorded | Status |
|---|---|---|
| Search Surface: RLS off and full `anon` grants on 7 tables, plus anon-executable indexing functions | `BROWSER_TO_API_TODO.md` → search | On hold; needs the O12 rulings |
| "Sign in with Lovable" on the claim page still uses the Supabase cloud project | `BROWSER_TO_API_TODO.md` → Phase 0 | Deferred |
| `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset in `surface-api/.env` (prompt-bundle export, claim identity, claim OTP need them) | `BROWSER_TO_API_TODO.md` → Phase 0 | Open |
| The API connects with a personal DB login (`panneer`): 5-minute timeout and `rolconnlimit = 10`, shared by every tool using that login. The role also switches to `postgres` on connect, so plain `connection()` sessions run with postgres rights; `role_connection` still drops to `authenticated` per request. Needs a dedicated service account. Until then, keep `DB_POOL_MAX=4` in `surface-api/.env` | `BROWSER_TO_API_TODO.md` → Phase 0 | Open |
| Optional: answer a pool timeout with "503 database busy" instead of a bare 500 | Seen in admin parity 2026-10-23 | Not started |
| `exp_disco_worker_config` is missing on GCP; three ETL tick functions read it | ETL audit 2026-10-23 | Open; ETL crons are gated (O9) |
| `tools/lint/lint_all.py` doesn't exist on this branch, so the per-Surface lint ratchet (step 9) is blocked | `BROWSER_TO_API_TODO.md` → Phase 0 | Open |
