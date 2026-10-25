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
- **Everything under Growth Hub (`/sales/...`) belongs to sales** (ruling 2026-10-25).
- **Demand engine (`/website/...`: CMS, Leads, Campaigns, Ads, Demo Center, Trust Center, Cookie
  Consent, Alerts, Developers) goes to marketing** (ruling 2026-10-25); it lives in xmp today.
  Same as above: confirmed case by case during the audit.

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
| 3 | PLG rules (upgrade nudges per category; shown on the professional's `/dashboard`) | `/emp/plg-rules`, not in any menu | `/conversion-agents/plg-rules/*` | Move to **admin** (2026-10-25); menu link Admin → "PLG rules" |
| 4a | Card actions + related searches (city results on the site home) | `/` | `/conversion_agents/fn/getCardActions`, `getRelatedSearches` | Move to **search** (online search) (2026-10-25) |
| 4b | Compare (the compare tray on public pages) | profile pages, e.g. `/p/$slug` | `/conversion_agents/fn/getCompareEntities` | Move to **search** (online search) (2026-10-25) |
| 5 | Site proposal preview/accept | `/discovery` (Source Registry and Category Population tabs), not in any menu | `/conversion_agents/fn/previewSiteProposal`, `acceptSiteProposal` | Move to **etl** (its root page is etl's `/discovery`) (2026-10-25) |
| 6 | "Sign in with Lovable" helper | the claim page | — | Goes with the claim page: **srp** |

**Done 2026-10-25.** New API paths: `/srp/claim-profile/{slug}`, `/admin/claims/*`, `/admin/plg-rules/*`, `/search/fn/getCardActions|getCompareEntities|getRelatedSearches`, `/etl/fn/previewSiteProposal|acceptSiteProposal`. conversion-agents now holds only its health router (empty, pending a decision, O10/O13); its UI app is out of the composed app.

`/emp/plg-rules` and `/discovery` had no link anywhere (also not in the original app); both, plus `/claims`, get links in the **Admin** menu for now (2026-10-25; can move later). All UI URLs stay the same; only code location and API paths change.

## 3. search

| # | Item | UI URL | API (today) | Decision |
|---|---|---|---|---|
| 1–5 | Search console: Overview (metrics), Indexing (incl. the site-indexing switch), Sponsored (rate card + slots), Ads, VOCE boosts | `/search`, `/search/indexing`, `/search/sponsored`, `/search/ads`, `/search/voce` | `/search/console/*`, `/search/fn/setSiteIndexing`, `PATCH /search/voce/articles` | Move to **admin** (admin-only tools) (2026-10-25). **Done**: pages in `surface-ui/admin`, API `/admin/search-console/*`, `/admin/fn/setSiteIndexing`, `PATCH /admin/search-console/voce/articles/{id}`. URLs and menu unchanged; rename later. surface-ui/search is API-only now |
| 6–9 | Public search (results, suggest), VOCE article reads, results presentation, site-indexing flag read | used on `/find`, `/voce`, every page | `/search/public/*`, `/search/voce/*` reads, `/search/fn/getSearchPresentation`, `getSiteIndexing` | Stay in **search** |
| + | Card actions, compare, related searches (from conversion-agents) | `/`, profile pages | `/search/fn/*` | In **search** (done) |
| 10 | Search assistant ("coming soon" placeholder) | the `/find` search box | `/search-assistant` | Keep in **search** (online search) (2026-10-25) |

## 4. admin

| # | Item | UI URL | Decision |
|---|---|---|---|
| 1, 2 | Professionals and Organizations browsers | `/professionals`, `/organizations` | Keep in **admin** (staff-only lists) (2026-10-25) |
| 3 | Compliance | `/compliance` | Keep in admin |
| 4 | Users & Access | `/admin/users` | Keep in admin |
| 5 | Integrations (incl. the "run alert engine now" button, which triggers sales tick functions, SF-10) | `/admin/integrations` | Keep in admin |
| 6 | Billing (reads sales data) | `/billing` | Keep in **admin** (2026-10-25) |
| 7 | Support | `/support` | Keep in admin |
| 8 | `/products` (retired, redirects to `/sales/price-book`) | `/products` | Keep the redirect (2026-10-25) |
| 9 | "Who am I" (`/admin/me/*`, used by every console page) | — | Keep in admin |
| 10 | Google Workspace **Send email**, **Schedule meeting**, **Book demo** buttons (on the sales opportunity page; code in admin `google_workspace_fn.py`) | `/sales/opportunities/$oppId` | Move to **sales** (2026-10-25; Growth Hub). Only the opportunity functions move (send email, schedule meeting, and the delivery-status check the dialogs use); Google connect, domain verification and the outbox ("Send queued") stay with `/admin/integrations` (outbox confirmed admin, 2026-10-25). **Done**: `/sales/fn/getGoogleDeliveryStatus`, `sendOpportunityEmail`, `scheduleOpportunityMeeting` |
| 11 | Staging keys (used only by etl `/discovery` → Field Yield) | `/discovery` | Keep in **admin** (2026-10-25) |
| + | Arriving: claims queue, PLG rules (done), search console pages (pending) | `/claims`, `/emp/plg-rules`, `/search/*` | — |

## Decisions noted ahead (to apply when that Surface is audited)

| Surface | Item | UI URL | Decision |
|---|---|---|---|
| xmp | The whole seat area: a professional's or location's own pages (My Profile, Expertise Graph, Reviews, Nora, Team, Listings, Multi-Post, Reporting, NORA interview), `xmp/src/routes/_authenticated/seat.*` and their libs and API (`/xmp/...` seat endpoints) | `/seat/$kind/$id/...` | Move to **srp** (standing rule, 2026-10-25) |
