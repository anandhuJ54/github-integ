# Every marketing page editable in the CMS

Goal: no marketing page content lives in React. Each page (`/listings`, `/search-ranking`, and the 11 product/platform pages) renders its sections from `exp_web_pages.body` through one premium section renderer, with `code_rendered = false`, and is fully editable by a non-developer in the console CMS.

Out of scope, untouched: consumer search home, `/find`, location pages, professional profile pages, Trust Center docs behaviour, graph/ring/taxonomy/scoring data. No schema migrations.

## 1. Section vocabulary

One shared vocabulary stored as a JSON array in `exp_web_pages.body`:

| type | what it renders |
| --- | --- |
| `hero` | eyebrow, headline (gold/blue accent span), subhead, CTAs, note, image |
| `feature_grid` | 3-up icon cards |
| `feature_split` | alternating image + checkmark bullet list (the `/listings` capability look) |
| `pillar_band` | dark branded band, intro + 3 pillars |
| `stat_band` | 3–4 big numbers with labels |
| `logo_strip` | customer logos / names |
| `faq` | filterable accordion with categories, emits FAQ JSON-LD |
| `testimonial` | quote, attribution, photo, logo |
| `dual_cta` | two panels ("For Professionals & Locations" vs "For Enterprises") |
| `collection` | linked cards grid |
| `rich_text` | sanitized WYSIWYG HTML |
| `cta` | full-width closing CTA band |

Existing legacy types (`problem`, `product_grid`, `platform_grid`, `pricing`, `logos`) keep rendering so nothing already published breaks.

Field additions to `Block` / `BlockItem` in `src/lib/public-site.ts` (all optional, backward compatible): `image`, `imageAlt`, `accent`, `tone`, `theme`, `icon`, `value`, `label`, `category`, `quote`, `role`, `logo`, `bullets`, `panels`.

## 2. Renderer

New `src/components/marketing/sections/premium/` with one component per type plus `MarketingSections` dispatcher, built in the current `/listings` visual language (light SaaS, blue accent, canon radii 8–10px, chips 6px, no giant pills). `BlockRenderer` in `src/components/public/blocks.tsx` delegates to it so CMS pages, `/product/$slug`, `/platform/$slug` and the canonical routes all share one renderer.

Images: `src/lib/marketing/section-images.ts` resolves a section's `image` value as
1. a key into a registry of the existing bundled assets (`listings/hero-image-v2`, `search-ranking/leaderboard`, …), or
2. an absolute/uploaded URL.

Uploads go to a public storage bucket `marketing-images`; the registry keeps current page imagery available without re-uploading.

## 3. Convert the two hardcoded pages

Extract the exact current copy and imagery of `/listings` and `/search-ranking` (hero, strategic banner, capability stack, enterprise grid, overview split, FAQ) into `body` section arrays, then point the routes at the CMS.

- Copy and images are preserved verbatim; layout is reproduced by the equivalent premium section, so the pages look the same rather than being pixel-diffed against the old bespoke components.
- Existing SEO meta stays: `seo_title` / `seo_desc` plus per-page canonical/OG values are written into the CMS row so `head()` reads from data.
- Routes become thin loaders; `code_rendered` set to `false`. The bespoke `sections/listings/*` and `sections/search-ranking/*` components are removed once the pages render from data.

## 4. Upgrade the 11 orphan pages

`enterprise-xmp`, `brandiva`, `voce`, `search-rank-platform`, `competitor-analytics`, `convert-agents`, `multi-post`, `network`, `nora`, `reviews`, `voce-articles`.

Their real per-product copy currently sits in `src/lib/marketing/business-pages.ts`. That copy (hero, benefits, pillar band, three feature splits with their images, FAQs) is written into each page's `body` as structured sections, extended with a `dual_cta`, `stat_band` where the page has real numbers, and the filterable FAQ. Routes switch from `BusinessRoutePage` to the CMS loader + renderer; `business-page.tsx` / `business-pages.ts` are deleted after the content is in the database.

No invented facts: only copy that already exists in the repo is migrated. Anything a page lacks is simply absent (sections render only when data exists).

## 5. CMS editor — full coverage

Rewrite `src/components/website/block-editor.tsx` as a section editor used by the existing Website → CMS drawer:

- Section list: drag-to-reorder (native HTML5 DnD), duplicate, delete, collapse/expand, add-section picker showing every type with a plain-language name and description.
- Per-type field UI driven by one schema table, so every type above has an editor: text fields, textareas, rich text, repeatable items (title/body/eyebrow/href/question/answer/value/label/quote/role/price/note), bullet lists, CTA rows (label + href + variant), dual-CTA panels, tone/theme selects, icon picker, image field with registry picker + file upload + replace/remove.
- Page settings in the same drawer: title, slug, page type, `seo_title`, `seo_desc`, publish/unpublish status.
- Live preview: the drawer's preview pane renders the in-progress body through the real `MarketingSections` renderer.

A coverage check lists each section type against its editor entry so 100% of the vocabulary is confirmed editable.

## 6. Content writes

Body/SEO content for the 13 pages is written with data `UPDATE`s against `exp_web_pages` (content, not schema — no migrations). Governed `exp_*` model tables, graph, rings, taxonomy and scoring are untouched.

## 7. Verification

- Query `slug, code_rendered` for all marketing pages and confirm every one is `false`.
- Load each converted route and confirm 200 + rendered sections; screenshot `/listings`, `/search-ranking` and two orphan pages at desktop and mobile.
- Confirm `/`, `/find` and a real professional profile are unchanged.
- Typecheck.

---

# Phase 2 — graph-powered professional profile at `/p/$slug`

Separate work, same approval. Consumer surface, warm editorial (dusk navy hero, gold accent, serif headlines, tight radii). Read-only: no graph/taxonomy/scoring writes, no migrations.

## Data source
Every section is built from `graph_nodes` for the entity (`entity_type='professional'`, `entity_id`, `is_active`), grouped by `ring_key`, plus the `professionals` / `organizations` base row, `aggregate_ratings`, `search_rank_scores` and `exp_voce_article` (`author_entity_id`). Node `schema_property` / `extracted_data` drive both the UI and the JSON-LD projection.

## Sections (each renders only when its nodes exist)
- Header: cover (`image_cover`), avatar (`image_photo`), name, title/brand, Verified badge from `claimed`, rating + review count, "Top X%" only when a real score exists, location chip from address/geo nodes, years of experience when present. CTAs from nodes: Call, Website, Directions, plus Save/Share.
- Experience Score card: the entity's rank score labelled **Provisional** with an info tooltip, plus per-ring sub-scores (Reviews, Presence, Local Authority, Content, Credentials, Engagement) derived from node coverage per ring, and a "How the score works" explainer.
- About + quick facts: bio/about nodes; facts from credential, years, specialization, area-served, language nodes.
- Services / Products: `product_service` nodes as a grid.
- My Network → Team: team-member nodes rendered non-clickable.
- Reviews: aggregate rating, count and source now; an honest "Detailed reviews coming soon" state — no fabricated review text.
- Guides & Articles: real `exp_voce_article` rows authored by the entity.
- Contact panel: phone, office hours with open-now status, address + map, website.
- Social profiles and disclosures.

## SEO
Breadcrumbs (Home › Category › State › City › Name) with `BreadcrumbList`, and Person/LocalBusiness JSON-LD projected from node `schema_property` values (name, telephone, address, geo, makesOffer, knowsLanguage, hasCredential, sameAs).

## Verification
Load a fully nodalized State Farm agent (`sf-*`, e.g. Tyler Hopkins) and Damon Priddy (has a linked VOCE article); confirm sections with no nodes are absent, the score reads Provisional, and there are no console errors. Name the exact `graph_nodes` query used.
