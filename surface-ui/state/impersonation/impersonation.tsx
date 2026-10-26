/**
 * Impersonation framework — the "actor × context × surface" primitive.
 *
 * The store holds the acting-as stack. Entering a context PUSHES an actor; returning POPS back to
 * any ancestor, or all the way out to Super Admin. The stack is persisted in sessionStorage (see
 * persist-rules.ts) so it survives navigation and reloads within the tab, and it is intentionally
 * NOT shared across tabs.
 *
 * The shell swap itself is structural: impersonated surfaces render their own shell component
 * (EnterpriseShell / ScopedShell) instead of the admin ConsoleShell, so the admin left nav is never
 * present while impersonating.
 */
import { useCallback, useMemo } from "react";
import { impersonationActions } from "../actions";
import { useAppDispatch, useAppSelector, useAppStore } from "../hooks";
import type { Actor, ActorKind } from "../types";

export type { Actor, ActorKind } from "../types";

export const DEFAULT_RETURN = "/console";

type ImpersonationValue = {
  /** Outermost → innermost. Empty means "acting as yourself" (Super Admin). */
  stack: Actor[];
  actingAs: Actor | null;
  /** Admin route captured when impersonation began. */
  returnTo: string;
  isImpersonating: boolean;
  /** Push a new actor onto the stack. */
  enter: (actor: Actor, returnTo?: string) => void;
  /** Pop back to the actor at `index` (keeping it as the acting actor). */
  returnToIndex: (index: number) => Actor | null;
  /** Drop the whole stack and go back to Super Admin. */
  exit: () => string;
};

function useImpersonationValue(): ImpersonationValue {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const stack = useAppSelector((s) => s.impersonation.stack);
  const returnTo = useAppSelector((s) => s.impersonation.returnTo);

  const enter = useCallback(
    (actor: Actor, to?: string) => {
      const here =
        typeof window !== "undefined" ? window.location.pathname + window.location.search : DEFAULT_RETURN;
      dispatch(impersonationActions.entered({ actor, returnTo: to ?? here }));
    },
    [dispatch],
  );

  const returnToIndex = useCallback(
    (index: number) => {
      const target = store.getState().impersonation.stack[index] ?? null;
      dispatch(impersonationActions.returnedTo(index));
      return target;
    },
    [dispatch, store],
  );

  const exit = useCallback(() => {
    const to = store.getState().impersonation.returnTo || DEFAULT_RETURN;
    dispatch(impersonationActions.exited());
    return to;
  }, [dispatch, store]);

  return useMemo(
    () => ({
      stack,
      actingAs: stack[stack.length - 1] ?? null,
      returnTo: returnTo || DEFAULT_RETURN,
      isImpersonating: stack.length > 0,
      enter,
      returnToIndex,
      exit,
    }),
    [stack, returnTo, enter, returnToIndex, exit],
  );
}

export function useImpersonation(): ImpersonationValue {
  const enabled = useAppSelector((s) => s.access.enabled);
  const value = useImpersonationValue();
  if (!enabled) throw new Error("useImpersonation must be used inside the authenticated layout");
  return value;
}

/** Safe variant for components that may render outside the authenticated tree. */
export function useOptionalImpersonation(): ImpersonationValue | null {
  const enabled = useAppSelector((s) => s.access.enabled);
  const value = useImpersonationValue();
  return enabled ? value : null;
}

export const ROLE_FOR_KIND: Record<ActorKind, string> = {
  brand: "Enterprise Admin",
  office: "Location Manager",
  professional: "Professional",
};
