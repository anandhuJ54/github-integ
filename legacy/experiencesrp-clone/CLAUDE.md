# CLAUDE.md — Repo Constitution (read every session)

Claude is the **system of record** for this project. Lovable is the build/design
surface. The loop: Claude writes the spec/SQL/Lovable-prompt → user runs it in Lovable
→ Lovable commits to this repo → **Claude reviews and edits the committed code here.**

> Keep `main` in a working state at all times (Lovable syncs from it). Never rewrite
> pushed history (no force-push/rebase/squash of pushed commits). Edits must be
> surgical and verifiable from static reading when the build can't be run locally.

## What we're building
Experience.com SRP — an AI Search Rank Platform built **category-out**: organized around
4,041 GBP categories, mirrored exactly (there is no "vertical" concept — say category); a
new category is **configuration, not code**. Each entity gets a 10-ring **expertise graph**
(canonical rings in `exp_rings`) that emits schema.org and powers the 850-pt, 10-lane
Search Rank Score (live scorer: DB function `exp_compute_score_v2`).
Surfaces: SRP (public), XMP (enterprise), EMP (internal), NORA OS. Full status + context in
`STATUS.md` — read it.

## One connected system (HARD RULE — applies to ALL sessions/agents; restated by Scott 2026-10-11)
This platform is ONE connected system: ETL inserts → nodes get proof + schema.org → publish →
index → monthly refresh → found in search → claimed → NORA upgrade, and the sales team
(CRM, CPQ, contracts, commissions, boarding, entitlements) works inside the same platform and
sees the same traffic, claims and upgrades. Never pull a piece out into a separate system.

- **Build your feature on the existing data model. Do not change the core data model.**
  Category data (knowledge model, node registry, taxonomy, rings, scoring targets,
  compliance) is changed only by Scott, Abdul or Claude.
- **Extend, never duplicate.** Before adding anything, find the existing table, DB function,
  server function, route or dashboard (check the live DB too — much logic lives there) and
  extend it. No duplicate functions, tables, dashboards or role systems (roles/grants already
  exist: `exp_control_grants`, `exp_crm_actor`).
- **No side systems.** No external CRM, dialer, CPQ, e-sign, sequencing, commissions or
  hand-off tools; no ETL that runs outside the platform.
- **No restyling / no design-system work.** The final reskin happens once, at the end,
  over a stable product. Do not touch the palette/typography/animation layer now.

## Category integrity (HARD RULE)
Every category seed MUST key off a gcid that exists in `gbp_categories_master.csv`
(Google's official Business Profile category list). NO invented categories — `realtor`,
`family_dentist`, `personal_injury_attorney`, `physical_therapist`, `specialist_physician`
were all hallucinated and removed. Only **real GBP gcids** + **schema.org types**.
Before committing any seed: confirm the gcid is in the master list. If a profession has no
exact GBP category, map it to the nearest real one or do not seed it.

## Identifier contract (HARD RULE — added 2026-07-05 after gcid-prefix defect)
- Platform identifiers are NEVER transformed, re-keyed, abbreviated, or re-namespaced.
  A gcid is stored exactly as gbp_categories stores it ('gcid:xxx'), everywhere, always.
- Before generating ANY table keyed by an existing platform identifier: (1) read the
  canonical table's key format from an existing migration, (2) diff the full key universe
  against the canonical set and reconcile every gap BEFORE loading.
- Verification of a keyed load MUST be a JOIN against the canonical table (match count),
  never an isolated row count. Isolated counts pass while keys are wrong — this exact
  failure shipped the 2026-07-05 defect.

## Documentation discipline (HARD RULE — added 2026-09-24)
- Every change to a database function, table, trigger or `cron.job` entry, and every change to ETL/discovery code (`src/routes/api/public/disco-*.ts` and its helpers), gets an entry in `docs/ETL-Enhancements.md` in the same working session, before the work is reported as done.
- A `-- Fix (...)` comment inside a function is not documentation. Any function carrying a Fix comment must have a matching entry in the doc.
- Each entry states: what triggered it, what was wrong (with the live evidence), what changed (function and file names), what was verified and how, and what is still open.
- When an item from a "Gaps found" list is fixed, the entry names that gap ID explicitly, so the gap lists are never left saying "not fixed" for something that is.
- Append only. Never rewrite or delete earlier entries.


## Build discipline (do not violate)
Category → entity-type → Node Registry (10 rings) → Knowledge Model → Taxonomy →
Compliance → Scoring → AI Config → Schema output → claim/onboard → public pages →
search → connectors → **THEN** listings/reviews/content/VOCE.

- **Listings management stays FROZEN** until target categories have complete node
  registries. `dashboard.listings.tsx` is scaffolded but must not be wired to connectors yet.
- **No per-category code paths.** Every behavior (forms, interview, extraction, scoring,
  copy) is driven by the category's data (`exp_category_shape`, `exp_category_profile_config`,
  `exp_vertical_node_registry`, `exp_taxonomy`, …), so one engine serves all 4,041 categories.

## Non-negotiable compliance (enforce in any AI output / publish path)
- **Real estate** → Fair Housing: no steering by protected class; brokerage name in ads;
  no sale/price guarantees.
- **Mortgage** → RESPA/TILA: no rate guarantees; display NMLS ID.
- All AI-generated content/review-replies/agent output must pass the per-category
  compliance filter (`content_compliance_rules` + `exp_category_compliance`) before publish.

## Data model
49 universal tables in Supabase; category-specific data lives in rows keyed by `gcid`.
Foundation: `exp_category_knowledge`, `exp_vertical_node_registry`, `exp_taxonomy`,
`exp_category_compliance`. Graph: `graph_nodes`, `graph_edges`. Schema output cached in
`schema_cache` (invalidation trigger on graph change). Schema generator: `src/lib/profile-graph.ts`.

## Stack
TanStack Start (React 19) · Tailwind v4 · shadcn/Radix · Supabase · Vite/Bun · Lovable deploy.
