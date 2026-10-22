# Verify the NORA OS work that just landed

## Goal
Prove the four merged pull requests actually work against the live data — not just that they
compile. The headline test: run a skill from the Sandbox and confirm it writes a real run-log
row that the Runs tab then shows.

## What is already confirmed (read-only checks this session)
- This workspace is on the newest repo commit (`6277bde`); GitHub's main matches it exactly.
  Nothing to pull.
- The runner is wired end-to-end in code: the Sandbox's **Run (dry run)** button calls the
  `runSkill` server function, and the Runs tab reads the run log
  (`src/routes/_authenticated/nora-os.tsx` → `SkillRunsPanel` → `listSkillRuns`).
- The run-log table exists with security enabled and one policy for signed-in staff,
  but it holds **0 rows** and has **no visible access grant** for the signed-in staff role.
  That is the one open item flagged when the table was created, and it is the most likely
  reason a first dry run would fail.
- Live (non-dry) runs are restricted to the two highest roles, so this pass stays on dry runs.
- The new category brief has tests and tooling but is **not wired into any screen yet** —
  nothing to click, so it is checked by test only.
- Eight test files exist and run with `bun test`.

## Steps
1. **Static pass** — run the type check and the full test suite, and confirm the latest build
   is clean. Any failure here is fixed before going further.
2. **Live dry run** — sign in as a staff user, open NORA OS → Sandbox, keep the default entity,
   pick a ranked gap and press **Run (dry run)**. Capture a screenshot of the result.
   Expected: a "Dry run logged" confirmation and a new row in the run log.
3. **Runs tab** — reload NORA OS → Runs and confirm the same run appears with its verdict,
   telemetry (model, estimated tokens/cost, timings) and trace. Screenshot it.
4. **If the dry run is refused for access** (the likely case given the missing grant) —
   give the signed-in staff role access to the run-log table, append the required entry to the
   change log, then repeat steps 2–3 until a row lands.
5. **Category brief** — run its tests and state plainly that no surface reads it yet.
6. **Report** — what now works, and what is still open: live runs limited to two roles,
   the brief not yet wired into any screen, and anything the dry run exposes.

## Technical notes
- Checks: `tsgo` for the type check, `bun test` for the eight files in `tests/`,
  and `/tmp/observability/build-errors.log` for build health.
- Live path: Playwright against the preview at `http://localhost:8080`, session minted for a
  staff account, navigating `/_authenticated/nora-os` (Sandbox tab, then Runs tab).
- Run-log table: `public.exp_skill_run` — row count, policy and grant state verified this
  session (RLS on, policy `Staff all skillrun` for `authenticated`, 0 rows, no grants listed).
  If a grant is needed it is additive only (`GRANT SELECT, INSERT`), plus an append-only
  entry in `docs/ETL-Enhancements.md` per the repo's documentation rule.
- No schema changes, no live-mode executions, no writes to entity or graph data.
