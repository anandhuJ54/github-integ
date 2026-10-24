# Security findings

These findings are recorded for a later fix. Each fix is a database security release: open
decision O12, a migration with a `zz_backup_*` snapshot, a human-approved apply and a second
approval. No agent applies these. All checks were read-only catalog queries; no data was written.

| ID | Found | Summary | Status |
|---|---|---|---|
| SF-1 | 2026-10-23 | 67 `public` tables have RLS off and give `anon` INSERT/UPDATE/DELETE/TRUNCATE | Open: to fix later |
| SF-2 | 2026-10-23 | `exp_web_ads` has an always-true policy for `authenticated` | Open: to fix later |
| SF-3 | 2026-10-23 | `exp_sitemap_rebuild` and `exp_index_sync` (SECURITY DEFINER, no role check) are executable by `anon` | Open: to fix later |
| SF-5 | 2026-10-23 | 17 ops tables (dev tracker, wiki, `exp_contracts`, `exp_activity_events`) have always-true policies: any signed-in user can read, change and delete all rows | Open: to fix later |
| SF-6 | 2026-10-23 | `disco_activate` and `disco_request_remap_site` (SECURITY DEFINER, no role check) are executable by `anon`: anyone can start discovery rounds, which queue AI-backed jobs (cost), or request site remaps | Open: to fix later |
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

## SF-5: always-true policies on the ops tables
Every policy on these tables is `USING (true)` / `WITH CHECK (true)` for `authenticated` (as `ALL`, or separately per command). Any signed-in account can therefore read, change or delete every row:
- **Wiki:** exp_wiki_spaces, exp_wiki_docs, exp_wiki_comments, exp_wiki_revisions (insert and select only), exp_wiki_watchers
- **Dev tracker:** exp_dev_launch, exp_dev_teams, exp_dev_projects, exp_dev_members, exp_dev_demo_days, exp_dev_sprints, exp_dev_docs, exp_dev_ideas, exp_dev_sprint_items, exp_dev_idea_votes
- **Sales and money:** **exp_contracts** (12 rows); also exp_activity_events (138 rows)

exp_dev_config and exp_dev_weekly_updates have RLS off and are already listed under SF-1. The `dev-docs` storage bucket is private.
The ops port to FastAPI (2026-10-23) keeps today's access exactly (the calls run as the signed-in user); the fix belongs to the security release.

## SF-6: anon-callable discovery functions without a role check
Of the 16 SECURITY DEFINER functions the ETL page calls, 14 check the caller's control role. The two below don't, and `anon` holds EXECUTE on them:
- `disco_activate(p_category text)` starts a discovery round for a category. It checks only that the category exists and that no discovery is running. The round queues jobs that call AI providers, so this is a cost exposure.
- `disco_request_remap_site(p_source_id uuid)` queues a site remap for an approved, active or test_pull source.

Also: all 16 functions are executable by `anon` (EXECUTE was never revoked). The role checks stop misuse of the other 14; the fix is to revoke EXECUTE from anon/PUBLIC on all of them and add the role check to these two. ETL tables themselves have RLS on, with read-only policies for `authenticated`.
The ETL port to FastAPI keeps today's access (it calls the same functions as the signed-in user).

## SF-7: graph Surface (checked 2026-10-24, read-only)
All 38 tables the graph pages read have RLS on, with read-only policies (most of them `USING (true)` for `anon` and `authenticated`, i.e. public reads). The DB is safe against the browser writes because no table has an insert/update/delete policy. Findings:
- **audit_log:** has an always-true INSERT policy for `authenticated`, so any signed-in account can write audit entries with any content. The constitution allows always-true only for `service_role`.
- **Unpinned search_path:** `exp_ctrl_create_node` and `exp_ctrl_update_node` are SECURITY DEFINER but set no `search_path`. Both check the role (`super_admin`/`architect`).
- **EXECUTE never revoked from anon:** `anon` holds EXECUTE on all six graph RPCs. The four write and lookup functions check the role, so anon gets "insufficient grant" or "forbidden". `exp_validate_graph` and `exp_validate_category_full` are read-only validators with no role check.
- **Every table grants `anon` INSERT/UPDATE/DELETE** (SF-1 pattern). RLS blocks these writes today, but one permissive policy would expose the table.
- **No policy at all** on `content_compliance_rules`, `exp_category_ui_config` and `transaction_signals`. RLS returns nothing to the browser, so the compliance tab's rule list and the ui_config section are always empty. This is a functional bug, not a leak.
The graph port keeps today's access: calls run as the signed-in user, or as `anon` for the public `/p|o|c/:slug/graph` pages.

## SF-8: xmp Surface (checked 2026-10-24, read-only)
The xmp pages touch 38 tables and 7 RPCs. The RPCs (`exp_office_mode`, `exp_xmp_*`) are SECURITY INVOKER with a pinned `search_path`, so RLS applies to them. Findings:
- **Website CMS: always-true `ALL` for `authenticated`** on exp_web_pages, exp_web_forms, exp_web_media, exp_web_campaigns, exp_web_alerts, exp_web_trust_items, exp_web_consent_config and exp_web_ads (SF-2). Any signed-in account can change or delete any site's pages, forms and ads. **exp_web_leads** (customer contact data) is also readable and editable by any signed-in account, and anon can insert.
- **Sales tables, always-true for `authenticated`:** exp_sales_reps and exp_sales_quotas (`ALL`), exp_territories (no delete), exp_territory_brand (`ALL`) and exp_category_groups (`ALL`). Any signed-in account can rewrite reps, quotas and territories. This is money data.
- **exp_revenue_components: RLS off** (SF-1), with anon read/write. Revenue amounts per seller.
- **No policy at all** on invitations, listings, plg_rules, review_campaigns, user_accounts, user_roles and content_compliance_rules. They always read empty, and writes to them fail. The enterprise users page and the campaigns page therefore show no roles, invitations or campaigns. This is a functional bug, not a leak.
- **The audit_log always-true insert** (SF-7) applies here too.
The xmp port keeps today's access: calls run as the signed-in user, writes included.

## SF-9: `_base` shared libs (checked 2026-10-24, read-only)
- **Money tables, always-true for `authenticated`:** exp_products (no delete), exp_price_book, exp_contracts (SF-5) and exp_entitlements (no delete). Any signed-in account can change prices, contracts and entitlements.
- **NORA / skills tables, always-true `ALL` for `authenticated`:** exp_skill_registry, exp_capability_registry, exp_build_map, exp_skill_eval, exp_skill_version, exp_skill_run, exp_nora_state, exp_nora_weights and exp_opportunity_feedback.
- **No policy at all:** disco_jobs, plus the enterprise-ops tables crm_integrations, oauth_connections, sync_jobs, enterprise_settings, sso_config, user_roles and invitations. They always read empty for users. The disco jobs list in the console surfaces is therefore always empty.
- **`bootstrap_control_super_admin()`** is SECURITY DEFINER and executable by anon. It returns `unauthenticated` when there's no user, and does nothing once any grant exists (21 do), so it's safe today. If `exp_control_grants` were ever emptied, the first signed-in caller would become super_admin.
- The `search_docs*` RPCs are SECURITY INVOKER and public by design (the search page).

## SF-10: sales Surface (checked 2026-10-24, read-only)
The sales pages and the three `_base` money libs touch 64 tables and 17 RPCs. Almost everything is open:
- **RLS off (SF-1), with anon read/write:** 23 tables, including exp_accounts, exp_contacts, exp_sales_pipeline (opportunities), exp_quotes, exp_price_tiers, exp_promo_codes, exp_promo_redemptions, exp_revenue_components, exp_sales_tasks, exp_sales_notes, exp_claim_events (contact phone and email), exp_opportunity_*, exp_territory_proposals, exp_territory_ramps and exp_trial_extensions.
- **Always-true writes for `authenticated`:** 32 tables, including exp_contracts, exp_contract_line_items, exp_contract_signatures, exp_entitlements, exp_invoice, exp_invoice_line, exp_price_book, exp_pricing_config, exp_products, exp_comp_plans, exp_sales_reps, exp_sales_quotas, exp_territories and exp_usage_meter. Any signed-in account can change prices, contracts, invoices, comp plans and quotas.
- **SECURITY DEFINER, anon-executable, no caller check:**
  - `exp_contract_provision(p_contract)` creates entitlements for any contract.
  - `exp_alert_accept(p_alert)` turns any NORA alert into a task.
  - `exp_alerts_generate(p_now)` and `exp_task_reminders_tick(p_now)` are tick functions. The reminders tick writes **exp_email_outbox**, which queues emails. The `_base` `sales-alerts.ts` lib calls both from the browser.
  - The territory profile aggregates are read-only.
- **E-sign:** `m4_signer_fetch` and `m4_record_signature` are anon by design: the token in the link is the credential. They are SECURITY DEFINER with **no pinned search_path**.
- **Role-checked:** the opportunity functions (`exp_opp_create`, `advance_stage`, `close_won`, `close_lost`), `exp_claim_queue_verification`, `exp_claim_set_contact` and `list_control_users`.
- `exp_generate_territories` and `exp_generate_group_territories` are SECURITY INVOKER, so RLS applies.
The sales port keeps today's access: calls run as the signed-in user, or anon for `/sign/:token`. **Porting must never run the tick, provision, generate or signature functions.**
- **Added during the S2 port (2026-10-24, read-only):**
  - All 19 `m4_*` contract functions are SECURITY DEFINER with EXECUTE for `anon` and `authenticated`, and none pins `search_path`. Through PostgREST, anyone with the anon key can finalize, send for signature, generate invoices, record usage or start renewals. The API allow-list doesn't close that direct path.
  - The `p_actor` / `p_uploaded_by` audit fields are whatever the caller sends through PostgREST. The API now fills them from the token's email; PostgREST still accepts any value.
  - The S2 contract tables have RLS on without FORCE, anon SELECT/INSERT/UPDATE grants and `authenticated USING (true)` policies; `exp_order_sku` also has an anon `USING (true)` read. The CSM super-admin check exists only in the UI.
  - `m4_record_signature` has no token expiry, no current-version check and no rate limit, and takes `p_ip` from the client. `m4_signer_fetch` returns the contract's full `terms` to whoever holds the token.
  - `exp_contracts_bak_m4` (a backup table) has RLS off with anon/authenticated grants.
- **Added during the S3 port (2026-10-24, read-only):** `exp_sales_alerts` has always-true staff policies and no FORCE RLS (a random signed-in user reads every alert). Any signed-in user can insert promo redemptions and trial extensions (RLS off; trial days capped at 7 by a CHECK) and trigger both tick functions. Notes, tasks, activity and SRE actions take their seller/actor from the page, so they can be attributed to any rep; `extendTrial` uses a fixed rep id constant.
