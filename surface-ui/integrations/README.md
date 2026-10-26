# Integrations — web (React SPA)

Scaffold only: no pages yet. Pages go in `src/routes/` (the file name is the URL, e.g.
`integrations.index.tsx` → `/integrations`; under `_authenticated/` for signed-in pages), components in
`src/components/`, helpers and this Surface's API calls in `src/utils/`, its own browser state (if any) in `src/state/`.
Import only `@v3/shared` (components), `@v3/state` (session, role, API client) and `@v3/theme`; call only this Surface's API (`/api/integrations/...`).
