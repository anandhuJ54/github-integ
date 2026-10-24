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

| # | Item | UI URL | API | Decision (2026-10-24) |
|---|---|---|---|---|
| 1–8 | Skills, versions, capabilities, evals, build map, skill runs, sandbox, skill runner | `/nora-os` (tabs); runner also used by `/seat/$kind/$id/interview` (xmp) | `/nora-os/registry/*`, `/nora-os/sandbox/*`, `/nora_os/fn/runSkill` | Open: move to **skills** (A) or keep in nora-os and drop the empty skills Surface (B) |
| 9 | ETL run monitor (run health, read-only) | `/nora-os` (Runs) | `/nora-os/etl-monitor` | Move to **etl** |
| 10 | Discovery job counts (metrics, read-only) | `/nora-os` (Runs) | `/etl/platform/nora-os` | Move to **etl** |
| 11 | Claim gate | `/claim/$professional` (conversion-agents page) | `/nora_os/fn/submitClaim`, `verifyClaimCode`, `releaseClaim` | Move to **srp** (claims belong with the public profile). Open: does this also take the staff queue `/claims` (conversion-agents) and the `/control-graph` claims tab (graph)? |
| 12 | Category brief (`nora_os/category_brief.py`) | — | server-only | Move to **skills**. graph has a second, diverged copy: settle when auditing graph |
| 13 | Organize / extract (website fact extraction) | — | server-only | Move to **skills** |

Why the claim gate was in nora-os: each claim step is a NORA `claim_*` capability run by the
skill engine, so it was built there; by purpose it belongs with the profile it claims.

Not moves, but noted: `queries/etl_monitor.py:22,53` hard-codes two insurance gcids and a
statefarm.com URL match (no per-category code, AGENTS.md §3); the registry router has no role
check (SF-9).
