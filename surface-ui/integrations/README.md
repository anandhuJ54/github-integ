# Integrations — web (React SPA)

Scaffold only: no pages yet. Pages go in `src/routes/` (the file name is the URL, e.g.
`integrations.index.tsx` → `/integrations`; under `_authenticated/` for signed-in pages), components in
`src/components/`, this Surface's API calls in `src/lib/`. Import shared UI from `@v3/ui`
(= `surface-ui/_base`); call only this Surface's API (`/api/integrations/...`).
