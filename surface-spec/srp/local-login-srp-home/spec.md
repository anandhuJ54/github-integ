# Spec: Sign in with the local database and land on the SRP home

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · contracts: `contracts/srp/openapi.json` (two paths added, see Data)

Status of this spec: approved with decisions D1 to D6 as proposed (ruling 2026-10-26); revised 2026-10-27 after the canon and second-model reviews (token audience, four-route scope, atomic lock). Items marked **Proposed** are not rulings; each is listed under
"Decision log entries" and needs an explicit answer before `plan.md` is written.

## Behaviour
The whole flow runs on the local database and the local API. It is **off by default**: nothing below is
reachable unless `LOCAL_AUTH_ENABLED=1` (API) and `VITE_AUTH_PROVIDER=api` (UI) are set, so every
environment that uses Supabase today behaves as it does now.

**Deterministic code decides everything here** (who may sign in, the token, the landing path, which seat
may be read). No model is involved.

1. **Sign-in page.** SRP adds a public page `/sign-in` (`surface-ui/srp/src/routes/sign-in.tsx`, outside
   `_authenticated`). It has an email and a password field and posts to the API.
2. **Login endpoint.** `POST /srp/auth/login` with `{email, password}`, handled in
   `surface-api/srp/src/auth/` (`router.py`, `schemas.py`, `services.py`), connecting as the API's own
   database login (`db.connection()`), not as the `authenticated` role:
   1. Look the user up by lower-cased email in `srp_cleanup.users` (a read with no lock; no connection is held while bcrypt runs). Refuse (generic 401) when there is no
      such user, `deleted_at` or `deactivated_at` is set, `is_manual_deactivated` is true, or `locked_at`
      is within the lock window. The column `status` is **not** read: its meaning is not documented.
   2. Compare the password with `password_digest` (outside any database connection or transaction) (bcrypt, the usual format for a `password_digest` column; the real digest format still has to be confirmed) with
      `bcrypt.checkpw`. When the user does not exist, compare against a fixed dummy hash so timing does not
      reveal it.
   3. On a miss, one atomic UPDATE adds 1 to `failed_attempts` and, at 5 misses, sets `locked_at` (15-minute window); a
      lapsed lock restarts the count at 1; a user who is already locked is not counted again. The next success resets it. On a hit, set `failed_attempts = 0`, `locked_at = NULL`,
      `last_login_at = now()`, `num_logins = num_logins + 1`.
   4. Find the professional behind the user (**Proposed**, decision D4): the `tier_agents` row with
      `user_id` = the user; with several, the one named by `agent_mappings.is_primary`, else the lowest
      `tier_agents.id`. No professional: refuse with 403 `no_professional_seat` and issue no token.
   5. Return `{access_token, token_type: "Bearer", expires_at, user: {id, email, first_name, last_name},
      landing: {path: "/seat/professional/{tier_agent_id}"}}`. `password_digest` is never returned or logged.
3. **Token.** HS256, header `kid: "v3-local"`, claims `iss: "v3-local-auth"`, `aud: "v3-local-srp"` (its own
   audience, not Supabase's `authenticated`, so no other verifier accepts it), `sub: "<users.id>"`, `email`, `iat`, `exp`
   (8 hours, `LOCAL_AUTH_TOKEN_HOURS`); no `role` claim. Signed with `LOCAL_AUTH_JWT_SECRET` (at least 32 bytes, and
   never equal to `SUPABASE_JWT_SECRET`; the API refuses to start otherwise). No refresh token: after expiry the
   person signs in again.
4. **Token check** (`surface-api/_base/auth.py`, shared core). A token whose header has `kid: "v3-local"` is verified
   only with the local secret and only as HS256, never with the Supabase key or JWKS; the Supabase path refuses that
   `kid` and refuses any token that claims the local issuer. The global `verify_jwt` / `current_user` rejects local
   tokens. Only **four** SRP routes use the new dependency `current_srp_user`, which accepts a Supabase token or a
   local token: `GET /srp/auth/me`, `GET /srp/seat/professional/{pro_id}`, `POST /srp/rpc/{name}` and
   `GET /srp/seat/listings`. Every other SRP route keeps `current_user`, so a local token gets 401 there (they reach the
   database as the `authenticated` role on `public` tables, and the review routes call a paid model API).
5. **Session in the browser.** `surface-ui/state/auth/adapters/api.ts` is implemented (it is the stub
   today): `signIn(email, password)` calls the login endpoint and keeps the token and user in
   `sessionStorage` (wrapped in try/catch, memory fallback); `getSession`, `getAccessToken`, `onChange`
   and `signOut` read and clear it. `getAuthProvider()` picks the adapter from `VITE_AUTH_PROVIDER`
   (`api` or `supabase`, default `supabase`) and loads the Supabase adapter lazily, so with `api` the
   Supabase client is never created.
6. **Guard and landing.** With the `api` provider, `_authenticated` redirects a signed-out visitor to
   `/sign-in` instead of `/auth`. After a successful sign-in the page navigates to `landing.path`.
7. **Access gate.** With the `api` provider, `AccessGate` makes no `/admin/*` call: it enables access
   state and loads an empty grant list locally. It never calls `/admin/me/bootstrap`, so an SRP user can
   never become `super_admin`. (**Proposed**, decision D3.)
8. **Seat data for the home** (**Proposed**, decision D2). The layout loads
   `GET /srp/seat/professional/{id}`, the office-mode RPC and the listings. In local mode
   (`LOCAL_AUTH_ENABLED=1`):
   - `GET /srp/seat/professional/{id}` is answered from `srp_cleanup` in the **same response shape**
     (`pro` from `users` + `tier_agents`, `office` from `tier_locations` + `locations`, `score` from
     `user_search_rank_scores`, `ratings` empty, `reviews` and `nodes` null), only for the signed-in
     user's own seat id; any other id gets 403.
   - the office-mode RPC returns null and listings return an empty list, which the existing code already
     treats as "keep the professional's own rows" / no listings.
   - The home itself stays the Happyflow screens on sample data. Other seat pages that read `public`
     tables show their existing empty or error state; making them work is a later increment.
9. **Sign-out** clears the stored session and returns to `/sign-in`.
10. **Test password seed.** A script `surface-api/srp/src/auth/seed.py` (run with `uv run python -m surfaces.srp.auth.seed`; ruled 2026-10-26, it needs `bcrypt` and `psycopg` from the backend project) sets a bcrypt `password_digest` on
    the mock users in `srp_cleanup.users` from a password read from the environment variable
    `SRP_SEED_PASSWORD`. The password is never written in the repo, a log or chat. This is the only write
    to mock data this increment makes outside the login's own column updates.

## Acceptance criteria
1. `POST /srp/auth/login` with a correct email and password for a user that has a professional returns 200
   with the fields in step 2.5, and `landing.path` is `/seat/professional/{tier_agent_id}` for that user.
2. A wrong password and an unknown email return the same 401 body and similar timing class; the response
   never says which one failed.
3. Five wrong passwords lock the user for 15 minutes: a sixth attempt with the correct password is refused;
   after the window it succeeds and the counters reset.
4. A user with `deleted_at`, `deactivated_at` or `is_manual_deactivated` set is refused with the generic 401.
5. A user with no `tier_agents` row gets 403 `no_professional_seat` and no token.
6. A local token is accepted by exactly four SRP routes and returns 401 from every other route that checks a token,
   including the other SRP routes and the routes that check through `optional_user` (route-table test).
7. These tokens return 401: expired, wrong `aud`, `alg: none`, HS256 signed with the Supabase shared secret,
   `kid: "v3-local"` signed with a different key, and `kid: "v3-local"` with an asymmetric algorithm.
   Existing Supabase-token tests still pass unchanged.
8. With `LOCAL_AUTH_ENABLED` unset, `POST /srp/auth/login` is 404 and a `kid: "v3-local"` token is 401.
9. With `LOCAL_AUTH_JWT_SECRET` unset or shorter than 32 bytes and `LOCAL_AUTH_ENABLED=1`, the API fails
   at start-up with a clear message instead of signing with a weak key.
10. With `VITE_AUTH_PROVIDER=api` and no `VITE_SUPABASE_*` set, the app starts and `/sign-in` renders; no
    request goes to a Supabase host and the Supabase client module is not evaluated (unit test on provider
    selection; checked again in the click-through).
11. Submitting valid credentials on `/sign-in` navigates to the landing path and the Happyflow home renders
    there; a signed-out visit to any `/seat/*` or `/dashboard/*` URL goes to `/sign-in`.
12. After sign-in the browser makes no request to `/admin/*`.
13. `GET /srp/seat/professional/{id}` in local mode returns the same keys as the existing endpoint for the
    user's own seat and 403 for another seat id.
14. Sign-out removes the stored session; reloading stays signed out.
15. `password_digest` and the token do not appear in any log line or error body (test captures logs).
16. The only database writes are: the five login columns on `srp_cleanup.users` and the seed's
    `password_digest`. No table outside `srp_cleanup` is created or changed, and nothing is read from or
    written to Supabase (verified by running the flow with no Supabase variables and by a source guard test
    that the new SRP auth files do not mention Supabase).
17. `bun test` (including the boundary guards), `tsc` for the app and `surface-ui/srp`, `uv run ruff check .`,
    `uv run pytest` and `python3 tools/lint/lint_all.py` pass.

## Data
- **Read:** `srp_cleanup.users`, `tier_agents`, `agent_mappings`, `tier_locations`, `locations`,
  `user_search_rank_scores`. **Write:** `srp_cleanup.users` only (`failed_attempts`, `locked_at`,
  `last_login_at`, `num_logins`, and `password_digest` by the seed). All are SRP-owned data (the intent's
  source: the workbook "SRP Cleanup Schema by group").
- **The schema name** comes from a setting (`SRP_LOCAL_SCHEMA`, default `srp_cleanup`) and is validated
  against `^[a-z_][a-z0-9_]*$` before it is put in SQL, so it is never user input.
- **No new table, no migration, no grant change.** `srp_cleanup` is a local schema, not one of the
  repo's Alembic schemas (the Surface schema is `srp`), so there is no change-log entry in
  `docs/ETL-Enhancements.md` and no backup step; the seed is re-runnable and reversible by setting the
  digest back.
- **Extend, never duplicate** (search result, 2026-10-26): password-login code exists only in
  `surface-ui/shell/routes/auth.tsx` (Supabase, left as is) and a user model with `password_digest` in
  `surface-api/xmp/src/models/user.py` (the XMP Surface's table, not read here, see Canon review). The
  token check in `_base/auth.py`, the stub `adapters/api.ts`, the seat endpoint and `AccessGate` are
  **extended**, not copied. New objects: `surfaces.srp.auth` (login resource), `current_srp_user`,
  `/sign-in` and the seed script, none of which exist today.
- **Contracts:** `contracts/srp/openapi.json` gains `POST /srp/auth/login` and `GET /srp/auth/me`
  (the signed-in user and landing path, used on reload). No event or capability file.
- **Provenance and trust tier:** nothing is written as a fact about a professional; `last_login_at`
  and counters are operational. Not applicable to the trust-tier list.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | Not exposed to NORA. `GET /srp/auth/me` is for the signed-in browser session only. |
| Capabilities | None published. Login is not a NORA capability. |
| Events | None published. (A sign-in event is a possible later increment; none is invented here.) |
| Entitlement | None. |
| Explanation | None; error texts are fixed strings (`invalid_credentials`, `no_professional_seat`). |
| Value loop | Not applicable to this increment. |

## Security and scope
- **Principal:** a row in `srp_cleanup.users`. **Scope:** the user's own professional seat only; the seat
  endpoint refuses another id (criterion 13). No delegation or impersonation is added.
- **Isolation of the new token:** accepted only by SRP routes (criterion 6), so the Admin bootstrap, the
  other Surfaces' writes and any governed function cannot be reached with it.
- **Database access:** login and local seat reads use the API's own login, with narrow grants it already
  has on `srp_cleanup`. No grant is added to `anon`, `authenticated` or `PUBLIC`; the `authenticated`
  role is not used for these tables. No row-level security is added (AGENTS.md §3, new objects).
- **Secrets:** `LOCAL_AUTH_JWT_SECRET` and `SRP_SEED_PASSWORD` live in the gitignored `.env`, by name,
  never in code, logs or chat. Bcrypt cost 12 for any digest the seed writes.
- **Untrusted input:** email and password come from the browser; all SQL is parameterised, the email is
  lower-cased and length-limited, bodies are size-limited.
- **Browser storage:** the token is in `sessionStorage` (tab-scoped); an XSS bug could read it, and a
  hardened cookie plus refresh flow is out of scope. Bearer header, so no CSRF surface is added.
- **RLS impact:** none (no table or policy change).

## Compliance
No generated or published content, review reply or ad copy is produced. Fair Housing and RESPA/TILA
rules do not apply to this increment.

## Canon review
Run with the `canon-review` skill on 2026-10-27, on the code as written (before the second-model fixes; the fixes
change none of the results). PASS / CONFLICT / N/A; conflicts are flagged, not resolved.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Ownership | **CONFLICT (flag)** | Writes only to `srp_cleanup.users` (`srp/src/auth/services.py`, `seed.py`) and no import of another Surface. But `srp_cleanup` is not the Surface schema `srp`, has no ORM model or migration, and is outside `test_schemas.py` (§4). Shared-core edits (`_base/auth.py`, `_base/config.py`, `app/main.py`, `conftest.py`, `surface-ui/state/`, `surface-ui/shell/`) need review for all Surfaces (§2). |
| 2 | Extend, never duplicate | PASS (watch item) | Extended the token check, the API adapter stub, the seat endpoint and `AccessGate`. `srp/src/seat/local.py` is a second source for the same seat response, justified only while `public` is empty. |
| 3 | Identifiers | **CONFLICT (flag)** | The seat id in the URL is a raw `tier_agents.id` (`seat/local.py` `_shape`, `auth/services.py` `_find_seat`), not an entity id resolved through `exp_entity_for_record`. No `gcid`, no new link table. |
| 4 | Governed writes | PASS | No writes to graph, search or category tables. |
| 5 | Security | PASS (items) | No new table, RLS, policy or grant in the repo; no secrets committed. A second trust root (the local HS256 key) in shared core needs the second approval (§4). |
| 6 | Model vs code | PASS | All deterministic; unsupported RPCs return `not_implemented`; the local seat is derived from the tables and marked `is_demo`. |
| 7 | Gated actions | N/A | |
| 8 | Compliance | N/A | No generated or published content. |
| 9 | Scoring / rings | **CONFLICT (flag)** | The local seat's `total_score` is `SUM(srs_category_score)` from the legacy `user_search_rank_scores`, not SRS v5 (`exp_score_v5_explain`). No ring logic. |
| 10 | Open decisions | Listed | Unassigned ownership (identity registry, shared runtime, §5); §4 stack amendment (O2, O9, O12) needs its recorded ruling; O12 (hashing, key, lifetime); O1 not touched, related to row 9. Not decided here: `srp_cleanup` versus `srp` as the schema, and the record-id seat ids. |

Smaller: `evidence.md` carried a local username in a path (to be replaced by `~/Documents/...`); test fixtures use
fictional names (to be made generic) — root `AGENTS.md` §3 says no people's names in code or docs.

**Verdict:** clear to proceed for local use and for committing on the branch. Blocked from merge by: the all-Surface
review of the shared-core changes; the second approval for the identity change; rulings on identity ownership and the
stack amendment; a ruling on the `srp_cleanup` schema and record-id seat ids; a ruling on the score source.

## Second-model review
Run 2026-10-27 by a separate model (Opus), as a read-only agent given the code paths and the questions but none of
the author's conclusions. It reported seven findings and a test gap; each was checked against the code before it was
accepted. Its own list of things found sound (algorithm confusion, claim requirements, feature-off behaviour,
start-up refusal, SQL injection, transaction behaviour, bcrypt edge cases, digest never returned) was not disputed.

| # | Reviewer finding | Checked | Disposition |
|---|---|---|---|
| 1 | **High.** A local token worked on every SRP route; 9 `GET` routes (dashboard, directory, claim, location seat, interview) and the 4 review routes (one calls a paid model API, two write) opened a database connection as `authenticated` with the local claims | Reproduced in-process with a stubbed database (9 routes reached `role_connection("authenticated", …)`); the review routes read in `review/router.py` | **Accepted, fixed.** My earlier change had moved all 19 SRP routes to the new dependency. Now only 4 routes use it (allowlist test over the real route table, including the review routes) |
| 2 | Medium. A malformed stored digest returned instantly, so response time listed the unseeded accounts | Read in `_check_password`; true for the mock data | **Accepted, fixed.** A full dummy hash check now runs on that path (test spies on the hash calls) |
| 3 | Medium. bcrypt ran inside a connection and row lock, so parallel logins could exhaust the pool; no rate limit; 5 misses can keep a victim locked | Read in `authenticate` | **Accepted, fixed in part.** bcrypt now runs with no connection held; the miss is one atomic UPDATE. Proved on real Postgres: 24 simultaneous misses leave exactly 5, and six 0.3 s hashes overlap on a pool of one. **Not fixed:** there is still no per-IP or per-email rate limit, and lock-out of a known email remains possible by design (out of scope in the intent) |
| 4 | Medium-low. A token stays valid after an account changes, except on `/me` and the local seat read | True | **Accepted, reduced.** With finding 1 fixed, the only routes that honour a local token are those two plus a fixed `null` and a fixed `[]`. Token revocation (a `token_version`) is not built |
| 5 | Low. A local session is recognised by the `iss` claim, which the Supabase path never checked | True | **Accepted, fixed.** The Supabase path refuses any token claiming the local issuer (test) |
| 6 | Low. The local token reused Supabase's `aud` and `role`; nothing stopped the two secrets being equal; no production guard | True | **Accepted, fixed in part.** Own audience `v3-local-srp`, no `role` claim, and start-up refuses a secret equal to `SUPABASE_JWT_SECRET`. **Not fixed:** nothing ties `LOCAL_AUTH_ENABLED` to a local environment, and every seated mock user shares one password; it is off by default |
| 7 | Low. A bad body returned 422 instead of 404 when the feature is off; `localtimestamp` is session-time; the no-seat 403 confirms a correct password; `lower()` differences | True for the first | **Accepted, fixed** the 404 (now a route dependency). **Not changed:** `localtimestamp` (written and compared by the same code in the same session setting, and the integration test passes); the no-seat 403 needs the password and is kept; the `lower()` difference only causes a miss |
| gap | The scope test skipped `optional_user` routes and everything in SRP | True | **Accepted, fixed.** The test now sends a local token to every route that checks a token, including those |

No finding was rejected. Result after the fixes: 1,761 backend tests pass, 5 real-Postgres tests pass when
`SRP_TEST_DATABASE_URL` is set (skipped otherwise), and the 3 migration-security tests that failed before this work
still fail. The fixed code was also run against `v3_local`: a local token returns 200 on the four allowed routes and
401 on the dashboard, location seat, claim, directory, `/srp/me` and the three review routes.

## Decision log entries
Proposed, awaiting a ruling (none is decided):
- **D1. Login lives in SRP, token check in `_base`.** The login resource is in `surface-api/srp/src/auth/`;
  the shared verification change is in `_base/auth.py`. Blocks: plan.md. Alternative: put both in a new
  Surface, which needs ownership assigned first.
- **D2. Seat data for the home.** Local mode answers `GET /srp/seat/professional/{id}` from `srp_cleanup`
  and nulls the other two loaders (step 8). Alternative: skip the loaders for the `api` provider and let
  the home render from sample data alone, which is smaller but changes the layout in `surface-ui/srp`.
  Blocks: the seat endpoint work.
- **D3. Access gate.** The `api` provider gets an empty, local grant list and no `/admin/*` calls.
  Alternative: change the Admin endpoints to refuse local tokens only. Blocks: the shell change.
- **D4. User to professional.** `tier_agents.user_id`, primary by `agent_mappings.is_primary`, else lowest
  id; no seat means no sign-in. Alternative: land a seat-less user on a location seat or a "no seat" page.
- **D5. Token lifetime and storage.** 8 hours, `sessionStorage`, no refresh. Blocks: criterion 14 wording.
- **D6. Meaning of `users.status`.** Left unread until its values are documented; deactivation uses the
  three explicit columns above.
- **R1 (2026-10-27, after the reviews).** A local token is accepted by four SRP routes only; the audience is
  `v3-local-srp`; the signing key must differ from the Supabase one; bcrypt runs with no connection held. Blocks: nothing.
  Not built and still open: per-IP/per-email rate limit, token revocation, a production guard for `LOCAL_AUTH_ENABLED`.
