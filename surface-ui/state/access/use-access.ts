import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import type { ControlRole } from "../types";
import { logAudit, selectGrant } from "./thunks";

/** The user's grants, the active workspace and what it allows, the same for every Surface. */
export function useAccess() {
  const dispatch = useAppDispatch();
  const grants = useAppSelector((s) => s.access.grants);
  const activeGrantId = useAppSelector((s) => s.access.activeGrantId);
  const loading = useAppSelector((s) => s.access.loading);

  const activeGrant = useMemo(() => grants.find((g) => g.id === activeGrantId) ?? null, [grants, activeGrantId]);

  const setActiveGrant = useCallback((grantId: string) => void dispatch(selectGrant(grantId)), [dispatch]);
  const setActiveRole = useCallback(
    (role: ControlRole) => {
      const g = grants.find((x) => x.role === role);
      if (g) setActiveGrant(g.id);
    },
    [grants, setActiveGrant],
  );

  return useMemo(() => {
    const activeRole = activeGrant?.role ?? null;
    const canEdit = activeRole === "super_admin" || activeRole === "architect";
    return {
      grants,
      activeRole,
      activeGrant,
      setActiveRole,
      setActiveGrant,
      canEdit,
      isSuperAdmin: activeRole === "super_admin",
      isReadOnly: !canEdit,
      logAudit: (action: string, target?: string | null, details?: Record<string, unknown>) =>
        logAudit(action, target, details),
      loading,
    };
  }, [grants, activeGrant, setActiveRole, setActiveGrant, loading]);
}
