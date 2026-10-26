import { useCallback, useMemo } from "react";
import { getAuthProvider } from "../auth";
import { useAppSelector } from "../hooks";

/** The signed-in user and sign-out, the same for every Surface. */
export function useSession() {
  const status = useAppSelector((s) => s.session.status);
  const user = useAppSelector((s) => s.session.user);

  const signOut = useCallback(async () => {
    await getAuthProvider().signOut();
    if (typeof window !== "undefined") window.location.href = "/auth";
  }, []);

  return useMemo(() => ({ status, user, signOut }), [status, user, signOut]);
}
