# New Surfaces: what may move into them

Integrations (14), Reports (15) and Listings (16) exist as empty scaffolds (2026-10-26):
`surface-api/<s>`, `surface-ui/<s>`, `contracts/<s>`, `surface-spec/<s>`, with only `/<s>/hello` and
`/<s>/me`. **Nothing has moved yet.** This page lists what exists today in other Surfaces and a
suggestion for each. Rows marked *Decide* need a ruling before anything moves; some reverse
rulings of the surface audit (2026-10-25, `docs/SURFACE_AUDIT.md`).

How to move (same as the audit): one item at a time; keep every URL (redirect if a page URL
changes); move the API resource folder into `<s>/src/<resource>/` and its tests into `<s>/tests/`;
check the route table and that Surface's OpenAPI are unchanged, run `uv run pytest`, the UI
typecheck and the parity suite of every Surface touched; regenerate `contracts/<s>/openapi.json`.

## Integrations (14)

| What | API today | UI today | Suggestion |
|---|---|---|---|
| Google connect, OAuth callback, outbox send, domain verification | admin `integration/` (`/admin/fn/startGoogleConnect`, `dispatchGoogleOutbox`, `startDomainVerification`, `checkDomainVerification`, `/public/google-oauth-callback`) | admin `/admin/integrations`; `admin/src/lib/integrations*.ts`, `google-workspace.functions.ts` | Move (audit had ruled admin, before this Surface existed) |
| NORA integration settings | admin `/admin/fn/getNoraIntegrations`, `updateNoraIntegration` | same admin page | Move, with the above |
| Shared integration code (catalog, status, Google client) | `_base/integrations/` (used by admin, sales, nora_os) | — | Move; publish what sales and nora_os need through `integrations/src/exports.py` |
| Sales email delivery status | sales `google_workspace/` (`/sales/fn/getGoogleDeliveryStatus`) | `sales/src/lib/google-workspace.functions.ts` | Stay in sales (sales uses an integration) |
| NORA integration adapter | `nora_os/src/nora/integrations_adapter.py`, `organize/integrations.py` | `srp/src/lib/nora/organize/integrations.ts` | Stay (the engine reads integrations) |

## Reports (15)

| What | API today | UI today | Suggestion |
|---|---|---|---|
| Console reports | admin console (`console-surfaces`) | `/reports` (admin) | Move (audit had ruled admin: admin-only metrics) |
| Platform report metrics | etl `/etl/platform/report-metrics` | — | Decide (an ETL pipeline metric) |
| Seat reporting tab | srp `seat/` | `/seat/:kind/:id/reporting` | Stay in srp (a tab of the seat) |
| Enterprise reporting tab | xmp `enterprise/` | `/enterprise/:org/reporting` | Stay in xmp (a tab of the enterprise console) |
| Dev weekly report | ops `dev_weekly/` (`/public/dev-weekly-*`, `/ops/dev/weekly*`) | ops `build.weekly`, `dev.weekly` | Stay in ops (internal dev tracking) |

## Listings (16): reviews, listings, social posts

| What | API today | UI today | Suggestion |
|---|---|---|---|
| Review replies (draft, save, flag), reviews dashboard | srp `review/` (`/srp/fn/draftReviewReply`, `saveReviewReply`, `flagReview`), `/srp/dashboard/reviews` | `/dashboard/reviews`, `/seat/:kind/:id/reviews`; `srp/src/lib/reviews.functions.ts` | Decide (audit rule: editing by a pro or location → srp) |
| Listings dashboard, seat listings | srp `/srp/dashboard/listings`, `/srp/seat/listings` | `/dashboard/listings`, `/seat/:kind/:id/listings`; `srp/src/lib/listings/subject.ts` | Decide; needs the O6 ruling |
| Listings catalog (publishers, field map) | graph `/graph/categories/listings`, `/graph/categories/listings/catalog` | graph listings tab; `graph/src/lib/listings/*` | Decide; needs the O6 ruling |
| Enterprise reviews tab | xmp `enterprise/` | `/enterprise/:org/reviews` | Stay in xmp (a tab of the enterprise console) |
| Review request campaigns | campaigns `review_campaign/` | campaigns pages | Stay (audit ruling: campaigns) |
| Marketing pages `/reviews`, `/reviews-management`, `/listings`, `/social` | — | marketing pages and sections | Stay (company website product pages) |
| Social posts | none | marketing page only | New build later |
| Listings tooling and tables | `tools/listings/`, migration `0026_listings_catalog_db` | — | Stay (migrations don't move; batch tools) |

## Open decisions touched
- **O6 (listings)**: every listings move above needs it first (root `AGENTS.md` §5).
- Adding these Surfaces is a shared-core change: second approval required.
