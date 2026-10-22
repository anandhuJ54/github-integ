---
name: rls-grant-review
description: Review database security for a change - RLS, policies, grants, SECURITY DEFINER functions, tenant scope - using the repo and a read-only live catalog check.
---

# RLS / grant review

1. For each table touched: RLS enabled **and forced**? Policies have real predicates (tenant via `current_setting('app.tenant_id')`, principal, role check via `has_control_role`/`exp_ctrl_has_role`)? No `(true)` except `TO service_role`?
2. Grants: nothing to `anon`/`PUBLIC` on tables. Public reads only via curated SECURITY DEFINER views/functions.
3. SECURITY DEFINER functions: pinned `search_path`, explicit actor/scope checks inside, narrow EXECUTE.
4. Tenant scope: `/enterprise/$orgSlug`-style routes verify membership server-side; client-supplied tenant ids are never trusted.
5. Live check (read-only):
   ```sql
   SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN (<tables>);
   SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN (<tables>);
   SELECT has_table_privilege('anon', '<t>', 'INSERT');
   ```
6. Negative tests: write tests proving another tenant / anonymous user / non-role user is refused.
Report findings; security findings are blocking.
