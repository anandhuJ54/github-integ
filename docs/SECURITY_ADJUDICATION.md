# Security Linter Adjudication (2026-07-06, 40 findings)

## 29x INFO — RLS enabled, no policy (deny-all)
VERDICT: ACCEPTED AS DESIGNED for the current phase. Deny-all + service-role access is the
correct posture for an internal substrate with no public API surface. These become real work
at the platform-as-substrate API boundary (public multi-tenant access), where per-table
policies get written against real personas. Trigger: API boundary build. NOT a launch blocker
for the internal build; IS a blocker for any public/anon access.

## 7x ERROR — SECURITY DEFINER views
VERDICT (final, role answer received): KEEP AS DESIGNED. The app's default read path is
anon/authenticated over deny-all tables; the definer views ARE the intentional public read
surface — curated projections over locked tables, functionally a read API. Flipping
security_invoker=true would break every public SRP page today while adding no protection
the deny-all posture doesn't already provide. DO NOT flip defensively. Revisit at the API
boundary build, where per-table SELECT policies replace this pattern deliberately.
Rule for new views: public-readable projections are created SECURITY DEFINER on purpose
and listed here; anything not meant for public reads must be security_invoker.

## 2x WARN — always-true write policies; 2x WARN — PUBLIC-executable SECURITY DEFINER function
VERDICT (final, identifiers received): FIXED in 20260706034000 — both always-true ALL
policies dropped (exp_category_directory_map, exp_directory_packs; writes are service-role
concerns), and EXECUTE revoked from PUBLIC on invalidate_schema_cache_on_graph_change
(trigger functions run as definer regardless; the grant was pure attack surface).
