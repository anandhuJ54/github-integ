# Consumer home search-first redesign

Rework only the public home presentation and its existing read-only home data. Preserve all search, location, graph, taxonomy, scoring, and category architecture.

## Home hero

- Remove the competing value panel and center the hero around one oversized search control.
- Keep only the slim site navigation, city-at-dusk image with stronger dark overlay, gold eyebrow, concise serif headline, one-line supporting copy, search box, persisted area picker, current intent-query chips, live authority line, and scroll cue.
- Add an accessible rotating placeholder cycling the supplied intent examples every 2.5 seconds, pausing once the visitor types; autofocus the field after hydration.
- Keep the search as a crawlable GET form to `/find` and preserve the existing chosen-area behavior.

## Live authority count

- Derive the displayed total from the existing `search_docs_facets()` response used by the home loader.
- Sum its real entity-type counts once in the loader and format the value with commas in the hero; render no invented fallback count.

## Discovery below the fold

- Preserve the live nearby results, map, List/Map toggle, and “Search this area” behavior.
- Preserve the live category exploration grid.
- Move the six proof points into a slim trust strip below discovery.
- Add compact Guides & Q&A and Topics teasers from the existing live `content_items` and `exp_voce_article` reads, with honest empty states and links to their existing pages.
- Remove the redundant visual-search section so the requested discovery hierarchy remains focused.

## Verification

- Check desktop, tablet, and mobile layouts for first-viewport focus, overflow, and interaction.
- Verify placeholder rotation, query-chip navigation, area picker, List/Map toggle, live authority count, and absence of browser errors.
