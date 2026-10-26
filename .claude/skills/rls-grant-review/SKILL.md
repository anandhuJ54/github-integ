---
name: rls-grant-review
description: Review database security for a change - RLS, policies, grants, SECURITY DEFINER functions, tenant scope - using the repo and a read-only live catalog check.
---

# RLS / grant review

1. For each schema touched: no `USAGE` for `anon` / `PUBLIC` (`has_schema_privilege('anon', '<s>', 'USAGE')` is false). For each new table: no row-level security (AGENTS.md §3), so the grants are the whole control: `anon` / `PUBLIC` have nothing, `authenticated` only what the endpoints need. For each existing table with RLS: policies have real predicates (tenant via `current_setting('app.tenant_id')`, principal, role check via `has_control_role`/`exp_ctrl_has_role`)? No `(true)` except `TO service_role`?
2. Grants: nothing to `anon`/`PUBLIC` on tables. Public reads only via curated SECURITY DEFINER views/functions.
3. SECURITY DEFINER functions: pinned `search_path`, explicit actor/scope checks inside, narrow EXECUTE.
4. Tenant scope: `/enterprise/$orgSlug`-style routes verify membership server-side; client-supplied tenant ids are never trusted.
5. Live check (read-only):
   ```sql
   SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname IN ('public', '<surface>') AND tablename IN (<tables>);
   SELECT relnamespace::regnamespace, relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN (<tables>);
   SELECT has_table_privilege('anon', '<schema>.<t>', 'INSERT'), has_schema_privilege('anon', '<schema>', 'USAGE');
   ```
6. Negative tests: write tests proving another tenant / anonymous user / non-role user is refused.
Report findings; security findings are blocking.
