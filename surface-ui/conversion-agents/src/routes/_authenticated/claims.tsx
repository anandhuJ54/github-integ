import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, X } from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { BrandAvatar, PersonAvatar } from "@v3/ui/components/sales/entity-avatar";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { Button } from "@v3/ui/components/ui/button";
import { Textarea } from "@v3/ui/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@v3/ui/components/ui/sheet";
import { cn } from "@v3/ui/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/claims")({
  component: ClaimsPage,
});

type Claim = {
  id: string;
  entity_type: string;
  entity_id: string;
  claimant_user_id: string | null;
  claimant_email: string | null;
  claimant_name: string | null;
  confidence_score: number | null;
  confidence_signals: Record<string, unknown> | null;
  match_method: string | null;
  status: string;
  review_notes: string | null;
  created_at: string;
};

const TABS = [
  { id: "pending", label: "Pending", filter: ["pending"] },
  { id: "manual_review", label: "Manual Review", filter: ["manual_review"] },
  { id: "auto_approved", label: "Auto-Approved", filter: ["auto_approved", "approved"] },
  { id: "conflict", label: "Conflicts", filter: ["conflict"] },
  { id: "all", label: "All", filter: null as string[] | null },
] as const;

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1", tone ?? "text-slate-900")}>{value}</div>
    </div>
  );
}

function ConfidenceBar({ score }: { score: number | null }) {
  const s = score ?? 0;
  const color =
    s >= 85 ? "bg-emerald-500" : s >= 50 ? "bg-amber-500" : "bg-red-500";
  const text =
    s >= 85 ? "text-emerald-700" : s >= 50 ? "text-amber-700" : "text-red-700";
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn("h-full", color)} style={{ width: `${Math.max(2, s)}%` }} />
      </div>
      <span className={cn("text-xs font-mono w-8 text-right", text)}>{s}</span>
    </div>
  );
}

const METHOD_COLORS: Record<string, string> = {
  google_oauth: "bg-blue-50 text-blue-700 border-blue-200",
  email: "bg-slate-50 text-slate-700 border-slate-200",
  license: "bg-purple-50 text-purple-700 border-purple-200",
  manual: "bg-amber-50 text-amber-700 border-amber-200",
};

function MethodBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
      METHOD_COLORS[value] ?? "bg-slate-50 text-slate-700 border-slate-200",
    )}>{value}</span>
  );
}

function ClaimsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const { data: stats } = useQuery({
    queryKey: ["claim-stats"],
    queryFn: async () => {
      const counts = await Promise.all([
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).in("status", ["auto_approved", "approved"]),
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).eq("status", "manual_review"),
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).eq("status", "conflict"),
      ]);
      return {
        pending: counts[0].count ?? 0,
        approved: counts[1].count ?? 0,
        manual: counts[2].count ?? 0,
        conflict: counts[3].count ?? 0,
      };
    },
  });

  const tabConfig = TABS.find((t) => t.id === tab)!;
  const { data: claims, isLoading } = useQuery({
    queryKey: ["claims", tab],
    queryFn: async () => {
      let q = supabase
        .from("claim_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (tabConfig.filter) q = q.in("status", tabConfig.filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Claim[];
    },
  });

  const profIds = useMemo(() => Array.from(new Set((claims ?? []).filter(c => c.entity_type === "professional").map(c => c.entity_id))), [claims]);
  const orgIds = useMemo(() => Array.from(new Set((claims ?? []).filter(c => c.entity_type === "organization").map(c => c.entity_id))), [claims]);

  const { data: entities } = useQuery({
    queryKey: ["claim-entities", profIds, orgIds],
    enabled: profIds.length > 0 || orgIds.length > 0,
    queryFn: async () => {
      const [pros, orgs] = await Promise.all([
        profIds.length
          ? supabase
              .from("professionals")
              .select("id, display_name, first_name, last_name, gcid, photo_url")
              .in("id", profIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                display_name: string | null;
                first_name: string | null;
                last_name: string | null;
                gcid: string | null;
                photo_url: string | null;
              }[],
            }),
        orgIds.length
          ? supabase.from("organizations").select("id, name, gcid, logo_url").in("id", orgIds)
          : Promise.resolve({ data: [] as { id: string; name: string; gcid: string | null; logo_url: string | null }[] }),
      ]);
      const map: Record<string, { name: string; gcid: string | null; imageUrl: string | null; kind: "professional" | "organization" }> = {};
      (pros.data ?? []).forEach((p) => {
        map[p.id] = {
          name: p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unnamed",
          gcid: p.gcid,
          imageUrl: p.photo_url ?? null,
          kind: "professional",
        };
      });
      (orgs.data ?? []).forEach((o) => {
        map[o.id] = { name: o.name, gcid: o.gcid, imageUrl: o.logo_url ?? null, kind: "organization" };
      });
      return map;
    },

  });

  const review = useMutation({
    mutationFn: async ({ id, status, review_notes }: { id: string; status: string; review_notes: string }) => {
      // Governed adjudication: approve binds both sides (exp_claim + professionals.claimed +
      // owner grant) at T2; reject closes the claim. Audit is written by the function.
      const { error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>
      )("exp_claim_queue_adjudicate", {
        p_queue: id,
        p_approve: status === "approved",
        p_note: review_notes || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      qc.invalidateQueries({ queryKey: ["claim-stats"] });
      setOpenId(null);
      setNotes("");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Adjudication failed");
    },
  });

  const openClaim = (claims ?? []).find((c) => c.id === openId);
  const openEntity = openClaim ? entities?.[openClaim.entity_id] : undefined;

  return (
    <EmpLayout>
      <div className="p-8 max-w-[1400px] mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Claims</h1>
          <p className="text-sm text-slate-500 mt-1">Review and approve profile claims</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Pending" value={stats?.pending ?? "—"} tone="text-amber-700" />
          <StatCard label="Auto-Approved" value={stats?.approved ?? "—"} tone="text-emerald-700" />
          <StatCard label="Manual Review" value={stats?.manual ?? "—"} tone="text-blue-700" />
          <StatCard label="Conflicts" value={stats?.conflict ?? "—"} tone="text-red-700" />
        </div>

        <div className="border-b border-slate-200 mb-4">
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                  tab === t.id
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-600 hover:text-slate-900",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Claimant</th>
                  <th className="text-left px-4 py-3 font-medium">Claiming profile</th>
                  <th className="text-left px-4 py-3 font-medium">Confidence</th>
                  <th className="text-left px-4 py-3 font-medium">Method</th>
                  <th className="text-left px-4 py-3 font-medium">Submitted</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Loading…</td></tr>
                ) : (claims ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    <Inbox className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    No claims in this view
                  </td></tr>
                ) : (
                  claims!.map((c) => {
                    const ent = entities?.[c.entity_id];
                    return (
                      <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{c.claimant_name ?? "—"}</div>
                          <div className="text-xs text-slate-500">{c.claimant_email ?? ""}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {ent?.kind === "organization" ? (
                              <BrandAvatar name={ent.name} logoUrl={ent.imageUrl} size="xs" />
                            ) : (
                              <PersonAvatar name={ent?.name ?? "—"} photoUrl={ent?.imageUrl ?? null} size="xs" />
                            )}
                            <div>
                              <div className="font-medium text-slate-900">{ent?.name ?? "—"}</div>
                              <div className="text-xs text-slate-500 font-mono">{ent?.gcid ?? c.entity_type}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3"><ConfidenceBar score={c.confidence_score} /></td>
                        <td className="px-4 py-3"><MethodBadge value={c.match_method} /></td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {new Date(c.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="mr-2 h-7 text-xs"
                            onClick={() => { setOpenId(c.id); setNotes(c.review_notes ?? ""); }}
                          >View Details</Button>
                          <Button
                            size="sm"
                            className="mr-2 h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => review.mutate({ id: c.id, status: "approved", review_notes: "" })}
                          ><Check className="h-3 w-3" /></Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            onClick={() => review.mutate({ id: c.id, status: "rejected", review_notes: "" })}
                          ><X className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Sheet open={!!openId} onOpenChange={(o) => { if (!o) { setOpenId(null); setNotes(""); } }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          {openClaim && (
            <>
              <SheetHeader>
                <SheetTitle>Claim details</SheetTitle>
                <SheetDescription>Review confidence signals before deciding</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <section>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Claimant</h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-sm">
                    <div className="font-medium text-slate-900">{openClaim.claimant_name ?? "—"}</div>
                    <div className="text-slate-600">{openClaim.claimant_email ?? "—"}</div>
                    {openClaim.claimant_user_id && (
                      <div className="text-xs text-slate-400 font-mono mt-1">user {openClaim.claimant_user_id.slice(0, 8)}…</div>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Profile</h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-sm">
                    <div className="font-medium text-slate-900">{openEntity?.name ?? "—"}</div>
                    <div className="text-xs text-slate-500 font-mono">
                      {openClaim.entity_type} · {openEntity?.gcid ?? "no gcid"}
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Confidence</h3>
                  <div className="flex items-center gap-3 mb-3">
                    <ConfidenceBar score={openClaim.confidence_score} />
                    <MethodBadge value={openClaim.match_method} />
                  </div>
                  <div className="space-y-1.5">
                    {openClaim.confidence_signals && Object.keys(openClaim.confidence_signals).length > 0 ? (
                      Object.entries(openClaim.confidence_signals).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-sm border-b border-slate-100 py-1.5">
                          <span className="text-slate-600">{k}</span>
                          <span className="font-mono text-slate-900 text-xs">
                            {typeof v === "boolean" ? (v ? "✓ match" : "✗ no match") : String(v)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400">No signal breakdown recorded.</p>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Review notes</h3>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Optional notes for the audit log…"
                  />
                </section>

                <div className="flex gap-2 pt-2 border-t border-slate-200">
                  <Button
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: openClaim.id, status: "approved", review_notes: notes })}
                  >Approve</Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: openClaim.id, status: "rejected", review_notes: notes })}
                  >Reject</Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </EmpLayout>
  );
}
