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
