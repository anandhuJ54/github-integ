# Surface 16-listings — Listings · CONTEXT

Scaffold only (2026-10-26): the four homes exist and the base `/listings/hello` + `/listings/me` routes are
mounted; no pages, resources or tables yet.
(Fill in: purpose, owned tables, published capabilities/events, open questions.)

Intended scope: reviews, listings and social posts.

## Open decisions
- **O6 (listings)**: open (root `AGENTS.md` §5). The Surface's name and empty scaffold decide nothing;
  moving or adding listings code here (today in etl, graph and xmp, plus the publisher tables of
  `surface-api/migrations/0026_listings_catalog_db.sql`) needs the O6 ruling first.
- Reviews: review replies live in srp today (`surface-api/srp/src/review/`); moving them is a separate decision.

What may move here from other Surfaces: `docs/NEW_SURFACES_MOVES.md` (nothing moved yet).
