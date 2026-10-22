# City-scoped consumer home at "/"

Rebuild `/` as an area-aware discovery + search page: detect the visitor's city, state and local time, then build every section around them. Warm editorial canon (dusk photo hero, gold accent, serif headlines, tight radii), render-if-data, live reads only, no data-model changes.

## What the page becomes

**Hero (~50vh, brightened, no eyebrow)**
- Serif headline + one-line subhead.
- One natural-language search box; rotating placeholders use the detected city: "best tacos in Chicago", "realtor who speaks Mandarin in Chicago", "pediatric dentist open Saturday in Chicago".
- Prominent location control: a larger pill "📍 Chicago, IL · Change" that opens the existing choose-area popover (IP default, popular nearby cities, manual entry, opt-in precise location).
- "Try asking:" intent chips, each running that phrase as a search.

**"What's happening in {City}, {ST}"** — title carries its own Change-city control. Five image cards: Great Places to Eat Near You · Top-Rated Experts · Trusted Home Services · Things to Do This {Weekend|Week} (chosen from the visitor's local day) · Local Guides & Answers for {City}. Each card only renders when its underlying live data exists.

**Left column (2/3) — "{City}, {ST} — Everything"**
- All profiles in the detected city/state, 10 per page, sorted by Search Rank Score then graph node count — never grouped by business type.
- Sponsored block above the organic list, up to 3, clearly labelled "Sponsored" with a distinct tinted card. Today the sponsored table holds a single demo buy (Palo Alto, mortgage), so in most cities this block is simply hidden rather than filled with organic results dressed as ads.
- Collapsible filter panel (category, rating, ownership, plus category-aware facet groups) on the left of the list.
- One house ad at position 6 of every page, same card dimensions as a result, randomly one of the four: smarter search, write a review, claim your business in {City}, or change intent (five tappable path cards that re-scope results).
- Tight SEO link block at the bottom: local guides for {City}, top categories in {City}, nearby cities, popular searches in {City}, recent content — all dynamic.

**Right column (1/3)**
1. Map search: coordinate map centred on the city, pins coloured by business type, pan/zoom, pin click → mini detail popover linking to the profile, and "Expand map" which turns the page into a full-width map experience.
2. Ask Experience: "Let's talk about {City}, {ST}" question box posting to the single existing lightweight endpoint. Until an AI method is connected it shows the clearly-labelled "AI answers coming soon" state — never invented answers.
3. "{City}, {ST} articles" from the VOCE article feed, scoped to authors indexed in that city; graceful empty state.
4. "What is Experience.com" explainer card.

## Technical notes

- `src/lib/geo.server.ts`: also return `timezone` (edge header `cf-timezone` / IP lookup) and derive the visitor's local weekday so the "this weekend/this week" label is real.
- New `src/lib/city-home.functions.ts` (public server functions, publishable-key client):
  - `getCityHome({ city, state, page, gcid, rating, claimed })` → paged rows from `search_docs`/`search_docs_count` scoped by location, re-sorted by `rank_score` then a node-count map from `graph_nodes`, plus facets from `search_docs_facets`.
  - sponsored: read `exp_sponsored_slots` (active, in-window, incl. `is_demo`) whose `geo_value` matches the city's ZIPs/state and join to `search_documents`; empty array hides the block.
  - collections/SEO/articles/nearby cities: `search_docs_facets`, `content_items`, `exp_voce_article` joined to `search_documents` on author entity for the city.
- New components: `src/components/public/city-home.tsx` (page composition), `city-results.tsx` (list, pagination, sponsored, house ads, filters), `city-map.tsx` (pan/zoom pins, popover, expand), `city-aside.tsx` (ask/articles/explainer). `/` route loader gains the city payload; hero updates land in `home-hero.tsx`.
- Everything read-only: no migrations, no writes to `graph_*`, `exp_ring*`, taxonomy or scoring. `/find` untouched.

## Honest-data callouts

- Search Rank Score stays provisional and is shown as-is; nothing is invented.
- Sponsored appears only where a real slot exists; house ads are clearly our own promos, visually distinct from results.
- AI answers show the "coming soon" state until a method is wired.
