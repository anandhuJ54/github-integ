import { useMemo } from "react";
import { useAppSelector } from "../hooks";
import { useSession } from "../session/use-session";
import type { ControlRole, Grant, SessionUser } from "../types";
import { grantScopeLabel } from "./thunks";
import { useAccess } from "./use-access";

export type { ControlRole, Grant } from "../types";
export { grantScopeLabel };

export const ROLE_LABELS: Record<ControlRole, string> = {
  super_admin: "Super Admin",
  architect: "Architect",
  analyst: "Analyst",
};

type RoleContextValue = ReturnType<typeof useAccess> & {
  user: SessionUser | null;
  signOut: () => Promise<void>;
};

function useRoleValue(): RoleContextValue {
  const access = useAccess();
  const { user, signOut } = useSession();
  return useMemo(() => ({ ...access, user, signOut }), [access, user, signOut]);
}

export function useRole(): RoleContextValue {
  const enabled = useAppSelector((s) => s.access.enabled);
  const value = useRoleValue();
  if (!enabled) throw new Error("useRole must be used inside the authenticated layout");
  return value;
}

/** Safe variant for components that may render outside the authenticated tree. */
export function useOptionalRole(): RoleContextValue | null {
  const enabled = useAppSelector((s) => s.access.enabled);
  const value = useRoleValue();
  return enabled ? value : null;
}
