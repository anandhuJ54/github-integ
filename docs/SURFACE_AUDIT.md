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
- **Serving vs editing** (ruling 2026-10-25): every public page a visitor sees and reads (the
  serving pages) belongs to **search**; editing, updating and creating (a professional or location
  managing its own data) belongs to **srp**.
- **The API lives with the Surface that owns the data** (ruling 2026-10-25). Another Surface's
  page uses it only through that Surface's published contract (`contracts/<owner>/`, a
  capability entry), never informally. No code moves for this; each cross-Surface use is listed
  in "Published cross-Surface APIs" below and gets a contract entry.
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

## 5. srp

Under the serving-vs-editing rule:

| # | Item | UI URL / API | Decision (2026-10-25) |
|---|---|---|---|
| 1, 2 | Professional, office and company profiles | `/p/$slug`, `/o/$slug`, `/c/$slug`; `/srp/profile/*`, `/srp/category-label/*`, `/srp/sponsored-slots`, `/srp/ad-units`, `/srp/page-view` | Move to **search** (serving). **Done**: pages in `surface-ui/search`; API `/search/profile/*`, `/search/category-label/*`, `/search/sponsored-slots`, `/search/ad-units`, `/search/page-view` |
| 3 | Consumer search results | `/find` | Move to **search**. **Done** |
| 4, 5 | Topic index and topic hubs | `/topics`, `/topic/$gcid`, `/topic/$gcid/$topic` | Move to **search** (serving). **Done**; `/topics` reads `/marketing/fn/getHomeData` |
| 6 | Trust Center (public) | `/trust`, `/trust/$slug`; `/srp/fn/getPublicTrustDocs`, `getPublicPage` | Move to **search** (serving). **Done**: `/search/fn/getPublicTrustDocs`, `getPublicPage` (also read by three marketing pages) |
| 7 | Claim page | `/claim/$professional`; `/srp/claim-profile/{slug}` | Stays in **srp** (creating/updating) |
| 8, 9 | City home data and map pins; CMS page reads for marketing pages | `/srp/fn/getCityHome`, `getCityMapPins`, `getHomeData`, `getPublicPageBySlug`, `getPublicHome` | Move to **marketing** (marketing gets its own API). **Done**: `/marketing/fn/*` |
| 10 | Review reply: draft (AI), compliance check, save, flag | `/srp/fn/draftReviewReply`, `checkReplyCompliance`, `saveReviewReply`, `flagReview` (used by xmp seat Reviews) | Stays in **srp** (editing) |
| 11 | Sitemap and robots.txt | `/public/sitemap.xml`, `/public/sitemap/{partition}`, `/robots.txt` | Move to **search** (serving). **Done**: same paths; uses search's site-indexing flag reader |
| 12 | Area detection, nearby areas, city centroids | `/srp/fn/getDetectedArea`, `getNearbyAreas`, `resolveAreaFromCoords`, `/srp/geo/city-centroids` | Move to **search** (serving). **Done**: `/search/fn/*`, `/search/geo/city-centroids` |

## 6. ops

| # | Item | UI URL | Decision (2026-10-25) |
|---|---|---|---|
| 1 | Console home (super-admin metrics: profiles, revenue, categories, NORA events) | `/console` | Move to **admin**. **Done**: API `/admin/console/*` |
| 2 | Reports (metrics; reads etl) | `/reports` | Move to **admin**. **Done** (still reads `/etl/platform/report-metrics`, published) |
| 3 | SRP Dev Progress (tracker: overview, board, priorities, teams, weekly) | `/dev/*` | Keep in **ops** |
| 4 | Build (the same pages again, plus teams) and the Build wiki | `/build/*`, `/build/spaces/*` | Keep in **ops**; keep both `/dev` and `/build` for now |
| 5 | Weekly-update reminder and digest emails (Resend; not scheduled) | — | Keep in ops |

## 7. etl

| # | Item | UI URL / API | Decision (2026-10-25) |
|---|---|---|---|
| 1 | Discovery console (9 tabs; metrics and job actions) | `/discovery`; `/etl/console/*` | Keep in **etl** |
| 2 | Background workers | `/public/disco-*`, `/public/etl-deep-hydrate`, `/public/export-prompt-bundles` | Keep in etl |
| 3 | Metrics behind admin pages and Run health | `/etl/platform/report-metrics`, `org-stats`, `pipeline-health`, `/etl/run-monitor` | Keep in **etl** (data owner); admin/NORA OS pages use them through a published `contracts/etl` capability (2026-10-25) |
| 4 | Category boundary panel on `/discovery` | `/graph/fn/getCategoryBoundary`, `regenerateCategoryBoundary` | API stays in **graph**; etl uses it through a published `contracts/graph` capability (2026-10-25) |

## 8. graph

| # | Item | UI URL | Decision (2026-10-25) |
|---|---|---|---|
| 1, 2 | Category list and category detail (9 tabs) | `/categories`, `/categories/$gcid` | Keep in graph |
| 3 | Control graph (health, control tree, entities, claims tab) | `/control-graph` | Control Tree and Entities stay in graph. **Claims tab → admin** (2026-10-25): shown as a second tab on `/claims`; its endpoints (`/graph/control/claims`, `entities-lite`, `users`, RPC `exp_claim_adjudicate`) move to admin. **Done**: `/admin/control-claims*` |
| 4 | Long-form professional profile | `/:category/:city/:professional` | Page → **search** (2026-10-25, **done**); API `/graph/profile/*`, `/graph/profile-services`, schema-cache fns stay in **graph**, published |
| 5 | Expertise graph pages | `/p|o|c/$slug/graph` | Page → **search** (public serving page, **done**); the API `/graph/expertise/*` stays in **graph** and is published for search |
| 6 | Category brief (graph copy used by xmp; nora-os has its own copy) | — | Keep both for now |

## 9. xmp

| # | Area | UI URLs | Decision (2026-10-25) |
|---|---|---|---|
| A | Enterprise console | `/enterprise/$orgSlug/*` | Stays in **xmp**, except **review campaigns** (`/enterprise/$orgSlug/campaigns`, `/xmp/enterprise/orgs/{slug}/campaigns*`) → **campaigns** |
| B | Seat (one pro or location) | `/seat/$kind/$id/*` | Open (URLs shared) |
| C | Pro dashboard | `/dashboard/*` | Open (URLs shared). Note: empty for everyone today, no professional is linked to a login |
| D | Demand engine | `/website/*`; API `/xmp/website/*`; `_base` nav-menus | Move to **marketing** |

## Published cross-Surface APIs (to add as contract entries)

| Owner | API | Used by (page) |
|---|---|---|
| etl | `/etl/platform/report-metrics` | admin `/console`, `/reports` |
| etl | `/etl/platform/org-stats` | admin `/organizations`, `/support` |
| etl | `/etl/platform/pipeline-health`, `/etl/run-monitor` | `/run-health` (NORA OS menu; route in etl) |
| graph | `/graph/fn/getCategoryBoundary`, `regenerateCategoryBoundary` | etl `/discovery` |
| marketing | `/marketing/fn/getHomeData` | search `/topics` |
| search | `/search/fn/getPublicPage` | marketing CMS pages (`/platform/$slug`, `/product/$slug`, landing example) |
| srp | `/srp/fn/draftReviewReply`, `checkReplyCompliance`, `saveReviewReply`, `flagReview` | xmp seat Reviews (`/seat/.../reviews`) |
| graph | `/graph/expertise/{kind}/{slug}` | search expertise graph pages `/p|o|c/$slug/graph` |
| graph | `/graph/fn/getCategoryBrief` | xmp |
| graph | `/graph/profile/{slug}`, `/graph/profile-services`, `/graph/fn/getCachedSchema`, `cacheSchema` | search long-form profile `/:category/:city/:professional` |
| nora-os | `/nora_os/fn/runSkill` | skills `/skills` sandbox, xmp seat interview |
| nora-os | `/nora_os/fn/submitClaim`, `verifyClaimCode`, `releaseClaim` | srp `/claim/$professional` |
| admin | `/admin/me/*` (who am I, grants, audit) | every console page |
| sales | `/sales/catalog/billing` | admin `/billing` |
| sales | `/sales/territories/slots/{id}/label` | admin `/professionals` (territory chip) |
| sales | `/sales/alerts/*` | admin `/admin/integrations` ("run now") |
| search | public search, VOCE reads, presentation, area detection | marketing pages, `_base` public chrome |

## Decisions noted ahead (to apply when that Surface is audited)

| Surface | Item | UI URL | Decision |
|---|---|---|---|
| xmp | The whole seat area: a professional's or location's own pages (My Profile, Expertise Graph, Reviews, Nora, Team, Listings, Multi-Post, Reporting, NORA interview), `xmp/src/routes/_authenticated/seat.*` and their libs and API (`/xmp/...` seat endpoints) | `/seat/$kind/$id/...` | Move to **srp** (standing rule, 2026-10-25) |
