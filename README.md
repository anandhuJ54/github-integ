# v3-experiencesrp

Expertise Engine, restructured as a **decoupled React SPA + Python/FastAPI backend**,
keeping the Surface model and the one shared Supabase Postgres.

> Governance is unchanged on purpose: the real control boundary lives in the database
> (RLS, `FORCE ROW LEVEL SECURITY`, `SECURITY DEFINER` functions, governed write
> functions), not in the app language. Swapping TypeScript → Python is safe because of
> that. See the **Stack amendment** at the top of [`AGENTS.md`](AGENTS.md) §4.

## Layout — self-contained trees (`surface-api` · `surface-ui` · `surface-spec` · `contracts`)

Three self-contained project trees, each owning its own build config, plus repo-level shared
dirs. A Surface is the same domain across the trees — e.g. `surface-api/sales`,
`surface-ui/sales`, `contracts/sales`, `surface-spec/sales`. `contracts/` is its own
top-level tree (not under `surface-spec/`): it is machine-readable, versioned, and consumed
by code — both the backend and the frontend read it, and other Surfaces depend on it.

The repo root has **no** `pyproject.toml` and **no** `package.json`; each tree owns its own.

```
AGENTS.md                 root constitution (stack amended for React SPA + FastAPI)
Dockerfile                backend image (builds surface-api/ only)
templates/                shared increment templates (intent/spec/plan/evidence)
reference/                gcid universe + category data (the seed gate)
docs/                     engineering docs incl. ETL-Enhancements.md (the §4 change-log)
tools/                    enforcement — plain stdlib Python, run with python3 (no project)
scripts/                  dev/ops helpers

contracts/                versioned interface schemas (consumed by code, cross-Surface)
  sales/ … ops/           events/ + capabilities/*.v1.json + openapi  (the FE↔BE + cross-Surface seam)

surface-api/              self-contained Python/FastAPI project (its own pyproject.toml)
  _base/                  shared FastAPI: app_factory + core (auth, db, compliance)
  migrations/             the ONE shared migration history (one DB ⇒ one journal)
  migrate.py              migration runner  (cd surface-api && uv run python -m migrate status|apply)
  app.py                  dev entry — mounts Surface routers (uvicorn app:app)
  sales/ … ops/           one top-level Python package per Surface (snake_case: nora_os, conversion_agents)
    routers/              one module per capability

surface-ui/               self-contained composed React SPA (one package.json, one Vite app)
  shell/                  composition root: main, root, router, global routes
  state/                  centralized store, API client, auth adapters (@v3/state)
  shared/                 shared components (@v3/shared) ← no duplicated components
  theme/                  design tokens and css (@v3/theme)
  sales/ … ops/           one React app per Surface (kebab-case: nora-os, conversion-agents)

surface-spec/             governance docs (prose: human-authored increments)
  sales/ … ops/
    AGENTS.md CONTEXT.md  this Surface's local constitution + context
    <increment>/          intent.md · spec.md · plan.md · evidence.md
```

## Key rules (see AGENTS.md for the full constitution)

- **Surface = domain across the trees. Deployable = composition of Surfaces.**
  A backend service mounts whichever `surface-api/<surface>` routers it ships; a frontend app
  bundles whichever `surface-ui/<surface>` apps it ships — so graph / sales / marketing can
  deploy on independent cadences while sharing `surface-api/_base`, `surface-ui/shared`, and one database.
- **FE↔BE seam is the contract.** `surface-ui/<surface>` calls only its own `surface-api/<surface>`,
  via a client generated from `contracts/<surface>`. Cross-Surface reaction goes through the
  events/capabilities in `contracts/`, never a direct call or import.
- **Internal imports.** Backend imports: `from _base.auth import ...`, `from surfaces.sales.health.router import ...`
  (a Surface's code is `surface-api/<surface>/src`, imported as `surfaces.<surface>`). Frontend imports shared code from `@v3/shared` (= `surface-ui/shared`), global state and the API client from `@v3/state`.
- **Migrations are common.** One Postgres ⇒ one history under `surface-api/migrations`.
- **Governed decisions stay deterministic + server-side:** auth, claims, pricing,
  compliance, send eligibility, scoring, persistence — in FastAPI or the DB, never the browser.

## Run

```
# backend — surface-api/ is a self-contained uv project
#   (/sales/hello works without env; DB/auth routes need DATABASE_URL / SUPABASE_JWT_SECRET)
cd surface-api && uv run uvicorn app:app --reload          # http://localhost:8000/sales/hello
#   or containerized (build from the repo root):
docker build -t v3-api . && docker run -p 8000:8000 --env-file .env v3-api

# frontend — surface-ui/ is a self-contained bun workspace
cd surface-ui && bun install && bun --cwd sales dev        # http://localhost:5173  (proxies /api → :8000)

# migrations (human-approved apply)
cd surface-api && uv run python -m migrate status

# enforcement lint (plain stdlib Python, no project)
python3 tools/lint/lint_all.py
```

## Status

Scaffold. `surface-api/_base/core` (auth/db/compliance), the `surface-api/sales` example
router, and `surface-ui/sales` (runnable React page calling `/api/sales/hello`) demonstrate the
end-to-end pattern; other Surfaces are stubs ready for increments. The §4 stack change still
needs a recorded ruling (touches O2/O9/O12).
