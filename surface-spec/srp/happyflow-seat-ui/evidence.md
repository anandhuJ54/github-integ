# Evidence: Move the Happyflow professional-seat UI into surface-ui/srp

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md) · PR: not opened yet

## Source freeze (task 0, 2026-10-26)
Port source: `/Users/anandhu/Documents/Projects/experiencesrp-clone`, branch `srp-1.0`, HEAD `2993fcbc6f3ed42af2708a6289c9dbab80ca0693`.
The Happyflow work is **uncommitted** in that tree (24 `git status` entries, including unrelated untracked files that are not ported:
`.claude/`, `.pnp.cjs`, `.pnp.loader.mjs`, `.yarn/`, `yarn.lock`, `ai-native-features.xlsx`). SHA-256 of the 40 files that are
copied or merged, relative to the clone root. Any later change to these in the clone means the port is out of date:

```
1d5fa52f366e4023d6bd352e82e85a028d6da8fec86b5188223b0297b7af1faa  src/assets/happyflow/dana-tampa.jpg
6e662587b3117ee75901d597e905e75e912deb61bd44ac01e9da2f3507f0dc26  src/assets/happyflow/dana-whitfield.jpg
1bed01d870aafc0f6973e5fda3062ec38bd7f1d768cfc98226b6aeab9990ca3e  src/assets/happyflow/dana-whitley.jpg
12b44a163ebd38687e8d90f6e8b2f652ef03158a78f4067b847cb32dd2e0d0c5  src/assets/happyflow/experience-icon.png
9c514b173331705eef1a1fa4eef75ed9b5308d3115ec1892b1699171493a0a97  src/components/enterprise/enterprise-shell.tsx
1de589df7324cc499ce35a4e7f9228101c9e07ef4963ce08bfb21957dadfd10b  src/components/graph/expertise-graph-canvas.tsx
455aa29612781ea30d7ce4b3cb62eda7c063b98f8dd7f0c2cb09947f1127d913  src/components/graph/expertise-graph-light.css
d6dfb21a6cfb84a76a08e9f3165365b4040733e17772600cb3c23efa1ea1a009  src/components/graph/expertise-graph-page.tsx
c1329a2b39a25aab2fb4609b0b2bcc23a53d42f0f16d2502f8d18d75897da2b1  src/components/happyflow/demo-data.ts
0c405b3a673710e1bae4e76935a0e8c06b0d2f2a448e6fd1633e65682d982eb1  src/components/happyflow/happyflow.css
e57ef017abbe5385b84ab9f291638574a59698334bea8bd73981f53b8647aa7f  src/components/happyflow/icons.ts
982c78ef2d7991da64bad39de14715d03ef68cd8feb60608ca649dcef48fffb5  src/components/happyflow/primitives.tsx
24f9932eb09894994b1d0c979fd5b64777f8194b177db5c84195d02752c59bd2  src/components/happyflow/screens/connections.tsx
b67222f242b7e0cecae02306080cb68d4a7854a381d304dcc5356f5b0b0b5b99  src/components/happyflow/screens/find-you.tsx
abcf810b944dfbfcb53f59cd04e81a380b5b9c6d56d2e91addac79a06a639bd1  src/components/happyflow/screens/home-day1.tsx
97ed715d7c83f294221cd374542fd776846aef6003bd5b5dede265ddb2c2d01a  src/components/happyflow/screens/home-day7.tsx
4dfa9c18fab7bd11d1a793f460726611aee1bb8c9618f6cb5dac81abeef5549c  src/components/happyflow/screens/insights.tsx
92badad2c7d4e11e26ac2a568cf7a66bf6f301eecd58f7d4fcab25b764669aab  src/components/happyflow/screens/interview-engine.ts
359031250bf2276f01254cfcf5988a22c9f8da5d2e6fe550d197bcd6456a9aec  src/components/happyflow/screens/interview.tsx
f537e6fcf1480c5504f4310d4483edb96dadb676f7e9d73bd8287a1ec49ba2c4  src/components/happyflow/screens/network.tsx
e535e1ae96e471afadfed8661f376d829dcea642c93e46485d06c4f46dca7aa6  src/components/happyflow/screens/profile-voice.ts
894b1f651b51974ce43419948f7a994fcc14b9bd43c6dc58b733dd10dce742a4  src/components/happyflow/screens/profile.tsx
5e141299c85110f7da6a2ef164319a41806441129e89fa018e05ef130eeddf89  src/components/happyflow/screens/settings.tsx
c5e613a2fbf157180adc16f5024b99aa12e3664c571d5e89608cd47f26a7538d  src/components/happyflow/screens/srs.tsx
a1c61b9ffba8c8f8e2420c6f7aee50e80dcfdf115aec712590ec7f4136013ee6  src/components/happyflow/screens/website.tsx
fd11201763a1e150072ce25ab0e7c918242c05ddc1ac387acc35a49826e5f93d  src/components/happyflow/seat-nav.ts
46d46341d8a01cd8c00a805c8177cced596f1cecc79e293aec1181aa63b735c2  src/components/happyflow/shell.tsx
e315e0d4432755fceab11824e153f4d335cd799f2c2725c451f98f1204d52980  src/components/happyflow/use-hf-device.ts
d7f5916815ceb0d7d13a96cc8659349f28940c9ccd98af1a0bce2c93dbd5c8a3  src/components/happyflow/use-speech.ts
5519bfd5ca25d226682125fedba80d394fa8691297a02d690ad838f821a7d2a7  src/routes/_authenticated/seat.$kind.$id.connections.tsx
7490d6adfd7d6fc244058cdf72f4e9fd4bf999fccde2ce8bf3f15dc2bc50871a  src/routes/_authenticated/seat.$kind.$id.find.tsx
2a364b011ecdad205a67d572161116563b32be89a71d2eed9828137302fa517e  src/routes/_authenticated/seat.$kind.$id.graph.tsx
fcb87852e3b8d34c2a82a1c16b1c5f2b963ae4c66a7f2d75c9d924aaba616740  src/routes/_authenticated/seat.$kind.$id.index.tsx
07017da1ff74a0cad51a317601fc9721f3ad3797fa9ad3997177817f36db1d07  src/routes/_authenticated/seat.$kind.$id.insights.tsx
51207c59c5136d36f39c185423252d16e55abb413a5af67d5883b8e0b422553b  src/routes/_authenticated/seat.$kind.$id.interview.tsx
9caf1a65a9a62167a53fde58c9f24785055a83175b1aa861a131188a110add31  src/routes/_authenticated/seat.$kind.$id.network.tsx
519502a672bdb0a950636d5566fa1f59dadc046383f5e1672b84491ac85262f9  src/routes/_authenticated/seat.$kind.$id.nora.tsx
28456ea4cb1d638505d688705218714f60fd0cf5af627b54be31288fe1b10ef8  src/routes/_authenticated/seat.$kind.$id.profile.tsx
fa6a506533974edfe6d12373a6cef3c2744044d065a47c270dfc12a4b0cd79d7  src/routes/_authenticated/seat.$kind.$id.settings.tsx
4afd326c434439b70b1053db85af6b3cb27f730fcb08ae08afcdda78838030dc  src/routes/_authenticated/seat.$kind.$id.website.tsx
```

## Acceptance criteria results
Run on branch `srp/happyflow-seat-ui` on 2026-10-26, locally. No browser run: every `/seat/*` page is behind sign-in and I did not sign in.

| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | 7 new routes exist and are in the route tree | `bun run build` regenerated `shell/.generated/routeTree.gen.ts`: +161 lines, 0 removed, paths `/connections /find /insights /network /profile /settings /website` under `/seat/$kind/$id` | PASS |
| 2 | Pro seat shows Happyflow; office seat unchanged, pro-only routes show "Not available" | Read in the code (`isPro` gates in the seven routes, index, nora, interview; the office paths still render `LocationOverview` and the live interview) and confirmed by the independent review. No test and no browser check | NOT VERIFIED BY A TEST |
| 3 | `?day` / `?events` / `?from` handling | `utils/overview-search.test.ts` (3 tests). Day 7/24 → `HomeDay7Screen` read in the code only | PASS for the validation; selection not tested |
| 4 | `HfRoute` → URL mapping | `components/happyflow/seat-nav.test.ts` on the pure `hfNavTarget`. The `useHfNav` hook itself is not tested | PASS for the mapping |
| 5 | Pro nav items, PRO pill, lock, header hidden for pros | `components/seat/scoped-shell.test.ts`: labels and order, pill/lock flags, every suffix is a real route file, office nav unchanged. `hideHeader` is not tested | PASS except header; not seen visually |
| 6 | "Full radial view" opens in the seat and back returns | Ported from the clone; no test, not run | NOT VERIFIED |
| 7 | No supabase / server fn / fetch / `@/` / cross-Surface import | `src/happyflow-guard.test.ts` over `components/happyflow/` and the 7 routes; also `bun test` boundary guard. Does not scan `components/graph/` or `utils/expertise-graph.ts` | PASS for the scanned files |
| 8 | Boundary guard still passes | `surface-ui/state/boundaries.test.ts` inside `bun test` | PASS |
| 9 | tsc, tests, build | `bunx tsc --noEmit -p .` exit 0; the loop over all 15 `surface-ui/*/tsconfig.json` exit 0; `bun test` 95 pass, 0 fail; `bun run build` built. Test files are excluded from `tsc` (see below) | PASS |
| 10 | Blocked storage does not throw | `use-hf-device.test.ts`, `screens/profile-store.test.ts` (also malformed and wrong-shaped content) | PASS |
| 11 | No change outside srp, route tree and spec | `git diff main --stat -- surface-api contracts docs` is empty; changed paths are `surface-ui/srp` (52 files), `surface-ui/shell/.generated/routeTree.gen.ts`, `surface-spec/srp` (4) | PASS |
| 12 | Graph loads only via `/graph/expertise/...`, no data is handled | `utils/expertise-graph.test.ts` (3 tests: URL, null → null, empty rows). The embedded page with no data was not looked at | PASS for the loader |
| 13 | Visual parity with the clone | Not done | NOT DONE |

Also added, beyond the spec: `components/happyflow/screens/render.test.ts` renders all 13 screen variants on the server inside a router
(first render only; no clicks or effects) and requires distinct markup per screen.

Deviations from test-first: tasks 6 (nav), 7 (graph loader) and the render test were written after or with the code, not before; tasks 1-5 and the
route/search tests were written first and failed for the right reason.

## Source freeze (task 0, 2026-10-26)
Port source: `/Users/anandhu/Documents/Projects/experiencesrp-clone`, branch `srp-1.0`, HEAD `2993fcbc6f3ed42af2708a6289c9dbab80ca0693`.
The Happyflow work is **uncommitted** in that tree (24 `git status` entries, including unrelated untracked files that are not ported:
`.claude/`, `.pnp.cjs`, `.pnp.loader.mjs`, `.yarn/`, `yarn.lock`, `ai-native-features.xlsx`). The SHA-256 list of the 40 files copied or merged is
in the earlier version of this file (commit `9e9e4b6`). Re-checked after the port: all 40 hashes still match, so the copy is current as of 2026-10-26.
The graph files were not taken from the clone's tree as is: the page and canvas come from the clone with imports rewritten, the loader from `surface-ui/search`
(the clone's loader reads the browser database).

## CI gates
No CI run yet: no PR is open. Local runs of the same commands (2026-10-26):
- `cd surface-ui && bunx tsc --noEmit -p .` and `-p <each surface>`: all exit 0.
- `cd surface-ui && bun test`: 95 pass, 0 fail.
- `cd surface-ui && bun run build`: built.
- `cd surface-api && uv run ruff check .`: all checks passed.
- `cd surface-api && uv run pytest`: 1608 pass, **3 fail**. The three are `test_new_tables_are_closed_to_anon_by_grants` for `_base` (`survey_sources`),
  `campaigns` (`campaigns_tables`) and `xmp` (`xmp_tables`): those migrations lack a `REVOKE ALL ... FROM anon, authenticated, PUBLIC`. This branch changes nothing under
  `surface-api/`, so they fail on the base too (I did not run them on `main` separately). They will likely block `core-gates` until fixed elsewhere.
- `python3 tools/lint/lint_all.py`, `tools/ci/*` and `tools/hooks/guard.py` are **not in this checkout**; not run.

## Evals (Skills / NORA / AI output only)
None: no model output is involved.

## Live verification (data changes only)
None: no data or database object changed.

## Applied changes
None applied to any database, config or environment. Files changed in the working tree only; commits are local and unpushed. The spec folder and plan file were written through the shell because the repo's edit-guard hook script is missing (approved in chat).

## What remains unverified
- **Nothing was seen in a browser.** No click-through of the 11 professional routes or the office seat, no screenshots against the clone (criteria 2, 5 visuals, 6, 13). Needs a signed-in session.
- Untested logic: the `useHfNav` hook, `hideHeader`, index `day` → screen, the "Not available" gating, the radial-view open/back flow, and the embedded graph with no data.
- Test files are not type-checked: `srp/tsconfig.json` excludes `*.test.ts` (as the root config does) because bun types are not installed.
- The render test covers a server first render only: no effects (so the day-7 `events` view), no clicks, no Web Speech, no fonts, no `HF_EMBED_HEIGHT` fit in the real layout.
- `/graph/expertise/{kind}/{slug}` was only called against a stub; whether a seat session can reach it live is unchecked.
- CI is unknown: `tools/lint`, `tools/ci` and the guard hook are absent here, and 3 unrelated backend tests fail locally.
- Known clone behaviour carried over unchanged: `use-speech.ts` can show "not listening" after a fast stop-then-start; the desktop layout switches at a 1024 px window although the seat sidebar leaves ~784 px; `?from=` is kept only on the home links.
- Demo copy was not read line by line for rate, price or ranking claims (compliance).
- **Open rulings (see spec "Canon review"): showing demo values to a real professional without a label; the SRS screen counts 11 lanes where the scorer has 10 (O1); the persona name "Dana Whitfield" in code and copy.** The port is blocked from merge on these.
- The second-model review did not read the screen code beyond its diff against the clone.

## Change log
Not required: no DB function, table, trigger, cron or ETL code changed.
