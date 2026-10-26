import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { api } from "@v3/ui/lib/server-fn";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { Button } from "@v3/ui/components/ui/button";
import { Badge } from "@v3/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { ROLE_LABELS, useRole, type ControlRole } from "@v3/ui/lib/roles";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "Users & Grants · Experience.com Admin Console" },
      {
        name: "description",
        content:
          "Manage admin console access: list users and assign or revoke super admin, architect and analyst grants.",
      },
      { property: "og:title", content: "Users & Grants · Experience.com Admin Console" },
      {
        property: "og:description",
        content: "Assign or revoke admin console roles for Experience.com users.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersAndGrantsPage,
});

type DirectoryUser = {
  user_id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
};

type GrantRow = {
  id: string;
  user_id: string;
  role: ControlRole;
  scope_type: string;
  scope_id: string;
  is_primary: boolean;
};

const ROLES: ControlRole[] = ["super_admin", "architect", "analyst"];

function UsersAndGrantsPage() {
  const { isSuperAdmin, activeRole, logAudit } = useRole();
  const qc = useQueryClient();
  const [pendingRole, setPendingRole] = useState<Record<string, ControlRole>>({});

  const usersQuery = useQuery({
    queryKey: ["control-users"],
    enabled: isSuperAdmin,
    queryFn: () => api.get<DirectoryUser[]>("/admin/control-users"),
  });

  const grantsQuery = useQuery({
    queryKey: ["control-grants-all"],
    enabled: isSuperAdmin,
    queryFn: () => api.get<GrantRow[]>("/admin/control-grants"),
  });

  const grantsByUser = useMemo(() => {
    const m: Record<string, GrantRow[]> = {};
    for (const g of grantsQuery.data ?? []) {
      (m[g.user_id] ??= []).push(g);
    }
    return m;
  }, [grantsQuery.data]);

  const assign = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: ControlRole }) => {
      await api.post("/admin/control-grants", { user_id: userId, role });
      await logAudit("grant.assign", userId, { role, acting_role: activeRole });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["control-grants-all"] }),
  });

  const revoke = useMutation({
    mutationFn: async (grant: GrantRow) => {
      await api.delete(`/admin/control-grants/${grant.id}`);
      await logAudit("grant.revoke", grant.user_id, {
        role: grant.role,
        acting_role: activeRole,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["control-grants-all"] }),
  });

  if (!isSuperAdmin) {
    return (
      <EmpLayout>
        <div className="p-8">
          <h1 className="text-xl font-semibold text-ink">Users &amp; Grants</h1>
          <p className="mt-2 text-sm text-slate-500">
            This page requires the Super Admin role. Switch roles in the header if you hold a
            Super Admin grant.
          </p>
        </div>
      </EmpLayout>
    );
  }

  const busy = usersQuery.isLoading || grantsQuery.isLoading;

  return (
    <EmpLayout>
      <div className="p-6 lg:p-8 space-y-6">
        <header className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl grid place-items-center bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]">
            <UserCog className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Users &amp; Grants</h1>
            <p className="text-sm text-slate-500">
              Admin console access is invite-only. Create users in the backend, then grant roles here.
            </p>
          </div>
        </header>

        {busy ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
          </div>
        ) : (
          <div className="rounded-2xl border border-[color:var(--color-hairline)] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3 text-left">User</th>
                  <th className="p-3 text-left">Grants</th>
                  <th className="p-3 text-left">Last sign-in</th>
                  <th className="p-3 text-right">Assign role</th>
                </tr>
              </thead>
              <tbody>
                {(usersQuery.data ?? []).map((u) => {
                  const grants = grantsByUser[u.user_id] ?? [];
                  const selected = pendingRole[u.user_id] ?? "analyst";
                  return (
                    <tr key={u.user_id} className="border-t border-slate-100 align-top">
                      <td className="p-3">
                        <div className="font-medium text-slate-900">{u.email ?? "—"}</div>
                        <div className="text-xs text-slate-400 font-mono">{u.user_id}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1.5">
                          {grants.length === 0 && (
                            <span className="text-xs text-slate-400">No grants</span>
                          )}
                          {grants.map((g) => (
                            <span
                              key={g.id}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
                            >
                              {g.role === "super_admin" && (
                                <ShieldCheck className="h-3 w-3 text-[color:var(--color-g-blue)]" />
                              )}
                              {ROLE_LABELS[g.role]}
                              <button
                                aria-label={`Revoke ${ROLE_LABELS[g.role]}`}
                                className="text-slate-400 hover:text-red-600"
                                onClick={() => revoke.mutate(g)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-slate-500">
                        {u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleString()
                          : "Never"}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          <Select
                            value={selected}
                            onValueChange={(v) =>
                              setPendingRole({ ...pendingRole, [u.user_id]: v as ControlRole })
                            }
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="gap-1"
                            disabled={
                              assign.isPending ||
                              grants.some((g) => g.role === selected)
                            }
                            onClick={() =>
                              assign.mutate({ userId: u.user_id, role: selected })
                            }
                          >
                            <Plus className="h-3.5 w-3.5" /> Grant
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {(assign.error || revoke.error) && (
          <Badge variant="outline" className="text-red-600 border-red-200">
            {(assign.error as Error | null)?.message ??
              (revoke.error as Error | null)?.message}
          </Badge>
        )}
      </div>
    </EmpLayout>
  );
}
