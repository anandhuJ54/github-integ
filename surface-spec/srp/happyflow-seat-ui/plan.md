# Plan: Move the Happyflow professional-seat UI into surface-ui/srp

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

Branch: `srp/happyflow-seat-ui` (from `main` `3a5eca8`). One increment, one PR, no force-push.
Source: `/Users/anandhu/Documents/Projects/experiencesrp-clone` (`srp-1.0`, `2993fcb` + uncommitted tree). Target root: `surface-ui/srp/src/`.

Commit order below is the order of work. Each task is one commit; the three large copies (3, 4) are split by folder so
each commit stays reviewable even though the file contents are copied, not authored.

## Tasks
Small tasks (≤ ~400 changed lines each) where the work is authored; pure file copies are marked **copy** and sized by file.

| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|
| 0 | Freeze the source: record `git -C <clone> rev-parse HEAD`, `git status --short`, and a `shasum` list of every file to be copied into `evidence.md` (the clone tree is uncommitted and can change) | evidence.md | n/a | spec approved |
| 1 | Tests first (failing): `seat-nav` mapping, `use-hf-device` and profile storage helpers with throwing storage, source-guard test (spec AC 7), `validateSearch` for the index route | `surface-ui/srp/src/components/happyflow/seat-nav.test.ts`, `use-hf-device.test.ts`, `screens/profile-store.test.ts`, `surface-ui/srp/src/happyflow-guard.test.ts`, `routes/.../seat-index-search.test.ts` | These are the tests | 0 |
| 2 | **copy** Happyflow assets (4 images, ~binary) | `src/assets/happyflow/{dana-whitfield,dana-tampa,dana-whitley}.jpg`, `experience-icon.png` | Guard: files exist and are referenced | 0 |
| 3 | **copy** Happyflow support files with import rewrite per spec "Port transformations": `demo-data.ts`, `icons.ts`, `primitives.tsx`, `seat-nav.ts`, `use-hf-device.ts`, `use-speech.ts`, `happyflow.css`; split the storage access into small helpers so task 1 tests can run without a DOM | `src/components/happyflow/*` (7 files) | Task 1 tests turn green for seat-nav, device, storage | 1, 2 |
| 4 | **copy** Happyflow shell | `src/components/happyflow/shell.tsx` (2,785 lines, one file) | Guard test | 3 |
| 5 | **copy** Happyflow screens, in 3 commits: (a) `home-day1`, `home-day7`; (b) `srs`, `profile`, `profile-voice`, `insights`, `website`; (c) `connections`, `network`, `settings`, `find-you`, `interview`, `interview-engine` | `src/components/happyflow/screens/*` (13 files, ~13k lines) | Guard test (no forbidden imports) | 4 |
| 6 | Seat shell: add `locked`, `pro`, `hideHeader`, new `PRO_NAV`, hand-merged from the clone diff, keeping `LOCATION_NAV` and the exported label lists | `src/components/seat/scoped-shell.tsx` (~60 changed lines) | Nav-order test over `PROFESSIONAL_NAV_LABELS` | 3 |
| 7 | Graph: copy v3 `expertise-graph-{page,canvas}.tsx` and `utils/expertise-graph.ts` from `surface-ui/search`, rewrite `@v3/search/*` → `@v3/srp/*`, apply the clone's Happyflow changes (`embedded`, `onBack`, `highlightBranch`) and add `expertise-graph-light.css` | `src/components/graph/*` (2), `src/utils/expertise-graph.ts`, css | Loader test with a stubbed `api.get` (null → null; populated flag) | 3 |
| 8 | Routes: add the 7 new pro-only routes; update index (`validateSearch`, day 1 / 7 / 24, location overview kept), nora, interview (pro → Happyflow, location → live), graph (embedded radial view) | `src/routes/_authenticated/seat.$kind.$id.{profile,insights,website,connections,network,settings,find}.tsx` (new, ~19 lines each); `.{index,nora,interview,graph}.tsx` (edited) | Task 1 `validateSearch` test | 5, 6, 7 |
| 9 | Regenerate the tracked route tree (`bun run build` in `surface-ui`) and commit only the resulting diff of `shell/.generated/routeTree.gen.ts` | `surface-ui/shell/.generated/routeTree.gen.ts` | Typecheck passes | 8 |
| 10 | Verification pass: all commands in "Test plan", browser click-through, screenshots vs clone, then `canon-review`, second-model review, `evidence-writer` | `evidence.md`, `spec.md` (Canon review, Second-model review) | n/a | 9 |

Out of the task list on purpose: any `surface-api/`, `contracts/`, `docs/ETL-Enhancements.md` change.

## Extend-never-duplicate check
Repo search done 2026-10-26 (live catalog check not needed: no table, function or route in the database is added).

| New thing | Existing equivalent found | Result |
|---|---|---|
| `components/happyflow/**`, `assets/happyflow/**` | None in `surface-ui` (searched `happyflow`, `Dana`) | New, ported from the clone |
| `seat.$kind.$id.{profile,insights,website,connections,network,settings,find}` | srp has `team`, `listings`, `multi-post`, `reporting`, `reviews`, `graph`, `nora`, `interview`, `index`; none cover these | New |
| `/seat/$kind/$id/find` vs search's `/find` | Different routes (`/find` is the public SERP in `surface-ui/search`) | No clash; names kept to match the clone |
| `ScopedShell` nav additions | `surface-ui/srp/src/components/seat/scoped-shell.tsx` | Extended, not duplicated |
| `components/graph/expertise-graph-{page,canvas}.tsx`, `utils/expertise-graph.ts` | **Exists in `surface-ui/search`** (same files, `@v3/search/*` imports) | Deliberate duplicate: srp may not import another Surface (`surface-ui/state/boundaries.test.ts`). Promotion to `@v3/shared` is a shared-core PR, not done here |
| `acting-as-bar`, `entity-avatar`, `console-primitives`, `ui/*` | Already in srp or `@v3/shared` | Reused, not copied again |
| `progress.tsx`, `radio-group.tsx` | In `surface-ui/srp/src/components/ui/` | Reused only if a Happyflow file imports them |
| Theme tokens `--color-ink*`, `--color-hairline`, `--color-g-blue*` | In `surface-ui/theme/css/tokens.css` | Reused |
| Fonts Manrope, Sora | Loaded in `surface-ui/shell/root.tsx:111` | Reused |
| Home-grown storage keys `hf-device`, `hf-demo-profile` | No existing key uses these names (searched `surface-ui`) | New, browser-only |

## Migration plan
None. No database object, grant, Alembic revision or numbered SQL file is added, so no backup table, JOIN verification
or rollback is needed. Rollback of the increment is reverting the PR; the old seat pages come back untouched.

## Test plan
Environment note: the UI test setup (`bun test`, `surface-ui/bunfig.toml`) has no DOM preload and `happy-dom` is not in
`surface-ui/package.json`, so **render tests are not available** without adding a dependency. This increment adds none;
logic is made unit-testable (tasks 3, 6, 7) and screen rendering is verified by the manual click-through.

| Spec AC | How it is checked |
|---|---|
| 1, 2, 3 | Route tree diff review; `validateSearch` unit test; browser click-through of every route as a professional and as a location |
| 4 | `seat-nav.test.ts` with a fake `navigate` for every `HfRoute` |
| 5 | Nav-order unit test on `PROFESSIONAL_NAV_LABELS`; visual check of the PRO pill and the lock |
| 6 | Manual: radial view opens inside the seat and back returns |
| 7 | `happyflow-guard.test.ts` (reads the files and fails on `supabase`, `createServerFn`, `fetch(`, `@tanstack/react-start`, `@/`, `@v3/<other surface>`, `@v3/shell`) |
| 8 | `bun test` (includes `surface-ui/state/boundaries.test.ts`) |
| 9 | Commands below |
| 10 | `profile-store` and `use-hf-device` tests with throwing storage |
| 11 | `git diff --stat main...HEAD` pasted into evidence |
| 12 | Loader test with stubbed `api.get`; manual with no data |
| 13 | Screenshots, clone dev server vs v3 dev server, same viewport, per professional route; differences listed |

Commands (run from the repo root; results go into `evidence.md`, with failures stated as they are):
```
cd surface-ui && bun install
bunx tsc --noEmit -p .
for d in */; do [ -f "$d/tsconfig.json" ] && bunx tsc --noEmit -p "$d"; done
bun test
bun run build
cd ../surface-api && uv run ruff check . && uv run pytest     # unchanged by this increment; run for the gate
python3 ../tools/lint/lint_all.py                               # tools/lint is absent in this checkout; report that as unverified
```
No evals: no model output is involved.

## Risks
- **Size and review load:** ~17k copied lines, 3 files over 1.5k lines. Copied verbatim except for imports and the
  storage-helper split, so the review is a diff against the clone, not a read of new logic. The copy must not be reformatted.
- **Source is uncommitted and moving:** the clone tree can change while this runs. Task 0 freezes hashes; any later clone
  change needs a new copy and a new hash list.
- **Behaviour change for professionals:** home, NORA, interview and graph switch from live seat data to demo data for
  professional seats. Intended per the request, but it removes a working live page. Approved in the intent; called out in the PR.
- **Shell merge:** the clone's `enterprise-shell.tsx` and the target's `scoped-shell.tsx` have diverged; a hand-merge risks
  dropping target-side changes. Mitigation: apply only the clone's diff hunks and re-run the nav test.
- **Graph duplication:** two copies (search, srp) will drift until promoted to shared; recorded as a follow-up intent.
- **Demo content:** `demo-data.ts` and the images carry a persona name and photos; check they contain no real person's
  data and no named individuals in comments before merge (hard rule: no people's names in code or comments).
- **Route tree churn:** the generated file is tracked and its diff is large; committed separately (task 9).
- **Browser-only features:** Web Speech API (`use-speech.ts`) and fonts cannot be checked by tests; manual only, recorded as unverified if skipped.
- **Edit guard hook missing:** `tools/hooks/guard.py` is absent, so the guard on edits is not running; the final diff is
  scanned for secrets and applied-migration edits by hand and by `gitleaks` in CI.
- **Missing lint tools:** `tools/lint` and `tools/ci` are not in this checkout, so the lint ratchet and the evidence
  risk classifier cannot be run locally; CI behaviour for this PR is unknown until it runs.
