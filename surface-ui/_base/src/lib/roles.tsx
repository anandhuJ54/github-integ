import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@v3/ui/integrations/supabase/client";

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

export const ROLE_LABELS: Record<ControlRole, string> = {
  super_admin: "Super Admin",
  architect: "Architect",
  analyst: "Analyst",
};

const ROLE_RANK: Record<ControlRole, number> = {
  super_admin: 3,
  architect: 2,
  analyst: 1,
};

const STORAGE_KEY = "exp.activeRole";
const GRANT_STORAGE_KEY = "exp.activeGrant";

type RoleContextValue = {
  user: User | null;
  grants: Grant[];
  activeRole: ControlRole | null;
  activeGrant: Grant | null;
  setActiveRole: (role: ControlRole) => void;
  setActiveGrant: (grantId: string) => void;
  canEdit: boolean;
  isSuperAdmin: boolean;
  isReadOnly: boolean;
  logAudit: (action: string, target?: string | null, details?: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used inside <RoleProvider>");
  }
  return ctx;
}

/** Safe variant for components that may render outside the authenticated tree. */
export function useOptionalRole(): RoleContextValue | null {
  return useContext(RoleContext);
}

export function grantScopeLabel(g: Grant): string {
  if (g.scope_label) return g.scope_label;
  if (g.scope_type === "global") return "Platform Administration";
  if (g.scope_type === "entity") return "Entity workspace";
  if (g.scope_type === "control_node") return "Control node workspace";
  return g.scope_type;
}

async function resolveScopeLabels(rows: Grant[]): Promise<Grant[]> {
  const entityIds = rows.filter((r) => r.scope_type === "entity").map((r) => r.scope_id);
  const nodeIds = rows.filter((r) => r.scope_type === "control_node").map((r) => r.scope_id);

  const names = new Map<string, string>();

  if (entityIds.length > 0) {
    const { data } = await supabase
      .from("exp_entity")
      .select("entity_id, display_name")
      .in("entity_id", entityIds);
    for (const e of data ?? []) names.set(e.entity_id as string, e.display_name as string);
  }
  if (nodeIds.length > 0) {
    const { data } = await supabase
      .from("exp_control_nodes")
      .select("node_id, name")
      .in("node_id", nodeIds);
    for (const n of data ?? []) names.set(n.node_id as string, n.name as string);
  }

  return rows.map((r) => ({
    ...r,
    scope_label:
      r.scope_type === "global"
        ? "Platform Administration"
        : (names.get(r.scope_id) ?? grantScopeLabel(r)),
  }));
}

export function RoleProvider({ user, children }: { user: User; children: ReactNode }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [activeGrantId, setActiveGrantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logAudit = useCallback(
    async (action: string, target?: string | null, details?: Record<string, unknown>, actingRole?: string | null) => {
      await supabase.from("exp_admin_audit").insert({
        user_id: user.id,
        acting_role: (actingRole ??
          (typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null)) as
          | string
          | null,
        action,
        target: target ?? null,
        details: (details ?? {}) as never,
      });
    },
    [user.id],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let { data } = await supabase
        .from("exp_control_grants")
        .select("id, role, scope_type, scope_id, is_primary")
        .eq("user_id", user.id);

      // One-time bootstrap: the very first signed-in user becomes super_admin.
      if (!data || data.length === 0) {
        await supabase.rpc("bootstrap_control_super_admin");
        const retry = await supabase
          .from("exp_control_grants")
          .select("id, role, scope_type, scope_id, is_primary")
          .eq("user_id", user.id);
        data = retry.data ?? [];
      }

      if (cancelled) return;

      let rows = (data ?? []) as Grant[];
      rows.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role]);
      rows = await resolveScopeLabels(rows);
      if (cancelled) return;
      setGrants(rows);

      const storedGrant =
        typeof window !== "undefined" ? window.localStorage.getItem(GRANT_STORAGE_KEY) : null;
      let initialGrant: string | null =
        storedGrant && rows.some((r) => r.id === storedGrant) ? storedGrant : null;

      // Single-grant users skip the chooser entirely.
      if (!initialGrant && rows.length === 1) initialGrant = rows[0]!.id;

      if (initialGrant && typeof window !== "undefined") {
        window.localStorage.setItem(GRANT_STORAGE_KEY, initialGrant);
        const role = rows.find((r) => r.id === initialGrant)?.role;
        if (role) window.localStorage.setItem(STORAGE_KEY, role);
      }
      setActiveGrantId(initialGrant);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const activeGrant = useMemo(
    () => grants.find((g) => g.id === activeGrantId) ?? null,
    [grants, activeGrantId],
  );

  const setActiveGrant = useCallback(
    (grantId: string) => {
      const g = grants.find((x) => x.id === grantId);
      if (!g) return;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(GRANT_STORAGE_KEY, g.id);
        window.localStorage.setItem(STORAGE_KEY, g.role);
      }
      setActiveGrantId(g.id);
      void logAudit(
        "workspace_switch",
        g.id,
        { role: g.role, scope_type: g.scope_type, scope_id: g.scope_id, scope: grantScopeLabel(g) },
        g.role,
      );
    },
    [grants, logAudit],
  );

  const setActiveRole = useCallback(
    (role: ControlRole) => {
      const g = grants.find((x) => x.role === role);
      if (g) setActiveGrant(g.id);
    },
    [grants, setActiveGrant],
  );

  const value = useMemo<RoleContextValue>(() => {
    const activeRole = activeGrant?.role ?? null;
    const isSuperAdmin = activeRole === "super_admin";
    const canEdit = activeRole === "super_admin" || activeRole === "architect";
    return {
      user,
      grants,
      activeRole,
      activeGrant,
      setActiveRole,
      setActiveGrant,
      canEdit,
      isSuperAdmin,
      isReadOnly: !canEdit,
      logAudit: (action, target, details) => logAudit(action, target, details),
      signOut: async () => {
        await supabase.auth.signOut();
        if (typeof window !== "undefined") window.location.href = "/auth";
      },
      loading,
    };
  }, [user, grants, activeGrant, setActiveRole, setActiveGrant, logAudit, loading]);

  const showChooser = !loading && grants.length > 1 && !activeGrant;

  return (
    <RoleContext.Provider value={value}>
      {showChooser ? <WorkspaceChooser grants={grants} onPick={setActiveGrant} /> : children}
    </RoleContext.Provider>
  );
}

function WorkspaceChooser({
  grants,
  onPick,
}: {
  grants: Grant[];
  onPick: (id: string) => void;
}) {
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
