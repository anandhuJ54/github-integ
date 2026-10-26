// Public API of @v3/state. Surfaces read global state through these hooks and register their own
// slice with `injectSlice`; they never import another Surface or `shell`.
export { useAppDispatch, useAppSelector, useAppStore } from "./hooks";
export { injectSlice } from "./inject";
export { useSession } from "./session/use-session";
export { useAccess } from "./access/use-access";
export { getCurrentUser } from "./session/current-user";
export { useRole, useOptionalRole, ROLE_LABELS, grantScopeLabel } from "./access/roles";
export { useImpersonation, useOptionalImpersonation, ROLE_FOR_KIND } from "./impersonation/impersonation";
export type { AppDispatch, AppStore, AppThunk, RootState } from "./store";
export type * from "./types";
