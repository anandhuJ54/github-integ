# Definitive shared consumer search experience

## Goal
Rebuild the public home and `/find` around one shared warm-editorial search experience while preserving all existing read-only search, location, advertising, and profile-link behavior. This request is treated as Scott's explicit exception to the repository's temporary no-restyling rule.

## What will change

### Shared navigation and search hero
- Update the shared public header to the requested tabs: All, Professionals, Businesses, Guides & Q&A, Topics; retain the existing For Business mega-menu, Sign In, and Get Started actions.
- Build one reusable hero/search component for both `/` and `/find`.
- Use the existing dusk skyline asset, dark left overlay, serif headline, gold query term, rotating natural-language prompt, clear action, and the existing persisted/IP-detected area picker inside the search bar.
- Generate category shortcuts from real top-category data, using only canonical GBP GCIDs; labels without an exact live category match will gracefully use the nearest real category-backed shortcut or be omitted.

### Shared discovery and results
- Build shared collection, result-card, filter-rail, related-search, map, and AI-assistant components used by home and `/find`.
- Home will show the default live search state; `/find` will show the same system with URL query/filter state.
- Keep the current ZIP/city grouping fallback when coordinates are unavailable and preserve list/map selection and “Search this area.”
- Keep sponsored and featured content already served on `/find` without changing its data rules.

### Live category-aware facets
- Read facet definitions from `exp_search_facets_v`, filtered by the active canonical GCID, and group them by the live `facet_group` values.
- Use the existing `search_docs_facets()` output for result counts and currently actionable filters (category, city, rating, ownership).
- Render ontology-defined groups as honest informational/disabled controls where indexed entity attribute values are not yet available; never invent option counts or claim a filter changed results when it cannot.
- Preserve the existing query parameters and add only browser-visible filter state that has a real search input behind it.

### Rich live result presentation
- Continue sourcing ranked result identity, location, rating, review count, claim state, score, photo, and coordinates from `search_docs()` / `search_documents`.
- Load real review excerpts from `reviews` by matching result entity type and ID; omit the excerpt when none exists.
- Surface only real attribute tags that can be resolved from graph node values mapped through `exp_registry_attribute_map` and `exp_search_facets_v`; omit price, distance, cuisine, or other fields when the live data does not provide them.
- Number cards and map markers consistently, highlight matching cards/pins, mark only the first organic result as “Top Match,” and keep image fallbacks.

### Collections and related searches
- Derive collection links and related-search chips from live categories, active location, and available facet labels rather than hardcoded result data.
- Use generated local category imagery for the requested visual collection cards, with a neutral fallback when a category has no matching image.

### AI assistant stub
- Add one lightweight TanStack server endpoint that validates the submitted question and returns a clearly labeled `AI answers coming soon` response.
- The ordinary search path will never call AI, and the assistant will not fabricate recommendations.

## Technical details
- No migrations and no writes to graph, ring, taxonomy, scoring, or governed `exp_*` model tables.
- New server reads use a publishable backend client and existing public/RLS-visible data only.
- Shared components will replace the duplicated home-only and `/find` search/result presentation while retaining the current `runSearch`, location persistence, and query URL behavior.
- The existing CSS-grid map remains the live coordinate view for now; it will use numbered markers and retain its location grouping fallback. A third-party map integration is not introduced.
- Apply the consumer palette through existing semantic/search tokens and tight 6–10px radii; true avatar and icon circles remain circular.

## Verification
- Verify `/` and `/find` at desktop, tablet, and mobile sizes with no overflow or browser errors.
- Verify search submission, clear, location change/persistence, shortcuts, collections, filters, related searches, list/map toggle, card/pin highlighting, profile links, and empty states.
- Verify at least one real category (restaurant when available) against `exp_search_facets_v`, and confirm no fabricated quote, attribute, price, distance, or image appears.
- Verify the assistant response is explicitly labeled as coming soon and that normal search makes no AI request.
