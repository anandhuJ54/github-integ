# SRP — Locations & Professionals — web (React SPA)

React 19 + Vite + Tailwind + shadcn/Radix. Import shared components from `@v3/ui`
(= `surface-ui/_base`). Call this Surface's API via the client generated from `contracts/srp`.

Editing and creating only (surface audit 2026-10-25, `docs/SURFACE_AUDIT.md` §5): the claim page
`/claim/$professional` (`/srp/claim-profile/{slug}`); the review-reply functions
(`/srp/fn/*`) are called from the xmp seat. The public serving pages (profiles, `/find`, topics,
Trust Center) moved to `surface-ui/search` at the same URLs.
