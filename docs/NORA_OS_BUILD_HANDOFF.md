# NORA OS — Build Handoff & Context (read this first)

**Purpose:** carry the full context of the NORA OS build into any Claude Code session so no ground is lost. The chat that produced this doesn't transfer; this file + the governance docs below are the durable context. Read them, then work the task queue.

**Read before doing anything (in order):**
1. `CLAUDE.md` — repo constitution. **Wins on any conflict.**
2. `STATUS.md` — platform state.
3. `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` — how to build NORA OS in this repo (standards, verification, Definition of Done, how to prompt).
4. `docs/nora-os-skills-registry.md` — the canonical skills/tools/claim-gate/interview-template spec.
5. `docs/ETL-Enhancements.md` — append-only change log (you add an entry per DB/ETL change).

---

## 1. What we're building (one paragraph)
NORA OS is the AI-native operating layer over the Expertise Engine graph. Its job: run the NORA **first-run interview** (claim → organize the graph → resolve conflicts → show competitors → build a winning plan → set a work agreement) and then the **perpetual CoPilot** that pursues one goal — get the entity to #1 in its category/geo and hold it — via governed **skills** (business capabilities) composing **capabilities/tools** (executable ops), on the loop **OBSERVE → UNDERSTAND → EVALUATE → PRIORITIZE → ACT → VERIFY → LEARN**. It must scale to ~40M entities / 50K concurrent and stay cheap (deterministic/haiku default; metered skills cached + async). The interview is a strict subset of the perpetual loop — **make the interview run end-to-end through the registry on real data and ~90% of NORA exists.**

## 2. Current state — what already exists (do not rebuild)

**In the live database (Supabase, Lovable project `f3a72aef-0294-4fdf-bcad-77257ed344ef`):**
- `exp_skill_registry` — **37 skills** (the 8 originals + the full Claim Gate, interview spine, competitive, plan, work-agreement, chat skills), all `status='draft'`.
- `exp_capability_registry` — **39 capabilities** (the tools skills call).
- `exp_skill_version` (manifests), `exp_skill_eval` (evals) — exist, wired in `src/lib/nora-registry.ts`.
- `exp_skill_run` — **NEW, created + verified** (22 cols, RLS = `Staff all skillrun`). The run log for dry-run + live executions. Migration committed at `supabase/migrations/20261011120000_nora_skill_run_log.sql`.
- Existing to reuse: `exp_nora_state`, `exp_nora_weights`, `exp_curation_ledger`, `exp_claim`/`exp_claim_events`/`claim_queue`, `exp_etl_runs`, `search_rank_scores`, `graph_nodes`/`graph_edges`, `exp_entity`.

**In code (already built — extend, don't fork):**
- NORA OS surface: `src/routes/_authenticated/nora-os.tsx` (tabs Skills/Capabilities/Build map/Sandbox/Runs/Evals), `src/components/nora/registry-tabs.tsx`, `src/components/nora/sandbox-tab.tsx`.
- Registry data layer: `src/lib/nora-registry.ts` (list/upsert/publish gate/versions/evals).
- **Dry-run sandbox:** `src/lib/nora-sandbox.ts` — gap ranking (`priorityScore`/`rankGaps` with impact/feasibility/urgency/confidence/effort_penalty = the Ledger prioritizer), `estimateTelemetry`, `buildTrace` ("WOULD EXECUTE / WOULD BLOCK"), `loadSandbox` (real SRS from `search_rank_scores`). It **simulates**; nothing executes yet.
- Claim (basic): `src/routes/_authenticated/claim.$professional.tsx`, `src/lib/claim.functions.ts` (confidence scoring), `src/routes/_authenticated/claims.tsx`.
- Backend pattern: TanStack **server functions** (`createServerFn` + `requireSupabaseAuth` from `src/integrations/supabase/auth-middleware.ts`) and API routes under `src/routes/api/`. **No Supabase edge functions.** Migrations are dual (`drizzle/migrations` + `supabase/migrations`).

**Uncommitted artifacts to commit first** (handed to you alongside this doc; they are already applied to the live DB / written, they just need to land in git):
- `supabase/migrations/20261011120000_nora_skill_run_log.sql`
- `docs/NORA_OS_ENGINEERING_DIRECTIVE.md`
- `docs/nora-os-skills-registry.md`
- `docs/NORA_OS_BUILD_HANDOFF.md` (this file)
- the appended `## 2026-10-11 — NORA OS: skill run log` section in `docs/ETL-Enhancements.md`

## 3. The gap (what's left to build)
Real **executor** (dry-run → real run + `exp_skill_run` write) → **capability implementations** → **Claim Gate backend** (silent precheck, graduated trust, GBP-ownership) → **NORA CoPilot chat** → **interview templates** (spine + category modules, e.g. `extract.menu`/`extract.products`/`extract.listings`) → **Runs/Evals wiring** → **world-model tables** (contact policy, goal, journey/trust-tier) → governance/attribution/monetization hardening → scale/cost (async queue, caching).

## 4. Task queue (with ownership lanes)
Two agents, two lanes, no collision:
- **CODE lane (Claude Code):** app code — server functions, UI, capability implementations, branches + PRs.
- **DB lane (the Cowork/DB agent, "Claude here"):** schema/migrations on the live DB, registry data, verification, PR review. **Owns all table creation.**

| # | Increment | Lane | Status |
|---|-----------|------|--------|
| 1 | `exp_skill_run` run-log (migration+apply+verify) | DB | **done** |
| 2 | Skill executor server-fn (`runSkill`, dry_run→live, writes `exp_skill_run`) + Sandbox "Run" action | CODE | built on `nora-os/skill-runner` (PR pending) — `src/lib/nora-runner*.ts`, `nora-capabilities.server.ts` |
| 3 | Runs tab reads `exp_skill_run` | CODE | built on `nora-os/skill-runner` (PR pending) — `src/components/nora/skill-runs.tsx` |
| 4 | Run one real skill end-to-end on a seeded test entity | CODE+DB | queued |
| 5 | World-model tables: contact_policy, goal, journey/trust_tier | DB | queued |
| 6 | Claim Gate backend (silent precheck + grant + GBP match + run logging) | CODE+DB | queued |
| 7 | NORA CoPilot chat (reads world-model, invokes skills within policy) | CODE | queued |
| 8 | Interview templates (spine + 1 category module) | CODE | queued |

## 5. Coordination rules (hard)
- **DB lane owns tables.** Claude Code **does not create or alter DB tables**; it references tables that already exist (e.g. `exp_skill_run`). If an increment needs a new table, request it from the DB lane.
- **One branch per increment** (`nora-os/<thing>`), commit after each, open a PR; a human merges to `main`. Keep `main` working; **never force-push/rebase/squash pushed history** (Lovable syncs from `main`).
- **Do not apply migrations directly to prod** from Claude Code unless told — migrations land via PR→merge→Lovable deploy; the DB lane applies/verifies against the live DB.
- **Documentation discipline:** every DB/ETL change gets an append-only `docs/ETL-Enhancements.md` entry in the same session, before "done."
- **Foundation-first + compliance + category integrity + identifier contract** per `CLAUDE.md`. Enforce RESPA/TILA + Fair Housing + the compliance filter in any publish/AI path. Permissions enforced in deterministic code, never by the model.
- **Definition of Done** (Directive §10): wired end-to-end, no placeholders, provenance written, gates enforced, run-logged, tests or a stated verification path, `main` builds, documented.

## 6. How to start
First, commit the uncommitted artifacts in §2 (a single "chore: land NORA OS governance docs + run-log migration" commit on `main` or a `nora-os/handoff` branch). Then take **Increment 2** with the kickoff prompt your operator will paste. Work the queue top-down, one increment per branch, verifying each before the next.
