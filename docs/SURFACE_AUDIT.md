# Surface audit — what belongs where

One Surface at a time: the current contents (UI pages, API endpoints, server code) are checked
against what the Surface is for, and anything that belongs elsewhere is marked to move. This file
records the decisions only. The moves are done after the audit, as separate commits.

Started 2026-10-24 on `migrate/browser-to-api`. The per-Surface inventories it is based on were
generated read-only from the code (pages, endpoints, tables, cross-Surface calls).

## Standing rules (apply to every Surface)

- **Locations and professionals belong to srp** (ruling 2026-10-25). Anything about a location
  (office) or a professional (its pages, its data, its console views) goes to srp, the
  "SRP — Locations & Professionals" Surface (AGENTS.md §7), wherever it lives today.
  This is a guide, not an automatic move: each case is put to the user during that Surface's
  audit and moves only when confirmed.

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
| 9 | ETL run monitor (read-only) | `/nora-os` Runs tab; `/nora-os/etl-monitor` | Page `/run-health` under the **NORA OS** menu (route in `surface-ui/etl`, the data owner); API `/etl/run-monitor` |
| 10 | Discovery jobs + engine counts (read-only) | `/nora-os` Runs tab; `/etl/platform/nora-os` | Same `/run-health` page; API `/etl/platform/pipeline-health` |
| 11 | Claim gate | `/nora_os/fn/submitClaim`, `verifyClaimCode`, `releaseClaim` | Stays in **nora-os** (claims run as NORA `claim_*` skills) |
| 12 | Category brief | `nora_os/category_brief.py` | Stays in **nora-os** as a runner capability. graph's diverged copy: settle when auditing graph |
| 13 | Organize / extract | `nora_os/nora/{organize,extract}` | Stays in **nora-os** as runner capabilities |

How the UI was kept simple and unbroken:
- The side menu has a **NORA OS** group, as before, with **Skills** (`/skills`) and **Run health** (`/run-health`). `/nora-os` redirects to `/skills`. The last-used tab is remembered under the same key. `/discovery` is unchanged.
- The shared components (`_base` `components/nora/registry-tabs.tsx`, `skill-runs.tsx`, `lib/nora-registry.ts`, `nora-sandbox.ts`, `nora-runner*`) stay in `_base` because the xmp interview page uses them too; only their API paths changed. The page and the sandbox tab moved into `surface-ui/skills`.
- Checks: 1,474 API tests pass; all 14 UI apps typecheck; the production build passes; contracts for etl, nora-os and skills regenerated.

Not moves, but noted: `surface-api/etl/queries/run_monitor.py:22,53` (was nora_os `queries/etl_monitor.py`) hard-codes two insurance gcids and a
statefarm.com URL match (no per-category code, AGENTS.md §3); the registry router has no role
check (SF-9).

## 2. conversion-agents

Nothing in the original app was "conversion agents": everything here was placed by the clone
migration (2026-10-23) by reading the old app's files.

| # | Item | UI URL | API | Decision |
|---|---|---|---|---|
| 1 | Claim page (a professional claims their profile) | `/claim/$professional` | `/conversion-agents/claim-profile/{slug}` (submit and verify go to nora-os) | Move to **srp** (2026-10-25) |
| 2 | Claims queue (staff approve/reject) | `/claims` | `/conversion-agents/claims/*` | Move to **admin**, an admin view (2026-10-25) |
| 3 | PLG rules (upgrade nudges per category; shown on the professional's `/dashboard`) | `/emp/plg-rules`, not in any menu | `/conversion-agents/plg-rules/*` | Open: admin, sales or srp? |
| 4a | Card actions + related searches (city results on the site home) | `/` | `/conversion_agents/fn/getCardActions`, `getRelatedSearches` | Move to **search** (online search) (2026-10-25) |
| 4b | Compare (the compare tray on public pages) | profile pages, e.g. `/p/$slug` | `/conversion_agents/fn/getCompareEntities` | Move to **search** (online search) (2026-10-25) |
| 5 | Site proposal preview/accept | `/discovery` (Source Registry and Category Population tabs), not in any menu | `/conversion_agents/fn/previewSiteProposal`, `acceptSiteProposal` | Proposed **etl** (its root page is etl's `/discovery`); awaiting confirmation |
| 6 | "Sign in with Lovable" helper | the claim page | — | Goes with the claim page: **srp** |

Noted: `/emp/plg-rules` and `/discovery` have no side-menu link (reachable by URL only).

## Decisions noted ahead (to apply when that Surface is audited)

| Surface | Item | UI URL | Decision |
|---|---|---|---|
| xmp | The whole seat area: a professional's or location's own pages (My Profile, Expertise Graph, Reviews, Nora, Team, Listings, Multi-Post, Reporting, NORA interview), `xmp/src/routes/_authenticated/seat.*` and their libs and API (`/xmp/...` seat endpoints) | `/seat/$kind/$id/...` | Move to **srp** (standing rule, 2026-10-25) |
