# Intent: Move the Happyflow professional-seat UI into surface-ui/srp

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/happyflow-seat-ui |
| Status | draft |
| Date | 2026-10-26 |

## Problem
The new design of the professional seat ("Happyflow") exists only in the old full-stack app
`experiencesrp-clone`, as uncommitted work on branch `srp-1.0` (base `2993fcb`). `surface-ui/srp` here still
has the older seat pages: a professional's seat home, NORA, interview and graph pages are the earlier
version, and the pages Happyflow adds (profile, insights, website, connections, network, settings, find) do
not exist. The design therefore cannot be reviewed or built on in the v3 app, and it is at risk of being lost
because it is not committed anywhere.

## Outcome
The Happyflow seat UI runs inside the composed v3 app, owned by the SRP Surface, at the same
`/seat/$kind/$id/*` URLs as in the clone:
- A professional's seat shows the Happyflow screens (home day 1 and day 7, SRS score, profile, insights,
  website, connections, network, settings, find-you, interview, graph).
- A location's (office) seat keeps today's live pages unchanged.
- The UI is delivered as it is in the clone, on its demo data. Nothing new is read from or written to the
  backend, so no endpoint, contract, migration or table changes.

## Signals and sources
Every claim below was read from code in this session; none of it was run or built.

| Source | Label | What it shows |
|---|---|---|
| `experiencesrp-clone` `git status` (branch `srp-1.0`, `2993fcb`) | Repo | 8 modified and about 12 untracked paths hold Happyflow, uncommitted: `src/components/happyflow/` (21 files, ~16.5k lines), `src/assets/happyflow/` (4 images), 7 new `seat.$kind.$id.*` routes, edits to 4 seat routes, `enterprise-shell.tsx` and the two expertise-graph components, plus the new `expertise-graph-light.css` |
| `experiencesrp-clone/src/components/happyflow/shell.tsx:51,57` | Repo | `HF_NORA_UI = false` and `HF_DEMO_BAR = false`: NORA actions and the demo bar are off; the screens read demo constants (`demo-data.ts`) |
| `experiencesrp-clone/src/components/happyflow/**` imports | Repo | Only `react` and `@tanstack/react-router`; no supabase, `createServerFn` or `fetch`, so no new npm packages and no API rewrite |
| `docs/SURFACE_AUDIT.md:12-19` and §5 (rows from line 102) | Repo | Ruling 2026-10-25: locations and professionals belong to srp; serving pages are in `search`, editing and seat pages are in `srp` |
| `surface-ui/srp/README.md` | Repo | srp already holds the claim page, the seat area `/seat/$kind/$id/*` and the pro dashboard `/dashboard/*` |
| `surface-ui/srp/src/routes/_authenticated/seat.$kind.$id.*.tsx` (10 files) and `src/components/seat/scoped-shell.tsx:152` (`PRO_NAV`) | Repo | The current seat pages and nav that Happyflow changes; professionals' pages read the real `/srp/seat/*` endpoints |
| `surface-ui/search/src/components/graph/expertise-graph-{page,canvas}.tsx` | Repo | The graph components the Happyflow graph page embeds exist only in `search`; srp may not import another Surface (`surface-ui/state/boundaries.test.ts`) |
| `surface-ui/vite.config.ts` (`SURFACES`, `virtualRouteConfig`) | Repo | srp is already mounted; new route files under `surface-ui/srp/src/routes/` register themselves, and the generated `shell/.generated/routeTree.gen.ts` is tracked |
| Move request and answers, 2026-10-26 | Programme input | Scope is Happyflow only; it ships as UI only on demo data; wiring real data is a later increment |

## Success measure
- Every Happyflow route in the clone renders at the same URL in the v3 app, and the location seat is
  unchanged. Verified by a click-through and screenshot comparison against the clone, recorded in `evidence.md`.
- `tsc` (app and `surface-ui/srp`), `bun test` (including the Surface-boundary guard) and the build pass.
- Observe: any visual or behavioural difference from the clone found in review is logged as a finding and
  becomes a new intent, test or lint rule, per the loop in `AGENTS.md` §1.

## Open decisions touched
None are resolved or depended on. Noted for review:
- O1 (rings): the SRS and score screens show demo values only; no ring or score logic is written or changed.
- Root `AGENTS.md` §4 "No restyling or design-system work until the final reskin": Happyflow is a new screen
  design, not a restyle. It is brought in with its own scoped CSS (`.hf-root`) and without edits to
  `@v3/theme` or `@v3/shared`. Whether that is acceptable before the reskin needs a reviewer's confirmation.
- Surface boundary: copying the expertise-graph components into srp duplicates code that lives in `search`.
  The alternative, promoting them to `@v3/shared`, is a shared-core change and is not proposed here.

## Out of scope
- Any API, endpoint, contract (`contracts/srp`), migration or database change, and any `docs/ETL-Enhancements.md` entry.
- Wiring Happyflow to real data, NORA actions (`HF_NORA_UI` stays false) and the demo bar.
- Changes to `surface-ui/search`, `shared`, `state`, `theme` or `shell` (other than the regenerated route tree).
- Re-porting the dashboard, the claim page, or the public profile, find and topic pages.
- Restyling, theme tokens and design-system work.
- Committing the clone's unrelated untracked files (`.pnp.cjs`, `.yarn/`, `yarn.lock`, `ai-native-features.xlsx`, `.claude/`).
