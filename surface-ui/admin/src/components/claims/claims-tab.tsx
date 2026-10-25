import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Inbox } from "lucide-react";
import { toast } from "sonner";
import { api } from "@v3/ui/lib/server-fn";
import { Badge } from "@v3/ui/components/ui/badge";
import { Button } from "@v3/ui/components/ui/button";
import { Label } from "@v3/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/ui/components/ui/dialog";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { useRole } from "@v3/ui/lib/roles";
import { cn } from "@v3/ui/lib/utils";

type ClaimRow = {
  claim_id: string;
  entity_id: string | null;
  user_id: string | null;
  claim_type: string | null;
  status: string;
  evidence: Record<string, unknown> | null;
  verified_at: string | null;
  created_at: string;
};

type EntityLite = { entity_id: string; display_name: string; entity_type: string };

const ENTITY_TYPE_STYLES: Record<string, string> = {
  professional: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  location: "bg-emerald-50 text-emerald-700",
  brand: "bg-violet-50 text-violet-700",
  team: "bg-amber-50 text-amber-700",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  verified: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  revoked: "bg-slate-100 text-slate-600",
};

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}

function EvidenceList({ evidence }: { evidence: Record<string, unknown> | null }) {
  const entries = Object.entries(evidence ?? {});
  if (entries.length === 0)
    return <div className="px-6 py-3 text-xs text-slate-500">No evidence submitted.</div>;
  return (
    <dl className="grid gap-x-6 gap-y-1.5 px-6 py-3 text-xs sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="min-w-[120px] font-mono text-[11px] text-slate-500">{k}</dt>
          <dd className="break-all text-slate-700">
            {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ClaimsTab() {
  const { canEdit } = useRole();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data: claims, isLoading } = useQuery({
    queryKey: ["exp_claim", "all"],
    queryFn: () => api.get<ClaimRow[]>("/admin/control-claims"),
  });

  const { data: entities } = useQuery({
    queryKey: ["exp_entity", "lite"],
    queryFn: () => api.get<EntityLite[]>("/admin/control-claims/entities-lite"),
  });

  const { data: users } = useQuery({
    queryKey: ["control_users"],
    queryFn: () =>
      api
        .get<{ user_id: string; email: string }[]>("/admin/control-claims/users")
        .catch(() => [] as { user_id: string; email: string }[]),
  });

  const entityById = useMemo(() => {
    const m = new Map<string, EntityLite>();
    for (const e of entities ?? []) m.set(e.entity_id, e);
    return m;
  }, [entities]);

  const emailById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users ?? []) m.set(u.user_id, u.email);
    return m;
  }, [users]);

  const adjudicate = useMutation({
    mutationFn: async (vars: { claimId: string; approve: boolean; note?: string }) => {
      await api.post("/admin/control-claims/rpc/exp_claim_adjudicate", {
        args: { p_claim: vars.claimId, p_approve: vars.approve, p_note: vars.note },
      });
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.approve ? "Claim approved" : "Claim rejected");
      void queryClient.invalidateQueries({ queryKey: ["exp_claim"] });
      void queryClient.invalidateQueries({ queryKey: ["exp_entity"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Adjudication failed");
    },
  });

  const rows = claims ?? [];
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status))).sort(),
    [rows],
  );
  const entityTypes = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((r) => (r.entity_id ? entityById.get(r.entity_id)?.entity_type : undefined))
            .filter((v): v is string => Boolean(v)),
        ),
      ).sort(),
    [rows, entityById],
  );

  const filtered = rows.filter((r) => {
    const et = r.entity_id ? entityById.get(r.entity_id)?.entity_type : undefined;
    return (
      (statusFilter === "all" || r.status === statusFilter) &&
      (typeFilter === "all" || et === typeFilter)
    );
  });

  if (!isLoading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-14 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)]">
          <Inbox className="h-5 w-5 text-[color:var(--color-g-blue)]" />
        </div>
        <div className="mt-4 text-sm font-semibold text-slate-900">No claims yet</div>
        <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
          No claims yet — claims appear when users request ownership of entities.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Entity type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {entityTypes.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/70">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="w-8" />
              <th className="px-3 py-2 font-medium">Claimant</th>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Verified</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-xs text-slate-500">
                  Loading claims…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-xs text-slate-500">
                  No claims match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const isOpen = open[r.claim_id] ?? false;
                const entity = r.entity_id ? entityById.get(r.entity_id) : undefined;
                const claimant =
                  (r.user_id ? emailById.get(r.user_id) : null) ??
                  (r.user_id ? r.user_id : "—");
                return (
                  <Fragment key={r.claim_id}>
                    <tr
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => setOpen((s) => ({ ...s, [r.claim_id]: !isOpen }))}
                    >
                      <td className="pl-3 text-slate-400">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">{claimant}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {entity?.display_name ?? (r.entity_id ? r.entity_id.slice(0, 8) : "—")}
                      </td>
                      <td className="px-3 py-2">
                        {entity ? (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-normal capitalize",
                              ENTITY_TYPE_STYLES[entity.entity_type] ?? "bg-slate-100 text-slate-600",
                            )}
                          >
                            {entity.entity_type}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "font-normal capitalize",
                            STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600",
                          )}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.verified_at)}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {r.status === "pending" && canEdit ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={adjudicate.isPending}
                              onClick={() =>
                                adjudicate.mutate({ claimId: r.claim_id, approve: true })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={adjudicate.isPending}
                              onClick={() => {
                                setNote("");
                                setRejecting(r.claim_id);
                              }}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-slate-100 bg-slate-50/40">
                        <td colSpan={8}>
                          <EvidenceList evidence={r.evidence} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject claim</DialogTitle>
            <DialogDescription>
              Add an optional note explaining why this claim is being rejected.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note…"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={adjudicate.isPending}
              onClick={() => {
                const id = rejecting;
                if (!id) return;
                setRejecting(null);
                adjudicate.mutate({
                  claimId: id,
                  approve: false,
                  note: note.trim() ? note.trim() : undefined,
                });
              }}
            >
              Reject claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
