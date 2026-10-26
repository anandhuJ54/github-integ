import { sessionActions } from "../actions";
import { getAuthProvider, type AuthSession } from "../auth";
import type { AppStore } from "../store";
import type { SessionState } from "../types";

/**
 * Restore the session on page load and keep the store in step with the auth adapter afterwards.
 * Until it resolves the session status is "loading", so route guards wait instead of redirecting.
 * Returns the unsubscribe.
 */
export function bootstrapSession(store: AppStore): () => void {
  const provider = getAuthProvider();
  const apply = (session: AuthSession | null) => {
    store.dispatch(session ? sessionActions.signedIn(session.user) : sessionActions.signedOut());
  };

  const unsubscribe = provider.onChange((event, session) => {
    if (event === "TOKEN_REFRESHED") return;
    apply(session);
  });
  provider.getSession().then(apply, () => apply(null));
  return unsubscribe;
}

/** Resolves with the session once it is no longer "loading". */
export function whenSessionReady(store: Pick<AppStore, "getState" | "subscribe">): Promise<SessionState> {
  return new Promise((resolve) => {
    if (store.getState().session.status !== "loading") {
      resolve(store.getState().session);
      return;
    }
    const unsubscribe = store.subscribe(() => {
      const session = store.getState().session;
      if (session.status === "loading") return;
      unsubscribe();
      resolve(session);
    });
  });
}
