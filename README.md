# v3-experiencesrp

Expertise Engine, restructured as a **decoupled React SPA + Python/FastAPI backend**,
keeping the Surface model and the one shared Supabase Postgres.

> Governance is unchanged on purpose: the real control boundary lives in the database
> (RLS, `FORCE ROW LEVEL SECURITY`, `SECURITY DEFINER` functions, governed write
> functions), not in the app language. Swapping TypeScript → Python is safe because of
> that. See the **Stack amendment** at the top of [`AGENTS.md`](AGENTS.md) §4.

## Layout — parallel trees (`api` · `ui` · `contracts` · `spec`)

Split by layer, because the runtimes differ (Python vs TypeScript). A Surface is the same
domain across the trees — e.g. `api/sales`, `ui/sales`, `contracts/sales`, `spec/sales`.
`contracts/` is its own tree (not under `spec/`): it is machine-readable, versioned, and
consumed by code — both `api` and `ui` read it, and other Surfaces depend on it.

```
AGENTS.md                 root constitution (stack amended for React SPA + FastAPI)
Dockerfile                backend image (FastAPI `api` package)
pyproject.toml            Python backend project
package.json              JS workspaces (ui/*)
templates/                shared increment templates (intent/spec/plan/evidence)
reference/                gcid universe + category data (the seed gate)
docs/                     engineering docs incl. ETL-Enhancements.md (the §4 change-log)

contracts/                versioned interface schemas (consumed by code, cross-Surface)
  sales/ … ops/           events/ + capabilities/*.v1.json + openapi  (the FE↔BE + cross-Surface seam)

api/                      Python backend (package `api`)
  base/                   shared FastAPI: app_factory + core (auth, db, compliance)
  migrations/             the ONE shared migration history (one DB ⇒ one journal)
  migrate.py              migration runner  (python -m api.migrate status|apply)
  app.py                  dev entry — mounts Surface routers (uvicorn api.app:app)
  sales/ … ops/           one Python package per Surface (snake_case: nora_os, conversion_agents)
    routers/              one module per capability

ui/                       React SPA frontends (TypeScript)
  base/                   shared design system (@v3/ui) ← no duplicated components
  sales/ … ops/           one React app per Surface (kebab-case: nora-os, conversion-agents)

spec/                     governance docs (prose: human-authored increments)
  sales/ … ops/
    AGENTS.md CONTEXT.md  this Surface's local constitution + context
    <increment>/          intent.md · spec.md · plan.md · evidence.md
```

## Key rules (see AGENTS.md for the full constitution)

- **Surface = domain across the three trees. Deployable = composition of Surfaces.**
  A backend service mounts whichever `api/<surface>` routers it ships; a frontend app
  bundles whichever `ui/<surface>` apps it ships — so graph / sales / marketing can
  deploy on independent cadences while sharing `api/base`, `ui/base`, and one database.
- **FE↔BE seam is the contract.** `ui/<surface>` calls only its own `api/<surface>`, via a
  client generated from `contracts/<surface>`. Cross-Surface reaction goes through the
  events/capabilities in `contracts/`, never a direct call or import.
- **Migrations are common.** One Postgres ⇒ one history under `api/migrations`.
- **Governed decisions stay deterministic + server-side:** auth, claims, pricing,
  compliance, send eligibility, scoring, persistence — in FastAPI or the DB, never the browser.

## Run

```
# backend (/sales/hello works without env; DB/auth routes need DATABASE_URL / SUPABASE_JWT_SECRET)
uv run uvicorn api.app:app --reload          # http://localhost:8000/sales/hello
#   or containerized:
docker build -t v3-api . && docker run -p 8000:8000 --env-file .env v3-api

# frontend
bun install && bun --cwd ui/sales dev        # http://localhost:5173  (proxies /api → :8000)

# migrations (human-approved apply)
uv run python -m api.migrate status
```

## Status

Scaffold. `api/base/core` (auth/db/compliance), the `api/sales` example router, and
`ui/sales` (runnable React page calling `/api/sales/hello`) demonstrate the end-to-end
pattern; other Surfaces are stubs ready for increments. The §4 stack change still needs a
recorded ruling (touches O2/O9/O12).
