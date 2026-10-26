# Intent: UI store and layout guards; setup and docs follow the UI restructure

<!-- Stage: Define. Shared template — do not remove sections. -->

| Field | Value |
|---|---|
| Surface | shared core (`surface-ui/state`, `setup.sh`, CI) |
| Increment id | _base/ui-state-guards |
| Status | requested by the project owner in the working session, 2026-10-26; second approval pending |
| Date | 2026-10-26 |

## Problem
PR #8 added one central Redux store (`surface-ui/state/`) shared by every Surface. Its rules ("a Surface reads
only its own slice", "API data stays in React Query") were written down but checked by nothing: any Surface
can select the whole store, and nothing stops API data being cached in Redux beside React Query. #8 also left
`setup.sh` broken on a fresh checkout (it copies `surface-ui/app/env.example`, which moved) and the
Integrations, Reports and Listings scaffolds pointing at the deleted `surface-ui/app/`.

## Outcome
The store's boundaries fail a test when broken, the rule for what goes in the store is written in one place,
and a new developer's `./setup.sh` works again on the new layout.

## Signals and sources
| Source | Label | What it shows |
|---|---|---|
| `surface-ui/state/README.md` at 78bfd63 (#8) | Repo | the slice rule, documented only |
| `surface-ui/state/access/thunks.ts:68,72` | Repo | shared state calls admin's `/admin/me/grants`, `/admin/me/bootstrap` |
| `setup.sh:32` at 78bfd63 | Repo | copies `surface-ui/app/env.example`, now `surface-ui/env.example` |
| `tools/lint/` absent from the repo | Repo | a lint rule would not run in CI, so the guard is a `bun test` |

## Success measure
`bun test` in `core-gates` fails a PR that imports another Surface, reads another Surface's slice or loads
API data in a Surface's `src/state/`; `./setup.sh --check` passes on a fresh checkout.

## Open decisions touched
- Identity ownership (root `AGENTS.md` §5): shared state depends on admin's `/admin/me/*`. Listed in
  `surface-spec/_base/CONTEXT.md` as needing a decision; not resolved here.

## Out of scope
Moving `/me/*` out of admin; any Surface slice; the tanstack-router code-split warnings in search/ops.
