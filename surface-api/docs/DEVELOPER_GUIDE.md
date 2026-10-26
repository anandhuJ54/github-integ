# surface-api: developer guide

One FastAPI app built by many teams. Each team owns a **Surface** folder (`<name>/`, the same Surfaces
as `surface-spec/` and `surface-ui/`): its endpoints, queries, migrations and tests. The rules are in
the root [`AGENTS.md`](../../AGENTS.md); where this guide and AGENTS.md differ, AGENTS.md wins.

## 0. How a change moves (the AI-native loop, AGENTS.md §1)

Every change is an **increment**: one folder, one branch, one PR.

| Stage | File (in `surface-spec/<surface>/<increment>/`, from `templates/`) | What goes in it |
|---|---|---|
| Define | `intent.md` | problem, outcome, signals and sources, success measure, open decisions touched, out of scope |
| Design | `spec.md` (+ `contracts/<surface>/` changes) | behaviour, acceptance criteria, data, NORA-ready contract, security and scope, compliance, canon review |
| Develop | `plan.md` | tasks (files/tables, test first), extend-never-duplicate check, migration plan, test plan, risks |
| Test | `evidence.md` | acceptance results, CI gates, evals, live read-only checks, applied changes, **what remains unverified** |
| Deploy / Observe | `evidence.md` + `docs/ETL-Enhancements.md` (DB changes) | approved apply steps; findings become new intents, tests or lints |

- No code before an approved `intent.md` + `spec.md`. Small fixes inside one Surface (no schema,
  security, money or identity change) may use the PR template's Small-fix section instead.
- Code lands in this project: endpoints and queries in `<surface>/src/<resource>/`, migrations in
  `<surface>/db/migrations/`, tests in `<surface>/tests/`. Specs stay in `surface-spec/`, never here.
- Skills that help: `increment-scaffold` (creates the folder), `canon-review`,
  `extend-never-duplicate`, `nora-ready-contract`, `migration-authoring`, `rls-grant-review`,
  `evidence-writer`.

## 1. Run it

```bash
cd surface-api
uv sync                                  # once, and after pulling: installs deps + the `surfaces.*` names
uv run uvicorn app:app --reload --port 8000
uv run pytest                            # every test;  uv run pytest sales  → one Surface
uv run ruff check .
```

Settings come from the environment (`.env` stays local and is never committed):
`DATABASE_URL` (primary), `DATABASE_READ_URL` (optional replica), `SUPABASE_JWT_SECRET` or the
project's JWKS, `DB_POOL_MAX` (keep `replicas × workers × DB_POOL_MAX` under the DB login's
connection cap), `CORS_ALLOW_ORIGINS`, `SITE_ORIGIN`. See `_base/config.py`.

## 2. Folder map

```
surface-api/
├── app/                  APP SHELL (shared core)
│   ├── main.py           create_app(): CORS, DB error → 503, /healthz, /readyz; builds `app`
│   ├── routes.py         ROUTERS: each Surface's aggregate router, mounted once
│   ├── surfaces.py       SURFACES registry (adding a Surface is a PR here)
│   └── contracts.py      python -m app.contracts <surface> → contracts/<surface>/openapi.json
├── _base/                SHARED RUNTIME (shared core). Never imports app/ or a Surface.
│   ├── auth.py           current_user: verifies the Supabase JWT → claims
│   ├── server_fn.py      fn_router, FnCall, optional_user, bad_input, forbidden, not_implemented
│   ├── compliance.py     server-side publish checks
│   ├── config.py         settings
│   ├── db/
│   │   ├── session.py    pools; role_connection(role, claims, write=, fresh=) sets RLS context
│   │   ├── sql.py        fetch_all / fetch_many / fetch_one / typed / jsonish; MAX_ROWS = 1000
│   │   ├── tables.py     the table catalog (SQLAlchemy Core, generated from the live DB)
│   │   └── migrations/   Alembic branch `_base` (the baseline)
│   ├── disco/            discovery engine (used by etl, admin, graph, nora_os)
│   ├── integrations/     integration status (used by admin, sales, nora_os)
│   └── tests/
├── tests/                CROSS-CUTTING GUARDS: boundaries, routes, migrations, app wiring
├── conftest.py           shared fixtures: fakedb, fake_db_for, surface_client
├── alembic.ini           one Alembic branch per Surface; env in alembic_env/
├── migrations/           CLOSED SQL stream (migrate.py); no new files
└── <surface>/            ONE FOLDER PER SURFACE (owned by that team)
```

### Anatomy of a Surface folder

```
srp/
├── src/                  Python package `surfaces.srp`
│   ├── __init__.py
│   ├── router.py         aggregate: include_router once per resource; no endpoints
│   ├── exports.py        the ONLY module another Surface may import
│   ├── internal.py       helpers shared by two or more of its resource folders
│   ├── claim_profile/    one folder per resource
│   │   ├── router.py     GET /srp/claim-profile/{slug}
│   │   ├── schemas.py    ClaimProfile
│   │   └── services.py   claim_profile(conn, slug)
│   └── seat/ review/ directory/ health/ ...
├── tests/                test_*.py (+ conftest.py naming the modules its fake DB patches)
└── db/migrations/        Alembic branch `srp`
```

The folder on disk is `<name>/src`; the import name is `surfaces.<name>` (the mapping is in
`pyproject.toml`, which is why `uv sync` must run first). `internal` may be a package
(`internal/`) when it is large. A resource folder may hold extra modules that only it uses.

| Path in `src/` | Who may import it | Put here |
|---|---|---|
| `router.py` | `app/routes.py` only | `router.include_router(...)` per resource |
| `<resource>/router.py` | this Surface's `router.py` | endpoints: parse input, open a connection, call services, return |
| `<resource>/schemas.py` | this Surface | Pydantic request/response models (`extra="forbid"` for inputs) |
| `<resource>/services.py` | this Surface | queries and rules; takes a `conn`, returns plain data |
| `internal.py` | this Surface only | helpers two or more resource folders share; no endpoints |
| `exports.py` | **any Surface** | read functions, small DTOs, constants. Empty today: cross-Surface use goes through the HTTP contract (`contracts/<surface>`) |
| `testing.py` | any Surface's **tests** | test fakes and fixtures |

## 3. How a request flows

```
browser (surface-ui/<surface>)  ──  /api/<surface>/...  (Vite / reverse proxy strips /api)
  │
app/main.py            CORS; PoolTimeout / OperationalError → 503 "database busy|unavailable"
  │
<resource>/router.py   path, body (schemas.py), claims = Depends(current_user)
  │ with db.role_connection("authenticated", claims) as conn:   ← RLS applies as that user
<resource>/services.py   SQLAlchemy Core statements on _base.db.tables, run with _base.db.sql
  │
Postgres (Supabase)    RLS policies + governed functions decide; the API never bypasses them
```

- **Roles.** `role_connection("anon")` for public reads, `("authenticated", claims)` for the
  signed-in user, `("service_role", write=True)` only for server-side writes the governed path
  requires. Reads go to the replica unless `write=True` or `fresh=True`.
- **Writes** go through the governed Postgres functions (allow-listed RPCs), never raw writes to
  `exp_*`, `graph_*`, `search_*`.
- **Server functions** (`/<surface>/fn/<name>`, body `{"data": ...}`) use `fn_router` and
  `FnCall` from `_base.server_fn`; `optional_user` for public ones.
- **Errors:** `bad_input` (400), `forbidden` (403), `HTTPException(404)`, and
  `not_implemented(...)` (501) for behaviour that doesn't exist yet. Never fake output.
- **Row cap:** `fetch_all` caps a SELECT at 1,000 rows (`MAX_ROWS`); `max_rows=None` only with an
  explicit decision.

## 4. Worked example: adding an endpoint

Add `GET /srp/claim-profile/{slug}/license-label` to the existing `claim_profile` resource.

1. **Test first** in `srp/tests/test_claim_profile.py`. Follow the tests already there: a fake
   `role_connection` that answers by SQL substring, a client on the srp router with `current_user`
   overridden, then assert the status code and JSON. Write it, see it fail.
2. **Schema** in `claim_profile/schemas.py`: `class LicenseLabel(BaseModel): label: str`.
3. **Query** in `claim_profile/services.py`: a function taking `conn` and returning a dict, built
   with `select(...)` on `_base.db.tables` and run with `fetch_all`.
4. **Endpoint** in `claim_profile/router.py`: `@router.get(..., response_model=LicenseLabel)`, open
   `db.role_connection("authenticated", claims)`, call the service, map "not found" to 404.
5. Nothing to mount: `srp/src/router.py` already includes `claim_profile`. A **new** resource
   folder needs one `include_router` line there.
6. `uv run pytest srp`, `uv run ruff check srp`, then `uv run python -m app.contracts srp` and
   commit the updated `contracts/srp/openapi.json`.

## 5. Database changes (Alembic per Surface)

Hand-written SQL revisions in the owning Surface's `db/migrations/` (its Alembic branch). Follow
the `migration-authoring` skill; the short version:

```bash
# the Surface's first revision
uv run alembic revision -m "add foo" --head=base --branch-label=srp \
  --version-path=srp/db/migrations --depends-on=866c5f655041
# later revisions
uv run alembic revision -m "add bar" --head=srp@head
uv run alembic upgrade heads --sql        # review the SQL; no DB needed
uv run pytest tests/test_migrations.py
```

- Write SQL in `upgrade()` with `op.execute("""...""")`. New tables: `ENABLE` and `FORCE ROW LEVEL
  SECURITY`, no grants to `anon`/`PUBLIC`, never `USING (true)` except for `service_role`.
- `depends_on` any revision of another branch whose table you use.
- Additive only on protected tables; never edit a revision once applied anywhere shared.
- **Applying is a human-approved step** (backup, `uv run alembic upgrade heads`, verify by JOIN, log
  in `docs/ETL-Enhancements.md`). Agents never apply or stamp.
- After a table change, regenerate `_base/db/tables.py` (`_base/db/generate.py`) so queries see it.

## 6. Tests

- Unit tests use the fakes in `conftest.py`: `fakedb(module, ...)` (cursor style,
  `db.on(substring, rows)`) or the Surface's `fake_db(responder)` (execute style). No live DB.
- `surface_client("<surface>")` gives a TestClient on one Surface's router, signed in
  (`signed_in=False` for anonymous).
- The guards in `tests/` fail when a Surface imports another's internals, when a Surface is
  missing a standard file or is not registered, when a route is mounted twice, or when a
  migration is on the wrong branch.
- Browser-vs-API **parity** runs live against the DB from `surface-ui/parity/` (see
  `docs/BROWSER_TO_API_TODO.md`).

## 7. Checklist before a PR

- [ ] `uv run ruff check .` and `uv run pytest` pass
- [ ] `python3 tools/lint/lint_all.py` (when present) passes
- [ ] contracts regenerated for every Surface whose endpoints changed
- [ ] new migration: on its own branch, `depends_on` declared, `--sql` reviewed, change-log entry
- [ ] `evidence.md` or the PR's Small-fix section filled (AGENTS.md §1)
