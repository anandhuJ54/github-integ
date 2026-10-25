# Marketing Engine — web (React SPA)

React 19 + Vite + Tailwind + shadcn/Radix. Import shared components from `@v3/ui`
(= `surface-ui/_base`). Call this Surface's API via the client generated from `contracts/marketing`.

Demand engine `/website/*` (CMS, Leads, Campaigns, Ads, Demo Center, Trust Center, Cookie
Consent, Alerts, Developers), under `src/routes/_authenticated/`: moved from xmp, surface audit
2026-10-25 (`docs/SURFACE_AUDIT.md` §9), same URLs. API `/marketing/website/*` (the site
navigation menus that `_base/src/lib/nav-menus.ts` reads included).
