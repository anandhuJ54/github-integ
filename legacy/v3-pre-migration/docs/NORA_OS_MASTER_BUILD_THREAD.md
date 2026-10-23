# NORA OS — Master Build Thread (single entry point)

**This is the one document to read first for any NORA OS work — human or agent.** It ties together every canon, the development rules, the current state, the data-protection mandate, the always-on parallel-agent model, and the full surface build. It links the canonical docs rather than duplicating them. On any conflict, **`CLAUDE.md` wins**, then the Engineering Directive, then this file.

---

## 0. Read order (every session)
1. `CLAUDE.md` — repo constitution (the hard rules). **Supersedes everything.**
2. `STATUS.md` — platform state.
3. `docs/NORA_OS_VISION_AND_MODEL.md` — **what we're building & why**: product, the interview, GTM, TAM/SAM, data model, value loops, category taxonomy. **Read this for context before touching anything.**
4. **This file** — current state + task queue + lane/migration rules.
5. `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` — how to build NORA OS (standards, verification, Definition of Done, how to prompt).
6. `docs/nora-os-skills-registry.md` — canonical skills/tools/claim-gate/interview-template spec.
7. `docs/NORA_OS_BUILD_HANDOFF.md` — the handoff (now folded into this file; still valid).

## 1. Document index (all current, necessary docs)
| Doc | Path | Purpose |
|-----|------|---------|
| Constitution | `CLAUDE.md` | Hard rules; wins all conflicts |
| Platform state | `STATUS.md` | Where the platform is |
| **Vision & Model** | `docs/NORA_OS_VISION_AND_MODEL.md` | **What we're building & why: product, interview, GTM, TAM/SAM, data model, value loops, taxonomy** |
| Agent rules | `AGENTS.md` | CRM/sales + Lovable-sync rules |
| Roadmap | `roadmap.md` | Direction |
| **Engineering Directive** | `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` | How to build NORA OS, correctly, in this repo |
| **Skills Registry spec** | `docs/nora-os-skills-registry.md` | Canonical skills/tools/claim/interview model |
| **Build Handoff** | `docs/NORA_OS_BUILD_HANDOFF.md` | Context + task queue (this file supersedes) |
| Change log | `docs/ETL-Enhancements.md` | Append-only; every DB/ETL change logged here |
| Data model canon | `docs/DATA_MODEL_CANON.md` | Core data model |
| Node contract | `docs/Node_Contract_Spec.md` | Node/graph contract |
| Ring mapping | `docs/Ring_Schema_Mapping.md` | Ring → schema.org. **10 rings are canonical** (`exp_rings`; confirmed by ruling 2026-10-11); this doc's 8-ring text is historical. |
| Composition | `docs/COMPOSITION_CONTRACT.md` | Composition rules |
| Security | `docs/SECURITY_ADJUDICATION.md` | Security posture |
| Always-on checklist | `docs/Always-On-Profile-Engine-Master-Checklist.md` | Profile engine checklist |

## 2. Mission (one paragraph)
NORA OS is the AI-native operating layer over the Expertise Engine graph. It runs the **first-run interview** (claim → organize the graph → resolve conflicts → show competitors → build a winning plan → set a work agreement), then the **perpetual CoPilot** pursuing one goal: get the entity to #1 in its category/geo and hold it. It works the loop **OBSERVE → UNDERSTAND → EVALUATE → PRIORITIZE → ACT → VERIFY → LEARN** via governed **skills** (business capabilities) composing **capabilities/tools** (executable ops). Targets: ~40M entities, 50K concurrent, cheap (deterministic/haiku default; metered skills cached + async). **The interview is a strict subset of the perpetual loop — make it run end-to-end through the registry on real data and ~90% of NORA exists.**

## 3. Development rules we set recently (in force)
- **Lane coordination.** **BUILD lane(s)** (Claude Code; may be several in parallel) own increments end-to-end — server functions, UI, capability code, **and the migration files for the tables their increment needs.** The **REVIEW/DATA lane** (the Cowork agent) reviews every PR + migration against the data-protection canon, verifies against the live DB, reconciles schema drift, and owns registry data. Collisions are prevented by **each agent owning a separate increment on its own branch**, not by forbidding code agents from writing migrations.
- **One increment per branch.** `nora-os/<thing>`; commit after each; open a PR; a human merges to `main`. Keep `main` working (Lovable syncs from it). **Never force-push / rebase / squash / amend pushed history.**
- **No schema change without a committed migration — this is the real rule** (it's what ~190 live tables violated). Every table/column/policy change has a committed migration file (additive, idempotent, RLS parity); the increment's owner writes it in the PR. **Applying to production:** only the DATA/review lane can reach the live DB, so it applies the committed migration in lockstep with the merge and verifies by JOIN. Claude Code (the lead build agent) has live DB access through the Lovable connector; it may read freely, and applies a committed migration only after it is reviewed. Other build agents write migrations and do not apply them. The sin to avoid is a schema change with *no committed migration behind it*, not the DATA lane applying a reviewed, committed one. **OPEN:** it is unconfirmed whether Lovable's deploy auto-applies GitHub-merged migrations or only ones it authors (see §6) — until confirmed, the applying agent applies directly and verifies.
- **Surgical, statically-verifiable edits.** The full stack often can't be built by the agent — edits must be correct from static reading; run `bun run lint` + typecheck + existing tests where possible.
- **Documentation discipline.** Every DB/ETL/function change gets an append-only `docs/ETL-Enhancements.md` entry in the same session, before "done."
- **Foundation-first + scope discipline.** Do not create tables/surfaces ahead of the increment that needs them. No speculative schema. No restyling/design-system work until the foundation is signed off.
- **Definition of Done per increment** (Directive §10): wired end-to-end, no placeholders, provenance written, permission/compliance gates enforced in deterministic code, run-logged, tests or a stated verification path, `main` builds, documented.

## 4. PROTECT THE DATA SET (data-protection canon — hard rules)
The live graph + foundation data is the company's moat. Treat it as irreplaceable.
- **Additive only.** Never `DROP`, `TRUNCATE`, or destructive-`ALTER` an `exp_*`, `graph_*`, `search_*`, `claim*`, or `*_scores` table. New columns/tables only. Destructive change requires an explicit, separate, human-approved migration with a backup first.
- **Snapshot before any load or structural change.** Back up affected tables (count + sample + schema) before migrating or bulk-writing; record it in `docs/ETL-Enhancements.md`.
- **Verify keyed loads by JOIN, not row count.** A keyed load is verified only by a JOIN against the canonical table (match count). Isolated counts pass while keys are wrong — this exact failure shipped a defect.
- **Identifier contract.** `gcid`s and platform identifiers are NEVER transformed/re-keyed/abbreviated. Store exactly as the canonical table stores them, everywhere.
- **Category integrity.** Only real GBP `gcid`s from `gbp_categories_master.csv`. No invented categories.
- **Human sample-review for semantic batches.** For any generated semantic batch (nodes, directories, agent/skill content), a human reads 10–20 diverse rows and confirms correctness BEFORE scaling. Structural gates catch malformed data; only human review catches plausible-but-wrong data.
- **RLS parity.** New tables match the established RLS pattern (`RLS on`, `FOR ALL TO authenticated USING(true) WITH CHECK(true)`; server writes via service role). Never ship a table with RLS off.
- **No schema change without a committed migration** (see §3). The increment owner writes the migration; the applying agent (DATA lane or Claude Code) applies it to the live DB in lockstep with the merge and verifies by JOIN. Any table in the DB with no committed migration is drift (§6). Least privilege: agents get only the DB access they need; no bulk destructive grants; no out-of-band schema change that isn't backed by a committed migration.
- **Provenance + trust tier on every fact** (`self_declared | imported | platform_observed | authority_verified`); the `owner_verified` write (claim) is the highest-value data event — protect it.

## 5. Always-on parallel agents (how to run them without collision)
Goal: multiple agents building continuously, in parallel, safely.
- **Lanes are the collision guard** (§3). Assign every active agent a lane + a single increment it owns. Two agents never touch the same files or the same table.
- **Branches / git worktrees for true parallelism.** Each agent works a separate branch; to run multiple Claude Code instances at once, use `git worktree add ../ee-<increment> nora-os/<increment>` so each has its own working tree on the same repo.
- **Pre-grant autonomy so they don't stall.** Claude Code Auto mode (default) or `--allowedTools "Read" "Edit" "Write" "Bash(bun*)" "Bash(git*)" --permission-mode dontAsk`. The #1 cause of "stuck after minutes" is waiting for a permission prompt or having no way to run the build — fix both.
- **The feedback loop sustains long runs.** Agents must be able to run `bun run lint` + typecheck + tests and self-correct. That loop — change → test → read error → fix — is what turns minutes into hours.
- **This task queue (§7) is the coordination point.** An agent claims an increment, moves it in-progress, and only works that. Checkpoint with a commit per step.
- **Headless / unattended:** `claude -p "<task from the queue>" --allowedTools ... --permission-mode dontAsk --output-format json`, then check `permission_denials` in the JSON. For the *perpetual* NORA (not the build), use the stack's `pg_cron`/worker pattern + scheduled refreshes.
- **Honest limit:** "runs for days" = Claude Code on a machine/CI with autonomy + the feedback loop, not any single chat. Humans still merge PRs — that gate is what keeps `main` and the data set safe at scale.

## 6. Current progress (state of play)
**Database (Supabase project `f3a72aef-0294-4fdf-bcad-77257ed344ef`):**
- `exp_skill_registry` — **37 skills** (originals + full Claim Gate + interview spine + competitive + plan + work-agreement + chat), `status='draft'`.
- `exp_capability_registry` — **39 capabilities**.
- `exp_skill_version`, `exp_skill_eval` — exist, wired.
- `exp_skill_run` — **created + verified** (run log; 22 cols; RLS `Staff all skillrun`). Migration committed.
- Reuse: `exp_nora_state`, `exp_nora_weights`, `exp_curation_ledger`, `exp_claim`/`exp_claim_events`/`claim_queue`, `exp_etl_runs`, `search_rank_scores`, `graph_nodes`/`graph_edges`, `exp_entity`.

**Code (built — extend, don't fork):** NORA OS surface `src/routes/_authenticated/nora-os.tsx` + `src/components/nora/registry-tabs.tsx` + `sandbox-tab.tsx`; registry `src/lib/nora-registry.ts`; **dry-run sandbox** `src/lib/nora-sandbox.ts` (ranking + `buildTrace` + `loadSandbox`); claim `src/routes/_authenticated/claim.$professional.tsx` + `src/lib/claim.functions.ts` + `claims.tsx`. Backend = TanStack server fns + `src/routes/api/`. No edge functions. **Migration folders:** `drizzle/migrations/` (journal-driven, `LOVABLE_DB_MIGRATION_URL`) is Lovable's active path since 2026-09-15; `supabase/migrations/` is historical. New migrations go in `drizzle/migrations/` with a matching `meta/_journal.json` entry, and the applying agent confirms the result on the live DB.

**Repo ↔ DB sync:** PARTIAL — known drift. The governance docs + the `exp_skill_run` migration are committed. But several Nora tables (`exp_skill_registry`, `exp_capability_registry`, `exp_skill_version`, `exp_skill_eval`, `exp_nora_state`, `exp_nora_weights`, `exp_build_map`, and others) exist in the live DB + generated types with **no committed migration** — created out-of-band in Lovable. **Back-commit required (task #12)** — done by the DATA lane (it has DB access to read live column defs/constraints/indexes/policies; the generated types file alone is not enough). (STATUS.md flags the same pattern for logic-layer columns.) **OPEN — deploy path unproven:** it is unconfirmed whether Lovable applies GitHub-merged migrations or only migrations it authors. `exp_skill_run` can't prove it (its table already existed before the migration was committed). The first genuinely-new table (task #5) is the test: commit its migration, merge, deploy, then check the live DB. Until proven, the DATA lane applies migrations directly.

## 7. Task queue (increments, lanes, order)
| # | Increment | Lane | Status |
|---|-----------|------|--------|
| 1 | `exp_skill_run` run-log | DB | **done** |
| 2 | Skill executor server-fn (`runSkill`, dry_run→live, writes `exp_skill_run`) + Sandbox "Run" action | CODE | next |
| 3 | Runs tab reads `exp_skill_run` | CODE | queued |
| 4 | Run one real skill end-to-end on a seeded test entity | CODE+DB | queued |
| 5 | World-model tables (contact_policy, goal, journey/trust_tier) | BUILD+DATA | queued |
| 6 | Claim Gate backend (silent precheck + graduated trust + GBP match + grant + run logging) | CODE+DB | queued |
| 7 | NORA CoPilot chat (reads world-model, invokes skills within policy) | CODE | queued |
| 8 | Interview templates (spine + ≥1 category module) | CODE | queued |
| 9 | Capability implementations (per skill, as needed by 2/4/6) | CODE | ongoing |
| 10 | Governance + attribution + monetization hardening | CODE+DB | later |
| 11 | Scale/cost (async queue, caching, cadence gates) | CODE+DB | later |
| 12 | **Back-commit migrations for undocumented Nora tables** (reconcile repo↔DB drift; introspect live schema → committed `create ... if not exists` migrations; verify by JOIN) | DATA | next |

## 8. Build the NORA OS surfaces — completely (per-surface Definition of Done)
No surface is "done" as screen-only. Each must be wired end-to-end, enforce gates in code, write provenance/run-logs, and be verified.
- **Skills tab** — list/author/version/publish-gate (built) → confirm readiness/publish gates work against real evals; no dead fields.
- **Capabilities tab** — catalog (built) → every capability a skill references exists and is implemented or clearly `dry_run`.
- **Build map** — reflects real increment state, editable.
- **Sandbox** — dry-run (built) → add real **Run** via the executor; show the logged `exp_skill_run`.
- **Runs** — reads `exp_skill_run` (real skill runs), status/verdict/telemetry/trace per run.
- **Evals** — fixtures + pass/fail gate real publishes.
- **Claim Gate** — silent precheck + graduated trust (T0/T1/T2) + GBP-ownership match + grant + unclaim/reset, all run-logged; competitor/imposter blocked before T2.
- **CoPilot chat** — conversational NORA over the world-model, invoking skills within consent/compliance.
- **Interview** — category-templated flow (spine + category modules) running end-to-end on real data = the acceptance test.
- **Executor/kernel** — the engine under all of the above (scripted + autonomous modes).
Each surface: enforce permissions/compliance in deterministic code, write provenance, emit run-log + events, add tests or a stated verification path, keep `main` green, log the change.

## 9. Kickoff prompts
**Prime a session:**
> Read `CLAUDE.md`, `STATUS.md`, `docs/NORA_OS_MASTER_BUILD_THREAD.md`, `docs/NORA_OS_ENGINEERING_DIRECTIVE.md`, `docs/nora-os-skills-registry.md`. CLAUDE.md wins on conflict. Confirm you understand the lane model + migration policy (§3), the data-protection canon (§4), and the task queue (§7). Then claim the next build-lane increment and proceed.

**Per-increment template:**
> Obey `docs/NORA_OS_ENGINEERING_DIRECTIVE.md` + `CLAUDE.md` (CLAUDE.md wins) and the data-protection canon in `docs/NORA_OS_MASTER_BUILD_THREAD.md` §4. Task: `<increment>`. Definition of Done: `<surface DoD, §8>`. OBSERVE first (name files/tables read). Plan (files, consumers, risks). If the increment needs schema, **write the migration file in the same PR** (additive, idempotent, RLS parity) and flag it for review + apply — **only the lead agent applies to production**. Implement fully, no placeholders, backend wired, gates in code. Verify (lint/typecheck/tests). Work on branch `nora-os/<x>`, commit, open a PR. End with a verification report + `docs/ETL-Enhancements.md` entry.

## 10. Definition of Done (global)
Build is "NORA OS v1" when: a real profile goes claim → organized graph → conflicts resolved → competitors → plan (Ledger) → work agreement, entirely through registered skills with runs logged in `exp_skill_run`, and you can hold a real conversation with NORA about it — all with permissions/compliance enforced, the data set intact, and `main` green.
