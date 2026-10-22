---
name: evidence-writer
description: Produce evidence.md for an increment - acceptance-criteria results, CI links, evals, read-only live verification, applied changes and what remains unverified. Required before merge.
---

# Evidence writer

1. Map every acceptance criterion in `spec.md` to the test/check that proves it; record PASS/FAIL with the command or CI link.
2. Run locally: `uv run ruff check api tools`, `uv run pytest`, `bun run -F ui/* build` (TS build/typecheck), `uv run python -m tools.lint.lint_all`. Paste summaries (not full logs).
3. Skills / AI output: eval suite, score, threshold, budget used.
4. Data changes: read-only live queries with **JOIN match counts**; never isolated row counts.
5. Applied changes: list exactly what was applied, where, by which approved step — or "None".
6. **What remains unverified**: be explicit and honest (untested paths, assumptions, production-only behaviour). Never claim something was tested if it was not.
7. Confirm the `docs/ETL-Enhancements.md` entry exists for DB / cron / ETL changes.
