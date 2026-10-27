# Intent: Sign in with the local database and land on the SRP home

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 04-srp — SRP — Locations & Professionals |
| Increment id | srp/local-login-srp-home |
| Status | draft |
| Date | 2026-10-26 |

## Problem
A person cannot sign in to the SRP pages against the local database. Sign-in in the v3 app is the Admin
Console page, which calls Supabase Auth and sends the user to `/console`; the backend accepts only
Supabase-issued tokens. The API login that is meant to replace Supabase is an empty stub. Separately, the
local database `v3_local` now holds only the schema `srp_cleanup` (81 tables, mock data), so the shared
tables the seat pages read (`public.exp_*`) and the Admin access tables no longer exist there. Nothing
connects a row in `srp_cleanup.users` to a signed-in session or to a seat page.

## Outcome
With only the local `v3_local` database, no Supabase project and no Supabase data:
1. A person opens the app, signs in with an email and password that belong to a user in `srp_cleanup.users`.
2. The API checks the password and issues the session token; the browser keeps it as the signed-in session.
3. The person lands on the SRP home, the Happyflow professional home at `/seat/professional/{id}`, for the
   professional tied to that user, and can move between the SRP pages from its navigation.
4. Signing out ends the session; opening an SRP page while signed out returns to the sign-in page.

## Signals and sources
Every claim below was read from code or the database in this session; none of it was run in the app.

| Source | Label | What it shows |
|---|---|---|
| `surface-ui/shell/routes/auth.tsx:30-60` | Repo | The only sign-in page is the Admin Console one: `supabase.auth.signInWithPassword`, then navigates to `/console` |
| `surface-ui/state/auth/adapters/api.ts` | Repo | The API login adapter is a stub; every method throws `not_implemented` ("the FastAPI login and refresh endpoints do not exist yet") |
| `surface-ui/state/auth/auth-provider.ts` | Repo | The `AuthProvider` interface says the API's own login replaces Supabase by implementing it, so nothing outside `state/auth` knows which is live |
| `surface-api/_base/auth.py` | Repo | `verify_jwt` accepts Supabase tokens only (JWKS ES256/RS256 or the HS256 shared secret, audience `authenticated`) |
| `surface-api/_base/db/session.py` | Repo | The API reaches the database from `DATABASE_URL` and sets the per-request role and claims from the verified token (`role_connection("authenticated", claims)`) |
| `surface-ui/shell/routes/_authenticated/route.tsx` | Repo | Every SRP page is under `_authenticated`: no session redirects to `/auth` |
| `surface-ui/shell/state/access-gate.tsx` and `surface-ui/state/access/thunks.ts:60-72` | Repo | After sign-in the gate calls `/admin/me/grants`, and when there are none calls `/admin/me/bootstrap`, which makes the first signed-in user `super_admin`. These are Admin-surface endpoints on Admin tables |
| `surface-ui/srp/src/routes/_authenticated/seat.$kind.$id.tsx:31-58`, `src/utils/seat.ts:222-234` | Repo | The seat layout loads the professional through `GET /srp/seat/professional/{id}` before the home renders |
| `surface-api/srp/src/seat/services.py:19` (`from _base.db import tables as T`) | Repo | That endpoint reads shared-core `public` tables, which are not in `v3_local` any more |
| `surface-ui/srp/src/routes/_authenticated/seat.$kind.$id.index.tsx` | Repo | The professional home itself is the Happyflow screens on sample data (`SampleData`) |
| `surface-spec/srp/happyflow-seat-ui/intent.md` | Repo | The Happyflow seat UI was moved in as UI only; "wiring real data is a later increment" |
| `v3_local`, schema `srp_cleanup` (read-only catalog queries) | Live | 81 tables, 1,086 columns; `users` has `email`, `password_digest`, `status`, `deleted_at`, `organization_id`, `account_id`; `tier_agents.user_id → users.id`; mock rows only, no real users, mock password digests are random strings |
| `v3_local` roles | Live | The Supabase-style roles `anon`, `authenticated`, `service_role`, `v3_app`, `app_readonly` and `app_readwrite` exist; `v3_app` can read and write `srp_cleanup` |
| Programme input, 2026-10-26 | Programme input | "We should not use Supabase data and change any in that. We should use only local db." Target flow: sign in as a user, then see the SRP pages landing on home |

## Success measure
- With `DATABASE_URL` pointing at `v3_local` and no Supabase variables set, sign-in with a mock user's email
  and password lands on `/seat/professional/{id}` and the SRP navigation opens each seat page without a sign-in
  loop. Recorded as a click-through in `evidence.md`.
- A wrong password, a deleted or deactivated user, and a missing token each get a refusal and no session.
- Tests for the login endpoint, token check and the redirect pass; the existing Supabase-token checks are
  unchanged where Supabase is still configured.
- Nothing is read from or written to Supabase, and no table outside `srp_cleanup` is created or changed.
- Observe: anything that blocks the flow in review is logged as a finding and becomes a new intent, test
  or lint rule, per `AGENTS.md` §1.

## Open decisions touched
None are resolved here. They are dependencies the spec has to answer, and each needs a ruling:
- **Ownership of the sign-in (identity) and the shared auth runtime** is listed in `AGENTS.md` §5 as
  unassigned ("identity registry … shared runtime"). Changing `surface-api/_base/auth.py` and
  `surface-ui/state/auth/` is a shared-core change that needs review for all Surfaces and a second
  approval (identity change, §4 Git).
- **Root `AGENTS.md` §4 stack amendment** already says the API's own login replaces Supabase and touches
  O2, O9 and O12; this increment does the login part of that and needs the recorded ruling the amendment
  asks for. O12 (security hardening) is touched: password hashing, token signing key and lifetime.
- **Admin access gate:** the gate and `/admin/me/bootstrap` belong to the Admin surface and the shell.
  Whether an SRP user bypasses it, gets an SRP-owned access answer, or the gate is changed is not decided,
  and it must never make a mock SRP user `super_admin`.
- **The seat data source:** the home needs `GET /srp/seat/professional/{id}`, which reads `public` tables
  that `v3_local` no longer has. Whether the seat endpoints read `srp_cleanup` for this flow, or the layout
  skips them while the home runs on sample data, is not decided. It decides how far past the home the other
  pages can work.
- **Mapping a user to a professional:** which `srp_cleanup` row is the professional behind a user
  (`tier_agents.user_id`, and `agent_mappings.is_primary` for a user with several seats) is not decided.
- **Token signing key:** where the API's signing secret lives locally. Secrets belong in Secret Manager or
  Vault by name; for local runs an environment variable, never committed.
- No other O-number is depended on. O1 (rings) is not touched: scores on the home are still sample values.

## Out of scope
- Any read or write of Supabase data, any Supabase setting, and removing the Supabase adapter or the Admin
  Console login. They stay as they are for environments that still use them.
- Refresh tokens, password reset, sign-up, invitations, single sign-on, multi-factor, and rate limiting
  beyond a basic failed-attempt guard.
- Reading real SRP data on the home and other seat pages (a later increment, as in
  `happyflow-seat-ui`), except what the seat-data decision above requires.
- Changing the Happyflow screens, the design, or `@v3/theme`.
- Creating, loading or changing `public` tables, and any change to `srp_cleanup` structure. The one data
  step this increment expects is setting a known test password on mock users, as a documented local seed.
