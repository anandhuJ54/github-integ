# Intent: Migrate experiencesrp-clone into the v3 Surface split

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | _base (shared core; spans all Surfaces) |
| Increment id | _base/migrate-from-experiencesrp-clone |
| Status | draft |
| Date | 2026-10-23 |

## Problem
The working product lives in `experiencesrp-clone` as a full-stack TanStack Start app (Lovable-built):
~190 routes, ~270 components, ~130 lib modules, 18 `createServerFn` modules and 29 `src/routes/api` handlers.
`v3-experiencesrp` has the decoupled layout (FastAPI `surface-api/<surface>` + React SPA `surface-ui/<surface>`)
but only health routers per Surface (plus a campaigns port on a separate branch). None of the product code is here yet.

## Outcome
All of experiencesrp-clone runs inside the v3 split, owned per Surface, with the same behaviour, and the old
app retired. Stage 1 (this commit): the old app is staged read-only under `legacy/experiencesrp-clone/` and
`docs/`, `reference/`, `tools/` are synced from source. Stage 2: port one Surface per commit on the same branch,
deleting from `legacy/` as each piece lands; done when `legacy/experiencesrp-clone/` is empty.

## Signals and sources

| Source | Label | What it shows |
|---|---|---|
| `experiencesrp-clone` HEAD `e9e96ce` | Repo | Source snapshot being migrated |
| `legacy/experiencesrp-clone/src/routes`, `src/lib/*.functions.ts` | Repo | Route and server-function inventory to port |
| `origin/campaigns/port-to-surface-api` (`01cde41`) | Repo | Port pattern reused for other Surfaces |
| `tools/lint/lint_all.py` walks only `surface-api`, `surface-ui` | Repo | `legacy/` staging cannot trip lint/typecheck |
| `legacy/v3-pre-migration/CONFLICTS.md` | Repo | 9 pre-existing docs that differed; kept, not overwritten |
| Migration decisions, 2026-10-23 | Programme input | One umbrella branch, single push, plain copy, stage-then-port, `.env` local only |

## Success measure
Every source route and server function has a ported home (tracked per Surface in `evidence.md`);
`legacy/experiencesrp-clone/` is empty; core-gates pass; ported pages match the old app on click-through.

## Open decisions touched
- O9 (live ETL definitions) — ETL port must not add migrations overwriting live functions.
- O1 (rings), O6 (listings), O10/O13 (conversion agents), O11 (campaigns), O12 (security hardening).
- Unassigned ownership: claims, billing, scorer — placements in the plan are proposals only.
- Stack amendment (O2/O9/O12 ruling still needed) — this port assumes it.

## Out of scope
- Applying any migration, cron, enrichment or indexing change (all gated).
- The 502 MB of historical `supabase/migrations` is staged for reference only, never applied; pruning is later.
- Committing secrets: `.env` is copied locally only (gitignored).
- Pre-existing untracked `tools/` (lint/ci/hooks Python ports) kept local as `cur-tools/`, not committed here.
