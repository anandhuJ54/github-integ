# Campaigns — web (React SPA)

React 19 + Vite + Tailwind + shadcn/Radix. Import shared components from `@v3/ui`
(= `surface-ui/_base`). Call this Surface's API via the client generated from `contracts/campaigns`.

Enterprise review campaigns: `/enterprise/$orgSlug/campaigns` (moved from xmp, surface audit
2026-10-25, `docs/SURFACE_AUDIT.md` §9; the page nests under xmp's `/enterprise/$orgSlug` layout in
the composed app). API: `/campaigns/enterprise/orgs/{slug}/campaigns`,
`/campaigns/enterprise/campaigns[/{id}]`. Depends on open decision O11; behaviour unchanged.
