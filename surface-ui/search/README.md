# Online Search — web (React SPA)

React 19 + Vite + Tailwind + shadcn/Radix. Import shared components from `@v3/shared`
(= `surface-ui/shared`). Call this Surface's API via the client generated from `contracts/search`.

The public serving pages, moved here from `surface-ui/srp` by surface audit 2026-10-25
(ruling in `docs/SURFACE_AUDIT.md` §5), at the same URLs:

- profiles `/p/$slug`, `/o/$slug`, `/c/$slug`; consumer search `/find`
- topics `/topics`, `/topic/$gcid`, `/topic/$gcid/$topic`
- Trust Center `/trust`, `/trust/$slug`

Their API is `surface-api/search` (`/search/profile/*`, `/search/category-label/*`,
`/search/sponsored-slots`, `/search/ad-units`, `/search/page-view`, `/search/geo/*`,
`/search/fn/*`, plus `/public/sitemap*` and `/robots.txt`). `/topics` also reads
`getHomeData`, which is in the marketing Surface (`/marketing/fn/getHomeData`).

The search console pages (`/search`, `/search/indexing`, `/search/sponsored`, `/search/ads`,
`/search/voce`) are in `surface-ui/admin` (surface audit 2026-10-25, §3).
