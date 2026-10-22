# Dense, results-forward consumer home

Rework only `/` and its existing read-only presentation. Preserve `/find`, all search/index data contracts, and the governed graph, taxonomy, and scoring layers.

## Compact search header
- Reduce the dusk-photo header to roughly half a desktop viewport, with tighter spacing and responsive minimum height rather than full-screen behavior.
- Keep the gold eyebrow, serif headline, one-line supporting copy, dominant natural-language search, rotating examples, location control, intent prompts, and live authority count within the compact area.
- Show the detected or remembered city as a clear map-pin chip below the search box with a separate **Change** action opening the existing nearby-city/manual/precise-location popover.
- Remove the weak empty-location wording; when coarse detection is unavailable, keep search optional and expose the same area chooser through a neutral location chip.
- Submit the untouched natural-language query to `/find`; use the chosen/detected area as `loc`, while location phrases inside the query remain available to the existing search interpretation.

## Immediate discovery
- Place a dense shortcut strip directly below the photo using real indexed categories matched to the requested labels; hide shortcuts whose canonical category is unavailable, and keep **More** as the route to all search.
- Add the dark rotating “Try searching naturally” card immediately below the shortcuts.
- Restore the five image-led collections, deriving category and city labels and links from live home data.
- Follow with a compact preview of four ranked live results beside the existing numbered-pin map; remove the full home facet rail because full filtering remains on `/find`.
- Retain the live category exploration and trust strip farther down the page.

## Technical details
- Continue using `search_docs_facets()` for the authority count and indexed category shortcuts.
- Continue using `search_docs` / `search_documents` for ranked home results, including provisional `rank_score`, coordinates, and result metadata.
- Reuse the current IP-derived area state, persisted visitor choice, nearby indexed areas, manual area entry, and opt-in precise location flow.
- No database writes or migrations.

## Verification
- Check `/` at desktop and mobile widths for compact header height, visible discovery content, overflow, rotating text, area popover, shortcuts, collection links, four-card preview, and map pins.
- Confirm search submissions include `q` and the detected/chosen `loc`, `/find` source remains unchanged, and the browser console is clean.
