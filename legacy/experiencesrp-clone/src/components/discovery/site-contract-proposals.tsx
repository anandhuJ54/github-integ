import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOptionalRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { acceptSiteProposal } from "@/lib/site-proposal.functions";
import { ContractPreview } from "@/components/discovery/contract-preview";

/* G2 (contract review, 2026-10-13): a map result that did not save itself (save rule D1: only a site's first
   contract that meets the required fields saves itself) waits here as a pending proposal. The reviewer sees
   it beside the saved contract, can preview records built with it, and accepts or rejects it.
   Accept = disco_accept_site_proposal (saves through disco_map_site_ingest; an active source goes back to
   test pull). Reject = disco_reject_site_proposal. Both are admin-checked in the database and audited. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function when(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}
function sampleCount(sc: Any): number {
  return Array.isArray(sc?.samples) ? sc.samples.length : 0;
}
function hitsOf(f: Any, n: number): string {
  if (!f) return "—";
  const h = f?.hits ?? f?.sample_hits ?? f?.found;
  return h == null ? "✓" : `${h} / ${n || "—"}`;
}
function listRouteText(lr: Any): string {
  if (!lr) return "—";
  const kinds = Array.isArray(lr.sources) ? lr.sources.map((s: Any) => s?.type ?? "?").join(" + ") : "—";
  const cov = lr.coverage && typeof lr.coverage === "object" ? Object.values(lr.coverage)[0] : null;
  return `${kinds}${cov != null ? ` · coverage ${cov}%` : ""}${lr.estimate?.expected_profiles ? ` · ~${Number(lr.estimate.expected_profiles).toLocaleString()} profiles` : ""}`;
}

function Row({ label, saved, proposed, changed }: { label: string; saved: ReactNode; proposed: ReactNode; changed?: boolean }) {
  return (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <td className="px-2 py-1.5 text-slate-500">{label}</td>
      <td className="px-2 py-1.5 break-all">{saved}</td>
      <td className={cn("px-2 py-1.5 break-all", changed && "bg-amber-50")}>{proposed}</td>
    </tr>
  );
}

export function SiteContractProposals({
  domain,
  gcid,
  saved,
}: {
  domain: string;
  gcid: string;
  /** The saved contract row as the panel reads it (site_contract = extraction->site_contract), or null. */
  saved: Any | null;
}) {
  const role = useOptionalRole();
  const canEdit = role?.canEdit ?? false;
  const queryClient = useQueryClient();
  const runAccept = useServerFn(acceptSiteProposal);
  const [confirm, setConfirm] = useState<null | "accept" | "reject">(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: proposals } = useQuery({
    queryKey: ["site_contract_proposals", domain, gcid],
    queryFn: async () => {
      const { data, error } = await (supabase as Any)
        .from("disco_proposals")
        .select("proposal_id, state, created_at, payload")
        .eq("kind", "site_map")
        .eq("category_slug", gcid)
        .eq("payload->>domain", domain)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Any[];
    },
  });
  // Accept closes a harvest that is still running (disco_accept_site_proposal, 2026-10-15): the dialog says so first.
  const { data: harvest } = useQuery({
    queryKey: ["accept_harvest_state", domain, gcid],
    enabled: confirm === "accept",
    queryFn: async () => {
      const db = supabase as Any;
      const { data: src } = await db.from("exp_etl_sources").select("source_id, status")
        .eq("source_domain", domain).eq("gcid", gcid).maybeSingle();
      if (!src || src.status !== "active") return null;
      const { data: run } = await db.from("exp_etl_runs").select("started_at").eq("source_id", src.source_id)
        .is("finished_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (!run) return null;
      const { count } = await db.from("exp_etl_frontier").select("frontier_id", { count: "exact", head: true })
        .eq("domain", domain).in("status", ["queued", "fetching"]);
      return { since: String(run.started_at), queued: count ?? 0 };
    },
  });
  const pending = (proposals ?? []).filter((p) => p.state === "pending");
  const current = pending[0] ?? null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["site_contract_proposals", domain, gcid] });
    await queryClient.invalidateQueries({ queryKey: ["site_contract_panel"] });
  };
  const decide = useMutation({
    mutationFn: async (kind: "accept" | "reject") => {
      if (kind === "accept") {
        // Server function: database Accept (admin-checked there) + shared extra-key refresh.
        const data = await runAccept({ data: { proposalId: current.proposal_id } });
        return { kind, data };
      }
      const { data, error } = await (supabase as Any).rpc("disco_reject_site_proposal", { p_proposal_id: current.proposal_id });
      if (error) throw error;
      return { kind, data };
    },
    onSuccess: async ({ kind, data }) => {
      toast.success(kind === "accept"
        ? `Contract accepted for ${domain}${data?.source_status ? ` — source is now ${data.source_status}` : ""}${data?.requeued ? ` · ${data.requeued} pages re-queued for the gate` : ""}${data?.closed_runs ? " · previous run closed" : ""}`
        : `Proposal rejected for ${domain} — the saved contract stays`);
      setConfirm(null);
      await refresh();
    },
    onError: (e: Any) => toast.error(e?.message ?? String(e)),
  });

  if (!proposals?.length) return null;

  const p: Any = current?.payload ?? {};
  const psc: Any = p?.extraction?.site_contract ?? {};
  const ssc: Any = saved?.site_contract ?? {};
  const pn = sampleCount(psc);
  const sn = sampleCount(ssc);
  const ids = [...new Set([...Object.keys(ssc.fields ?? {}), ...Object.keys(psc.fields ?? {})])].sort();
  const sc = p?.save_check ?? {};

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/40">
      {current ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 px-3 py-2">
            <span className="text-sm font-semibold text-slate-800">Proposal waiting for review</span>
            <Badge variant="secondary" className="font-normal">#{current.proposal_id}</Badge>
            <span className="text-xs text-slate-500">mapped {when(p.proposed_at ?? current.created_at)}</span>
            {pending.length > 1 ? <span className="text-xs text-slate-500">· {pending.length - 1} older pending</span> : null}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" disabled={!canEdit || decide.isPending} onClick={() => setConfirm("reject")}>Reject</Button>
              <Button size="sm" disabled={!canEdit || decide.isPending} onClick={() => setConfirm("accept")}>Accept</Button>
            </div>
          </div>
          <div className="space-y-3 px-3 py-3 text-xs text-slate-700">
            <p className="text-slate-600">{fmt(sc.reason)}{sc.compare_reason ? ` · comparison: ${sc.compare_reason}` : ""}</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="px-2 py-1.5 font-semibold">Measure</th>
                    <th className="px-2 py-1.5 font-semibold">Saved contract{saved?.learned_at ? ` (${when(saved.learned_at)})` : ""}</th>
                    <th className="px-2 py-1.5 font-semibold">Proposed</th>
                  </tr>
                </thead>
                <tbody>
                  <Row label="Static fields" saved={ids.filter((k) => ssc.fields?.[k]).length} proposed={ids.filter((k) => psc.fields?.[k]).length} />
                  <Row label="Field floor" saved={fmt(saved?.field_floor)} proposed={fmt(p.field_floor)} changed={saved?.field_floor !== p.field_floor} />
                  <Row label="Required fields" saved={ssc.must_have ? (ssc.must_have.ok ? "ok" : `missing ${fmt(ssc.must_have.missing)}`) : "—"}
                    proposed={psc.must_have ? (psc.must_have.ok ? "ok" : `missing ${fmt(psc.must_have.missing)}`) : "—"} />
                  <Row label="Profile page pattern" saved={<code className="font-mono text-[11px]">{fmt(saved?.detail_pattern)}</code>}
                    proposed={<code className="font-mono text-[11px]">{fmt(p.detail_pattern)}</code>} changed={saved?.detail_pattern !== p.detail_pattern} />
                  <Row label="Profile sitemaps" saved={fmt(saved?.profile_sitemaps)} proposed={fmt(p.profile_sitemaps)} />
                  <Row label="How profiles are listed" saved={listRouteText(ssc.list_route)} proposed={listRouteText(psc.list_route)} />
                  <Row label="Harvestable now" saved={ssc.list_route ? (ssc.list_route.harvestable ? "yes" : "no") : "—"}
                    proposed={psc.list_route ? (psc.list_route.harvestable ? "yes" : `no — ${fmt(psc.list_route.harvest_note)}`) : "—"} />
                  <Row label="Mapping cost (version 2)" saved="—" proposed={p.v2_research?.cost_usd != null ? `$${p.v2_research.cost_usd}` : "—"} />
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="px-2 py-1.5 font-semibold">Field</th>
                    <th className="px-2 py-1.5 font-semibold">Saved hits</th>
                    <th className="px-2 py-1.5 font-semibold">Proposed hits</th>
                    <th className="px-2 py-1.5 font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {ids.map((k) => {
                    const a = ssc.fields?.[k];
                    const b = psc.fields?.[k];
                    const change = a && !b ? "dropped" : !a && b ? "new" : "";
                    return (
                      <tr key={k} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1 font-mono">{k}</td>
                        <td className="px-2 py-1">{hitsOf(a, sn)}</td>
                        <td className="px-2 py-1">{hitsOf(b, pn)}</td>
                        <td className="px-2 py-1">
                          {change ? (
                            <Badge variant="secondary" className={cn("font-normal", change === "new" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{change}</Badge>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ContractPreview
              key={current.proposal_id}
              target={{ proposalId: current.proposal_id }}
              sc={psc}
              domain={domain}
              label={`proposal-${current.proposal_id}`}
              heading="Preview: records as staging would store them with the proposed contract"
            />
          </div>
        </>
      ) : null}
      <div className="border-t border-amber-200 px-3 py-2 text-xs">
        <button type="button" className="text-slate-600 hover:underline" onClick={() => setShowHistory((s) => !s)}>
          {showHistory ? "Hide" : "Show"} proposal history ({proposals.length})
        </button>
        {showHistory ? (
          <ul className="mt-2 space-y-1">
            {proposals.map((h) => (
              <li key={h.proposal_id} className="flex flex-wrap gap-2">
                <span className="font-mono">#{h.proposal_id}</span>
                <Badge variant="secondary" className="font-normal">{h.state}</Badge>
                <span className="text-slate-500">{when(h.created_at)}</span>
                <span className="text-slate-500">floor {fmt(h.payload?.field_floor)}</span>
                <span className="text-slate-500">{listRouteText(h.payload?.extraction?.site_contract?.list_route)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o && !decide.isPending) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "accept" ? `Accept the proposed contract for ${domain}?` : `Reject the proposal for ${domain}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "accept"
                ? "The proposed contract replaces the saved one (the saved one stays stored for rollback). Other pending proposals for this site are closed. If the source is active, it goes back to the test pull: 20 of its profile pages are re-read with the new contract and the gate decides (pass: active again; fail: paused, old records unchanged)."
                : "The saved contract stays as it is. The proposal is kept in the history as rejected."}
            </AlertDialogDescription>
            {confirm === "accept" && harvest ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Harvest in progress since{" "}
                {new Date(harvest.since).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {" "}· {harvest.queued.toLocaleString()} pages queued. Accepting stops this run and restarts with a test pull on
                the new contract. The queued pages stay queued and are fetched with the new contract once it passes the gate.
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decide.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={decide.isPending} onClick={(e) => { e.preventDefault(); if (confirm) decide.mutate(confirm); }}>
              {decide.isPending ? "Working…" : confirm === "accept" ? "Accept" : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
