# state — the central store

One Redux store for the whole app. `state/` holds the contracts and the plumbing; the reducers live
with whoever owns the data, and there are **no slices in this folder**.

| Where | What |
|---|---|
| `state/` | `store.ts` (the store, starts empty), `inject.ts`, `hooks.ts`, `actions.ts` and `types.ts` for the app-level state, `persist.ts`, `auth/` (the auth adapter), `api/server-fn.ts` |
| `shell/state/` | the reducers for the app-level state (session, access, impersonation) and `registerAppState()` |
| `<surface>/src/state/` | that Surface's own slice (add it when the Surface has state worth keeping) |

## What a Surface uses
```ts
import { useSession, useAccess, useAppSelector, useAppDispatch } from "@v3/state";

const { user, status, signOut } = useSession();
const { activeRole, canEdit, activeGrant } = useAccess();
```
`useRole()` and `useImpersonation()` still work as before; they now read this store.

## What goes in the store (and what doesn't)
| Kind of state | Where it lives |
|---|---|
| Data from the API (lists, records, counts) | **React Query** (`useQuery` / `useMutation`), never the store. One cache, refetched and invalidated in one place. |
| Browser-only state of one Surface (filters, wizard step, open panel, unsaved draft) | that Surface's slice in `<surface>/src/state/` |
| Who is signed in, the active grant and role, impersonation | the app-level slices (`useSession`, `useAccess`) |

A Surface's `src/state/` makes no API calls (`api.get/post`, `serverFn`, `fetch`, `createAsyncThunk`).
The store is not a security control: the API and the database check every permission.

`surface-ui/state/boundaries.test.ts` (run by `bun test`, in `core-gates`) checks that:
- a Surface imports only `@v3/shared`, `@v3/state`, `@v3/theme` and itself, never another Surface or `@v3/shell`;
- `shared/`, `state/` and `theme/` import no Surface and no shell;
- a Surface's slice is named after its folder, and its selectors read only its own slice plus
  `session`, `access` and `impersonation`;
- a Surface's `src/state/` loads no API data.

**Needs a decision:** the app-level access state calls admin's API (`GET /admin/me/grants`,
`POST /admin/me/bootstrap`, `POST /admin/me/audit` in `access/thunks.ts`), so shared core depends on the
admin Surface. Options: record it as the one shared-core exception, or serve `/me/*` from `surface-api/_base`.
Until then, keep any new identity call out of `state/` (see `surface-spec/_base/CONTEXT.md`).

## Adding a Surface slice
```ts
// campaigns/src/state/campaigns.slice.ts
import { createSlice, type WithSlice } from "@reduxjs/toolkit";
export const campaignsSlice = createSlice({ name: "campaigns", initialState: { filter: "" }, reducers: { /* ... */ } });

declare module "@v3/state/types" {
  interface LazyLoadedSlices extends WithSlice<typeof campaignsSlice> {}
}

// campaigns/src/state/index.ts: registered the first time the Surface's code loads
import { injectSlice } from "@v3/state";
export const campaigns = injectSlice(campaignsSlice);
```
The slice's `name` is the Surface's folder name. A Surface reads only its own slice and the app-level
state; it never reads or dispatches another Surface's slice.

## Auth adapter
`auth/auth-provider.ts` is all the app needs from sign-in (`getSession`, `getAccessToken`,
`signOut`, `onChange`). `adapters/supabase` is the temporary adapter and the default;
`adapters/api.ts` is the target and returns `not_implemented` until the API's login exists. Switch
with `setAuthProvider()` in `shell/main.tsx`.

## What is remembered across a reload
Only what `persist-rules.ts` lists: the active grant (`exp.activeGrant`), its role (`exp.activeRole`)
and this tab's impersonation stack (`xp.impersonation.v1`, sessionStorage). The session and the token
are never persisted here: on load, `bootstrapSession` asks the auth adapter for them, and the route
guard waits (`whenSessionReady`) instead of redirecting.
