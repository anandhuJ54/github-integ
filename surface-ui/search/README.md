# Online Search — web (React SPA)

API-only now. Surface audit 2026-10-25 (ruling in `docs/SURFACE_AUDIT.md` §3) moved the search
console pages to `surface-ui/admin`, at the same URLs:

- `/search`, `/search/indexing`, `/search/sponsored`, `/search/ads`, `/search/voce` → `surface-ui/admin`

The search Surface's API (`surface-api/search`: public search, VOCE reads, presentation,
getSiteIndexing, card actions, search assistant) is still called from the shared libraries in
`surface-ui/_base`. This folder has no `tsconfig.json` and is not in `app/vite.config.ts`
`SURFACES` until it has pages again.
