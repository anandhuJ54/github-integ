/**
 * Contracts for the central store. Types only: the app-level reducers live in shell/state and each
 * Surface's own slice lives in <surface>/src/state, injected with `injectSlice` (see README.md).
 */

export type SessionStatus = "loading" | "authed" | "anon";

/** The signed-in user as the app sees it, whichever auth adapter produced it. */
export type SessionUser = {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

export type SessionState = { status: SessionStatus; user: SessionUser | null };

export type ControlRole = "super_admin" | "architect" | "analyst";

export type Grant = {
  id: string;
  role: ControlRole;
  scope_type: string;
  scope_id: string;
  is_primary: boolean;
  /** Human readable scope description, resolved on load. */
  scope_label?: string;
};

export type AccessState = {
  /** True while the authenticated layout is mounted; `useRole` throws without it, as before. */
  enabled: boolean;
  loading: boolean;
  grants: Grant[];
  activeGrantId: string | null;
};

export type ActorKind = "brand" | "office" | "professional";

export type Actor = {
  kind: ActorKind;
  /** Organization id (brand/office) or professional id. */
  id: string;
  name: string;
  /** Human label for the seat being occupied, e.g. "Enterprise Admin". */
  role: string;
  /** Route to return to when popping back to this actor. */
  path: string;
  /** Brand slug that owns the context (used to build enterprise routes). */
  orgSlug?: string | null;
  logoUrl?: string | null;
  photoUrl?: string | null;
  isDemo?: boolean;
};

export type ImpersonationState = { stack: Actor[]; returnTo: string };

/** State that exists in every session: registered by shell/state at start-up. */
export type AppState = {
  session: SessionState;
  access: AccessState;
  impersonation: ImpersonationState;
};

/**
 * Every slice the store can hold. A Surface adds its own with module augmentation, next to its slice:
 *   declare module "@v3/state/types" { interface LazyLoadedSlices extends WithSlice<typeof mySlice> {} }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LazyLoadedSlices extends AppState {}
