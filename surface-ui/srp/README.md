# SRP — Locations & Professionals — web (React SPA)

React 19 + Vite + Tailwind + shadcn/Radix. Import shared components from `@v3/shared`
(= `surface-ui/shared`). Call this Surface's API via the client generated from `contracts/srp`.

Editing and creating only (surface audit 2026-10-25, `docs/SURFACE_AUDIT.md` §5): the claim page
`/claim/$professional` (`/srp/claim-profile/{slug}`); the seat area `/seat/$kind/$id/*` (a
location's or professional's own pages, incl. the NORA interview) and the pro dashboard
`/dashboard/*`, moved from xmp (§9) with their API (`/srp/seat/*`, `/srp/interview/*`,
`/srp/dashboard/*`, `/srp/rpc/exp_office_mode`); the review-reply functions (`/srp/fn/*`), called
from the dashboard Reviews page. The public serving pages (profiles, `/find`, topics,
Trust Center) moved to `surface-ui/search` at the same URLs.
