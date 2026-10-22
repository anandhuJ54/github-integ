---
name: canon-review
description: Review a spec, plan or diff against the root AGENTS.md constitution and the Surface AGENTS.md; report conflicts without resolving open decisions. Use in Design (on spec.md) and before opening a PR.
---

# Canon review

Check, and report each item as PASS / CONFLICT / N/A with file:line evidence:

1. **Ownership** — writes only to the owning Surface's tables/files; cross-Surface reads via governed views/capabilities; reactions via events.
2. **Extend, never duplicate** — no new table/function/route/role system/outbox/entitlement table/price constant without the `extend-never-duplicate` result.
3. **Identifiers** — `gcid:` stored exactly; record ids never used as entity ids; no new link table.
4. **Governed writes** — no direct writes to `graph_nodes`, `search_documents` or category tables; category changes only via `exp_category_proposals`.
5. **Security** — RLS enabled + forced on new tables; no `(true)` policies for non-service roles; no grants to `anon`/`PUBLIC`; SECURITY DEFINER has pinned `search_path`; no secrets.
6. **Model vs code** — model handles language only; deterministic code decides auth, claims, pricing, compliance, send eligibility, score rules, persistence; `not_implemented` instead of faked output.
7. **Gated actions** — no crons, indexing, enrichment engine, dirty-queue draining.
8. **Compliance** — server-side category compliance before publish/send.
9. **Scoring / rings** — SRS v5 only; no new ring logic without an O1 ruling; never `exp_ring` for new logic.
10. **Open decisions** — list every O-number or unassigned ownership the work depends on. **Flag, never resolve.**

Output a table plus a one-line verdict: "clear to proceed" or "blocked by: …".
