# Plan: <increment title>

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

## Tasks
Small tasks (≤ ~400 changed lines each), in dependency order.

| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|

## Extend-never-duplicate check
Repo search + live catalog (`pg_class` / `pg_proc`) results for every new object.

## Migration plan
File name, journal entry, backup table, apply step (human-approved), JOIN verification query, rollback.

## Test plan
Unit, contract, integration, eval suites (`*.test.ts`, evals `*.eval.test.ts`); how acceptance criteria map to tests.

## Risks
