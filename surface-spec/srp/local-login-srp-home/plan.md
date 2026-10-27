# Plan: Sign in with the local database and land on the SRP home

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

Status: draft for approval. No code has been written. Rulings of 2026-10-26: spec approved, decisions D1 to D6
accepted as proposed, and the intent's landing path amended to `/seat/professional/{id}`.

## Tasks
Small tasks (≤ ~400 changed lines each), in dependency order. Each task starts with its failing test.

| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|
| 1 | Local settings: `LOCAL_AUTH_ENABLED`, `LOCAL_AUTH_JWT_SECRET` (≥ 32 bytes, refuse start otherwise), `LOCAL_AUTH_TOKEN_HOURS`, `SRP_LOCAL_SCHEMA` (validated name); add each to `surface-api/env.example` as placeholders | `surface-api/_base/config.py`, `surface-api/env.example` | Settings test: weak or missing secret with the flag on fails start (criterion 9) | — |
| 2 | Token check: verify `kid: "v3-local"` tokens HS256 with the local key only; `verify_jwt` rejects them; new `current_srp_user` accepts Supabase or local | `surface-api/_base/auth.py` (shared core), `surface-api/_base/tests/test_local_token.py` | Expired, wrong audience, `alg: none`, Supabase secret, wrong key, asymmetric alg with the local kid, flag off (criteria 6-8) | 1 |
| 3 | Add dependency `bcrypt` (and `uv.lock`) | `surface-api/pyproject.toml`, `surface-api/uv.lock` | Import and a hash/verify round trip in the login tests | — |
| 4 | Login resource: `POST /srp/auth/login`, lock rule, user-to-professional lookup, 404 when the flag is off, no secrets in logs; mounted in the SRP aggregate router | `surface-api/srp/src/auth/{router,schemas,services}.py`, `surface-api/srp/src/router.py`, `surface-api/srp/tests/test_auth_login.py` | Right and wrong password, unknown user, 5-miss lock and recovery, deleted/deactivated, no seat, log capture (criteria 1-5, 8, 15) | 1, 2, 3 |
| 5 | `GET /srp/auth/me` (signed-in user and landing path, used when the page reloads) | same resource, `surface-api/srp/tests/test_auth_me.py` | Local token returns the user; Supabase token still works; no token 401 | 4 |
| 6 | Switch the 19 `Depends(current_user)` in `surface-api/srp/src` to `current_srp_user`; route-table test that every router outside SRP returns 401 for a local token | `surface-api/srp/src/*/router.py` (mechanical), `surface-api/tests/test_local_token_scope.py` | The route-table test fails first, passes after the switch (criterion 6) | 2 |
| 7 | Local seat read: `GET /srp/seat/professional/{id}` answered from `srp_cleanup` in the existing shape for the user's own seat (403 otherwise); office-mode RPC returns null and listings return an empty list in local mode | `surface-api/srp/src/seat/local.py` (new), `seat/router.py`, `seat/services.py` (branch), `surface-api/srp/tests/test_seat_local.py` | Same keys as the existing endpoint; another seat id 403; flag off keeps today's behaviour (criterion 13) | 4, 6 |
| 8 | Test-password seed (runnable with `uv run python -m surfaces.srp.auth.seed`): reads `SRP_SEED_PASSWORD` from the environment, writes bcrypt digests to `srp_cleanup.users`, prints counts only | `surface-api/srp/src/auth/seed.py`, `surface-api/srp/tests/test_auth_seed.py` | Digest verifies against the password; no password in output | 3 |
| 9 | UI auth provider: `VITE_AUTH_PROVIDER` selection with the Supabase adapter loaded lazily; implement `adapters/api.ts` (`signIn`, session in `sessionStorage` with memory fallback, `getAccessToken`, `onChange`, `signOut`); main.tsx picks the provider before `bootstrapSession` | `surface-ui/state/auth/index.ts`, `adapters/api.ts`, `surface-ui/shell/main.tsx`, `surface-ui/state/auth/api-adapter.test.ts` | Provider selection never evaluates the Supabase client; sign-in, reload and sign-out (criteria 10, 14) | 4, 5 |
| 10 | Sign-in page and guard: `/sign-in` (outside `_authenticated`); guard redirects to `/sign-in` for the `api` provider; navigate to `landing.path`; sign-out returns to `/sign-in` | `surface-ui/srp/src/routes/sign-in.tsx`, `surface-ui/shell/routes/_authenticated/route.tsx`, `surface-ui/srp/src/sign-in.test.ts` | Redirect and landing behaviour (criterion 11) | 9 |
| 11 | Access gate for the `api` provider: enable state, load an empty grant list locally, never call `/admin/*` | `surface-ui/shell/state/access-gate.tsx`, `surface-ui/state/access/thunks.ts`, `surface-ui/shell/state/state.test.ts` | No `/admin/*` request after sign-in (criterion 12) | 9 |
| 12 | Contract: add the two paths to `contracts/srp/openapi.json` | `contracts/srp/openapi.json` | The repo's contract checks (if any) and a schema-shape test of the login response | 4, 5 |
| 13 | Source guard: the new SRP auth files and the `api` adapter do not mention Supabase | `surface-ui/srp/src/auth-guard.test.ts` (mirrors `happyflow-guard.test.ts`), a backend equivalent | Guard fails on a planted `supabase` reference (criterion 16) | 4, 9, 10 |
| 14 | End-to-end check: start the API and the UI against `v3_local` with no Supabase variables, sign in as a mock user, click through the seat pages, screenshot; fill `evidence.md` | `evidence.md`, screenshots | The click-through script (criteria 1, 10, 11, 12, 14) | 1-13 |

Tasks 1-3 are the shared-core and dependency work and go in the first PR-sized slice so the shared-core review
can start early; 4-8 are the API, 9-11 the UI, 12-14 close it out. One branch and one PR for the increment.

## Extend-never-duplicate check
Searched 2026-10-26, repo and the live `v3_local` catalog:
- **Repo:** password-login code exists only in `surface-ui/shell/routes/auth.tsx` (Supabase, unchanged) and a
  `password_digest` column on the XMP user model (`surface-api/xmp/src/models/user.py`, XMP's table, not read).
  `bcrypt` is **not** installed in `surface-api/.venv`, so it is a new dependency.
- **Live:** no function in `srp_cleanup`, and no non-extension function in `public`, relates to login; no table
  in `srp_cleanup` is named like session, token, login or credential. Nothing to extend in the database.
- **Extended, not copied:** `_base/auth.py` token check, `adapters/api.ts` stub, `GET /srp/seat/professional/{id}`,
  `AccessGate`, `getAuthProvider`.
- **New:** `surfaces.srp.auth` (login resource and seed), `current_srp_user`, the local seat read, `/sign-in`.

## Migration plan
None. No table, column, function, grant or policy is created or changed, so there is no Alembic revision, no
`docs/ETL-Enhancements.md` entry and no backup. The only data change is the seed (task 8): it updates
`srp_cleanup.users.password_digest` on mock rows and is reversible by running it again or restoring the old
values. Before the first seed run the plan takes a copy of `id, email, password_digest` from `srp_cleanup.users`
into the scratchpad so the original mock values can be restored. Verification: a `JOIN` count of seeded users
against `tier_agents` (how many mock users can actually sign in).

## Test plan
- **Backend** (`cd surface-api && uv run pytest`): the new tests in tasks 1, 2, 4, 5, 6, 7, 8 use the existing
  execute-style fake database (`fake_db_for`) and `surface_client`. A small set of integration tests runs
  against `v3_local` only when `SRP_TEST_DATABASE_URL` is set and is skipped otherwise, so CI is unchanged.
- **UI** (`cd surface-ui && bun test`): provider selection, the adapter, the redirect and the access gate; the
  existing boundary guards stay green.
- **Static:** `uv run ruff check .`, `bunx tsc --noEmit -p .` plus `-p surface-ui/srp`, `python3 tools/lint/lint_all.py`.
- **Click-through** (task 14) covers what unit tests cannot: the real home rendering after a real sign-in.

| Criterion | Task / test |
|---|---|
| 1-5 | 4 (`test_auth_login.py`) |
| 6 | 2 and 6 (`test_local_token.py`, `test_local_token_scope.py`) |
| 7-9 | 1 and 2 |
| 10, 14 | 9 (`api-adapter.test.ts`) and 14 |
| 11 | 10 and 14 |
| 12 | 11 and 14 |
| 13 | 7 |
| 15 | 4 |
| 16 | 13 and 14 |
| 17 | the full static and test run before the PR |

## Risks
- **Shared core and identity:** tasks 1, 2, 9, 10 and 11 change files every Surface uses; they need all-Surface
  review and a second approval. Task 2 is the security-critical one.
- **Edit-guard hook missing:** `tools/hooks/guard.py` does not exist, so the hook blocks every Write and Edit.
  Until it is restored, each repo write needs your approval to go through the shell, which will slow Develop.
- **Provider selection is now asynchronous:** loading the Supabase adapter lazily means `getAuthProvider()` can
  no longer be a plain synchronous call at import time; task 9 selects the provider once before
  `bootstrapSession`. If a module calls it earlier, that test will fail first and the design is revisited, not patched.
- **Seed location differs from the first spec draft:** it needs `bcrypt` and `psycopg` from the backend project, so it
  lives in `surface-api/srp/src/auth/seed.py`. Ruled 2026-10-26; the spec text was updated to match.
- **Mock data coverage:** 26 of the 50 mock users have a professional seat; the seed and the click-through must
  use one of those, or sign-in correctly returns `no_professional_seat`.
- **Digest format unconfirmed:** the real `password_digest` format is assumed to be bcrypt; the seed writes bcrypt,
  so local sign-in works either way, but nothing here proves production digests are bcrypt.
- **Other seat pages:** pages that read `public` tables (still empty locally) will show empty or error states;
  that is out of scope (intent) but will be visible in the click-through and logged as findings.
- **This environment:** `uv` could not create its cache earlier in the session; commands may need
  `UV_CACHE_DIR` pointed at a writable folder. `.env` files cannot be read or edited by the agent, so you set
  `DATABASE_URL` (the local `v3_local`), `LOCAL_AUTH_ENABLED`, `LOCAL_AUTH_JWT_SECRET` and `SRP_SEED_PASSWORD`
  yourself, and I never see the secrets.

## Not verified yet
Nothing in this plan has been run. The design rests on reading the code and catalog; the route-table test, the
lazy provider selection and the access-gate behaviour with an empty grant list are the three places most
likely to need a change when the first tests run.
