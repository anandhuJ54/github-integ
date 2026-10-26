import { getAuthProvider } from "../auth";
import type { SessionUser } from "../types";

/**
 * The signed-in user right now, for code that is not a component (utilities, event handlers, mutations).
 * Components use `useSession()` instead. Reads through the auth adapter, so it needs no store.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getAuthProvider().getSession())?.user ?? null;
}
