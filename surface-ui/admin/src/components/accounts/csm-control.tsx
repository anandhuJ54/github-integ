import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@v3/ui/components/ui/popover";
import { useRole } from "@v3/ui/lib/roles";
import { assignCsm, clearCsm, isMine, listCsmCandidates, type CsmAssignment } from "@v3/admin/lib/csm";

/** "CSM: <name> · Change/Assign" — super-admins pick anyone; others can claim or release for themselves. */
export function CsmControl({ orgId, csm, compact }: { orgId: string; csm: CsmAssignment | null | undefined; compact?: boolean }) {
  const { user, isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const candidates = useQuery({ queryKey: ["csm-candidates"], queryFn: listCsmCandidates, enabled: isSuperAdmin && open });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["csm-assignments"] });
    qc.invalidateQueries({ queryKey: ["account-csm", orgId] });
    setOpen(false);
  };
  const assign = useMutation({
    mutationFn: (c: { user_ref: string; name: string | null; email: string | null }) => assignCsm(orgId, c, user?.email ?? user?.id ?? null),
    onSuccess: () => { toast.success("CSM assigned"); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const clear = useMutation({
    mutationFn: () => clearCsm(orgId),
    onSuccess: () => { toast.success("CSM cleared"); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mine = !!csm && isMine(csm, user?.id, user?.email);
  const me = { user_ref: user?.id ?? "", name: user?.email?.split("@")[0] ?? null, email: user?.email ?? null };
  const label = csm ? csm.csm_name || csm.csm_email || "Assigned" : "Unassigned";

  return (
    <span className={compact ? "inline-flex items-center gap-1 text-xs" : "inline-flex items-center gap-1.5 text-sm"} onClick={(e) => e.stopPropagation()}>
      <span className="text-[color:var(--color-ink-3)]">CSM:</span>
      <span className={csm ? "font-medium text-ink" : "text-[color:var(--color-ink-3)]"}>{label}</span>
      <span className="text-[color:var(--color-ink-3)]">·</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="font-medium text-[color:var(--color-g-blue)] hover:underline">
            {csm ? "Change" : "Assign"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-1">
            {!mine && user ? (
              <Button size="sm" variant="outline" className="w-full justify-start" disabled={assign.isPending} onClick={() => assign.mutate(me)}>
                Assign to me
              </Button>
            ) : null}
            {csm && (isSuperAdmin || mine) ? (
              <Button size="sm" variant="ghost" className="w-full justify-start text-destructive" disabled={clear.isPending} onClick={() => clear.mutate()}>
                Clear CSM
              </Button>
            ) : null}
            {isSuperAdmin ? (
              <div className="max-h-60 overflow-y-auto border-t border-[color:var(--color-hairline)] pt-1">
                {candidates.isLoading ? (
                  <p className="p-2 text-xs text-[color:var(--color-ink-3)]">Loading users…</p>
                ) : candidates.error ? (
                  <p className="p-2 text-xs text-destructive">{(candidates.error as Error).message}</p>
                ) : (
                  (candidates.data ?? []).map((c) => (
                    <button
                      key={c.user_ref}
                      type="button"
                      disabled={assign.isPending || c.user_ref === csm?.csm_user_ref}
                      onClick={() => assign.mutate(c)}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-ink hover:bg-[color:var(--color-surface-2)] disabled:opacity-50"
                    >
                      {c.email ?? c.user_ref}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
