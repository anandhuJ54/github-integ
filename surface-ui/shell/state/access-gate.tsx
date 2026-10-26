import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { accessActions } from "@v3/state/actions";
import { grantScopeLabel, ROLE_LABELS } from "@v3/state/access/roles";
import { loadAccess, selectGrant } from "@v3/state/access/thunks";
import { useAppDispatch, useAppSelector } from "@v3/state/hooks";
import type { Grant, SessionUser } from "@v3/state/types";

/**
 * Loads the signed-in user's grants and asks them to pick a workspace when they have more than one.
 * It renders nothing until access is enabled, so `useRole` never runs before the state exists.
 */
export function AccessGate({ user, children }: { user: SessionUser; children: ReactNode }) {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector((s) => s.access.enabled);
  const loading = useAppSelector((s) => s.access.loading);
  const grants = useAppSelector((s) => s.access.grants);
  const activeGrantId = useAppSelector((s) => s.access.activeGrantId);

  useLayoutEffect(() => {
    dispatch(accessActions.enable());
    return () => {
      dispatch(accessActions.disable());
    };
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;
    void dispatch(loadAccess(() => !cancelled));
    return () => {
      cancelled = true;
    };
  }, [dispatch, user.id]);

  if (!enabled) return null;

  const activeGrant = grants.find((g) => g.id === activeGrantId) ?? null;
  const showChooser = !loading && grants.length > 1 && !activeGrant;
  return showChooser ? (
    <WorkspaceChooser grants={grants} onPick={(id) => dispatch(selectGrant(id))} />
  ) : (
    <>{children}</>
  );
}

function WorkspaceChooser({ grants, onPick }: { grants: Grant[]; onPick: (id: string) => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[color:var(--color-surface-2)] px-6 py-12">
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Choose what you&apos;d like to work on
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            You have access to more than one workspace. Pick one to continue — you can switch any
            time from the header.
          </p>
        </div>
        <div className="mt-8 grid gap-3">
          {grants.map((g) => (
            <button
              key={g.id}
              onClick={() => onPick(g.id)}
              className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 text-left transition-all hover:border-[color:var(--color-g-blue)] hover:shadow-[0_2px_12px_rgba(66,133,244,0.12)]"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">{grantScopeLabel(g)}</div>
                <div className="mt-1 text-xs text-slate-500 capitalize">
                  {g.scope_type.replace("_", " ")} scope
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-[color:var(--color-g-blue-soft)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-g-blue)]">
                {ROLE_LABELS[g.role]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
