# Surface audit — what belongs where

One Surface at a time: the current contents (UI pages, API endpoints, server code) are checked
against what the Surface is for, and anything that belongs elsewhere is marked to move. This file
records the decisions only. The moves are done after the audit, as separate commits.

Started 2026-10-24 on `migrate/browser-to-api`. The per-Surface inventories it is based on were
generated read-only from the code (pages, endpoints, tables, cross-Surface calls).

## 1. nora-os

What it holds today: one page `/nora-os` with six tabs (Skills, Capabilities, Build map, Evals,
Sandbox, Runs), the skill runner (`/nora_os/fn/runSkill`), the claim gate
(`/nora_os/fn/submitClaim`, `verifyClaimCode`, `releaseClaim`), and server-only code (category
brief, organize/extract).

Ruling (2026-10-24): **NORA OS uses the skills to do the work; the skill registry and testing
live in the skills Surface.** NORA OS keeps the engine (runner, capabilities, claim gate).

| # | Item | Was | Now (done 2026-10-24) |
|---|---|---|---|
| 1–7 | Skills, versions, capabilities, evals, build map, skill runs, sandbox | `/nora-os` tabs; API `/nora-os/registry/*`, `/nora-os/sandbox/*` | **skills**: page `/skills` (same six tabs; Runs shows skill runs only); API `/skills/registry/*`, `/skills/sandbox/*` (`surface-api/skills/{routers/registry.py,queries/}`) |
| 8 | Skill runner | `/nora_os/fn/runSkill` | Stays in **nora-os** (the engine); the skills sandbox and the xmp interview call it |
| 9 | ETL run monitor (read-only) | `/nora-os` Runs tab; `/nora-os/etl-monitor` | **etl**: `/discovery` → Pipeline Health tab; API `/etl/run-monitor` |
| 10 | Discovery jobs + engine counts (read-only) | `/nora-os` Runs tab; `/etl/platform/nora-os` | **etl**: same tab; API `/etl/platform/pipeline-health` |
| 11 | Claim gate | `/nora_os/fn/submitClaim`, `verifyClaimCode`, `releaseClaim` | Stays in **nora-os** (claims run as NORA `claim_*` skills) |
| 12 | Category brief | `nora_os/category_brief.py` | Stays in **nora-os** as a runner capability. graph's diverged copy: settle when auditing graph |
| 13 | Organize / extract | `nora_os/nora/{organize,extract}` | Stays in **nora-os** as runner capabilities |

How the UI was kept simple and unbroken:
- `/nora-os` redirects to `/skills`; the console nav shows "Skills". The last-used tab is remembered under the same key.
- The shared components (`_base` `components/nora/registry-tabs.tsx`, `skill-runs.tsx`, `lib/nora-registry.ts`, `nora-sandbox.ts`, `nora-runner*`) stay in `_base` because the xmp interview page uses them too; only their API paths changed. The page and the sandbox tab moved into `surface-ui/skills`.
- Checks: 1,474 API tests pass; all 14 UI apps typecheck; the production build passes; contracts for etl, nora-os and skills regenerated.

Not moves, but noted: `surface-api/etl/queries/run_monitor.py:22,53` (was nora_os `queries/etl_monitor.py`) hard-codes two insurance gcids and a
statefarm.com URL match (no per-category code, AGENTS.md §3); the registry router has no role
check (SF-9).
