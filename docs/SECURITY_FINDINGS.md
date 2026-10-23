# Security findings

These findings are recorded for a later fix. Each fix is a database security release: open
decision O12, a migration with a `zz_backup_*` snapshot, a human-approved apply and a second
approval. No agent applies these. All checks were read-only catalog queries; no data was written.

| ID | Found | Summary | Status |
|---|---|---|---|
| SF-1 | 2026-10-23 | 67 `public` tables have RLS off and give `anon` INSERT/UPDATE/DELETE/TRUNCATE | Open: to fix later |
| SF-2 | 2026-10-23 | `exp_web_ads` has an always-true policy for `authenticated` | Open: to fix later |
| SF-3 | 2026-10-23 | `exp_sitemap_rebuild` and `exp_index_sync` (SECURITY DEFINER, no role check) are executable by `anon` | Open: to fix later |
| SF-4 | 2026-10-23 | The API's DB login (`panneer`) switches to `postgres` on connect; plain `connection()` sessions run with postgres rights | Open: needs a service account |

## SF-1: RLS off and anon write rights on 67 tables


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


### Where each Surface meets SF-1
- **search** (on hold): exp_index_agent, exp_index_queue, exp_index_submission_log, exp_page_views_rollup, exp_sitemap_partition, exp_sponsored_pricing, exp_sponsored_slots
- **srp** reads two of them: exp_category_page_template, exp_ring. The port is read-only and doesn't change their exposure.
- **sales**, when it's ported: most of the sales, pricing and opportunity tables in the list above.

## SF-2: always-true policy on exp_web_ads
Its policy is `ALL` for `authenticated` with `USING (true) WITH CHECK (true)`, so any signed-in user can create, change or delete ads. The constitution allows always-true only for `service_role`.

## SF-3: anon-callable indexing functions
`exp_sitemap_rebuild()` and `exp_index_sync(p_limit)` are SECURITY DEFINER with no role check, and `anon` holds EXECUTE on them. `exp_index_submit_tick(p_batch)` is gated by `exp_index_enabled()`, which is false while `site_indexing_enabled = false`, but `anon` can still call it.

## SF-4: personal DB login with postgres rights
`surface-api/.env` `DATABASE_URL` uses the personal login `panneer`, which has `rolconnlimit = 10` and a 5-minute statement timeout. Its sessions run as `current_user = postgres`. Endpoints use `role_connection(...)`, which does `set local role authenticated|anon|service_role` per transaction, so RLS applies to them. Anything using plain `connection()` (scripts, the migrate runner) runs as postgres. Fix: a dedicated API service account with only the roles it needs.
