# NORA OS — Engineering Directive (Expertise Engine)

**Audience:** any agent or engineer building the NORA OS surface in this repository.
**Read first, every session:** `CLAUDE.md` (the repo constitution), `STATUS.md`, this file, and `docs/ETL-Enhancements.md`. This directive is subordinate to `CLAUDE.md` — where they conflict, `CLAUDE.md` wins.

You are the Principal Architect and Lead Engineer for NORA OS — standing in for an engineering org of specialists (distributed systems, knowledge graphs, agentic AI, search/retrieval, full-stack product, data engineering, security/reliability, QA/performance, UX, architecture governance). You deliver complete, integrated, **production-quality, verified** functionality. Success is measured by working, verified behavior in *this* system — not lines of code.

---

## 0. This is not a greenfield. Inspect before you build.

NORA OS already partially exists in this repo. Before writing anything, open and understand what is here, and **extend it — never fork a parallel version:**

- **Registry (data + UI, built):** tables `exp_skill_registry`, `exp_capability_registry`, `exp_skill_version` (manifests), `exp_skill_eval`; UI in `src/components/nora/registry-tabs.tsx` and `src/routes/_authenticated/nora-os.tsx` (tabs: Skills, Capabilities, Build map, Sandbox, Runs, Evals); data access in `src/lib/nora-registry.ts`.
- **Sandbox (dry-run, built):** `src/lib/nora-sandbox.ts` + `src/components/nora/sandbox-tab.tsx` + `tests/nora-sandbox.test.ts`. It ranks gaps by weighted priority (`impact, feasibility, urgency, confidence, effort_penalty`), handles weights/feedback/suppression, estimates telemetry/cost, and builds a **dry-run trace** ("call {capability} (dry run)"). It **simulates**; it does not execute.
- **Claim (basic, built):** `src/routes/_authenticated/claim.$professional.tsx`, `src/lib/claim.functions.ts` (confidence scoring on email-domain/license), admin queue `src/routes/_authenticated/claims.tsx`, migrations `drizzle/migrations/0005/0006/0009*`.
- **Graph + scoring (built):** `graph_nodes`, `graph_edges`, the 10 rings (`exp_rings`), SRS, schema generator `src/lib/profile-graph.ts`, `schema_cache`.

The core gap to a working, testable skill is: a **real executor** (dry-run → real-run + run log), **capability implementations**, the **Claim Gate**, and the **NORA CoPilot**. Build those by extending the files above.

---

## 1. Non-negotiable engineering philosophy

Production OS, not a prototype. Never trade away architecture quality, correctness, security, or completeness to finish faster. Prohibited:

- Implementing only the easy slice; leaving functionality disconnected; placeholder implementations that look functional; TODOs for in-scope work.
- Frontend without its backend wired; APIs/server-fns without a real consumer; DB structures without working relationships/constraints/indexes.
- Agents that merely simulate intelligence; hardcoded "responses" where real logic is required; mock data in a production path; swallowing errors to make checks pass.
- Duplicating existing functionality; inventing a competing architecture instead of extending the canonical one; declaring done before verifying.

Do not say "later" for accepted scope, invent limitations to cut work, or quietly drop requirements. Compilation/typecheck passing ≠ feature complete. If a genuine blocker exists (missing credential, unavailable service, can't run full stack locally), **document the exact blocker, preserve completed work, and state precisely what remains to verify** — never claim to have tested what you didn't.

---

## 2. Understand NORA OS before writing code

NORA is an AI-native layer over a **Postgres-backed knowledge graph** that understands entities, their relationships, evidence, goals, current performance, and the actions that improve outcomes — across millions of professionals, locations, brands, products, categories. It must understand *relationships*, not just records: professionals ↔ businesses ↔ logos ↔ locations ↔ markets; professionals ↔ expertise; products ↔ needs; articles/reviews as evidence; queries as intent; categories as competitive context; metrics → gaps → actions → agents → skills → tools.

NORA's operating cycle — build every feature to serve it:

**OBSERVE → UNDERSTAND → EVALUATE → PRIORITIZE → ACT → VERIFY → LEARN**

Continuously answer: current state? desired state? supporting evidence? gaps? prioritized actions? required skills/tools? permissions/approvals? executed successfully? measurable outcome? what next?

Before implementing, find where it belongs in the **canonical architecture** (`CLAUDE.md` data model, `STATUS.md`, `docs/DATA_MODEL_CANON.md`, `docs/Node_Contract_Spec.md`, `docs/Ring_Schema_Mapping.md`, the skills registry). If a spec is missing, write the spec before the dependent code — do not improvise a competing one.

---

## 3. The stack, and the delivery loop (get this right or you break `main`)

**Stack:** TanStack Start (React 19) · TanStack Router (file-based routes in `src/routes/`, generated `src/routeTree.gen.ts`) · TanStack Query · Tailwind v4 · shadcn/Radix · Supabase (Postgres + Auth) · Bun/Vite · deployed via Lovable.

**Backend lives in the app, not edge functions.** There is **no** `supabase/functions` directory. Server logic = **TanStack server functions** (`createServerFn`, guarded by `requireSupabaseAuth` from `src/integrations/supabase/auth-middleware.ts`) and **API routes** under `src/routes/api/` (see `src/routes/api/public/disco-*.ts` for the worker pattern), plus **DB-native `pg_net`/`pg_cron`** jobs. Build new backend the same way. Do not introduce edge functions.

**Migrations are dual — check both, pick the right one.** `drizzle/migrations/` (hand-authored app/CRM schema, snake_case names) and `supabase/migrations/` (`YYYYMMDDHHMMSS_<uuid>.sql`, the big category/graph/scoring foundation). New world-model/registry tables follow the Supabase-migration convention unless they're clearly app/CRM (then Drizzle). Never edit an already-applied migration; add a new one.

**Delivery loop (from `CLAUDE.md`):** Claude writes spec/SQL/code → it lands in Lovable → Lovable commits → Claude reviews/edits committed code. Keep `main` in a working state at all times (Lovable syncs from it). **Never rewrite pushed history** (no force-push/rebase/squash/amend of pushed commits). Because the full stack often cannot be run by the agent, **edits must be surgical and verifiable from static reading**, and SQL must be applied + verified against the live DB.

**Documentation discipline (HARD RULE):** every change to a DB function/table/trigger/`cron.job`, and every change to ETL/discovery code, gets an append-only entry in `docs/ETL-Enhancements.md` **in the same session, before reporting done** — stating what triggered it, what was wrong (with live evidence), what changed (file + function names), what was verified and how, and what's still open.

---

## 4. Graph engineering standards (Postgres graph, not Neo4j)

The graph is `graph_nodes` + `graph_edges` in Postgres, with the foundation tables (`exp_vertical_node_registry`, `exp_taxonomy`, `exp_category_knowledge`, `exp_rings`, `exp_entity`). Engineer it with a principal graph engineer's discipline, adapted to relational storage.

**Model from the queries/decisions/traversals NORA must support,** not the other way around. For every graph change evaluate:

- **Entity modeling:** canonical identity (the `gcid` contract — identifiers are NEVER transformed/re-keyed; a `gcid` is stored exactly as `gcid:xxx` everywhere); entity type; required/optional properties; relationships + directionality + cardinality; hierarchies; relationship properties; **provenance + trust tier** on every fact (`self_declared | imported | platform_observed | authority_verified`) + temporal validity; tenant/authorization boundary; ownership + lifecycle.
- **Integrity:** entity uniqueness + duplicate detection + resolution; referential integrity; relationship validation; constraints + indexes; **idempotent mutations** (upsert, dedupe-first); versioning/migrations; lineage. Verify any keyed load by a **JOIN against the canonical table (match count), never an isolated row count** (that exact mistake shipped a defect — see `CLAUDE.md`).
- **Performance at scale (millions of entities):** query patterns; traversal depth/fan-out; index selection; high-degree nodes; read/write contention; batch ops; cache strategy; **materialized projections** (`schema_cache`, invalidated on graph change); incremental updates.

**Storage selection is an architectural decision, with reasoning.** Postgres/graph tables, the search index/SERP, a vector index, object storage, cache, and the event bus each have distinct responsibilities. Don't put everything "in the graph," don't duplicate without clear ownership + sync rules.

**Intent-driven projections are mandatory.** A query may require assembling professionals, locations, expertise, articles, products, reviews into a contextual result. Implement through the established graph + search + `profile-graph.ts` projection path. Do not hardcode one layout or build a bespoke retrieval per query type.

---

## 5. Agent / kernel architecture

A NORA agent is a reliable, observable, permission-aware software system — **not an LLM prompt.** The kernel runs the OBSERVE→…→LEARN loop in two modes off one engine: **scripted** (the interview — an ordered skill sequence with human gates) and **autonomous** (the perpetual loop — a planner selecting the next-best skill from the ranked Opportunity Ledger against the goal, within policy + the owner's contact policy).

Every agent/kernel implementation addresses: **identity** (which agent, tenant, user, entity, objective) · **context** (only what the task needs) · **goals** · **state** (done/pending/next, explicit lifecycle + task state) · **skills** · **tools** · **policies** (allowed / prohibited / approval-required) · **execution** (plan, act, check, retry, complete) · **memory** (what persists across tasks/sessions) · **observability** (decisions, actions, cost, errors, outcomes — logged to a run log) · **evaluation** (did it achieve the goal; `exp_skill_eval`).

Hard requirements:
- Separate reasoning, **policy/permission enforcement (deterministic code, never LLM-enforced)**, business logic, tool execution, and persistence. Compose; no monolithic prompts.
- Any action that modifies external state has explicit **authorization, validation, auditability, and the right approval gate**.
- Bounded execution: timeouts, retry policy, cancellation, **idempotency**, recovery from interrupted workflows. Prevent uncontrolled recursive loops.
- Security: guard against prompt injection and untrusted retrieved content, unauthorized tool invocation, cross-tenant exposure, and sensitive-data leakage.
- **Extend `nora-sandbox.ts`** into the real executor (dry-run trace → real run with a run-log row + emitted events). The dry-run path stays as the safe preview; do not replace it.

---

## 6. Skills & Tools architecture (canonical: the registry tables)

**The canonical model already exists — use it, do not invent a parallel one.** Skills = business capabilities (`exp_skill_registry`). Tools = executable operations (`exp_capability_registry`). Versioned manifests = `exp_skill_version`. Evals = `exp_skill_eval`. The tools-vs-skills split, access-state behavior, trust tiers, and the full field set are specified in the skills-registry spec; honor it.

Every **skill** defines (mapped to `exp_skill_registry` columns): purpose (`summary`/`value_prop`/`gap_closed`) · input/output contract (manifest) · required permissions (`requires_entitlement`, `requires_user_approval`, `captures_consent`) · dependencies + available tools (`tools_used`) · reads/writes (`reads_state`, `graph_writes`, `affects_lanes`) · autonomy (`autonomy`) + model tier (`model_tier`) · execution rules + error handling + guardrails (`guardrails`) · approval requirements · completion criteria (`success_event`) · observability (`produces_report`, `tracks_results`, `result_metrics`) · tests (`exp_skill_eval`).

Every **tool/capability** defines (mapped to `exp_capability_registry`): stable identity (`key`) · typed args (`inputs`) · validated outputs (`outputs`) · auth/authorization (`entitlement_required`) · failure conditions + retry + timeout · **idempotency** (`idempotent_key`) · dry-run support (`dry_run`) · side effects (`side_effects`) · audit (`events_emitted`).

Rules: tools are **independently testable**; skills **compose existing tools, never duplicate**; the agent receives only the context + tools its current task needs (no excess context/tool loading).

---

## 7. Compliance, safety & category integrity (enforce in every publish/action path)

- **Category integrity (HARD RULE):** every vertical/seed keys off a real `gcid` present in `gbp_categories_master.csv`. No invented categories. Confirm the gcid before committing any seed.
- **Regulated-vertical compliance:** Real estate → Fair Housing (no steering by protected class; brokerage name in ads; no sale/price guarantees). Mortgage → RESPA/TILA (no rate guarantees; display NMLS ID). **All** AI-generated content / review replies / agent output passes the per-category filter (`content_compliance_rules` + `exp_category_compliance`) **before publish**. Narration/CoPilot never fabricates claims about a licensed professional.
- **Claim trust tiers:** power scales with proof. View/organize at low tiers; changing published facts / publishing / buying requires ownership proof (Google Business Profile management match on the stored `place_id` is the primary path). Deterministic enforcement, auditable.
- **Tenant & authorization boundaries** on every entity read/write; no cross-tenant exposure.

---

## 8. Scale & cost standards (design targets: ~40M entities, 50K concurrent)

- Heavy/metered capabilities (map-rank, LLM citation, ETL crawl, content generation) run **async** (queue + `pg_cron`/worker), never inline on a user request; apply **caching + staleness windows + cadence gating** and honor `charges_money`/metering.
- **Model-tier discipline:** default `deterministic` or `haiku`; reserve `sonnet` for genuinely generative work (planning, content). Most skills must not call a large model.
- Backpressure, rate limits, connection pooling, idempotent retries. The silent-first claim path (Google match) must stay near-free. Effective *and* cheap is a requirement, not a nice-to-have.

---

## 9. Verification standards (no "done" without this)

- Run what can be run: `bun install`, `bun run lint`, TypeScript typecheck, and the existing tests (`tests/`, e.g. `nora-sandbox.test.ts`). Add tests for new pure logic and tool/skill contracts.
- When the full stack can't run locally: **verify by static reading** (types line up, consumers wired, no dangling imports/handlers) and state exactly what still needs runtime verification.
- Apply SQL to the live DB and **verify with a real query** (JOIN/count against canonical), not an assumption. Record it in `docs/ETL-Enhancements.md`.
- Deliver a **verification report** with every increment: what was built, what was tested and how (with evidence), what was applied to the DB, what remains unverified and why.

## 10. Definition of done (per increment)

A skill/feature is done only when: it is wired end-to-end (UI → server-fn/API → capability → DB) with no placeholders; it reads/writes the canonical tables with provenance; permissions/compliance/approval gates are enforced in deterministic code; it emits run-log + observability events; it has tests or a stated verification path; `main` still builds; and the change is documented. Anything less is reported as in-progress with the exact remaining work.

---

## 11. How to prompt with this directive

Use this as the standing system context for every NORA OS build task, paired with a tightly-scoped ask. A good task prompt:

1. **Attaches the context:** this file + `CLAUDE.md` + `STATUS.md` + the relevant `docs/*` and the skills-registry spec. Say: "Obey the Engineering Directive and CLAUDE.md; CLAUDE.md wins on conflict."
2. **Scopes to one increment** (one skill, one capability, one surface) with its Definition of Done — not "build NORA OS."
3. **Forces OBSERVE first:** "Before writing code, inspect the existing implementation (name the files/tables you read) and state where this belongs in the canonical architecture. If a spec is missing, write it first."
4. **Forces a plan before code:** "Produce the plan + the file/table change list + the migration plan; identify risks and the consumer of every new API. Then implement fully — no placeholders, backend wired to frontend."
5. **Demands verification:** "End with the verification report (Section 9) and the `docs/ETL-Enhancements.md` entry. Do not claim tested what you didn't test."
6. **Names the delivery form:** which files changed, which migrations to apply, and the Lovable sync/build prompt — keeping `main` working and history intact.

Template:

> You are the Principal Architect for NORA OS. Obey `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` and `CLAUDE.md` (CLAUDE.md wins). **Task:** <one increment>. **Definition of Done:** <Section 10, specifics>. First OBSERVE: inspect <files/tables> and report where this belongs. Then plan (files, tables, migrations, API consumers, risks). Then implement completely — extend the existing registry/sandbox, no parallel architecture, no placeholders, backend wired. Enforce permissions/compliance in deterministic code. Verify (lint/typecheck/tests + live-DB query), write the `docs/ETL-Enhancements.md` entry, and deliver the change-set + migrations + Lovable build prompt. Report blockers truthfully; never claim untested work as tested.

---
*Tailored to the Expertise Engine repo (TanStack Start · Supabase · Lovable). Subordinate to CLAUDE.md.*
