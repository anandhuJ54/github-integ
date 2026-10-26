# Spec: Move the Happyflow professional-seat UI into surface-ui/srp

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · contracts: none for this increment (no endpoint, event or capability is added or changed; `contracts/srp` is untouched)

Source for the port: `experiencesrp-clone`, branch `srp-1.0`, base `2993fcb`, **uncommitted working tree**.
Target: `surface-ui/srp/src/`.

## Behaviour
All behaviour below is deterministic UI code. No model decides anything, and no screen reads or writes the backend.
Every Happyflow screen renders demo constants from `components/happyflow/demo-data.ts`.

### Who sees what
`useSeatParams()` (`routes/_authenticated/seat.$kind.$id.tsx:27`) gives `isPro = kind === "professional"`.
- **Professional seat (`/seat/professional/$id/*`)**: Happyflow screens, as below.
- **Location seat (`/seat/office/$id/*`)**: unchanged. It keeps `LOCATION_NAV` and today's live pages.

### Routes (all under `/_authenticated`, same URLs as in the clone)
| URL (`/seat/$kind/$id` + suffix) | Professional seat | Location seat |
|---|---|---|
| `` (index) | `HomeDay1Screen`; with `?day=7` or `?day=24` `HomeDay7Screen` (`?events=1` adds the events view); `?from=` is kept | Live `LocationOverview` (unchanged) |
| `/nora` | `SrsScreen` (Search Rank Score, demo data) | "Not available" empty state |
| `/profile` | `ProfileScreen` (**new**) | "Not available" empty state |
| `/insights` | `InsightsScreen` (**new**) | "Not available" empty state |
| `/website` | `WebsiteScreen` (**new**; "PRO" pill in nav) | "Not available" empty state |
| `/connections` | `ConnectionsScreen` (**new**) | "Not available" empty state |
| `/network` | `NetworkScreen` (**new**) | "Not available" empty state |
| `/settings` | `SettingsScreen` (**new**) | "Not available" empty state |
| `/find` | `FindYouScreen` (**new**) | "Not available" empty state |
| `/interview` | `InterviewScreen` (Happyflow, demo) | Live skill-run interview (unchanged) |
| `/graph` | Existing live graph summary, plus **"Full radial view"** now opens the expertise graph inside the seat (embedded, with a back button) instead of a new tab | Unchanged |
| `/reviews` | Existing live reviews page (unchanged); nav shows it as locked | Unchanged |
| `/team`, `/listings`, `/multi-post`, `/reporting` | Unchanged | Unchanged |

Index `validateSearch`: `day` is kept only if it is 7 or 24; `events` only if it is 1 or "1"; `from` only if a string.

### Navigation inside Happyflow
`seat-nav.ts` (`useHfNav`) maps screen targets onto the routes above: `home`, `day7`, `events`, `recap` → index with
`day`/`events`; `srs` → `/nora`; `find`, `interview`, `reviews`, `profile`, `connections`, `website`, `insights`,
`network`, `settings` → the same-named suffix. `kind` and `id` come from the current route, defaulting to
`professional` and `""`.

### Seat shell (`components/seat/scoped-shell.tsx`)
- `NavItem` gains `locked?` (lock icon, page still opens) and `pro?` (orange "PRO" pill).
- `ScopedShell` gains `hideHeader` (drops the top search/subtitle bar). It is set for professional seats only.
- `PRO_NAV` becomes: Home (`""`), SRS (`/nora`); then Profile, Insights, Website Analytics (`pro`), Expertise Graph,
  Reviews (`locked`), Connections, Network; then Settings; and the NORA interview entry stays reachable
  (final order and grouping are copied from the clone's `enterprise-shell.tsx`, not re-decided here).
- `LOCATION_NAV` and `PROFESSIONAL_NAV_LABELS`/`LOCATION_NAV_LABELS` exports keep working.

### Browser-only state (the only persistence)
| Key | Store | Used by | Content |
|---|---|---|---|
| `hf-device` | `sessionStorage` | `use-hf-device.ts` | Device-frame override, survives moving between Happyflow screens |
| `hf-demo-profile` | `localStorage` | `screens/profile.tsx` | Demo profile edits, only in this browser; never sent anywhere |

Both reads and writes must be wrapped so a throwing or empty storage does not break the screen (storage can be
blocked or cleared). `use-speech.ts` uses the browser Web Speech API when present and must do nothing when it is not.

### Feature flags (copied as they are in the clone)
`HF_NORA_UI = false` (NORA actions show a "NORA picks this up once the NORA OS package is connected" toast) and
`HF_DEMO_BAR = false`. They stay false; they are not wired to entitlements here.

### Styling
`happyflow.css` is scoped under `.hf-root` with `hf-*` keyframes; layout and colour are mostly inline in the
components. It is imported by the Happyflow shell. `expertise-graph-light.css` is imported by the graph page.
Fonts (Manrope, Sora) are already loaded by `shell/root.tsx`, and the tokens `--color-ink`, `--color-ink-2`,
`--color-ink-3`, `--color-hairline`, `--color-g-blue` and `--color-g-blue-soft` already exist in
`surface-ui/theme/css/tokens.css`. If the port finds another token missing, it is defined in the scoped CSS, never in `@v3/theme`.

### Port transformations (mechanical, no behaviour change)
- `@/components/ui/*` → `@v3/shared/components/ui/*`; `@/components/console/primitives` → `@v3/shared/components/ui/console-primitives`;
  `@/components/sales/entity-avatar` → `@v3/shared/components/ui/entity-avatar`; `@/lib/utils` → `@v3/shared/components/utils/utils`.
- `@/components/seat/*` → `@v3/srp/components/seat/*`; `@/lib/seat` → `@v3/srp/utils/seat`; `@/components/happyflow/*` → `@v3/srp/components/happyflow/*`;
  `@/components/graph/*` → `@v3/srp/components/graph/*`; `@/assets/happyflow/*` → `@v3/srp/assets/happyflow/*`.
- `createFileRoute` stays; route ids stay `/_authenticated/seat/$kind/$id/...`.
- The expertise-graph page and canvas are copied from `surface-ui/search` (the v3 versions, whose imports are
  `@v3/search/...`, rewritten to `@v3/srp/...`) into `surface-ui/srp/src/components/graph/`, together with the loader
  `utils/expertise-graph.ts`, and then the clone's Happyflow changes are applied (`embedded`, `onBack`, ring highlight /
  `highlightBranch`, `expertise-graph-light.css`). The clone's own copies are not used because they read the browser database.

## Acceptance criteria
Numbered; each becomes a test or a recorded manual check.
1. All 7 new routes exist under `surface-ui/srp/src/routes/_authenticated/` and appear in the regenerated
   `shell/.generated/routeTree.gen.ts` at the URLs in the route table.
2. For `kind = professional`, each route in the table renders its Happyflow screen; for `kind = office`, the
   index, interview and graph pages are exactly today's pages, and the seven pro-only routes show the "Not available" empty state.
3. `?day=7`, `?day=24` and `?events=1` on the seat index select the correct home screen; any other `day` value
   falls back to day 1.
4. `useHfNav` maps every `HfRoute` to the URL in "Navigation inside Happyflow" (unit-tested against a fake navigate).
5. The professional nav shows Home, SRS, Profile, Insights, Website Analytics with a PRO pill, Reviews with a lock,
   Connections, Network, Settings; the header bar is hidden for professionals and shown for locations.
6. "Full radial view" on the graph page opens the expertise graph inside the seat and its back button returns to the summary.
7. Source guard: no file under `surface-ui/srp/src/components/happyflow/` or the seven new routes contains
   `supabase`, `createServerFn`, `fetch(`, `@tanstack/react-start`, an `@/` import, or an import of another Surface or `@v3/shell`.
8. `surface-ui/state/boundaries.test.ts` still passes; no `@v3/<other-surface>` import is added.
9. `cd surface-ui && bunx tsc --noEmit -p .` and `bunx tsc --noEmit -p srp` pass; `bun test` passes; `bun run build` succeeds.
10. With storage blocked (throwing `getItem`/`setItem`), the profile and device-override code does not throw (unit test on the helpers).
11. No change to `contracts/`, `surface-api/`, `surface-ui/search|shared|state|theme|shell` other than the regenerated route tree
    (`git diff --stat` against `main` recorded in `evidence.md`).
12. The embedded graph loads only through `api.get("/graph/expertise/{kind}/{slug}")`; with no data it shows the page's
    "not yet captured" state and does not crash (unit test on the loader mapping if it is pure, otherwise manual).
13. Visual parity: for each professional route, a screenshot in the v3 app matches the clone at the same width, with
    differences listed in `evidence.md` (manual; cannot be automated with the current test setup).

## Data
- **Tables and schemas read or written: none.** No SQL, no ORM, no `/srp/*` call is added by Happyflow. Existing
  seat/dashboard queries keep working for the location seat and for the pro pages that stay live (graph, reviews).
- **New objects:** none in the database. New frontend files only; each is checked against existing code in `plan.md`
  (extend-never-duplicate). The graph copy is the one deliberate duplicate (see Decision log).
- **Migration intent:** none. No backup, JOIN verification or `docs/ETL-Enhancements.md` entry is needed.
- **Provenance / trust tier:** not applicable; no fact is written. Demo values on screen are not real data and
  must not be presented as verified scores.
- **The embedded graph is the one screen that reads data.** The clone's graph page loads through browser-database
  code, which is not allowed here. The v3 version (`surface-ui/search/src/utils/expertise-graph.ts`, 417 lines) loads
  through `api.get("/graph/expertise/{kind}/{slug}")`, an existing published endpoint (`contracts/graph/openapi.json`)
  that `search` already uses; srp already calls other Surfaces' published endpoints the same way
  (`/graph/fn/getCategoryBrief`). So the srp copy takes the **v3 loader from `search`** plus the clone's Happyflow
  changes to the page and canvas, and adds no endpoint. Reads are by the professional's `slug` (`seat.pro.slug`).

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | None. Demo constants only. |
| Capabilities | None added. NORA actions are disabled (`HF_NORA_UI = false`). |
| Events | None emitted or consumed. |
| Entitlement | None enforced. The "PRO" pill and the lock icon are labels only, not gates. Real entitlement is a later increment. |
| Explanation | None. Screens must not claim a real score or ranking. |
| Value loop | Not wired. Recorded as a follow-up intent when Happyflow gets real data. |

## Security and scope
- **Principal and scope:** unchanged. The pages stay under `/_authenticated`, so the shell's session guard and
  `AccessGate` apply. Seat scoping (`kind`, `id`, impersonation "viewing as") is unchanged.
- **Hiding UI is not security** (`AGENTS.md` §2): the pro-only empty state for office seats is a convenience; there is
  no data behind these screens to protect. When real data is wired later, the server must authorise it.
- **No secrets, no PII:** demo data and images are the clone's own; confirm no real person's data or credentials are
  in `demo-data.ts` and the images before merge (listed in `evidence.md`). Names in demo data are business data, not code names.
- **Untrusted input:** `?day`, `?events`, `?from` are validated by `validateSearch`; `localStorage` content is parsed
  defensively and discarded if malformed.
- **RLS, grants, tables:** no impact; no database object is touched.

## Compliance
No AI-generated or published content leaves the browser; nothing is sent, posted or replied. `content_compliance_rules`
and `exp_category_compliance` do not apply here. Before real data is wired, any screen copy that states a score,
rank or review claim needs the server-side compliance pass. Real-estate and mortgage rules (Fair Housing, RESPA/TILA)
are not engaged by demo screens, but no demo copy should guarantee price, sale or rate outcomes; this is checked by
reading the copied copy once and recorded in `evidence.md`.

## Canon review
To be filled by the `canon-review` skill before the PR. Conflicts already visible, flagged and not resolved:
- **AGENTS.md §4 "No restyling or design-system work until the final reskin":** Happyflow is a new design. It is
  brought in scoped, with no theme or shared edits. Needs a reviewer's confirmation.
- **Extend, never duplicate:** copying the expertise-graph components into srp duplicates `surface-ui/search`. Alternative
  (promote to `@v3/shared`) is a shared-core change and is not proposed.
- **Open decision O1 (rings):** the SRS screen shows demo ring/score values only; no ring logic is written.
- **Hard rule "No people's names, roles or titles":** demo-data personas use business-style names; the review will scan the
  copied files and comments for named individuals and replace them with generic labels if found.

## Second-model review
Not yet run. To be done on this spec before approval of `plan.md`; the summary and how disagreements were reconciled go here.

## Decision log entries
| Date | Decision | What it blocks |
|---|---|---|
| 2026-10-26 | Scope is Happyflow only; dashboard, claim and public pages are not re-ported | Re-porting other tiers needs a new intent |
| 2026-10-26 | Ships as UI only on demo data; no API or contract change | Real data and entitlement are a later increment |
| 2026-10-26 | Graph components are copied into srp rather than promoted to `@v3/shared` (proposed, confirmed with the intent) | De-duplication with `search` is a later shared-core PR |
| 2026-10-26 | Spec files were written through the shell because the edit-guard hook script `tools/hooks/guard.py` is missing from the checkout | Restoring the hook is a separate shared-core fix |
