# Evidence: Sign in with the local database and land on the SRP home

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md) · PR: not opened (nothing is committed)

Verified on 2026-10-26/27 against the local Postgres 17 database `v3_local` (schema `srp_cleanup` only), a
separate API on `127.0.0.1:8001` and a separate UI dev server on `127.0.0.1:5174` started for this check, with
`LOCAL_AUTH_ENABLED=1`, a one-off signing key generated for that process, and `VITE_AUTH_PROVIDER=api`.
No Supabase variable was set for the API; the UI machine's own `surface-ui/.env` still contains Supabase
values (not read by the agent; the `api` provider never uses them).

## Acceptance criteria results
Unit = automated test with a fake database. API = run against `v3_local` over HTTP. Browser = driven in the
built-in browser pane.

| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | Login returns token, user and `/seat/professional/{id}` | Unit `test_auth_login.py`; API: user 4 → 200, landing `/seat/professional/19`; Browser: user 7 → landed on `/seat/professional/34` | Pass |
| 2 | Wrong password and unknown email look the same | Unit; API (unknown email and wrong password both `401 invalid_credentials`); Browser (message shown, field cleared, no session stored) | Pass. Timing equality not measured, only that a dummy hash check runs (unit) |
| 3 | Five misses lock for 15 minutes; recovery after the window | Unit (5 misses, locked correct password, expiry, fresh count). API: 1 miss then a correct login reset `failed_attempts` to 0 | Pass in unit. The 5-miss lock and the 15-minute expiry were **not** exercised against the real database |
| 4 | Deleted / deactivated / manually deactivated refused | Unit | Pass in unit only |
| 5 | User without a seat: 403 `no_professional_seat`, no token | Unit (login and `/me`) | Pass in unit only. In `v3_local` the 24 users without a seat have no bcrypt digest, so they return 401, not 403 |
| 6 | Local token accepted by four SRP routes only | `tests/test_local_token_scope.py` walks the real route table: exactly `/srp/auth/me`, `/srp/seat/professional/{id}`, `/srp/rpc/{name}`, `/srp/seat/listings` use the dependency; every other token-checking route (including the other SRP routes, the review routes and `optional_user` routes) refuses a local token. API on the fixed code: allowed routes 200; dashboard, location seat, claim, directory, `/srp/me` and the three review routes 401 | Pass (after the second-model review found the first version too wide; see spec) |
| 7 | Bad tokens refused | Unit: expired, wrong audience/issuer, missing claims, `alg: none`, ES256, HS384, Supabase secret, wrong key, no `kid`; API: tampered token → 401 | Pass |
| 8 | Off by default | Unit: login 404, `/me` refused, local token 401 with the flag unset | Pass in unit |
| 9 | Weak or missing secret stops start-up | Unit (`test_local_auth_startup.py`, `test_local_token.py`); the API also started with a 64-character key | Pass |
| 10 | `api` provider needs no Supabase | Unit: selection and adapter; every request the adapter makes stays on `/api/` (asserted after each test). Browser: no request to any Supabase host | Pass for network. The Supabase adapter's **code files are still loaded** by the dev server (the module imports are static); the client is never created or called |
| 11 | Sign-in lands on the home; signed-out visit goes to `/sign-in` | Browser: `/seat/professional/34` signed out → `/sign-in`; sign-in → `/seat/professional/34` rendering the Happyflow home (sample data banner shown) | Pass |
| 12 | No `/admin/*` request after sign-in | Unit: `loadAccess` and `logAudit` make no request for the `api` provider; Browser: the request list after sign-in shows only `/api/srp/auth/login`, `/api/srp/auth/me`, `/api/srp/seat/professional/34`, `/api/srp/rpc/exp_office_mode`, `/api/srp/seat/listings` and `/api/search/fn/getSiteIndexing` (a shell call), no `/api/admin` | Pass. The browser keeps only the most recent requests, so earlier ones in the session were not all inspected |
| 13 | Local seat read: same keys, own seat only | Unit (keys equal the existing endpoint's; other id 403); API: own seat 200 with the 7 expected keys, seat 34 for user 4 → 403, `abc` → 403, `exp_office_mode` → `null`, listings → `[]` | Pass |
| 14 | Sign-out clears the session; reload stays signed out | Browser: new **Sign out** button in the seat sidebar returned to `/sign-in` with `v3.srp.session` removed; a direct seat URL afterwards redirected to `/sign-in`; a reload while signed in kept the session and called `/api/srp/auth/me` first. Unit for the adapter | Pass. The button was added during this check (see Findings 1) and has no unit test beyond `showSignOut` |
| 15 | No password, digest or token in logs or bodies | Unit (log capture on the API; console spies on the adapter) | Pass in unit only; server logs of the live run were not searched |
| 16 | Only the five login columns and the seed digest are written; nothing in Supabase | `test_auth_guard.py` and `auth-guard.test.ts` (with planted violations); live: only `srp_cleanup.users` changed, `public` still has 0 tables | Pass |
| 17 | Static checks | See CI gates | Partly: `tools/lint/lint_all.py` could not run (missing) |

## CI gates
No CI run exists; nothing is pushed. Local runs on the final tree:

- `cd surface-api && uv run ruff check .`: all checks passed.
- `cd surface-api && uv run pytest`: 1,761 passed, 5 skipped (real-Postgres tests, need `SRP_TEST_DATABASE_URL`; run once against `v3_local` and passed), 3 failed. The 3 failures (`test_new_tables_are_closed_to_anon_by_grants`
  for `_base`, `campaigns`, `xmp` migrations) fail identically with this work stashed.
- `cd surface-ui && bun test`: 145 passed, 0 failed.
- `bunx tsc --noEmit` for the app and for all 15 Surface apps (run earlier in the work; app and `srp` rerun after the last change): clean.
- `python3 tools/lint/lint_all.py`: **not run**, `tools/lint/` does not exist in this checkout.
- Contract: `tests/test_contracts.py` passes against the regenerated `contracts/srp/openapi.json` (189 added lines, none removed).

## Evals (Skills / NORA / AI output only)
Not applicable: no model-generated content.

## Live verification (data changes only)
Read-only queries on `v3_local` after the seed (run from `psql`):

| Check | Result |
|---|---|
| Users with a 60-character bcrypt-shaped digest | 26 |
| Of those, with a live professional seat (JOIN to `tier_agents`) | 26 of 26 |
| Users left with their original digest | 24 |
| Distinct digests among the seeded (each its own salt) | 26 |
| bcrypt cost values present | 12 only |
| Users with `failed_attempts <> 0` or `locked_at` set | 0 |
| Tables in schema `public` | 0 (unchanged) |
| Backup file of the previous digests | 26 rows plus header, mode 600, outside the repo |

After the browser and API runs: `mock.users.4` and `mock.users.5` each have `num_logins` 1, `mock.users.7` has 2;
all three have `failed_attempts` 0, no lock and a `last_login_at`.

## Applied changes
- **Seed, applied 2026-10-27 to `v3_local` only, by the approved step ("seed with a password you generate")**:
  `surfaces.srp.auth.seed` set bcrypt digests on the 26 mock users that have a seat. The password was generated
  for this run and is in a private file in the agent's scratchpad, not in the repo or in chat. The previous
  digests are in `~/Documents/exp-v3/srp_cleanup_users_digests_backup_20261026.csv`.
- Login writes (`failed_attempts`, `locked_at`, `last_login_at`, `num_logins`) on `srp_cleanup.users` for users 4, 5, 7.
- No migration, no table, grant or function change; nothing applied to Supabase or any shared database.
- Code changes are uncommitted on branch `srp/local-login-srp-home`.

## What remains unverified
- **Not run against the real database:** the 5-miss lock, the 15-minute expiry, deactivated users, and a user with no
  seat (unit tests only).
- **Not run at all:** `python3 tools/lint/lint_all.py`; a CI run; the shared-core review for all Surfaces and the second
  approval for an identity change. The `canon-review` skill and a second-model review have run (see the spec); their
  fixes were applied after the browser click-through, so the browser check above was on the code before them. The
  fixed API was smoke-tested over HTTP, but the browser sign-in was not repeated.
- **Not built (reviewer findings left open):** per-IP/per-email rate limit, token revocation, a production guard for
  `LOCAL_AUTH_ENABLED`; lock-out of a known email remains possible by design.
- **Other seat pages that read `public` tables** (the location seat, the dashboard, interview data): `public` is empty in
  `v3_local`, so they were not exercised; the Happyflow pages are sample data and rendered.
- **Token handling:** `sessionStorage` is readable by script if the page has an XSS bug; there is no refresh token;
  the 8-hour lifetime and the signing-key handling were not reviewed by anyone else.
- **Production digests:** nothing shows they are bcrypt; the seed writes bcrypt itself.
- **Browsers other than the built-in pane, and mobile,** were not tried; timing equality of refusals was not measured.
- The click-through used a throwaway signing key and ports 8001/5174; it did not use the user's own API on 8000 or UI on 5173.

## Findings (Observe)
Each becomes a new intent, test or lint rule when picked up.
1. **No sign-out in the seat shell** (found in the click-through; fixed here): the only Sign out control was in the
   Admin layout. Added to the seat sidebar for the `api` provider, with `showSignOut` tested.
2. **"Viewing as Harper Jones · Return to Super Admin" bar** appears for a person signed in through the API: the seat
   layout registers an impersonation entry whatever the person's role. Misleading, since this person is not an administrator.
3. **Another person's seat URL** (`/seat/professional/19` while signed in as user 7): the API refuses the data (403) but the
   layout still draws the sample Happyflow home under a generic "Professional" title. No data leaks; it should say "not your seat".
4. **An unnamed external resource fails to resolve** (`ERR_NAME_NOT_RESOLVED` in the console); it is not Supabase and not
   an `/api` call; the host was not captured.
5. The 401 line in the console after a wrong password is the browser's own log of the refusal.
6. **Tooling gaps:** `tools/hooks/guard.py` and `tools/lint/` are missing from this checkout (every Write is blocked and
   the lint cannot run); three migration-security tests fail on the base.
7. The Profile page's sample content contains the words "Not found" four times (a sample status label, not an error).

## Follow-up (2026-10-27): the Happyflow screens show the signed-in professional
Asked for after the click-through: every screen said "Alex" (the sample persona) for every signed-in user. First the home,
then, after the same complaint about the other pages, all of them.
- **Change:** a persona context (`happyflow/persona.ts`, `persona-context.tsx`) built from the seat endpoint's `pro` row (first
  name, full name, job title, email, phone, slug). `personalize()` swaps the sample persona's name, email and site in demo text
  (a name-search look-alike becomes "<name> Jr."). Used by the home (day 1 and 7: greeting, NORA's hello, the sample review), the
  shell (hello, drafted-article byline), Profile (name, title, phone, email, bio draft), Settings (sign-off, a memory line, email,
  phone), Network (message sign-off), Website (header site, structured-data sample), Insights (competitor table), Find You (search
  box and results) and the NORA interview (scripted lines, sources list, headers). A real person without a job title gets none and
  never the sample NMLS number. The sample-data notice now says the name comes from the account.
- **Root cause of "Alex" on the other pages:** Profile, Settings and Find You build their starting state once, and the seat
  loads after the first render, so they froze with the sample name. The seat layout now holds a professional's pages until the
  seat has loaded (`utils/seat-wait.ts`); a failed load still shows the pages with the sample person.
- **Tests (written first):** `persona.test.ts` (mapping, merge, byline, notice, `personalize`), `persona-source.test.ts`,
  `screens/interview-persona.test.ts`, `utils/seat-wait.test.ts`, and a render test that every Happyflow screen, rendered for a
  real person, contains no "Alex". The Happyflow file-count guard went from 22 to 24 files. 194 UI tests pass; `tsc` for the app
  and `srp` is clean.
- **Browser** (signed in as `mock.users.7`, Harper Jones): zero "Alex" on home (day 1 and 7), Profile (Name "Harper Jones",
  Email the account's email), Settings (sign-off "— Harper"), Find You (search box "Harper Jones"), the NORA interview, Network,
  Website, Insights, SRS, Connections, Graph and Reviews.
- **Still sample on these screens:** the photo, company, market (Davenport), score, the Riverbend story and the rest of each
  screen's own demo content. The website address uses the seat's real slug, which in the mock data is a generated one. Saved demo
  edits to the profile are kept per browser (localStorage), not per user. Not tried in the browser: users other than 7.

## Change log
Not required: no DB function, table, trigger, cron or ETL change.
