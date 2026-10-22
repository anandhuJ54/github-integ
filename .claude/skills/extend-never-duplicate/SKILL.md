---
name: extend-never-duplicate
description: Before adding any table, function, route, role system, outbox, entitlement table, lead table or price constant, search the repo and the live database catalog for an existing equivalent and record the result in plan.md.
---

# Extend, never duplicate

For each proposed new object:

1. **Repo search** — `rg -n "<concept|name variants>" api ui contracts docs` (synonyms: e.g. lead/prospect/inquiry; role/grant/permission; outbox/queue/event). Include `api/migrations` for the SQL history.
2. **Live catalog (read-only)** — run against the DB read-only connector:
   ```sql
   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','v','m') AND c.relname ILIKE '%<term>%';
   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND (p.proname ILIKE '%<term>%' OR p.prosrc ILIKE '%<term>%');
   ```
   Note: migrations lag the live DB; the catalog wins.
3. **Decide** — EXTEND the existing object (name it), or prove none exists. Known traps: roles → `exp_control_grants`; leads → `exp_web_leads`/`exp_lead_routing_state`; entitlements → `exp_entitlements`; outbox → `exp_outbox` is an email queue, not a domain-event log; prices → price book only.
4. Record the result in `plan.md` → "Extend-never-duplicate check".
